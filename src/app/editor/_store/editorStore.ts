/**
 * The editor's one Zustand store (DESIGN.md §4.2, slice task 4†): code + sheet
 * rows in, debounced derived compile state out, with keep-last-good semantics
 * so a broken keystroke never blanks the preview or flickers the grid tabs.
 *
 * Semantics implemented here (§4.2, exact):
 * - A compile is GOOD iff its diagnostics contain zero error-severity entries
 *   (warnings allowed; data diagnostics never affect goodness — per-card
 *   isolation ⚑8 owns that surface).
 * - Good compile → `lastGoodModel` AND `lastGoodSchema` update, isStale=false.
 *   Bad compile → both last-goods kept, isStale=true; the bad compile's
 *   diagnostics still land in `compile` for Monaco markers.
 * - `lastGoodSchema` is identity-stable: an equal re-extract reuses the
 *   previous snapshot object, so grid subscribers don't re-render per
 *   keystroke (M5† anti-flicker).
 * - When the schema changes, `reconcileSheets` (◆26, pure — exported for
 *   tests) adjusts the row store; if that migrated data (◆26† rename), the
 *   compile is re-run once against the migrated rows so `lastGoodModel`
 *   never shows a one-compile D003 flash for a committed rename.
 *
 * Decisions beyond the spec text (documented at their code sites too):
 * - addRow/deleteRow recompile SYNCHRONOUSLY (task 7, grid MAJOR-1): a row
 *   op shifts every following row's index, so a debounced recompile would
 *   leave the cell-flag index (dataDiagnostics carry rowIndex provenance)
 *   pointing at the WRONG rows for up to 300 ms. Row ops are discrete
 *   clicks, not keystroke bursts — the debounce buys nothing there. setCell/
 *   setCode keep the debounce (they never shift indices mid-burst).
 * - setCell/deleteRow ignore out-of-range rows and unknown sheets (the grid
 *   cannot address them); addRow materializes a missing sheet entry.
 * - `recompile()` is synchronous-unconditional; `flushCompile()` runs a
 *   PENDING debounced compile immediately and is otherwise a no-op.
 *
 * SSR safety: this module is consumed only from "use client" components, but
 * client components still render on the server — so the module stays free of
 * window/document, the seed compile is synchronous, and the debounce timer is
 * only ever scheduled by user-driven actions (never at import time).
 */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  Bindings,
  DataDiagnostic,
  Diagnostic,
  EditedRows,
  Program,
  ProjectResult,
  RenderModel,
  SheetRows,
  ValueType,
} from "@/lib/lang";
import { compileProject } from "@/lib/lang";
import { DEMO_PROJECT_ROWS, DEMO_PROJECT_SOURCE } from "@/lib/lang/demoProject";

/** Live-compile debounce (§4.2 ⚑8): trailing, bursts collapse to one run. */
export const COMPILE_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// State shapes
// ---------------------------------------------------------------------------

/** One sheet's data (⚑12: rows live here, not in the code text). `rows` and
 * `editedRows` are index-aligned; `editedRows[i]` true = the user touched row
 * i since creation (◆29 — the row is then never pristine). */
export interface SheetState {
  rows: Record<string, string>[];
  editedRows: boolean[];
}

export type SheetsState = Record<string, SheetState>;

/** A column's type in a schema snapshot. `Enum` carries its cases so the grid
 * can build dropdowns (task 6) without touching the AST. `Unknown` column
 * types cannot reach a snapshot: an unresolved type is E002 → not a good
 * compile (extractSchema degrades that impossible case to Text). */
export type SchemaColumnType =
  | { kind: "Text" }
  | { kind: "Number" }
  | { kind: "Enum"; enumName: string; cases: string[] };

export interface SchemaColumn {
  name: string;
  type: SchemaColumnType;
}

/** One sheet of the last good schema: name + columns in declaration order. */
export interface SheetSchema {
  name: string;
  columns: SchemaColumn[];
}

/** Sheets in declaration order — what the grid binds to (§4.2 M5†). */
export type SchemaSnapshot = SheetSchema[];

