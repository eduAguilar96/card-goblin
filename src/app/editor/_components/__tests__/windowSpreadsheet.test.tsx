/**
 * Grid window markup smoke tests (task 6, same approach as task 5): the full
 * SpreadsheetContent tree rendered to static markup against REAL compiles —
 * the §3.9 demo through a headless editor store, plus an enum-column variant
 * fixture (the demo has no enum column) proving dropdown options and a D001
 * red flag end to end.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DataDiagnostic } from "@/lib/lang";
import {
  createEditorStore,
  type EditorState,
  type SchemaSnapshot,
  type SheetsState,
} from "@/app/editor/_store/editorStore";
import {
  SpreadsheetContent,
  type SpreadsheetActions,
} from "@/app/editor/_components/windowSpreadsheet";

const noopActions: SpreadsheetActions = {
  setCell: () => undefined,
  addRow: () => undefined,
  deleteRow: () => undefined,
  moveRow: () => undefined,
};

function renderState(state: EditorState): string {
  return renderToStaticMarkup(
    <SpreadsheetContent
      schema={state.lastGoodSchema}
      sheets={state.sheets}
      dataDiagnostics={state.compile?.dataDiagnostics ?? []}
      actions={noopActions}
    />,
  );
}

const stripTags = (markup: string): string => markup.replace(/<[^>]+>/g, "");
const unescapeHtml = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

// -- the demo (§3.9) ---------------------------------------------------------

describe("SpreadsheetContent (demo)", () => {
  const markup = renderState(createEditorStore().getState());

  it("renders the Monsters tab with its row count", () => {
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-selected="true"');
    expect(stripTags(markup)).toContain("Monsters");
  });

  it("renders exactly the schema's columns as name · type headers (⚑3: no add-column UI)", () => {
    const text = stripTags(markup);
    expect(text).toContain("name · Text");
    expect(text).toContain("cost · Number");
    expect(text).toContain("health · Number");
    expect(text).toContain("count · Number");
  });

  it("gives every column an accessible resize handle and starts at the 144 px default", () => {
    const handles = markup.match(/<span[^>]*role="separator"[^>]*>/g) ?? [];
    expect(handles).toHaveLength(4);
    for (const handle of handles) {
      expect(handle).toContain('aria-orientation="vertical"');
      expect(handle).toContain('aria-valuenow="144"');
      expect(handle).toContain('tabindex="0"');
    }
    for (const column of ["name", "cost", "health", "count"]) {
      expect(markup).toContain(`aria-label="resize ${column} column"`);
    }
  });

  it("offers optional wrapping but keeps the compact single-line editor by default", () => {
    expect(markup).toContain('aria-pressed="false"');
    expect(stripTags(markup)).toContain("Wrap text");
    expect(markup).not.toContain("<textarea");
  });

  it("renders 2 rows × 4 columns of data inputs, plus one row-index gutter input per row", () => {
    // 8 data cells + 2 gutter fields (§3.6, ◆42 — the gutter is an <input> now).
    expect(markup.match(/<input/g)).toHaveLength(10);
    for (const value of ["Dragon", "5", "4", "Imp", "1"]) {
      expect(markup).toContain(`value="${value}"`);
    }
  });

  it("the row-index gutter shows the 1-based position, matching what [row] resolves to (§3.6, ◆42)", () => {
    expect(markup).toContain('aria-label="row position, currently 1 of 2"');
    expect(markup).toContain('aria-label="row position, currently 2 of 2"');
  });

  it("has no dropdown (the demo declares no enum column)", () => {
    expect(markup).not.toContain("<select");
  });

  it("has numbered 1-based row headers with a per-row delete affordance and an add-row button", () => {
    expect(markup).toContain('aria-label="delete row 1"');
    expect(markup).toContain('aria-label="delete row 2"');
    expect(stripTags(markup)).toContain("+ add row");
  });

  it("the delete-row button is keyboard-reachable: opacity, not visibility (item 4)", () => {
    // `visibility:hidden` (the old `invisible` class) drops an element from
    // the tab order entirely — Tab could never land on it. `opacity-0`
    // keeps it focusable and clickable while staying out of the way
    // visually; it must also reveal on ITS OWN keyboard focus (not just the
    // row's mouse hover), or a keyboard user would tab onto an invisible
    // control with no indication anything is there.
    const deleteButtons = markup.match(/<button[^>]*aria-label="delete row[^>]*>/g) ?? [];
    expect(deleteButtons.length).toBe(2);
    for (const tag of deleteButtons) {
      expect(tag).not.toContain("invisible");
      expect(tag).toContain("opacity-0");
      expect(tag).toContain("focus-visible:opacity-100");
    }
  });

  it("flags nothing red and dims nothing on the clean, fully edited demo", () => {
    expect(markup).not.toContain("bg-red-950");
    expect(markup).not.toContain("pristine — excluded");
  });
});

describe("SpreadsheetContent (demo variations)", () => {
  it("an added row renders dimmed with the pristine hint (◆29)", () => {
    const store = createEditorStore();
    store.getState().addRow("Monsters");
    store.getState().flushCompile();
    const markup = renderState(store.getState());
    expect(markup).toContain("opacity-50");
    expect(markup).toContain("pristine — excluded");
    expect(markup).toContain('aria-label="delete row 3"');
  });

  it("orphaned columns and __orphan__ tombstones NEVER render (◆26 — columns come from the schema)", () => {
    const store = createEditorStore();
    const state = store.getState();
    const sheets: SheetsState = {
      Monsters: {
        rows: [
          { ...state.sheets.Monsters.rows[0], ghost: "BOO", __orphan__cost: "ZOMBIE" },
        ],
        editedRows: [true],
      },
    };
    const markup = renderToStaticMarkup(
      <SpreadsheetContent
        schema={state.lastGoodSchema}
        sheets={sheets}
        dataDiagnostics={[]}
        actions={noopActions}
      />,
    );
    expect(markup).not.toContain("BOO");
    expect(markup).not.toContain("ZOMBIE");
    expect(markup).not.toContain("__orphan__");
    expect(markup.match(/<input/g)).toHaveLength(5); // 4 schema columns + 1 row-index gutter
  });
});

// -- enum variant fixture (dropdowns + D001) ---------------------------------

/** The demo has no enum COLUMN — this variant adds one, with one edited row
 * holding a non-case value so the compile carries a real D001. */
