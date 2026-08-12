/**
 * Local image assets — the IndexedDB-backed store (DESIGN.md §7.1b), tested
 * headless against `createInMemoryAssetAdapter` (the injectable seam every
 * caller — editorStore's W005 input, cardSvg's/pdfRaster's resolution,
 * projectFile.tsx's v2 round-trip — actually depends on). The real
 * `createIndexedDbAssetAdapter` is browser-only by construction (nothing in
 * it runs until called, and `indexedDB` doesn't exist in this test
 * environment) — on the manual browser checklist, same posture as
 * pdfRaster.tsx's DOM-only rasterizer.
 *
 * Covers: CRUD, rename collision/not-found, the 2 MB cap, name validation,
 * quota/throw degradation (→ `disabled`, mirroring autosave's posture), and
 * the subscriber events cardSvg.tsx/editorStore.ts key their invalidation
 * and recompile wiring on.
 */
import { describe, expect, it } from "vitest";
import {
  ASSET_MAX_BYTES,
  ASSET_NAME_PATTERN,
  AssetStoreError,
  createAssetStore,
  createInMemoryAssetAdapter,
  isValidAssetName,
  type AssetAdapter,
  type AssetChangeEvent,
  type StoredAsset,
} from "../assetStore";

const dragon: StoredAsset = { name: "dragon", mime: "image/png", bytes: new Uint8Array([1, 2, 3]) };
const imp: StoredAsset = { name: "imp", mime: "image/png", bytes: new Uint8Array([4, 5]) };

// ---------------------------------------------------------------------------
// Name validation (§3.1 identifier rules)
// ---------------------------------------------------------------------------

