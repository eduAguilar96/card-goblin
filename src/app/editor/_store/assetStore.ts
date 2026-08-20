/**
 * Local image assets — IndexedDB store (DESIGN.md §7.1b, M3): the Assets
 * drawer's data layer. The image-resolution machinery (cardSvg.tsx,
 * pdfRaster.tsx), the W005 compile input (check.ts, threaded through
 * editorStore.ts), and project-file v2 export/import (projectFile.tsx) all
 * build on the singleton exported at the bottom.
 *
 * Layered like persistence.ts, deliberately:
 * - Pure name validation up top (Goblin identifier rules, §3.1 — DUPLICATED
 *   from lexer.ts's isIdentStart/isIdentChar, which aren't exported as a
 *   regex; keep the two in sync by hand if §3.1 ever changes).
 * - `AssetAdapter`: the injectable storage seam — list/get/put/rename/delete
 *   over `{name, mime, bytes}` records, mirroring persistence.ts's
 *   `ProjectStorage`. `createInMemoryAssetAdapter` is the fake tests inject;
 *   `createIndexedDbAssetAdapter` is the real hand-rolled wrapper (no new
 *   deps) — browser-only, so it is excluded from the headless test surface
 *   the same way persistence.ts's `window.localStorage` access is (it isn't
 *   unit-tested directly; the manual browser checklist covers it).
 * - `createAssetStore`: a thin reactive controller over one adapter — name/
 *   cap validation, an in-memory `AssetMeta[]` cache kept current so callers
 *   (compileProject's W005 input, the status-bar badge) read synchronously
 *   without awaiting IDB, and a subscriber list so the drawer, the image-
 *   resolution cache, and the editor's recompile wiring all learn about
 *   changes without polling.
 * - The module-level `assetStore` singleton + `initAssetStore()`, wiring the
 *   real adapter client-side only (SSR-safe, mirrors `initEditorPersistence`)
 *   while staying the SAME object identity before and after — early
 *   subscribers (the module-level `editorStore`, built at import time) keep
 *   hearing about changes once the real adapter attaches.
 *
 * Failure posture (§7.1b, mirrors §6.2): IndexedDB unavailable, or any
 * operation that throws (quota, a blocked/broken connection) — the store
 * flips into `disabled` and stops attempting further IDB work. `disabled` is
 * the drawer's "off" notice, exactly like autosave's `autosaveDisabled`; a
 * disabled store still answers reads (empty library) so the rest of the
 * editor is untouched, matching persistence.ts's posture.
 */

// ---------------------------------------------------------------------------
// Name rules (§3.1) — pure
// ---------------------------------------------------------------------------

/** Goblin identifier rules (§3.1): a letter, then letters/digits/underscore.
 * CROSS-REFERENCE: src/lib/lang/lexer.ts's isIdentStart/isIdentChar implement
 * the same rule character-by-character for the lexer itself; neither module
 * exports a shared regex, so this is a deliberate duplicate — keep both in
 * sync if the identifier grammar ever changes. */
export const ASSET_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export function isValidAssetName(name: string): boolean {
  return ASSET_NAME_PATTERN.test(name);
}

/** §7.1b: 2 MB per asset, checked against the PRE-encoding byte length (the
 * raw file/blob, not any base64 the project-file format later wraps it in).
 * Guarded bidirectionally against the wiki by docFacts.test.ts. */
export const ASSET_MAX_BYTES = 2 * 1024 * 1024;

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

/**
 * Format a size that's OVER the cap for the too-large message specifically
 * (adversarial finding, m2): `formatBytes` rounds to one MB decimal, so a
 * file only slightly over 2 MB renders as "2.0 MB" — identical to
 * `formatBytes(ASSET_MAX_BYTES)` — reading as "2.0 MB is over the 2.0 MB
 * cap," which looks like nothing's wrong. Falls back to KB whenever the
 * one-decimal MB rendering would collide with the cap's; KB is exact enough
 * to always differ (ASSET_MAX_BYTES is a whole multiple of 1024 bytes, so
 * ANY size strictly greater than it ceils to a strictly greater KB count).
 */