const ENUM_FIXTURE = `Enum: Suit
  case Rock
  case Paper
  case Scissors

Sheet: Duel
  column label: Text
  column suit: Suit

Template: F
  Text:
    x: 1
    y: 1
    size: 1
    text: [label]

Card: DuelCard
  sheet: Duel
  size: poker
  x_units: 20
  y_units: auto
  Front: F
`;

function enumStore() {
  return createEditorStore({
    code: ENUM_FIXTURE,
    sheets: {
      Duel: {
        rows: [
          { label: "A", suit: "Garbage" },
          { label: "B", suit: "Rock" },
        ],
        editedRows: [true, true],
      },
    },
  });
}

describe("SpreadsheetContent (enum variant)", () => {
  const state = enumStore().getState();
  const markup = renderState(state);

  it("the fixture compiles good and carries exactly one D001 with cell provenance", () => {
    expect(state.isStale).toBe(false);
    const d001 = (state.compile?.dataDiagnostics ?? []).filter(
      (d: DataDiagnostic) => d.code === "D001",
    );
    expect(d001).toHaveLength(1);
    expect(d001[0].cell).toEqual({ sheet: "Duel", rowIndex: 0, column: "suit" });
  });

  it("enum cells are dropdowns: empty choice + the enum's cases, header shows the enum name", () => {
    expect(stripTags(markup)).toContain("suit · Suit");
    expect(markup.match(/<select/g)).toHaveLength(2);
    // The empty choice, then the cases in declaration order.
    expect(markup).toContain('<option value=""></option>');
    for (const c of ["Rock", "Paper", "Scissors"]) {
      expect(markup).toContain(`value="${c}"`);
    }
    // Row 1's valid value is the selected option.
    expect(markup).toContain('<option value="Rock" selected="">');
  });

  it("the D001 cell renders red with the message as its tooltip — and ONLY that cell", () => {
    expect(markup.match(/bg-red-950/g)).toHaveLength(1);
    expect(unescapeHtml(markup)).toContain('"Garbage" is not a case of enum Suit');
    // The non-case value stays visible in the dropdown instead of blanking.
    expect(markup).toContain('<option value="Garbage" selected="">');
  });

  it("a flagged enum cell drops its opaque background so the <td>'s red wash shows through (item 8)", () => {
    // Unflagged, <select> painted bg-gray-800 OVER the <td>'s (unflagged,
    // colorless) background — invisible either way. Flagged, that same
    // opaque fill hid the <td>'s bg-red-950 wash, so an invalid enum read
    // as a lesser error than an invalid Number/Text cell (TextCell is
    // bg-transparent, so ITS <td> wash always shows through). Both cell
    // kinds must look identically red when flagged.
    const selects = markup.match(/<select[^>]*>/g) ?? [];
    expect(selects).toHaveLength(2); // one per row
    const flaggedSelect = selects.find((tag) => tag.includes("text-red-200"));
    const plainSelect = selects.find((tag) => !tag.includes("text-red-200"));
    expect(flaggedSelect).toBeDefined();
    expect(plainSelect).toBeDefined();
    expect(flaggedSelect).toContain("bg-transparent");
    expect(flaggedSelect).not.toContain("bg-gray-800");
    // Unflagged chip styling is unchanged.
    expect(plainSelect).toContain("bg-gray-800");
  });
});