describe("isValidAssetName / ASSET_NAME_PATTERN", () => {
  it("accepts letters, digits, underscores, starting with a letter", () => {
    for (const name of ["dragon", "Dragon_2", "a", "card_art_01"]) {
      expect(isValidAssetName(name)).toBe(true);
      expect(ASSET_NAME_PATTERN.test(name)).toBe(true);
    }
  });

  it("rejects a leading digit/underscore, empty, spaces, and punctuation", () => {
    for (const name of ["2dragons", "_dragon", "", "dragon art", "dragon-art", "dragon.png"]) {
      expect(isValidAssetName(name)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe("createAssetStore — CRUD over an in-memory adapter", () => {
  it("starts empty and not disabled", () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    expect(store.getSnapshot()).toEqual({ assets: [], disabled: false });
    expect(store.getAssetNames()).toEqual(new Set());
  });

  it("upload adds a sorted meta entry and getBytes returns the bytes back", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    await store.upload("imp", "image/png", imp.bytes);
    await store.upload("dragon", "image/png", dragon.bytes);
    expect(store.getSnapshot().assets.map((a) => a.name)).toEqual(["dragon", "imp"]); // sorted
    expect(store.getSnapshot().assets.find((a) => a.name === "dragon")?.size).toBe(3);
    const back = await store.getBytes("dragon");
    expect(back?.bytes).toEqual(dragon.bytes);
    expect(back?.mime).toBe("image/png");
  });

  it("re-uploading an existing name overwrites it (replace idiom)", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    await store.upload("dragon", "image/png", new Uint8Array([1]));
    await store.upload("dragon", "image/jpeg", new Uint8Array([1, 2, 3, 4]));
    expect(store.getSnapshot().assets).toHaveLength(1);
    const back = await store.getBytes("dragon");
    expect(back?.mime).toBe("image/jpeg");
    expect(back?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("delete removes it; getBytes on a missing name is null, not a throw", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon]));
    await store.refresh();
    await store.remove("dragon");
    expect(store.getAssetNames()).toEqual(new Set());
    expect(await store.getBytes("dragon")).toBeNull();
  });

  it("refresh loads the adapter's seeded contents into the sync-readable cache", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon, imp]));
    expect(store.getAssetNames().size).toBe(0); // not read yet
    await store.refresh();
    expect(store.getAssetNames()).toEqual(new Set(["dragon", "imp"]));
  });

  it("clear deletes every asset and is a no-op when already empty", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon, imp]));
    await store.refresh();
    await store.clear();
    expect(store.getAssetNames().size).toBe(0);
    await expect(store.clear()).resolves.toBeUndefined(); // no-op, doesn't throw
  });

  it("replaceAll swaps the whole library atomically", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon]));
    await store.refresh();
    await store.replaceAll([imp]);
    expect(store.getAssetNames()).toEqual(new Set(["imp"]));
    expect(await store.getBytes("dragon")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rename — collision, not-found
// ---------------------------------------------------------------------------

describe("rename", () => {
  it("renames, preserving bytes/mime under the new name", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon]));
    await store.refresh();
    await store.rename("dragon", "wyrm");
    expect(store.getAssetNames()).toEqual(new Set(["wyrm"]));
    const back = await store.getBytes("wyrm");
    expect(back?.bytes).toEqual(dragon.bytes);
  });

  it("renaming to an existing name rejects with 'name-taken', original untouched", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon, imp]));
    await store.refresh();
    await expect(store.rename("dragon", "imp")).rejects.toMatchObject({
      code: "name-taken",
    });
    expect(store.getAssetNames()).toEqual(new Set(["dragon", "imp"]));
  });

  it("renaming a name that doesn't exist rejects with 'not-found'", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    await expect(store.rename("ghost", "spirit")).rejects.toMatchObject({ code: "not-found" });
  });

  it("renaming to an invalid identifier rejects with 'invalid-name'", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon]));
    await store.refresh();
    await expect(store.rename("dragon", "2dragons")).rejects.toBeInstanceOf(AssetStoreError);
    await expect(store.rename("dragon", "2dragons")).rejects.toMatchObject({
      code: "invalid-name",
    });
    expect(store.getAssetNames()).toEqual(new Set(["dragon"])); // untouched
  });

  it("renaming a name to ITSELF is allowed (a no-op collision)", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon]));
    await store.refresh();
    await expect(store.rename("dragon", "dragon")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The 2 MB cap
// ---------------------------------------------------------------------------

describe("upload cap enforcement (§7.1b: 2 MB pre-encoding)", () => {
  it("rejects bytes over ASSET_MAX_BYTES with a typed 'too-large' error, nothing stored", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    const oversized = new Uint8Array(ASSET_MAX_BYTES + 1);
    await expect(store.upload("dragon", "image/png", oversized)).rejects.toMatchObject({
      code: "too-large",
    });
    expect(store.getAssetNames().size).toBe(0);
  });

  it("accepts bytes at EXACTLY the cap", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    await expect(
      store.upload("dragon", "image/png", new Uint8Array(ASSET_MAX_BYTES)),
    ).resolves.toMatchObject({ name: "dragon", size: ASSET_MAX_BYTES });
  });

  it("measures a Blob's size the same way (byteLengthOf branches on the type)", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    const oversized = new Blob([new Uint8Array(ASSET_MAX_BYTES + 1)]);
    await expect(store.upload("dragon", "image/png", oversized)).rejects.toMatchObject({
      code: "too-large",
    });
  });

  it("rejects an invalid upload name with a typed 'invalid-name' error", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    await expect(store.upload("2dragons", "image/png", new Uint8Array([1]))).rejects.toMatchObject(
      { code: "invalid-name" },
    );
  });
});

// ---------------------------------------------------------------------------
// Quota / throw degradation → disabled (mirrors autosave's failure posture)
// ---------------------------------------------------------------------------

/** An adapter every method rejects on, simulating a quota error / a broken
 * IDB connection. */
function throwingAdapter(): AssetAdapter {
  const fail = (): never => {
    throw new Error("simulated quota exceeded");
  };
  return { list: fail, get: fail, put: fail, rename: fail, delete: fail };
}

describe("quota/throw degradation → disabled", () => {
  it("a failed upload disables the store and reports it via 'disabled'", async () => {
    const store = createAssetStore(throwingAdapter());
    expect(store.getSnapshot().disabled).toBe(false);
    const events: AssetChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    await expect(store.upload("dragon", "image/png", new Uint8Array([1]))).rejects.toMatchObject(
      { code: "disabled" },
    );
    expect(store.getSnapshot().disabled).toBe(true);
    expect(events).toContainEqual({ type: "disabled" });
  });

  it("refresh() swallows a failed list() into disabled rather than throwing", async () => {
    const store = createAssetStore(throwingAdapter());
    await expect(store.refresh()).resolves.toBeUndefined();
    expect(store.getSnapshot().disabled).toBe(true);
  });

  it("getBytes() on a disabled store returns null, not a throw", async () => {
    const store = createAssetStore(throwingAdapter(), true);
    expect(await store.getBytes("dragon")).toBeNull();
  });
});

