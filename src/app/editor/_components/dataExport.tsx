"use client";

/**
 * ◆48 CSV print-manifest export. Unlike project-file JSON (a backup of code
 * and editable rows), this is flattened generated output: exactly one CSV
 * record per RenderModel card instance, in preview/PDF order.
 */

import type { ReactElement } from "react";
import type { RenderModel } from "@/lib/lang";
import { editorStore } from "@/app/editor/_store/editorStore";

export const DATA_EXPORT_HEADERS = [
  "@card",
  "@sheet",
  "@row",
  "@card_number",
  "@project_card",
  "@copy",
] as const;

/** Same defensive filename cleanup as PDF/project export. */
export function dataExportFileName(model: RenderModel): string {
  if (model.decks.length !== 1) return "cardgoblin-data.csv";
  const cleaned = model.decks[0].cardName
    .replace(/[^\w-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? `${cleaned}.csv` : "cardgoblin-data.csv";
}

/** RFC 4180 field quoting: quote comma, quote, CR, or LF; double quotes. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface DataExport {
  filename: string;
  csv: string;
}

/** Pure model → CSV transformation, exported for exhaustive headless tests. */
export function buildDataExport(model: RenderModel): DataExport {
  const headers: string[] = [...DATA_EXPORT_HEADERS];
  const seen = new Set(headers);

  // Loop/data columns form a stable first-seen union across heterogeneous
  // Card blocks. `@` is illegal in Goblin identifiers, so provenance/loop
  // headers cannot collide with a physical or virtual column.
  for (const deck of model.decks) {
    for (const card of deck.cards) {
      for (const loopName of Object.keys(card.meta.loopBindings)) {
        const header = `@loop.${loopName}`;
        if (!seen.has(header)) {
          seen.add(header);
          headers.push(header);
        }
      }
      for (const name of Object.keys(card.exportData)) {
        if (!seen.has(name)) {
          seen.add(name);
          headers.push(name);
        }
      }
    }
  }

  const lines = [headers.map(csvField).join(",")];
  for (const deck of model.decks) {
    for (let cardIndex = 0; cardIndex < deck.cards.length; cardIndex++) {
      const card = deck.cards[cardIndex];
      const fields = new Map<string, string>([
        ["@card", deck.cardName],
        ["@sheet", deck.sheetName],
        ["@row", String(card.meta.rowIndex + 1)],
        ["@card_number", String(card.meta.deckCardIndex + 1)],
        ["@project_card", String(card.meta.projectCardIndex + 1)],
        ["@copy", String(card.meta.copyIndex + 1)],
      ]);
      for (const [name, binding] of Object.entries(card.meta.loopBindings)) {
        fields.set(`@loop.${name}`, binding.case);
      }
      for (const [name, value] of Object.entries(card.exportData)) {
        fields.set(name, value);
      }
      lines.push(headers.map((header) => csvField(fields.get(header) ?? "")).join(","));
    }
  }
  return { filename: dataExportFileName(model), csv: `${lines.join("\r\n")}\r\n` };
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Flush first so a click immediately after an edit exports the same last-good
 * model the preview/PDF surface owns, rather than waiting for the debounce. */
export function exportEditorData(): void {
  editorStore.getState().flushCompile();
  const model = editorStore.getState().lastGoodModel?.model;
  if (!model || model.decks.every((deck) => deck.cards.length === 0)) return;
  const output = buildDataExport(model);
  downloadCsv(output.csv, output.filename);
}

export function ExportDataButton({
  disabled,
  onExport,
}: {
  disabled: boolean;
  onExport(): void;
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onExport}
      title="Download one CSV row for every generated card instance"
      className="rounded border border-gray-700 px-1.5 text-gray-400 hover:border-gray-500 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Export Data
    </button>
  );
}