/** The most recent compile, good or bad — Monaco markers read this. */
export interface CompileState {
  program: Program;
  bindings: Bindings;
  diagnostics: Diagnostic[];
  model: RenderModel;
  dataDiagnostics: DataDiagnostic[];
  excludedPristineRows: Record<string, number>;
}

/** The generation surface of the most recent GOOD compile — what the preview
 * renders (task 5). Shapes are shared with `compile` when the last compile
 * was good: treat everything here as immutable (model.ts contract). */
export interface LastGoodModel {
  model: RenderModel;
  dataDiagnostics: DataDiagnostic[];
  excludedPristineRows: Record<string, number>;
}

export interface EditorState {
  code: string;
  sheets: SheetsState;
  compile: CompileState | null;
  lastGoodSchema: SchemaSnapshot | null;
  lastGoodModel: LastGoodModel | null;
  /** True while the latest compile is bad — preview/grid are showing the
   * last good result (§4.2). */
  isStale: boolean;
  /** True when autosave hit unusable storage this session (§6.2 failure
   * posture: private mode, quota). Written by persistence.ts via setState —
   * no action, because nothing inside the editor ever flips it back. */
  autosaveDisabled: boolean;
  setCode(code: string): void;
  /** Writes one cell and marks the row edited (◆29). */
  setCell(sheet: string, row: number, column: string, value: string): void;
  /** Appends a PRISTINE row (edited=false — ◆29: adding a row must not spray
   * D003s before the user can type). Recompiles synchronously (MAJOR-1). */
  addRow(sheet: string): void;
  /** Removes the row and its edited flag together. Recompiles synchronously
   * (MAJOR-1: shifted rows must never wear stale cell flags). */
  deleteRow(sheet: string, row: number): void;
  /** Replace the whole project (§6.2: autosave restore, reset-to-demo) —
   * equivalent to seeding a fresh store while keeping subscribers: seed
   * normalized, last-goods cleared, pending debounce cancelled, eager
   * synchronous recompile. `autosaveDisabled` survives — storage doesn't get
   * healthier because the project changed. */
  replaceProject(seed: EditorSeed): void;
  /** Synchronous unconditional compile (cancels any pending debounce). */
  recompile(): void;
  /** Runs the pending debounced compile now; no-op when nothing is pending. */
  flushCompile(): void;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Extract the sheet schema of a (good) compile from the checker's resolved
 * bindings — never from a broken AST (§4.2 M5†). Map iteration preserves
 * declaration order for sheets and columns alike. */
export function extractSchema(bindings: Bindings): SchemaSnapshot {
  const snapshot: SchemaSnapshot = [];
  for (const [sheetName, info] of bindings.sheets) {
    const columns: SchemaColumn[] = [];
    for (const [columnName, column] of info.columns) {
      columns.push({ name: columnName, type: toSchemaType(column.type, bindings) });
    }
    snapshot.push({ name: sheetName, columns });
  }
  return snapshot;
}

function toSchemaType(type: ValueType, bindings: Bindings): SchemaColumnType {
  switch (type.kind) {
    case "Number":
      return { kind: "Number" };
    case "Enum": {
      // The enum resolved (else the column type would be Unknown → E002, not
      // a good compile); the fallback only guards the type system.
      const decl = bindings.enums.get(type.enumName);
      return {
        kind: "Enum",
        enumName: type.enumName,
        cases: decl ? decl.cases.map((c) => c.name.name) : [],
      };
    }
    default:
      // Text — and, defensively, the Unknown that a good compile cannot
      // produce (documented on SchemaColumnType).
      return { kind: "Text" };
  }
}

/** Type identity for the ◆26† rename heuristic: kind, plus the enum NAME for
 * enum columns (case-list edits don't change a column's type). */
function columnTypeMatches(a: SchemaColumnType, b: SchemaColumnType): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "Enum" || b.kind !== "Enum" || a.enumName === b.enumName;
}

/** Deep snapshot equality — INCLUDING enum case lists, which the grid's
 * dropdowns depend on. Used to keep `lastGoodSchema` identity-stable. */
