/**
 * Editor store (task 4, DESIGN.md §4.2): seeded eager compile, trailing
 * debounce, keep-last-good model + schema, ◆26/◆26† reconciliation, and
 * ◆29 edited-flag row semantics — all exercised headless (zustand stores
 * need no React renderer).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TextShape } from "@/lib/lang";
import { DEMO_PROJECT_SOURCE } from "@/lib/lang/demoProject";
import type { EditorStore, SchemaColumn, SheetSchema, SheetsState } from "../editorStore";
import {
  COMPILE_DEBOUNCE_MS,
  createEditorStore,
  reconcileSheets,
} from "../editorStore";

afterEach(() => {
  vi.useRealTimers();
});

/** Count landed compiles by `compile` identity — each recompile replaces it. */
function countCompiles(store: EditorStore): { count: number } {
  const counter = { count: 0 };
  store.subscribe((state, prev) => {
    if (state.compile !== prev.compile) counter.count++;
  });
  return counter;
}

const heartsOf = (store: EditorStore, cardIndex: number): number =>
  (store.getState().lastGoodModel?.model.decks[0].cards[cardIndex].front.length ?? 0) - 4;

// -- seed (§3.9) -------------------------------------------------------------

describe("seed (§3.9)", () => {
  it("seeds the demo verbatim and compiles it eagerly at creation: clean, 9 instances, 6 hashes", () => {
    const store = createEditorStore();
    const s = store.getState();
    expect(s.code).toBe(DEMO_PROJECT_SOURCE);
    expect(s.isStale).toBe(false);
    expect(s.compile?.diagnostics).toEqual([]);
    expect(s.lastGoodModel).not.toBeNull();
    const deck = s.lastGoodModel?.model.decks[0];
    expect(deck?.cardName).toBe("Monster");
    expect(deck?.cards).toHaveLength(9);
    expect(new Set(deck?.cards.map((c) => c.contentHash)).size).toBe(6);
    expect(s.lastGoodModel?.dataDiagnostics).toEqual([]);
    expect(s.lastGoodModel?.excludedPristineRows).toEqual({});
    expect(s.sheets.Monsters.rows.map((r) => r.name)).toEqual(["Dragon", "Imp"]);
    expect(s.sheets.Monsters.editedRows).toEqual([true, true]);
  });

  it("extracts the demo schema: Monsters with four ordered columns", () => {
    const store = createEditorStore();
    expect(store.getState().lastGoodSchema).toEqual([
      {
        name: "Monsters",
        columns: [
          { name: "name", type: { kind: "Text" } },
          { name: "cost", type: { kind: "Number" } },
          { name: "health", type: { kind: "Number" } },
          { name: "count", type: { kind: "Number" } },
        ],
      },
    ]);
  });

  it("enum columns carry their dropdown cases; schema sheets materialize empty store entries", () => {
    const store = createEditorStore({
      code: "Enum: Suit\n  case Rock\n  case Paper\nSheet: S\n  column suit: Suit\n",
      sheets: {},
    });
    const s = store.getState();
    expect(s.isStale).toBe(false); // W002 (unused sheet) is a warning — still good
    expect(s.lastGoodSchema).toEqual([
      {
        name: "S",
        columns: [
          { name: "suit", type: { kind: "Enum", enumName: "Suit", cases: ["Rock", "Paper"] } },
        ],
      },
    ]);
    expect(s.sheets.S).toEqual({ rows: [], editedRows: [] });
  });

  it("normalizes a misaligned seed: editedRows padded/truncated to rows.length", () => {
    const store = createEditorStore({
      code: "Sheet: S\n  column a: Text\n",
      sheets: {
        S: {
          rows: [{ a: "1" }, { a: "2" }],
          editedRows: [true], // one short — pads to false
        },
        T: {
          rows: [{ x: "1" }],
          editedRows: [true, true, true], // extras dropped
        },
      },
    });
    expect(store.getState().sheets.S.editedRows).toEqual([true, false]);
    expect(store.getState().sheets.T.editedRows).toEqual([true]);
  });

  it("stores are isolated: two stores never share seed row objects", () => {
    const a = createEditorStore();
    const b = createEditorStore();
    a.getState().setCell("Monsters", 0, "name", "Wyrm");
    expect(a.getState().sheets.Monsters.rows[0].name).toBe("Wyrm");
    expect(b.getState().sheets.Monsters.rows[0].name).toBe("Dragon");
  });
});

