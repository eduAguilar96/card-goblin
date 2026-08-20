/**
 * Pure grid logic (task 6): tab/column/header mapping from the schema, cell
 * flag indexing (no cross-sheet bleed), pristine derivation (mirrors the
 * generator's ◆29 rule), enum dropdown options, and the clipboard-block →
 * store-ops paste mapping — including the headless-store round-trip that
 * proves a taller-than-sheet paste MATERIALIZES rows (task-4 MINOR-2 debt).
 */
import { describe, expect, it } from "vitest";
import type { DataDiagnostic } from "@/lib/lang";
import {
  createEditorStore,
  type SchemaSnapshot,
  type SheetsState,
} from "@/app/editor/_store/editorStore";
import {
  applyPasteOps,
  buildFlagIndex,
  cellEditReduce,
  cellFlagKey,
  cellValueOf,
  clampColumnWidth,
  columnHeaderLabel,
  columnTypeLabel,
  enumOptionsOf,
  gridTabsOf,
  isPristineRow,
  parseClipboardBlock,
  pasteCommitsDirectly,
  pasteOps,
  resolveIndexEdit,
  type PasteOp,
  DEFAULT_COLUMN_WIDTH_PX,
  MAX_COLUMN_WIDTH_PX,
  MIN_COLUMN_WIDTH_PX,
} from "@/app/editor/_components/gridModel";

// -- tabs and columns --------------------------------------------------------

describe("gridTabsOf", () => {
  const schema: SchemaSnapshot = [
    { name: "A", columns: [{ name: "x", type: { kind: "Text" } }] },
    { name: "B", columns: [] }, // zero-column sheet gets a tab too (⚑13†)
  ];

  it("one tab per SCHEMA sheet, in schema order, with store row counts", () => {
    const sheets: SheetsState = {
      A: { rows: [{}, {}], editedRows: [false, false] },
      B: { rows: [{}], editedRows: [false] },
    };
    expect(gridTabsOf(schema, sheets)).toEqual([
      { name: "A", rowCount: 2 },
      { name: "B", rowCount: 1 },
    ]);
  });

  it("orphaned store sheets (absent from the schema) get NO tab (◆26 is invisible)", () => {
    const sheets: SheetsState = {
      A: { rows: [], editedRows: [] },
      B: { rows: [], editedRows: [] },
      Orphan: { rows: [{ x: "kept" }], editedRows: [true] },
    };
    expect(gridTabsOf(schema, sheets).map((t) => t.name)).toEqual(["A", "B"]);
  });

  it("a schema sheet with no store entry yet counts 0 rows", () => {
    expect(gridTabsOf(schema, {})).toEqual([
      { name: "A", rowCount: 0 },
      { name: "B", rowCount: 0 },
    ]);
  });
});

describe("column headers", () => {
  it("shows name · type for Text and Number", () => {
    expect(columnHeaderLabel({ name: "name", type: { kind: "Text" } })).toBe("name · Text");
    expect(columnHeaderLabel({ name: "cost", type: { kind: "Number" } })).toBe("cost · Number");
  });

  it("enum columns show the ENUM'S name as the type", () => {
    expect(
      columnHeaderLabel({
        name: "suit",
        type: { kind: "Enum", enumName: "Suit", cases: ["Rock"] },
      }),
    ).toBe("suit · Suit");
    expect(columnTypeLabel({ kind: "Enum", enumName: "Rank", cases: [] })).toBe("Rank");
  });
});

describe("column sizing", () => {
  it("rounds in-range widths and clamps pointer/keyboard resizing to the supported range", () => {
    expect(clampColumnWidth(211.6)).toBe(212);
    expect(clampColumnWidth(MIN_COLUMN_WIDTH_PX - 50)).toBe(MIN_COLUMN_WIDTH_PX);
    expect(clampColumnWidth(MAX_COLUMN_WIDTH_PX + 50)).toBe(MAX_COLUMN_WIDTH_PX);
  });

  it("falls back to the default for a non-finite browser measurement", () => {
    expect(clampColumnWidth(Number.NaN)).toBe(DEFAULT_COLUMN_WIDTH_PX);
    expect(clampColumnWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_COLUMN_WIDTH_PX);
  });
});

// -- cells -------------------------------------------------------------------