function formatOverCapSize(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  const capMb = (ASSET_MAX_BYTES / (1024 * 1024)).toFixed(1);
  return mb === capMb ? `${Math.ceil(bytes / 1024)} KB` : `${mb} MB`;
}

/** §7.1b/m8: the drawer's picker/drop already filters to `image/*`, but the
 * store enforces it too (defense in depth — project-file import and any
 * future caller must not be able to slip a non-image mime past the store).
 * Exported so projectFile.tsx's v2 import validation checks the SAME rule
 * rather than a re-implemented copy. */
export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

// ---------------------------------------------------------------------------
// Records and errors
// ---------------------------------------------------------------------------

/** One asset as the adapter stores/returns it. `bytes` is a `Blob` from the
 * real browser adapter (IDB stores Blobs natively, cheaply) or a
 * `Uint8Array` from tests / project-file import (base64-decoded). */
export interface StoredAsset {
  name: string;
  mime: string;
  bytes: Blob | Uint8Array;
}

/** The list-view shape: everything the drawer/badge/W005 need without
 * holding every asset's bytes in memory at once. */
export interface AssetMeta {
  name: string;
  mime: string;
  size: number;
}

function byteLengthOf(bytes: Blob | Uint8Array): number {
  return bytes instanceof Blob ? bytes.size : bytes.byteLength;
}

function metaOf(asset: StoredAsset): AssetMeta {
  return { name: asset.name, mime: asset.mime, size: byteLengthOf(asset.bytes) };
}

function sortedMetas(metas: readonly AssetMeta[]): AssetMeta[] {
  return [...metas].sort((a, b) => a.name.localeCompare(b.name));
}

export type AssetErrorCode =
  | "invalid-name"
  | "invalid-mime"
  | "too-large"
  | "name-taken"
  | "not-found"
  | "disabled";

/** Typed error for every way a mutation can fail — `code` lets callers (the
 * drawer's inline errors) branch without parsing `message`. */
export class AssetStoreError extends Error {
  readonly code: AssetErrorCode;
  constructor(code: AssetErrorCode, message: string) {
    super(message);
    this.name = "AssetStoreError";
    this.code = code;
  }
}

const invalidNameError = (name: string): AssetStoreError =>
  new AssetStoreError(
    "invalid-name",
    `'${name}' isn't a valid asset name — use letters, numbers, and underscores, starting with a letter.`,
  );

const invalidMimeError = (mime: string): AssetStoreError =>
  new AssetStoreError("invalid-mime", `'${mime || "(empty)"}' isn't an image type.`);

const disabledError = (): AssetStoreError =>
  new AssetStoreError(
    "disabled",
    "Local image storage isn't available in this browser (private mode or a storage quota).",
  );

// ---------------------------------------------------------------------------
// AssetAdapter — the injectable storage seam
// ---------------------------------------------------------------------------

/** The slice of storage the controller needs — injectable for tests, exactly
 * like persistence.ts's `ProjectStorage`. Every method may reject (quota,
 * private mode, a broken IDB connection); the controller handles it. `list`
 * returns full records (not just meta) so a fake seeded with real bytes can
 * back both listing and thumbnail/PDF reads through one small surface. */
export interface AssetAdapter {
  list(): Promise<StoredAsset[]>;
  get(name: string): Promise<StoredAsset | null>;
  put(asset: StoredAsset): Promise<void>;
  /** Rejects "not-found" / "name-taken" (AssetStoreError) — the authoritative
   * collision check; the controller also pre-checks its cache for fast,
   * IDB-round-trip-free UI feedback, but this is what actually decides. */
  rename(oldName: string, newName: string): Promise<void>;
  delete(name: string): Promise<void>;
}

/** Test/fallback adapter: an in-memory `Map`, seedable. Mirrors the shape
 * `createIndexedDbAssetAdapter` below exposes, so `createAssetStore` never
 * needs to know which one it was given. */
