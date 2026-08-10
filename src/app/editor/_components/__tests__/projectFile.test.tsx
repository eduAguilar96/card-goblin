/**
 * Project file export/import (DESIGN.md §7.1): the pure filename + payload
 * helpers, the parsePersisted-shared validation (invalid classes leave a real
 * store untouched), the two-step confirm's three static states, a full
 * export → import round-trip through `replaceProject` on a real store, and
 * the §7.1 autosave posture — an import persists through the normal debounce
 * with NO edit needed (unlike reset, which is muted).
 *
 * Static markup only, as everywhere: the file-picker flow (hidden input,
 * File.text()) has no driver in this project, so the pure pieces it leans on
 * are tested directly and the states render via the `initialError` /
 * `initialPending` seams.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { compileProject, type RenderModel } from "@/lib/lang";
import {
  createEditorStore,
  type EditorSeed,
  type SheetsState,
} from "@/app/editor/_store/editorStore";
import {
  attachPersistence,
  parsePersisted,
  PERSIST_DEBOUNCE_MS,
  PERSIST_KEY,
  PERSIST_VERSION,
  type ProjectStorage,
} from "@/app/editor/_store/persistence";
import {
  buildProjectExport,
  IMPORT_INVALID_MESSAGE,
  parseImportedProject,
  ProjectFileButtons,
  projectFileName,
} from "@/app/editor/_components/projectFile";

const stripTags = (markup: string): string => markup.replace(/<[^>]+>/g, "");

/** A model with exactly the given Card blocks (compiled, not hand-built). */
function modelWithDecks(cardNames: string[]): RenderModel {
  const code =
    [
      "Sheet: S",
      "Template: T",
      "  Rectangle:",
      "    x: 0",
      "    y: 0",
      "    width: full",
      "    height: 1",
      "    color: black",
      ...cardNames.flatMap((name) => [
        `Card: ${name}`,
        "  sheet: S",
        "  size: poker",
        "  x_units: 20",
        "  y_units: auto",
        "  Front: T",
      ]),
    ].join("\n") + "\n";
  const result = compileProject(code, { S: [] }, { S: [] });
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return result.model;
}

// -- filename (§7.1) ---------------------------------------------------------

describe("projectFileName", () => {
  it("uses the deck's name when exactly one Card block exists", () => {
    expect(projectFileName(modelWithDecks(["Monster"]))).toBe("Monster.cardgoblin.json");
  });

  it("falls back for multi-deck models and for no model at all", () => {
    expect(projectFileName(modelWithDecks(["Hero", "Villain"]))).toBe(
      "cardgoblin-project.cardgoblin.json",
    );
    expect(projectFileName(modelWithDecks([]))).toBe("cardgoblin-project.cardgoblin.json");
    expect(projectFileName(null)).toBe("cardgoblin-project.cardgoblin.json");
  });

  it("sanitizes like pdfFileName (defensive — real deck names are identifiers)", () => {
    // Hand-built models: the compiler can't produce non-identifier deck names.
    const named = (cardName: string): RenderModel =>
      ({ decks: [{ cardName }] }) as unknown as RenderModel;
    expect(projectFileName(named("My Deck!"))).toBe("My_Deck.cardgoblin.json");
    expect(projectFileName(named("///"))).toBe("cardgoblin-project.cardgoblin.json");
  });
});

// -- payload round-trip ------------------------------------------------------

describe("buildProjectExport", () => {
  it("emits the §6.2 autosave payload: bytes parse back to the same project", () => {
    const sheets: SheetsState = {
      S: {
        // Orphaned tombstone keys and the ◆29 flags are part of the project.
        rows: [{ a: "1", __orphan__b: "stash" }, { a: "2" }],
        editedRows: [true, false],
      },
    };
    const code = "Sheet: S\n  column a: Text\n";
    const { json } = buildProjectExport(code, sheets, null);
    expect(JSON.parse(json).version).toBe(PERSIST_VERSION);
    const seed = parsePersisted(json);
    expect(seed).not.toBeNull();
    expect(seed?.code).toBe(code);
    expect(seed?.sheets.S.rows).toEqual(sheets.S.rows);
    expect(seed?.sheets.S.editedRows).toEqual([true, false]);
  });

  it("names the demo project's export after its single deck", () => {
    const state = createEditorStore().getState();
    const { filename } = buildProjectExport(
      state.code,
      state.sheets,
      state.compile?.model ?? null,
    );
    expect(filename).toBe("Monster.cardgoblin.json");
  });
});

// -- import validation (same rules as autosave restore) ----------------------

