"use client";

/**
 * Project file export/import (DESIGN.md §7.1, §7.1b — M3): the status bar's
 * "Export project" / "Import project" pair.
 *
 * **v2 (§7.1b, current export format):** `{version: 2, code, sheets, assets}`
 * — self-contained, art included. `assets` is `{name: {mime, bytes: base64}}`,
 * gathered from the Assets-drawer's IndexedDB library at export time.
 * **v1 compatibility:** files from before §7.1b (`{version: 1, code, sheets}`,
 * no `assets` key — the SAME shape persistence.ts's autosave slot still
 * writes) import forever; importing one CLEARS the asset library, consistent
 * with "import replaces the whole project" (there is nothing to carry over).
 * `parsePersisted`/`PERSIST_VERSION`/`sheetsToPersisted`/`parseSheetsPayload`
 * are REUSED from persistence.ts rather than duplicated — the v1 shape and
 * its validation rules are one source of truth; only the v2 envelope
 * (`assets`, `version: 2`) is new, owned here.
 *
 * Decisions beyond §7.1/§7.1b's literal text (each mirrored in the wiki page):
 * - Filename derives from the CURRENT compile's model (after a flush), not
 *   `lastGoodModel`: the payload is the current code + sheets, so the name
 *   should follow what the exported code declares. Broken code that yields no
 *   single deck falls back to the generic name — honest, and only cosmetic.
 * - Export/import are ASYNC (§7.1b, new): gathering asset bytes from
 *   IndexedDB (export) and replacing the library (import) are both
 *   inherently async, unlike the v1-only, purely-synchronous payload.
 * - Import commits via the store's `replaceProject`, deliberately NOT muted
 *   (contrast: persistence.ts resetToDemo): the attached autosave
 *   subscription sees the change and persists the imported project through
 *   the normal 1 s debounce, no edit needed (§7.1). The asset-library
 *   replacement (`assetStore.replaceAll`) is independent of that — assets
 *   live in IDB, not the localStorage autosave slot (§7.1b).
 * - Validation is strict and whole-file (§6.2's "no partial restores" rule,
 *   extended to `assets`): any bad asset entry (invalid name, non-string
 *   mime/bytes, bad base64, or over the 2 MB cap) invalidates the ENTIRE
 *   file, exactly like a bad sheet row does — never a partial import. File
 *   import has no quarantine (that's the autosave-restore-only posture,
 *   §6.2); an invalid file just leaves the current project (and library)
 *   untouched.
 * - The invalid-file error is an inline status-bar message (role="alert"),
 *   never a browser alert — same chrome rule as the reset confirm. It clears
 *   on the next pick.
 * - The file input is hidden and clicked from an ordinary button (keyboard
 *   accessible; display:none keeps it out of the tab order), and its value is
 *   reset per pick so re-choosing the same file fires `change` again.
 * - `initialError` / `initialPending` are test seams (no interaction driver
 *   in this project) so all three states render statically — the same pattern
 *   as ResetToDemoButton's `initialConfirming`.
 */

import { useRef, useState, type ReactElement } from "react";
import type { RenderModel } from "@/lib/lang";
import {
  editorStore,
  type EditorSeed,
  type SheetsState,
} from "@/app/editor/_store/editorStore";
import {
  isRecord,
  parsePersisted,
  parseSheetsPayload,
  PERSIST_VERSION,
  sheetsToPersisted,
} from "@/app/editor/_store/persistence";
import {
  ASSET_MAX_BYTES,
  assetStore,
  isImageMime,
  isValidAssetName,
  type AssetStore,
  type StoredAsset,
} from "@/app/editor/_store/assetStore";

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** §7.1: `cardgoblin-project.cardgoblin.json`, except a model with exactly one
 * Card block → `<deckname>.cardgoblin.json`. Same sanitization as the PDF's
 * `pdfFileName` (§6.1) — deck names are Goblin identifiers, so the regex only
 * fires on models built outside the compiler. */
export function projectFileName(model: RenderModel | null): string {
  const fallback = "cardgoblin-project.cardgoblin.json";
  if (model === null || model.decks.length !== 1) return fallback;
  const cleaned = model.decks[0].cardName.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? `${cleaned}.cardgoblin.json` : fallback;
}

