/**
 * localStorage autosave (DESIGN.md §6.2): the project — code + every sheet's
 * rows AND ◆29 edited flags — survives a reload. Pure serialize/validate up
 * top, a thin controller over an injected Storage-shaped adapter below, and
 * the browser-only singleton wiring last.
 *
 * The §6.2 postures implemented here, and why they look the way they do:
 * - SAVE is debounced 1 s per store change to `code`/`sheets` (reference
 *   compare — derived compile state never triggers a save), deliberately
 *   separate from the 300 ms compile debounce: persistence needs no compile
 *   result, and a keystroke burst should cost one write, not many.
 * - RESTORE never destroys what it can't read. An unparseable / wrong-version
 *   / shape-invalid payload falls back to the demo seed, leaves the primary
 *   key IN PLACE (only the next user edit overwrites it), and best-effort
 *   copies the raw string to a quarantine key so not even that edit can
 *   destroy the last readable evidence of a user's project.
 * - FAILURE disables autosave for the session (`autosaveDisabled` on the
 *   store — the status bar shows "autosave off") instead of crashing or
 *   retrying: private-mode and quota errors don't heal mid-session.
 * - RESET removes both keys and reseeds via `replaceProject` inside a muted
 *   subscription, so the reset itself is not re-persisted — "clears storage"
 *   stays literally true until the next user edit.
 * - MULTI-TAB is last-writer-wins (no `storage`-event merging in v1, §6.2).
 *
 * SSR: everything above the singleton wiring is window-free and node-testable
 * with a stub adapter. `initEditorPersistence` is called from a
 * post-hydration effect (panelLayout) — never at import time — so the static
 * prerender and the hydration pass both show the demo, and the restore lands
 * just after mount (§6.2: the accepted demo-frame flash).
 */

import {
  demoSeed,
  editorStore,
  type EditorSeed,
  type EditorStore,
  type SheetsState,
} from "@/app/editor/_store/editorStore";

/** Save debounce (§6.2) — separate from COMPILE_DEBOUNCE_MS by design. */
export const PERSIST_DEBOUNCE_MS = 1000;

/** The one project slot. The `v1` is load-bearing: a future incompatible
 * payload gets a new key, and this one stops being read, not destroyed. */
export const PERSIST_KEY = "cardgoblin.project.v1";

/** Where an unreadable payload is copied before the demo takes over (§6.2 —
 * a corrupt project must stay recoverable by hand, even past the next save). */
export const QUARANTINE_KEY = "cardgoblin.project.quarantine";

/** Must match the payload's `version` field; repeated inside the payload so a
 * key collision with something else's data can't pass validation. */
export const PERSIST_VERSION = 1;

/** The slice of the Storage interface autosave uses — injectable for tests;
 * every call may throw (private mode, quota) and every caller handles it. */
export interface ProjectStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ---------------------------------------------------------------------------
// Pure serialize / validate
// ---------------------------------------------------------------------------

/** The §6.2 payload: exactly what a reload cannot recompute. */
export function serializeProject(code: string, sheets: SheetsState): string {
  const persistedSheets: Record<string, { rows: Record<string, string>[]; editedRows: boolean[] }> =
    {};
  for (const [name, sheet] of Object.entries(sheets)) {
    // Explicit field picks: whatever else SheetState grows later must opt in
    // here (and bump the version if a reload can't ignore it).
    persistedSheets[name] = { rows: sheet.rows, editedRows: sheet.editedRows };
  }
  return JSON.stringify({ version: PERSIST_VERSION, code, sheets: persistedSheets });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parse + shape-validate a raw payload → a store seed, or null if ANYTHING
 * is off (§6.2: no partial restores — half a project restored silently is
 * worse than the demo plus a quarantined original).
 *
 * Strict about what matters, lenient where the seed contract already is:
 * `rows` must be string-valued records (orphaned `__orphan__*` keys are
 * ordinary string entries and round-trip untouched); `editedRows` need only
 * be an array — createEditorStore/replaceProject normalize misalignment and
 * non-`true` entries per the EditorSeed contract.
 */
export function parsePersisted(raw: string): EditorSeed | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(payload) || payload.version !== PERSIST_VERSION) return null;
  if (typeof payload.code !== "string" || !isRecord(payload.sheets)) return null;

  // Null prototype: a hand-crafted payload with a "__proto__" sheet name must
  // not hit the prototype setter (it would silently drop the sheet on restore).
  const sheets: SheetsState = Object.create(null) as SheetsState;
  for (const [name, sheet] of Object.entries(payload.sheets)) {
    if (!isRecord(sheet) || !Array.isArray(sheet.rows) || !Array.isArray(sheet.editedRows)) {
      return null;
    }
    const rows: Record<string, string>[] = [];
    for (const row of sheet.rows) {
      if (!isRecord(row)) return null;
      for (const value of Object.values(row)) {
        if (typeof value !== "string") return null;
      }
      rows.push({ ...(row as Record<string, string>) });
    }
    sheets[name] = { rows, editedRows: sheet.editedRows.map((flag) => flag === true) };
  }
  return { code: payload.code, sheets };
}