export function schemaEquals(a: SchemaSnapshot | null, b: SchemaSnapshot): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((sheetA, i) => {
    const sheetB = b[i];
    if (sheetA.name !== sheetB.name || sheetA.columns.length !== sheetB.columns.length) {
      return false;
    }
    return sheetA.columns.every((colA, j) => {
      const colB = sheetB.columns[j];
      if (colA.name !== colB.name || !columnTypeMatches(colA.type, colB.type)) return false;
      if (colA.type.kind !== "Enum" || colB.type.kind !== "Enum") return true;
      const casesB = colB.type.cases;
      return (
        colA.type.cases.length === casesB.length &&
        colA.type.cases.every((c, k) => c === casesB[k])
      );
    });
  });
}

/** The ◆26† heuristic, per sheet: exactly one column removed AND one added at
 * the same index with the same type → treat as a rename. */
function detectRename(
  oldColumns: readonly SchemaColumn[],
  newColumns: readonly SchemaColumn[],
): { from: string; to: string } | null {
  const oldNames = new Set(oldColumns.map((c) => c.name));
  const newNames = new Set(newColumns.map((c) => c.name));
  const removed = oldColumns.filter((c) => !newNames.has(c.name));
  const added = newColumns.filter((c) => !oldNames.has(c.name));
  if (removed.length !== 1 || added.length !== 1) return null;
  const from = removed[0];
  const to = added[0];
  const sameIndex =
    oldColumns.findIndex((c) => c.name === from.name) ===
    newColumns.findIndex((c) => c.name === to.name);
  if (!sameIndex || !columnTypeMatches(from.type, to.type)) return null;
  return { from: from.name, to: to.name };
}

/**
 * Reconcile the row store with a schema change (◆26): PURE — returns the
 * input object unchanged (same reference) when nothing needs to move.
 * - New column → nothing to do (a missing key already reads as empty).
 * - Removed column → nothing to do (values stay in the row objects, orphaned
 *   and invisible, session-preserved; re-adding the column resurfaces them).
 * - ◆26† rename (one removed + one added, same index, same type, one sheet)
 *   → each row's value MOVES from the old key to the new one. Rows without
 *   the old key are left untouched — an orphaned value already sitting under
 *   the new name becomes visible there (fossilized semantics: the column
 *   coming back IS how orphans resurface, ◆26). When the move would
 *   OVERWRITE such an orphan, the displaced value is stashed under a session
 *   tombstone key (`__orphan__<column>`, escalating `__orphan__<column>__2`…
 *   if occupied) in the same row — "compile never deletes data" (◆26) holds.
 *   Tombstone keys can never collide with declared columns (Goblin
 *   identifiers cannot start with `_`, §3.1) and are invisible everywhere an
 *   orphaned key is: to the generator, to pristine derivation, to the grid.
 * - New sheet in the schema with no store entry → empty {rows, editedRows}.
 *   A store entry that already exists (incl. an orphaned sheet coming back)
 *   is kept as-is, so its data resurfaces rather than being reset.
 * - Removed sheet → kept (orphaned, never deleted).
 */
export function reconcileSheets(
  sheets: SheetsState,
  oldSchema: SchemaSnapshot | null,
  newSchema: SchemaSnapshot,
): SheetsState {
  let next: SheetsState | null = null;
  const mutable = (): SheetsState => (next ??= { ...sheets });

  for (const sheet of newSchema) {
    if (!Object.hasOwn(sheets, sheet.name)) {
      mutable()[sheet.name] = { rows: [], editedRows: [] };
      continue;
    }
    const old = oldSchema?.find((s) => s.name === sheet.name);
    if (!old) continue;
    const rename = detectRename(old.columns, sheet.columns);
    if (!rename) continue;
    const entry = sheets[sheet.name];
    let moved = false;
    const rows = entry.rows.map((row) => {
      if (!Object.hasOwn(row, rename.from)) return row;
      moved = true;
      const { [rename.from]: value, ...rest } = row;
      if (Object.hasOwn(rest, rename.to)) {
        // Never-delete (◆26): the orphan the move would overwrite is stashed
        // under a tombstone key (see the function comment).
        rest[tombstoneKey(rest, rename.to)] = rest[rename.to];
      }
      return { ...rest, [rename.to]: value };
    });
    if (moved) mutable()[sheet.name] = { rows, editedRows: entry.editedRows };
  }
  return next ?? sheets;
}

