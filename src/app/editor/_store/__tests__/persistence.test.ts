/**
 * localStorage autosave (DESIGN.md §6.2), exercised headless against stub
 * storage: round-trip, the never-destroy fallbacks (corrupt / wrong version /
 * bad shape → demo + quarantine, primary untouched), the 1 s save debounce
 * and its independence from the 300 ms compile debounce, flush, quota
 * tolerance, reset-to-demo, and the SSR no-window path.
 *
 * The pagehide/visibilitychange listeners themselves are browser-only glue
 * inside `initEditorPersistence` (no window in this test env, and no
 * interaction driver in this project) — what they call, `flush()`, is what's
 * covered here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_PROJECT_SOURCE } from "@/lib/lang/demoProject";
import {
  COMPILE_DEBOUNCE_MS,
  createEditorStore,
  demoSeed,
  editorStore,
  type EditorStore,
  type SheetsState,
} from "../editorStore";
import {
  attachPersistence,
  initEditorPersistence,
  parsePersisted,
  PERSIST_DEBOUNCE_MS,
  PERSIST_KEY,
  PERSIST_VERSION,
  QUARANTINE_KEY,
  readStoredSeed,
  resetEditorToDemo,
  serializeProject,
  type PersistenceController,
  type ProjectStorage,
} from "../persistence";

afterEach(() => {
  vi.useRealTimers();
});

/** In-memory ProjectStorage that counts writes (a save = one setItem). */
interface StubStorage extends ProjectStorage {
  map: Map<string, string>;
  writes: number;
}

function memoryStorage(seeded: Record<string, string> = {}): StubStorage {
  const map = new Map(Object.entries(seeded));
  const stub: StubStorage = {
    map,
    writes: 0,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      stub.writes++;
      map.set(key, value);
    },
    removeItem: (key) => void map.delete(key),
  };
  return stub;
}

/** A demo-seeded store with autosave attached to fresh stub storage. */
function persistedStore(): {
  store: EditorStore;
  storage: StubStorage;
  controller: PersistenceController;
} {
  const store = createEditorStore();
  const storage = memoryStorage();
  const controller = attachPersistence(store, storage);
  return { store, storage, controller };
}

// -- round-trip --------------------------------------------------------------

describe("round-trip", () => {
  it("saves {version, code, sheets} after an edit and restores it into an equal project", () => {
    vi.useFakeTimers();
    const { store, storage } = persistedStore();
    store.getState().setCell("Monsters", 0, "health", "3");
    store.getState().setCode(store.getState().code + "# note\n");
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);

    const raw = storage.map.get(PERSIST_KEY);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw ?? "").version).toBe(PERSIST_VERSION);

    const seed = readStoredSeed(storage);
    expect(seed).not.toBeNull();
    const restored = createEditorStore(seed ?? undefined);
    const s = restored.getState();
    expect(s.code).toBe(DEMO_PROJECT_SOURCE + "# note\n");
    expect(s.sheets.Monsters.rows[0]).toEqual({
      name: "Dragon",
      cost: "5",
      health: "3",
      count: "2",
    });
    expect(s.sheets.Monsters.editedRows).toEqual([true, true]);
    // The restored project compiles like the live one did.
    expect(s.compile?.diagnostics).toEqual([]);
    expect(s.lastGoodModel?.model.decks[0].cards).toHaveLength(9);
  });

  it("round-trips the ◆29 edited flags and orphaned __orphan__* row keys", () => {
    const sheets: SheetsState = {
      S: {
        rows: [{ a: "1", __orphan__b: "stash" }, { a: "2" }],
        editedRows: [true, false],
      },
    };
    const seed = parsePersisted(serializeProject("Sheet: S\n  column a: Text\n", sheets));
    expect(seed?.sheets.S.rows).toEqual(sheets.S.rows);
    expect(seed?.sheets.S.editedRows).toEqual([true, false]);
  });

  it("normalizes a stored misaligned editedRows through the seed contract", () => {
    const raw = JSON.stringify({
      version: PERSIST_VERSION,
      code: "Sheet: S\n  column a: Text\n",
      sheets: { S: { rows: [{ a: "1" }, { a: "2" }], editedRows: [true] } },
    });
    const seed = parsePersisted(raw);
    expect(seed).not.toBeNull();
    const store = createEditorStore(seed ?? undefined);
    expect(store.getState().sheets.S.editedRows).toEqual([true, false]);
  });
});

// -- fallbacks that never destroy data (§6.2) --------------------------------

