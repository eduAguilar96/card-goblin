/**
 * Cloud sync auth crypto (DESIGN.md §7.6, decision ◆45): the pure primitives
 * this feature's auth is built from — scrypt password hashing/verification, a
 * timing-safe username comparison, and an HMAC-signed session cookie — with
 * ZERO knowledge of HTTP, Next.js, cookies, or env vars. That's deliberate
 * (brief-mandated): this is the
 * FIRST code in the project that handles a secret, so the crypto has to be
 * unit-testable without spinning up a request at all — exactly like this
 * codebase's other pure layers (persistence.ts's parse/serialize,
 * assetStore.ts's name/mime rules). The HTTP-facing glue (env vars, cookies,
 * the `requireSession` guard every route shares) lives in auth.ts, which
 * imports these functions rather than duplicating them.
 *
 * FORMAT DECISIONS:
 * - Password hash: `scrypt.N.r.p.salt.hash` — DOT-separated (owner
 *   directive, post-mortem on a real deployment failure): Next's env loader
 *   runs dotenv-expand on `.env.local`, which treats a bare `$` in a VALUE
 *   as a variable reference (`$131072` reads as "expand var 131072"), so the
 *   original `scrypt$N$r$p$salt$hash` format silently corrupted itself on
 *   load with no error — see scripts/hash-password.mjs's module comment for
 *   the full mechanism. Escaping every `$` as `\$` technically survived
 *   dotenv-expand, but the owner rejected that fix as too fragile (one
 *   un-escaped `$` — a hand-edit, a copy-paste into a fresh file — silently
 *   reintroduces the bug with no error at load time either). The `.`
 *   separator sidesteps the whole class of bug: dotenv-expand never treats
 *   `.` as special, so this format needs no escaping or quoting ANYWHERE
 *   (`.env.local`, Vercel's dashboard, a shell export). N/r/p decimal,
 *   salt/hash base64url (RFC 4648 §5 — no `+`, `/`, or `=` padding) — that
 *   alphabet contains neither `.` nor `$`, so splitting on either delimiter
 *   stays unambiguous. Storing N/r/p WITH the hash — not hardcoding them —
 *   is the standard self-describing-hash idiom (bcrypt/argon2 do the same):
 *   a future retune of the cost parameters doesn't invalidate the hash
 *   already sitting in `ADMIN_PASSWORD_HASH`.
 * - LEGACY `$`-SEPARATED FORM STILL ACCEPTED (never emitted): `parseStoredHash`
 *   below parses EITHER separator — a hash minted before this change (or a
 *   correctly `\$`-escaped one already deployed) keeps verifying with no
 *   forced re-hash and no broken window between deploying this code and
 *   regenerating the hash, in either order. `hashPassword` only ever OUTPUTS
 *   the new `.` form; nothing in this codebase writes a `$` form anymore.
 *   The two are told apart by content, not a version flag: a well-formed
 *   hash of EITHER form never contains the other form's delimiter (base64url
 *   excludes both), so "does the string contain a literal `$`" is an
 *   unambiguous test for "attempt to parse as the legacy form." See
 *   `inspectStoredHash` for the read-only diagnostics `GET
 *   /api/cloud/diagnose` (auth.ts) exposes on top of this — including
 *   `looksDotenvMangled`, which recognizes the specific corrupted shape
 *   above (`scrypt<digits>`, no separators left at all) so that failure mode
 *   is named instead of just failing closed like any other garbage input.
 *   scripts/hash-password.mjs is a small, deliberate, plain-JS DUPLICATE of
 *   the encode half of this format (Node scripts in this repo can't import
 *   TypeScript — see that script's header comment) — keep the two in sync by
 *   hand, same posture as assetStore.ts's lexer-rule duplication.
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

/**
 * The shortest decoded HASH a stored value may claim and still be trusted
 * (independent security review, false-green finding): without this floor, a
 * hash truncated to just 2 base64url characters decodes to a single byte —
 * `parseStoredHash` accepted it (only `=== 0` was rejected), so `verifyPassword`
 * would derive 1 byte and `timingSafeEqual` a 1-byte comparison, which ANY
 * password has a 1-in-256 chance of matching. With no aggregate rate limit
 * beyond the login route's fixed per-attempt delay (that route's own doc
 * comment), a 1-in-256 oracle is brute-forceable in well under a minute of
 * parallel requests — this is a REAL vulnerability class, not a theoretical
 * one. 32 bytes (256 bits) is half this module's own `SCRYPT_KEYLEN` (64),
 * chosen as a floor generous enough that no hash this module has ever
 * minted comes remotely close to it, while still being far past the point
 * where a comparison becomes guessable. Also closes the "RESIDUAL" note on
 * `verifyPassword` below: severe truncation is now rejected outright rather
 * than merely "probably fine in practice."
 */
