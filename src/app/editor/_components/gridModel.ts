/**
 * Pure logic for the schema-driven grid (DESIGN.md §4.2, task 6). No React,
 * no DOM, no store — everything here is exported for unit tests, and the
 * component (windowSpreadsheet.tsx) is a thin render over these functions.
 *
 * LIBRARY DECISION (§4.2's deferred react-spreadsheet-vs-bespoke point):
 * the grid is BESPOKE (a plain table of inputs/selects). react-spreadsheet
 * 0.9.5 does expose per-cell `DataEditor`/`className` and indicator
 * overrides, but every requirement of this task sits at its edges: paste is
 * handled inside its reducer (an oversized paste surfaces only as a grown
 * onChange matrix, forcing whole-matrix diffing — the exact mechanism that
 * silently truncated multi-row pastes in the task-4 interim binding), there
 * is no per-row delete affordance or row-level dimming API, a zero-column
 * sheet (⚑13†) is not a renderable configuration, and the dark editor
 * chrome would mean globally overriding its shipped stylesheet. The glue
 * would have been larger than this hand-rolled grid, and none of it would
 * have been unit-testable as pure functions.
 */

import type { DataDiagnostic } from "@/lib/lang";
import type {
  SchemaColumn,
  SchemaColumnType,
  SchemaSnapshot,
  SheetsState,
} from "@/app/editor/_store/editorStore";

// ---------------------------------------------------------------------------
// Tabs and columns (⚑3: the schema owns both)
// ---------------------------------------------------------------------------

export interface GridTab {
  name: string;
  rowCount: number;
}

/** Column sizing belongs to the view, not the sheet payload. Keeping the bounds
 * here makes pointer and keyboard resizing share one tested policy. */
export const DEFAULT_COLUMN_WIDTH_PX = 144;
export const MIN_COLUMN_WIDTH_PX = 96;
export const MAX_COLUMN_WIDTH_PX = 720;

export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COLUMN_WIDTH_PX;
  return Math.min(MAX_COLUMN_WIDTH_PX, Math.max(MIN_COLUMN_WIDTH_PX, Math.round(width)));
}

/**
 * One tab per sheet of the LAST GOOD schema, in declaration order (§4.2
 * M5†). Tabs come only from the schema: store sheets absent from it —
 * orphaned by a code edit — are session-preserved data (◆26) and stay
 * INVISIBLE here; re-declaring the sheet is how they resurface.
 */
export function gridTabsOf(schema: SchemaSnapshot, sheets: SheetsState): GridTab[] {
  return schema.map((sheet) => ({
    name: sheet.name,
    rowCount: Object.hasOwn(sheets, sheet.name) ? sheets[sheet.name].rows.length : 0,
  }));
}

/** The type half of a column header: "Text", "Number", or the enum's name
 * (the demo's `suit` column reads "suit · Suit"). */
export function columnTypeLabel(type: SchemaColumnType): string {
  return type.kind === "Enum" ? type.enumName : type.kind;
}

/** Full header label, e.g. "cost · Number". The component renders the two
 * halves separately (dimmer type); this joined form is the canonical text. */