describe("parseImportedProject", () => {
  const INVALID: [label: string, raw: string][] = [
    ["unparseable JSON", "{not json"],
    ["a JSON scalar", "42"],
    [
      "a version mismatch",
      JSON.stringify({ version: PERSIST_VERSION + 1, code: "", sheets: {} }),
    ],
    ["a missing code field", JSON.stringify({ version: PERSIST_VERSION, sheets: {} })],
    [
      "sheets as an array",
      JSON.stringify({ version: PERSIST_VERSION, code: "", sheets: [] }),
    ],
    [
      "a non-string cell value",
      JSON.stringify({
        version: PERSIST_VERSION,
        code: "",
        sheets: { S: { rows: [{ a: 5 }], editedRows: [true] } },
      }),
    ],
  ];

  for (const [label, raw] of INVALID) {
    it(`${label} → the inline error, and a live store is untouched`, () => {
      const store = createEditorStore();
      const before = store.getState();
      expect(parseImportedProject(raw)).toEqual({ error: IMPORT_INVALID_MESSAGE });
      // Nothing commits without a seed: state is reference-identical.
      expect(store.getState()).toBe(before);
    });
  }

  it("a valid payload yields the seed replaceProject expects", () => {
    const raw = buildProjectExport("Sheet: S\n  column a: Text\n", {
      S: { rows: [{ a: "1" }], editedRows: [true] },
    }, null).json;
    const parsed = parseImportedProject(raw);
    expect("seed" in parsed && parsed.seed.code).toContain("Sheet: S");
  });
});

// -- the two-step confirm (§7.1 — same pattern as reset) ---------------------

describe("ProjectFileButtons", () => {
  const seed: EditorSeed = { code: "", sheets: {} };

  it("rests as two quiet buttons — no destructive control, no error", () => {
    const markup = renderToStaticMarkup(
      <ProjectFileButtons onExport={() => {}} onImport={() => {}} />,
    );
    const text = stripTags(markup);
    expect(text).toContain("Export project");
    expect(text).toContain("Import project");
    expect(text).not.toContain("Replace your project");
    expect(markup).not.toContain("text-red-400");
    // The picker is a hidden real input scoped to .json files.
    expect(markup).toContain('type="file"');
    expect(markup).toContain('accept=".json,application/json"');
  });

  it("armed (test seam): names the file in the question and offers Import / Keep", () => {
    const markup = renderToStaticMarkup(
      <ProjectFileButtons
        onExport={() => {}}
        onImport={() => {}}
        initialPending={{ seed, filename: "orcs.cardgoblin.json" }}
      />,
    );
    const text = stripTags(markup);
    expect(text).toContain("Replace your project with “orcs.cardgoblin.json”?");
    expect(text).toContain("Import");
    expect(text).toContain("Keep");
    expect(markup).toContain("text-red-400"); // the destructive click is marked
  });

  it("invalid pick (test seam): an inline alert near the buttons, not a browser alert", () => {
    const markup = renderToStaticMarkup(
      <ProjectFileButtons
        onExport={() => {}}
        onImport={() => {}}
        initialError={IMPORT_INVALID_MESSAGE}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(stripTags(markup)).toContain(IMPORT_INVALID_MESSAGE);
    // The buttons stay usable beside the message (retry is a click away).
    expect(stripTags(markup)).toContain("Import project");
  });
});

// -- store round-trip + the §7.1 autosave posture ----------------------------

/** Minimal in-memory ProjectStorage (persistence.test.ts's stub, inlined). */
function memoryStorage(): ProjectStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("import → replaceProject on a real store", () => {
  it("round-trips a full project: edited demo out, identical project in", () => {
    const source = createEditorStore();
    source.getState().setCell("Monsters", 0, "health", "3");
    source.getState().addRow("Monsters"); // a pristine row (editedRows: false)
    const { code, sheets, compile } = source.getState();
    const { json } = buildProjectExport(code, sheets, compile?.model ?? null);

    const parsed = parseImportedProject(json);
    if (!("seed" in parsed)) throw new Error("export did not import");
    const target = createEditorStore();
    target.getState().replaceProject(parsed.seed);

    const s = target.getState();
    expect(s.code).toBe(code);
    expect(s.sheets.Monsters.rows).toEqual(sheets.Monsters.rows);
    expect(s.sheets.Monsters.editedRows).toEqual([true, true, false]);
    // And it compiles like the source did (Dragon's health 3 → 9 cards).
    expect(s.lastGoodModel?.model.decks[0].cards).toHaveLength(9);
  });

  it("persists through the normal autosave debounce with NO edit (§7.1 — import is not muted)", () => {
    vi.useFakeTimers();
    try {
      const store = createEditorStore();
      const storage = memoryStorage();
      attachPersistence(store, storage);

      const imported: EditorSeed = {
        code: "Sheet: S\n  column a: Text\n",
        sheets: { S: { rows: [{ a: "1" }], editedRows: [true] } },
      };
      store.getState().replaceProject(imported); // what importEditorProject does
      expect(storage.map.has(PERSIST_KEY)).toBe(false); // debounced, not sync
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      const saved = parsePersisted(storage.map.get(PERSIST_KEY) ?? "");
      expect(saved?.code).toBe(imported.code);
      expect(saved?.sheets.S.rows).toEqual([{ a: "1" }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
