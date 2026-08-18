/**
 * Cloud sync auth crypto (DESIGN.md §7.6, decision ◆45): the pure primitives
 * this feature's auth is built from — scrypt password hashing/verification
 * and an HMAC-signed session cookie — with ZERO knowledge of HTTP, Next.js,
 * cookies, or env vars. That's deliberate (brief-mandated): this is the
 * FIRST code in the project that handles a secret, so the crypto has to be
 * unit-testable without spinning up a request at all — exactly like this
 * codebase's other pure layers (persistence.ts's parse/serialize,
 * assetStore.ts's name/mime rules). The HTTP-facing glue (env vars, cookies,
 * the `requireSession` guard every route shares) lives in auth.ts, which
 * imports these functions rather than duplicating them.
 *
 * FORMAT DECISIONS:
 * - Password hash: `scrypt$N$r$p$salt$hash`, N/r/p decimal, salt/hash
 *   base64url (RFC 4648 §5 — no `+`, `/`, or `=` padding, so nothing in the
 *   encoded parts can collide with the `$` delimiter or need URL-escaping).
 *   Storing N/r/p WITH the hash — not hardcoding them — is the standard
 *   self-describing-hash idiom (bcrypt/argon2 do the same): a future retune
 *   of the cost parameters doesn't invalidate the hash already sitting in
 *   `ADMIN_PASSWORD_HASH`. scripts/hash-password.mjs is a small, deliberate,
 *   plain-JS DUPLICATE of the encode half of this format (Node scripts in
 *   this repo can't import TypeScript — see that script's header comment) —
 *   keep the two in sync by hand, same posture as assetStore.ts's
 *   lexer-rule duplication.
 * - Session cookie: `<base64url(JSON {issuedAt, exp})>.<base64url(HMAC-SHA256(secret, that))>`.
 *   Not encrypted — the payload carries only two timestamps, nothing worth
 *   hiding — only tamper-evident: flipping a bit in `exp` to extend a
 *   session, or forging a payload outright, requires the secret to produce a
 *   signature that verifies.
 *
 * WHY SCRYPT, NOT A DEDICATED PASSWORD-HASHING LIBRARY: node:crypto ships it
 * natively — zero new dependencies for the one password this app will ever
 * hash (§7.6: "one password, no user table", not a multi-tenant user table
 * where bcrypt/argon2's extra knobs would earn their keep).
 */

import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// scrypt cost parameters — mirrored in scripts/hash-password.mjs (module note)
// ---------------------------------------------------------------------------

/** OWASP's 2026 recommendation (N=2^17, r=8, p=1) — raised from this
 * module's original N=2^14 after an independent security review (M2):
 * 2^14 sits below every current OWASP-listed configuration. The
 * self-describing hash format (N/r/p travel WITH the hash) means this bump
 * costs nothing for hashes already sitting in a deployed `ADMIN_PASSWORD_HASH`
 * — they keep verifying at their OWN stored parameters; only hashes minted
 * from here on use the new ones. */
const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/** `128*N*r*p` for the parameters above is 128 MiB — over Node's DEFAULT 32
 * MiB `scrypt` ceiling, so `maxmem` must be raised explicitly (M2) or every
 * derivation throws `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`. Also DOUBLES as the
 * verify-time ceiling (see `parseStoredHash`): a corrupted or hostile
 * `ADMIN_PASSWORD_HASH` claiming an enormous N must be rejected BEFORE ever
 * calling into scrypt, not discovered by actually trying to allocate for it
 * — this one constant is generous enough for this module's own hashes (128
 * MiB, 1x headroom) while still being a real ceiling, not "unlimited". */
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

/** The lowest N a STORED hash may claim and still be trusted at verify time
 * (M2, review) — independent of `SCRYPT_N` above, which only governs what
 * NEW hashes use. Node's own rule ("a power of two greater than one") lets
 * N=2 through, which is a valid power of two but computationally
 * meaningless — this is this module's own floor on top of Node's rule.
 * Matches this module's PREVIOUS default, so no hash this app has ever
 * minted stops verifying. */
const SCRYPT_MIN_N = 16384;

function isValidScryptN(n: number): boolean {
  return Number.isInteger(n) && n >= SCRYPT_MIN_N && (n & (n - 1)) === 0;
}

function scryptDerive(
  password: string,
  salt: Buffer,
  keylen: number,
  N: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, { N, r, p, maxmem: SCRYPT_MAXMEM }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** Hash a password into the self-describing `scrypt$N$r$p$salt$hash` format
 * (module note: mirrored in scripts/hash-password.mjs). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptDerive(password, salt, SCRYPT_KEYLEN, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), derived.toString("base64url")].join(
    "$",
  );
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/**
 * Parse a stored hash string; null on anything malformed OR on parameters
 * this module refuses to even ATTEMPT (M1/M2, review): a non-power-of-two
 * or too-small N (`isValidScryptN`), or N/r/p whose memory requirement
 * would exceed `SCRYPT_MAXMEM`. Both checks run BEFORE `verifyPassword`
 * ever calls into scrypt — a corrupted or hostile `ADMIN_PASSWORD_HASH`
 * (e.g. claiming N=2^30) must be rejected by arithmetic here, not
 * discovered by actually trying to allocate gigabytes and letting Node's
 * own `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` throw. NEVER throws itself — an
 * operator's typo'd `ADMIN_PASSWORD_HASH` must fail every login like a
 * wrong password would, not crash the route.
 */
function parseStoredHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, nText, rText, pText, saltText, hashText] = parts;
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (!Number.isInteger(r) || !Number.isInteger(p) || r <= 0 || p <= 0) return null;
  if (!isValidScryptN(N)) return null;
  if (128 * N * r * p > SCRYPT_MAXMEM) return null;
  // base64url decoding never throws in Node (it's lenient, not validating) —
  // an empty result from garbage input is caught by the length check below.
  const salt = Buffer.from(saltText, "base64url");
  const hash = Buffer.from(hashText, "base64url");
  if (salt.length === 0 || hash.length === 0) return null;
  return { N, r, p, salt, hash };
}

/**
 * Verify a plaintext password against a stored `scrypt$...` hash. NEVER a
 * `===` string compare (brief-mandated, and structurally guarded — see this
 * module's test file): derives a key with the STORED salt/cost parameters,
 * then `timingSafeEqual`s the two buffers. Deriving with `keylen =
 * parsed.hash.length` (rather than the module's own SCRYPT_KEYLEN constant)
 * guarantees the two buffers `timingSafeEqual` compares are ALWAYS the same
 * length by construction — required, since `timingSafeEqual` throws (rather
 * than returning false) on a length mismatch, which a naive implementation
 * could turn into an exception-based oracle. A malformed stored hash fails
 * closed (false), never throws — including if scrypt itself throws (M1,
 * review): `parseStoredHash`'s checks reject every N/r/p this module knows
 * to be unsafe or too expensive BEFORE this point, but scrypt can still
 * fail for reasons those checks can't anticipate, so the derivation itself
 * is wrapped too. A throw here would 500 the whole route AND skip the
 * fixed failure delay — a MISCONFIGURATION ORACLE (timing/status
 * distinguishes "your hash is broken" from "wrong password") — and the
 * client only ever hears "Incorrect password", so a typo'd
 * `ADMIN_PASSWORD_HASH` would read as "your password is wrong" forever
 * with no way to tell it's actually a server-side mistake.
 *
 * RESIDUAL WORTH A REVIEWER'S ATTENTION: Node's scrypt output is a
 * PBKDF2-style expansion, so it is PREFIX-STABLE — deriving at a shorter
 * `keylen` reproduces a strict prefix of a longer derivation at the same
 * password/salt/N/r/p. Combined with deriving at the STORED hash's own
 * length (the line above), a hash accidentally truncated from the end still
 * verifies for the right password, comparing fewer bytes than intended.
 * Judged not exploitable: `ADMIN_PASSWORD_HASH` is operator-set env-var
 * input, not attacker-controlled, and SCRYPT_KEYLEN=64 leaves enormous
 * margin even truncated. Pinned as a deliberate, documented property in
 * session.test.ts rather than left to be rediscovered as a surprise.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (parsed === null) return false;
  let derived: Buffer;
  try {
    derived = await scryptDerive(password, parsed.salt, parsed.hash.length, parsed.N, parsed.r, parsed.p);
  } catch {
    return false;
  }
  if (derived.length !== parsed.hash.length) return false; // unreachable; see doc comment
  return timingSafeEqual(derived, parsed.hash);
}

// ---------------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------------

/** 30 days (§7.6, brief B). */
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  /** Epoch ms. */
  issuedAt: number;
  /** Epoch ms. */
  exp: number;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { issuedAt: unknown }).issuedAt === "number" &&
    typeof (value as { exp: unknown }).exp === "number" &&
    Number.isFinite((value as SessionPayload).issuedAt) &&
    Number.isFinite((value as SessionPayload).exp)
  );
}

function signPayload(secret: string, payloadB64: string): Buffer {
  return createHmac("sha256", secret).update(payloadB64).digest();
}

/** Build a fresh, signed session cookie VALUE (not the `Set-Cookie` header —
 * that's auth.ts's job, since cookie attributes are an HTTP concern). `now`
 * is injectable for tests; defaults to the real clock. */
export function createSessionCookieValue(secret: string, now: number = Date.now()): string {
  const payload: SessionPayload = { issuedAt: now, exp: now + SESSION_DURATION_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signPayload(secret, payloadB64).toString("base64url");
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a session cookie value: tamper-evident (HMAC, timing-safe) AND
 * time-bound (`exp`). Returns the payload when valid, null otherwise —
 * malformed / wrong-secret / tampered / expired all collapse to the same
 * null, because a caller only ever needs "valid or not," never why (the
 * brief's four failure modes all degrade identically on the client side
 * too). `now` is injectable for tests (expiry).
 */
export function verifySessionCookieValue(
  secret: string,
  cookieValue: string,
  now: number = Date.now(),
): SessionPayload | null {
  const dot = cookieValue.indexOf(".");
  if (dot < 0) return null;
  const payloadB64 = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);

  const providedSig = Buffer.from(sig, "base64url");
  const expectedSig = signPayload(secret, payloadB64);
  // Length-check BEFORE timingSafeEqual (which throws on mismatched
  // lengths): the length of a well-formed signature is fixed (32-byte
  // HMAC-SHA256 digest) and public knowledge, so this check itself leaks
  // nothing beyond "malformed" vs "not" — the same guard Node's own docs
  // recommend for this exact function.
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isSessionPayload(payload)) return null;
  if (now >= payload.exp) return null;
  return payload;
}
