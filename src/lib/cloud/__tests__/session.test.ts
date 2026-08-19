/**
 * session.ts's pure crypto (DESIGN.md §7.6, brief F): unit-tested with ZERO
 * HTTP — no Request/Response, no route, no env var. The matrix the brief
 * requires: password hash true/false (including a malformed stored hash),
 * and session cookies valid/expired/tampered/wrong-secret/garbage — plus a
 * structural pin that verification never degrades to a naive `===` (the
 * one property a black-box test alone can't fully prove; see the note on
 * the last describe block).
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SESSION_DURATION_MS,
  createSessionCookieValue,
  hashPassword,
  inspectStoredHash,
  isStoredHashReadable,
  verifyPassword,
  verifySessionCookieValue,
  verifyUsername,
  classifyStoredHashProblem,
} from "../session";

/**
 * Flip one character of a base64url string, changing the DECODED BYTES
 * deterministically. NOT the last character: base64(url) of data whose byte
 * length isn't a multiple of 3 has a final character that encodes FEWER
 * than 6 real bits (the rest are always-zero padding) — flipping it can
 * land on a different character that decodes to the SAME bytes (e.g. a
 * 64-byte value's last char carries only 2 real bits, so "A"↔"B" — both
 * `0b00xxxx` — are indistinguishable after decoding). That depends on the
 * VALUE being encoded, so it's flaky by construction: found the hard way
 * (this exact bug intermittently failed both the password-hash and the
 * session-cookie tampering tests below, roughly 1-in-4 and 1-in-16 runs
 * respectively, matching each value's byte-length-mod-3 remainder). The
 * second-to-last character is ALWAYS a full, unpadded 6-bit value
 * regardless of remainder, so flipping it deterministically changes the
 * decoded bytes no matter what the underlying random value was.
 */