/**
 * Read the stored project: a valid payload → seed; a missing one → null; an
 * invalid one → null AFTER copying it to the quarantine key (best-effort —
 * quarantining must never be the thing that crashes a restore). The primary
 * key is never written or removed here (§6.2 fallback posture).
 */
export function readStoredSeed(storage: ProjectStorage): EditorSeed | null {
  let raw: string | null;
  try {
    raw = storage.getItem(PERSIST_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const seed = parsePersisted(raw);
  if (seed === null) {
    try {
      storage.setItem(QUARANTINE_KEY, raw);
    } catch {
      // Unwritable storage: the payload still sits under the primary key.
    }
  }
  return seed;
}

// ---------------------------------------------------------------------------
// Controller (store wiring — headless-testable)
// ---------------------------------------------------------------------------

export interface PersistenceController {
  /** Write any PENDING save now (pagehide / visibility-hidden); no-op when
   * nothing is pending or autosave is disabled. */
  flush(): void;
  /** §6.2 reset-to-demo: remove both keys, reseed, persist nothing. */
  resetToDemo(): void;
  /** Unsubscribe and cancel any pending save (tests). */
  dispose(): void;
}

/**
 * Attach the persist subscription to a store. Call AFTER any restore — the
 * subscription only sees changes from here on, so restoring first is what
 * keeps a restore from immediately re-saving itself.
 */
export function attachPersistence(
  store: EditorStore,
  storage: ProjectStorage,
): PersistenceController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // True while resetToDemo runs its synchronous state changes — they must not
  // schedule the save that would repopulate the storage reset just cleared.
  let muted = false;
  let disabled = false;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const write = (): void => {
    const { code, sheets } = store.getState();
    try {
      storage.setItem(PERSIST_KEY, serializeProject(code, sheets));
    } catch {
      // Quota / private mode (§6.2): off for the session, indicator on. No
      // retries — each would throw again, and storage rarely heals live.
      disabled = true;
      cancel();
      store.setState({ autosaveDisabled: true });
    }
  };

  const unsubscribe = store.subscribe((state, prev) => {
    if (muted || disabled) return;
    // Reference compare: only the persisted inputs schedule a save. Derived
    // compile state changes identity every compile and must not. (Known slack:
    // a schema-changing edit's 300 ms reconciliation rewrites `sheets`, which
    // reschedules the pending save — worst case the save lands at ~1.3 s.)
    if (state.code === prev.code && state.sheets === prev.sheets) return;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      write();
    }, PERSIST_DEBOUNCE_MS);
  });

  return {
    flush: () => {
      if (timer === null || disabled) return;
      cancel();
      write();
    },

    resetToDemo: () => {
      cancel();
      muted = true;
      try {
        store.getState().replaceProject(demoSeed());
      } finally {
        muted = false;
      }
      try {
        storage.removeItem(PERSIST_KEY);
        storage.removeItem(QUARANTINE_KEY);
      } catch {
        // Storage that can't even remove is the disabled-autosave world; the
        // in-memory reset above still happened.
      }
    },

    dispose: () => {
      unsubscribe();
      cancel();
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton wiring (browser-only)
// ---------------------------------------------------------------------------

let liveController: PersistenceController | null = null;

/**
 * Restore the saved project into the app's singleton store and attach
 * autosave. Idempotent (StrictMode double-mounts its effect) and a no-op
 * without `window` — the §6.2 SSR mechanism. The pagehide/visibility flush
 * listeners are the one browser-only glue this module can't node-test;
 * `flush()` itself is covered headless.
 */
export function initEditorPersistence(): void {
  if (liveController !== null) return;
  if (typeof window === "undefined") return;

  let storage: ProjectStorage;
  try {
    storage = window.localStorage;
  } catch {
    // Even ACCESSING localStorage throws under some privacy settings.
    editorStore.setState({ autosaveDisabled: true });
    return;
  }

  const seed = readStoredSeed(storage);
  if (seed !== null) editorStore.getState().replaceProject(seed);
  liveController = attachPersistence(editorStore, storage);

  window.addEventListener("pagehide", () => liveController?.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") liveController?.flush();
  });
}

/** The status bar's reset affordance. Falls back to a plain reseed when
 * persistence never attached (SSR, blocked storage) — the button must work
 * even where autosave doesn't. */
export function resetEditorToDemo(): void {
  if (liveController !== null) {
    liveController.resetToDemo();
    return;
  }
  editorStore.getState().replaceProject(demoSeed());
}
