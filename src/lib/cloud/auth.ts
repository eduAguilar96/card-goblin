/**
 * HTTP-facing session glue (DESIGN.md §7.6): wires session.ts's pure crypto
 * to env vars, cookies, and Next.js's Request/Response types. Kept SEPARATE
 * from session.ts on purpose — the brief requires the crypto itself to be
 * unit-testable WITHOUT HTTP; this file is the thin layer every /api/cloud
 * route shares on top of it, exercised through the route tests rather than
 * in isolation.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createSessionCookieValue, verifySessionCookieValue } from "@/lib/cloud/session";
import { CLOUD_UNCONFIGURED_MESSAGE } from "@/lib/cloud/r2";

export { CLOUD_UNCONFIGURED_MESSAGE };

/**
 * The login route's OTHER 503 (independent security review): distinct from
 * `CLOUD_UNCONFIGURED_MESSAGE`, which means "the env vars aren't set at
 * all." This one means they ARE set, but `ADMIN_PASSWORD_HASH` doesn't
 * parse — historically almost always the dotenv-expand `$` footgun
 * (session.ts's module comment has the full mechanism: a bare `$` in a
 * `.env.local` VALUE reads as a variable reference), which silently
 * truncated/mangled a `$`-separated hash with no error at load time. Before
 * TASK 1's dot-separated format, that failure mode was INDISTINGUISHABLE
 * from a wrong password (a 401, forever, however carefully the real
 * password was typed) — same 503 SHAPE as `CLOUD_UNCONFIGURED_MESSAGE`
 * (status + a plain `{error}` body, never a 401), but its own wording,
 * because the fix is different (regenerate the hash, not "type the password
 * again"). The dot format needs no escaping anywhere, so a hash minted by
 * the CURRENT `npm run hash-password` can no longer land here via this
 * route — this message (and `GET /api/cloud/diagnose`'s
 * `looksDotenvMangled`) exist for a hash that's stale, hand-edited, or
 * otherwise just malformed. Never includes any part of the actual hash.
 */
export const ADMIN_HASH_UNREADABLE_MESSAGE =
  "The stored password hash is unreadable — regenerate it with `npm run hash-password` and " +
  "update ADMIN_PASSWORD_HASH, or check GET /api/cloud/diagnose for exactly what's wrong " +
  "with the current one.";

/** The login route's single 401 body (TASK 4: shared verbatim by a wrong
 * username, a wrong password, and both wrong — see that route's module
 * comment) — exported here, not defined in route.ts, because a Next.js
 * route.ts file may only export HTTP-method handlers (same C1 fix as
 * `extractCredentials` below), and routes.test.ts asserts against this
 * exact string rather than a duplicated literal. */
export const LOGIN_GENERIC_FAILURE_MESSAGE = "Incorrect username or password.";

/**
 * `__Host-` prefixed (L7, review): browsers REFUSE to even set a cookie
 * named `__Host-*` unless it carries `Secure`, `Path=/`, and no `Domain`
 * attribute — all three already true of this cookie (`withSessionCookie`
 * below), so the prefix costs nothing and turns "we didn't weaken the
 * attributes" from a code-review invariant into one the browser itself
 * enforces — a future edit that dropped `Secure` or added a `Domain` would
 * make the cookie silently fail to be set at all, not quietly less safe.
 */
export const SESSION_COOKIE_NAME = "__Host-cardgoblin_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days (§7.6) — mirrors session.ts's SESSION_DURATION_MS

/** M3 (independent security review): a `SESSION_SECRET` shorter than this
 * signs cookies with an HMAC key weak enough to be brute-forced — a 1-char
 * secret was accepted at ANY length before this fix. 32 BYTES (not
 * characters — see `sessionSecretByteLength`) matches this module's own
 * `openssl rand -base64 32` / `randomBytes(32)` guidance in deployment.md,
 * so a secret generated the documented way always clears it with room to
 * spare. Exported (TASK 2b) so `GET /api/cloud/diagnose` can report
 * `meetsMinimumLength` against the SAME floor this module enforces, rather
 * than a second hardcoded `32` drifting out of sync with this one. */
export const MIN_SESSION_SECRET_BYTES = 32;

/** UTF-8 BYTE length, deliberately not `secret.length` (UTF-16 code units):
 * `createHmac` consumes a string key as its UTF-8 byte encoding, so bytes —
 * not code units — is what actually becomes HMAC key material, and is the
 * metric `MIN_SESSION_SECRET_BYTES` is stated in (matching the byte-count
 * every generator command in deployment.md produces). Using `.length`
 * instead would be measuring the wrong unit; env vars are free-form text an
 * operator could paste from anywhere, so this is worth getting exactly
 * right rather than assuming ASCII. Exported for the same reason as
 * `MIN_SESSION_SECRET_BYTES` above (`GET /api/cloud/diagnose`). */
export function sessionSecretByteLength(secret: string): number {
  return new TextEncoder().encode(secret).length;
}

