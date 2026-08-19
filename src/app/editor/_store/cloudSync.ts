/**
 * Cloud sync client controller (DESIGN.md §7.6): mirrors persistence.ts in
 * shape — pure-ish reactive controller + an injected transport (the network
 * seam tests fake, exactly like persistence.ts's `ProjectStorage` and
 * assetStore.ts's `AssetAdapter`) + a browser-only singleton.
 *
 * THE MIRROR, NOT A REPLACEMENT (§7.6's framing, load-bearing throughout this
 * file): the cloud is a mirror of the local stores. Local editing is NEVER
 * gated by anything in here — this module only ever OBSERVES `editorStore`/
 * `assetStore` and reacts; it never blocks a write, and every network path
 * degrades to a quiet status instead of surfacing an error the user has to
 * deal with. Signed-out (the default, no hint in storage) touches NEITHER
 * store at all — zero behavior change for anyone who never signs in.
 *
 * STATE MACHINE (`CloudSyncStatus`):
 *   signed-out → signing-in → pulling → idle ⇄ pushing
 *                                          ↘ offline (any failure, quiet)
 *                                          ↘ behind (409 — needs Reload/Overwrite)
 *                                          ↘ conflict (found ≠ local, both real — needs a choice)
 *
 * - PULL happens exactly once per sign-in (brief D) — not on every reload.
 *   A reload with a previously-signed-in hint only RE-CONFIRMS the session
 *   (a side-effect-free GET) and records the server's revision; it never
 *   calls `replaceProject`. Rationale: this browser's local project is
 *   already authoritative for ITSELF (local-first) — blindly re-pulling on
 *   every reload risks clobbering an edit this browser made while offline
 *   and never got to push. Divergence is instead caught the existing way:
 *   the next PUSH's `baseRevision` won't match, surfacing the SAME
 *   Reload/Overwrite prompt a live conflict would. The mount-restore GET's
 *   NOT-FOUND branch is the one exception to "never act on a mere reload":
 *   nothing remote exists to defer to, so it runs the same adopt a fresh
 *   sign-in does (below) rather than leaving the bucket empty indefinitely.
 * - NOT FOUND IS AN ADOPT, NOT A SILENT SUCCESS (production bug fixed
 *   2026-08-18 — DESIGN.md §7.6's dated addendum has the full incident): the
 *   original not-found branch recorded revision 0 and claimed "idle" with a
 *   fresh `lastSyncedAt` WITHOUT EVER PUSHING, so signing in against an
 *   empty bucket looked identical to a real sync while the bucket stayed
 *   empty. Fixed by `adoptLocalProject`: a first sign-in (or mount-restore)
 *   against nothing stored immediately PUSHES the current local project as
 *   the cloud's starting copy. Base revision 0 is the conditional CREATE
 *   `runPush`/the PUT route already implement (`If-None-Match: *`), so a 409
 *   here — another device created the project first, in the race between
 *   this GET and this PUSH — surfaces the ordinary "behind" prompt instead
 *   of clobbering it. Local ASSETS ride along too: the manifest alone moves
 *   no bytes (transfer is normally event-driven, below), so an adopt walks
 *   every local asset through the SAME `uploadAssetBytes` a live add already
 *   uses — safe to call unconditionally since an R2 PUT is an idempotent
 *   overwrite.
 * - FOUND BUT DIFFERENT FROM LOCAL IS A POSSIBLE COLLISION, not an automatic
 *   `replaceProject`: if local differs from BOTH the untouched demo seed AND
 *   the server's copy, two real, divergent projects exist, and silently
 *   replacing either is a data-loss bug of its own. `status: "conflict"`
 *   holds the fetched-but-UNAPPLIED server copy (`conflictProject`) and
 *   waits for a choice — `reload()` ("Keep cloud copy") or `overwrite()`
 *   ("Keep this device's work", itself an `adoptLocalProject` based at the
 *   revision this device just saw) — the SAME two entry points the 409
 *   "behind" prompt uses, branching on `status` internally rather than
 *   growing a second pair of methods. Local matching the demo, or matching
 *   the server, both mean nothing would be lost, so both apply immediately —
 *   unchanged from before this fix.
 * - `lastSyncedAt` IS SET ONLY at the exact moment a push or a project-
 *   bearing pull ACTUALLY SUCCEEDS — never speculatively, and never for a
 *   bare not-found GET on its own (that's step one of an adopt, not a sync
 *   in itself). `notice` is the human-readable echo of that same moment
 *   ("Loaded your cloud project" / "No cloud project yet — uploading this
 *   one"), cleared at the start of the NEXT pull/push so it can never
 *   outlive the event it described.
 * - PUSH is content-based and un-opinionated: whatever `editorStore.code`/
 *   `.sheets` currently ARE gets pushed, ~10 s after the last change,
 *   including a `replaceProject` call from Reset-to-demo or a project-file
 *   import — the cloud mirrors whatever local ends up being, consistently,
 *   rather than special-casing which kinds of local changes count.
 * - A push's OWN `replaceProject`/asset-store calls (the pull path) are
 *   MUTED from re-triggering a push — same idiom persistence.ts's
 *   `resetToDemo` uses, extended to also cover the pull's asset downloads
 *   (module note on `muted` below).
 * - A push is never allowed to EXECUTE while pulling/signing-in/an unresolved
 *   conflict is showing — its debounce timer re-arms instead of firing (see
 *   `runPush`'s doc comment) — closing a race where a push using a
 *   pre-resolution `knownRevision` succeeds and is then immediately
 *   clobbered by the in-flight pull's own `replaceProject`, which would be a
 *   genuine lost edit. An unresolved conflict ALSO suppresses live asset
 *   add/delete from touching R2 at all (`canMutateRemoteAssets`) — not just
 *   pushes — so a delete fired mid-prompt can't destroy the cloud copy the
 *   user hasn't yet chosen to keep (independent review, MEDIUM).
 * - A MANIFEST MUST NEVER CLAIM AN ASSET THIS DEVICE HASN'T ACTUALLY
 *   CONFIRMED IS ON R2 (independent review, HIGH, second dated addendum —
 *   "manifest without bytes"): `remoteAssetHashes` (asset name -> the hash
 *   confirmed present, set only by a successful upload or a just-fetched
 *   server manifest, cleared the instant local content changes) is the ONE
 *   source of truth `runPush` checks before EVERY push, uploading anything
 *   unconfirmed first and holding the whole push at "offline" if that
 *   fails — see `runPush`'s doc comment for the four independent ways a
 *   name could otherwise reach a local manifest without its bytes ever
 *   having reached R2 (a failed adopt no later edit retried, a collision
 *   overwrite whose bookkeeping cleared regardless of success, a clean
 *   pull's local-only asset, IndexedDB's own async restore).
 *
 * ASSETS: byte transfer (upload/delete) happens immediately per event, not
 * on the 10 s debounce — only the project.json MANIFEST (name/mime/size/
 * hash, no bytes) rides the debounced push. `clear`/`replaceAll` events
 * (reset-to-demo, a project-file import while signed in) do NOT individually
 * clean up remote objects — an accepted v1 gap, documented on the listener
 * below and called out in the report. Collision detection (`conflict`,
 * above) is deliberately CODE+SHEETS ONLY (`projectContentEquals`) — an
 * asset-only divergence (same name, different bytes, on two devices whose
 * code happens to match) is NOT caught and can still be silently replaced
 * by an ordinary pull's hash-mismatch re-download; disclosed, not fixed,
 * in DESIGN.md §7.6's second dated addendum and the wiki (independent
 * review, MEDIUM — extending the comparison to assets would mean hashing
 * every local asset before every sign-in decision, for a narrower risk
 * than the code/sheets case this exists to close).
 */

