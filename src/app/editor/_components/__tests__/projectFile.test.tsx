/**
 * Project file export/import (DESIGN.md §7.1, §7.1b): the pure filename +
 * v2 payload helpers, the shared-with-persistence.ts validation (invalid
 * classes leave a real store AND asset library untouched), v1 compatibility
 * (imports forever, clears the library), the two-step confirm's three static
 * states, a full export → import round-trip (project + assets) through
 * `replaceProject`/`assetStore` on real stores, and the §7.1 autosave
 * posture — an import persists through the normal debounce with NO edit
 * needed (unlike reset, which is muted).
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
  ASSET_MAX_BYTES,
  createAssetStore,
  createInMemoryAssetAdapter,
  type StoredAsset,
} from "@/app/editor/_store/assetStore";
import {
  buildProjectExport,
  EXPORT_FAILED_MESSAGE,
  IMPORT_INVALID_MESSAGE,
  PROJECT_FILE_VERSION,
  parseImportedProjectFile,
  ProjectFileButtons,
  projectFileName,
  runExport,
} from "@/app/editor/_components/projectFile";

const stripTags = (markup: string): string => markup.replace(/<[^>]+>/g, "");

const dragonAsset: StoredAsset = {
  name: "dragon",
  mime: "image/png",
  bytes: new Uint8Array([1, 2, 3, 4]),
};

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

// -- payload round-trip (v2, §7.1b) ------------------------------------------

describe("buildProjectExport", () => {
  it("emits a v2 payload: code/sheets parse back via parseImportedProjectFile", async () => {
    const sheets: SheetsState = {
      S: {
        // Orphaned tombstone keys and the ◆29 flags are part of the project.
        rows: [{ a: "1", __orphan__b: "stash" }, { a: "2" }],
        editedRows: [true, false],
      },
    };
    const code = "Sheet: S\n  column a: Text\n";
    const { json } = await buildProjectExport(code, sheets, null);
    expect(JSON.parse(json).version).toBe(PROJECT_FILE_VERSION);
    const parsed = parseImportedProjectFile(json);
    if (!("seed" in parsed)) throw new Error("export did not import");
    expect(parsed.seed.code).toBe(code);
    expect(parsed.seed.sheets.S.rows).toEqual(sheets.S.rows);
    expect(parsed.seed.sheets.S.editedRows).toEqual([true, false]);
    expect(parsed.assets).toEqual([]);
  });

  it("names the demo project's export after its single deck", async () => {
    const state = createEditorStore().getState();
    const { filename } = await buildProjectExport(
      state.code,
      state.sheets,
      state.compile?.model ?? null,
    );
    expect(filename).toBe("Monster.cardgoblin.json");
  });

  it("carries assets through as base64, byte-exact", async () => {
    const { json } = await buildProjectExport("", {}, null, [dragonAsset]);
    const payload = JSON.parse(json);
    expect(payload.assets.dragon.mime).toBe("image/png");
    const parsed = parseImportedProjectFile(json);
    if (!("assets" in parsed)) throw new Error("export did not import");
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0].name).toBe("dragon");
    expect(parsed.assets[0].mime).toBe("image/png");
    expect(new Uint8Array(parsed.assets[0].bytes as Uint8Array)).toEqual(dragonAsset.bytes);
  });

  it("reads Blob-backed asset bytes too (the real browser adapter's shape)", async () => {
    const blobAsset: StoredAsset = {
      name: "banner",
      mime: "image/jpeg",
      bytes: new Blob([new Uint8Array([9, 9, 9])], { type: "image/jpeg" }),
    };
    const { json } = await buildProjectExport("", {}, null, [blobAsset]);
    const parsed = parseImportedProjectFile(json);
    if (!("assets" in parsed)) throw new Error("export did not import");
    expect(new Uint8Array(parsed.assets[0].bytes as Uint8Array)).toEqual(
      new Uint8Array([9, 9, 9]),
    );
  });
});

// -- import validation (v1 + v2) ---------------------------------------------

describe("parseImportedProjectFile", () => {
  const INVALID: [label: string, raw: string][] = [
    ["unparseable JSON", "{not json"],
    ["a JSON scalar", "42"],
    [
      "an unknown version",
      JSON.stringify({ version: 99, code: "", sheets: {}, assets: {} }),
    ],
    ["a v1 missing code field", JSON.stringify({ version: PERSIST_VERSION, sheets: {} })],
    [
      "v1 sheets as an array",
      JSON.stringify({ version: PERSIST_VERSION, code: "", sheets: [] }),
    ],
    [
      "v1 a non-string cell value",
      JSON.stringify({
        version: PERSIST_VERSION,
        code: "",
        sheets: { S: { rows: [{ a: 5 }], editedRows: [true] } },
      }),
    ],
    [
      "v2 missing assets key",
      JSON.stringify({ version: PROJECT_FILE_VERSION, code: "", sheets: {} }),
    ],
    [
      "v2 an invalid asset name",
      JSON.stringify({
        version: PROJECT_FILE_VERSION,
        code: "",
        sheets: {},
        assets: { "not an identifier": { mime: "image/png", bytes: "AAAA" } },
      }),
    ],
    [
      "v2 non-base64 asset bytes",
      JSON.stringify({
        version: PROJECT_FILE_VERSION,
        code: "",
        sheets: {},
        assets: { dragon: { mime: "image/png", bytes: "not base64!!" } },
      }),
    ],
    [
      "v2 an asset over the 2 MB cap",
      JSON.stringify({
        version: PROJECT_FILE_VERSION,
        code: "",
        sheets: {},
        assets: {
          dragon: {
            mime: "image/png",
            bytes: Buffer.alloc(ASSET_MAX_BYTES + 1).toString("base64"),
          },
        },
      }),
    ],
    [
      "v2 a missing mime field",
      JSON.stringify({
        version: PROJECT_FILE_VERSION,
        code: "",
        sheets: {},
        assets: { dragon: { bytes: "AAAA" } },
      }),
    ],
    [
      "v2 a non-image mime (adversarial m8)",
      JSON.stringify({
        version: PROJECT_FILE_VERSION,
        code: "",
        sheets: {},
        assets: { dragon: { mime: "text/html", bytes: "AAAA" } },
      }),
    ],
  ];

  for (const [label, raw] of INVALID) {
    it(`${label} → the inline error, and a live store is untouched`, () => {
      const store = createEditorStore();
      const before = store.getState();
      expect(parseImportedProjectFile(raw)).toEqual({ error: IMPORT_INVALID_MESSAGE });
      // Nothing commits without a seed: state is reference-identical.
      expect(store.getState()).toBe(before);
    });
  }

  it('caller 2 — a "__proto__" sheet name in a v2 file is a plain own key too (adversarial m11)', () => {
    // Same hazard as persistence.ts's parsePersisted (which shares
    // parseSheetsPayload with this v2 parser) — pinned at THIS entry point
    // too, since it's now a second, independent caller of the same helper.
    // Built from a raw JSON string, not a `{ __proto__: ... }` object
    // literal (which sets the prototype at parse time instead of creating
    // an own property, defeating the premise — see persistence.test.ts).
    const raw =
      `{"version":${PROJECT_FILE_VERSION},"code":"","assets":{},` +
      `"sheets":{"__proto__":{"rows":[{"a":"1"}],"editedRows":[true]}}}`;
    const parsed = parseImportedProjectFile(raw);
    expect("seed" in parsed).toBe(true);
    const sheets = "seed" in parsed ? parsed.seed.sheets : {};
    expect(Object.hasOwn(sheets, "__proto__")).toBe(true);
    expect(sheets.__proto__?.rows).toEqual([{ a: "1" }]);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype); // global untouched
  });

  it("a valid v2 payload yields the seed replaceProject expects, plus its assets", async () => {
    const { json } = await buildProjectExport(
      "Sheet: S\n  column a: Text\n",
      { S: { rows: [{ a: "1" }], editedRows: [true] } },
      null,
      [dragonAsset],
    );
    const parsed = parseImportedProjectFile(json);
    expect("seed" in parsed && parsed.seed.code).toContain("Sheet: S");
    expect("assets" in parsed && parsed.assets.map((a) => a.name)).toEqual(["dragon"]);
  });

  it("a valid v1 payload imports with an EMPTY asset list (§7.1b: v1 has none)", () => {
    const raw = JSON.stringify({
      version: PERSIST_VERSION,
      code: "Sheet: S\n  column a: Text\n",
      sheets: { S: { rows: [{ a: "1" }], editedRows: [true] } },
    });
    const parsed = parseImportedProjectFile(raw);
    expect("seed" in parsed && parsed.seed.code).toContain("Sheet: S");
    expect("assets" in parsed && parsed.assets).toEqual([]);
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

  it("armed (test seam): names the file, mentions assets, offers Import / Keep", () => {
    const markup = renderToStaticMarkup(
      <ProjectFileButtons
        onExport={() => {}}
        onImport={() => {}}
        initialPending={{ seed, assets: [], filename: "orcs.cardgoblin.json" }}
      />,
    );
    const text = stripTags(markup);
    expect(text).toContain(
      "Replace your project (and your uploaded assets) with “orcs.cardgoblin.json”?",
    );
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

  it("export failure (test seam): the SAME inline-alert surface as an invalid import", () => {
    const markup = renderToStaticMarkup(
      <ProjectFileButtons
        onExport={() => {}}
        onImport={() => {}}
        initialError={EXPORT_FAILED_MESSAGE}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(stripTags(markup)).toContain(EXPORT_FAILED_MESSAGE);
    expect(stripTags(markup)).toContain("Export project");
  });

  it("both button groups wrap instead of clipping (adversarial review item 2)", () => {
    // Regression: the status bar's right-hand group used to be a rigid,
    // overflow-hidden line — a long filename in the armed confirm (a real,
    // user-supplied string) could push Import/Keep out of view. Real reflow
    // is a browser layout behavior with no headless driver here; this pins
    // the structural contract (flex-wrap) on both states.
    const resting = renderToStaticMarkup(
      <ProjectFileButtons onExport={() => {}} onImport={() => {}} />,
    );
    expect(resting).toContain('class="flex flex-wrap items-center gap-1.5"');

    const armed = renderToStaticMarkup(
      <ProjectFileButtons
        onExport={() => {}}
        onImport={() => {}}
        initialPending={{ seed, assets: [], filename: "orcs.cardgoblin.json" }}
      />,
    );
    expect(armed).toContain('class="flex flex-wrap items-center gap-1.5"');
  });
});

// -- export rejection handling (adversarial m7: no interaction driver, so ---
// -- the button's catch logic is tested through its pure extraction) --------

describe("runExport (§7.1b m7 — exportEditorProject is async and can reject)", () => {
  it("resolves to null when onExport succeeds", async () => {
    await expect(runExport(() => {})).resolves.toBeNull();
    await expect(runExport(async () => {})).resolves.toBeNull();
  });

  it("resolves to EXPORT_FAILED_MESSAGE — never an unhandled rejection — when onExport throws", async () => {
    await expect(
      runExport(() => {
        throw new Error("boom");
      }),
    ).resolves.toBe(EXPORT_FAILED_MESSAGE);
  });

  it("resolves to EXPORT_FAILED_MESSAGE when the returned promise rejects", async () => {
    await expect(runExport(() => Promise.reject(new Error("IDB read failed")))).resolves.toBe(
      EXPORT_FAILED_MESSAGE,
    );
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
  it("round-trips a full project: edited demo out, identical project in", async () => {
    const source = createEditorStore();
    source.getState().setCell("Monsters", 0, "health", "3");
    source.getState().addRow("Monsters"); // a pristine row (editedRows: false)
    const { code, sheets, compile } = source.getState();
    const { json } = await buildProjectExport(code, sheets, compile?.model ?? null);

    const parsed = parseImportedProjectFile(json);
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

  it("round-trips the asset library byte-exact via assetStore.replaceAll", async () => {
    const sourceAssets = createAssetStore(createInMemoryAssetAdapter([dragonAsset]));
    await sourceAssets.refresh();
    const asset = await sourceAssets.getBytes("dragon");
    if (!asset) throw new Error("seed asset missing");
    const { json } = await buildProjectExport("", {}, null, [asset]);

    const parsed = parseImportedProjectFile(json);
    if (!("assets" in parsed)) throw new Error("export did not import");

    const targetAssets = createAssetStore(createInMemoryAssetAdapter());
    await targetAssets.replaceAll(parsed.assets);
    expect(targetAssets.getAssetNames()).toEqual(new Set(["dragon"]));
    const restored = await targetAssets.getBytes("dragon");
    expect(restored?.bytes).toEqual(dragonAsset.bytes);
  });

  it("v1 import clears a target library (replaceAll([]))", async () => {
    const targetAssets = createAssetStore(createInMemoryAssetAdapter([dragonAsset]));
    await targetAssets.refresh();
    expect(targetAssets.getAssetNames().size).toBe(1);
    const parsed = parseImportedProjectFile(
      JSON.stringify({ version: PERSIST_VERSION, code: "", sheets: {} }),
    );
    if (!("assets" in parsed)) throw new Error("v1 file did not import");
    await targetAssets.replaceAll(parsed.assets);
    expect(targetAssets.getAssetNames().size).toBe(0);
  });

  it("an invalid v2 asset entry rejects the WHOLE file, leaving a target store untouched", async () => {
    const targetAssets = createAssetStore(createInMemoryAssetAdapter([dragonAsset]));
    await targetAssets.refresh();
    const raw = JSON.stringify({
      version: PROJECT_FILE_VERSION,
      code: "ok code",
      sheets: {},
      assets: { imp: { mime: "image/png", bytes: "not base64!!" } },
    });
    expect(parseImportedProjectFile(raw)).toEqual({ error: IMPORT_INVALID_MESSAGE });
    // Never reached replaceAll — the store's original library survives.
    expect(targetAssets.getAssetNames()).toEqual(new Set(["dragon"]));
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