describe("startDisabled — the IDB-unavailable posture", () => {
  it("a store built disabled rejects every mutation without ever calling the adapter", async () => {
    let calls = 0;
    const countingAdapter: AssetAdapter = {
      list: async () => {
        calls++;
        return [];
      },
      get: async () => {
        calls++;
        return null;
      },
      put: async () => {
        calls++;
      },
      rename: async () => {
        calls++;
      },
      delete: async () => {
        calls++;
      },
    };
    const store = createAssetStore(countingAdapter, true);
    expect(store.getSnapshot().disabled).toBe(true);
    await expect(store.upload("dragon", "image/png", new Uint8Array([1]))).rejects.toMatchObject(
      { code: "disabled" },
    );
    await expect(store.rename("a", "b")).rejects.toMatchObject({ code: "disabled" });
    await expect(store.remove("dragon")).rejects.toMatchObject({ code: "disabled" });
    expect(await store.getBytes("dragon")).toBeNull();
    await store.refresh();
    await store.clear();
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Subscription events
// ---------------------------------------------------------------------------

describe("subscribe — the events cardSvg.tsx/editorStore.ts key invalidation on", () => {
  it("fires 'put' on upload, 'delete' on remove, 'rename' with from/to", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    const events: AssetChangeEvent[] = [];
    const unsubscribe = store.subscribe((e) => events.push(e));

    await store.upload("dragon", "image/png", new Uint8Array([1]));
    await store.rename("dragon", "wyrm");
    await store.remove("wyrm");
    unsubscribe();
    await store.upload("imp", "image/png", new Uint8Array([1])); // not observed

    expect(events).toEqual([
      { type: "put", name: "dragon" },
      { type: "rename", from: "dragon", to: "wyrm" },
      { type: "delete", name: "wyrm" },
    ]);
  });

  it("fires 'clear' and 'replaceAll'", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon]));
    await store.refresh();
    const events: AssetChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    await store.replaceAll([imp]);
    await store.clear();
    expect(events).toEqual([{ type: "replaceAll" }, { type: "clear" }]);
  });

  it("unsubscribe stops delivery", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    const events: AssetChangeEvent[] = [];
    const unsubscribe = store.subscribe((e) => events.push(e));
    unsubscribe();
    await store.upload("dragon", "image/png", new Uint8Array([1]));
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C1 — getSnapshot() reference stability (useSyncExternalStore hazard)
// ---------------------------------------------------------------------------

describe("getSnapshot() reference stability (adversarial C1)", () => {
  it("returns the SAME object across calls when nothing changed", () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon]));
    const a = store.getSnapshot();
    const b = store.getSnapshot();
    expect(a).toBe(b); // Object.is — what useSyncExternalStore actually checks
  });

  it("a mutation mints a NEW snapshot object (so useSyncExternalStore re-renders)", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    const before = store.getSnapshot();
    await store.upload("dragon", "image/png", new Uint8Array([1]));
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(store.getSnapshot()).toBe(after); // stable again post-change
  });

  it("disable() also mints a new snapshot (disabled flips)", async () => {
    const store = createAssetStore(throwingAdapter());
    const before = store.getSnapshot();
    await store.refresh(); // fails → disable()
    expect(store.getSnapshot()).not.toBe(before);
  });

  it("a no-op operation (e.g. a repeated clear) does NOT mint a new snapshot", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    const before = store.getSnapshot();
    await store.clear(); // nothing to delete; assets stay []
    expect(store.getSnapshot()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// C2 — refresh() notifies on a changed list (heals stale "failed"/W005)
// ---------------------------------------------------------------------------

describe("refresh() notifies subscribers when the list actually changed (adversarial C2)", () => {
  it("seed adapter → refresh → subscriber notified + getAssetNames current", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon]));
    const events: AssetChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    await store.refresh();
    expect(events).toEqual([{ type: "replaceAll" }]);
    expect(store.getAssetNames()).toEqual(new Set(["dragon"]));
  });

  it("an empty adapter on first refresh does NOT notify (no change from the empty start)", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([]));
    const events: AssetChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    await store.refresh();
    expect(events).toEqual([]);
  });

  it("a second refresh with an unchanged list does not notify again", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon]));
    await store.refresh();
    const events: AssetChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    await store.refresh(); // same contents
    expect(events).toEqual([]);
  });

  it("a refresh that discovers a DIFFERENT list (mime/size changed) notifies too", async () => {
    const adapter = createInMemoryAssetAdapter([dragon]);
    const store = createAssetStore(adapter);
    await store.refresh();
    await adapter.put({ ...dragon, mime: "image/webp" }); // bypasses the store, like a second tab would
    const events: AssetChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    await store.refresh();
    expect(events).toEqual([{ type: "replaceAll" }]);
  });
});

