/**
 * GET /api/cloud/diagnose (DESIGN.md §7.6, TASK 2b — owner-requested: "it
 * just says 401/503" wasn't diagnosable without SSH/dashboard access to the
 * deployment). A non-secret snapshot of exactly which piece of cloud sync's
 * config is missing or broken, answerable from any machine in ten seconds:
 * open this URL, read a handful of booleans, done — no more "is it the
 * hash, the secret, or R2?" guessing from a bare 401/503.
 *
 * DELIBERATELY UNAUTHENTICATED, on purpose, not an oversight — but NOT a
 * blank check either (SECOND independent security review, MEDIUM: an
 * earlier version of this route's own comment overclaimed "doesn't leak
 * anything a 503 doesn't already," which was false for two fields that used
 * to be here and are DELIBERATELY excluded now):
 *
 * - NEVER a secret VALUE, and never a length that narrows one (the one
 *   length-ish fact here, `sessionSecret.meetsMinimumLength`, is a single
 *   pass/fail bool against a PUBLIC floor — auth.ts's
 *   `MIN_SESSION_SECRET_BYTES` — not an actual byte count).
 * - NOT whether `ADMIN_USERNAME` was explicitly set. An earlier version
 *   exposed this as `username.configured`, which is a genuine oracle: for a
 *   deployment that never set it (i.e. is still using the "admin" default —
 *   precisely the deployments this feature exists to protect), an
 *   unauthenticated caller would learn "the username is admin" for free,
 *   defeating the entire point of `ADMIN_USERNAME` (login/route.ts's module
 *   comment). A bare 401 from `/api/cloud/login` does NOT reveal this —
 *   trying "admin" and getting a generic wrong-credentials response either
 *   way tells an attacker nothing. So this field is gone, not just unset.
 * - NOT which separator `ADMIN_PASSWORD_HASH` uses. An earlier version
 *   exposed `adminHash.separator` ("." vs legacy "$"), which is a
 *   HASH-ROTATION TIMING ORACLE: an attacker polling this route could infer
 *   exactly when an operator last regenerated their password (the separator
 *   flips from "$" to "." the moment `npm run hash-password` is re-run),
 *   which correlates with operationally sensitive events (e.g. "the owner
 *   just rotated credentials after noticing something"). Nothing about
 *   `signInFailureMessage`'s dialog copy or the troubleshooting doc needs
 *   this exposed — TASK 1's whole point (both forms verify) already means
 *   an operator never NEEDS to check which one is live.
 *
 * What's left is genuinely the same class of fact an ordinary 503 on
 * `/api/cloud/login` or `/api/cloud/project` already reveals for free ("is
 * this piece configured at all") — this route just answers with the
 * SPECIFIC piece instead of one undifferentiated 503, in one structured
 * shape instead of several separate probes. `Cache-Control: no-store`
 * (below) so no CDN/proxy/browser ever serves a stale answer — this is a
 * live snapshot of `process.env`, and a cached "healthy" response would be
 * actively misleading the moment the underlying config changes.
 *
 * Every field is a pure function of `process.env` at request time (matches
 * r2.ts's `getCloudStorage` — no caching, so a redeploy/env change is
 * reflected on the very next call) — see session.ts's `inspectStoredHash`
 * and r2.ts's `inspectR2ConfigFromEnv` for the actual verdicts; this route
 * wires them into one JSON body and REDACTS the two fields above before
 * responding (`inspectStoredHash` itself still returns `separator` — it's a
 * pure, non-HTTP diagnostic with no opinion on what's safe to expose over
 * the network; this route is where that call gets made).
 */
import { NextResponse } from "next/server";
import { MIN_SESSION_SECRET_BYTES, sessionSecretByteLength } from "@/lib/cloud/auth";
import { inspectStoredHash } from "@/lib/cloud/session";
import { inspectR2ConfigFromEnv } from "@/lib/cloud/r2";

export async function GET(): Promise<NextResponse> {
  const sessionSecretRaw = process.env.SESSION_SECRET?.trim();
  const sessionSecretPresent = !!sessionSecretRaw;
  const sessionSecretMeetsMinimumLength =
    sessionSecretPresent && sessionSecretByteLength(sessionSecretRaw!) >= MIN_SESSION_SECRET_BYTES;

  const adminHashFull = inspectStoredHash(process.env.ADMIN_PASSWORD_HASH);
  // Redact `separator` (module comment: a hash-rotation timing oracle) —
  // deliberately reconstructed field-by-field, not a destructure-and-omit,
  // so a FUTURE field added to StoredHashDiagnostics doesn't silently leak
  // through here by default; adding it to the response requires touching
  // this line on purpose.
  const adminHash = {
    present: adminHashFull.present,
    parses: adminHashFull.parses,
    algorithm: adminHashFull.algorithm,
    looksDotenvMangled: adminHashFull.looksDotenvMangled,
  };

  const r2 = inspectR2ConfigFromEnv();

  const body = {
    // Same three-way split as the six env vars in deployment.md: session
    // secret, admin password hash, and R2 storage are independently
    // configurable pieces, so a summary bool per piece (rather than one
    // flat "configured") is what actually answers "which one is broken."
    configured: {
      r2: r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket,
      session: sessionSecretPresent && sessionSecretMeetsMinimumLength,
      admin: adminHash.present && adminHash.parses,
    },
    adminHash,
    sessionSecret: { present: sessionSecretPresent, meetsMinimumLength: sessionSecretMeetsMinimumLength },
    r2,
    // Deliberately NO `username` field — module comment above.
  };

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