/** The project-file format version (§7.1b) — distinct from persistence.ts's
 * `PERSIST_VERSION` (still 1: the autosave slot's shape never changed). A
 * file's `version` field says which shape to expect: 1 (no `assets`) or 2. */
export const PROJECT_FILE_VERSION = 2;

/** One asset entry inside a v2 file's `assets` object. */
interface PersistedAssetV2 {
  mime: string;
  bytes: string; // base64, pre-encoding size ≤ ASSET_MAX_BYTES
}

/** Byte-exact base64 encode, chunked to avoid `String.fromCharCode`'s
 * argument-count ceiling on large art (same technique as pdfRaster.tsx's
 * font-embedding encoder — independent copy, different data). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The inverse — null on anything `atob` rejects as not-base64. */
function base64ToBytes(base64: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function assetBytes(asset: StoredAsset): Promise<Uint8Array> {
  return asset.bytes instanceof Blob
    ? new Uint8Array(await asset.bytes.arrayBuffer())
    : asset.bytes;
}

/** The whole export (§7.1b: async — gathering asset bytes is): the v2
 * payload (code, sheets, base64 assets) plus the §7.1 filename. `assets`
 * comes from the caller already resolved to bytes (exportEditorProject reads
 * them from the asset store); this function just encodes and serializes. */
export async function buildProjectExport(
  code: string,
  sheets: SheetsState,
  model: RenderModel | null,
  assets: readonly StoredAsset[] = [],
): Promise<{ filename: string; json: string }> {
  const persistedAssets: Record<string, PersistedAssetV2> = {};
  for (const asset of assets) {
    persistedAssets[asset.name] = {
      mime: asset.mime,
      bytes: bytesToBase64(await assetBytes(asset)),
    };
  }
  const json = JSON.stringify({
    version: PROJECT_FILE_VERSION,
    code,
    sheets: sheetsToPersisted(sheets),
    assets: persistedAssets,
  });
  return { filename: projectFileName(model), json };
}

/** §7.1's one import error: validation is all-or-nothing (no partial
 * restores, §6.2 — extended to `assets`), so every invalid class gets the
 * same honest message. */
export const IMPORT_INVALID_MESSAGE =
  "Not a readable CardGoblin project file — nothing was imported.";

/** A parsed project file, ready to commit — `assets` is empty for a v1 file
 * (§7.1b: importing one clears the library; there is nothing to carry). */
export interface ParsedProjectFile {
  seed: EditorSeed;
  assets: StoredAsset[];
}

function parseAssetsPayload(raw: Record<string, unknown>): StoredAsset[] | null {
  const assets: StoredAsset[] = [];
  for (const [name, entry] of Object.entries(raw)) {
    if (!isValidAssetName(name)) return null;
    if (!isRecord(entry) || typeof entry.mime !== "string" || typeof entry.bytes !== "string") {
      return null;
    }
    // m8: same mime rule assetStore.upload enforces — a v2 file (hand-edited
    // or from a foreign tool) must not be able to smuggle a non-image asset
    // past import just because it skipped the drawer's upload path.
    if (!isImageMime(entry.mime)) return null;
    const bytes = base64ToBytes(entry.bytes);
    // The cap is enforced at upload time (assetStore.upload) — re-checking
    // it here keeps "every asset in the library is ≤ 2 MB" true for a
    // hand-edited or otherwise foreign file too, not just ones this app
    // produced.
    if (bytes === null || bytes.byteLength > ASSET_MAX_BYTES) return null;
    assets.push({ name, mime: entry.mime, bytes });
  }
  return assets;
}

function parseProjectFileV2(payload: Record<string, unknown>): ParsedProjectFile | null {
  if (typeof payload.code !== "string" || !isRecord(payload.sheets) || !isRecord(payload.assets)) {
    return null;
  }
  const sheets = parseSheetsPayload(payload.sheets);
  if (sheets === null) return null;
  const assets = parseAssetsPayload(payload.assets);
  if (assets === null) return null;
  return { seed: { code: payload.code, sheets }, assets };
}

/** Validate a picked file's text (§7.1b: v1 OR v2) → a store seed + assets,
 * or the inline error. Never throws, never touches the store. */
export function parseImportedProjectFile(raw: string): ParsedProjectFile | { error: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: IMPORT_INVALID_MESSAGE };
  }
  if (!isRecord(payload)) return { error: IMPORT_INVALID_MESSAGE };
  if (payload.version === PERSIST_VERSION) {
    // v1: the SAME shape/rules as the autosave slot — reuse verbatim rather
    // than re-implementing them (module note).
    const seed = parsePersisted(raw);
    return seed ? { seed, assets: [] } : { error: IMPORT_INVALID_MESSAGE };
  }
  if (payload.version === PROJECT_FILE_VERSION) {
    return parseProjectFileV2(payload) ?? { error: IMPORT_INVALID_MESSAGE };
  }
  return { error: IMPORT_INVALID_MESSAGE };
}