// ---------------------------------------------------------------------------
// m1 — a disabled store's asset name set is EMPTY, not stale
// ---------------------------------------------------------------------------

describe("getAssetNames() while disabled (adversarial m1)", () => {
  it("returns an empty set even though the pre-disable cache still holds names", async () => {
    const adapter = createInMemoryAssetAdapter([dragon]);
    const store = createAssetStore(adapter);
    await store.refresh();
    expect(store.getAssetNames()).toEqual(new Set(["dragon"]));
    adapter.put = async () => {
      throw new Error("quota");
    };
    await expect(
      store.upload("imp", "image/png", new Uint8Array([1])),
    ).rejects.toMatchObject({ code: "disabled" });
    // The checker (W005) and the renderer must agree: a disabled library
    // reads as unavailable, not as "still whatever it last knew."
    expect(store.getAssetNames()).toEqual(new Set());
    expect(store.getSnapshot().assets.map((a) => a.name)).toEqual(["dragon"]); // cache itself is untouched, only the public name view
  });
});

// ---------------------------------------------------------------------------
// m2 — the cap-violation message at the exact MB-rounding boundary
// ---------------------------------------------------------------------------

describe("cap-violation message precision (adversarial m2)", () => {
  it("a file 1 byte over the cap never renders identically to the cap itself", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    let message = "";
    try {
      await store.upload("dragon", "image/png", new Uint8Array(ASSET_MAX_BYTES + 1));
    } catch (err) {
      message = err instanceof Error ? err.message : "";
    }
    // The two numbers quoted in the message must not be the same string —
    // "2.0 MB is over the 2.0 MB cap" reads as if nothing were wrong.
    const numbers = message.match(/[\d.]+\s*(?:MB|KB)/g) ?? [];
    expect(numbers).toHaveLength(2);
    expect(numbers[0]).not.toBe(numbers[1]);
  });

  it("a file far over the cap still reads in MB (KB is only for the collision zone)", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    let message = "";
    try {
      await store.upload("dragon", "image/png", new Uint8Array(10 * 1024 * 1024));
    } catch (err) {
      message = err instanceof Error ? err.message : "";
    }
    expect(message).toContain("10.0 MB");
  });
});

// ---------------------------------------------------------------------------
// m8 — mime must be image/* at upload
// ---------------------------------------------------------------------------

describe("upload mime validation (adversarial m8)", () => {
  it("rejects a non-image mime with a typed 'invalid-mime' error, nothing stored", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    await expect(
      store.upload("dragon", "text/plain", new Uint8Array([1])),
    ).rejects.toMatchObject({ code: "invalid-mime" });
    expect(store.getAssetNames().size).toBe(0);
  });

  it("rejects an empty mime too", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    await expect(store.upload("dragon", "", new Uint8Array([1]))).rejects.toMatchObject({
      code: "invalid-mime",
    });
  });

  it("accepts any image/* subtype", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    for (const mime of ["image/png", "image/jpeg", "image/svg+xml", "image/x-icon"]) {
      await expect(
        store.upload("dragon", mime, new Uint8Array([1])),
      ).resolves.toMatchObject({ mime });
    }
  });
});

// ---------------------------------------------------------------------------
// m10 — rename/remove fall back to the ADAPTER on a cache miss
// ---------------------------------------------------------------------------

