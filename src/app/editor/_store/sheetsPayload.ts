/**
 * The `sheets` payload shape shared by every persisted-project format
 * (localStorage autosave, project files, and — DESIGN.md §7.6 — cloud sync):
 * parse/shape-validate, pulled out of persistence.ts on its own so it can be
 * imported WITHOUT dragging that module's transitive graph along.
 *
 * WHY THIS IS ITS OWN FILE: persistence.ts imports `editorStore` (a value,
 * not just a type) for its restore/reset paths, and editorStore.ts eagerly
 * builds the app's singleton store at module scope (`createEditorStore()`,
 * which runs a real `compileProject` against the demo seed). That's fine for
 * a browser bundle, but src/lib/cloud/projectPayload.ts (server-only, used by
 * every /api/cloud/* route) needs only the pure parsing logic — pulling in
 * zustand + the whole compiler on every cold start just to reuse ~20 lines
 * would bloat every cloud route's serverless function for nothing (this
 * project has already had to fight function-size limits once — see
 * next.config.ts's outputFileTracingExcludes comment). This module has zero
 * runtime imports (only a type-only import of SheetsState, erased by
 * `isolatedModules`), so importing it costs exactly what it looks like.
 *
 * persistence.ts and projectFile.tsx both still work unchanged: persistence.ts
 * re-exports `isRecord`/`parseSheetsPayload`/`sheetsToPersisted` from here,
 * so every existing `from "@/app/editor/_store/persistence"` import keeps
 * resolving the same names.
 */

import type { SheetsState } from "@/app/editor/_store/editorStore";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The `sheets` shape every persisted-project payload carries verbatim
 * (autosave v1, project-file v1/v2, and cloud sync's project.json) —
 * extracted so every writer builds it identically. Explicit field picks:
 * whatever else SheetState grows later must opt in here (and bump a version
 * if a reload/pull can't ignore it). */
export function sheetsToPersisted(
  sheets: SheetsState,
): Record<string, { rows: Record<string, string>[]; editedRows: boolean[] }> {
  const persistedSheets: Record<string, { rows: Record<string, string>[]; editedRows: boolean[] }> =
    {};
  for (const [name, sheet] of Object.entries(sheets)) {
    persistedSheets[name] = { rows: sheet.rows, editedRows: sheet.editedRows };
  }
  return persistedSheets;
}

/**
 * Shape-validate a payload's `sheets` object → a store-ready `SheetsState`,
 * or null if anything is off. Shared by THREE callers now (autosave,
 * project-file v1/v2, cloud sync's project.json): the sheet shape itself is
 * one definition, reused, not forked, everywhere it's read.
 *
 * Strict about what matters, lenient where the seed contract already is:
 * `rows` must be string-valued records (orphaned `__orphan__*` keys are
 * ordinary string entries and round-trip untouched); `editedRows` need only
 * be an array — createEditorStore/replaceProject normalize misalignment and
 * non-`true` entries per the EditorSeed contract.
 */
export function parseSheetsPayload(raw: Record<string, unknown>): SheetsState | null {
  // Null prototype: a hand-crafted payload with a "__proto__" sheet name must
  // not hit the prototype setter (it would silently drop the sheet on restore).
  const sheets: SheetsState = Object.create(null) as SheetsState;
  for (const [name, sheet] of Object.entries(raw)) {
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
  return sheets;
}