export function createInMemoryAssetAdapter(seed: readonly StoredAsset[] = []): AssetAdapter {
  const table = new Map<string, StoredAsset>(seed.map((a) => [a.name, { ...a }]));
  return {
    async list() {
      return [...table.values()].map((a) => ({ ...a }));
    },
    async get(name) {
      const found = table.get(name);
      return found ? { ...found } : null;
    },
    async put(asset) {
      table.set(asset.name, { ...asset });
    },
    async rename(oldName, newName) {
      const existing = table.get(oldName);
      if (!existing) throw new AssetStoreError("not-found", `No asset named '${oldName}'.`);
      if (table.has(newName)) {
        throw new AssetStoreError("name-taken", `An asset named '${newName}' already exists.`);
      }
      table.delete(oldName);
      table.set(newName, { ...existing, name: newName });
    },
    async delete(name) {
      table.delete(name);
    },
  };
}

// ---------------------------------------------------------------------------
// The real IndexedDB adapter (browser-only; hand-rolled, no new deps)
// ---------------------------------------------------------------------------

const DB_NAME = "cardgoblin-assets";
const DB_VERSION = 1;
const STORE_NAME = "assets";

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Thin hand-rolled wrapper over the browser's IndexedDB — one object store,
 * keyed by asset name, holding `{name, mime, bytes}` records verbatim (IDB
 * stores `Blob`s by reference, so this never round-trips large art through a
 * string encoding the way localStorage would force). Excluded from vitest by
 * construction (nothing here runs until a method is called, and `indexedDB`
 * doesn't exist in the test environment) — on the manual browser checklist,
 * same posture as pdfRaster.tsx's DOM-only rasterizer.
 */
export function createIndexedDbAssetAdapter(): AssetAdapter {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const getDb = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME, { keyPath: "name" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    });
    return dbPromise;
  };

  const store = async (mode: IDBTransactionMode): Promise<IDBObjectStore> =>
    (await getDb()).transaction(STORE_NAME, mode).objectStore(STORE_NAME);

  return {
    async list() {
      const s = await store("readonly");
      return idbRequest(s.getAll() as IDBRequest<StoredAsset[]>);
    },
    async get(name) {
      const s = await store("readonly");
      const found = await idbRequest(s.get(name) as IDBRequest<StoredAsset | undefined>);
      return found ?? null;
    },
    async put(asset) {
      const s = await store("readwrite");
      await idbRequest(s.put(asset));
    },
    async rename(oldName, newName) {
      // One transaction: read-check-write atomically, so a rename can never
      // observe (or leave) a half-moved state.
      const s = await store("readwrite");
      const existing = await idbRequest(s.get(oldName) as IDBRequest<StoredAsset | undefined>);
      if (!existing) throw new AssetStoreError("not-found", `No asset named '${oldName}'.`);
      const collision = await idbRequest(s.get(newName) as IDBRequest<StoredAsset | undefined>);
      if (collision) {
        throw new AssetStoreError("name-taken", `An asset named '${newName}' already exists.`);
      }
      await idbRequest(s.delete(oldName));
      await idbRequest(s.put({ ...existing, name: newName }));
    },
    async delete(name) {
      const s = await store("readwrite");
      await idbRequest(s.delete(name));
    },
  };
}

// ---------------------------------------------------------------------------
// AssetStore — reactive controller (headless-testable)
// ---------------------------------------------------------------------------

/** What changed, for subscribers that care WHICH name (the image-resolution
 * cache revokes/re-resolves per name rather than flushing everything on every
 * event). `clear`/`replaceAll` carry no name — every cached name is stale. */
export type AssetChangeEvent =
  | { type: "put"; name: string }
  | { type: "rename"; from: string; to: string }
  | { type: "delete"; name: string }
  | { type: "clear" }
  | { type: "replaceAll" }
  | { type: "disabled" };

export interface AssetStoreSnapshot {
  /** Sorted by name — stable iteration order for the drawer's grid. */
  assets: AssetMeta[];
  disabled: boolean;
}

