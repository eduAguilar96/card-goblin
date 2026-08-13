"use client";

/**
 * The schema-driven grid window (DESIGN.md §4.2, task 6): one tab per sheet
 * of `lastGoodSchema`, exactly the schema's columns (⚑3 — no add/rename/
 * delete column UI), enum dropdown cells, D001–D003 red cell flags, pristine
 * row dimming (◆29), row add/delete, and materializing multi-row paste.
 *
 * BESPOKE grid — the §4.2 decision point resolved against react-spreadsheet
 * (rationale in gridModel.ts's header); all non-render logic lives there as
 * pure, unit-tested functions.
 *
 * Store contract:
 * - Tabs/columns bind to `lastGoodSchema` ONLY (M5† — a broken keystroke
 *   never flickers tabs). Because columns come from the schema and never
 *   from row keys, orphaned column data and `__orphan__*` tombstone keys
 *   (◆26/◆26†) are invisible by construction — see cellValueOf.
 * - Cell flags read the CURRENT compile's dataDiagnostics: the generator
 *   runs even when the code has errors (compileProject never blocks
 *   generation), so red cells track the latest rows, not the last good
 *   model's stale copy.
 * - All writes go through store actions (setCell/addRow/deleteRow) — setCell
 *   marks the row edited (◆29), which is why commits fire only on REAL
 *   value changes (a spurious commit would cost a row its pristine
 *   exclusion).
 *
 * Split (same pattern as windowPreview): `WindowSpreadsheet` is the thin
 * store subscription; `SpreadsheetContent` (exported for tests) takes the
 * store surface as props so tests can drive it with a headless store's
 * state and renderToStaticMarkup.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import type { DataDiagnostic } from "@/lib/lang";
import {
  useEditorStore,
  type SchemaSnapshot,
  type SheetSchema,
  type SheetState,
  type SheetsState,
} from "@/app/editor/_store/editorStore";
import {
  applyPasteOps,
  buildFlagIndex,
  cellEditReduce,
  cellFlagKey,
  cellValueOf,
  columnTypeLabel,
  enumOptionsOf,
  gridTabsOf,
  isPristineRow,
  parseClipboardBlock,
  pasteCommitsDirectly,
  pasteOps,
  type CellDraft,
  type CellEditAction,
  type PasteTarget,
} from "@/app/editor/_components/gridModel";

/** Stable empty fallbacks — selectors/props must not mint fresh references
 * per render (useSyncExternalStore re-render loop). */
const NO_DIAGNOSTICS: readonly DataDiagnostic[] = [];
const EMPTY_SHEET: SheetState = { rows: [], editedRows: [] };

export interface SpreadsheetActions extends PasteTarget {
  deleteRow(sheet: string, row: number): void;
}

export default function WindowSpreadsheet(): ReactElement {
  const schema = useEditorStore((s) => s.lastGoodSchema);
  const sheets = useEditorStore((s) => s.sheets);
  const compile = useEditorStore((s) => s.compile);
  const setCell = useEditorStore((s) => s.setCell);
  const addRow = useEditorStore((s) => s.addRow);
  const deleteRow = useEditorStore((s) => s.deleteRow);
  const actions = useMemo<SpreadsheetActions>(
    () => ({ setCell, addRow, deleteRow }),
    [setCell, addRow, deleteRow],
  );
  return (
    <SpreadsheetContent
      schema={schema}
      sheets={sheets}
      dataDiagnostics={compile?.dataDiagnostics ?? NO_DIAGNOSTICS}
      actions={actions}
    />
  );
}

export interface SpreadsheetContentProps {
  schema: SchemaSnapshot | null;
  sheets: SheetsState;
  dataDiagnostics: readonly DataDiagnostic[];
  actions: SpreadsheetActions;
}

