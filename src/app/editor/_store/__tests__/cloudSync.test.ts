/**
 * Cloud sync client controller (DESIGN.md §7.6), exercised headless against
 * a hand-built fake `CloudTransport` (no network — brief F) plus real
 * `createEditorStore`/`createAssetStore` instances, exactly like
 * persistence.test.ts's pattern. Covers: sign-in pull (writes missing
 * assets, skips ones already present, reports coarse progress), push
 * debounce timing + pagehide flush, the 409 Reload/Overwrite paths, every
 * failure mode degrading to a quiet local-only state with the editor still
 * fully usable, and that signed-out touches the transport not at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorStore, type EditorStore } from "@/app/editor/_store/editorStore";
import { createAssetStore, createInMemoryAssetAdapter, type AssetStore } from "@/app/editor/_store/assetStore";
import type { CloudAssetManifestEntry, CloudProject } from "@/lib/cloud/projectPayload";
import {
  attachCloudSyncForTests,
  cloudSync,
  createCloudSyncController,
  resetCloudSyncForTests,
  signInFailureMessage,
  PUSH_DEBOUNCE_MS,
  type CloudFailure,
  type CloudSyncController,
  type CloudTransport,
  type GetProjectResult,
  type OkResult,
  type PresignResult,
  type PutProjectResult,
  type SignedInHint,
  createRealCloudTransport,
} from "../cloudSync";

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// signInFailureMessage — direct pin (independent security review, HIGH):
// 401 must be checked EXPLICITLY, never "whatever falls through" — the bug
// that shipped was exactly a 404 (a route that isn't deployed) silently
// reading as "Incorrect username or password."
// ---------------------------------------------------------------------------

describe("signInFailureMessage", () => {
  it("401: the credentials copy — and ONLY 401 gets it", () => {
    expect(signInFailureMessage(401)).toBe("Incorrect username or password.");
  });

  it("503: names /api/cloud/diagnose and the deployment guide", () => {
    const message = signInFailureMessage(503);
    expect(message).toContain("/api/cloud/diagnose");
    expect(message).toContain("docs/deployment.md");
  });

  it('"network": offline copy', () => {
    expect(signInFailureMessage("network")).toContain("network");
  });

  it("500/502: the generic server-error copy, NOT the credentials copy", () => {
    expect(signInFailureMessage(500)).not.toContain("Incorrect");
    expect(signInFailureMessage(502)).not.toContain("Incorrect");
  });

  it(
    "404 (THE bug this fix closes): NOT the credentials copy — the exact outage this " +
      "whole task exists to diagnose must never be reported as a wrong password",
    () => {
      const message = signInFailureMessage(404);
      expect(message).not.toContain("Incorrect username or password");
      expect(message).toContain("404");
      expect(message).toContain("/api/cloud/diagnose");
    },
  );

  it("every other unrecognized status (400, 403, 200) also avoids the credentials copy, naming its own code", () => {
    for (const status of [400, 403, 200]) {
      const message = signInFailureMessage(status);
      expect(message, `status ${status}`).not.toContain("Incorrect username or password");
      expect(message, `status ${status}`).toContain(String(status));
    }
  });

  it("no two of the six cases above collapse to the same copy (they're each their own test above; this just pins the count)", () => {
    const messages = [401, 503, "network", 500, 404, 400].map((s) => signInFailureMessage(s as number | "network"));
    expect(new Set(messages).size).toBe(6);
  });
});

/** The username every `harness()`-built fake transport accepts (TASK 4) —
 * most tests below only care that sign-in SUCCEEDS, not which username won,
 * so a single shared constant keeps the ~30 `controller.signIn(...)` call
 * sites below from each inventing their own. */
const GOOD_USERNAME = "the-operator";

/** Drain the ENTIRE current microtask queue, including chains that
 * reschedule further microtasks (a single `await Promise.resolve()` only
 * advances one tick, which isn't enough for e.g. `uploadAssetBytes`'s
 * `getBytes → presignAssetPut → uploadToPresignedUrl` chain). A real
 * `setTimeout` macrotask only runs after Node has exhausted the microtask
 * queue completely, so waiting on one is a robust "everything pending has
 * settled" — used only in tests that keep real timers. */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function fakeHint(initial = false): SignedInHint & { history: boolean[] } {
  let value = initial;
  const history: boolean[] = [];
  return {
    history,
    get: () => value,
    set: (v) => {
      value = v;
      history.push(v);
    },
  };
}

interface FakeServerAsset {
  bytes: Uint8Array;
  mime: string;
}