// ---------------------------------------------------------------------------
// Singleton-store actions (browser click handlers — same shape as
// persistence.ts's resetEditorToDemo)
// ---------------------------------------------------------------------------

/** Export is complete-or-fails, never silently partial (§7.4 amendment,
 * 2026-08-15): this file is billed as the user's backup, and importing one
 * REPLACES the whole asset library — so a v2 file downloaded with
 * `assets: {}` while the library holds art is deferred data loss, not a
 * backup. `runExport` surfaces this error's message verbatim. */
export class ExportAbortedError extends Error {}

export const EXPORT_ASSETS_UNREADABLE_MESSAGE =
  "Couldn't read your uploaded images — export aborted so you don't get a backup without them. Reload and try again.";

/** Every asset the snapshot lists, bytes resolved — complete or throw
 * (ExportAbortedError). `getBytes` answers null, never throws, BOTH for a
 * name that vanished mid-export and for a store an IDB failure just flipped
 * disabled — and the snapshot keeps its pre-disable meta list, so "listed
 * but unreadable" covers the whole-library-lost case, not just a rare race.
 * Any null for a listed asset therefore aborts the export; an empty library
 * resolves to `[]` and exports fine. The store is injectable for tests
 * (no IndexedDB in the headless suite). */
export async function collectExportAssets(
  store: Pick<AssetStore, "getSnapshot" | "getBytes"> = assetStore,
): Promise<StoredAsset[]> {
  const assets: StoredAsset[] = [];
  for (const meta of store.getSnapshot().assets) {
    const asset = await store.getBytes(meta.name);
    if (asset === null) throw new ExportAbortedError(EXPORT_ASSETS_UNREADABLE_MESSAGE);
    assets.push(asset);
  }
  return assets;
}

/** Download the CURRENT project, assets included. Flushes any pending
 * compile first so the filename's deck-count check matches the code being
 * exported. Rejects (via collectExportAssets) rather than downloading a
 * file missing any listed asset. */
export async function exportEditorProject(): Promise<void> {
  editorStore.getState().flushCompile();
  const { code, sheets, compile } = editorStore.getState();
  const assets = await collectExportAssets();
  const { filename, json } = await buildProjectExport(
    code,
    sheets,
    compile?.model ?? null,
    assets,
  );
  downloadJson(json, filename);
}

/** Commit a confirmed import. Deliberately NOT muted (module note): the
 * autosave subscription persists the imported project ~1 s later (§7.1).
 * The asset library is REPLACED too (§7.1b) — empty `assets` (a v1 file)
 * clears it, matching "import replaces the whole project". */
export function importEditorProject(seed: EditorSeed, assets: readonly StoredAsset[]): void {
  editorStore.getState().replaceProject(seed);
  void assetStore.replaceAll(assets);
}

/** Mirrors pdfExportModal's downloadPdf: blob URL + anchor click, with the
 * deferred revoke (synchronous revoking can cancel the download). */
function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

/** A parsed-but-unconfirmed import: the seed + assets wait behind the §7.1
 * two-step confirm, the filename names it in the question. */
export interface PendingImport extends ParsedProjectFile {
  filename: string;
}