describe("invalid stored payloads", () => {
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
      "rows that are not an array",
      JSON.stringify({
        version: PERSIST_VERSION,
        code: "",
        sheets: { S: { rows: {}, editedRows: [] } },
      }),
    ],
    [
      "editedRows that are not an array",
      JSON.stringify({
        version: PERSIST_VERSION,
        code: "",
        sheets: { S: { rows: [], editedRows: "yes" } },
      }),
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
    it(`${label} → null, primary key untouched, payload quarantined`, () => {
      const storage = memoryStorage({ [PERSIST_KEY]: raw });
      expect(readStoredSeed(storage)).toBeNull();
      expect(storage.map.get(PERSIST_KEY)).toBe(raw); // still there — §6.2
      expect(storage.map.get(QUARANTINE_KEY)).toBe(raw); // and recoverable
    });
  }

  it("an empty slot is null without quarantining anything", () => {
    const storage = memoryStorage();
    expect(readStoredSeed(storage)).toBeNull();
    expect(storage.map.has(QUARANTINE_KEY)).toBe(false);
  });

  it("a getItem that throws (blocked storage) reads as empty, without crashing", () => {
    const storage = memoryStorage();
    storage.getItem = () => {
      throw new Error("denied");
    };
    expect(readStoredSeed(storage)).toBeNull();
  });

  it("quarantining survives a setItem that throws (primary still in place)", () => {
    const storage = memoryStorage({ [PERSIST_KEY]: "{not json" });
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(readStoredSeed(storage)).toBeNull();
    expect(storage.map.get(PERSIST_KEY)).toBe("{not json");
  });
});

// -- save debounce + flush ---------------------------------------------------

describe("save debounce and flush", () => {
  it("a burst saves ONCE, ~1 s after the last change — the 300 ms compile does not save", () => {
    vi.useFakeTimers();
    const { store, storage } = persistedStore();
    store.getState().setCell("Monsters", 0, "health", "3");
    store.getState().setCell("Monsters", 0, "cost", "7");
    vi.advanceTimersByTime(COMPILE_DEBOUNCE_MS); // compile lands…
    expect(store.getState().compile).not.toBeNull();
    expect(storage.writes).toBe(0); // …but nothing is saved yet
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - COMPILE_DEBOUNCE_MS - 1);
    expect(storage.writes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(storage.writes).toBe(1);
  });

  it("derived compile state alone never schedules a save", () => {
    vi.useFakeTimers();
    const store = createEditorStore();
    const storage = memoryStorage();
    attachPersistence(store, storage);
    store.getState().recompile(); // fresh compile object, same code/sheets
    vi.advanceTimersByTime(10 * PERSIST_DEBOUNCE_MS);
    expect(storage.writes).toBe(0);
  });

  it("flush writes a pending save immediately and is a no-op when idle", () => {
    vi.useFakeTimers();
    const store = createEditorStore();
    const storage = memoryStorage();
    const controller = attachPersistence(store, storage);
    controller.flush(); // idle
    expect(storage.writes).toBe(0);
    store.getState().setCell("Monsters", 0, "health", "3");
    controller.flush();
    expect(storage.writes).toBe(1);
    expect(readStoredSeed(storage)?.sheets.Monsters.rows[0].health).toBe("3");
    vi.advanceTimersByTime(10 * PERSIST_DEBOUNCE_MS);
    expect(storage.writes).toBe(1); // the pending timer was consumed
  });

  it("restoring is not an edit: attach-after-restore persists nothing by itself", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    storage.map.set(
      PERSIST_KEY,
      serializeProject("Sheet: S\n  column a: Text\n", {
        S: { rows: [{ a: "1" }], editedRows: [true] },
      }),
    );
    // initEditorPersistence's order: restore FIRST, subscribe after.
    const store = createEditorStore();
    const seed = readStoredSeed(storage);
    expect(seed).not.toBeNull();
    store.getState().replaceProject(seed ?? demoSeed());
    attachPersistence(store, storage);
    vi.advanceTimersByTime(10 * PERSIST_DEBOUNCE_MS);
    expect(storage.writes).toBe(0);
    expect(store.getState().code).toContain("Sheet: S");
  });
});

// -- quota / private-mode tolerance ------------------------------------------

describe("unwritable storage", () => {
  it("a throwing setItem disables autosave for the session instead of crashing", () => {
    vi.useFakeTimers();
    const store = createEditorStore();
    const storage = memoryStorage();
    let attempts = 0;
    storage.setItem = () => {
      attempts++;
      throw new Error("QuotaExceededError");
    };
    const controller = attachPersistence(store, storage);
    store.getState().setCell("Monsters", 0, "health", "3");
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    expect(attempts).toBe(1);
    expect(store.getState().autosaveDisabled).toBe(true); // the indicator
    // Editing still works, and autosave stops trying (each try would throw).
    store.getState().setCell("Monsters", 0, "health", "2");
    store.getState().flushCompile();
    expect(store.getState().sheets.Monsters.rows[0].health).toBe("2");
    vi.advanceTimersByTime(10 * PERSIST_DEBOUNCE_MS);
    controller.flush();
    expect(attempts).toBe(1);
  });
});

// -- replaceProject (the §6.2 restore/reset seam on the store) ---------------