// -- debounce (§4.2 ⚑8) ------------------------------------------------------

describe("debounced recompile", () => {
  it("a burst of setCell/setCode collapses to ONE trailing recompile after 300 ms", () => {
    vi.useFakeTimers();
    const store = createEditorStore();
    const compiles = countCompiles(store);
    const { setCell, setCode } = store.getState();
    setCell("Monsters", 0, "health", "3");
    setCell("Monsters", 0, "cost", "7");
    setCode(store.getState().code + "\n# trailing comment\n");
    // Raw state updates land immediately; the derived compile lags.
    expect(store.getState().sheets.Monsters.rows[0].health).toBe("3");
    expect(compiles.count).toBe(0);
    vi.advanceTimersByTime(COMPILE_DEBOUNCE_MS - 1);
    expect(compiles.count).toBe(0);
    vi.advanceTimersByTime(1);
    expect(compiles.count).toBe(1);
    expect(heartsOf(store, 0)).toBe(3);
  });

  it("row ops recompile SYNCHRONOUSLY and consume any pending debounce (MAJOR-1)", () => {
    vi.useFakeTimers();
    const store = createEditorStore();
    const compiles = countCompiles(store);
    store.getState().setCell("Monsters", 0, "health", "3"); // debounced…
    store.getState().addRow("Monsters"); // …subsumed by the sync row-op compile
    expect(compiles.count).toBe(1);
    expect(heartsOf(store, 0)).toBe(3); // the pending cell edit landed with it
    store.getState().deleteRow("Monsters", 2);
    expect(compiles.count).toBe(2);
    vi.advanceTimersByTime(10 * COMPILE_DEBOUNCE_MS);
    expect(compiles.count).toBe(2); // nothing left pending
  });

  it("flushCompile runs a pending compile immediately and is a no-op when idle", () => {
    vi.useFakeTimers();
    const store = createEditorStore();
    const compiles = countCompiles(store);
    store.getState().flushCompile(); // idle → nothing
    expect(compiles.count).toBe(0);
    store.getState().setCell("Monsters", 0, "health", "1");
    store.getState().flushCompile();
    expect(compiles.count).toBe(1);
    expect(heartsOf(store, 0)).toBe(1);
    vi.advanceTimersByTime(10 * COMPILE_DEBOUNCE_MS);
    expect(compiles.count).toBe(1); // the pending timer was consumed, not just copied
  });
});

// -- data edits --------------------------------------------------------------