export interface AssetStore {
  /**
   * Synchronous — the in-memory cache, never an IDB round-trip. Safe to call
   * during SSR/prerender (starts `{assets: [], disabled: false}`).
   *
   * REFERENCE-STABLE (adversarial finding C1): returns the SAME object
   * across calls until `assets`/`disabled` actually change — required by
   * `useSyncExternalStore` (a fresh object every call is an infinite
   * render loop via `Object.is`; windowSpreadsheet.tsx's `NO_DIAGNOSTICS`/
   * `EMPTY_SHEET` constants document the identical hazard).
   */
  getSnapshot(): AssetStoreSnapshot;
  /** `compileProject`'s W005 input — a fresh Set per call (cheap; called once
   * per compile, not per keystroke). Empty while `disabled` (m1): the
   * checker and the renderer must agree an asset is unavailable, not read a
   * stale pre-disable name list as still-good. */
  getAssetNames(): ReadonlySet<string>;
  subscribe(listener: (event: AssetChangeEvent) => void): () => void;
  /**
   * Re-read the adapter's full list into the cache. Called once at init
   * (before any UI has necessarily subscribed) and exposed for a manual
   * "storage healed" retry.
   *
   * NOTIFIES on a changed list (adversarial finding C2): `initAssetStore`
   * runs from a parent effect, which fires AFTER children have already
   * subscribed and settled (e.g. LiveImage already resolved "failed" for an
   * asset that, moments later, `refresh()` discovers DOES exist) — without
   * a notification here, that settled state and any stale W005 never heal.
   * A `replaceAll` event is reused rather than a new event kind: every
   * subscriber already treats it as "everything might have changed, re-
   * resolve/recompile" (cardSvg.tsx, editorStore.ts), which is exactly
   * refresh()'s effect on cold start.
   */
  refresh(): Promise<void>;
  /** Full bytes for rendering (preview object URLs, PDF data URIs) — null on
   * a missing name OR a disabled store, never a throw (§3.3's existing
   * "missing asset behaves like a failed URL" contract). */
  getBytes(name: string): Promise<StoredAsset | null>;
  /** Validates name + mime (must be `image/*`, m8) + the 2 MB cap
   * (ASSET_MAX_BYTES) before writing — throws AssetStoreError on any
   * rejection, including re-uploading an existing name (allowed: overwrites,
   * matching the drawer's "replace" idiom). */
  upload(name: string, mime: string, bytes: Blob | Uint8Array): Promise<AssetMeta>;
  /** Not-found/name-taken checks fall back to the ADAPTER on a cache miss
   * (m10) — an un-refreshed cache must never claim "doesn't exist" for
   * something actually in storage. */
  rename(oldName: string, newName: string): Promise<void>;
  /** Same cache-miss fallback as `rename` (m10). */
  remove(name: string): Promise<void>;
  /** Delete every asset (reset-to-demo, §7.1b) — enumerates the ADAPTER for
   * what to delete (M4: never just the cache, which may be un-refreshed and
   * understate what's actually stored). No-op, not an error, on a disabled
   * store. */
  clear(): Promise<void>;
  /**
   * Project-file v2/v1 import (§7.1b): replace the whole library with
   * pre-validated records (the caller — projectFile.tsx — has already
   * checked names/mime/base64/cap; this trusts them, exactly as `put` trusts
   * a caller that already validated). Best-effort like `clear` (never
   * throws) — a disabled/unavailable store no-ops rather than failing the
   * PROJECT half of an import, which succeeds independently.
   *
   * Enumerates the ADAPTER (not the cache) for which stale names to delete
   * (M4), and writes new records BEFORE deleting stale ones (M3) — a mid-
   * write failure then leaves storage as a superset of the new library
   * (recoverable) rather than stranding it between "some old deleted, no
   * new written". On failure, the cache is reconciled against whatever the
   * adapter ACTUALLY holds afterward (never left describing a state storage
   * doesn't match) before disabling.
   */
  replaceAll(records: readonly StoredAsset[]): Promise<void>;
}

/**
 * Build a controller over one adapter. `startDisabled` seeds the failure
 * posture directly (used when IndexedDB itself is unavailable, so the store
 * never even attempts a doomed first call) — a later operation failing flips
 * the SAME flag reactively.
 */
/** Two `AssetMeta[]` (both already sorted by name) hold the same content —
 * used by `refresh()` to decide whether the world actually changed (C2), so
 * a no-op refresh doesn't mint spurious events. */