/** First free tombstone slot for a displaced orphan: `__orphan__<column>`,
 * then `__orphan__<column>__2`, `__3`, … — repeated renames onto the same
 * name must not overwrite an earlier tombstone (◆26 never-delete). */
function tombstoneKey(row: Record<string, string>, column: string): string {
  const base = `__orphan__${column}`;
  if (!Object.hasOwn(row, base)) return base;
  for (let n = 2; ; n++) {
    const key = `${base}__${n}`;
    if (!Object.hasOwn(row, key)) return key;
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface EditorSeed {
  code: string;
  /** Taken over by the store — pass a fresh object per store. CONTRACT: each
   * sheet's `rows` and `editedRows` are index-aligned; createEditorStore
   * normalizes a misaligned seed to rows.length (missing flags → false,
   * extras dropped, non-`true` values → false) rather than carrying the
   * misalignment into ◆29 pristine decisions. */
  sheets: SheetsState;
}

/** Enforce the EditorSeed alignment contract (see above): editedRows becomes
 * exactly rows.length booleans. Always rebuilds the flag arrays, so a store
 * never aliases the caller's. */
function normalizeSeedSheets(sheets: SheetsState): SheetsState {
  const normalized: SheetsState = {};
  for (const [name, sheet] of Object.entries(sheets)) {
    normalized[name] = {
      rows: sheet.rows,
      editedRows: sheet.rows.map((_, i) => sheet.editedRows[i] === true),
    };
  }
  return normalized;
}

/** The §3.9 seed: demo code verbatim + the Dragon/Imp rows, both flagged
 * edited (they carry content; a fresh copy per call so stores never share
 * mutable row objects). */
export function demoSeed(): EditorSeed {
  return {
    code: DEMO_PROJECT_SOURCE,
    sheets: {
      Monsters: {
        rows: DEMO_PROJECT_ROWS.map((row) => ({ ...row })),
        editedRows: DEMO_PROJECT_ROWS.map(() => true),
      },
    },
  };
}

export type EditorStore = StoreApi<EditorState>;

const isGood = (diagnostics: readonly Diagnostic[]): boolean =>
  !diagnostics.some((d) => d.severity === "error");

const rowsOf = (sheets: SheetsState): SheetRows => {
  const rows: SheetRows = {};
  for (const [name, sheet] of Object.entries(sheets)) rows[name] = sheet.rows;
  return rows;
};

const editedOf = (sheets: SheetsState): EditedRows => {
  const edited: EditedRows = {};
  for (const [name, sheet] of Object.entries(sheets)) edited[name] = sheet.editedRows;
  return edited;
};

const toCompileState = (result: ProjectResult): CompileState => ({
  program: result.program,
  bindings: result.bindings,
  diagnostics: result.diagnostics,
  model: result.model,
  dataDiagnostics: result.dataDiagnostics,
  excludedPristineRows: result.excludedPristineRows,
});

/** Build a store (headless-usable — tests create one per case). Runs the
 * first compile eagerly so seeded content renders without waiting for an
 * edit. */
export function createEditorStore(seed: EditorSeed = demoSeed()): EditorStore {
  const seedSheets = normalizeSeedSheets(seed.sheets);
  // Debounce state lives per store, in this closure — never module-shared,
  // so test stores cannot leak timers into each other.
  let timer: ReturnType<typeof setTimeout> | null = null;

  const store = createStore<EditorState>()((set, get) => {
    const cancelPending = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const runCompile = (): void => {
      const state = get();
      let sheets = state.sheets;
      let result = compileProject(state.code, rowsOf(sheets), editedOf(sheets));

      if (!isGood(result.diagnostics)) {
        // BAD compile: keep both last-goods (§4.2 †). The diagnostics still
        // flow to `compile` — Monaco shows live errors while preview/grid
        // hold steady.
        set({ compile: toCompileState(result), isStale: true });
        return;
      }

      const extracted = extractSchema(result.bindings);
      const prior = state.lastGoodSchema;
      // Identity-stable (M5†): an equal re-extract reuses the prior snapshot.
      const schema = prior !== null && schemaEquals(prior, extracted) ? prior : extracted;
      if (schema !== state.lastGoodSchema) {
        const reconciled = reconcileSheets(sheets, state.lastGoodSchema, schema);
        if (reconciled !== sheets) {
          // Reconciliation moved data (◆26† rename) or materialized a sheet:
          // the model above read the PRE-migration rows, so compile once more
          // against the reconciled data (same code → same diagnostics/schema;
          // no further reconciliation can trigger, so this cannot loop).
          sheets = reconciled;
          result = compileProject(state.code, rowsOf(sheets), editedOf(sheets));
        }
      }

      set({
        sheets,
        compile: toCompileState(result),
        lastGoodSchema: schema,
        lastGoodModel: {
          model: result.model,
          dataDiagnostics: result.dataDiagnostics,
          excludedPristineRows: result.excludedPristineRows,
        },
        isStale: false,
      });
    };

    const schedule = (): void => {
      cancelPending();
      timer = setTimeout(() => {
        timer = null;
        runCompile();
      }, COMPILE_DEBOUNCE_MS);
    };

    return {
      code: seed.code,
      sheets: seedSheets,
      compile: null,
      lastGoodSchema: null,
      lastGoodModel: null,
      isStale: false,
      autosaveDisabled: false,

      setCode: (code) => {
        set({ code });
        schedule();
      },

      setCell: (sheet, row, column, value) => {
        const sheets = get().sheets;
        const entry = Object.hasOwn(sheets, sheet) ? sheets[sheet] : undefined;
        if (!entry || row < 0 || row >= entry.rows.length) return; // unaddressable
        const rows = entry.rows.slice();
        rows[row] = { ...rows[row], [column]: value };
        const editedRows = entry.editedRows.slice();
        editedRows[row] = true; // ◆29: touched — never pristine again
        set({ sheets: { ...sheets, [sheet]: { rows, editedRows } } });
        schedule();
      },

      addRow: (sheet) => {
        const sheets = get().sheets;
        const entry = Object.hasOwn(sheets, sheet)
          ? sheets[sheet]
          : { rows: [], editedRows: [] };
        set({
          sheets: {
            ...sheets,
            [sheet]: {
              rows: [...entry.rows, {}],
              editedRows: [...entry.editedRows, false],
            },
          },
        });
        // SYNCHRONOUS (MAJOR-1): a row op re-indexes rows, so the debounce
        // window would show stale per-row state (flags, pristine counts).
        // Any pending debounced compile is subsumed by this one.
        cancelPending();
        runCompile();
      },

      deleteRow: (sheet, row) => {
        const sheets = get().sheets;
        const entry = Object.hasOwn(sheets, sheet) ? sheets[sheet] : undefined;
        if (!entry || row < 0 || row >= entry.rows.length) return;
        set({
          sheets: {
            ...sheets,
            [sheet]: {
              rows: entry.rows.filter((_, i) => i !== row),
              editedRows: entry.editedRows.filter((_, i) => i !== row),
            },
          },
        });
        // SYNCHRONOUS (MAJOR-1): deleting row i shifts every later row's
        // index — cell flags keyed by rowIndex must recompute NOW, not after
        // the 300 ms debounce, or the grid flags the wrong rows meanwhile.
        cancelPending();
        runCompile();
      },

      replaceProject: (next) => {
        // Fresh-store semantics (§6.2): the last-goods belong to the OLD
        // project — a restore/reset must not leave the preview showing it.
        cancelPending();
        set({
          code: next.code,
          sheets: normalizeSeedSheets(next.sheets),
          compile: null,
          lastGoodSchema: null,
          lastGoodModel: null,
          isStale: false,
        });
        runCompile();
      },

      recompile: () => {
        cancelPending();
        runCompile();
      },

      flushCompile: () => {
        if (timer === null) return;
        cancelPending();
        runCompile();
      },
    };
  });

  // Eager first compile: seeded content must render without waiting for an
  // edit. Synchronous and pure — safe during SSR/prerender.
  store.getState().recompile();
  return store;
}

/** The app's singleton store, seeded with the §3.9 demo. Consumed from
 * "use client" components only (client components still prerender — the
 * module-level compile above is deliberately SSR-safe). */
export const editorStore: EditorStore = createEditorStore();

/** Panel-facing hook over the singleton. */
export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  return useStore(editorStore, selector);
}
