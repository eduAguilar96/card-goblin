/**
 * The cloud project.json envelope (DESIGN.md §7.6): `{revision, code, sheets,
 * assets}`, validated with the SAME functions the local formats use —
 * `parseSheetsPayload` (sheetsPayload.ts, shared with autosave and project
 * files) for `code`/`sheets`, and the SAME asset rules assetStore.ts already
 * enforces for the manifest — so "what counts as a valid project" has one
 * definition, reused rather than forked, everywhere it's checked (brief C:
 * "reject whole-payload on invalid — same strictness as import").
 *
 * WHY THIS ISN'T THE v2 PROJECT-FILE SHAPE (projectFile.tsx): a project
 * FILE embeds every asset's BYTES as base64 — right for a self-contained
 * download, wrong for the cloud, where a ~4.5 MB serverless request-body cap
 * (§7.6) means asset bytes must never enter a route handler's body at all.
 * `assets` here is a MANIFEST — name/mime/size/hash, no bytes — and the
 * bytes travel browser↔R2 directly via presigned URLs (the assets routes).
 * `parseSheetsPayload` is reused because the `code`+`sheets` half of a
 * project is IDENTICAL in every format; only the envelope around it differs
 * per format, for reasons specific to that format's constraints.
 *
 * SERVER-ONLY IN PRACTICE: nothing here touches Node or Next.js APIs — it's
 * pure — but it's consumed only by /api/cloud/project/route.ts and
 * cloudSync.ts (to build the outgoing payload), never rendered.
 */

import { parseSheetsPayload, isRecord } from "@/app/editor/_store/sheetsPayload";
import { ASSET_MAX_BYTES, isValidAssetName } from "@/app/editor/_store/assetStore";
import type { SheetsState } from "@/app/editor/_store/editorStore";

/**
 * The image MIME types cloud sync accepts — STRICTER than assetStore.ts's
 * `isImageMime` (independent security review, L1): a bare
 * `mime.startsWith("image/")` also accepts `"image/"` itself, `"image/png;
 * charset=x"`, `"image/html"`, and `"image/svg+xml"` (SVG is XML and can
 * carry embedded scripts — a real risk once bytes are stored and later
 * fetched back as a URL, unlike a raster format). Deliberately NOT a change
 * to `isImageMime` itself: that check is existing, tested, intentional
 * behavior for the LOCAL (this-browser-only, IndexedDB) asset library
 * (assetStore.test.ts's "accepts any image/* subtype", m8) — a materially
 * lower-stakes trust boundary than bytes stored in a shared R2 bucket
 * reachable by presigned URL from any signed-in device. Cloud sync gets its
 * own, narrower allowlist rather than forking or loosening that contract.
 * Reused by the presign route (`assets/presign/route.ts`) so the same rule
 * applies wherever a mime type crosses into R2.
 */
const ALLOWED_CLOUD_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export function isSupportedCloudImageMime(mime: string): boolean {
  return ALLOWED_CLOUD_IMAGE_MIMES.has(mime);
}

/**
 * R2/S3 object keys cap at 1024 BYTES total; this app's own key prefix
 * (`projects/default/assets/`) is 25 of those, so the name alone could
 * technically go up to ~999 — this is a much tighter, sane UX/DoS-shaped
 * ceiling (independent security review, L2: an unbounded name let a
 * 5000-character string presign "fine"). `isValidAssetName`'s character
 * set is ASCII-only, so character count and byte count are the same here.
 */
export const MAX_CLOUD_ASSET_NAME_LENGTH = 100;

export function isValidCloudAssetName(name: string): boolean {
  return isValidAssetName(name) && name.length <= MAX_CLOUD_ASSET_NAME_LENGTH;
}

export interface CloudAssetManifestEntry {
  name: string;
  mime: string;
  size: number;
  /**
   * Content hash (lowercase hex SHA-256) — the pull's "do I already have
   * this exact content locally" comparison (§7.6). TRUSTED from the client,
   * never re-derived server-side: the server never sees asset bytes at all
   * (the presigned-URL design's entire point — brief A's 4.5 MB wall). This
   * only gates a diffing OPTIMIZATION (which assets a pull re-downloads),
   * never an authorization decision — a lying hash can at worst make one
   * browser re-download or wrongly skip re-downloading its OWN project's
   * art, never expose or corrupt anyone else's data. Flagged in the report
   * as a residual worth a reviewer's attention, not a silent gap.
   */
  hash: string;
}

export interface CloudProject {
  code: string;
  sheets: SheetsState;
  assets: CloudAssetManifestEntry[];
}

export interface StoredCloudProject extends CloudProject {
  revision: number;
}

const HEX_RE = /^[0-9a-f]+$/i;

function parseAssetManifest(raw: unknown): CloudAssetManifestEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const entries: CloudAssetManifestEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const { name, mime, size, hash } = item;
    if (typeof name !== "string" || !isValidCloudAssetName(name)) return null;
    if (seen.has(name)) return null; // duplicate name — a malformed manifest
    seen.add(name);
    if (typeof mime !== "string" || !isSupportedCloudImageMime(mime)) return null;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0 || size > ASSET_MAX_BYTES) {
      return null;
    }
    if (typeof hash !== "string" || hash.length === 0 || !HEX_RE.test(hash)) return null;
    // L13 (review): normalize to lowercase — HEX_RE accepts either case, but
    // cloudSync.ts's OWN hash computation (sha256Hex) always produces
    // lowercase, so an uppercase-hex manifest entry (from a hand-crafted or
    // foreign PUT) would never string-equal a freshly computed local hash —
    // the pull's "already have this content" check would permanently read
    // as "different", re-downloading that asset on every sign-in forever.
    entries.push({ name, mime, size, hash: hash.toLowerCase() });
  }
  return entries;
}

/**
 * Whole-payload validation (brief C: "same strictness as import" — any
 * invalid field rejects the ENTIRE project, never a partial write, so a
 * malformed body can never land in the bucket).
 */
export function parseCloudProject(raw: unknown): CloudProject | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.code !== "string") return null;
  if (!isRecord(raw.sheets)) return null;
  const sheets = parseSheetsPayload(raw.sheets);
  if (sheets === null) return null;
  const assets = parseAssetManifest(raw.assets);
  if (assets === null) return null;
  return { code: raw.code, sheets, assets };
}

/**
 * Decode+validate the JSON bytes stored at the project key — the shape only
 * our OWN PUT route ever writes (a `revision` on top of the same envelope
 * `parseCloudProject` validates). Used both to answer GET and, inside PUT,
 * to learn the CURRENT revision before deciding 409-vs-write. Null on
 * anything unreadable — fails closed rather than handing a broken payload
 * onward (this should only ever happen if the bucket was hand-edited).
 */
export function parseStoredCloudProjectJson(bytes: Uint8Array): StoredCloudProject | null {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.revision !== "number" || !Number.isInteger(raw.revision)) {
    return null;
  }
  const project = parseCloudProject(raw);
  if (project === null) return null;
  return { ...project, revision: raw.revision };
}

/** The bytes PUT /api/cloud/project actually writes — the inverse of
 * `parseStoredCloudProjectJson`, kept beside it so the two can never drift
 * on field names. */
export function serializeStoredCloudProject(project: StoredCloudProject): Uint8Array {
  const json = JSON.stringify({
    revision: project.revision,
    code: project.code,
    sheets: project.sheets,
    assets: project.assets,
  });
  return new TextEncoder().encode(json);
}