describe("cellValueOf", () => {
  it("reads own properties; missing keys are empty", () => {
    expect(cellValueOf({ a: "1" }, "a")).toBe("1");
    expect(cellValueOf({ a: "1" }, "b")).toBe("");
  });

  it("a column named `constructor` reads empty, never a prototype function", () => {
    expect(cellValueOf({}, "constructor")).toBe("");
  });

  it("stringifies non-string garbage exactly like generate.ts rawCellOf (MINOR-4)", () => {
    const smuggle = (v: unknown): Record<string, string> =>
      ({ a: v }) as Record<string, string>;
    expect(cellValueOf(smuggle(5), "a")).toBe("5");
    expect(cellValueOf(smuggle(0), "a")).toBe("0");
    expect(cellValueOf(smuggle(null), "a")).toBe("");
    expect(cellValueOf(smuggle(undefined), "a")).toBe("");
    expect(cellValueOf(smuggle(false), "a")).toBe("false");
  });
});

describe("enumOptionsOf", () => {
  it("is the empty choice followed by the cases in order", () => {
    expect(enumOptionsOf(["Rock", "Paper", "Scissors"])).toEqual([
      "",
      "Rock",
      "Paper",
      "Scissors",
    ]);
    expect(enumOptionsOf([])).toEqual([""]);
  });
});

// -- flags -------------------------------------------------------------------

describe("buildFlagIndex", () => {
  const cellDiag = (
    sheet: string,
    rowIndex: number,
    column: string,
    message: string,
  ): DataDiagnostic => ({ code: "D002", message, cell: { sheet, rowIndex, column } });

  it("indexes only cell-carrying diagnostics; card/deck-scoped ones are the preview's", () => {
    const index = buildFlagIndex([
      cellDiag("Monsters", 1, "cost", "bad cost"),
      { code: "D004", message: "no cell", cardRef: { deck: "M", deckIndex: 0, cardIndex: 0 } },
      { code: "D007", message: "cap" },
    ]);
    expect(index.size).toBe(1);
    expect(index.get(cellFlagKey("Monsters", 1, "cost"))).toBe("bad cost");
  });

  it("does NOT bleed across sheets sharing rowIndex and column", () => {
    const index = buildFlagIndex([
      cellDiag("A", 0, "x", "bad in A"),
      cellDiag("B", 0, "x", "bad in B"),
    ]);
    expect(index.get(cellFlagKey("A", 0, "x"))).toBe("bad in A");
    expect(index.get(cellFlagKey("B", 0, "x"))).toBe("bad in B");
    expect(index.get(cellFlagKey("A", 0, "y"))).toBeUndefined();
    expect(index.get(cellFlagKey("A", 1, "x"))).toBeUndefined();
  });

  it("joins multiple messages on one cell with newlines (tooltip lines)", () => {
    const index = buildFlagIndex([
      cellDiag("A", 2, "x", "first"),
      cellDiag("A", 2, "x", "second"),
    ]);
    expect(index.get(cellFlagKey("A", 2, "x"))).toBe("first\nsecond");
  });
});

// -- pristine (◆29 — must mirror generate.ts) --------------------------------

describe("isPristineRow", () => {
  const columns = ["name", "cost"];

  it("never-edited and all declared cells empty/whitespace → pristine", () => {
    expect(isPristineRow({}, columns, false)).toBe(true);
    expect(isPristineRow({ name: "", cost: "  " }, columns, false)).toBe(true);
  });

  it("any declared content, or the edited flag, breaks pristineness", () => {
    expect(isPristineRow({ name: "Dragon" }, columns, false)).toBe(false);
    expect(isPristineRow({}, columns, true)).toBe(false); // edited-then-emptied
  });

  it("zero-column rows are NEVER pristine (⚑13† — existence is the edit)", () => {
    expect(isPristineRow({}, [], false)).toBe(false);
  });

  it("orphaned/tombstoned values are invisible to pristineness (◆26)", () => {
    expect(isPristineRow({ ghost: "BOO", __orphan__cost: "5" }, columns, false)).toBe(true);
  });

  it("does not throw on non-string garbage cells — the MINOR-4 stringify guard", () => {
    const row = { name: 7, cost: null } as unknown as Record<string, string>;
    expect(isPristineRow(row, columns, false)).toBe(false); // "7" is content
    const emptyish = { name: null, cost: undefined } as unknown as Record<string, string>;
    expect(isPristineRow(emptyish, columns, false)).toBe(true); // both read ""
  });
});

// -- cell edit reducer (MINOR-5) ---------------------------------------------

