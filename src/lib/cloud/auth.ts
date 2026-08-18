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
 * spare. */
const MIN_SESSION_SECRET_BYTES = 32;

/** UTF-8 BYTE length, deliberately not `secret.length` (UTF-16 code units):
 * `createHmac` consumes a string key as its UTF-8 byte encoding, so bytes —
 * not code units — is what actually becomes HMAC key material, and is the
 * metric `MIN_SESSION_SECRET_BYTES` is stated in (matching the byte-count
 * every generator command in deployment.md produces). Using `.length`
 * instead would be measuring the wrong unit; env vars are free-form text an
 * operator could paste from anywhere, so this is worth getting exactly
 * right rather than assuming ASCII. */
function sessionSecretByteLength(secret: string): number {
  return new TextEncoder().encode(secret).length;
}

export interface SessionEnv {
  sessionSecret: string;
  adminPasswordHash: string;
}

/**
 * Reads `SESSION_SECRET` + `ADMIN_PASSWORD_HASH`. Blank counts as missing
 * (mirrors r2.ts's loadR2ConfigFromEnv) — auth is a SEPARATE "configured?"
 * question from R2's, so login can 503 independently of storage. A
 * `SESSION_SECRET` present but under `MIN_SESSION_SECRET_BYTES` ALSO reads
 * as "not configured" (M3, review) — failing closed the same way a missing
 * secret does, rather than accepting a dangerously weak one, matches this
 * module's existing posture: every other "is this safe to proceed with"
 * question here already answers with 503, never a degraded-but-running mode.
 */
export function loadSessionEnvFromProcess(
  env: Record<string, string | undefined> = process.env,
): SessionEnv | null {
  const sessionSecret = env.SESSION_SECRET?.trim();
  const adminPasswordHash = env.ADMIN_PASSWORD_HASH?.trim();
  if (!sessionSecret || !adminPasswordHash) return null;
  if (sessionSecretByteLength(sessionSecret) < MIN_SESSION_SECRET_BYTES) return null;
  return { sessionSecret, adminPasswordHash };
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

/** Pull `password` out of an arbitrary JSON body — "" for anything that
 * isn't `{password: string}` (the login route's malformed-body path folds
 * into the same delayed, generic failure a wrong password gets — see
 * login/route.ts's module comment). Lives here (not in the route file)
 * because a route.ts file may only export its HTTP-method handlers — see
 * keys.ts's module comment for the same C1 fix applied to it. */
export function extractPassword(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "password" in body &&
    typeof (body as { password: unknown }).password === "string"
  ) {
    return (body as { password: string }).password;
  }
  return "";
}