const MIN_HASH_BYTES = 32;

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

/** Hash a password into the self-describing `scrypt.N.r.p.salt.hash` format
 * (module note: mirrored in scripts/hash-password.mjs). Only ever emits the
 * `.`-separated form — the legacy `$` form is accepted on READ
 * (`parseStoredHash` below) but never produced here. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptDerive(password, salt, SCRYPT_KEYLEN, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), derived.toString("base64url")].join(
    ".",
  );
}

/** Which delimiter a stored hash actually used — surfaced only for
 * diagnostics (`inspectStoredHash` below); `verifyPassword` itself doesn't
 * care which one it was. */
export type StoredHashSeparator = "." | "$";

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
  separator: StoredHashSeparator;
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
 *
 * ACCEPTS BOTH SEPARATORS (module note above): tries `$` first when the
 * string contains one at all, else `.` — never ambiguous, because a
 * well-formed hash of either form never contains the OTHER form's
 * delimiter (base64url's alphabet has neither character), so "contains a
 * literal `$`" cleanly means "attempt the legacy shape," full stop.
 *
 * `>= SCRYPT_MAXMEM`, NOT `>` (independent security review, false-green
 * finding): a hash claiming N/r/p whose naive `128*N*r*p` lands EXACTLY on
 * the ceiling (e.g. N=131072, r=16, p=1 — double this module's own default
 * r) used to pass this check, but Node's actual scrypt implementation needs
 * a bit more working memory than the simplified formula accounts for, so
 * `scryptDerive` (below, in `verifyPassword`) throws for real at exactly
 * that boundary — every single verification attempt, forever, regardless of
 * password. Before this fix that read as a PERMANENT wrong-password 401
 * (the throw is caught and folded into `false`) while `isStoredHashReadable`
 * — and `GET /api/cloud/diagnose` — reported the hash as perfectly healthy:
 * exactly the "server is broken but says it isn't" gap this module exists
 * to close. Rejecting the exact boundary, not just values past it, costs
 * this module's own hashes nothing (128 MiB, half the 256 MiB ceiling —
 * `SCRYPT_MAXMEM`'s doc comment) while refusing to even ATTEMPT a
 * parameter combination this module can't actually honor.
 */
function parseStoredHash(stored: string): ParsedHash | null {
  const separator: StoredHashSeparator = stored.includes("$") ? "$" : ".";
  const parts = stored.split(separator);
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, nText, rText, pText, saltText, hashText] = parts;
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (!Number.isInteger(r) || !Number.isInteger(p) || r <= 0 || p <= 0) return null;
  if (!isValidScryptN(N)) return null;
  if (128 * N * r * p >= SCRYPT_MAXMEM) return null;
  // base64url decoding never throws in Node (it's lenient, not validating) —
  // an empty result from garbage input is caught by the length check below.
  // Salt has no minimum here (only "not empty") — MIN_HASH_BYTES (above) is
  // the one that closes the actual guessable-oracle gap; see its own comment.
  const salt = Buffer.from(saltText, "base64url");
  const hash = Buffer.from(hashText, "base64url");
  if (salt.length === 0 || hash.length < MIN_HASH_BYTES) return null;
  return { N, r, p, salt, hash, separator };
}

