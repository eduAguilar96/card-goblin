/**
 * POST /api/cloud/logout (DESIGN.md §7.6, brief B). Always succeeds —
 * clearing a cookie that's already missing/expired/tampered is still "you
 * are now signed out". Deliberately does NOT go through `requireSession`:
 * logout must work even with a stale/invalid cookie (nothing else to do
 * here — "leaves local data intact" per the brief means there's no server
 * state beyond the cookie itself to clean up).
 */
import { NextResponse } from "next/server";
import { withClearedSessionCookie } from "@/lib/cloud/auth";

export async function POST(): Promise<NextResponse> {
  return withClearedSessionCookie(NextResponse.json({ ok: true }));
}