export function SpreadsheetContent({
  schema,
  sheets,
  dataDiagnostics,
  actions,
}: SpreadsheetContentProps): ReactElement {
  // Active tab is LOCAL state, name-keyed: if the active sheet leaves the
  // schema, the render falls back to the first sheet without a state write
  // (and comes back should the name return — session preservation, ◆26).
  const [activeName, setActiveName] = useState<string | null>(null);
  // Per-tab scroll memory: saved when switching AWAY (in the click handler,
  // while the outgoing sheet still owns the scroll box), restored by the
  // effect below — so switching preserves each tab's position.
  const scrollPositions = useRef(new Map<string, { left: number; top: number }>());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const active: SheetSchema | undefined =
    schema?.find((sheet) => sheet.name === activeName) ?? schema?.[0];
  const activeSheetName = active?.name;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || activeSheetName === undefined) return;
    const pos = scrollPositions.current.get(activeSheetName);
    el.scrollLeft = pos?.left ?? 0;
    el.scrollTop = pos?.top ?? 0;
  }, [activeSheetName]);

  const flags = useMemo(() => buildFlagIndex(dataDiagnostics), [dataDiagnostics]);

  if (schema === null) {
    return (
      <Empty>
        No schema yet — the grid appears after the first good compile. Fix the
        errors in the code window.
      </Empty>
    );
  }
  if (schema.length === 0) {
    return (
      <Empty>
        The code declares no sheets. Add a <code>Sheet:</code> block to get a
        grid.
      </Empty>
    );
  }

  const tabs = gridTabsOf(schema, sheets);
  const switchTab = (name: string): void => {
    if (name === activeSheetName) return;
    const el = scrollRef.current;
    if (el && activeSheetName !== undefined) {
      scrollPositions.current.set(activeSheetName, {
        left: el.scrollLeft,
        top: el.scrollTop,
      });
    }
    setActiveName(name);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-800 text-sm text-gray-200">
      <div
        role="tablist"
        aria-label="Sheets"
        className="flex shrink-0 items-end gap-1 overflow-x-auto border-b border-gray-700 bg-gray-900 px-2 pt-1.5"
      >
        {tabs.map((tab) => {
          const isActive = tab.name === activeSheetName;
          return (
            <button
              key={tab.name}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => switchTab(tab.name)}
              className={
                isActive
                  ? "whitespace-nowrap rounded-t border border-b-0 border-gray-700 bg-gray-800 px-3 py-1 text-xs font-semibold text-white"
                  : "whitespace-nowrap rounded-t border border-transparent px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }
            >
              {tab.name}
              <span className={isActive ? "ml-1.5 font-normal text-gray-400" : "ml-1.5 text-gray-500"}>
                {tab.rowCount}
              </span>
            </button>
          );
        })}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {active && (
          <SheetGrid
            key={active.name}
            sheet={active}
            state={Object.hasOwn(sheets, active.name) ? sheets[active.name] : EMPTY_SHEET}
            flags={flags}
            actions={actions}
          />
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="h-full w-full overflow-auto bg-gray-800 p-4 text-sm text-gray-400">
      {children}
    </div>
  );
}

interface SheetGridProps {
  sheet: SheetSchema;
  state: SheetState;
  flags: ReadonlyMap<string, string>;
  actions: SpreadsheetActions;
}

function SheetGrid({ sheet, state, flags, actions }: SheetGridProps): ReactElement {
  // Column identity comes from the SCHEMA only (⚑3). Row objects may carry
  // orphaned columns and `__orphan__*` tombstones (◆26/◆26† — session
  // preservation); enumerating schema columns is what keeps them invisible.
  // Do not "fix" this to derive columns from row keys.
  const columnNames = sheet.columns.map((column) => column.name);
  const zeroColumns = sheet.columns.length === 0;

  const handlePaste = (
    e: ClipboardEvent<HTMLElement>,
    rowIndex: number,
    columnIndex: number,
    enumCell: boolean,
  ): void => {
    const block = parseClipboardBlock(e.clipboardData.getData("text/plain"));
    // Routing (gridModel.pasteCommitsDirectly, MINOR-1): a 1×1 payload on a
    // text cell stays native (drafts, commits on blur like typing); on an
    // enum <select> — which has no draft — it must commit through the store
    // or the paste is a silent no-op. Multi-cell blocks always commit.
    if (!pasteCommitsDirectly(block, enumCell)) return;
    e.preventDefault();
    applyPasteOps(
      pasteOps(sheet.name, rowIndex, columnIndex, columnNames, state.rows.length, block),
      actions,
    );
  };

  return (
    <div className="inline-block min-w-full p-0 pb-2">
      {zeroColumns && (
        <p className="px-3 pb-1 pt-2 text-xs italic text-gray-500">
          this sheet has no columns; rows control card count
        </p>
      )}
      <table className="border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            {/* Sticky header row: the grid stays usable at the panel's
                default 30% height — only the body scrolls under it. */}
            <th className={`${HEADER_TH} w-14 min-w-14`} aria-label="Row number" />
            {sheet.columns.map((column) => (
              <th key={column.name} className={`${HEADER_TH} text-left`}>
                {column.name}
                <span className="font-normal text-gray-500"> · {columnTypeLabel(column.type)}</span>
              </th>
            ))}
            <th className={`${HEADER_TH} w-full`} aria-hidden />
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row, r) => {
            const pristine = isPristineRow(row, columnNames, state.editedRows[r] === true);
            return (
              <tr key={r} className={`group ${pristine ? "opacity-50" : ""}`}>
                <th
                  scope="row"
                  className="border-b border-r border-gray-700 bg-gray-900/60 px-1.5 py-0 font-normal text-gray-500"
                >
                  <span className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      aria-label={`delete row ${r + 1}`}
                      title="delete row"
                      onClick={() => actions.deleteRow(sheet.name, r)}
                      // adversarial review item 4: `invisible` (visibility:
                      // hidden) drops the button from the tab order entirely
                      // — a keyboard user could never reach it. `opacity-0`
                      // keeps it focusable and clickable while still out of
                      // the way visually; it reveals on mouse hover (row
                      // group-hover, unchanged) AND on its own keyboard
                      // focus (focus-visible), so Tab-ing to it doesn't land
                      // on an invisible control.
                      className="rounded px-0.5 text-gray-500 opacity-0 outline-none transition-opacity hover:text-red-400 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-sky-500 group-hover:opacity-100"
                    >
                      ×
                    </button>
                    {r + 1}
                  </span>
                </th>
                {sheet.columns.map((column, c) => {
                  const flag = flags.get(cellFlagKey(sheet.name, r, column.name));
                  const value = cellValueOf(row, column.name);
                  return (
                    <td
                      key={column.name}
                      title={flag}
                      className={`border-b border-r p-0 ${
                        flag !== undefined
                          ? "border-red-700 bg-red-950/60"
                          : "border-gray-700/60"
                      }`}
                    >
                      {column.type.kind === "Enum" ? (
                        <EnumCell
                          value={value}
                          cases={column.type.cases}
                          flagged={flag !== undefined}
                          onCommit={(next) => actions.setCell(sheet.name, r, column.name, next)}
                          onPasteBlock={(e) => handlePaste(e, r, c, true)}
                        />
                      ) : (
                        <TextCell
                          value={value}
                          flagged={flag !== undefined}
                          onCommit={(next) => actions.setCell(sheet.name, r, column.name, next)}
                          onPasteBlock={(e) => handlePaste(e, r, c, false)}
                        />
                      )}
                    </td>
                  );
                })}
                <td className="whitespace-nowrap border-b border-gray-700/60 px-2 text-[10px] italic text-gray-500">
                  {pristine && (
                    <span title="never-edited, all-empty rows are excluded from generation">
                      pristine — excluded
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => actions.addRow(sheet.name)}
        className="mx-2 mt-1.5 rounded border border-dashed border-gray-600 px-3 py-1 text-xs text-gray-400 hover:border-gray-500 hover:bg-gray-700 hover:text-gray-200"
      >
        + add row
      </button>
    </div>
  );
}

const HEADER_TH =
  "sticky top-0 z-10 whitespace-nowrap border-b border-r border-gray-700 bg-gray-900 px-2 py-1.5 font-semibold text-gray-300";

interface TextCellProps {
  value: string;
  flagged: boolean;
  onCommit(value: string): void;
  onPasteBlock(e: ClipboardEvent<HTMLElement>): void;
}

/** Text/Number cell: a thin wire over gridModel's cellEditReduce (MINOR-5 —
 * the draft/commit/revert rules live there, unit-tested). Enter commits by
 * blurring; commits reach the store only on REAL changes (◆29 — a spurious
 * setCell costs a row its pristine state); Escape reverts the draft. */
function TextCell({ value, flagged, onCommit, onPasteBlock }: TextCellProps): ReactElement {
  const [draft, setDraft] = useState<CellDraft>(null);
  const apply = (action: CellEditAction): void => {
    const result = cellEditReduce(draft, value, action);
    setDraft(result.draft);
    if (result.commit !== undefined) onCommit(result.commit);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      // adversarial review item 3: this used to call blur(), which commits
      // via the onBlur handler below — but ALSO moves focus to
      // document.body, so the next Tab restarted at the top of the page
      // instead of continuing through the grid. Commit the same way blur
      // did, but stay put: the chosen behavior is "stay in the cell" (the
      // alternative — move to the same column of the next row — needs real
      // DOM row/column traversal that this project's headless test suite
      // has no way to drive or verify; picking the option that's provably
      // correct here beats one that merely looks nicer).
      e.preventDefault();
      apply({ kind: "commit" });
    } else if (e.key === "Escape") {
      apply({ kind: "escape" }); // revert in place
    }
  };
  return (
    <input
      value={draft ?? value}
      onChange={(e) => apply({ kind: "type", value: e.currentTarget.value })}
      onBlur={() => apply({ kind: "commit" })}
      onKeyDown={onKeyDown}
      onPaste={onPasteBlock}
      className={`w-36 bg-transparent px-2 py-1 outline-none focus:bg-gray-900/50 focus:ring-1 focus:ring-inset focus:ring-sky-600 ${
        flagged ? "text-red-200" : ""
      }`}
    />
  );
}

interface EnumCellProps {
  value: string;
  cases: readonly string[];
  flagged: boolean;
  onCommit(value: string): void;
  onPasteBlock(e: ClipboardEvent<HTMLElement>): void;
}

/** Enum cell: dropdown of the enum's cases plus an empty choice (§4.2). A
 * value that is NOT a case (D001 garbage — e.g. pasted) is kept visible as
 * an extra option, so bad data never LOOKS blank while flagged red. The
 * change path runs through cellEditReduce's draftless `select` action
 * (MINOR-5): commit only on a REAL change, same rule as TextCell. */
function EnumCell({ value, cases, flagged, onCommit, onPasteBlock }: EnumCellProps): ReactElement {
  const options = enumOptionsOf(cases);
  const unknown = value !== "" && !cases.includes(value);
  const onChange = (next: string): void => {
    const result = cellEditReduce(null, value, { kind: "select", value: next });
    if (result.commit !== undefined) onCommit(result.commit);
  };
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      onPaste={onPasteBlock}
      // adversarial review item 8: `bg-gray-800` painted OVER the flagged
      // <td>'s bg-red-950 wash, so an invalid enum read as a lesser error
      // than an invalid number (TextCell is bg-transparent, so its <td>'s
      // wash always shows). Drop to transparent ONLY when flagged, so both
      // cell kinds render identically red; the unflagged chip look is
      // unchanged.
      className={`w-36 px-1.5 py-1 outline-none focus:bg-gray-900/50 focus:ring-1 focus:ring-inset focus:ring-sky-600 ${
        flagged ? "bg-transparent text-red-200" : "bg-gray-800"
      }`}
    >
      {unknown && <option value={value}>{value}</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