/** The sign-in username when `ADMIN_USERNAME` is unset/blank (FEATURE: a
 * lone password box advertises "one admin, guess the password" — requiring
 * a username too, even a well-known default one, means a credential-
 * stuffing bot must submit two correct fields instead of one, and the
 * sign-in form itself never announces the account name to anyone who loads
 * the page). Deliberately NOT a secret and NOT a second entropy source — see
 * login/route.ts's module comment for the honest accounting of what this
 * does and doesn't buy. Keeping the DEFAULT working out of the box (rather
 * than requiring `ADMIN_USERNAME` alongside `ADMIN_PASSWORD_HASH`/
 * `SESSION_SECRET`) matches this module's existing rule that only the
 * genuinely REQUIRED vars gate "is cloud sync configured" — see
 * `loadSessionEnvFromProcess` below, which never fails closed over this
 * one. */
export const DEFAULT_ADMIN_USERNAME = "admin";

export interface SessionEnv {
  sessionSecret: string;
  adminPasswordHash: string;
  /** `ADMIN_USERNAME`, trimmed, or `DEFAULT_ADMIN_USERNAME` when unset/blank
   * — always a real string, never itself a reason this is null. */
  adminUsername: string;
}

/**
 * Reads `SESSION_SECRET` + `ADMIN_PASSWORD_HASH` (+ optional
 * `ADMIN_USERNAME`). Blank counts as missing (mirrors r2.ts's
 * loadR2ConfigFromEnv) — auth is a SEPARATE "configured?" question from
 * R2's, so login can 503 independently of storage. A `SESSION_SECRET`
 * present but under `MIN_SESSION_SECRET_BYTES` ALSO reads as "not
 * configured" (M3, review) — failing closed the same way a missing secret
 * does, rather than accepting a dangerously weak one, matches this module's
 * existing posture: every other "is this safe to proceed with" question
 * here already answers with 503, never a degraded-but-running mode.
 * `ADMIN_USERNAME` is exempt from that posture ON PURPOSE: it's optional
 * with a working default, so its absence is never a reason to 503 — only
 * `sessionSecret`/`adminPasswordHash` gate this function's null return.
 * Whether the STORED password hash itself is well-formed is a separate
 * question this function does not answer — see session.ts's
 * `isStoredHashReadable`, which the login route checks on its own.
 */
export function loadSessionEnvFromProcess(
  env: Record<string, string | undefined> = process.env,
): SessionEnv | null {
  const sessionSecret = env.SESSION_SECRET?.trim();
  const adminPasswordHash = env.ADMIN_PASSWORD_HASH?.trim();
  if (!sessionSecret || !adminPasswordHash) return null;
  if (sessionSecretByteLength(sessionSecret) < MIN_SESSION_SECRET_BYTES) return null;
  const adminUsername = env.ADMIN_USERNAME?.trim() || DEFAULT_ADMIN_USERNAME;
  return { sessionSecret, adminPasswordHash, adminUsername };
}

export type SessionCheck = { ok: true } | { ok: false; status: 401 | 503; error: string };

/**
 * The guard every route but login/logout uses (logout must work even
 * without a valid session — see that route). 503 when auth itself has no
 * env to check against; 401 for a missing/invalid/expired cookie — the two
 * are deliberately distinguishable so the client can tell "nothing is set
 * up here" from "you need to sign in", even though both fold into the same
 * quiet local-only degradation in the UI (brief D).
 */
export function requireSession(
  request: NextRequest,
  env: Record<string, string | undefined> = process.env,
): SessionCheck {
  const sessionEnv = loadSessionEnvFromProcess(env);
  if (sessionEnv === null) return { ok: false, status: 503, error: CLOUD_UNCONFIGURED_MESSAGE };

  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookie === undefined) return { ok: false, status: 401, error: "Not signed in." };

  const payload = verifySessionCookieValue(sessionEnv.sessionSecret, cookie);
  if (payload === null) return { ok: false, status: 401, error: "Session expired or invalid." };
  return { ok: true };
}

/** The ONE place cookie attributes are declared (brief B: httpOnly; Secure;
 * SameSite=Lax; Path=/; 30 days). `Secure` is unconditional, including in
 * local dev — `http://localhost` is treated as a secure context by modern
 * browsers, so this never needs weakening (CLAUDE.md: never weaken a guard). */
export function withSessionCookie(response: NextResponse, secret: string): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, createSessionCookieValue(secret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

/** Same attributes as `withSessionCookie` (a `Set-Cookie` that doesn't match
 * path/sameSite/etc. of the original silently fails to clear it in some
 * browsers), empty value, immediate expiry. */
export function withClearedSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

/** "" for anything that isn't a string at `body[key]` — the shared shape
 * both fields of `extractCredentials` fall back to. */
function stringField(body: unknown, key: string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    key in body &&
    typeof (body as Record<string, unknown>)[key] === "string"
  ) {
    return (body as Record<string, string>)[key];
  }
  return "";
}

/** Pull `{username, password}` out of an arbitrary JSON body — each field
 * independently "" when absent or non-string (the login route's malformed-
 * body path folds into the same delayed, generic failure a wrong
 * username/password gets — see login/route.ts's module comment). Neither
 * field is trimmed: exact, case-sensitive matching, same "no silent
 * normalization" rule `verifyPassword` already documents for the password
 * half. Lives here (not in the route file) because a route.ts file may only
 * export its HTTP-method handlers — see keys.ts's module comment for the
 * same C1 fix applied to it. */
export function extractCredentials(body: unknown): LoginCredentials {
  return { username: stringField(body, "username"), password: stringField(body, "password") };
}