/** An in-memory "R2 + routes" stand-in implementing CloudTransport directly
 * — deliberately hand-rolled rather than routed through the real routes, so
 * these tests exercise cloudSync.ts's OWN logic (debounce/mute/state
 * machine) in isolation. Route+auth+storage correctness has its own test
 * file. `calls` counts invocations per method for assertions like "never
 * touched the network while signed out". */
function createFakeTransport(): CloudTransport & {
  calls: Record<string, number>;
  server: { revision: number; project: CloudProject | null; assets: Map<string, FakeServerAsset> };
  loginUsername: string | null;
  loginPassword: string | null;
  nextFailure: Partial<Record<keyof CloudTransport, number | "network">>;
} {
  const calls: Record<string, number> = {};
  const bump = (name: string): void => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const server: { revision: number; project: CloudProject | null; assets: Map<string, FakeServerAsset> } = {
    revision: 0,
    project: null,
    assets: new Map(),
  };
  const nextFailure: Partial<Record<keyof CloudTransport, number | "network">> = {};
  let loginUsername: string | null = GOOD_USERNAME;
  let loginPassword: string | null = "correct-password";

  const fail = <T extends CloudFailure>(name: keyof CloudTransport): T | null => {
    const status = nextFailure[name];
    if (status === undefined) return null;
    delete nextFailure[name];
    return { ok: false, status } as T;
  };

  return {
    calls,
    server,
    nextFailure,
    get loginUsername() {
      return loginUsername;
    },
    set loginUsername(v) {
      loginUsername = v;
    },
    get loginPassword() {
      return loginPassword;
    },
    set loginPassword(v) {
      loginPassword = v;
    },

    // TASK 4: both fields checked, mirroring the real login route folding
    // wrong-username/wrong-password/both-wrong into the same 401 — this fake
    // doesn't need to reproduce the timing/message indistinguishability
    // itself (that's routes.test.ts's job against the REAL route), just
    // enough behavior for cloudSync.ts's OWN plumbing to be exercised.
    async login(username, password) {
      bump("login");
      const failure = fail("login");
      if (failure) return failure;
      return username === loginUsername && password === loginPassword ? { ok: true } : { ok: false, status: 401 };
    },

    async logout() {
      bump("logout");
    },

    async getProject(): Promise<GetProjectResult> {
      bump("getProject");
      const failure = fail<CloudFailure>("getProject");
      if (failure) return failure;
      if (server.project === null) return { ok: true, found: false };
      return { ok: true, found: true, revision: server.revision, project: server.project };
    },

    async putProject(baseRevision, project): Promise<PutProjectResult> {
      bump("putProject");
      const failure = nextFailure.putProject;
      if (failure !== undefined) {
        delete nextFailure.putProject;
        return { ok: false, conflict: false, status: failure };
      }
      if (baseRevision !== server.revision) {
        return { ok: false, conflict: true, revision: server.revision };
      }
      server.revision += 1;
      server.project = project;
      return { ok: true, revision: server.revision };
    },

    async presignAssetPut(name): Promise<PresignResult> {
      bump("presignAssetPut");
      const failure = fail<CloudFailure>("presignAssetPut");
      if (failure) return failure;
      return { ok: true, url: `fake://put/${name}` };
    },

    async presignAssetGet(name): Promise<PresignResult> {
      bump("presignAssetGet");
      const failure = fail<CloudFailure>("presignAssetGet");
      if (failure) return failure;
      return { ok: true, url: `fake://get/${name}` };
    },

    async deleteAsset(name): Promise<OkResult> {
      bump("deleteAsset");
      const failure = fail<CloudFailure>("deleteAsset");
      if (failure) return failure;
      server.assets.delete(name);
      return { ok: true };
    },

    async uploadToPresignedUrl(url, bytes, mime) {
      bump("uploadToPresignedUrl");
      if (nextFailure.uploadToPresignedUrl !== undefined) {
        delete nextFailure.uploadToPresignedUrl;
        return false;
      }
      const name = url.replace("fake://put/", "");
      server.assets.set(name, { bytes, mime });
      return true;
    },

    async downloadFromPresignedUrl(url) {
      bump("downloadFromPresignedUrl");
      if (nextFailure.downloadFromPresignedUrl !== undefined) {
        delete nextFailure.downloadFromPresignedUrl;
        return null;
      }
      const name = url.replace("fake://get/", "");
      return server.assets.get(name)?.bytes ?? null;
    },
  };
}

