/**
 * POST /api/cloud/assets/presign (DESIGN.md §7.6). Body `{name, mime, size}`
 * → a presigned PUT URL the browser uploads directly to (brief A's 4.5 MB
 * wall — asset bytes never transit this route).
 *
 * NEVER TRUST THE CLIENT (brief C): every rule the local `assetStore.upload`
 * enforces is re-checked here — with STRICTER cloud-specific versions of the
 * name/mime rules (`isValidCloudAssetName`/`isSupportedCloudImageMime`,
 * projectPayload.ts) — even though the drawer's UI already checked the
 * looser local rules client-side; this route is reachable directly (curl, a
 * compromised/hostile client), not just through the UI.
 *
 * `size` is passed through to `presignPut`, which SIGNS it as the
 * presigned URL's `Content-Length` — a browser `fetch()` can't be told to
 * lie about the true length of the bytes it sends, so an upload of more (or
 * fewer) bytes than declared here fails R2's signature check outright (see
 * r2.ts's `presignPut` doc comment for the fix and why the earlier version
 * of this comment claiming that couldn't be done was wrong).
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/cloud/auth";
import { CLOUD_UNCONFIGURED_MESSAGE, describeCloudStorageFailure, getCloudStorage } from "@/lib/cloud/r2";
import { assetKey, PRESIGN_PUT_TTL_SECONDS } from "@/lib/cloud/keys";
import { isSupportedCloudImageMime, isValidCloudAssetName } from "@/lib/cloud/projectPayload";
import { ASSET_MAX_BYTES } from "@/app/editor/_store/assetStore";
import { isRecord } from "@/app/editor/_store/sheetsPayload";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = requireSession(request);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });

  const storage = getCloudStorage();
  if (storage === null) {
    return NextResponse.json({ error: CLOUD_UNCONFIGURED_MESSAGE }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: "Malformed request." }, { status: 400 });

  const { name, mime, size } = body;
  if (typeof name !== "string" || !isValidCloudAssetName(name)) {
    return NextResponse.json({ error: "Invalid asset name." }, { status: 400 });
  }
  if (typeof mime !== "string" || !isSupportedCloudImageMime(mime)) {
    return NextResponse.json({ error: "Invalid mime type." }, { status: 400 });
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0 || size > ASSET_MAX_BYTES) {
    return NextResponse.json({ error: "Invalid size." }, { status: 400 });
  }

  let url: string;
  try {
    url = await storage.presignPut(assetKey(name), mime, size, PRESIGN_PUT_TTL_SECONDS);
  } catch (error) {
    return NextResponse.json({ error: describeCloudStorageFailure(error) }, { status: 502 });
  }
  return NextResponse.json({ url, expiresIn: PRESIGN_PUT_TTL_SECONDS });
}
