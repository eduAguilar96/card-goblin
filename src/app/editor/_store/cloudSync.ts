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
 *
 * - PULL happens exactly once per sign-in (brief D) — not on every reload.
 *   A reload with a previously-signed-in hint only RE-CONFIRMS the session
 *   (a side-effect-free GET) and records the server's revision; it never
 *   calls `replaceProject`. Rationale: this browser's local project is
 *   already authoritative for ITSELF (local-first) — blindly re-pulling on
 *   every reload risks clobbering an edit this browser made while offline
 *   and never got to push. Divergence is instead caught the existing way:
 *   the next PUSH's `baseRevision` won't match, surfacing the SAME
 *   Reload/Overwrite prompt a live conflict would.
 * - PUSH is content-based and un-opinionated: whatever `editorStore.code`/
 *   `.sheets` currently ARE gets pushed, ~10 s after the last change,
 *   including a `replaceProject` call from Reset-to-demo or a project-file
 *   import — the cloud mirrors whatever local ends up being, consistently,
 *   rather than special-casing which kinds of local changes count.
 * - A push's OWN `replaceProject`/asset-store calls (the pull path) are
 *   MUTED from re-triggering a push — same idiom persistence.ts's
 *   `resetToDemo` uses, extended to also cover the pull's asset downloads
 *   (module note on `muted` below).
 * - A push is never allowed to EXECUTE while pulling/signing-in — its debounce
 *   timer re-arms instead of firing (see `runPush`'s doc comment) — closing a
 *   race where a push using a pre-pull `knownRevision` succeeds and is then
 *   immediately clobbered by the in-flight pull's own `replaceProject`,
 *   which would be a genuine lost edit.
 *
 * ASSETS: byte transfer (upload/delete) happens immediately per event, not
 * on the 10 s debounce — only the project.json MANIFEST (name/mime/size/
 * hash, no bytes) rides the debounced push. `clear`/`replaceAll` events
 * (reset-to-demo, a project-file import while signed in) do NOT individually
 * clean up remote objects — an accepted v1 gap, documented on the listener
 * below and called out in the report.
 */

import { editorStore, type EditorStore } from "@/app/editor/_store/editorStore";
import { assetStore, type AssetStore, type StoredAsset } from "@/app/editor/_store/assetStore";
import type { CloudAssetManifestEntry, CloudProject } from "@/lib/cloud/projectPayload";

// ---------------------------------------------------------------------------
// Transport — the injectable network seam (mirrors ProjectStorage/AssetAdapter)
// ---------------------------------------------------------------------------

export type CloudFailure = { ok: false; status: number | "network" };

export type LoginResult = { ok: true } | CloudFailure;

export type GetProjectResult =
  | { ok: true; found: true; revision: number; project: CloudProject }
  | { ok: true; found: false }
  | CloudFailure;

export type PutProjectResult =
  | { ok: true; revision: number }
  | { ok: false; conflict: true; revision: number }
  | { ok: false; conflict: false; status: number | "network" };

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
        if (!res.ok) return { ok: false, status: res.status };
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
        if (!res.ok) return { ok: false, conflict: false, status: res.status };
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
        if (!res.ok) return { ok: false, status: res.status };
        const data = await toJson<{ url: string }>(res);
        return { ok: true, url: data.url };
      } catch {
        return { ok: false, status: "network" };
      }
    },

    async presignAssetGet(name) {
      try {
        const res = await fetch(`/api/cloud/assets/${encodeURIComponent(name)}`, { method: "GET" });
        if (!res.ok) return { ok: false, status: res.status };
        const data = await toJson<{ url: string }>(res);
        return { ok: true, url: data.url };
      } catch {
        return { ok: false, status: "network" };
      }
    },

    async deleteAsset(name) {
      try {
        const res = await fetch(`/api/cloud/assets/${encodeURIComponent(name)}`, { method: "DELETE" });
        return res.ok ? { ok: true } : { ok: false, status: res.status };
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
// Controller
// ---------------------------------------------------------------------------

export type CloudSyncStatus =
  | "signed-out"
  | "signing-in"
  | "pulling"
  | "idle"
  | "pushing"
  | "offline"
  | "behind";

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
  /** The "behind" prompt's two answers (brief D, both tested). */
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
const isTransitioning = (status: CloudSyncStatus): boolean =>
  status === "signing-in" || status === "pulling";

function describeFailure(status: number | "network"): string {
  if (status === "network") return "Can't reach the network.";
  if (status === 401) return "Signed out on the server — sign in again to keep syncing.";
  if (status === 503) return "Cloud sync isn't set up on this server.";
  return `Cloud sync error (${status}).`;
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
  const hashCache = new Map<string, string>(); // asset name -> sha256 hex

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const setSnapshot = (patch: Partial<CloudSyncSnapshot>): void => {
    snapshot = { ...snapshot, ...patch };
    notify();
  };

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
    setSnapshot({ status: "pushing" });
    const { code, sheets } = store.getState();
    const manifest = await buildAssetManifest();
    const result = await transport.putProject(knownRevision, { code, sheets, assets: manifest });
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
      setSnapshot({ status: "idle", lastSyncedAt: Date.now(), errorMessage: null });
    } else if (result.conflict) {
      setSnapshot({ status: "behind", behindRevision: result.revision, errorMessage: null });
    } else {
      setSnapshot({ status: "offline", errorMessage: describeFailure(result.status) });
    }

    if (pushAgainAfterInFlight) {
      pushAgainAfterInFlight = false;
      schedulePush();
    }
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

  async function pullAssets(manifest: readonly CloudAssetManifestEntry[]): Promise<void> {
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
    if (missing.length === 0) return;

    setSnapshot({ pullProgress: { done: 0, total: missing.length } });
    for (const [i, entry] of missing.entries()) {
      const presign = await transport.presignAssetGet(entry.name);
      if (presign.ok) {
        const bytes = await transport.downloadFromPresignedUrl(presign.url);
        if (bytes !== null) {
          try {
            await assets.upload(entry.name, entry.mime, bytes);
          } catch {
            // Best-effort — a rejected local write (name/mime/size somehow
            // invalid, or the local store went disabled mid-pull) skips
            // this one asset; the rest of the pull still proceeds.
          }
        }
      }
      setSnapshot({ pullProgress: { done: i + 1, total: missing.length } });
    }
  }

  async function pull(): Promise<void> {
    setSnapshot({ status: "pulling", pullProgress: null });
    const result = await transport.getProject();
    if (disposed) return;
    if (!result.ok) {
      setSnapshot({ status: "offline", errorMessage: describeFailure(result.status) });
      return;
    }
    if (!result.found) {
      knownRevision = 0;
      setSnapshot({ status: "idle", lastSyncedAt: Date.now(), pullProgress: null });
      return;
    }
    knownRevision = result.revision;
    muted = true;
    try {
      store.getState().replaceProject({ code: result.project.code, sheets: result.project.sheets });
    } finally {
      muted = false;
    }
    muted = true;
    try {
      await pullAssets(result.project.assets);
    } finally {
      muted = false;
    }
    if (disposed) return;
    setSnapshot({ status: "idle", lastSyncedAt: Date.now(), pullProgress: null });
  }

  // -- mount-restore (module note: confirms auth, never pulls) ------------

  function restoreSessionIfHinted(): void {
    // `disposed` guards the now-deferred (queueMicrotask) call below: this
    // controller could theoretically be disposed in the single microtask
    // turn between being scheduled and running (e.g. a rapid second
    // attach()) — a no-op in that case, not a harmful stale write.
    if (disposed || !hint.get()) return;
    setSnapshot({ status: "pulling", pullProgress: null }); // "confirming", reuses the same visible label
    void transport.getProject().then((result) => {
      if (disposed) return;
      if (!result.ok) {
        if (result.status === 401) {
          hint.set(false);
          setSnapshot({ status: "signed-out", errorMessage: null });
        } else {
          setSnapshot({ status: "offline", errorMessage: describeFailure(result.status) });
        }
        return;
      }
      knownRevision = result.found ? result.revision : 0;
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
    if (event.type === "put") hashCache.delete(event.name);
    else if (event.type === "delete") hashCache.delete(event.name);
    else if (event.type === "rename") {
      hashCache.delete(event.from);
      hashCache.delete(event.to);
    } else if (event.type === "clear" || event.type === "replaceAll") {
      hashCache.clear();
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

  async function uploadAssetBytes(name: string): Promise<void> {
    if (!isSettled(snapshot.status) && !isTransitioning(snapshot.status)) return;
    const stored = await assets.getBytes(name);
    if (stored === null) return; // vanished locally before we got to it
    const bytes = await assetBytes(stored);
    const presign = await transport.presignAssetPut(name, stored.mime, bytes.byteLength);
    if (!presign.ok) {
      setSnapshot({ status: "offline", errorMessage: describeFailure(presign.status) });
      return;
    }
    const uploaded = await transport.uploadToPresignedUrl(presign.url, bytes, stored.mime);
    if (!uploaded) setSnapshot({ status: "offline", errorMessage: "Couldn't upload an image." });
  }

  async function deleteAssetRemote(name: string): Promise<void> {
    if (!isSettled(snapshot.status) && !isTransitioning(snapshot.status)) return;
    const result = await transport.deleteAsset(name);
    if (!result.ok) setSnapshot({ status: "offline", errorMessage: describeFailure(result.status) });
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
      await pull();
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
      });
    },

    async reload() {
      // Deliberately does NOT flush (contrast signOut): "Reload" means
      // discard this browser's unsynced edits and take the server's copy —
      // pushing them first would defeat the entire point of the choice.
      cancelPushTimer();
      await pull();
    },

    async overwrite() {
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