function harness(): {
  store: EditorStore;
  assetStore: AssetStore;
  transport: ReturnType<typeof createFakeTransport>;
  hint: ReturnType<typeof fakeHint>;
  controller: CloudSyncController;
} {
  const assetStore = createAssetStore(createInMemoryAssetAdapter());
  const store = createEditorStore(undefined, assetStore);
  const transport = createFakeTransport();
  const hint = fakeHint();
  const controller = createCloudSyncController({ store, assets: assetStore, transport, hint });
  return { store, assetStore, transport, hint, controller };
}

// ---------------------------------------------------------------------------
// Signed-out: zero behavior change (brief D)
// ---------------------------------------------------------------------------

describe("signed-out (the default)", () => {
  it("starts signed-out, and editing never touches the transport", async () => {
    const { store, controller, transport } = harness();
    expect(controller.getSnapshot().status).toBe("signed-out");
    store.getState().setCode(store.getState().code + "\n# note\n");
    store.getState().setCell("Monsters", 0, "health", "9");
    await Promise.resolve();
    expect(Object.keys(transport.calls)).toHaveLength(0);
  });

  it("an asset upload while signed out never reaches the transport", async () => {
    const { assetStore, controller, transport } = harness();
    await assetStore.upload("dragon", "image/png", new Uint8Array([1, 2, 3]));
    expect(controller.getSnapshot().status).toBe("signed-out");
    expect(Object.keys(transport.calls)).toHaveLength(0);
  });

  it("a hint of false never probes the session on construction", () => {
    const { transport } = harness();
    expect(transport.calls.getProject).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sign-in + pull (brief D)
// ---------------------------------------------------------------------------

describe("sign-in", () => {
  it("wrong password: stays signed-out, returns a generic message, sets no hint", async () => {
    const { controller, hint } = harness();
    const result = await controller.signIn(GOOD_USERNAME, "nope");
    expect(result).toEqual({ ok: false, message: "Incorrect username or password." });
    expect(controller.getSnapshot().status).toBe("signed-out");
    expect(hint.get()).toBe(false);
  });

  it("wrong username (TASK 4): the SAME generic message as a wrong password — cloudSync.ts doesn't invent its own distinction", async () => {
    const { controller, hint } = harness();
    const result = await controller.signIn("not-the-operator", "correct-password");
    expect(result).toEqual({ ok: false, message: "Incorrect username or password." });
    expect(controller.getSnapshot().status).toBe("signed-out");
    expect(hint.get()).toBe(false);
  });

  it("unconfigured (503): a distinct message naming /api/cloud/diagnose and the deployment guide, still signed-out", async () => {
    const { controller, transport } = harness();
    transport.nextFailure.login = 503;
    const result = await controller.signIn(GOOD_USERNAME, "correct-password");
    expect(result).toEqual({
      ok: false,
      message:
        "Cloud sync isn't set up on this server. Check /api/cloud/diagnose for details, or see the deployment guide (docs/deployment.md).",
    });
    expect(controller.getSnapshot().status).toBe("signed-out");
  });

  it("network failure while signing in degrades to a signed-out message, no throw", async () => {
    const { controller, transport } = harness();
    transport.nextFailure.login = "network";
    const result = await controller.signIn(GOOD_USERNAME, "correct-password");
    expect(result).toEqual({ ok: false, message: "Can't reach the network. Check your connection and try again." });
  });

  it("success with nothing on the server yet: idle, revision 0, no replaceProject clobber", async () => {
    const { store, controller, hint } = harness();
    const before = store.getState().code;
    const result = await controller.signIn(GOOD_USERNAME, "correct-password");
    expect(result).toEqual({ ok: true });
    expect(hint.get()).toBe(true);
    expect(controller.getSnapshot().status).toBe("idle");
    expect(controller.getSnapshot().lastSyncedAt).not.toBeNull();
    expect(store.getState().code).toBe(before); // nothing to pull — local stands
  });

  it("success with a server project: replaces local code/sheets", async () => {
    const { store, controller, transport } = harness();
    transport.server.revision = 5;
    transport.server.project = {
      code: "Sheet: S\n  column a: Text\n",
      sheets: { S: { rows: [{ a: "from-cloud" }], editedRows: [true] } },
      assets: [],
    };
    const result = await controller.signIn(GOOD_USERNAME, "correct-password");
    expect(result).toEqual({ ok: true });
    expect(store.getState().code).toBe("Sheet: S\n  column a: Text\n");
    expect(store.getState().sheets.S.rows[0].a).toBe("from-cloud");
    expect(controller.getSnapshot().status).toBe("idle");
  });

  it("the pull's own replaceProject does NOT itself schedule a push (muted)", async () => {
    vi.useFakeTimers();
    const { controller, transport } = harness();
    transport.server.revision = 3;
    transport.server.project = { code: "Sheet: S\n  column a: Text\n", sheets: {}, assets: [] };
    await controller.signIn(GOOD_USERNAME, "correct-password");
    const putCallsBefore = transport.calls.putProject ?? 0;
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS * 2);
    expect(transport.calls.putProject ?? 0).toBe(putCallsBefore);
  });

  it("pulls assets: downloads ones missing locally, skips ones already present with a matching hash", async () => {
    const { assetStore, controller, transport } = harness();
    const dragonBytes = new Uint8Array([1, 2, 3, 4]);
    const impBytes = new Uint8Array([9, 9, 9]);
    // Pre-seed the LOCAL store with "imp" already present (same content the
    // server has) — a real content hash, computed the same way the
    // controller does, so the pull recognizes it as already-present.
    const impHash = await sha256HexForTest(impBytes);
    const dragonHash = await sha256HexForTest(dragonBytes);
    await assetStore.upload("imp", "image/png", impBytes);

    transport.server.revision = 1;
    transport.server.assets.set("dragon", { bytes: dragonBytes, mime: "image/png" });
    transport.server.assets.set("imp", { bytes: impBytes, mime: "image/png" });
    transport.server.project = {
      code: "",
      sheets: {},
      assets: [
        { name: "dragon", mime: "image/png", size: dragonBytes.byteLength, hash: dragonHash },
        { name: "imp", mime: "image/png", size: impBytes.byteLength, hash: impHash },
      ],
    };

    await controller.signIn(GOOD_USERNAME, "correct-password");

    // Only "dragon" was actually downloaded — "imp" already matched.
    expect(transport.calls.presignAssetGet).toBe(1);
    expect(transport.calls.downloadFromPresignedUrl).toBe(1);
    const local = assetStore.getSnapshot().assets.map((a) => a.name).sort();
    expect(local).toEqual(["dragon", "imp"]);
    const pulled = await assetStore.getBytes("dragon");
    expect(pulled?.bytes).toEqual(dragonBytes);
  });

  it("pulls a DIFFERING same-name asset (hash mismatch) — re-downloads and overwrites", async () => {
    const { assetStore, controller, transport } = harness();
    const oldBytes = new Uint8Array([1]);
    const newBytes = new Uint8Array([2, 2]);
    await assetStore.upload("dragon", "image/png", oldBytes);
    transport.server.revision = 1;
    transport.server.assets.set("dragon", { bytes: newBytes, mime: "image/png" });
    transport.server.project = {
      code: "",
      sheets: {},
      assets: [
        { name: "dragon", mime: "image/png", size: newBytes.byteLength, hash: await sha256HexForTest(newBytes) },
      ],
    };
    await controller.signIn(GOOD_USERNAME, "correct-password");
    expect(transport.calls.downloadFromPresignedUrl).toBe(1);
    const pulled = await assetStore.getBytes("dragon");
    expect(pulled?.bytes).toEqual(newBytes);
  });

  it("reports coarse pull progress (N of M) while downloading", async () => {
    const { controller, transport } = harness();
    transport.server.revision = 1;
    const seen: ({ done: number; total: number } | null)[] = [];
    controller.subscribe(() => seen.push(controller.getSnapshot().pullProgress));
    const names = ["a", "b", "c"];
    const entries: CloudAssetManifestEntry[] = [];
    for (const name of names) {
      const bytes = new Uint8Array([name.charCodeAt(0)]);
      transport.server.assets.set(name, { bytes, mime: "image/png" });
      entries.push({ name, mime: "image/png", size: 1, hash: await sha256HexForTest(bytes) });
    }
    transport.server.project = { code: "", sheets: {}, assets: entries };
    await controller.signIn(GOOD_USERNAME, "correct-password");
    const progressed = seen.filter((p): p is { done: number; total: number } => p !== null);
    expect(progressed.map((p) => `${p.done}/${p.total}`)).toEqual(["0/3", "1/3", "2/3", "3/3"]);
  });
});

// ---------------------------------------------------------------------------
// Push debounce + pagehide flush (brief D)
// ---------------------------------------------------------------------------

describe("push debounce", () => {
  it("an edit pushes ~10 s after the last change, not sooner", async () => {
    vi.useFakeTimers();
    const { store, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    const before = transport.calls.putProject ?? 0;

    store.getState().setCode(store.getState().code + "\n# a\n");
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS - 1);
    expect(transport.calls.putProject ?? 0).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.calls.putProject ?? 0).toBe(before + 1);
    expect(controller.getSnapshot().status).toBe("idle");
  });

  it("a burst of edits collapses to ONE push (trailing debounce)", async () => {
    vi.useFakeTimers();
    const { store, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    const before = transport.calls.putProject ?? 0;

    store.getState().setCell("Monsters", 0, "health", "1");
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS / 2);
    store.getState().setCell("Monsters", 0, "health", "2");
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS / 2);
    store.getState().setCell("Monsters", 0, "health", "3");
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);

    expect(transport.calls.putProject ?? 0).toBe(before + 1);
    expect(transport.server.project?.sheets.Monsters.rows[0].health).toBe("3");
  });

  it("flush() runs a pending push immediately (pagehide)", async () => {
    vi.useFakeTimers();
    const { store, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    const before = transport.calls.putProject ?? 0;

    store.getState().setCode(store.getState().code + "\n# flushed\n");
    controller.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.calls.putProject ?? 0).toBe(before + 1);
  });

  it("flush() is a no-op when nothing is pending", async () => {
    const { controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    const before = transport.calls.putProject ?? 0;
    controller.flush();
    await Promise.resolve();
    expect(transport.calls.putProject ?? 0).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 409 → Reload vs Overwrite (brief D, both tested)
// ---------------------------------------------------------------------------

describe("409 conflict", () => {
  it("a stale push does NOT overwrite — surfaces 'behind' with the server's revision", async () => {
    vi.useFakeTimers();
    const { store, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    // Someone else (another device) pushes in between.
    transport.server.revision = 41;
    transport.server.project = { code: "someone else's code", sheets: {}, assets: [] };

    store.getState().setCode("my local edit");
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);

    const snap = controller.getSnapshot();
    expect(snap.status).toBe("behind");
    expect(snap.behindRevision).toBe(41);
    // The local edit was NOT overwritten — "never a lost edit".
    expect(store.getState().code).toBe("my local edit");
    expect(transport.server.project?.code).toBe("someone else's code"); // server untouched
  });

  it("Reload: pulls the server's copy and replaces local", async () => {
    vi.useFakeTimers();
    const { store, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    transport.server.revision = 41;
    transport.server.project = { code: "Sheet: S\n  column a: Text\n", sheets: {}, assets: [] };
    store.getState().setCode("my local edit");
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(controller.getSnapshot().status).toBe("behind");

    await controller.reload();
    expect(store.getState().code).toBe("Sheet: S\n  column a: Text\n");
    expect(controller.getSnapshot().status).toBe("idle");
  });

  it("Overwrite: re-pushes local content using the server's revision as the new base", async () => {
    vi.useFakeTimers();
    const { store, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    transport.server.revision = 41;
    transport.server.project = { code: "someone else's code", sheets: {}, assets: [] };
    store.getState().setCode("my local edit — should win");
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(controller.getSnapshot().status).toBe("behind");

    await controller.overwrite();
    expect(controller.getSnapshot().status).toBe("idle");
    expect(transport.server.project?.code).toBe("my local edit — should win");
    expect(transport.server.revision).toBe(42);
    expect(store.getState().code).toBe("my local edit — should win"); // local untouched by overwrite
  });
});

// ---------------------------------------------------------------------------
// Assets: immediate upload/delete, independent of the debounce (brief D)
// ---------------------------------------------------------------------------

describe("asset sync", () => {
  it("adding an asset uploads it immediately (not on the 10 s debounce)", async () => {
    const { assetStore, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    await assetStore.upload("dragon", "image/png", new Uint8Array([1, 2, 3]));
    await flushAsync();
    expect(transport.calls.presignAssetPut).toBe(1);
    expect(transport.calls.uploadToPresignedUrl).toBe(1);
    expect(transport.server.assets.get("dragon")?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("deleting an asset removes it remotely immediately", async () => {
    const { assetStore, controller, transport } = harness();
    await assetStore.upload("dragon", "image/png", new Uint8Array([1]));
    await controller.signIn(GOOD_USERNAME, "correct-password");
    await assetStore.remove("dragon");
    await flushAsync();
    expect(transport.calls.deleteAsset).toBe(1);
    expect(transport.server.assets.has("dragon")).toBe(false);
  });

  it("an asset change also schedules the debounced manifest-carrying push", async () => {
    vi.useFakeTimers();
    const { assetStore, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    await assetStore.upload("dragon", "image/png", new Uint8Array([1, 2, 3]));
    const before = transport.calls.putProject ?? 0;
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    // buildAssetManifest hashes "dragon" via the real WebCrypto
    // crypto.subtle.digest (deliberately NOT mocked — see cloudSync.ts's
    // module note: it's a pure function of bytes, safe to run for real).
    // That's a genuinely native async op, not a chained Promise, so on a
    // COLD call — or any call under enough system load, which an earlier
    // "just add one more zero-length advance" version of this fix turned
    // out NOT to be robust against (it still flaked under the heavier
    // parallel scrypt load M2's N=2^17 bump added elsewhere in this suite)
    // — it can resolve just past advanceTimersByTimeAsync's microtask-flush
    // window even though the debounce timer fired right on time. Switching
    // to REAL timers for the tail and waiting on a genuine macrotask
    // (flushAsync) is immune to this by construction: it waits for the
    // digest to ACTUALLY finish, on the real clock, however long that
    // takes, instead of hoping a fixed number of fake-timer advances is
    // enough margin (same fix shape as routes.test.ts's login-delay test).
    vi.useRealTimers();
    await flushAsync();
    expect(transport.calls.putProject ?? 0).toBe(before + 1);
    expect(transport.server.project?.assets.map((a) => a.name)).toEqual(["dragon"]);
  });
});

// ---------------------------------------------------------------------------
// Failure posture: every mode degrades quietly, editor stays usable (brief D)
// ---------------------------------------------------------------------------

describe("failure posture — degrade to local-only, never block editing", () => {
  const FAILURE_CASES: (number | "network")[] = [401, 503, 500, "network"];

  for (const status of FAILURE_CASES) {
    it(`push failure (${status}) → status "offline", local store still fully editable`, async () => {
      vi.useFakeTimers();
      const { store, controller, transport } = harness();
      await controller.signIn(GOOD_USERNAME, "correct-password");
      transport.nextFailure.putProject = status;
      store.getState().setCode("edit that fails to sync");
      await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);

      expect(controller.getSnapshot().status).toBe("offline");
      expect(controller.getSnapshot().errorMessage).not.toBeNull();
      // The editor itself is completely unaffected — keeps working.
      store.getState().setCell("Monsters", 0, "health", "77");
      expect(store.getState().sheets.Monsters.rows[0].health).toBe("77");
      expect(() => store.getState().addRow("Monsters")).not.toThrow();
    });
  }

  it("a pull failure degrades to offline without touching local content", async () => {
    const { store, controller, transport } = harness();
    const before = store.getState().code;
    transport.nextFailure.getProject = 500;
    const result = await controller.signIn(GOOD_USERNAME, "correct-password");
    expect(result).toEqual({ ok: true }); // login itself succeeded
    expect(controller.getSnapshot().status).toBe("offline");
    expect(store.getState().code).toBe(before);
  });

  it("an asset upload failure (presign) degrades to offline, doesn't throw", async () => {
    const { assetStore, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    transport.nextFailure.presignAssetPut = 500;
    await expect(assetStore.upload("dragon", "image/png", new Uint8Array([1]))).resolves.toBeDefined();
    await flushAsync();
    expect(controller.getSnapshot().status).toBe("offline");
  });

  it("an asset upload failure (PUT itself) degrades to offline, doesn't throw", async () => {
    const { assetStore, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    transport.nextFailure.uploadToPresignedUrl = "network";
    await assetStore.upload("dragon", "image/png", new Uint8Array([1]));
    await flushAsync();
    expect(controller.getSnapshot().status).toBe("offline");
  });

  it("unconfigured (503) during a push still leaves the editor usable and signed in", async () => {
    vi.useFakeTimers();
    const { store, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    transport.nextFailure.putProject = 503;
    store.getState().setCode("still editable");
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(controller.getSnapshot().status).toBe("offline");
    expect(store.getState().code).toBe("still editable");
  });
});

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------

describe("sign out", () => {
  it("clears the hint, returns to signed-out, and further edits don't push", async () => {
    vi.useFakeTimers();
    const { store, controller, transport, hint } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    controller.signOut();
    expect(controller.getSnapshot().status).toBe("signed-out");
    expect(hint.get()).toBe(false);
    expect(transport.calls.logout).toBe(1);

    const before = transport.calls.putProject ?? 0;
    store.getState().setCode("post-signout edit");
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS * 2);
    expect(transport.calls.putProject ?? 0).toBe(before);
  });

  it(
    "flushes a pending edit immediately rather than dropping it (M5a review: " +
      "'signing out doesn't lose anything queued' is only true if it actually flushes)",
    async () => {
      vi.useFakeTimers();
      const { store, controller, transport } = harness();
      await controller.signIn(GOOD_USERNAME, "correct-password");
      store.getState().setCode("should still reach the cloud");
      const before = transport.calls.putProject ?? 0;
      controller.signOut();
      await vi.advanceTimersByTimeAsync(0); // let the fire-and-forget flush settle
      expect(transport.calls.putProject ?? 0).toBe(before + 1);
      expect(transport.server.project?.code).toBe("should still reach the cloud");
    },
  );

  it("does NOT push again later — the flush already consumed the pending debounce", async () => {
    vi.useFakeTimers();
    const { store, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    store.getState().setCode("flushed once");
    controller.signOut();
    await vi.advanceTimersByTimeAsync(0);
    const afterFlush = transport.calls.putProject ?? 0;
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS * 2);
    expect(transport.calls.putProject ?? 0).toBe(afterFlush);
  });

  it("the flushed push's eventual result never clobbers the (by then) signed-out status", async () => {
    vi.useFakeTimers();
    const { store, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    store.getState().setCode("in flight during sign out");
    controller.signOut();
    // Synchronously, immediately — not "pushing" from the flush() it kicked off.
    expect(controller.getSnapshot().status).toBe("signed-out");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.calls.putProject).toBeGreaterThan(0); // the flush DID run…
    expect(controller.getSnapshot().status).toBe("signed-out"); // …but never overwrote this
  });
});

// ---------------------------------------------------------------------------
// Mount-restore (hint present at construction) — confirms, never clobbers
// ---------------------------------------------------------------------------

describe("mount-restore session check", () => {
  it("hinted + still valid: reaches idle without ever calling replaceProject (no clobber)", async () => {
    const assetStore = createAssetStore(createInMemoryAssetAdapter());
    const store = createEditorStore(undefined, assetStore);
    const localCode = store.getState().code;
    const transport = createFakeTransport();
    transport.server.revision = 9;
    transport.server.project = { code: "SERVER content — must NOT appear locally", sheets: {}, assets: [] };
    const hint = fakeHint(true);

    const controller = createCloudSyncController({ store, assets: assetStore, transport, hint });
    await flushAsync();

    expect(controller.getSnapshot().status).toBe("idle");
    expect(store.getState().code).toBe(localCode); // unchanged — mount-restore never pulls
    expect(transport.calls.getProject).toBe(1);
  });

  it("hinted but the session is gone (401): clears the hint, falls back to signed-out", async () => {
    const assetStore = createAssetStore(createInMemoryAssetAdapter());
    const store = createEditorStore(undefined, assetStore);
    const transport = createFakeTransport();
    transport.nextFailure.getProject = 401;
    const hint = fakeHint(true);
    const controller = createCloudSyncController({ store, assets: assetStore, transport, hint });
    await flushAsync();
    expect(controller.getSnapshot().status).toBe("signed-out");
    expect(hint.get()).toBe(false);
  });

  it("hinted but offline: keeps the hint, shows a quiet offline indicator", async () => {
    const assetStore = createAssetStore(createInMemoryAssetAdapter());
    const store = createEditorStore(undefined, assetStore);
    const transport = createFakeTransport();
    transport.nextFailure.getProject = "network";
    const hint = fakeHint(true);
    const controller = createCloudSyncController({ store, assets: assetStore, transport, hint });
    await flushAsync();
    expect(controller.getSnapshot().status).toBe("offline");
    expect(hint.get()).toBe(true);
  });

  it("no hint: constructing a controller never calls the transport", () => {
    const assetStore = createAssetStore(createInMemoryAssetAdapter());
    const store = createEditorStore(undefined, assetStore);
    const transport = createFakeTransport();
    createCloudSyncController({ store, assets: assetStore, transport, hint: fakeHint(false) });
    expect(Object.keys(transport.calls)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe("dispose", () => {
  it("unsubscribes from both stores — no further pushes, even after edits", async () => {
    vi.useFakeTimers();
    const { store, controller, transport } = harness();
    await controller.signIn(GOOD_USERNAME, "correct-password");
    controller.dispose();
    const before = transport.calls.putProject ?? 0;
    store.getState().setCode("after dispose");
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS * 2);
    expect(transport.calls.putProject ?? 0).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The `cloudSync` singleton's forwarding pattern (mirrors assetStore.ts's
// makeSingleton — REGRESSION COVERAGE for a real bug found during review: an
// earlier draft used a `| null` singleton that cloudSyncControl.tsx read
// directly at render time, so a component mounted (and subscribed) BEFORE
// `initCloudSync()` attached the real controller had no way to ever learn
// the real controller existed short of some UNRELATED re-render happening
// later. `resetCloudSyncForTests()` exercises the exact mechanism
// `initCloudSync()` uses (`singleton.attach(...)`) without needing
// `window` (which this test environment doesn't have) — it can't drive a
// REAL sign-in, but it proves the thing that broke: a listener registered
// against the stable object before an attach() call still fires afterward.
// ---------------------------------------------------------------------------

describe("the cloudSync singleton — subscribe-before-attach still works", () => {
  afterEach(() => resetCloudSyncForTests());

  it("getSnapshot() is safe before any attach — reads as signed-out", () => {
    expect(cloudSync.getSnapshot().status).toBe("signed-out");
  });

  it("a listener registered BEFORE an attach() call still fires on events AFTER it", async () => {
    let fired = 0;
    const unsubscribe = cloudSync.subscribe(() => {
      fired++;
    });
    // Simulates initCloudSync(): swaps the singleton's internal `active`
    // controller out from under any already-registered listener.
    resetCloudSyncForTests();
    const before = fired;
    // The freshly-attached controller's transport is inert (network
    // failure on everything) — signIn still transitions signing-in →
    // signed-out, two snapshot changes, each a notify().
    const result = await cloudSync.signIn("anything", "anything");
    expect(result.ok).toBe(false);
    expect(fired).toBeGreaterThan(before);
    unsubscribe();
  });

  it("multiple attach() calls in a row never leave a stale forwarding subscription (no double-fire)", async () => {
    let fired = 0;
    const unsubscribe = cloudSync.subscribe(() => {
      fired++;
    });
    resetCloudSyncForTests();
    resetCloudSyncForTests();
    resetCloudSyncForTests();
    fired = 0;
    await cloudSync.signIn("anything", "anything"); // exactly 2 notifies from THIS active controller
    expect(fired).toBe(2);
    unsubscribe();
  });

  it(
    "a HINTED attach (initCloudSync's real codepath) forwards its FIRST synchronous " +
      "transition too — a subscriber attached before attach() must see 'pulling', not " +
      "just the transition once the async check resolves",
    async () => {
      const snapshots: string[] = [];
      const unsubscribe = cloudSync.subscribe(() => {
        snapshots.push(cloudSync.getSnapshot().status);
      });
      const transport = createFakeTransport();
      transport.server.revision = 3;
      transport.server.project = { code: "from-hinted-restore", sheets: {}, assets: [] };
      // attachCloudSyncForTests's `hint` reports TRUE — this is the exact
      // shape initCloudSync() drives when localStorage remembers a prior
      // sign-in: createCloudSyncController's constructor calls
      // restoreSessionIfHinted() SYNCHRONOUSLY, which itself calls
      // setSnapshot({status:"pulling"}) as its very first statement, before
      // attach() has necessarily finished wiring the forwarding
      // subscription — the exact race this test pins.
      attachCloudSyncForTests({
        store: createEditorStore(undefined, createAssetStore(createInMemoryAssetAdapter())),
        assets: createAssetStore(createInMemoryAssetAdapter()),
        transport,
        hint: fakeHint(true),
      });
      await flushAsync();
      expect(snapshots).toContain("pulling");
      expect(cloudSync.getSnapshot().status).toBe("idle");
      unsubscribe();
    },
  );
});

// ---------------------------------------------------------------------------
// test-local hashing helper (mirrors cloudSync.ts's private sha256Hex —
// duplicated deliberately so the fixture-building code above doesn't need
// to import a private function)
// ---------------------------------------------------------------------------

async function sha256HexForTest(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("the REAL transport's request shape (review: dropping username passed the whole suite)", () => {
  it("login posts BOTH credentials as JSON — this regression already happened once", async () => {
    const seen: { url?: string; body?: unknown; headers?: unknown } = {};
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.url = String(url);
      seen.body = JSON.parse(String(init?.body ?? "{}"));
      seen.headers = init?.headers;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    try {
      await createRealCloudTransport().login("eduxx", "a real password");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(seen.url).toBe("/api/cloud/login");
    expect(seen.body).toEqual({ username: "eduxx", password: "a real password" });
  });
});