import {
  demoSeed,
  editorStore,
  type EditorSeed,
  type EditorStore,
} from "@/app/editor/_store/editorStore";
import { assetStore, type AssetStore, type StoredAsset } from "@/app/editor/_store/assetStore";
import { sheetsToPersisted } from "@/app/editor/_store/sheetsPayload";
import type { CloudAssetManifestEntry, CloudProject } from "@/lib/cloud/projectPayload";

// ---------------------------------------------------------------------------
// Transport — the injectable network seam (mirrors ProjectStorage/AssetAdapter)
// ---------------------------------------------------------------------------

export type CloudFailure = { ok: false; status: number | "network"; message?: string };

export type LoginResult = { ok: true } | CloudFailure;

export type GetProjectResult =
  | { ok: true; found: true; revision: number; project: CloudProject }
  | { ok: true; found: false }
  | CloudFailure;

export type PutProjectResult =
  | { ok: true; revision: number }
  | { ok: false; conflict: true; revision: number }
  | { ok: false; conflict: false; status: number | "network"; message?: string };

export type PresignResult = { ok: true; url: string } | CloudFailure;

export type OkResult = { ok: true } | CloudFailure;

/** The network seam. Every method resolves (never throws/rejects) — a
 * network failure is a valid, expected outcome here, not an exceptional
 * one, so the controller never needs a try/catch around a transport call. */
export interface CloudTransport {
  /** FEATURE: both fields required (the login route folds a wrong username,
   * a wrong password, or both into the SAME 401 — see that route's module
   * comment), so this seam takes them as two separate arguments rather than
   * silently accepting one and defaulting the other. */
  login(username: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  getProject(): Promise<GetProjectResult>;
  putProject(baseRevision: number, project: CloudProject): Promise<PutProjectResult>;
  presignAssetPut(name: string, mime: string, size: number): Promise<PresignResult>;
  presignAssetGet(name: string): Promise<PresignResult>;
  deleteAsset(name: string): Promise<OkResult>;
  /** Direct-to-R2 transfer (brief A's 4.5 MB wall — never through our own
   * API). Separated from the presign call so tests can fake "the URL was
   * right but the upload itself failed" independently. */
  uploadToPresignedUrl(url: string, bytes: Uint8Array, mime: string): Promise<boolean>;
  downloadFromPresignedUrl(url: string): Promise<Uint8Array | null>;
}

async function toJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Preserve a route's safe, user-facing error when it has one. This is
 * best-effort because proxies and platform errors can return HTML or an
 * empty body; callers always retain the status-code fallback. */
async function responseErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const data = await toJson<{ error?: unknown }>(res);
    return typeof data.error === "string" && data.error.length > 0 ? data.error : undefined;
  } catch {
    return undefined;
  }
}

/** The real transport: fetches to our own `/api/cloud/*` routes, plus raw
 * `fetch` to whatever presigned URL a route hands back. Every branch is
 * wrapped so a thrown/rejected fetch (offline, DNS failure, CORS) becomes
 * `{ok:false, status:"network"}` rather than an unhandled rejection —
 * upholding the CloudTransport contract above. */