/**
 * Verify a plaintext password against a stored `scrypt....` hash (or the
 * legacy `scrypt$...` form — `parseStoredHash` accepts both; module note atop
 * this file). NEVER a `===` string compare (brief-mandated, and structurally guarded — see this
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
 * distinguishes "your hash is broken" from "wrong password"). This `false`
 * is now a DEFENSE-IN-DEPTH backstop, not the primary way a bad hash gets
 * noticed: the login route calls `isStoredHashReadable` (below) FIRST and
 * answers 503 for anything `parseStoredHash` would reject, so an operator's
 * mangled/truncated `ADMIN_PASSWORD_HASH` (the dotenv-expand `$` footgun —
 * scripts/hash-password.mjs) no longer reads as "your password is wrong"
 * forever. What still lands here — and still MUST fail closed rather than
 * throw — is a hash that parses fine but whose scrypt derivation fails for
 * some reason `parseStoredHash`'s own checks can't anticipate (see
 * sessionScryptFailure.test.ts).
 *
 * RESIDUAL WORTH A REVIEWER'S ATTENTION: Node's scrypt output is a
 * PBKDF2-style expansion, so it is PREFIX-STABLE — deriving at a shorter
 * `keylen` reproduces a strict prefix of a longer derivation at the same
 * password/salt/N/r/p. Combined with deriving at the STORED hash's own
 * length (the line above), a hash accidentally truncated from the end still
 * verifies for the right password, comparing fewer bytes than intended. NO
 * LONGER "probably fine in practice" for a SEVERE truncation, since a
 * security review found exactly that case exploitable — `parseStoredHash`'s
 * `MIN_HASH_BYTES` floor (above) now rejects anything under 32 bytes
 * outright, closing the low-entropy-comparison gap structurally rather than
 * leaving it to "an attacker probably won't have a truncated hash to try."
 * A truncation that still clears 32 bytes remains judged not exploitable:
 * `ADMIN_PASSWORD_HASH` is operator-set env-var input, not
 * attacker-controlled, and 32+ bytes is still enormous margin. Pinned as a
 * deliberate, documented property in session.test.ts rather than left to be
 * rediscovered as a surprise.
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

/**
 * Whether a stored `ADMIN_PASSWORD_HASH` string is well-formed enough for
 * `verifyPassword` to even ATTEMPT verification against — i.e., exactly the
 * condition under which `parseStoredHash` would reject it. A SEPARATE named
 * export from `verifyPassword`'s own fail-closed `false` (independent
 * security review, the dotenv-expand `$` footgun): the login route calls
 * THIS first and answers 503 ("misconfigured", never a 401) when it's
 * false, so a mangled/truncated/malformed hash stops masquerading as a
 * correct server + wrong password. Does not weaken `verifyPassword`'s own
 * contract — that function still independently fails closed on the same
 * input, as a backstop (see its doc comment). Never throws (same posture as
 * `parseStoredHash`): this runs before any password is checked, so it must
 * be as trustworthy as the hash-shape validation it wraps.
 */
export function isStoredHashReadable(stored: string): boolean {
  return parseStoredHash(stored) !== null;
}

// ---------------------------------------------------------------------------
// Read-only diagnostics (GET /api/cloud/diagnose, TASK 2b) — never used by
// the actual auth path above; a separate reporting layer on top of it.
// ---------------------------------------------------------------------------

export interface StoredHashDiagnostics {
  /** `ADMIN_PASSWORD_HASH` is set to a non-blank value at all. */
  present: boolean;
  /** Exactly `isStoredHashReadable`'s answer — repeated here so one payload
   * carries both the verdict and the detail explaining it. */
  parses: boolean;
  /** `"scrypt"` when `parses`; null otherwise — this module supports no
   * other algorithm, so today this is a constant, kept as a field (rather
   * than a bare boolean) so a future second algorithm doesn't need a
   * payload-shape change. */
  algorithm: "scrypt" | null;
  /** Which delimiter parsed, when `parses`; null otherwise. */
  separator: StoredHashSeparator | null;
  /** True when the string looks like the SPECIFIC dotenv-expand corruption
   * (module note atop this file) rather than generic garbage — see
   * `looksDotenvMangledShape` below for the exact test. Only meaningful
   * when `parses` is false (a well-formed hash of either separator can
   * never match this shape — see that function's own comment). */
  looksDotenvMangled: boolean;
  /** WHY it doesn't parse, structurally — null when it does. Names the
   * copy-paste mistakes that all produce an identical "parses: false"
   * signature, so an operator gets an answer instead of four suspects. */
  problem: StoredHashProblem | null;
}

/**
 * The corrupted shape dotenv-expand leaves behind (module note atop this
 * file): `scrypt$131072$8$1$<salt>$<hash>` loses every `$` to variable
 * expansion, collapsing to `scrypt31072<mangled remainder>` — algorithm tag
 * immediately followed by digits, with NEITHER delimiter surviving anywhere
 * in the string. That absence of separators is the tell: a well-formed hash
 * of EITHER format always contains at least one `.` or `$` (five delimiters
 * between six fields), so a `scrypt`-prefixed string with zero of either is
 * never a hash this module could have produced or accepted — it's
 * specifically the shape THIS ONE failure mode leaves behind, which is what
 * makes it worth naming instead of lumping it into generic "doesn't parse."
 */
