/**
 * GET/PUT /api/cloud/project (DESIGN.md §7.6). The one project slot:
 * `projects/default/project.json`, `{revision, code, sheets, assets}`.
 *
 * PUT implements the staleness guard (§7.6's "one real multi-device
 * hazard"): the client sends the revision its edit was BASED ON
 * (`baseRevision`); a mismatch against the server's current revision is a
 * 409 (current revision included) rather than a silent overwrite, and the
 * write itself uses R2's conditional PUT (`If-Match` on the stored ETag,
 * or `If-None-Match: *` for the very first write) so the read-then-write
 * race is closed at the STORAGE layer, not just by the revision check —
 * two concurrent requests reading the same `currentRevision` can't both
 * succeed even though both passed the semantic check.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/cloud/auth";
import {
  CLOUD_UNCONFIGURED_MESSAGE,
  CloudConditionalWriteError,
  getCloudStorage,
  type CloudStorage,
} from "@/lib/cloud/r2";
import { PROJECT_KEY } from "@/lib/cloud/keys";
import {
  parseCloudProject,
  parseStoredCloudProjectJson,
  serializeStoredCloudProject,
  type StoredCloudProject,
} from "@/lib/cloud/projectPayload";
import { isRecord } from "@/app/editor/_store/sheetsPayload";

const UNCONFIGURED = () => NextResponse.json({ error: CLOUD_UNCONFIGURED_MESSAGE }, { status: 503 });
const STORAGE_ERROR = () => NextResponse.json({ error: "Cloud storage error." }, { status: 502 });

type CurrentProject =
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "ok"; etag: string; project: StoredCloudProject };

/** Read + decode the current stored project, treating "absent" and
 * "unreadable" distinctly (unreadable should never happen — only our own PUT
 * ever writes this key — but fails closed rather than crashing or silently
 * treating a corrupt object as revision 0). */
async function readCurrent(storage: CloudStorage): Promise<CurrentProject> {
  const stored = await storage.getObject(PROJECT_KEY);
  if (stored === null) return { kind: "absent" };
  const parsed = parseStoredCloudProjectJson(stored.bytes);
  if (parsed === null) return { kind: "unreadable" };
  return { kind: "ok", etag: stored.etag, project: parsed };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = requireSession(request);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });

  const storage = getCloudStorage();
  if (storage === null) return UNCONFIGURED();

  let current: CurrentProject;
  try {
    current = await readCurrent(storage);
  } catch {
    return STORAGE_ERROR();
  }

  if (current.kind === "absent") {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (current.kind === "unreadable") {
    return NextResponse.json({ error: "Stored project is unreadable." }, { status: 500 });
  }
  const { project } = current;
  return NextResponse.json({
    revision: project.revision,
    project: { code: project.code, sheets: project.sheets, assets: project.assets },
  });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const session = requireSession(request);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });

  const storage = getCloudStorage();
  if (storage === null) return UNCONFIGURED();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }
  if (
    !isRecord(body) ||
    typeof body.baseRevision !== "number" ||
    !Number.isInteger(body.baseRevision) ||
    body.baseRevision < 0
  ) {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  // Validated with the SAME parser GET reads back with / import uses (brief
  // C) — an invalid payload is rejected whole, never partially written.
  const project = parseCloudProject(body.project);
  if (project === null) {
    return NextResponse.json({ error: "Invalid project payload." }, { status: 400 });
  }

  let current: CurrentProject;
  try {
    current = await readCurrent(storage);
  } catch {
    return STORAGE_ERROR();
  }
  if (current.kind === "unreadable") {
    return NextResponse.json({ error: "Stored project is unreadable." }, { status: 500 });
  }
  const currentRevision = current.kind === "absent" ? 0 : current.project.revision;

  if (body.baseRevision !== currentRevision) {
    return NextResponse.json({ error: "revision-conflict", revision: currentRevision }, { status: 409 });
  }

  const newRevision = currentRevision + 1;
  const bytes = serializeStoredCloudProject({ revision: newRevision, ...project });
  // First write (nothing stored yet) → must-not-exist ("" → If-None-Match:
  // *); every later write → must-match-the-ETag-we-just-read (If-Match) —
  // see r2.ts's `ifMatch` doc comment.
  const ifMatch = current.kind === "absent" ? "" : current.etag;

  try {
    await storage.putObject(PROJECT_KEY, bytes, "application/json", ifMatch);
  } catch (err) {
    if (err instanceof CloudConditionalWriteError) {
      // Lost the race: something else wrote between our read and this
      // write. Re-fetch so the 409 reports a revision the client can
      // actually act on, not the one we read a moment ago.
      let latestRevision = currentRevision;
      try {
        const latest = await readCurrent(storage);
        if (latest.kind === "ok") latestRevision = latest.project.revision;
      } catch {
        // Best-effort — fall back to what we already knew.
      }
      return NextResponse.json({ error: "revision-conflict", revision: latestRevision }, { status: 409 });
    }
    return STORAGE_ERROR();
  }

  return NextResponse.json({ revision: newRevision });
}