export function createRealCloudTransport(): CloudTransport {
  return {
    async login(username, password) {
      try {
        const res = await fetch("/api/cloud/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        return res.ok ? { ok: true } : { ok: false, status: res.status };
      } catch {
        return { ok: false, status: "network" };
      }
    },

    async logout() {
      try {
        await fetch("/api/cloud/logout", { method: "POST" });
      } catch {
        // Best-effort (module note: nothing else to clean up client-side).
      }
    },

    async getProject() {
      try {
        const res = await fetch("/api/cloud/project", { method: "GET" });
        if (res.status === 404) return { ok: true, found: false };
        if (!res.ok) {
          return { ok: false, status: res.status, message: await responseErrorMessage(res) };
        }
        const data = await toJson<{ revision: number; project: CloudProject }>(res);
        return { ok: true, found: true, revision: data.revision, project: data.project };
      } catch {
        return { ok: false, status: "network" };
      }
    },

    async putProject(baseRevision, project) {
      try {
        const res = await fetch("/api/cloud/project", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ baseRevision, project }),
          // Best-effort survival through a pagehide-triggered flush (module
          // note): a small JSON body comfortably fits keepalive's budget.
          keepalive: true,
        });
        if (res.status === 409) {
          const data = await toJson<{ revision: number }>(res);
          return { ok: false, conflict: true, revision: data.revision };
        }
        if (!res.ok) {
          return {
            ok: false,
            conflict: false,
            status: res.status,
            message: await responseErrorMessage(res),
          };
        }
        const data = await toJson<{ revision: number }>(res);
        return { ok: true, revision: data.revision };
      } catch {
        return { ok: false, conflict: false, status: "network" };
      }
    },

    async presignAssetPut(name, mime, size) {
      try {
        const res = await fetch("/api/cloud/assets/presign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, mime, size }),
        });
        if (!res.ok) {
          return { ok: false, status: res.status, message: await responseErrorMessage(res) };
        }
        const data = await toJson<{ url: string }>(res);
        return { ok: true, url: data.url };
      } catch {
        return { ok: false, status: "network" };
      }
    },

    async presignAssetGet(name) {
      try {
        const res = await fetch(`/api/cloud/assets/${encodeURIComponent(name)}`, { method: "GET" });
        if (!res.ok) {
          return { ok: false, status: res.status, message: await responseErrorMessage(res) };
        }
        const data = await toJson<{ url: string }>(res);
        return { ok: true, url: data.url };
      } catch {
        return { ok: false, status: "network" };
      }
    },

    async deleteAsset(name) {
      try {
        const res = await fetch(`/api/cloud/assets/${encodeURIComponent(name)}`, { method: "DELETE" });
        return res.ok
          ? { ok: true }
          : { ok: false, status: res.status, message: await responseErrorMessage(res) };
      } catch {
        return { ok: false, status: "network" };
      }
    },

    async uploadToPresignedUrl(url, bytes, mime) {
      try {
        const res = await fetch(url, {
          method: "PUT",
          headers: { "content-type": mime },
          body: bytes as BodyInit,
        });
        return res.ok;
      } catch {
        return false;
      }
    },

    async downloadFromPresignedUrl(url) {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return new Uint8Array(await res.arrayBuffer());
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Signed-in hint (mount-restore seam — module note above)
// ---------------------------------------------------------------------------

const SIGNED_IN_HINT_KEY = "cardgoblin.cloud.signedInHint";

/** A LOCAL, best-guess flag — NOT the session itself (the session cookie is
 * httpOnly, server-only, and remains the sole source of truth). Its only
 * purpose is deciding whether page load bothers confirming a session at
 * all: without it, every never-signed-in visitor would fire an auth-probe
 * fetch on every load, which is both wasteful and a `signed-out must behave
 * EXACTLY as today` violation on its own (brief D). */
export interface SignedInHint {
  get(): boolean;
  set(value: boolean): void;
}

/** Injectable so tests never touch real localStorage; mirrors
 * persistence.ts's defensive try/catch around storage access (private mode
 * can throw on ANY access, not just writes). */
export function createLocalStorageHint(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): SignedInHint {
  return {
    get: () => {
      try {
        return storage.getItem(SIGNED_IN_HINT_KEY) === "1";
      } catch {
        return false;
      }
    },
    set: (value) => {
      try {
        if (value) storage.setItem(SIGNED_IN_HINT_KEY, "1");
        else storage.removeItem(SIGNED_IN_HINT_KEY);
      } catch {
        // Best-effort — a hint that fails to persist just means the NEXT
        // reload re-prompts sign-in, not a crash or a lost edit.
      }
    },
  };
}

/** The hint a controller uses when storage was flatly unavailable
 * (`window.localStorage` itself threw) — always reports signed-out, never
 * persists, matching the "keep the session but only for this tab" fallback
 * this codebase already applies to autosave. */
function createInertHint(): SignedInHint {
  return { get: () => false, set: () => {} };
}

// ---------------------------------------------------------------------------
// Hashing (content-addressed asset diffing, §7.6)
// ---------------------------------------------------------------------------

/** SHA-256 hex, via Web Crypto — available as a global in both the browser
 * and Node 22 (vitest), so this needs no injection/mocking seam; it's a
 * pure function of bytes. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function assetBytes(stored: StoredAsset): Promise<Uint8Array> {
  return stored.bytes instanceof Blob ? new Uint8Array(await stored.bytes.arrayBuffer()) : stored.bytes;
}

// ---------------------------------------------------------------------------
// Collision detection (FIX 4, §7.6): "does local carry real work that isn't
// on the server" — one definition of equality, reused for BOTH the
// demo-seed check and the server-copy check.
// ---------------------------------------------------------------------------

/** Order-insensitive JSON: object keys sorted before stringifying; arrays
 * left in place (row/array order IS semantically meaningful — reordering
 * rows is a real edit — but object-key insertion order isn't a promise this
 * codebase makes anywhere, e.g. ◆26's rename reconciliation appends the
 * renamed key at the END of a row object, which must not by itself read as
 * "different content" against an otherwise-identical row a device that never
 * went through that exact reconciliation happens to hold with keys in
 * declaration order). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Structural equality on the code+sheets a project actually carries.
 * `sheetsToPersisted` (shared with autosave/project-files/cloud,
 * sheetsPayload.ts) strips down to exactly the fields every persisted format
 * agrees matter; `stableStringify` on top means two projects with identical
 * content in a different key/sheet ORDER still compare equal. Exported for a
 * direct unit test of the order-insensitivity (awkward to trigger precisely
 * through the full controller).
 */
export function projectContentEquals(a: EditorSeed, b: EditorSeed): boolean {
  return (
    a.code === b.code &&
    stableStringify(sheetsToPersisted(a.sheets)) === stableStringify(sheetsToPersisted(b.sheets))
  );
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export type CloudSyncStatus =
  | "signed-out"
  | "signing-in"
  | "pulling"
  | "idle"
  | "pushing"
  | "offline"
  | "behind"
  | "conflict";

export interface CloudSyncSnapshot {
  status: CloudSyncStatus;
  lastSyncedAt: number | null;
  /** Non-null only while `status === "pulling"` and there are assets left
   * to fetch — the brief's "3 of 8 images" progress. */
  pullProgress: { done: number; total: number } | null;
  /** Human-readable, set on `offline`/`signed-out` (after a failed
   * sign-in) — null otherwise. */
  errorMessage: string | null;
  /** Set only while `status === "behind"`: the server's revision, so
   * `overwrite()` knows what to base the re-push on. */
  behindRevision: number | null;
  /** Set only while `status === "conflict"` (FIX 4): the project `pull()`
   * fetched but did NOT apply, because local also carries real work not in
   * the cloud. `reload()`/`overwrite()` read this to resolve the prompt
   * without a second network round trip. */
  conflictProject: { revision: number; project: CloudProject } | null;
  /** A short "here's what just happened" confirmation (FIX 3) — set once,
   * the moment a sign-in-triggered sync actually SUCCEEDS (a project-bearing
   * pull, or a first-sign-in adopt-local push), and cleared at the start of
   * the NEXT pull/push so it never lingers past whatever happens next. Null
   * the rest of the time — an ordinary edit-driven push never sets it. */
  notice: string | null;
}

export interface CloudSyncController {
  getSnapshot(): CloudSyncSnapshot;
  subscribe(listener: () => void): () => void;
  /** Resolves once sign-in AND the initial pull have settled (success or
   * degraded-to-offline) — the dialog awaits this to know when to close.
   * Both fields required (FEATURE: username+password) — see CloudTransport
   * .login's doc comment. */
  signIn(username: string, password: string): Promise<{ ok: true } | { ok: false; message: string }>;
  signOut(): void;
  /** The "behind" 409 prompt's two answers (brief D, both tested) — ALSO the
   * sign-in "conflict" prompt's two answers (FIX 4): which one is showing is
   * decided by `status` internally, rather than a second pair of methods.
   * reload() = take the other copy; overwrite() = push local over it. */
  reload(): Promise<void>;
  overwrite(): Promise<void>;
  /** pagehide hook — mirrors persistence.ts's `flush()`: run a PENDING
   * debounced push now; no-op when nothing is pending. */
  flush(): void;
  /** Unsubscribe from both stores and cancel any pending timer (tests). */
  dispose(): void;
}

/**
 * §7.6: far longer than the 1 s local autosave (persistence.ts's
 * PERSIST_DEBOUNCE_MS) — R2's free tier allows 1M writes/month, and a
 * per-keystroke push would be the only realistic way to threaten that. 10 s
 * idle means even a long editing session that never truly pauses for 10 s
 * produces zero pushes until it does — acceptable, since editing itself is
 * never blocked either way (module note above). Guarded against the wiki by
 * docFacts.test.ts, like PERSIST_DEBOUNCE_MS.
 */
export const PUSH_DEBOUNCE_MS = 10_000;

const isSettled = (status: CloudSyncStatus): boolean =>
  status === "idle" || status === "pushing" || status === "offline" || status === "behind";
// "conflict" belongs here, not in isSettled: a push firing while an
// unresolved collision is showing would use a pre-resolution `knownRevision`
// — the exact hazard pulling/signing-in are already guarded against (module
// comment up top) — so it must re-arm the debounce instead of executing,
// same as those two.
const isTransitioning = (status: CloudSyncStatus): boolean =>
  status === "signing-in" || status === "pulling" || status === "conflict";

/**
 * MEDIUM fix (independent review): whether a LIVE asset add/delete/rename
 * event is allowed to touch R2 right now. Deliberately NOT
 * `isSettled(status) || isTransitioning(status)` — the combined gate
 * `uploadAssetBytes`/`deleteAssetRemote` used before this fix — because
 * that combination now ALSO covers "conflict" (added to `isTransitioning`
 * above, for the unrelated reason of blocking a stale-revision PUSH), which
 * let a delete fired during an unresolved sign-in collision destroy the
 * cloud copy before the user had chosen to discard it — contradicting the
 * wiki's "nothing is replaced until you choose" the moment "Keep cloud
 * copy" then named the now-missing bytes in its own manifest. Every status
 * except "signed-out" and "conflict" may still mutate remote assets —
 * unlike a push, an asset add/delete is never blocked by pulling/signing-in
 * either (module note up top: "never block editing"); it's specifically
 * the UNRESOLVED CHOICE a conflict represents that must not be undercut
 * from behind it.
 */
const canMutateRemoteAssets = (status: CloudSyncStatus): boolean =>
  status !== "signed-out" && status !== "conflict";

/**
 * FIX 3 (DESIGN.md §7.6's dated addendum): the two on-success confirmations
 * a sign-in can produce, verbatim — exported so cloudSync.test.ts pins the
 * exact copy instead of every test re-typing (and risking silently drifting
 * from) the literal string.
 */
export const LOADED_NOTICE = "Loaded your cloud project";
export const ADOPTED_NOTICE = "No cloud project yet — uploading this one";

function describeFailure(status: number | "network"): string {
  if (status === "network") return "Can't reach the network.";
  if (status === 401) return "Signed out on the server — sign in again to keep syncing.";
  if (status === 503) return "Cloud sync isn't set up on this server.";
  return `Cloud sync error (${status}).`;
}

/**
 * MEDIUM fix (independent review — "a partial pull still claims 'Loaded
 * your cloud project' + green"): `pullAssets` used to swallow a per-asset
 * failure entirely, so `pull()`/`reload()` had nothing to check and
 * unconditionally claimed a clean, synced load. This is FIX 2's honesty
 * guarantee ("never claim synced before it actually is") extended to
 * assets: the code+sheets DID load — that half of "your project loaded" is
 * true — but a status that reads "idle"/green while images silently didn't
 * come down is the same class of lie the original bug shipped with.
 */
function partialPullMessage(failedCount: number): string {
  return `Your project loaded, but ${failedCount} image${failedCount === 1 ? "" : "s"} failed to download. Try again.`;
}

/**
 * The sign-in dialog's failure message — exported for a direct unit test.
 * Deliberately narrower than `describeFailure`: a LOGIN failure's only
 * genuinely wrong-credential outcome is 401, so anything else (network,
 * 503, a distinct 5xx bucket, or now anything UNRECOGNIZED) must say
 * something other than "Incorrect username or password" (M1, independent
 * security review — before that fix, every non-401/503/network status,
 * INCLUDING a 500 from a misconfigured `ADMIN_PASSWORD_HASH`, fell through
 * to the wrong-credential copy, which would have told an operator their own
 * correct password was wrong, forever, with no way to tell it was actually
 * a server-side mistake).
 *
 * INVERTED to an explicit 401 check, not a fallthrough default (SECOND
 * independent security review, HIGH — the irony of this exact bug shipping
 * in a change-set about diagnosability): the PREVIOUS shape of this
 * function tested 503/network/5xx and fell through to the credentials copy
 * for literally everything else, which silently included 404 — and the
 * live deployment this shipped against was ALREADY 404ing these routes.
 * That means the exact outage this whole task exists to diagnose would have
 * been reported to the owner as "Incorrect username or password," which is
 * the single worst possible message for it (it points at retyping a
 * password that was never the problem, instead of at a route that isn't
 * deployed). The five branches below are the FIVE distinct copies the
 * sign-in dialog surfaces (TASK 3 + this fix), each tested directly in
 * cloudSyncControl.test.tsx via `SignInDialog`'s `initialError` seam, and
 * `401` is now checked EXPLICITLY rather than being "whatever's left over":
 *
 * - "network" — offline or the request never reached the server at all.
 * - 503 — covers BOTH "env not set" and "the stored hash is unreadable"
 *   (login/route.ts) with the SAME copy here, since either way this
 *   browser's only actionable next step is the same one: ask whoever runs
 *   this deployment to look at the server. TASK 2/3: names
 *   `/api/cloud/diagnose` and the deployment guide DIRECTLY in the dialog —
 *   the owner's original complaint was reading devtools to learn even this
 *   much, so the fix is to say it in the UI instead of making that a
 *   separate investigation. (The response BODY's own more specific wording
 *   — `ADMIN_HASH_UNREADABLE_MESSAGE` vs `CLOUD_UNCONFIGURED_MESSAGE` — is
 *   for whoever's already looking at server logs/the network tab, not this
 *   dialog, which has no way to show the two differently without ALSO
 *   telling an unauthenticated caller which one it was.)
 * - 401 — wrong credentials, and ONLY 401. Deliberately does not say
 *   "password" alone (TASK 4: username+password) — the login route folds
 *   wrong-username, wrong-password, and both-wrong into this exact same
 *   message and the exact same status, so the copy here must not claim to
 *   know which field was wrong either (login/route.ts's module comment has
 *   the full reasoning for why the response can't distinguish them).
 * - any other 5xx — an unexpected SERVER error, distinct from 503: not a
 *   credential problem and not (as far as the client can tell) a known
 *   misconfiguration either.
 * - anything else (400/403/404/…, or a status this function simply doesn't
 *   recognize) — explicitly NOT folded into the credentials copy. Names the
 *   actual status code and points at `/api/cloud/diagnose`, because the
 *   realistic cause is a routing/deployment problem (a route that 404s, a
 *   proxy/CDN returning its own error page) rather than anything about what
 *   the user typed.
 */
export function signInFailureMessage(status: number | "network"): string {
  if (status === "network") return "Can't reach the network. Check your connection and try again.";
  if (status === 503) {
    return "Cloud sync isn't set up on this server. Check /api/cloud/diagnose for details, or see the deployment guide (docs/deployment.md).";
  }
  if (status === 401) return "Incorrect username or password.";
  if (status >= 500) return "Something went wrong on the server. Try again.";
  return `Unexpected server response (HTTP ${status}) — the cloud routes may not be deployed yet; see /api/cloud/diagnose.`;
}

export interface CloudSyncDeps {
  store: EditorStore;
  assets: AssetStore;
  transport: CloudTransport;
  hint: SignedInHint;
}

/**
 * Build a controller over one set of dependencies (headless-usable — tests
 * build one per case, exactly like createEditorStore/createAssetStore). If
 * `hint.get()` is already true (a prior sign-in this browser remembers), it
 * kicks off the mount-restore session check immediately — see the module
 * note on why that check never calls `replaceProject`.
 */
export function createCloudSyncController(deps: CloudSyncDeps): CloudSyncController {
  const { store, assets, transport, hint } = deps;

  let snapshot: CloudSyncSnapshot = {
    status: "signed-out",
    lastSyncedAt: null,
    pullProgress: null,
    errorMessage: null,
    behindRevision: null,
    conflictProject: null,
    notice: null,
  };
  let knownRevision = 0;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let pushInFlight = false;
  let pushAgainAfterInFlight = false;
  // Suppresses the store/asset listeners below while THIS controller is the
  // one writing local state (a pull's replaceProject + asset downloads) —
  // exactly persistence.ts's resetToDemo `muted` idiom, extended to cover
  // both stores for the duration of one pull.
  let muted = false;
  let disposed = false;
  const hashCache = new Map<string, string>(); // asset name -> sha256 hex (LOCAL content)
  /**
   * HIGH fix (independent review, §7.6's second dated addendum — "manifest
   * without bytes"): asset name -> the hash this controller has ACTUALLY
   * CONFIRMED is present on R2 under that name. Set only by a successful
   * upload or a just-fetched server manifest (both places genuinely know
   * what R2 holds); cleared the instant local content for that name changes
   * (event listener below, mirrors hashCache's own clearing). `runPush`
   * refuses to CLAIM any manifest entry this map doesn't confirm — see its
   * doc comment for the four independent ways a name could otherwise reach
   * a local asset list without its bytes ever having reached R2.
   */
  const remoteAssetHashes = new Map<string, string>();

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const setSnapshot = (patch: Partial<CloudSyncSnapshot>): void => {
    snapshot = { ...snapshot, ...patch };
    notify();
  };

  /** A fresh read of `snapshot.status`, specifically for re-checking it AFTER
   * an `await` inside a block that already narrowed `snapshot.status` to one
   * literal (e.g. `reload()`'s "conflict" branch, below). TypeScript doesn't
   * invalidate that narrowing across the `await` — it has no way to know
   * `setSnapshot` (reassigning the captured `snapshot` variable) can run deep
   * inside an awaited call chain (e.g. `pullAssets`) — so a bare
   * `snapshot.status === "signed-out"` there type-errors as unreachable even
   * though it's a real, tested race (a sign-out landing mid-flight). Routing
   * through a function call is a fresh expression TypeScript can't narrow. */
  const currentStatus = (): CloudSyncStatus => snapshot.status;

  const cancelPushTimer = (): void => {
    if (pushTimer !== null) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
  };

  // -- push -------------------------------------------------------------

  async function buildAssetManifest(): Promise<CloudAssetManifestEntry[]> {
    const current = assets.getSnapshot().assets;
    const manifest: CloudAssetManifestEntry[] = [];
    for (const meta of current) {
      let assetHash = hashCache.get(meta.name);
      if (assetHash === undefined) {
        const stored = await assets.getBytes(meta.name);
        if (stored === null) continue; // vanished locally mid-build; next push reconciles
        assetHash = await sha256Hex(await assetBytes(stored));
        hashCache.set(meta.name, assetHash);
      }
      manifest.push({ name: meta.name, mime: meta.mime, size: meta.size, hash: assetHash });
    }
    return manifest;
  }

  async function runPush(): Promise<void> {
    if (disposed) return;
    if (pushInFlight) {
      pushAgainAfterInFlight = true;
      return;
    }
    pushInFlight = true;
    // A fresh push invalidates any earlier "just signed in" notice (FIX 3) —
    // adoptLocalProject re-adds its own AFTER this resolves, below, for the
    // one case that still wants one.
    setSnapshot({ status: "pushing", notice: null });
    const { code, sheets } = store.getState();
    // Captured HERE, synchronously, same as code/sheets just above — NOT
    // read inline at the putProject call below. `knownRevision` is a bare
    // closure variable `signOut()` resets to 0 (M5a's comment on that
    // method), and signOut() can run its FULL synchronous body during the
    // `await buildAssetManifest()` suspension right below (found by an
    // adversarial replay of "sign out flushes a pending edit" once
    // adoptLocalProject — FIX 1 — made a non-zero knownRevision reachable
    // from a fresh sign-in for the first time): reading the closure
    // variable AFTER that await would send THIS push's baseRevision as the
    // POST-sign-out 0, spuriously 409-ing against the revision this push
    // itself was actually based on.
    const baseRevision = knownRevision;
    const manifest = await buildAssetManifest();

    // HIGH fix (independent review, §7.6's second dated addendum —
    // "manifest without bytes"): a manifest must never CLAIM an asset this
    // device hasn't ACTUALLY confirmed is on R2 with this exact content.
    // That bug had (at least) four independent entry points — an adopt
    // whose upload failed and was never retried by the next ordinary edit;
    // "Keep this device's work" silently evaporating on failure (see
    // overwrite()'s doc comment); a clean pull leaving a local-only asset
    // unaccounted for until "the next manifest" names it; and the asset
    // store's OWN async IndexedDB restore (a `replaceAll` event) scheduling
    // a push without uploading anything. Rather than plug each call site
    // separately, `runPush` — the ONE place a manifest actually goes out —
    // is the single choke point: anything about to be named that
    // `remoteAssetHashes` doesn't already confirm gets uploaded HERE, and a
    // failure holds the WHOLE push at "offline" rather than letting the
    // manifest go out regardless.
    const unconfirmed = manifest.filter((entry) => remoteAssetHashes.get(entry.name) !== entry.hash);
    if (unconfirmed.length > 0) {
      const uploaded = await Promise.all(unconfirmed.map((entry) => uploadAssetBytes(entry.name)));
      if (disposed || snapshot.status === "signed-out") {
        pushInFlight = false;
        return;
      }
      if (uploaded.some((ok) => !ok)) {
        // uploadAssetBytes already recorded "offline" + why — the manifest
        // must not go out still claiming an asset that just failed to land.
        pushInFlight = false;
        if (pushAgainAfterInFlight) {
          pushAgainAfterInFlight = false;
          schedulePush();
        }
        return;
      }
    }

    const result = await transport.putProject(baseRevision, { code, sheets, assets: manifest });
    pushInFlight = false;
    // `disposed` (tests/unmount) AND `signed-out` (M5a, review: signOut()
    // now flushes a pending push before clearing state — see `signOut`
    // below — so THIS push can genuinely still be in flight after the
    // session is already gone). Either way, the push was worth attempting
    // (its data may well have landed), but its RESULT must not resurrect a
    // status the user has already moved past — applying "idle"/"offline"/
    // "behind" here after a deliberate sign-out would silently make the
    // control look signed-in again.
    if (disposed || snapshot.status === "signed-out") return;

    if (result.ok) {
      knownRevision = result.revision;
      // Every entry THIS push just claimed is now genuinely confirmed.
      for (const entry of manifest) remoteAssetHashes.set(entry.name, entry.hash);
      setSnapshot({ status: "idle", lastSyncedAt: Date.now(), errorMessage: null });
    } else if (result.conflict) {
      setSnapshot({ status: "behind", behindRevision: result.revision, errorMessage: null });
    } else {
      setSnapshot({ status: "offline", errorMessage: result.message ?? describeFailure(result.status) });
    }

    if (pushAgainAfterInFlight) {
      pushAgainAfterInFlight = false;
      schedulePush();
    }
  }

  /**
   * Push the CURRENT local project as authoritative. Two callers that are
   * really the same operation at different base revisions:
   *  - the empty-cloud first-sign-in adopt (FIX 1) — baseRevision 0, the
   *    conditional CREATE `runPush`/the PUT route already implement via
   *    `If-None-Match: *`;
   *  - "Keep this device's work" resolving a sign-in collision (FIX 4) —
   *    baseRevision = the cloud project's revision this device just saw and
   *    declined to apply.
   * Both start from a local project whose assets may NEVER have gone through
   * the event-driven upload path (added while signed out, or on a device
   * that has never held an active session before) — `runPush` ITSELF is
   * what guarantees every asset it's about to name gets uploaded first (the
   * HIGH fix, that function's doc comment), so this only needs to point
   * `knownRevision` at the right base and make sure the LOCAL asset list is
   * current before delegating (LOW fix, below).
   *
   * `notice`: the FIX 3 confirmation to show once THIS push lands (null from
   * the collision-resolution caller, which already has its own explicit
   * "Keep this device's work" button as confirmation enough — an "adopted"
   * notice there would be actively wrong, since a cloud project demonstrably
   * already existed).
   */
  async function adoptLocalProject(baseRevision: number, notice: string | null): Promise<void> {
    // Every CURRENT call site already checks this first, but guarding here
    // too (mirrors runPush's own top-of-function check) means a future
    // caller can't reintroduce a post-dispose mutation just by forgetting to.
    if (disposed) return;
    knownRevision = baseRevision;
    setSnapshot({ status: "pushing", pullProgress: null, errorMessage: null, notice: null });
    // LOW fix (independent review): the asset store's initial IndexedDB
    // restore is itself async (assetStore.ts's `initAssetStore` fires its
    // own fire-and-forget `refresh()`) and usually — but not PROVABLY —
    // wins the race against this controller's own network GET, especially
    // for the mount-restore path (queueMicrotask-deferred, i.e. running
    // within a few ticks of page load, right when that restore is ALSO in
    // flight). Awaiting `refresh()` here removes the race entirely:
    // idempotent (a no-op once the real restore already landed —
    // `createAssetStore`'s own `metasEqual` check skips the redundant
    // notify), and correct either way — the manifest `runPush` builds right
    // after this resolves is guaranteed to see the CURRENT local library,
    // not whatever placeholder existed before IndexedDB answered.
    await assets.refresh();
    if (disposed || snapshot.status === "signed-out") return;
    await runPush();
    if (disposed) return;
    if (notice !== null && currentStatus() === "idle") setSnapshot({ notice });
  }

  /** Run a PENDING debounced push now; no-op when nothing is pending.
   * Shared by the public `flush()` method (pagehide) and `signOut()` (M5a:
   * "signing out doesn't lose anything queued" is a real claim only if
   * sign-out itself flushes — a bare timer-cancel would silently drop up to
   * 10 s of unsaved edits). */
  function flushPendingPush(): void {
    if (pushTimer === null) return;
    cancelPushTimer();
    void runPush();
  }

  function schedulePush(): void {
    if (muted || disposed) return;
    if (!isSettled(snapshot.status) && !isTransitioning(snapshot.status)) return; // signed-out
    cancelPushTimer();
    pushTimer = setTimeout(() => {
      pushTimer = null;
      // Never let a push EXECUTE mid-pull/sign-in (module note above): its
      // baseRevision could predate the pull's, and a push that lands right
      // before the pull's replaceProject overwrites it would be a genuine
      // lost edit. Re-arm instead of dropping it.
      if (isTransitioning(snapshot.status)) {
        schedulePush();
        return;
      }
      if (snapshot.status === "signed-out") return; // signed out while waiting
      void runPush();
    }, PUSH_DEBOUNCE_MS);
  }

  // -- pull ---------------------------------------------------------------

  /**
   * Downloads whatever the server's manifest has that local is missing or
   * has a stale hash for. Returns the number that FAILED to actually land —
   * MEDIUM fix (independent review): this used to swallow every per-asset
   * failure silently (a presign failure, a 404'd/failed GET, or a rejected
   * local write all just moved on to the next entry), so a caller had no
   * way to know the "loaded your cloud project" it was about to claim was
   * only partially true. `pull()`/`reload()` now hold status at "offline"
   * instead of "idle" when this returns nonzero — see their call sites.
   */
  async function pullAssets(manifest: readonly CloudAssetManifestEntry[]): Promise<number> {
    const localMetas = assets.getSnapshot().assets;
    const localByName = new Map(localMetas.map((meta) => [meta.name, meta]));
    const missing: CloudAssetManifestEntry[] = [];
    for (const entry of manifest) {
      const local = localByName.get(entry.name);
      if (local === undefined) {
        missing.push(entry);
        continue;
      }
      const stored = await assets.getBytes(entry.name);
      if (stored === null) {
        missing.push(entry);
        continue;
      }
      const localHash = await sha256Hex(await assetBytes(stored));
      if (localHash !== entry.hash) missing.push(entry);
    }
    if (missing.length === 0) return 0;

    let failed = 0;
    setSnapshot({ pullProgress: { done: 0, total: missing.length } });
    for (const [i, entry] of missing.entries()) {
      const presign = await transport.presignAssetGet(entry.name);
      if (presign.ok) {
        const bytes = await transport.downloadFromPresignedUrl(presign.url);
        if (bytes !== null) {
          try {
            await assets.upload(entry.name, entry.mime, bytes);
          } catch {
            // Rejected local write (name/mime/size somehow invalid, or the
            // local store went disabled mid-pull) — counts as failed now,
            // rather than silently skipped; the rest of the pull proceeds.
            failed++;
          }
        } else {
          failed++; // presign was fine but the GET itself came back empty
        }
      } else {
        failed++;
      }
      setSnapshot({ pullProgress: { done: i + 1, total: missing.length } });
    }
    return failed;
  }

  /**
   * Apply an already-fetched server project to local state — the shared
   * "adopt the cloud copy" tail used by a clean pull AND by "Keep cloud
   * copy" resolving a sign-in collision (FIX 4), so there's exactly one
   * place that knows how to do this rather than two copies drifting apart.
   * Muted like every other pull-driven local write (module note up top): the
   * store/asset subscriptions below must not read this as a user edit and
   * schedule a push right back.
   */
  async function applyCloudProject(
    revision: number,
    project: CloudProject,
  ): Promise<{ assetFailures: number }> {
    // Same defense-in-depth as adoptLocalProject's own top-of-function check.
    if (disposed) return { assetFailures: 0 };
    knownRevision = revision;
    // HIGH fix: every entry the SERVER's own manifest lists is, by
    // definition, confirmed present remotely with that hash — feed that
    // into the SAME tracking `runPush` uses (its doc comment), so a later
    // edit's push doesn't redundantly re-upload art this device only just
    // downloaded (or already matched by hash).
    for (const entry of project.assets) remoteAssetHashes.set(entry.name, entry.hash);
    muted = true;
    try {
      store.getState().replaceProject({ code: project.code, sheets: project.sheets });
    } finally {
      muted = false;
    }
    let assetFailures = 0;
    muted = true;
    try {
      assetFailures = await pullAssets(project.assets);
    } finally {
      muted = false;
    }
    return { assetFailures };
  }

  /**
   * `checkForCollision` (FIX 4) is true ONLY for the sign-in pull
   * (`signIn()`, below) — NOT for a "Reload" resolving an ALREADY-showing
   * 409 "behind" prompt (`reload()`'s other branch, also below). Those are
   * different situations wearing the same fetch: "behind" already means the
   * user was actively syncing and made an EXPLICIT, informed choice in
   * response to that exact prompt ("discard my unsynced edit, take
   * theirs") — running the collision heuristic AGAIN on top of an
   * unconditional user choice would either be redundant or, worse, could
   * override "Reload" with a SECOND, different prompt instead of doing what
   * was just asked. Collision detection exists for the moment sign-in
   * FIRST discovers a divergence nobody has been asked about yet.
   */
  async function pull(checkForCollision: boolean): Promise<void> {
    setSnapshot({ status: "pulling", pullProgress: null, notice: null });
    const result = await transport.getProject();
    if (disposed) return;
    if (!result.ok) {
      setSnapshot({ status: "offline", errorMessage: result.message ?? describeFailure(result.status) });
      return;
    }
    if (!result.found) {
      // FIX 1: nothing stored yet is an ADOPT, not a silent success — see
      // adoptLocalProject's doc comment and the module comment up top.
      await adoptLocalProject(0, ADOPTED_NOTICE);
      return;
    }
    if (checkForCollision) {
      // FIX 4: a found project that's genuinely DIFFERENT from local, where
      // local is ALSO not just the untouched demo, is a collision — two
      // real projects exist, and replacing either one silently would lose
      // work. Local matching the demo, or matching the server, both mean
      // nothing would be lost, so both apply immediately — unchanged from
      // before this fix (and the case every earlier test already covers).
      const local = store.getState();
      const localSeed: EditorSeed = { code: local.code, sheets: local.sheets };
      const serverSeed: EditorSeed = { code: result.project.code, sheets: result.project.sheets };
      const collides =
        !projectContentEquals(localSeed, demoSeed()) && !projectContentEquals(localSeed, serverSeed);
      if (collides) {
        setSnapshot({
          status: "conflict",
          pullProgress: null,
          conflictProject: { revision: result.revision, project: result.project },
        });
        return;
      }
    }
    const { assetFailures } = await applyCloudProject(result.revision, result.project);
    // Same sign-out-mid-flight guard as adoptLocalProject (module note
    // there): applyCloudProject's own pullAssets call can take real time.
    if (disposed || currentStatus() === "signed-out") return;
    if (assetFailures > 0) {
      // MEDIUM fix (independent review): code+sheets DID load — but
      // claiming a clean, green sync while images silently didn't come
      // down is the same class of dishonesty FIX 2 closed for the manifest
      // push, extended here to the pull side (partialPullMessage's doc
      // comment).
      setSnapshot({ status: "offline", pullProgress: null, errorMessage: partialPullMessage(assetFailures) });
      return;
    }
    setSnapshot({ status: "idle", lastSyncedAt: Date.now(), pullProgress: null, notice: LOADED_NOTICE });
  }

  // -- mount-restore (module note: confirms auth, never pulls) ------------

  function restoreSessionIfHinted(): void {
    // `disposed` guards the now-deferred (queueMicrotask) call below: this
    // controller could theoretically be disposed in the single microtask
    // turn between being scheduled and running (e.g. a rapid second
    // attach()) — a no-op in that case, not a harmful stale write.
    if (disposed || !hint.get()) return;
    setSnapshot({ status: "pulling", pullProgress: null }); // "confirming", reuses the same visible label
    void transport.getProject().then(async (result) => {
      if (disposed) return;
      if (!result.ok) {
        if (result.status === 401) {
          hint.set(false);
          setSnapshot({ status: "signed-out", errorMessage: null });
        } else {
          setSnapshot({ status: "offline", errorMessage: result.message ?? describeFailure(result.status) });
        }
        return;
      }
      if (!result.found) {
        // Same gap as pull()'s not-found branch, same fix (FIX 1): a
        // returning visit that re-confirms an active session against a
        // STILL empty bucket must not keep sitting at a quiet "idle"
        // forever — nothing remote exists to defer to here (contrast the
        // found branch below, which deliberately never touches local on a
        // mere reload — module comment up top).
        await adoptLocalProject(0, ADOPTED_NOTICE);
        return;
      }
      knownRevision = result.revision;
      setSnapshot({ status: "idle", pullProgress: null });
    });
  }

  // -- reactive wiring ------------------------------------------------------

  const unsubscribeStore = store.subscribe((state, prev) => {
    if (muted) return;
    if (state.code === prev.code && state.sheets === prev.sheets) return;
    schedulePush();
  });

  const unsubscribeAssets = assets.subscribe((event) => {
    if (muted) return;
    // remoteAssetHashes clears in lockstep with hashCache (HIGH fix): ANY
    // local mutation invalidates confidence that R2 still matches, until
    // re-confirmed by an actual successful upload or a fresh pull manifest
    // — the conservative default that makes the "unconfirmed" check in
    // runPush's doc comment sound (erring toward a redundant re-upload,
    // never toward skipping one that never happened).
    if (event.type === "put") {
      hashCache.delete(event.name);
      remoteAssetHashes.delete(event.name);
    } else if (event.type === "delete") {
      hashCache.delete(event.name);
      remoteAssetHashes.delete(event.name);
    } else if (event.type === "rename") {
      hashCache.delete(event.from);
      hashCache.delete(event.to);
      remoteAssetHashes.delete(event.from);
      remoteAssetHashes.delete(event.to);
    } else if (event.type === "clear" || event.type === "replaceAll") {
      hashCache.clear();
      remoteAssetHashes.clear();
    }
    // clear/replaceAll/disabled: no per-name remote action (module note —
    // the next push's manifest reflects the new set; individually deleting
    // REMOVED remote objects on a bulk replace is a deliberate v1 gap).
    if (event.type === "put") void uploadAssetBytes(event.name);
    else if (event.type === "delete") void deleteAssetRemote(event.name);
    else if (event.type === "rename") {
      void uploadAssetBytes(event.to).then(() => deleteAssetRemote(event.from));
    }
    schedulePush();
  });

  /**
   * Upload one asset's current bytes, presign-then-PUT (§7.6's 4.5 MB wall).
   * Returns whether it actually landed — `runPush` needs to know before it
   * dares send a manifest that names this asset, or the manifest would
   * reference bytes that never arrived (the exact shape of bug this whole
   * fix exists to close). The ordinary event listener below still fires
   * this with `void` and ignores the result — a live put has nothing
   * further gated on it succeeding.
   */
  async function uploadAssetBytes(name: string): Promise<boolean> {
    if (!canMutateRemoteAssets(snapshot.status)) return false;
    const stored = await assets.getBytes(name);
    if (stored === null) return true; // vanished locally before we got to it — nothing to upload
    const bytes = await assetBytes(stored);
    const presign = await transport.presignAssetPut(name, stored.mime, bytes.byteLength);
    if (!presign.ok) {
      const reason = presign.message ?? describeFailure(presign.status);
      setSnapshot({ status: "offline", errorMessage: `Couldn't upload image "${name}": ${reason}` });
      return false;
    }
    const uploaded = await transport.uploadToPresignedUrl(presign.url, bytes, stored.mime);
    if (!uploaded) {
      setSnapshot({ status: "offline", errorMessage: `Couldn't upload image "${name}".` });
      return false;
    }
    // HIGH fix: this is the ONE place that gets to say "R2 actually has
    // this name with this exact content" — record it immediately. Also
    // populates hashCache, so a manifest built moments later (this push or
    // a future one) doesn't rehash bytes this call already hashed.
    const hash = await sha256Hex(bytes);
    hashCache.set(name, hash);
    remoteAssetHashes.set(name, hash);
    return true;
  }

  async function deleteAssetRemote(name: string): Promise<void> {
    if (!canMutateRemoteAssets(snapshot.status)) return;
    const result = await transport.deleteAsset(name);
    if (!result.ok) {
      setSnapshot({ status: "offline", errorMessage: result.message ?? describeFailure(result.status) });
    }
  }

  // Deferred a microtask (NOT called synchronously here) — a real bug found
  // during review: the singleton's `attach()` calls `createCloudSyncController`
  // and THEN wires the forwarding subscription on its next line (it has to —
  // `active.subscribe` doesn't exist until `active` does). Calling
  // `restoreSessionIfHinted` synchronously, right here, fires its FIRST
  // `setSnapshot` (→ "pulling") before that forwarding subscription exists,
  // so it would silently never reach anything subscribed to the STABLE
  // singleton object from before the attach — exactly the class of bug this
  // controller's whole forwarding design (module comment on `makeSingleton`)
  // exists to prevent. `queueMicrotask` runs this once the current
  // synchronous call stack — which includes the REST of `attach()` wiring
  // the subscription — has fully unwound, so the FIRST transition is never
  // dropped. (Direct, non-singleton callers of `createCloudSyncController`,
  // e.g. tests, already `await` at least one tick before asserting, so this
  // costs them nothing.)
  if (hint.get()) queueMicrotask(restoreSessionIfHinted);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async signIn(username, password) {
      setSnapshot({ status: "signing-in", errorMessage: null });
      const result = await transport.login(username, password);
      if (!result.ok) {
        setSnapshot({ status: "signed-out" });
        return { ok: false, message: signInFailureMessage(result.status) };
      }
      hint.set(true);
      await pull(/* checkForCollision */ true); // FIX 4 — see pull()'s doc comment
      return { ok: true };
    },

    signOut() {
      // M5a (review): flush BEFORE clearing knownRevision/hashCache — a
      // push started here reads them synchronously at the top of runPush,
      // so clearing first would send a wrong baseRevision. The push is
      // fire-and-forget (signOut() itself stays synchronous, matching the
      // CloudSyncController interface) — its eventual result is guarded
      // against landing after the fact by runPush's own `signed-out` check.
      flushPendingPush();
      hint.set(false);
      void transport.logout();
      knownRevision = 0;
      hashCache.clear();
      setSnapshot({
        status: "signed-out",
        lastSyncedAt: null,
        pullProgress: null,
        errorMessage: null,
        behindRevision: null,
        conflictProject: null,
        notice: null,
      });
    },

    async reload() {
      if (snapshot.status === "conflict") {
        // FIX 4's "Keep cloud copy": apply the copy `pull()` already
        // fetched rather than re-fetching — no second network round trip,
        // and no risk of a DIFFERENT server state answering this GET than
        // the one the prompt described.
        const pending = snapshot.conflictProject;
        if (pending === null || disposed) return;
        cancelPushTimer();
        const { assetFailures } = await applyCloudProject(pending.revision, pending.project);
        // Same sign-out-mid-flight guard as pull()'s clean-apply branch.
        if (disposed || currentStatus() === "signed-out") return;
        if (assetFailures > 0) {
          // MEDIUM fix (independent review): "worse in the conflict path,
          // where reload() has just discarded local work" — the code+sheets
          // choice ("Keep cloud copy") is unconditional and already took
          // effect above, so conflictProject still clears either way, but a
          // partial image failure must not ALSO claim a clean green sync.
          setSnapshot({
            status: "offline",
            pullProgress: null,
            conflictProject: null,
            errorMessage: partialPullMessage(assetFailures),
          });
          return;
        }
        setSnapshot({
          status: "idle",
          lastSyncedAt: Date.now(),
          pullProgress: null,
          notice: LOADED_NOTICE,
          conflictProject: null,
        });
        return;
      }
      // Deliberately does NOT flush (contrast signOut): "Reload" means
      // discard this browser's unsynced edits and take the server's copy —
      // pushing them first would defeat the entire point of the choice.
      // checkForCollision is false: this Reload IS the user's answer to an
      // ALREADY-showing "behind" prompt (pull()'s doc comment) — it must
      // unconditionally take the server's copy, not run the heuristic again.
      cancelPushTimer();
      await pull(false);
    },

    async overwrite() {
      if (snapshot.status === "conflict") {
        // FIX 4's "Keep this device's work": the SAME adopt an empty-cloud
        // first sign-in uses, based at the revision this device just saw —
        // a 409 here (someone pushed AGAIN before this resolved) surfaces
        // the ordinary "behind" prompt via runPush's own conflict handling,
        // never a clobber.
        const pending = snapshot.conflictProject;
        if (pending === null || disposed) return;
        cancelPushTimer();
        await adoptLocalProject(pending.revision, null);
        if (disposed) return;
        // HIGH fix (independent review): only clear the pending choice on
        // an actual SUCCESS. adoptLocalProject can bail without ever
        // reaching putProject (an asset upload failure → "offline") or
        // land a 409 (a THIRD device won the race → "behind") — clearing
        // conflictProject unconditionally made "Keep this device's work"
        // silently evaporate in either case, with no record a choice was
        // ever made and the prompt already gone. Status reads "idle" ONLY
        // once adoptLocalProject's runPush has actually succeeded (that
        // function's own doc comment).
        if (currentStatus() === "idle") setSnapshot({ conflictProject: null });
        return;
      }
      if (snapshot.behindRevision === null) return;
      knownRevision = snapshot.behindRevision;
      cancelPushTimer();
      await runPush();
    },

    flush: flushPendingPush,

    dispose() {
      disposed = true;
      cancelPushTimer();
      unsubscribeStore();
      unsubscribeAssets();
      listeners.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton wiring (browser-only, forwarding pattern — mirrors assetStore.ts)
// ---------------------------------------------------------------------------

/**
 * A transport that answers every call with a clean, immediate failure —
 * never throws, never hangs, never touches the network. This is what the
 * singleton's PLACEHOLDER controller (below) is built on before
 * `initCloudSync()` ever runs, so that if anything DID call `signIn()` in
 * that window it would fail exactly like being offline, not crash.
 */
function createInertTransport(): CloudTransport {
  const networkFailure = { ok: false, status: "network" } as const;
  return {
    async login() {
      return networkFailure;
    },
    async logout() {},
    async getProject() {
      return networkFailure;
    },
    async putProject() {
      return { ok: false, conflict: false, status: "network" };
    },
    async presignAssetPut() {
      return networkFailure;
    },
    async presignAssetGet() {
      return networkFailure;
    },
    async deleteAsset() {
      return networkFailure;
    },
    async uploadToPresignedUrl() {
      return false;
    },
    async downloadFromPresignedUrl() {
      return null;
    },
  };
}

/**
 * Builds a STABLE `CloudSyncController` object (mirrors assetStore.ts's
 * `makeSingleton`, module comment there explains why this shape exists):
 * every method delegates to a swappable `active` controller, and
 * `subscribe` registers into a forwarding listener Set that OUTLIVES any
 * `attach()` call. This is what fixes the alternative (a `| null` singleton
 * a component reads directly): `cloudSyncControl.tsx` subscribes to this
 * ONE stable object on mount, before `initCloudSync()` has necessarily run
 * (React effects fire child-before-parent, and `initCloudSync()` runs from
 * panelLayout's effect) — with a `| null` singleton, a subscription taken
 * out against "null" would need SOME LATER, unrelated re-render to ever
 * notice the real controller had attached (this project's earlier draft had
 * exactly that bug: a signed-in user's status could show "Sign in" for up
 * to 30 s after a reload, until an unrelated timer forced a re-render).
 * Forwarding closes it: `attach()` swaps `active` and REWIRES the forward
 * subscription, so every listener already registered gets the real
 * controller's events from the moment it attaches, with no gap.
 */
function makeSingleton(): {
  controller: CloudSyncController;
  attach(deps: CloudSyncDeps): void;
} {
  const inertDeps = (): CloudSyncDeps => ({
    store: editorStore,
    assets: assetStore,
    transport: createInertTransport(),
    hint: createInertHint(), // always reports false — never auto-probes
  });

  let active = createCloudSyncController(inertDeps());
  const forwardedListeners = new Set<() => void>();
  let forwardUnsubscribe = active.subscribe(() => {
    for (const listener of forwardedListeners) listener();
  });

  const controller: CloudSyncController = {
    getSnapshot: () => active.getSnapshot(),
    subscribe: (listener) => {
      forwardedListeners.add(listener);
      return () => forwardedListeners.delete(listener);
    },
    signIn: (username, password) => active.signIn(username, password),
    signOut: () => active.signOut(),
    reload: () => active.reload(),
    overwrite: () => active.overwrite(),
    flush: () => active.flush(),
    dispose: () => active.dispose(),
  };

  return {
    controller,
    attach(deps) {
      forwardUnsubscribe();
      active.dispose(); // unsubscribe the OLD active controller from editorStore/assetStore
      active = createCloudSyncController(deps);
      forwardUnsubscribe = active.subscribe(() => {
        for (const listener of forwardedListeners) listener();
      });
    },
  };
}

const singleton = makeSingleton();

/** The app's singleton (SSR-safe: starts wired to an inert, always-
 * signed-out controller, so `getSnapshot()` is safe during prerender/before
 * mount — mirrors assetStore.ts's exported `assetStore`). Consumed from
 * "use client" components (cloudSyncControl.tsx) and nowhere else. */
export const cloudSync: CloudSyncController = singleton.controller;

let initialized = false;

/**
 * Attach the real transport + localStorage-backed hint. Idempotent
 * (StrictMode double-mount) and a no-op without `window` (SSR). Must run
 * AFTER `initEditorPersistence`/`initAssetStore` (panelLayout.tsx's
 * ordering) — this controller's store/asset subscriptions must only see
 * changes from here on, same rule as `initEditorPersistence`'s own doc
 * comment, so it never mistakes the LOCAL autosave restore for a change to
 * push. Subscribers attached before this call (any component already
 * mounted) keep hearing about changes once the real controller attaches
 * (module note on `makeSingleton` above).
 */
export function initCloudSync(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  initialized = true;

  let hint: SignedInHint;
  try {
    hint = createLocalStorageHint(window.localStorage);
  } catch {
    hint = createInertHint(); // matches persistence.ts's "even ACCESSING can throw" posture
  }

  singleton.attach({ store: editorStore, assets: assetStore, transport: createRealCloudTransport(), hint });
  window.addEventListener("pagehide", () => cloudSync.flush());
}

/** Test seam: rewind the singleton to its pre-init (inert) state
 * (module-scoped state otherwise leaks between test files — mirrors
 * resetAssetStoreForTests). */
export function resetCloudSyncForTests(): void {
  initialized = false;
  singleton.attach({
    store: editorStore,
    assets: assetStore,
    transport: createInertTransport(),
    hint: createInertHint(),
  });
}

/** Test seam: attach the singleton with FULL control over `deps` — unlike
 * `resetCloudSyncForTests` (always an inert hint), this drives the exact
 * `initCloudSync()` codepath a HINTED mount-restore takes, without needing
 * `window`/localStorage. */
export function attachCloudSyncForTests(deps: CloudSyncDeps): void {
  initialized = true;
  singleton.attach(deps);
}
