/**
 * GET/DELETE /api/cloud/assets/[name] (DESIGN.md §7.6).
 * - GET → a short-lived presigned GET URL (the browser downloads directly).
 * - DELETE → removes the object; idempotent (deleting an absent name is
 *   still success — mirrors S3-compatible DELETE semantics, r2.ts's
 *   `deleteObject` doc comment).
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/cloud/auth";
import { CLOUD_UNCONFIGURED_MESSAGE, getCloudStorage } from "@/lib/cloud/r2";
import { assetKey, PRESIGN_GET_TTL_SECONDS } from "@/lib/cloud/keys";
import { isValidCloudAssetName } from "@/lib/cloud/projectPayload";

type RouteContext = { params: Promise<{ name: string }> };

function unconfigured(): NextResponse {
  return NextResponse.json({ error: CLOUD_UNCONFIGURED_MESSAGE }, { status: 503 });
}

export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const session = requireSession(request);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });

  const storage = getCloudStorage();
  if (storage === null) return unconfigured();

  const { name } = await params;
  if (!isValidCloudAssetName(name)) {
    return NextResponse.json({ error: "Invalid asset name." }, { status: 400 });
  }

  let url: string;
  try {
    url = await storage.presignGet(assetKey(name), PRESIGN_GET_TTL_SECONDS);
  } catch {
    return NextResponse.json({ error: "Cloud storage error." }, { status: 502 });
  }
  return NextResponse.json({ url, expiresIn: PRESIGN_GET_TTL_SECONDS });
}

export async function DELETE(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const session = requireSession(request);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });

  const storage = getCloudStorage();
  if (storage === null) return unconfigured();

  const { name } = await params;
  if (!isValidCloudAssetName(name)) {
    return NextResponse.json({ error: "Invalid asset name." }, { status: 400 });
  }

  try {
    await storage.deleteObject(assetKey(name));
  } catch {
    return NextResponse.json({ error: "Cloud storage error." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