export function columnHeaderLabel(column: SchemaColumn): string {
  return `${column.name} · ${columnTypeLabel(column.type)}`;
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/**
 * Own-property read of one cell — MIRRORS generate.ts's rawCellOf exactly:
 * missing key = empty (◆26: an added column needs no row rewrite), a column
 * named `constructor` must read empty, not a prototype function, and
 * non-string garbage (a null/number smuggled past the string type) is
 * stringified rather than returned raw — so isPristineRow's `.trim()` can
 * never throw on it (task 7, grid MINOR-4).
 *
 * Columns are enumerated from the SCHEMA, never from row keys: orphaned
 * column values and the store's `__orphan__*` tombstone keys (editorStore
 * reconcileSheets, ◆26†) live on inside the row objects by design and must
 * NEVER render — do not "fix" cell access to iterate the row's own keys.
 */
export function cellValueOf(row: Record<string, string>, column: string): string {
  if (!Object.hasOwn(row, column)) return "";
  const v: unknown = row[column];
  return v == null ? "" : typeof v === "string" ? v : String(v);
}

/** Enum dropdown options (§4.2): an explicit empty choice, then the enum's
 * cases in declaration order. */
export function enumOptionsOf(cases: readonly string[]): string[] {
  return ["", ...cases];
}

// ---------------------------------------------------------------------------
// Cell edit state machine (task 7, grid MINOR-5)
// ---------------------------------------------------------------------------

/** A cell's local edit state: `null` = showing the committed store value,
 * a string = the user's uncommitted draft (TextCell while typing). */
export type CellDraft = string | null;

/** Everything a cell editor can do to its draft:
 * - `type`  — keystroke/native paste into a text input → replaces the draft;
 * - `commit` — blur (Enter blurs, so Enter-commit rides this) → writes the
 *   draft to the store IFF it really changed;
 * - `escape` — revert the draft in place, nothing written;
 * - `select` — an enum dropdown change: draftless, commits immediately but
 *   still only on a REAL change. */
export type CellEditAction =
  | { kind: "type"; value: string }
  | { kind: "commit" }
  | { kind: "escape" }
  | { kind: "select"; value: string };

export interface CellEditResult {
  /** The next draft state (always `null` after commit/escape/select). */
  draft: CellDraft;
  /** Present ⇔ this transition must call setCell with this value. */
  commit?: string;
}

/**
 * Pure reducer behind TextCell/EnumCell (the components are thin wires over
 * this). The load-bearing rule: a commit fires ONLY when the draft differs
 * from the committed value — a spurious setCell would flag the row edited
 * and cost it its pristine exclusion (◆29). Escape discards the draft;
 * committing without a draft (blur after focus, no typing) writes nothing.
 */
export function cellEditReduce(
  draft: CellDraft,
  committed: string,
  action: CellEditAction,
): CellEditResult {
  switch (action.kind) {
    case "type":
      return { draft: action.value };
    case "escape":
      return { draft: null };
    case "commit":
      return draft !== null && draft !== committed
        ? { draft: null, commit: draft }
        : { draft: null };
    case "select":
      return action.value !== committed
        ? { draft: null, commit: action.value }
        : { draft: null };
  }
}

// ---------------------------------------------------------------------------
// Row-index gutter (§3.6, ◆42: the editable row-position field)
// ---------------------------------------------------------------------------

export type IndexEditResult = { kind: "move"; to: number } | { kind: "none" };

/**
 * Pure position→ops mapping behind the row-number gutter (the component is a
 * thin wire, same discipline as cellEditReduce). `currentIndex`/`to` are
 * BOTH 0-based array indices — `to` is ready to pass straight to the store's
 * `moveRow(sheet, currentIndex, to)` — while `rawInput` is what the user
 * typed, which reads as the 1-based position shown in the gutter.
 *
 * - Blank, non-numeric, or non-integer (a decimal — a row position is an
 *   ordinal, not a measurement) input reverts with NO move: garbage must
 *   never reach the store and spend the row's ◆29 edited flag on a no-op.
 * - Clamp: a typed position ≤ 1 → the first row (index 0); ≥ rowCount → the
 *   last row (index rowCount - 1) — "move and shift", never "swap": typing
 *   2 on row 10 of A..J yields A J B C D E F G H I (◆42).
 * - Landing back on the row's OWN current position (after clamping) is also
 *   `"none"` — typing the unchanged number must not call the store either.
 * - `rowCount <= 0` reverts unconditionally: the gutter only ever renders
 *   for an existing row (rowCount is always >= 1 in real UI calls), but a
 *   pure function shouldn't hand back a negative index just because a
 *   future caller passed it a row count that can't exist.
 */
export function resolveIndexEdit(
  rawInput: string,
  currentIndex: number,
  rowCount: number,
): IndexEditResult {
  if (rowCount <= 0) return { kind: "none" };
  const trimmed = rawInput.trim();
  if (!/^-?\d+$/.test(trimmed)) return { kind: "none" };
  const oneBased = Math.min(Math.max(Number(trimmed), 1), rowCount);
  const to = oneBased - 1;
  return to === currentIndex ? { kind: "none" } : { kind: "move", to };
}

// ---------------------------------------------------------------------------
// Red flags (D001–D003 cell provenance)
// ---------------------------------------------------------------------------

/** Index key for one cell's flags. `"\\u0000"` cannot occur in a sheet or
 * column name (Goblin identifiers, §3.1), so keys never collide across
 * sheets that share a rowIndex/column — no flag bleed. */
export function cellFlagKey(sheet: string, rowIndex: number, column: string): string {
  return `${sheet}\u0000${rowIndex}\u0000${column}`;
}

/**
 * cell-carrying data diagnostics → flag map (key → tooltip message). Only
 * D001–D003 carry `cell` (model.ts); card/deck-scoped diagnostics belong to
 * the preview's placeholders, not the grid. Multiple messages on one cell
 * join with newlines (a `title` tooltip renders them as lines).
 */
export function buildFlagIndex(
  diagnostics: readonly DataDiagnostic[],
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const d of diagnostics) {
    if (!d.cell) continue;
    const key = cellFlagKey(d.cell.sheet, d.cell.rowIndex, d.cell.column);
    const prev = index.get(key);
    index.set(key, prev === undefined ? d.message : `${prev}\n${d.message}`);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Pristine rows (◆29)
// ---------------------------------------------------------------------------

/**
 * MIRRORS the generator's rule exactly (generate.ts sheet prep): pristine ⇔
 * the sheet has columns AND the row was never flagged edited AND every
 * DECLARED cell is empty/whitespace-only. Zero-column rows are never
 * pristine (⚑13† — their existence is the edit), and orphaned/tombstoned
 * values don't count against pristineness (they are invisible, ◆26). The
 * grid dims exactly the rows the generator excludes.
 */
export function isPristineRow(
  row: Record<string, string>,
  columnNames: readonly string[],
  edited: boolean,
): boolean {
  return (
    columnNames.length > 0 &&
    !edited &&
    columnNames.every((column) => cellValueOf(row, column).trim() === "")
  );
}

// ---------------------------------------------------------------------------
// Multi-row paste (task-4 debt: pasted rows must MATERIALIZE, never vanish)
// ---------------------------------------------------------------------------

/**
 * Parse a clipboard `text/plain` payload into a cell block: rows split on
 * newlines (CRLF and bare CR normalized), cells split on tabs — the format
 * every spreadsheet app writes. ONE trailing newline is stripped (Excel &
 * co. terminate the payload with it; it is not an extra empty row). An
 * empty payload → empty block.
 */
export function parseClipboardBlock(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  if (body === "") return [];
  return body.split("\n").map((line) => line.split("\t"));
}

/**
 * Should this paste bypass the browser's native handling and commit through
 * the store (pasteOps/applyPasteOps)? (task 7, grid MINOR-1)
 * - Multi-cell blocks always commit directly (the materializing paste).
 * - A 1×1 payload on a TEXT cell stays native: it lands in the focused
 *   input's draft and commits on blur like typing.
 * - A 1×1 payload on an ENUM cell must ALSO commit directly — a `<select>`
 *   has no draft, so native paste is a silent no-op there. Invalid values
 *   are fine: they flag D001 and render as the phantom option (EnumCell).
 * - An empty payload commits nothing either way.
 */
export function pasteCommitsDirectly(
  block: readonly (readonly string[])[],
  enumCell: boolean,
): boolean {
  if (block.length === 0) return false;
  const single = block.length === 1 && block[0].length <= 1;
  return !single || enumCell;
}

/** One store mutation of a block paste, in application order. */
export type PasteOp =
  | { kind: "addRow"; sheet: string }
  | { kind: "setCell"; sheet: string; row: number; column: string; value: string };

/**
 * Map a parsed clipboard block anchored at (anchorRow, anchorColumnIndex)
 * to store operations:
 * - addRow ops FIRST — one per row the block extends beyond the current
 *   count, so every pasted row exists before any cell lands (the task-4
 *   MINOR-2 fix: a taller-than-sheet paste materializes, never truncates);
 * - then setCell ops in row-major block order (setCell flags each row
 *   edited, so a materialized row is never left pristine, ◆29).
 * Cells that fall RIGHT of the last schema column are DROPPED: columns are
 * schema-fixed (⚑3 — the grid has no add-column), so a too-wide block has
 * nowhere to put its overflow; the D-free subset still lands.
 */
export function pasteOps(
  sheet: string,
  anchorRow: number,
  anchorColumnIndex: number,
  columnNames: readonly string[],
  currentRowCount: number,
  block: readonly (readonly string[])[],
): PasteOp[] {
  if (block.length === 0 || anchorRow < 0 || anchorColumnIndex < 0) return [];
  const ops: PasteOp[] = [];
  const missingRows = anchorRow + block.length - currentRowCount;
  for (let i = 0; i < missingRows; i++) ops.push({ kind: "addRow", sheet });
  block.forEach((cells, i) => {
    cells.forEach((value, j) => {
      const column = columnNames[anchorColumnIndex + j];
      if (column === undefined) return; // overflow right of the schema — dropped (see above)
      ops.push({ kind: "setCell", sheet, row: anchorRow + i, column, value });
    });
  });
  return ops;
}

/** The store surface a paste needs — matches EditorState's actions, so a
 * component (or a headless test) can pass store actions straight through. */
export interface PasteTarget {
  addRow(sheet: string): void;
  setCell(sheet: string, row: number, column: string, value: string): void;
}

/** Apply paste ops in order. Store actions update synchronously, so every
 * addRow has landed before the first setCell addresses its row. */
export function applyPasteOps(ops: readonly PasteOp[], target: PasteTarget): void {
  for (const op of ops) {
    if (op.kind === "addRow") target.addRow(op.sheet);
    else target.setCell(op.sheet, op.row, op.column, op.value);
  }
}