export interface ProjectFileButtonsProps {
  /** §7.1b: async (gathering asset bytes) — a rejection is caught and shown
   * inline (adversarial m7), same surface as an invalid import. */
  onExport(): void | Promise<void>;
  onImport(seed: EditorSeed, assets: readonly StoredAsset[]): void;
  /** Test seam: render the inline error state statically. */
  initialError?: string | null;
  /** Test seam: render the armed confirm state statically. */
  initialPending?: PendingImport | null;
}

/** m7: the export path (async since §7.1b — gathering asset bytes from IDB
 * can fail) had no rejection handler, so a thrown/rejected `onExport` was an
 * unhandled promise rejection with no user-visible sign anything went wrong. */
export const EXPORT_FAILED_MESSAGE = "Export failed — nothing was downloaded.";

/** Pure form of the export button's rejection handling — exported so the
 * catch behavior is unit-testable without a click driver (this project has
 * none): resolves to `null` on success, an ExportAbortedError's own message
 * (it is written for the user), and `EXPORT_FAILED_MESSAGE` on any other
 * throw/rejection from `onExport`. */
export async function runExport(onExport: () => void | Promise<void>): Promise<string | null> {
  try {
    await onExport();
    return null;
  } catch (err) {
    return err instanceof ExportAbortedError ? err.message : EXPORT_FAILED_MESSAGE;
  }
}

const QUIET_BUTTON =
  "rounded border border-gray-700 px-1.5 text-gray-400 hover:border-gray-500 hover:text-gray-200";

/**
 * "Export project" / "Import project" for the status bar's right-hand group
 * (§7.1, §7.1b). Store-free — the connected StatusBar injects the singleton
 * actions above, tests inject spies. Import's destructive click is always
 * the second, differently colored one (same rule as ResetToDemoButton).
 */
export function ProjectFileButtons({
  onExport,
  onImport,
  initialError = null,
  initialPending = null,
}: ProjectFileButtonsProps): ReactElement {
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState<PendingImport | null>(initialPending);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File): Promise<void> => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      setPending(null);
      setError(IMPORT_INVALID_MESSAGE);
      return;
    }
    const parsed = parseImportedProjectFile(text);
    if ("error" in parsed) {
      setPending(null);
      setError(parsed.error);
    } else {
      setError(null);
      setPending({ ...parsed, filename: file.name });
    }
  };

  // m7 (adversarial): `onExport` is async (§7.1b gathers asset bytes from
  // IDB, which can fail) — awaiting it here, instead of firing it straight
  // off `onClick`, turns a rejection into the SAME inline `role="alert"`
  // surface an invalid import already uses, rather than an unhandled
  // promise rejection with no visible sign anything went wrong.
  const handleExport = async (): Promise<void> => {
    setError(await runExport(onExport));
  };

  if (pending !== null) {
    return (
      // flex-wrap (adversarial review item 2): the answer buttons of an
      // armed confirm must never clip out of the status bar — a long
      // filename here (a real, user-supplied string) can no longer push
      // Import/Keep out of view; it wraps onto another line instead.
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-amber-400">
          Replace your project (and your uploaded assets) with “{pending.filename}”?
        </span>
        <button
          type="button"
          onClick={() => {
            setPending(null);
            onImport(pending.seed, pending.assets);
          }}
          className="rounded border border-red-900 px-1.5 text-red-400 hover:border-red-500 hover:text-red-300"
        >
          Import
        </button>
        <button type="button" onClick={() => setPending(null)} className={QUIET_BUTTON}>
          Keep
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {error !== null && (
        <span role="alert" className="text-red-400">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={() => void handleExport()}
        title="Download this project (and its assets) as a .cardgoblin.json file"
        className={QUIET_BUTTON}
      >
        Export project
      </button>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title="Load a .cardgoblin.json file, replacing this project and its assets"
        className={QUIET_BUTTON}
      >
        Import project
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Reset per pick (module note) BEFORE the async read detaches us
          // from the pooled event.
          event.currentTarget.value = "";
          if (file !== undefined) void handleFile(file);
        }}
      />
    </span>
  );
}