describe("cellEditReduce", () => {
  it("typing replaces the draft; nothing commits", () => {
    expect(cellEditReduce(null, "Dragon", { kind: "type", value: "D" })).toEqual({
      draft: "D",
    });
    expect(cellEditReduce("D", "Dragon", { kind: "type", value: "Dr" })).toEqual({
      draft: "Dr",
    });
  });

  it("commit fires ONLY when the draft is a REAL change (◆29 — pristine cost)", () => {
    expect(cellEditReduce("Wyrm", "Dragon", { kind: "commit" })).toEqual({
      draft: null,
      commit: "Wyrm",
    });
    // Draft equal to the committed value → no store write.
    expect(cellEditReduce("Dragon", "Dragon", { kind: "commit" })).toEqual({ draft: null });
    // Blur without ever typing (no draft) → no store write.
    expect(cellEditReduce(null, "Dragon", { kind: "commit" })).toEqual({ draft: null });
  });

  it("emptying a cell is a real change and commits the empty string", () => {
    expect(cellEditReduce("", "Dragon", { kind: "commit" })).toEqual({
      draft: null,
      commit: "",
    });
  });

  it("escape reverts the draft in place; a following commit writes nothing", () => {
    expect(cellEditReduce("garbage", "Dragon", { kind: "escape" })).toEqual({ draft: null });
    expect(cellEditReduce(null, "Dragon", { kind: "commit" })).toEqual({ draft: null });
  });

  it("select (enum dropdown) commits immediately, but only on a real change", () => {
    expect(cellEditReduce(null, "Rock", { kind: "select", value: "Paper" })).toEqual({
      draft: null,
      commit: "Paper",
    });
    expect(cellEditReduce(null, "Rock", { kind: "select", value: "Rock" })).toEqual({
      draft: null,
    });
    expect(cellEditReduce(null, "Rock", { kind: "select", value: "" })).toEqual({
      draft: null,
      commit: "",
    });
  });
});

// -- row-index gutter reducer (§3.6, ◆42) ------------------------------------

describe("resolveIndexEdit", () => {
  it("moves forward: typing 2 on row 10 of a 10-row sheet (A..J) targets index 1", () => {
    // "move and shift", not swap: A J B C D E F G H I — J (currentIndex 9)
    // lands at index 1, matching moveRow's splice-out/splice-in semantics.
    expect(resolveIndexEdit("2", 9, 10)).toEqual({ kind: "move", to: 1 });
  });

  it("moves backward: typing 4 on row 1 of a 5-row sheet targets index 3", () => {
    expect(resolveIndexEdit("4", 0, 5)).toEqual({ kind: "move", to: 3 });
  });

  it("clamps ≤ 0 to the first row (index 0)", () => {
    expect(resolveIndexEdit("0", 5, 10)).toEqual({ kind: "move", to: 0 });
    expect(resolveIndexEdit("-3", 5, 10)).toEqual({ kind: "move", to: 0 });
  });

  it("clamps beyond the row count to the last row (index rowCount - 1)", () => {
    expect(resolveIndexEdit("999", 0, 10)).toEqual({ kind: "move", to: 9 });
  });

  it("reverts on garbage: blank, whitespace-only, non-numeric, or decimal", () => {
    expect(resolveIndexEdit("", 2, 10)).toEqual({ kind: "none" });
    expect(resolveIndexEdit("   ", 2, 10)).toEqual({ kind: "none" });
    expect(resolveIndexEdit("abc", 2, 10)).toEqual({ kind: "none" });
    expect(resolveIndexEdit("3abc", 2, 10)).toEqual({ kind: "none" });
    // A row position is an ordinal, not a measurement — decimals revert
    // rather than truncating (a deliberate simplification).
    expect(resolveIndexEdit("2.5", 2, 10)).toEqual({ kind: "none" });
    // A leading "+" is outside the accepted spelling too.
    expect(resolveIndexEdit("+3", 2, 10)).toEqual({ kind: "none" });
  });

  it("reverts when the (clamped) target is the row's own current position", () => {
    expect(resolveIndexEdit("3", 2, 10)).toEqual({ kind: "none" }); // unchanged
    expect(resolveIndexEdit("1", 0, 10)).toEqual({ kind: "none" }); // already first
    expect(resolveIndexEdit("999", 9, 10)).toEqual({ kind: "none" }); // already last, clamped target ties
  });

  it("tolerates surrounding whitespace on an otherwise-valid number", () => {
    expect(resolveIndexEdit("  4  ", 0, 10)).toEqual({ kind: "move", to: 3 });
  });

  it("a single-row sheet always reverts — there is nowhere else to move to", () => {
    expect(resolveIndexEdit("1", 0, 1)).toEqual({ kind: "none" });
    expect(resolveIndexEdit("5", 0, 1)).toEqual({ kind: "none" });
    expect(resolveIndexEdit("0", 0, 1)).toEqual({ kind: "none" });
    expect(resolveIndexEdit("abc", 0, 1)).toEqual({ kind: "none" });
  });

  it("a zero row count reverts unconditionally (unreachable from the real UI, but never negative)", () => {
    expect(resolveIndexEdit("1", 0, 0)).toEqual({ kind: "none" });
    expect(resolveIndexEdit("abc", 0, 0)).toEqual({ kind: "none" });
  });
});

