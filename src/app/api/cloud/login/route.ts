/**
 * POST /api/cloud/login (DESIGN.md §7.6, brief B). Body `{username,
 * password}` → `{ok:true}` + a signed session cookie, or a generic 401.
 *
 * USERNAME (FEATURE, on top of the original one-password design): a lone
 * password box advertises "one admin, guess the password" — requiring a
 * username too means a credential-stuffing bot must send two correct
 * fields, and the sign-in FORM itself never announces the account name.
 * Be honest about what this doesn't buy: `ADMIN_USERNAME` defaults to
 * "admin" (auth.ts's `DEFAULT_ADMIN_USERNAME`) and even a custom value is
 * one more fixed string behind the SAME single delay below, not a second
 * password with its own entropy budget — the deployment's real perimeter is
 * still the password's length (scripts/hash-password.mjs's 16-character
 * floor). Compared with `verifyUsername` (session.ts) — timing-safe, same
 * discipline as the password — and checked UNCONDITIONALLY alongside it
 * (below): neither check is allowed to short-circuit the other, so response
 * timing and the response body never reveal WHICH field (username,
 * password, or both) was wrong.
 *
 * MISCONFIGURATION VS. WRONG PASSWORD (independent security review): a
 * `ADMIN_PASSWORD_HASH` that's present but doesn't PARSE (wrong segment
 * count, bad params, or — the common real-world cause — dotenv-expand
 * silently mangling a `$` in `.env.local`, scripts/hash-password.mjs's
 * module comment) used to fail exactly like a wrong password: a 401 that
 * told the operator their own correct password was wrong, forever, with no
 * way to tell it was a server-side mistake. `isStoredHashReadable`
 * (session.ts) is checked FIRST, before any credential is looked at, and
 * answers the SAME 503 shape `loadSessionEnvFromProcess`'s null already
 * uses for missing env — never a 401 — but with its own message naming the
 * likely cause. This check depends only on server config, never on what the
 * caller sent, so there's no per-guess secret it could leak by running
 * unconditionally and immediately (unlike the credential checks below,
 * which both always run, at their own fixed cost, specifically to avoid
 * that).
 *
 * FIXED DELAY, NOT RATE LIMITING: serverless functions share no memory
 * across invocations — a cold start is a fresh process — so an in-process
 * attempt counter/lockout would reset constantly and protect nobody; it
 * would be theatre.
 *
 * WHAT THE DELAY ACTUALLY BUYS (corrected after an independent security
 * review — H1 — flagged the previous wording as false): it throttles a
 * SINGLE connection to roughly one guess every ~500 ms, but it is NOT an
 * aggregate rate limit. N requests fired in PARALLEL each wait out their
 * OWN 500 ms independently, with no shared state to coordinate against —
 * exactly the auto-scaling behavior serverless platforms are built to
 * provide — so an attacker running N parallel connections gets roughly N×
 * the guess throughput of one. It also isn't free for either side: every
 * failed attempt bills ~500 ms plus one real scrypt derivation (up to
 * `SCRYPT_MAXMEM`, session.ts) — a sustained parallel flood costs the
 * attacker real client-side concurrency and costs this deployment real
 * compute against R2's/the host's free tier, which is a cost/availability
 * concern (out of scope for THIS guard) more than a security one. The
 * actual job here is narrower: make a single patient guesser (the
 * realistic threat against a personal tool) too slow to matter, and keep a
 * wrong-credential response indistinguishable-by-timing from the OTHER
 * failure shapes (below). Capping the AGGREGATE guess rate against a
 * determined, parallelized attacker is the password's OWN length's job —
 * see scripts/hash-password.mjs's 16-character floor.
 *
 * The delay applies to EVERY credential-failure path uniformly — wrong
 * username, wrong password, both wrong, malformed body, missing fields —
 * so nothing about the failure's shape is distinguishable by response time.
 * It does NOT apply when auth itself isn't configured or the stored hash is
 * unreadable (503, above) or on success: those aren't guessable outcomes an
 * attacker is probing for.
 *
 * STRUCTURED LOGGING (TASK 2a, owner-requested — "it just says 401" wasn't
 * diagnosable without opening devtools on the CLIENT, which shows nothing
 * about WHY the server said no): every attempt logs exactly one line,
 * `cloud-login: reason=<code>`, to Vercel's function logs. The reason taxonomy
 * mirrors this route's own branches 1:1 (`logLoginAttempt` below) — never
 * the password, the hash, any substring of either, or the username's VALUE,
 * only which of the five known outcomes this attempt was. When BOTH
 * username and password are wrong, this logs `username-mismatch` (checked
 * first) rather than a distinct "both" code — an intentional simplification
 * against the five-code taxonomy the diagnostics brief specifies; it has no
 * bearing on the RESPONSE (still the same 401/message/delay regardless of
 * which check(s) failed — see above).
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_HASH_UNREADABLE_MESSAGE,
  CLOUD_UNCONFIGURED_MESSAGE,
  LOGIN_GENERIC_FAILURE_MESSAGE,
  extractCredentials,
  loadSessionEnvFromProcess,
  withSessionCookie,
} from "@/lib/cloud/auth";
import { isStoredHashReadable, verifyPassword, verifyUsername } from "@/lib/cloud/session";

const FAILURE_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type LoginReasonCode = "no-env" | "hash-unparseable" | "username-mismatch" | "password-mismatch" | "ok";

/** ONE line per attempt (module comment above) — `console.warn` for every
 * non-"ok" reason (so a failure stands out from routine traffic in a log
 * viewer), `console.log` for "ok". A plain string, not a structured object:
 * this is meant to be `grep`-able ("reason=hash-unparseable") in a raw log
 * stream, which a JSON blob is more awkward for at a glance. */
function logLoginAttempt(reason: LoginReasonCode): void {
  const line = `cloud-login: reason=${reason}`;
  if (reason === "ok") console.log(line);
  else console.warn(line);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessionEnv = loadSessionEnvFromProcess();
  if (sessionEnv === null) {
    logLoginAttempt("no-env");
    return NextResponse.json({ error: CLOUD_UNCONFIGURED_MESSAGE }, { status: 503 });
  }
  if (!isStoredHashReadable(sessionEnv.adminPasswordHash)) {
    logLoginAttempt("hash-unparseable");
    return NextResponse.json({ error: ADMIN_HASH_UNREADABLE_MESSAGE }, { status: 503 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Malformed JSON — extractCredentials(null) is {username:"",password:""}, handled uniformly below.
  }
  const { username, password } = extractCredentials(body);

  // Both checks ALWAYS run, unconditionally — never `if (usernameOk)
  // await verifyPassword(...)`. A short-circuit here would let a wrong
  // username skip the (comparatively expensive) scrypt derivation, which is
  // exactly the kind of timing difference the module comment above rules
  // out: the response must not distinguish which field was wrong.
  const usernameOk = verifyUsername(username, sessionEnv.adminUsername);
  const passwordOk = await verifyPassword(password, sessionEnv.adminPasswordHash);
  if (!usernameOk || !passwordOk) {
    logLoginAttempt(usernameOk ? "password-mismatch" : "username-mismatch");
    await delay(FAILURE_DELAY_MS);
    return NextResponse.json({ error: LOGIN_GENERIC_FAILURE_MESSAGE }, { status: 401 });
  }

  logLoginAttempt("ok");
  return withSessionCookie(NextResponse.json({ ok: true }), sessionEnv.sessionSecret);
}
