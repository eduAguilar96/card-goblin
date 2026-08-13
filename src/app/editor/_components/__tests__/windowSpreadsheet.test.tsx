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

  it("renders 2 rows × 4 columns of inputs with the seeded values", () => {
    expect(markup.match(/<input/g)).toHaveLength(8);
    for (const value of ["Dragon", "5", "4", "Imp", "1"]) {
      expect(markup).toContain(`value="${value}"`);
    }
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
    expect(markup.match(/<input/g)).toHaveLength(4); // schema columns only
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

  it("renders numbered rows with add/delete only, plus the no-columns hint", () => {
    expect(stripTags(markup)).toContain("this sheet has no columns; rows control card count");
    expect(markup).not.toContain("<input");
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