function metasEqual(a: readonly AssetMeta[], b: readonly AssetMeta[]): boolean {
  return (
    a.length === b.length &&
    a.every((m, i) => m.name === b[i].name && m.mime === b[i].mime && m.size === b[i].size)
  );
}


export function createAssetStore(adapter: AssetAdapter, startDisabled = false): AssetStore {
  let assets: AssetMeta[] = [];
  let disabled = startDisabled;
  // C1: getSnapshot() must return the SAME object across calls until the
  // state it describes actually changes (useSyncExternalStore's Object.is
  // check — see the AssetStore.getSnapshot doc comment). Rebuilt ONLY by
  // setAssets/disable, never inline in getSnapshot itself.
  let snapshot: AssetStoreSnapshot = { assets, disabled };
  const listeners = new Set<(event: AssetChangeEvent) => void>();
  // Cold start can have more than one consumer waiting for the first IDB
  // read (the asset UI and cloud-session reconciliation). They must join one
  // read: two independent list requests can resolve out of order, allowing
  // an older result to replace a cache that cloud sync has already updated.
  let refreshInFlight: Promise<void> | null = null;

  const setAssets = (next: AssetMeta[]): void => {
    assets = next;
    snapshot = { assets, disabled };
  };

  const notify = (event: AssetChangeEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const disable = (): void => {
    if (disabled) return;
    disabled = true;
    snapshot = { assets, disabled };
    notify({ type: "disabled" });
  };

  const guard = (): void => {
    if (disabled) throw disabledError();
  };

  /** M3/M4 failure recovery: re-read the adapter so the cache reflects
   * whatever storage ACTUALLY holds after a failed multi-step write, rather
   * than staying pinned to a pre-operation snapshot that may already be
   * wrong. Swallows its own failure (the adapter is clearly unhappy either
   * way) — `disable()` is the honest signal regardless of whether this
   * reconciliation read itself succeeds. */
  const reconcileFromAdapter = async (): Promise<void> => {
    try {
      setAssets(sortedMetas((await adapter.list()).map(metaOf)));
    } catch {
      // Cache stays whatever it was — best effort, never throws.
    }
  };

  const refresh = (): Promise<void> => {
    if (disabled) return Promise.resolve();
    if (refreshInFlight !== null) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const next = sortedMetas((await adapter.list()).map(metaOf));
        const changed = !metasEqual(assets, next);
        // Gate the write too, not just the notify: setAssets rebuilds the
        // cached snapshot object, and a no-op refresh must not mint a new
        // reference (C1's invariant — review residual).
        if (changed) setAssets(next);
        // C2: notify on a genuine change so subscribers that settled BEFORE
        // this initial load lands (LiveImage's "failed" status, a stale
        // W005) get a chance to heal — refresh() runs after
        // `initAssetStore` attaches, which is strictly after children have
        // already subscribed (parent effect ordering).
        if (changed) notify({ type: "replaceAll" });
      } catch {
        disable();
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  };

  return {
    getSnapshot: () => snapshot,
    // m1: a disabled store reports NO assets — the checker (W005) and the
    // renderer (asset: resolution) must agree an asset library that stopped
    // answering is the same as an empty one, not a stale pre-disable list.
    // A FRESH set every call, disabled or not: the return type says
    // ReadonlySet, but a shared module-level instance is still a live object a
    // caller could mutate into every other store's answer (review residual).
    getAssetNames: () => (disabled ? new Set<string>() : new Set(assets.map((a) => a.name))),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    refresh,

    async getBytes(name) {
      if (disabled) return null;
      try {
        return await adapter.get(name);
      } catch {
        disable();
        return null;
      }
    },

    async upload(name, mime, bytes) {
      guard();
      if (!isValidAssetName(name)) throw invalidNameError(name);
      if (!isImageMime(mime)) throw invalidMimeError(mime); // m8
      const size = byteLengthOf(bytes);
      if (size > ASSET_MAX_BYTES) {
        throw new AssetStoreError(
          "too-large",
          `'${name}' is ${formatOverCapSize(size)} — assets are capped at ${formatBytes(ASSET_MAX_BYTES)}.`,
        );
      }
      try {
        await adapter.put({ name, mime, bytes });
      } catch (err) {
        if (err instanceof AssetStoreError) throw err;
        disable();
        throw disabledError();
      }
      setAssets(sortedMetas([...assets.filter((a) => a.name !== name), { name, mime, size }]));
      notify({ type: "put", name });
      return { name, mime, size };
    },

    async rename(oldName, newName) {
      guard();
      if (!isValidAssetName(newName)) throw invalidNameError(newName);
      let prior = assets.find((a) => a.name === oldName);
      if (!prior) {
        // m10: an un-refreshed cache must not claim "doesn't exist" for
        // something actually in storage — confirm against the adapter
        // before reporting not-found.
        const found = await adapter.get(oldName).catch(() => null);
        if (!found) throw new AssetStoreError("not-found", `No asset named '${oldName}'.`);
        prior = metaOf(found);
      }
      // A same-name "rename" is a no-op, short-circuited here rather than
      // taught to every adapter: the adapter's own collision check would
      // otherwise reject it (the record already exists under `oldName`).
      if (newName === oldName) return;
      if (assets.some((a) => a.name === newName)) {
        throw new AssetStoreError("name-taken", `An asset named '${newName}' already exists.`);
      }
      try {
        await adapter.rename(oldName, newName);
      } catch (err) {
        if (err instanceof AssetStoreError) throw err;
        disable();
        throw disabledError();
      }
      setAssets(
        sortedMetas([...assets.filter((a) => a.name !== oldName), { ...prior, name: newName }]),
      );
      notify({ type: "rename", from: oldName, to: newName });
    },

    async remove(name) {
      guard();
      if (!assets.some((a) => a.name === name)) {
        // m10: same cache-miss fallback as rename — confirm against the
        // adapter before reporting not-found (an un-refreshed cache
        // understating what's stored must not silently no-op either).
        const found = await adapter.get(name).catch(() => null);
        if (!found) throw new AssetStoreError("not-found", `No asset named '${name}'.`);
      }
      try {
        await adapter.delete(name);
      } catch {
        disable();
        throw disabledError();
      }
      setAssets(assets.filter((a) => a.name !== name));
      notify({ type: "delete", name });
    },

    async clear() {
      if (disabled) return;
      try {
        // M4: enumerate the ADAPTER, not the cache — an un-refreshed cache
        // reads as empty even when storage isn't, which would leave real
        // assets behind ("v1 import clears the library" must hold even
        // when nothing was ever `refresh()`d).
        const current = await adapter.list();
        for (const stored of current) await adapter.delete(stored.name);
        // C1: a TRUE no-op (storage AND cache both already empty) must not
        // mint a fresh snapshot object — useSyncExternalStore would treat
        // it as a change and re-render for nothing.
        if (current.length === 0 && assets.length === 0) return;
      } catch {
        await reconcileFromAdapter();
        disable();
        return;
      }
      setAssets([]);
      notify({ type: "clear" });
    },

    async replaceAll(records) {
      // Best-effort, like `clear` (not `guard()` + throw): this is a
      // lifecycle operation (project-file import) rather than a single
      // drawer action, so a disabled/unavailable store degrades quietly —
      // the PROJECT half of an import still succeeds independently.
      if (disabled) return;
      try {
        // M4: stale names to delete come from the ADAPTER's actual
        // contents, not the (possibly un-refreshed/empty) cache.
        const current = await adapter.list();
        const newNames = new Set(records.map((r) => r.name));
        const staleNames = current.map((a) => a.name).filter((name) => !newNames.has(name));
        // M3: write the new records BEFORE deleting stale ones. A mid-write
        // throw then leaves storage as a SUPERSET of the target library
        // (old + new-so-far) rather than stranding it between "old deleted,
        // new not yet written" — strictly safer to recover from either way,
        // and reconcileFromAdapter below makes the cache honest regardless.
        for (const record of records) await adapter.put(record);
        for (const name of staleNames) await adapter.delete(name);
      } catch {
        await reconcileFromAdapter();
        disable();
        return;
      }
      setAssets(sortedMetas(records.map(metaOf)));
      notify({ type: "replaceAll" });
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton wiring (browser-only real adapter; SSR-safe)
// ---------------------------------------------------------------------------

/** Rebuilds the forwarding subscription onto whatever `active` currently is.
 * Kept as a closure over `active`/`forwardedListeners` so `initAssetStore`
 * and `resetAssetStoreForTests` share one implementation. */
function makeSingleton(): {
  store: AssetStore;
  attach(adapter: AssetAdapter, startDisabled: boolean): void;
} {
  let active = createAssetStore(createInMemoryAssetAdapter(), false);
  const forwardedListeners = new Set<(event: AssetChangeEvent) => void>();
  let forwardUnsubscribe = active.subscribe((event) => {
    for (const listener of forwardedListeners) listener(event);
  });

  // A stable object identity (module note above): every method delegates to
  // `active`, which `attach` swaps without changing this reference.
  const store: AssetStore = {
    getSnapshot: () => active.getSnapshot(),
    getAssetNames: () => active.getAssetNames(),
    subscribe: (listener) => {
      forwardedListeners.add(listener);
      return () => forwardedListeners.delete(listener);
    },
    refresh: () => active.refresh(),
    getBytes: (name) => active.getBytes(name),
    upload: (name, mime, bytes) => active.upload(name, mime, bytes),
    rename: (oldName, newName) => active.rename(oldName, newName),
    remove: (name) => active.remove(name),
    clear: () => active.clear(),
    replaceAll: (records) => active.replaceAll(records),
  };

  return {
    store,
    attach(adapter, startDisabled) {
      forwardUnsubscribe();
      active = createAssetStore(adapter, startDisabled);
      forwardUnsubscribe = active.subscribe((event) => {
        for (const listener of forwardedListeners) listener(event);
      });
    },
  };
}

const singleton = makeSingleton();

/** The app's singleton (SSR-safe: starts as an empty, non-disabled in-memory
 * store, so `getAssetNames()` is a safe empty `Set` during prerender and the
 * module-level `editorStore`'s eager first compile). Consumed from "use
 * client" components and from editorStore.ts's compile wiring. */
export const assetStore: AssetStore = singleton.store;

let initialized = false;

/**
 * Attach the real IndexedDB-backed adapter client-side (mirrors
 * `initEditorPersistence`): idempotent, a no-op without `window` (SSR) — the
 * singleton then stays the empty in-memory placeholder above, which reads as
 * "no assets yet" rather than throwing. `indexedDB` missing in an otherwise
 * real browser (very old browser, storage locked down) attaches DISABLED
 * from the start — the §7.1b posture ("quota/unavailable degrades exactly
 * like autosave's pattern") — instead of staying silently idle forever.
 * Kicks off the initial `refresh()`; subscribers attached before this call
 * (the module-level `editorStore`) still hear about it (module note above).
 */
export function initAssetStore(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  initialized = true;
  const hasIdb = typeof indexedDB !== "undefined";
  singleton.attach(
    hasIdb ? createIndexedDbAssetAdapter() : createInMemoryAssetAdapter(),
    !hasIdb,
  );
  if (hasIdb) void assetStore.refresh();
}

/** Test seam: rewind the singleton to its pre-init state (module-scoped state
 * would otherwise leak between test files that call `initAssetStore`). */
export function resetAssetStoreForTests(): void {
  initialized = false;
  singleton.attach(createInMemoryAssetAdapter(), false);
}

/** Test seam: attach an arbitrary adapter to the singleton directly (skips
 * the `window`/`indexedDB` gating `initAssetStore` does) — for tests of code
 * that reads the `assetStore` SINGLETON rather than an injected instance
 * (persistence.ts's `resetToDemo`/`resetEditorToDemo`, which call the
 * singleton's `clear()` by module-level import, not by parameter). Marks
 * `initAssetStore` as already-run so it won't clobber the seeded adapter. */
export function attachAssetAdapterForTests(adapter: AssetAdapter, startDisabled = false): void {
  initialized = true;
  singleton.attach(adapter, startDisabled);
}
