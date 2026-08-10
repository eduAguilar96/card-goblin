"use client";

/**
 * Project file export/import (DESIGN.md §7.1, M3): the status bar's
 * "Export project" / "Import project" pair, downloading and reading the SAME
 * versioned payload autosave persists — `serializeProject` out,
 * `parsePersisted` back in. One format, one validator; a file this module
 * writes is byte-for-byte a valid autosave slot and vice versa.
 *
 * Decisions beyond §7.1's literal text (each mirrored in the wiki page):
 * - Filename derives from the CURRENT compile's model (after a flush), not
 *   `lastGoodModel`: the payload is the current code + sheets, so the name
 *   should follow what the exported code declares. Broken code that yields no
 *   single deck falls back to the generic name — honest, and only cosmetic.
 * - Import commits via the store's `replaceProject`, deliberately NOT muted
 *   (contrast: persistence.ts resetToDemo): the attached autosave
 *   subscription sees the change and persists the imported project through
 *   the normal 1 s debounce, no edit needed (§7.1).
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
import { parsePersisted, serializeProject } from "@/app/editor/_store/persistence";

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

/** The whole export, pure: the §6.2 autosave payload plus its §7.1 filename. */
export function buildProjectExport(
  code: string,
  sheets: SheetsState,
  model: RenderModel | null,
): { filename: string; json: string } {
  return { filename: projectFileName(model), json: serializeProject(code, sheets) };
}

/** §7.1's one import error: `parsePersisted` is all-or-nothing (no partial
 * restores, §6.2), so every invalid class gets the same honest message. */
export const IMPORT_INVALID_MESSAGE =
  "Not a readable CardGoblin project file — nothing was imported.";

/** Validate a picked file's text with the autosave rules → a store seed, or
 * the inline error. Never throws, never touches the store. */
export function parseImportedProject(raw: string): { seed: EditorSeed } | { error: string } {
  const seed = parsePersisted(raw);
  return seed === null ? { error: IMPORT_INVALID_MESSAGE } : { seed };
}

// ---------------------------------------------------------------------------
// Singleton-store actions (browser click handlers — same shape as
// persistence.ts's resetEditorToDemo)
// ---------------------------------------------------------------------------

/** Download the CURRENT project. Flushes any pending compile first so the
 * filename's deck-count check matches the code being exported. */
export function exportEditorProject(): void {
  editorStore.getState().flushCompile();
  const { code, sheets, compile } = editorStore.getState();
  const { filename, json } = buildProjectExport(code, sheets, compile?.model ?? null);
  downloadJson(json, filename);
}

/** Commit a confirmed import. Deliberately NOT muted (module note): the
 * autosave subscription persists the imported project ~1 s later (§7.1). */
export function importEditorProject(seed: EditorSeed): void {
  editorStore.getState().replaceProject(seed);
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

/** A parsed-but-unconfirmed import: the seed waits behind the §7.1 two-step
 * confirm, the filename names it in the question. */
export interface PendingImport {
  seed: EditorSeed;
  filename: string;
}

export interface ProjectFileButtonsProps {
  onExport(): void;
  onImport(seed: EditorSeed): void;
  /** Test seam: render the inline error state statically. */
  initialError?: string | null;
  /** Test seam: render the armed confirm state statically. */
  initialPending?: PendingImport | null;
}

const QUIET_BUTTON =
  "rounded border border-gray-700 px-1.5 text-gray-400 hover:border-gray-500 hover:text-gray-200";

/**
 * "Export project" / "Import project" for the status bar's right-hand group
 * (§7.1). Store-free — the connected StatusBar injects the singleton actions
 * above, tests inject spies. Import's destructive click is always the second,
 * differently colored one (same rule as ResetToDemoButton).
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
    const parsed = parseImportedProject(text);
    if ("error" in parsed) {
      setPending(null);
      setError(parsed.error);
    } else {
      setError(null);
      setPending({ seed: parsed.seed, filename: file.name });
    }
  };

  if (pending !== null) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-amber-400">
          Replace your project with “{pending.filename}”?
        </span>
        <button
          type="button"
          onClick={() => {
            setPending(null);
            onImport(pending.seed);
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
    <span className="flex items-center gap-1.5">
      {error !== null && (
        <span role="alert" className="text-red-400">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={onExport}
        title="Download this project as a .cardgoblin.json file"
        className={QUIET_BUTTON}
      >
        Export project
      </button>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title="Load a .cardgoblin.json file, replacing this project"
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