describe("cell and row edits", () => {
  it("editing health 4→3 changes the hearts on the affected cards", () => {
    const store = createEditorStore();
    expect(heartsOf(store, 0)).toBe(4);
    store.getState().setCell("Monsters", 0, "health", "3");
    store.getState().flushCompile();
    expect(heartsOf(store, 0)).toBe(3); // Dragon
    expect(heartsOf(store, 6)).toBe(2); // Imp untouched
    expect(store.getState().lastGoodModel?.dataDiagnostics).toEqual([]);
  });

  it("addRow appends a PRISTINE row: excluded and diagnostic-free (◆29)", () => {
    const store = createEditorStore();
    store.getState().addRow("Monsters");
    store.getState().flushCompile();
    const s = store.getState();
    expect(s.sheets.Monsters.rows).toHaveLength(3);
    expect(s.sheets.Monsters.editedRows).toEqual([true, true, false]);
    expect(s.lastGoodModel?.model.decks[0].cards).toHaveLength(9);
    expect(s.lastGoodModel?.excludedPristineRows).toEqual({ Monsters: 1 });
    expect(s.lastGoodModel?.dataDiagnostics).toEqual([]);
  });

  it("an edited-then-emptied row is NOT pristine: placeholders + D003 until the row is deleted", () => {
    const store = createEditorStore();
    store.getState().addRow("Monsters");
    store.getState().setCell("Monsters", 2, "name", "Ghost");
    store.getState().setCell("Monsters", 2, "name", ""); // emptied, but touched
    store.getState().flushCompile();
    let s = store.getState();
    expect(s.sheets.Monsters.editedRows[2]).toBe(true);
    expect(s.lastGoodModel?.excludedPristineRows).toEqual({});
    // 9 real cards + 3 placeholder combinations for the empty row.
    expect(s.lastGoodModel?.model.decks[0].cards).toHaveLength(12);
    expect(s.lastGoodModel?.dataDiagnostics.some((d) => d.code === "D003")).toBe(true);
    // The remedy is deleting the row (◆29† spec letter).
    store.getState().deleteRow("Monsters", 2);
    store.getState().flushCompile();
    s = store.getState();
    expect(s.lastGoodModel?.model.decks[0].cards).toHaveLength(9);
    expect(s.lastGoodModel?.dataDiagnostics).toEqual([]);
  });

  it("deleteRow reindexes cell flags IMMEDIATELY — no flush needed (MAJOR-1)", () => {
    const store = createEditorStore();
    store.getState().setCell("Monsters", 1, "health", "garbage"); // Imp, row 1
    store.getState().flushCompile();
    expect(
      store.getState().compile?.dataDiagnostics.map((d) => d.cell?.rowIndex),
    ).toEqual([1]);
    store.getState().deleteRow("Monsters", 0); // Imp shifts to row 0 — flags must follow NOW
    const diags = store.getState().compile?.dataDiagnostics ?? [];
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("D002");
    expect(diags[0].cell).toEqual({ sheet: "Monsters", rowIndex: 0, column: "health" });
  });

  it("addRow updates the pristine-exclusion count immediately — no flush needed (MAJOR-1)", () => {
    const store = createEditorStore();
    store.getState().addRow("Monsters");
    expect(store.getState().compile?.excludedPristineRows).toEqual({ Monsters: 1 });
    expect(store.getState().lastGoodModel?.excludedPristineRows).toEqual({ Monsters: 1 });
  });

  it("deleteRow removes the row and its edited flag together", () => {
    const store = createEditorStore();
    store.getState().deleteRow("Monsters", 0);
    const s = store.getState();
    expect(s.sheets.Monsters.rows.map((r) => r.name)).toEqual(["Imp"]);
    expect(s.sheets.Monsters.editedRows).toEqual([true]);
    store.getState().flushCompile();
    expect(store.getState().lastGoodModel?.model.decks[0].cards).toHaveLength(3);
  });

  it("unaddressable targets are no-ops: unknown sheet, out-of-range row", () => {
    const store = createEditorStore();
    const before = store.getState().sheets;
    store.getState().setCell("Nope", 0, "name", "x");
    store.getState().setCell("Monsters", 99, "name", "x");
    store.getState().deleteRow("Nope", 0);
    store.getState().deleteRow("Monsters", -1);
    expect(store.getState().sheets).toBe(before);
  });
});

// -- keep-last-good (§4.2 †) -------------------------------------------------

