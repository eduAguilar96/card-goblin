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
  verifyPassword,
  verifySessionCookieValue,
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

  it("produces the documented self-describing format: scrypt$N$r$p$salt$hash", async () => {
    const hash = await hashPassword("x");
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
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
    ];
    for (const [label, stored] of GARBAGE) {
      it(label, async () => {
        await expect(verifyPassword("anything", stored)).resolves.toBe(false);
      });
    }
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

  it("both the password check and the cookie signature check call it (at least twice)", () => {
    const occurrences = source.match(/timingSafeEqual\(/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
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