function looksDotenvMangledShape(value: string): boolean {
  return /^scrypt\d/.test(value) && !value.includes(".") && !value.includes("$");
}

/**
 * WHY a present hash doesn't parse — the field that turns "parses: false"
 * into an actionable answer. Added after a real production incident: the
 * diagnose endpoint correctly reported an unparseable hash, but four
 * different copy-paste mistakes produce that identical signature, so the
 * operator still had to guess. Every branch below names a mistake someone
 * actually makes when moving a value into a dashboard or a .env file.
 *
 * Deliberately structural only — it describes the SHAPE of the value, never
 * its content, so it stays safe on the unauthenticated diagnose route.
 */
export type StoredHashProblem =
  | "dotenv-mangled"
  | "includes-key-prefix"
  | "backslash-escaped"
  | "wrapped-in-quotes"
  | "unknown-algorithm"
  | "wrong-segment-count"
  | "bad-parameters"
  | "unrecognized";

export function classifyStoredHashProblem(trimmed: string): StoredHashProblem {
  if (looksDotenvMangledShape(trimmed)) return "dotenv-mangled";
  if (/^ADMIN_PASSWORD_HASH\s*=/.test(trimmed)) return "includes-key-prefix";
  if (trimmed.includes("\\")) return "backslash-escaped";
  if (/^["'].*["']$/.test(trimmed)) return "wrapped-in-quotes";

  const separator = trimmed.includes("$") ? "$" : ".";
  const parts = trimmed.split(separator);
  if (parts[0] !== "scrypt") return "unknown-algorithm";
  if (parts.length !== 6) return "wrong-segment-count";
  return "bad-parameters";
}

/**
 * Non-secret diagnostics for `ADMIN_PASSWORD_HASH` — what `GET
 * /api/cloud/diagnose` reports (auth.ts wires the route; this module owns
 * the verdict since it's the only place that understands the format).
 * Deliberately returns no part of `stored` itself, only facts ABOUT its
 * shape — safe to expose on an unauthenticated route (that route's own doc
 * comment has the full reasoning). Takes the raw env value directly
 * (`| undefined`, mirroring `process.env.ADMIN_PASSWORD_HASH`'s own type) so
 * the route can hand this function its input unmodified.
 */
export function inspectStoredHash(stored: string | undefined): StoredHashDiagnostics {
  const trimmed = stored?.trim();
  if (!trimmed) {
    return { present: false, parses: false, algorithm: null, separator: null, looksDotenvMangled: false, problem: null };
  }
  const parsed = parseStoredHash(trimmed);
  return {
    present: true,
    parses: parsed !== null,
    algorithm: parsed !== null ? "scrypt" : null,
    separator: parsed !== null ? parsed.separator : null,
    looksDotenvMangled: parsed === null && looksDotenvMangledShape(trimmed),
    problem: parsed === null ? classifyStoredHashProblem(trimmed) : null,
  };
}

// ---------------------------------------------------------------------------
// Username comparison
// ---------------------------------------------------------------------------

/**
 * Timing-safe username comparison — the FEATURE that turns the single admin
 * password into a username+password pair (DESIGN.md §7.6). Same discipline
 * as `verifyPassword`: the login route must not let response TIMING reveal
 * which credential (username, password, or both) was wrong, so this is
 * `timingSafeEqual`, never `===`, exactly like the password check and the
 * session-cookie signature check above. Length-checked BEFORE
 * `timingSafeEqual` (which THROWS on a length mismatch) rather than
 * catching a throw — mirrors `verifySessionCookieValue`'s signature-length
 * guard: the length of what someone TYPED is not secret material the way
 * its CONTENT is, so this short-circuit leaks nothing beyond "different
 * length", the same posture already established for that comparison. No
 * hashing here (unlike the password) — a username is not treated as
 * secret-at-rest, only compared at-request, so a plain constant-time byte
 * comparison is the right amount of ceremony, not scrypt.
 */
export function verifyUsername(candidate: string, expected: string): boolean {
  const candidateBuf = Buffer.from(candidate, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (candidateBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(candidateBuf, expectedBuf);
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
