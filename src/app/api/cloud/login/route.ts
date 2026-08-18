/**
 * POST /api/cloud/login (DESIGN.md §7.6, brief B). Body `{password}` →
 * `{ok:true}` + a signed session cookie, or a generic 401.
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
 * wrong-password response indistinguishable-by-timing from the OTHER
 * failure shapes (below). Capping the AGGREGATE guess rate against a
 * determined, parallelized attacker is the password's OWN length's job —
 * see scripts/hash-password.mjs's 16-character floor.
 *
 * The delay applies to EVERY failure path uniformly — wrong password,
 * malformed body, missing `password` field — so nothing about the failure's
 * shape is distinguishable by response time. It does NOT apply when auth
 * itself isn't configured (503) or on success: those aren't guessable
 * outcomes an attacker is probing for.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  CLOUD_UNCONFIGURED_MESSAGE,
  extractPassword,
  loadSessionEnvFromProcess,
  withSessionCookie,
} from "@/lib/cloud/auth";
import { verifyPassword } from "@/lib/cloud/session";

const FAILURE_DELAY_MS = 500;
const GENERIC_FAILURE_MESSAGE = "Incorrect password.";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessionEnv = loadSessionEnvFromProcess();
  if (sessionEnv === null) {
    return NextResponse.json({ error: CLOUD_UNCONFIGURED_MESSAGE }, { status: 503 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Malformed JSON — extractPassword(null) is "", handled uniformly below.
  }
  const password = extractPassword(body);

  const ok = await verifyPassword(password, sessionEnv.adminPasswordHash);
  if (!ok) {
    await delay(FAILURE_DELAY_MS);
    return NextResponse.json({ error: GENERIC_FAILURE_MESSAGE }, { status: 401 });
  }

  return withSessionCookie(NextResponse.json({ ok: true }), sessionEnv.sessionSecret);
}