describe("replaceProject", () => {
  it("is fresh-store semantics with subscribers kept: swap, eager recompile, last-goods rebuilt", () => {
    const store = createEditorStore();
    let notified = 0;
    store.subscribe(() => notified++);
    store.getState().replaceProject({
      code: "Sheet: S\n  column a: Text\n",
      sheets: { S: { rows: [{ a: "1" }], editedRows: [true] } },
    });
    const s = store.getState();
    expect(notified).toBeGreaterThan(0);
    expect(s.code).toContain("Sheet: S");
    expect(s.lastGoodSchema).toEqual([
      { name: "S", columns: [{ name: "a", type: { kind: "Text" } }] },
    ]);
    expect(s.lastGoodModel?.model.decks).toEqual([]); // no Card block
    expect(s.isStale).toBe(false);
  });

  it("restores broken saved code AS broken: no last-good ghost of the old project", () => {
    const store = createEditorStore();
    store.getState().replaceProject({ code: "Card: (((\n", sheets: {} });
    const s = store.getState();
    expect(s.compile?.diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(s.lastGoodModel).toBeNull(); // the demo's model is gone, not kept
    expect(s.lastGoodSchema).toBeNull();
    expect(s.isStale).toBe(true);
  });

  it("cancels a pending debounced compile of the OLD project", () => {
    vi.useFakeTimers();
    const store = createEditorStore();
    store.getState().setCode(DEMO_PROJECT_SOURCE + "\nCard: (((\n"); // pending…
    store.getState().replaceProject(demoSeed()); // …must die with the old project
    vi.advanceTimersByTime(10 * COMPILE_DEBOUNCE_MS);
    expect(store.getState().compile?.diagnostics).toEqual([]);
    expect(store.getState().isStale).toBe(false);
  });
});

// -- reset to demo -----------------------------------------------------------

describe("resetToDemo", () => {
  it("removes both keys, reseeds the demo, and does NOT re-persist the reset", () => {
    vi.useFakeTimers();
    const { store, storage, controller } = persistedStore();
    storage.map.set(QUARANTINE_KEY, "{old corrupt payload");
    store.getState().setCell("Monsters", 0, "name", "Wyrm");
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    expect(storage.map.has(PERSIST_KEY)).toBe(true);

    controller.resetToDemo();
    expect(storage.map.has(PERSIST_KEY)).toBe(false);
    expect(storage.map.has(QUARANTINE_KEY)).toBe(false);
    const s = store.getState();
    expect(s.code).toBe(DEMO_PROJECT_SOURCE);
    expect(s.sheets.Monsters.rows.map((r) => r.name)).toEqual(["Dragon", "Imp"]);
    expect(s.lastGoodModel?.model.decks[0].cards).toHaveLength(9);

    const writesAfterReset = storage.writes;
    vi.advanceTimersByTime(10 * PERSIST_DEBOUNCE_MS);
    expect(storage.writes).toBe(writesAfterReset); // storage stays clear (§6.2)
  });

  it("a reset consumes any pending save of the pre-reset project", () => {
    vi.useFakeTimers();
    const store = createEditorStore();
    const storage = memoryStorage();
    const controller = attachPersistence(store, storage);
    store.getState().setCell("Monsters", 0, "name", "Wyrm"); // pending save…
    controller.resetToDemo(); // …must not land after the wipe
    vi.advanceTimersByTime(10 * PERSIST_DEBOUNCE_MS);
    expect(storage.map.has(PERSIST_KEY)).toBe(false);
    expect(storage.writes).toBe(0);
  });

  it("the next USER edit after a reset saves again", () => {
    vi.useFakeTimers();
    const store = createEditorStore();
    const storage = memoryStorage();
    const controller = attachPersistence(store, storage);
    controller.resetToDemo();
    store.getState().setCell("Monsters", 0, "name", "Wyrm");
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    expect(readStoredSeed(storage)?.sheets.Monsters.rows[0].name).toBe("Wyrm");
  });

  it("survives storage that cannot even remove (in-memory reset still lands)", () => {
    const store = createEditorStore();
    const storage = memoryStorage();
    storage.removeItem = () => {
      throw new Error("denied");
    };
    const controller = attachPersistence(store, storage);
    store.getState().setCell("Monsters", 0, "name", "Wyrm");
    controller.resetToDemo();
    expect(store.getState().sheets.Monsters.rows[0].name).toBe("Dragon");
  });
});

// -- SSR path ----------------------------------------------------------------

describe("without a window (SSR / this test env)", () => {
  it("initEditorPersistence is a safe no-op and the singleton keeps the demo", () => {
    expect(typeof window).toBe("undefined"); // the premise of this test env
    expect(() => initEditorPersistence()).not.toThrow();
    expect(editorStore.getState().code).toBe(DEMO_PROJECT_SOURCE);
    expect(editorStore.getState().lastGoodModel?.model.decks[0].cards).toHaveLength(9);
  });

  it("resetEditorToDemo works even where persistence never attached", () => {
    editorStore.getState().setCell("Monsters", 0, "name", "Wyrm");
    expect(() => resetEditorToDemo()).not.toThrow();
    expect(editorStore.getState().sheets.Monsters.rows[0].name).toBe("Dragon");
    expect(editorStore.getState().lastGoodModel?.model.decks[0].cards).toHaveLength(9);
  });
});