describe("keep-last-good", () => {
  it("a parse error keeps model AND schema (same references), sets isStale, surfaces diagnostics", () => {
    const store = createEditorStore();
    const goodModel = store.getState().lastGoodModel;
    const goodSchema = store.getState().lastGoodSchema;
    store.getState().setCode(DEMO_PROJECT_SOURCE + "\nCard: (((\n");
    store.getState().flushCompile();
    const s = store.getState();
    expect(s.isStale).toBe(true);
    expect(s.lastGoodModel).toBe(goodModel);
    expect(s.lastGoodSchema).toBe(goodSchema);
    expect(s.compile?.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("fixing the error clears staleness and the model updates", () => {
    const store = createEditorStore();
    const goodModel = store.getState().lastGoodModel;
    store.getState().setCode(DEMO_PROJECT_SOURCE + "\nCard: (((\n");
    store.getState().flushCompile();
    store.getState().setCode(DEMO_PROJECT_SOURCE);
    store.getState().flushCompile();
    const s = store.getState();
    expect(s.isStale).toBe(false);
    expect(s.lastGoodModel).not.toBe(goodModel); // a fresh good result
    expect(s.lastGoodModel?.model.decks[0].cards).toHaveLength(9);
    expect(s.compile?.diagnostics).toEqual([]);
  });

  it("data edits during a broken compile flow into lastGoodModel once the code is fixed", () => {
    const store = createEditorStore();
    store.getState().setCode(DEMO_PROJECT_SOURCE + "\nCard: (((\n");
    store.getState().flushCompile();
    store.getState().setCell("Monsters", 0, "health", "2");
    store.getState().flushCompile();
    expect(store.getState().isStale).toBe(true);
    expect(heartsOf(store, 0)).toBe(4); // still the last GOOD result
    store.getState().setCode(DEMO_PROJECT_SOURCE);
    store.getState().flushCompile();
    expect(store.getState().isStale).toBe(false);
    expect(heartsOf(store, 0)).toBe(2);
  });

  it("warnings alone are a GOOD compile, and an unchanged schema keeps its identity (M5†)", () => {
    const store = createEditorStore();
    const goodModel = store.getState().lastGoodModel;
    const goodSchema = store.getState().lastGoodSchema;
    store.getState().setCode(DEMO_PROJECT_SOURCE + "\nEnum: Unused\n  case Only\n");
    store.getState().flushCompile();
    const s = store.getState();
    expect(s.compile?.diagnostics.map((d) => d.severity)).toEqual(["warning"]); // W002
    expect(s.isStale).toBe(false);
    expect(s.lastGoodModel).not.toBe(goodModel); // model refreshed…
    expect(s.lastGoodSchema).toBe(goodSchema); // …but the equal schema is identity-stable
  });
});

// -- ◆26† rename through the store -------------------------------------------

describe("column rename through the store (◆26†)", () => {
  it("renaming cost→price (same position, same type) migrates the data and re-renders it", () => {
    const store = createEditorStore();
    // Rename the column AND its refs; "Cost:"/"Cost" labels are untouched
    // (replaceAll is case-sensitive), so the template still prints "Cost: …".
    store.getState().setCode(DEMO_PROJECT_SOURCE.replaceAll("cost", "price"));
    store.getState().flushCompile();
    const s = store.getState();
    expect(s.isStale).toBe(false);
    expect(s.sheets.Monsters.rows.map((r) => r.price)).toEqual(["5", "1"]);
    expect(s.sheets.Monsters.rows.some((r) => "cost" in r)).toBe(false);
    expect(s.sheets.Monsters.editedRows).toEqual([true, true]);
    // The published model was rebuilt AGAINST the migrated rows — no
    // one-compile D003 flash for a committed rename.
    expect(s.lastGoodModel?.dataDiagnostics).toEqual([]);
    const costText = s.lastGoodModel?.model.decks[0].cards[0].front[2] as TextShape;
    expect(costText.text).toBe("Cost: 5");
  });
});

// -- reconcileSheets (pure, ◆26) ---------------------------------------------

const col = (name: string, kind: "Text" | "Number" = "Text"): SchemaColumn => ({
  name,
  type: { kind },
});
const enumCol = (name: string, enumName: string): SchemaColumn => ({
  name,
  type: { kind: "Enum", enumName, cases: ["A", "B"] },
});
const sheetOf = (name: string, ...columns: SchemaColumn[]): SheetSchema => ({ name, columns });
const shRows = (rows: Record<string, string>[]): SheetsState => ({
  Sh: { rows, editedRows: rows.map(() => true) },
});

describe("reconcileSheets (◆26 — pure)", () => {
  it("an added column changes nothing: a missing key already reads as empty", () => {
    const sheets = shRows([{ a: "1" }]);
    const next = reconcileSheets(sheets, [sheetOf("Sh", col("a"))], [
      sheetOf("Sh", col("a"), col("b")),
    ]);
    expect(next).toBe(sheets); // same reference — nothing moved
  });

  it("a removed column keeps its data in the row objects (orphaned, session-preserved)", () => {
    const sheets = shRows([{ a: "1", b: "2" }]);
    const next = reconcileSheets(sheets, [sheetOf("Sh", col("a"), col("b"))], [
      sheetOf("Sh", col("a")),
    ]);
    expect(next).toBe(sheets);
    expect(next.Sh.rows[0].b).toBe("2"); // invisible but intact
  });

  it("same-position/same-type single rename migrates values to the new key", () => {
    const sheets = shRows([{ a: "x", b: "5" }, { a: "y", b: "6" }]);
    const next = reconcileSheets(
      sheets,
      [sheetOf("Sh", col("a"), col("b", "Number"))],
      [sheetOf("Sh", col("a"), col("c", "Number"))],
    );
    expect(next).not.toBe(sheets);
    expect(next.Sh.rows).toEqual([{ a: "x", c: "5" }, { a: "y", c: "6" }]);
    expect(next.Sh.editedRows).toBe(sheets.Sh.editedRows); // flags untouched
    expect(sheets.Sh.rows[0]).toEqual({ a: "x", b: "5" }); // input not mutated
  });

  it("rows without the old key are left untouched by a migration (same row reference)", () => {
    const sheets = shRows([{ b: "5" }, {}]);
    const next = reconcileSheets(
      sheets,
      [sheetOf("Sh", col("b", "Number"))],
      [sheetOf("Sh", col("c", "Number"))],
    );
    expect(next.Sh.rows[0]).toEqual({ c: "5" });
    expect(next.Sh.rows[1]).toBe(sheets.Sh.rows[1]);
  });

  it("a migration onto an orphaned value TOMBSTONES it — never deletes (◆26)", () => {
    const sheets = shRows([{ b: "5", c: "OLD" }]);
    const next = reconcileSheets(
      sheets,
      [sheetOf("Sh", col("b", "Number"))],
      [sheetOf("Sh", col("c", "Number"))],
    );
    expect(next.Sh.rows[0]).toEqual({ c: "5", __orphan__c: "OLD" });
  });

  it("fossil: a keyless row's orphan under the NEW name resurfaces through a rename", () => {
    // The row never had the old column, so the migration leaves it alone —
    // its orphaned value now sits under the visible (renamed-to) column,
    // exactly as it would had the column been re-added directly (◆26).
    const sheets = shRows([{ c: "ONLY" }]);
    const next = reconcileSheets(
      sheets,
      [sheetOf("Sh", col("b", "Number"))],
      [sheetOf("Sh", col("c", "Number"))],
    );
    expect(next).toBe(sheets);
    expect(next.Sh.rows[0]).toEqual({ c: "ONLY" });
  });

  it("tombstones survive further reconciliations (they are never a rename source)", () => {
    const sheets = shRows([{ c: "5", __orphan__c: "OLD" }]);
    // A later rename c→d moves the visible value; the tombstone stays put.
    const next = reconcileSheets(
      sheets,
      [sheetOf("Sh", col("c", "Number"))],
      [sheetOf("Sh", col("d", "Number"))],
    );
    expect(next.Sh.rows[0]).toEqual({ d: "5", __orphan__c: "OLD" });
    // And an unrelated schema change touches nothing at all.
    const later = reconcileSheets(
      next,
      [sheetOf("Sh", col("d", "Number"))],
      [sheetOf("Sh", col("d", "Number"), col("e"))],
    );
    expect(later).toBe(next);
  });

  it("an occupied tombstone slot escalates (__2, …) instead of overwriting", () => {
    const sheets = shRows([{ b: "5", c: "OLD", __orphan__c: "OLDER" }]);
    const next = reconcileSheets(
      sheets,
      [sheetOf("Sh", col("b", "Number"))],
      [sheetOf("Sh", col("c", "Number"))],
    );
    expect(next.Sh.rows[0]).toEqual({
      c: "5",
      __orphan__c: "OLDER",
      __orphan__c__2: "OLD",
    });
  });

  it("rename is NOT triggered when the types differ", () => {
    const sheets = shRows([{ b: "5" }]);
    const next = reconcileSheets(
      sheets,
      [sheetOf("Sh", col("a"), col("b", "Number"))],
      [sheetOf("Sh", col("a"), col("c", "Text"))],
    );
    expect(next).toBe(sheets); // b stays orphaned; c starts empty
  });

  it("rename is NOT triggered when the positions differ", () => {
    const sheets = shRows([{ b: "5" }]);
    const next = reconcileSheets(
      sheets,
      [sheetOf("Sh", col("a"), col("b", "Number"))],
      [sheetOf("Sh", col("c", "Number"), col("a"))],
    );
    expect(next).toBe(sheets);
  });

  it("rename is NOT triggered when more than one column changed", () => {
    const sheets = shRows([{ a: "1", b: "2" }]);
    const next = reconcileSheets(
      sheets,
      [sheetOf("Sh", col("a"), col("b"))],
      [sheetOf("Sh", col("c"), col("d"))],
    );
    expect(next).toBe(sheets);
  });

  it("enum columns rename only within the SAME enum type", () => {
    const sheets = shRows([{ s: "A" }]);
    const migrated = reconcileSheets(
      sheets,
      [sheetOf("Sh", enumCol("s", "Suit"))],
      [sheetOf("Sh", enumCol("suit", "Suit"))],
    );
    expect(migrated.Sh.rows).toEqual([{ suit: "A" }]);
    const notMigrated = reconcileSheets(
      sheets,
      [sheetOf("Sh", enumCol("s", "Suit"))],
      [sheetOf("Sh", enumCol("t", "Rank"))],
    );
    expect(notMigrated).toBe(sheets);
  });

  it("a new schema sheet materializes empty; a removed sheet's data is kept", () => {
    const sheets = shRows([{ a: "1" }]);
    const next = reconcileSheets(sheets, [sheetOf("Sh", col("a"))], [
      sheetOf("Fresh", col("x")),
    ]);
    expect(next.Fresh).toEqual({ rows: [], editedRows: [] });
    expect(next.Sh).toBe(sheets.Sh); // orphaned, not deleted
  });

  it("a re-added sheet resurfaces its orphaned data instead of resetting it", () => {
    const sheets = shRows([{ a: "1" }]);
    const next = reconcileSheets(sheets, [], [sheetOf("Sh", col("a"))]);
    expect(next).toBe(sheets); // the existing entry (and its rows) survive
  });

  it("a null old schema does no renames but still materializes sheets", () => {
    const sheets = shRows([{ b: "5" }]);
    const next = reconcileSheets(sheets, null, [
      sheetOf("Sh", col("c", "Number")),
      sheetOf("Other", col("x")),
    ]);
    expect(next.Sh.rows).toEqual([{ b: "5" }]); // no migration guess without a baseline
    expect(next.Other).toEqual({ rows: [], editedRows: [] });
  });
});