// -- paste mapping -----------------------------------------------------------

describe("parseClipboardBlock", () => {
  it("splits rows on newlines and cells on tabs", () => {
    expect(parseClipboardBlock("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("normalizes CRLF and bare CR", () => {
    expect(parseClipboardBlock("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseClipboardBlock("a\rb")).toEqual([["a"], ["b"]]);
  });

  it("strips exactly ONE trailing newline (the Excel terminator, not a row)", () => {
    expect(parseClipboardBlock("a\n")).toEqual([["a"]]);
    // A second newline is a deliberate empty row.
    expect(parseClipboardBlock("a\n\n")).toEqual([["a"], [""]]);
  });

  it("empty payloads produce an empty block", () => {
    expect(parseClipboardBlock("")).toEqual([]);
    expect(parseClipboardBlock("\n")).toEqual([]);
  });
});

describe("pasteOps", () => {
  const cols = ["name", "cost", "health", "count"];

  it("a taller-than-sheet block emits addRow ops FIRST, then setCells in row-major order", () => {
    const block = [
      ["Ghost", "3"],
      ["Wisp", "2"],
      ["Orc", "4"],
    ];
    // Anchor at the LAST existing row (1 of 2) → rows 1..3 → 2 new rows.
    const ops = pasteOps("Monsters", 1, 0, cols, 2, block);
    expect(ops).toEqual<PasteOp[]>([
      { kind: "addRow", sheet: "Monsters" },
      { kind: "addRow", sheet: "Monsters" },
      { kind: "setCell", sheet: "Monsters", row: 1, column: "name", value: "Ghost" },
      { kind: "setCell", sheet: "Monsters", row: 1, column: "cost", value: "3" },
      { kind: "setCell", sheet: "Monsters", row: 2, column: "name", value: "Wisp" },
      { kind: "setCell", sheet: "Monsters", row: 2, column: "cost", value: "2" },
      { kind: "setCell", sheet: "Monsters", row: 3, column: "name", value: "Orc" },
      { kind: "setCell", sheet: "Monsters", row: 3, column: "cost", value: "4" },
    ]);
  });

  it("a block fitting the current rows emits no addRow ops", () => {
    const ops = pasteOps("Monsters", 0, 0, cols, 2, [["A"], ["B"]]);
    expect(ops.every((op) => op.kind === "setCell")).toBe(true);
    expect(ops).toHaveLength(2);
  });

  it("cells right of the last schema column are DROPPED (⚑3: columns are schema-fixed)", () => {
    // Anchored at column 2 of 4, a 4-wide row has room for 2 cells only.
    const ops = pasteOps("Monsters", 0, 2, cols, 2, [["9", "8", "OVERFLOW", "MORE"]]);
    expect(ops).toEqual<PasteOp[]>([
      { kind: "setCell", sheet: "Monsters", row: 0, column: "health", value: "9" },
      { kind: "setCell", sheet: "Monsters", row: 0, column: "count", value: "8" },
    ]);
  });

  it("an empty block or a nonsensical anchor maps to no ops", () => {
    expect(pasteOps("M", 0, 0, cols, 2, [])).toEqual([]);
    expect(pasteOps("M", -1, 0, cols, 2, [["x"]])).toEqual([]);
    expect(pasteOps("M", 0, -1, cols, 2, [["x"]])).toEqual([]);
  });

  it("into a ZERO-COLUMN sheet every cell drops but rows still materialize", () => {
    const ops = pasteOps("Blanks", 0, 0, [], 0, [["a"], ["b"]]);
    expect(ops).toEqual<PasteOp[]>([
      { kind: "addRow", sheet: "Blanks" },
      { kind: "addRow", sheet: "Blanks" },
    ]);
  });
});

describe("pasteCommitsDirectly (MINOR-1 routing)", () => {
  it("multi-cell blocks always commit through the store", () => {
    expect(pasteCommitsDirectly([["a", "b"]], false)).toBe(true);
    expect(pasteCommitsDirectly([["a"], ["b"]], true)).toBe(true);
  });

  it("a 1×1 payload stays native on a text cell, commits on an enum cell", () => {
    // Text input: native paste lands in the draft, commits on blur.
    expect(pasteCommitsDirectly([["Rock"]], false)).toBe(false);
    // Enum <select>: no draft exists — native paste would be a silent no-op.
    expect(pasteCommitsDirectly([["Rock"]], true)).toBe(true);
  });

  it("an empty payload never commits", () => {
    expect(pasteCommitsDirectly([], false)).toBe(false);
    expect(pasteCommitsDirectly([], true)).toBe(false);
  });
});

// -- store round-trips (headless) --------------------------------------------

describe("store round-trip", () => {
  it("a pasted 3-row block onto the 2-row demo materializes rows, lands values, flags edits", () => {
    const store = createEditorStore();
    const block = parseClipboardBlock("Ghost\t3\t2\t1\nWisp\t2\t1\t1\nOrc\t4\t3\t2\n");
    const ops = pasteOps(
      "Monsters",
      1,
      0,
      ["name", "cost", "health", "count"],
      store.getState().sheets.Monsters.rows.length,
      block,
    );
    applyPasteOps(ops, store.getState());
    const s = store.getState();
    // Row 1 (Imp) overwritten; rows 2–3 materialized — nothing truncated.
    expect(s.sheets.Monsters.rows.map((r) => r.name)).toEqual([
      "Dragon",
      "Ghost",
      "Wisp",
      "Orc",
    ]);
    expect(s.sheets.Monsters.editedRows).toEqual([true, true, true, true]);
    store.getState().flushCompile();
    // 4 rows × 3 suits, count 2+1+1+2 per suit → 18 physical cards.
    expect(store.getState().lastGoodModel?.model.decks[0].cards).toHaveLength(18);
    expect(store.getState().lastGoodModel?.dataDiagnostics).toEqual([]);
  });

  it("a 1×1 paste onto an ENUM cell commits through the store — even invalid (MINOR-1: D001 + phantom option, never a silent no-op)", () => {
    const store = createEditorStore({
      code:
        "Enum: Suit\n  case Rock\n  case Paper\n" +
        "Sheet: S\n  column suit: Suit\n" +
        "Template: F\n  Text:\n    x: 1\n    y: 1\n    size: 1\n    text: [suit]\n" +
        "Card: C\n  sheet: S\n  size: poker\n  x_units: 20\n  y_units: auto\n  Front: F\n",
      sheets: { S: { rows: [{ suit: "Rock" }], editedRows: [true] } },
    });
    const block = parseClipboardBlock("Garbage");
    // The routing predicate sends the 1×1 enum paste down the commit path…
    expect(pasteCommitsDirectly(block, true)).toBe(true);
    // …and the ops land it like any block paste (the same setCell the
    // dropdown's commit would issue).
    applyPasteOps(pasteOps("S", 0, 0, ["suit"], 1, block), store.getState());
    store.getState().flushCompile();
    const s = store.getState();
    expect(s.sheets.S.rows[0].suit).toBe("Garbage");
    const d001 = (s.compile?.dataDiagnostics ?? []).filter((d) => d.code === "D001");
    expect(d001).toHaveLength(1);
    expect(d001[0].cell).toEqual({ sheet: "S", rowIndex: 0, column: "suit" });
  });

  it("a simulated single-cell commit goes through setCell and flags editedRows (◆29)", () => {
    const store = createEditorStore();
    store.getState().addRow("Monsters");
    expect(store.getState().sheets.Monsters.editedRows).toEqual([true, true, false]);
    // What TextCell/EnumCell commit does on blur/change:
    store.getState().setCell("Monsters", 2, "name", "Ghost");
    const s = store.getState();
    expect(s.sheets.Monsters.rows[2].name).toBe("Ghost");
    expect(s.sheets.Monsters.editedRows[2]).toBe(true);
  });
});