describe("rename/remove check the adapter on a cache miss before reporting not-found (adversarial m10)", () => {
  it("rename succeeds against an un-refreshed store whose adapter actually has the name", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter([dragon])); // never refresh()d
    expect(store.getSnapshot().assets).toEqual([]); // cache genuinely empty
    await store.rename("dragon", "wyrm");
    expect(store.getAssetNames()).toEqual(new Set(["wyrm"]));
  });

  it("rename still rejects not-found when the adapter truly lacks the name", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    await expect(store.rename("ghost", "spirit")).rejects.toMatchObject({ code: "not-found" });
  });

  it("remove succeeds against an un-refreshed store whose adapter actually has the name", async () => {
    const adapter = createInMemoryAssetAdapter([dragon]);
    const store = createAssetStore(adapter); // never refresh()d
    await store.remove("dragon");
    expect((await adapter.list()).map((a) => a.name)).toEqual([]);
  });

  it("remove rejects not-found when the name genuinely doesn't exist anywhere", async () => {
    const store = createAssetStore(createInMemoryAssetAdapter());
    await expect(store.remove("ghost")).rejects.toMatchObject({ code: "not-found" });
  });
});

// ---------------------------------------------------------------------------
// M3 — replaceAll: write-then-delete order, cache reconciled on failure
// ---------------------------------------------------------------------------

describe("replaceAll failure recovery (adversarial M3)", () => {
  /** An adapter whose `put` succeeds for the first N records, then throws —
   * simulating a quota hit partway through a multi-record write. */
  function partiallyFailingAdapter(
    seed: readonly StoredAsset[],
    putsAllowed: number,
  ): { adapter: AssetAdapter; table: Map<string, StoredAsset> } {
    const table = new Map(seed.map((a) => [a.name, { ...a }]));
    let puts = 0;
    const adapter: AssetAdapter = {
      list: async () => [...table.values()].map((a) => ({ ...a })),
      get: async (name) => {
        const found = table.get(name);
        return found ? { ...found } : null;
      },
      put: async (asset) => {
        if (puts >= putsAllowed) throw new Error("simulated quota exceeded mid-write");
        puts++;
        table.set(asset.name, { ...asset });
      },
      rename: async () => {
        throw new Error("unused in this test");
      },
      delete: async (name) => {
        table.delete(name);
      },
    };
    return { adapter, table };
  }

  it("writes new records BEFORE deleting stale ones — a mid-write failure leaves the successful writes in place", async () => {
    const { adapter, table } = partiallyFailingAdapter([dragon], 1); // only the FIRST put succeeds
    const store = createAssetStore(adapter);
    await store.refresh();
    const wyrm: StoredAsset = { name: "wyrm", mime: "image/png", bytes: new Uint8Array([9]) };
    const imp2: StoredAsset = { name: "imp", mime: "image/png", bytes: new Uint8Array([8]) };
    await store.replaceAll([wyrm, imp2]); // "wyrm" writes, "imp" throws — no-op resolve, best-effort

    // The old record ("dragon") was NEVER deleted (deletes happen after all
    // puts, and the puts didn't all succeed) — nothing was destroyed.
    expect(table.has("dragon")).toBe(true);
    // The record that DID write before the failure survives too — write-
    // before-delete means a partial failure never nets out to "less than we
    // started with."
    expect(table.has("wyrm")).toBe(true);
    expect(table.has("imp")).toBe(false);
  });

  it("on failure, the cache is reconciled against the adapter's ACTUAL contents, not left stale", async () => {
    const { adapter, table } = partiallyFailingAdapter([dragon], 1);
    const store = createAssetStore(adapter);
    await store.refresh();
    const wyrm: StoredAsset = { name: "wyrm", mime: "image/png", bytes: new Uint8Array([9]) };
    const imp2: StoredAsset = { name: "imp", mime: "image/png", bytes: new Uint8Array([8]) };
    await store.replaceAll([wyrm, imp2]);

    expect(store.getSnapshot().disabled).toBe(true);
    // The cache must describe what's REALLY in storage (dragon + wyrm),
    // never the pre-call state (dragon only) and never the intended target
    // (wyrm + imp) — either of those would lie to the next reader.
    const cachedNames = new Set(store.getSnapshot().assets.map((a) => a.name));
    const storedNames = new Set([...table.keys()]);
    expect(cachedNames).toEqual(storedNames);
    expect(cachedNames).toEqual(new Set(["dragon", "wyrm"]));
  });
});