// -- zero-column sheets (⚑13†) -----------------------------------------------

describe("SpreadsheetContent (zero-column sheet)", () => {
  const schema: SchemaSnapshot = [{ name: "Blanks", columns: [] }];
  const sheets: SheetsState = { Blanks: { rows: [{}, {}], editedRows: [false, false] } };
  const markup = renderToStaticMarkup(
    <SpreadsheetContent schema={schema} sheets={sheets} dataDiagnostics={[]} actions={noopActions} />,
  );

  it("renders numbered rows with add/delete and an editable gutter only, plus the no-columns hint", () => {
    expect(stripTags(markup)).toContain("this sheet has no columns; rows control card count");
    // No DATA-cell inputs — but the row-index gutter is itself an <input>
    // now (§3.6, ◆42), and works the same on a zero-column, loop-only sheet.
    expect(markup.match(/<input/g)).toHaveLength(2);
    expect(markup).not.toContain("<select");
    expect(markup).toContain('aria-label="delete row 1"');
    expect(markup).toContain('aria-label="delete row 2"');
    expect(stripTags(markup)).toContain("+ add row");
  });

  it("zero-column rows are never dimmed pristine (⚑13† — existence is the edit)", () => {
    expect(markup).not.toContain("pristine — excluded");
    expect(markup).not.toContain("opacity-50");
  });
});

// -- row-index gutter reordering (§3.6, ◆42) ---------------------------------

describe("SpreadsheetContent (row-index gutter reordering)", () => {
  it("is a plain, tab-reachable <input> — no tabindex override hiding it from keyboard users", () => {
    const markup = renderState(createEditorStore().getState());
    const gutterInputs = markup.match(/<input[^>]*aria-label="row position[^>]*>/g) ?? [];
    expect(gutterInputs).toHaveLength(2);
    for (const tag of gutterInputs) {
      expect(tag).not.toContain("tabindex");
    }
  });

  it("pristine dimming (◆29) survives a move — the row keeps opacity-50 at its NEW position", () => {
    const store = createEditorStore();
    store.getState().addRow("Monsters"); // index 2, pristine
    store.getState().flushCompile();
    store.getState().moveRow("Monsters", 2, 0); // jump the pristine row to the front
    const markup = renderState(store.getState());
    expect(markup).toContain("opacity-50");
    expect(markup).toContain("pristine — excluded");
    // The gutter reads the row's NEW 1-based position — the number a moved
    // row shows is the number its cards would print via [row] (§3.6).
    expect(markup).toContain('aria-label="row position, currently 1 of 3"');
  });

  it("a flagged cell's red highlight follows its row after a move (synchronous recompile)", () => {
    const store = createEditorStore();
    store.getState().setCell("Monsters", 1, "health", "garbage"); // Imp
    store.getState().flushCompile();
    store.getState().moveRow("Monsters", 1, 0); // Imp jumps ahead of Dragon
    const markup = renderState(store.getState());
    expect(markup.match(/bg-red-950/g)).toHaveLength(1); // still exactly one flag
    expect(markup.indexOf("Imp")).toBeLessThan(markup.indexOf("Dragon")); // order actually changed
  });
});

// -- empty states ------------------------------------------------------------

describe("SpreadsheetContent (empty states)", () => {
  it("no lastGoodSchema yet (first compile bad) → explanatory message, no grid", () => {
    const markup = renderToStaticMarkup(
      <SpreadsheetContent schema={null} sheets={{}} dataDiagnostics={[]} actions={noopActions} />,
    );
    expect(stripTags(markup)).toContain("No schema yet");
    expect(markup).not.toContain("<table");
  });

  it("a schema with zero sheets → explanatory message, no tabs", () => {
    const markup = renderToStaticMarkup(
      <SpreadsheetContent schema={[]} sheets={{}} dataDiagnostics={[]} actions={noopActions} />,
    );
    expect(stripTags(markup)).toContain("The code declares no sheets.");
    expect(markup).not.toContain('role="tab"');
  });
});