function flipSafeBase64Char(value: string): string {
  const i = value.length - 2;
  return value.slice(0, i) + (value[i] === "A" ? "B" : "A") + value.slice(i + 1);
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

describe("hashPassword / verifyPassword", () => {
  it("the right password verifies true", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("the wrong password verifies false", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("is case- and whitespace-sensitive (no silent normalization)", async () => {
    const hash = await hashPassword("Sesame");
    expect(await verifyPassword("sesame", hash)).toBe(false);
    expect(await verifyPassword("Sesame ", hash)).toBe(false);
  });

  it("produces the documented self-describing format: scrypt.N.r.p.salt.hash (TASK 1: dotenv-safe, dot-separated)", async () => {
    const hash = await hashPassword("x");
    expect(hash).toMatch(/^scrypt\.\d+\.\d+\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("two hashes of the SAME password differ (random salt per call)", async () => {
    const a = await hashPassword("same input");
    const b = await hashPassword("same input");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same input", a)).toBe(true);
    expect(await verifyPassword("same input", b)).toBe(true);
  });

  describe("a malformed/garbage stored hash fails CLOSED (false), never throws", () => {
    const GARBAGE: [label: string, stored: string][] = [
      ["empty string", ""],
      ["plain text", "not a hash at all"],
      ["wrong algorithm tag", "bcrypt$10$abc$def"],
      ["too few fields", "scrypt$16384$8$1$salt"],
      ["too many fields", "scrypt$16384$8$1$salt$hash$extra"],
      ["non-numeric N", "scrypt$abc$8$1$c2FsdA$aGFzaA"],
      ["negative p", "scrypt$16384$8$-1$c2FsdA$aGFzaA"],
      ["empty salt", "scrypt$16384$8$1$$aGFzaA"],
      ["empty hash", "scrypt$16384$8$1$c2FsdA$"],
      // M2 (review): N=2 is a valid "power of two greater than one" per
      // Node's own rule but computationally meaningless — this module's own
      // floor (SCRYPT_MIN_N) must reject it regardless.
      ["N=2 (technically a power of two, far below the floor)", "scrypt$2$1$1$c2FsdA$aGFzaA"],
      ["N=0", "scrypt$0$8$1$c2FsdA$aGFzaA"],
      ["N not a power of two (20000)", "scrypt$20000$8$1$c2FsdA$aGFzaA"],
      ["N negative", "scrypt$-16384$8$1$c2FsdA$aGFzaA"],
      // M1 (review): a valid power-of-two N combined with an absurd p must
      // be rejected by the memory-ceiling arithmetic BEFORE ever calling
      // into scrypt — not discovered by trying to allocate for it.
      ["N/r/p whose 128*N*r*p exceeds the memory ceiling", "scrypt$131072$8$1000$c2FsdA$aGFzaA"],
      ["an enormous N alone blows the ceiling", `scrypt$${2 ** 30}$8$1$c2FsdA$aGFzaA`],
      // TASK 1 (dot-separated format): the SAME malformed shapes, spelled
      // with the new delimiter, must be rejected exactly as strictly.
      ["dot form: too few fields", "scrypt.16384.8.1.salt"],
      ["dot form: too many fields", "scrypt.16384.8.1.salt.hash.extra"],
      ["dot form: non-numeric N", "scrypt.abc.8.1.c2FsdA.aGFzaA"],
      ["dot form: empty salt", "scrypt.16384.8.1..aGFzaA"],
      ["dot form: empty hash", "scrypt.16384.8.1.c2FsdA."],
      ["dot form: N not a power of two", "scrypt.20000.8.1.c2FsdA.aGFzaA"],
      // TASK 1: mixed/malformed separators — a string using BOTH delimiters
      // is never a valid instance of either format.
      ["mixed separators: dot fields inside a $-delimited attempt", "scrypt$131072.8$1$c2FsdA$aGFzaA"],
      ["mixed separators: a stray $ inside an otherwise dot-delimited hash", "scrypt.131072.8$1.c2FsdA.aGFzaA"],
      // TASK 1: the EXACT dotenv-expand corruption shape (module note atop
      // session.ts) — `scrypt$131072$8$1$<salt>$<hash>` loses every `$` to
      // variable expansion, collapsing to "scrypt" + digits + a mangled
      // remainder with NO separator surviving anywhere. Must fail closed
      // like any other garbage, not be silently "recovered" as valid.
      [
        "dotenv-mangled: no separators survive at all (the exact real-world corruption)",
        "scrypt31072DB04C5G5r81KlmRt5brOAueGFOewWVkIc9KWD7CmEhnVRhb9GZQzERTVeQjE5gTUXMrEeIlXb9ePu9",
      ],
    ];
    for (const [label, stored] of GARBAGE) {
      it(label, async () => {
        await expect(verifyPassword("anything", stored)).resolves.toBe(false);
      });
    }
  });

  describe("TASK 1: the dot-separated format is the default; the legacy $-separated format is still accepted", () => {
    it("a hash minted in the legacy $ format (e.g. from before this change, or already deployed) still verifies — no broken window", async () => {
      // Every character INSIDE a segment (the numeric params, and the
      // base64url salt/hash) is identical between the two forms — only the
      // delimiter differs, and base64url's alphabet contains neither `.`
      // nor `$` — so swapping the delimiter is a lossless, mechanical
      // conversion between the two representations of the SAME hash. This
      // is exactly the relationship the format decision relies on (see
      // session.ts's module comment).
      const dotForm = await hashPassword("correct horse battery staple");
      const legacyForm = dotForm.replaceAll(".", "$");
      expect(legacyForm).not.toBe(dotForm);
      expect(legacyForm).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
      await expect(verifyPassword("correct horse battery staple", legacyForm)).resolves.toBe(true);
      await expect(verifyPassword("wrong password", legacyForm)).resolves.toBe(false);
    });

    it("hashPassword itself NEVER emits the legacy $ form", async () => {
      const hash = await hashPassword("x");
      expect(hash).not.toContain("$");
    });
  });

  it("a real hash with one character of the hash field flipped: false, not a throw", async () => {
    const hash = await hashPassword("x");
    await expect(verifyPassword("x", flipSafeBase64Char(hash))).resolves.toBe(false);
  });

  it(
    "NOTE (not a bug — documented for a reviewer): scrypt's output is a " +
      "PBKDF2-style expansion, so it is PREFIX-STABLE — deriving at a SHORTER " +
      "keylen reproduces a strict prefix of the longer derivation. Combined " +
      "with verifyPassword deriving at `parsed.hash.length` (the STORED " +
      "hash's own length, not a hardcoded constant — the self-describing- " +
      "format design), a hash truncated from the END still verifies for the " +
      "right password, comparing fewer bytes. Not exploitable here (env vars " +
      "are operator-trusted, not attacker input, and even a hash truncated " +
      "by several characters still leaves far more than 128 bits of margin) " +
      "— pinned so this property is a documented choice, not a surprise.",
    async () => {
      const hash = await hashPassword("x");
      const truncated = hash.slice(0, -8); // still well over 128 bits of hash material
      await expect(verifyPassword("x", truncated)).resolves.toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// Independent security review: two hashes that PARSED successfully but could
// never actually authenticate — a "diagnose reports healthy, login always
// fails, or (worse) login accepts near-any password" false green. Both are
// separate `it`s (not folded into the GARBAGE array above) because both
// build their fixture from a REAL hashPassword() output — borrowing a
// realistic salt/hash rather than a hand-typed literal isolates each test
// to the ONE specific defect it's pinning.
// ---------------------------------------------------------------------------

describe("false-green findings (independent security review)", () => {
  it(
    "N/r/p whose 128*N*r*p lands EXACTLY on SCRYPT_MAXMEM is rejected (>=, not >) — " +
      "Node's scrypt actually THROWS at this exact boundary, so accepting it as " +
      "'readable' would report a permanently-broken hash as healthy",
    async () => {
      const real = await hashPassword("x");
      const [, , , , salt, hash] = real.split(".");
      // 131072 * 16 * 1 = 2^21; 128 * 2^21 = 268435456 = SCRYPT_MAXMEM exactly
      // (double this module's own default r=8 — still a plausible operator typo,
      // not an absurd value).
      const atCeiling = ["scrypt", "131072", "16", "1", salt, hash].join(".");
      expect(isStoredHashReadable(atCeiling)).toBe(false);
      await expect(verifyPassword("x", atCeiling)).resolves.toBe(false);
    },
  );

  it(
    "a hash TRUNCATED to a near-empty hash field (still non-empty, just short) is " +
      "rejected by a minimum decoded length — without this floor it parses as a " +
      "valid 1-byte hash, and ANY password has a 1-in-256 chance of verifying",
    async () => {
      const real = await hashPassword("x");
      const [, n, r, p, salt] = real.split(".");
      const oneByteHash = "AA"; // 2 base64url chars decode to exactly 1 byte
      expect(Buffer.from(oneByteHash, "base64url").length).toBe(1);
      const severelyTruncated = ["scrypt", n, r, p, salt, oneByteHash].join(".");
      expect(isStoredHashReadable(severelyTruncated)).toBe(false);
      await expect(verifyPassword("x", severelyTruncated)).resolves.toBe(false);
      // Not a fluke of THIS password — no password should verify against a
      // hash this module refuses to even attempt.
      await expect(verifyPassword("some other password entirely", severelyTruncated)).resolves.toBe(false);
    },
  );

  it("the floor is exactly 32 bytes — 31 rejected, 32 accepted (boundary pin)", async () => {
    const real = await hashPassword("x");
    const [, n, r, p, salt] = real.split(".");
    // 43 base64url chars decode to 32 bytes exactly (43*6=258 bits -> floor 32 bytes,
    // with 2 leftover bits); 42 chars decode to 31 bytes.
    const hash32 = "A".repeat(43);
    const hash31 = "A".repeat(42);
    expect(Buffer.from(hash32, "base64url").length).toBe(32);
    expect(Buffer.from(hash31, "base64url").length).toBe(31);
    expect(isStoredHashReadable(["scrypt", n, r, p, salt, hash31].join("."))).toBe(false);
    expect(isStoredHashReadable(["scrypt", n, r, p, salt, hash32].join("."))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------------

describe("createSessionCookieValue / verifySessionCookieValue", () => {
  const SECRET = "session-secret-for-tests";

  it("a freshly created cookie verifies, returning {issuedAt, exp} 30 days apart", () => {
    const now = 1_700_000_000_000;
    const cookie = createSessionCookieValue(SECRET, now);
    const payload = verifySessionCookieValue(SECRET, cookie, now);
    expect(payload).toEqual({ issuedAt: now, exp: now + SESSION_DURATION_MS });
  });

  it("valid right up to the expiry instant, invalid one ms past it", () => {
    const now = 1_700_000_000_000;
    const cookie = createSessionCookieValue(SECRET, now);
    const exp = now + SESSION_DURATION_MS;
    expect(verifySessionCookieValue(SECRET, cookie, exp - 1)).not.toBeNull();
    expect(verifySessionCookieValue(SECRET, cookie, exp)).toBeNull(); // `now >= exp`
    expect(verifySessionCookieValue(SECRET, cookie, exp + 1)).toBeNull();
  });

  it("expired: null", () => {
    const now = 1_700_000_000_000;
    const cookie = createSessionCookieValue(SECRET, now);
    expect(verifySessionCookieValue(SECRET, cookie, now + SESSION_DURATION_MS + 1)).toBeNull();
  });

  it("wrong secret: null", () => {
    const cookie = createSessionCookieValue(SECRET, Date.now());
    expect(verifySessionCookieValue("a different secret", cookie)).toBeNull();
  });

  it("tampered payload (bit flipped in the base64url segment): null", () => {
    const cookie = createSessionCookieValue(SECRET, Date.now());
    const [payloadB64, sig] = cookie.split(".");
    expect(verifySessionCookieValue(SECRET, `${flipSafeBase64Char(payloadB64)}.${sig}`)).toBeNull();
  });

  it("tampered signature: null", () => {
    const cookie = createSessionCookieValue(SECRET, Date.now());
    const [payloadB64, sig] = cookie.split(".");
    expect(verifySessionCookieValue(SECRET, `${payloadB64}.${flipSafeBase64Char(sig)}`)).toBeNull();
  });

  it("an attacker-forged payload claiming a far-future exp, signed with the WRONG secret: null", () => {
    // The whole point of signing: you can't just write your own {exp} and
    // ship it without knowing the secret.
    const forgedPayload = Buffer.from(
      JSON.stringify({ issuedAt: Date.now(), exp: Date.now() + 100 * SESSION_DURATION_MS }),
      "utf8",
    ).toString("base64url");
    const forgedSig = Buffer.from("guessed-signature").toString("base64url");
    expect(verifySessionCookieValue(SECRET, `${forgedPayload}.${forgedSig}`)).toBeNull();
  });

  describe("garbage cookie values never throw, always null", () => {
    const GARBAGE = ["", "no-dot-at-all", ".", "a.", ".b", "a.b.c", "🙂.🙃", "   ", "null", "undefined"];
    for (const value of GARBAGE) {
      it(JSON.stringify(value), () => {
        expect(() => verifySessionCookieValue(SECRET, value)).not.toThrow();
        expect(verifySessionCookieValue(SECRET, value)).toBeNull();
      });
    }
  });

  it("a signature of the wrong LENGTH is rejected without throwing (timingSafeEqual would throw on mismatched lengths)", () => {
    const cookie = createSessionCookieValue(SECRET, Date.now());
    const [payloadB64] = cookie.split(".");
    const shortSig = Buffer.from("short").toString("base64url");
    expect(() => verifySessionCookieValue(SECRET, `${payloadB64}.${shortSig}`)).not.toThrow();
    expect(verifySessionCookieValue(SECRET, `${payloadB64}.${shortSig}`)).toBeNull();
  });

  it("a payload that decodes to valid base64url but not JSON: null, no throw", () => {
    const notJson = Buffer.from("not json at all", "utf8").toString("base64url");
    // Sign THIS payload correctly so it's the JSON.parse step that fails,
    // not the signature check — isolates the specific branch.
    const sig = createHmac("sha256", SECRET).update(notJson).digest().toString("base64url");
    expect(verifySessionCookieValue(SECRET, `${notJson}.${sig}`)).toBeNull();
  });

  it("a payload that is valid JSON but not {issuedAt, exp}: null", () => {
    const wrongShape = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8").toString("base64url");
    const sig = createHmac("sha256", SECRET).update(wrongShape).digest().toString("base64url");
    expect(verifySessionCookieValue(SECRET, `${wrongShape}.${sig}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Username comparison (TASK 4) — timing-safe, same discipline as the
// password/cookie checks above; previously shipped without direct coverage.
// ---------------------------------------------------------------------------

describe("verifyUsername", () => {
  it("matching username: true", () => {
    expect(verifyUsername("admin", "admin")).toBe(true);
  });

  it("a different username: false", () => {
    expect(verifyUsername("root", "admin")).toBe(false);
  });

  it("different lengths: false, not a throw (length-checked before timingSafeEqual, which throws on a mismatch)", () => {
    expect(() => verifyUsername("a", "much-longer-name")).not.toThrow();
    expect(verifyUsername("a", "much-longer-name")).toBe(false);
    expect(verifyUsername("much-longer-name", "a")).toBe(false);
  });

  it("case-sensitive (no silent normalization, same rule as the password)", () => {
    expect(verifyUsername("Admin", "admin")).toBe(false);
  });

  it("empty vs non-empty: false", () => {
    expect(verifyUsername("", "admin")).toBe(false);
  });

  it("empty vs empty: true (degenerate but consistent — a same-length, zero-content comparison)", () => {
    expect(verifyUsername("", "")).toBe(true);
  });

  it("multi-byte characters compare by UTF-8 bytes, same posture as sessionSecretByteLength (auth.ts)", () => {
    expect(verifyUsername("é", "é")).toBe(true);
    expect(verifyUsername("é", "e")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// inspectStoredHash (TASK 2b: GET /api/cloud/diagnose support) — read-only
// diagnostics layered on top of parseStoredHash, never used by the actual
// auth path (verifyPassword/isStoredHashReadable) above.
// ---------------------------------------------------------------------------

describe("inspectStoredHash", () => {
  it("undefined (ADMIN_PASSWORD_HASH unset): present false, everything else its neutral default", () => {
    expect(inspectStoredHash(undefined)).toEqual({
      present: false,
      parses: false,
      algorithm: null,
      separator: null,
      looksDotenvMangled: false,
      problem: null,
    });
  });

  it("blank/whitespace-only: treated the same as unset", () => {
    expect(inspectStoredHash("   ").present).toBe(false);
  });

  it("a healthy new-format (dot) hash: present, parses, algorithm scrypt, separator '.', not mangled", async () => {
    const hash = await hashPassword("x");
    expect(inspectStoredHash(hash)).toEqual({
      present: true,
      parses: true,
      algorithm: "scrypt",
      separator: ".",
      looksDotenvMangled: false,
      problem: null,
    });
  });

  it("a healthy legacy ($) hash: present, parses, separator '$', not mangled", async () => {
    const hash = (await hashPassword("x")).replaceAll(".", "$");
    expect(inspectStoredHash(hash)).toEqual({
      present: true,
      parses: true,
      algorithm: "scrypt",
      separator: "$",
      looksDotenvMangled: false,
      problem: null,
    });
  });

  it("the exact dotenv-mangled shape: present, does NOT parse, and is named specifically (not just generic garbage)", () => {
    const mangled = "scrypt31072DB04C5G5r81KlmRt5brOAueGFOewWVkIc9K";
    expect(inspectStoredHash(mangled)).toEqual({
      present: true,
      parses: false,
      algorithm: null,
      separator: null,
      looksDotenvMangled: true,
      problem: "dotenv-mangled",
    });
  });

  it("generic garbage that ISN'T the dotenv-mangled shape: doesn't parse, and looksDotenvMangled stays false (not a catch-all)", () => {
    expect(inspectStoredHash("not a hash at all")).toEqual({
      present: true,
      parses: false,
      algorithm: null,
      separator: null,
      looksDotenvMangled: false,
      problem: expect.any(String),
    });
    // Same algorithm tag, but a `$`/`.`-delimited shape that fails on
    // parameters, not on the "no separators at all" shape looksDotenvMangled
    // specifically detects.
    expect(inspectStoredHash("scrypt$abc$8$1$c2FsdA$aGFzaA").looksDotenvMangled).toBe(false);
  });

  it("a well-formed hash is NEVER flagged as mangled, for either separator (regression guard)", async () => {
    const dotHash = await hashPassword("x");
    expect(inspectStoredHash(dotHash).looksDotenvMangled).toBe(false);
    expect(inspectStoredHash(dotHash.replaceAll(".", "$")).looksDotenvMangled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Structural pin: "verification is not string-===" (brief F, literal)
// ---------------------------------------------------------------------------

describe("verification is not a naive string compare (structural pin)", () => {
  // A pure input/output test can't observe timing directly (flaky by
  // nature, and this codebase has no timing-harness precedent) — what IS
  // reliably checkable is that the IMPLEMENTATION routes both comparisons
  // through node:crypto's constant-time primitive rather than `===`. This
  // guards the exact regression the brief calls out: a future "simplify
  // this" pass swapping timingSafeEqual for `a === b` would still pass
  // every functional test above while reintroducing a timing side-channel
  // — this test is what catches that specific rewrite.
  const source = readFileSync(fileURLToPath(new URL("../session.ts", import.meta.url)), "utf8");

  it("imports timingSafeEqual from node:crypto", () => {
    expect(source).toMatch(/timingSafeEqual/);
    expect(source).toMatch(/from ["']node:crypto["']/);
  });

  it("the password check, the username check, and the cookie signature check all call it (at least three times)", () => {
    const occurrences = source.match(/timingSafeEqual\(/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });

  it("the derived/expected buffers are never compared with a bare === or !==", () => {
    // Loose but effective: neither of the two secret-bearing buffer names
    // this module derives ("derived", the scrypt output; "providedSig"/
    // "expectedSig", the HMAC digests) appears next to a strict-equality
    // operator anywhere in the file.
    expect(source).not.toMatch(/derived\s*===/);
    expect(source).not.toMatch(/providedSig\s*===/);
    expect(source).not.toMatch(/expectedSig\s*===/);
  });
});

describe("classifyStoredHashProblem — naming the copy-paste mistake (prod incident, 2026-08-18)", () => {
  // The diagnose endpoint reported `parses: false, looksDotenvMangled: false`
  // in production and FOUR different mistakes produce exactly that, so the
  // operator still had to guess. Each of these is a real way a value gets
  // corrupted between the generator and a dashboard.
  it("names each mistake distinctly", async () => {
    const good = (await hashPassword("a password long enough")).replaceAll(".", "$");
    expect(classifyStoredHashProblem(`ADMIN_PASSWORD_HASH=${good}`)).toBe("includes-key-prefix");
    expect(classifyStoredHashProblem(good.replaceAll("$", "\\$"))).toBe("backslash-escaped");
    expect(classifyStoredHashProblem(`"${good}"`)).toBe("wrapped-in-quotes");
    expect(classifyStoredHashProblem(`'${good}'`)).toBe("wrapped-in-quotes");
    expect(classifyStoredHashProblem("scrypt31072DB04C5G5r81KlmRt5brOA")).toBe("dotenv-mangled");
    expect(classifyStoredHashProblem("bcrypt.1.2.3.aa.bb")).toBe("unknown-algorithm");
    expect(classifyStoredHashProblem("scrypt.131072.8.1.aa")).toBe("wrong-segment-count");
    expect(classifyStoredHashProblem("scrypt.3.8.1.aa.bb")).toBe("bad-parameters");
  });

  it("a healthy hash of either form reports no problem at all", async () => {
    const dot = await hashPassword("a password long enough");
    expect(inspectStoredHash(dot).problem).toBeNull();
    expect(inspectStoredHash(dot.replaceAll(".", "$")).problem).toBeNull();
  });
});