// ---------------------------------------------------------------------------
// M4 — clear()/replaceAll() enumerate the ADAPTER, never the cache
// ---------------------------------------------------------------------------

describe("clear()/replaceAll() act on real storage even when the cache is stale/empty (adversarial M4)", () => {
  it("clear() on a never-refreshed store still empties the adapter", async () => {
    const adapter = createInMemoryAssetAdapter([dragon, imp]);
    const store = createAssetStore(adapter); // never refresh()d — cache starts []
    expect(store.getSnapshot().assets).toEqual([]);
    await store.clear();
    expect(await adapter.list()).toEqual([]);
    expect(store.getAssetNames().size).toBe(0);
  });

  it("v1 project-file import (replaceAll([])) on a never-refreshed store still clears the adapter", async () => {
    const adapter = createInMemoryAssetAdapter([dragon, imp]);
    const store = createAssetStore(adapter); // never refresh()d
    await store.replaceAll([]); // what a v1 import does — §7.1b: replace with nothing
    expect(await adapter.list()).toEqual([]);
    expect(store.getAssetNames().size).toBe(0);
  });

  it("replaceAll with a non-overlapping library removes every old name and keeps only the new ones", async () => {
    const adapter = createInMemoryAssetAdapter([dragon, imp]); // never refresh()d
    const store = createAssetStore(adapter);
    const wyrm: StoredAsset = { name: "wyrm", mime: "image/png", bytes: new Uint8Array([9]) };
    await store.replaceAll([wyrm]);
    expect((await adapter.list()).map((a) => a.name).sort()).toEqual(["wyrm"]);
    expect(store.getAssetNames()).toEqual(new Set(["wyrm"]));
  });

  it("assets resurrecting after reload is exactly what this guards against: clear() then a fresh store's refresh() sees nothing", async () => {
    const adapter = createInMemoryAssetAdapter([dragon]);
    const firstSession = createAssetStore(adapter); // never refresh()d — simulates "opened, never listed"
    await firstSession.clear();
    const nextLoad = createAssetStore(adapter); // a fresh store, e.g. after a reload
    await nextLoad.refresh();
    expect(nextLoad.getAssetNames().size).toBe(0);
  });
});

describe("snapshot/name-set residuals from the fix-verification pass", () => {
  it("a no-op refresh() does not mint a new snapshot reference (C1's invariant)", async () => {
    const adapter = createInMemoryAssetAdapter([dragon]);
    const store = createAssetStore(adapter);
    await store.refresh();
    const settled = store.getSnapshot();
    await store.refresh(); // nothing changed in storage
    expect(store.getSnapshot()).toBe(settled);
  });

  it("a refresh() that DOES change the library still mints a new reference", async () => {
    const adapter = createInMemoryAssetAdapter([]);
    const store = createAssetStore(adapter);
    await store.refresh();
    const empty = store.getSnapshot();
    await adapter.put(dragon);
    await store.refresh();
    expect(store.getSnapshot()).not.toBe(empty);
  });

  it("getAssetNames() hands out a fresh set — one caller's mutation can't leak into another store", async () => {
    const enabled = createAssetStore(createInMemoryAssetAdapter([dragon]));
    await enabled.refresh();
    (enabled.getAssetNames() as Set<string>).add("poison");
    expect(enabled.getAssetNames().has("poison")).toBe(false);

    const disabledA = createAssetStore(createInMemoryAssetAdapter([]), true);
    const disabledB = createAssetStore(createInMemoryAssetAdapter([]), true);
    (disabledA.getAssetNames() as Set<string>).add("poison");
    expect(disabledB.getAssetNames().size).toBe(0);
  });

  it("rename() also falls back to the adapter on a cache miss (symmetry with remove(), m10)", async () => {
    const adapter = createInMemoryAssetAdapter([dragon]); // never refresh()d
    const store = createAssetStore(adapter);
    await expect(store.rename("dragon", "wyrm")).resolves.not.toThrow();
    expect((await adapter.list()).map((a) => a.name)).toEqual(["wyrm"]);
  });
});
