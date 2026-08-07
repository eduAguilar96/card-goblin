"use client";

/**
 * PDF export — modal + Export button (DESIGN.md §6.1, M2).
 *
 * `ExportPdfButton` (default export) lives in the PREVIEW TOOLBAR (documented
 * choice: export prints what the preview shows — "what you see is what
 * prints" — and the status bar is a passive readout; the toolbar already
 * holds the preview's active controls). It is disabled until a good model
 * with at least one card exists.
 *
 * `PdfExportModal` shows exactly the §6.1 options with the §6.1 defaults,
 * recomputes the pure layout live (fit errors and the skip warning update as
 * options change), PREVIEWS the resulting pages beside the options
 * (pdfPagePreview.tsx — same layout result, same card markup as the export),
 * and runs the export: rasterize distinct faces → assemble with pdf-lib →
 * download. The rasterizer is INJECTED (`rasterize` prop, defaulting to the
 * real browser one) so node tests can drive the modal and the flow with stub
 * images.
 *
 * Decisions beyond §6.1's literal text:
 * - Options persist for the SESSION in a module-level object (simplest
 *   correct scope: survives modal close/reopen and panel remounts, resets on
 *   reload; no store churn for print-only preferences). Invalid margin/
 *   spacing text is never persisted.
 * - The previewed page index is NOT persisted and is clamped at render
 *   (pager.clampIndex): options change the page count under it — switching
 *   backs to "none" halves it — and the browsing position should survive
 *   that rather than reset on every keystroke.
 * - Export is also disabled when nothing is printable (every card an error
 *   placeholder / zero cards after skipping) — a zero-page PDF helps nobody.
 * - Margin/spacing accept any finite value ≥ 0; validation failures disable
 *   Export rather than clamping silently.
 * - Filename: single-deck models download as `<deckname>.pdf` (sanitized),
 *   anything else as `cardgoblin.pdf` (spec).
 */

import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { RenderModel } from "@/lib/lang";
import {
  useEditorStore,
  type LastGoodModel,
} from "@/app/editor/_store/editorStore";
import {
  DEFAULT_PDF_OPTIONS,
  PAGE_SIZES,
  layoutPdf,
  type BacksMode,
  type GuideStyle,
  type PageSizeId,
  type PdfExportOptions,
} from "@/app/editor/_components/pdfLayout";
import { assemblePdf } from "@/app/editor/_components/pdfAssemble";
import { PdfPagePreview } from "@/app/editor/_components/pdfPagePreview";
import { rasterizeFaces, type RasterizeFaces } from "@/app/editor/_components/pdfRaster";
import { Pager, clampIndex } from "@/app/editor/_components/pager";

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** §6.1: `cardgoblin.pdf`, except single-deck models → `<deckname>.pdf`.
 * Sanitized to a portable filename; a name with nothing usable falls back. */
export function pdfFileName(model: RenderModel): string {
  if (model.decks.length !== 1) return "cardgoblin.pdf";
  const cleaned = model.decks[0].cardName.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? `${cleaned}.pdf` : "cardgoblin.pdf";
}

/** Finite, ≥ 0, non-empty — else null (Export disables; nothing is clamped
 * behind the user's back). */
export function parseNonNegativeMm(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Session persistence (module note above)
// ---------------------------------------------------------------------------

let sessionOptions: PdfExportOptions = { ...DEFAULT_PDF_OPTIONS };

/** Test hook: reset the session memory to the §6.1 defaults. */
export function resetSessionPdfOptions(): void {
  sessionOptions = { ...DEFAULT_PDF_OPTIONS };
}

// ---------------------------------------------------------------------------
// Browser download
// ---------------------------------------------------------------------------

function downloadPdf(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Deferred revoke: revoking synchronously can cancel the download in some
  // engines; one minute is far past any click-to-fetch window.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

const GUIDE_LABELS: Record<GuideStyle, string> = {
  off: "Off",
  dotted: "Dotted",
  red: "Red",
  bold: "Bold",
};

/** §6.1 lists cut lines as dotted/off/red/bold and crosses as off/dotted/
 * red/bold — same vocabulary, default listed first. */
const CUT_LINE_CHOICES: readonly GuideStyle[] = ["dotted", "off", "red", "bold"];
const CROSS_MARK_CHOICES: readonly GuideStyle[] = ["off", "dotted", "red", "bold"];

const BACKS_LABELS: Record<BacksMode, string> = {
  duplex: "Duplex (backs interleaved, mirrored)",
  separate: "Separate (all backs after all fronts)",
  none: "None (fronts only)",
};
const BACKS_CHOICES: readonly BacksMode[] = ["duplex", "separate", "none"];

const FIELD_CLASS =
  "w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-200";
const LABEL_CLASS = "flex flex-col gap-1 text-xs text-gray-400";

export interface PdfExportModalProps {
  model: RenderModel;
  onClose(): void;
  /** Injection seam for tests (default: the real browser rasterizer). */
  rasterize?: RasterizeFaces;
}

export function PdfExportModal({
  model,
  onClose,
  rasterize = rasterizeFaces,
}: PdfExportModalProps): ReactElement {
  const [options, setOptions] = useState<PdfExportOptions>(() => ({ ...sessionOptions }));
  const [marginText, setMarginText] = useState(() => String(sessionOptions.marginMm));
  const [spacingText, setSpacingText] = useState(() => String(sessionOptions.spacingMm));
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** Previewed page. Clamped at render, never in state (module note). */
  const [pageIndex, setPageIndex] = useState(0);

  const update = (patch: Partial<PdfExportOptions>): void => {
    setOptions((prev) => {
      const next = { ...prev, ...patch };
      sessionOptions = { ...next }; // session persistence (module note)
      return next;
    });
  };

  const marginValid = parseNonNegativeMm(marginText) !== null;
  const spacingValid = parseNonNegativeMm(spacingText) !== null;

  const layout = useMemo(() => layoutPdf(model, options), [model, options]);
  const previewIndex = clampIndex(pageIndex, layout.pages.length);
  const previewPage = layout.pages[previewIndex];

  const exportBlocked =
    working ||
    !marginValid ||
    !spacingValid ||
    layout.fitErrors.length > 0 ||
    layout.placedCards === 0;

  const handleExport = async (): Promise<void> => {
    setWorking(true);
    setFailure(null);
    try {
      const images = await rasterize(layout.faceSpecs);
      const bytes = await assemblePdf(layout, images, options);
      downloadPdf(bytes, pdfFileName(model));
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setWorking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-export-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 p-4 text-sm text-gray-200 shadow-xl"
      >
        <h2 id="pdf-export-title" className="mb-3 text-base font-semibold text-white">
          Export PDF
        </h2>

        {/* Options and preview side by side on a wide screen, stacked below
            it (the preview is the reason this modal is wide). */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="md:w-[26rem] md:shrink-0">
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL_CLASS}>
                Page size
                <select
                  className={FIELD_CLASS}
                  value={options.pageSize}
                  disabled={working}
                  onChange={(e) => update({ pageSize: e.currentTarget.value as PageSizeId })}
                >
                  {(Object.keys(PAGE_SIZES) as PageSizeId[]).map((id) => (
                    <option key={id} value={id}>
                      {PAGE_SIZES[id].name} ({PAGE_SIZES[id].widthMm} × {PAGE_SIZES[id].heightMm}{" "}
                      mm)
                    </option>
                  ))}
                </select>
              </label>

              <label className={LABEL_CLASS}>
                Backs
                <select
                  className={FIELD_CLASS}
                  value={options.backs}
                  disabled={working}
                  onChange={(e) => update({ backs: e.currentTarget.value as BacksMode })}
                >
                  {BACKS_CHOICES.map((mode) => (
                    <option key={mode} value={mode}>
                      {BACKS_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </label>

              <label className={LABEL_CLASS}>
                Outer margin (mm)
                <input
                  type="number"
                  min={0}
                  step={1}
                  className={FIELD_CLASS + (marginValid ? "" : " border-red-500")}
                  value={marginText}
                  disabled={working}
                  onChange={(e) => {
                    const text = e.currentTarget.value;
                    setMarginText(text);
                    const value = parseNonNegativeMm(text);
                    if (value !== null) update({ marginMm: value });
                  }}
                />
              </label>

              <label className={LABEL_CLASS}>
                Card spacing (mm)
                <input
                  type="number"
                  min={0}
                  step={1}
                  className={FIELD_CLASS + (spacingValid ? "" : " border-red-500")}
                  value={spacingText}
                  disabled={working}
                  onChange={(e) => {
                    const text = e.currentTarget.value;
                    setSpacingText(text);
                    const value = parseNonNegativeMm(text);
                    if (value !== null) update({ spacingMm: value });
                  }}
                />
              </label>

              <label className={LABEL_CLASS}>
                Cut lines
                <select
                  className={FIELD_CLASS}
                  value={options.cutLines}
                  disabled={working}
                  onChange={(e) => update({ cutLines: e.currentTarget.value as GuideStyle })}
                >
                  {CUT_LINE_CHOICES.map((style) => (
                    <option key={style} value={style}>
                      {GUIDE_LABELS[style]}
                    </option>
                  ))}
                </select>
              </label>

              <label className={LABEL_CLASS}>
                Cross marks
                <select
                  className={FIELD_CLASS}
                  value={options.crossMarks}
                  disabled={working}
                  onChange={(e) => update({ crossMarks: e.currentTarget.value as GuideStyle })}
                >
                  {CROSS_MARK_CHOICES.map((style) => (
                    <option key={style} value={style}>
                      {GUIDE_LABELS[style]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <Notices layout={layout} marginValid={marginValid} spacingValid={spacingValid} />

            {failure !== null && (
              <p className="mt-3 rounded border border-red-900 bg-red-950 px-2 py-1 text-xs text-red-300">
                Export failed: {failure}
              </p>
            )}
          </div>

          {/* Live page preview: the same layout result the export consumes, so
              every option above is visible here before anyone spends a render
              on a PDF (§6.1 †). */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-gray-400">
                {previewPage === undefined ? (
                  "Nothing to preview"
                ) : (
                  <>
                    <span className="font-semibold text-gray-200">
                      {previewPage.deckName}
                    </span>
                    {" · "}
                    {previewPage.side === "front" ? "Front" : "Back"}
                    {" · "}
                    {previewPage.cards.length} card
                    {previewPage.cards.length === 1 ? "" : "s"}
                  </>
                )}
              </span>
              {layout.pages.length > 0 && (
                <Pager
                  index={previewIndex}
                  count={layout.pages.length}
                  onChange={setPageIndex}
                  previousLabel="Previous page"
                  nextLabel="Next page"
                />
              )}
            </div>
            <div className="flex h-96 items-center justify-center rounded border border-gray-700 bg-gray-900 p-3">
              {previewPage === undefined ? (
                <p className="text-xs text-gray-500">
                  No pages to lay out — see the messages on the left.
                </p>
              ) : (
                <PdfPagePreview
                  page={previewPage}
                  faceSpecs={layout.faceSpecs}
                  cutLines={options.cutLines}
                  crossMarks={options.crossMarks}
                />
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          {working && (
            <span className="mr-auto text-xs text-gray-400" role="status">
              Rendering {layout.faceSpecs.size} card face
              {layout.faceSpecs.size === 1 ? "" : "s"}…
            </span>
          )}
          <button
            type="button"
            disabled={working}
            onClick={onClose}
            className="rounded border border-gray-600 bg-gray-800 px-3 py-1 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={exportBlocked}
            onClick={() => void handleExport()}
            className="rounded border border-gray-500 bg-gray-600 px-3 py-1 font-semibold text-white hover:bg-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {working ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The §6.1 modal notices: the error-skip warning and the card-doesn't-fit
 * error(s), plus the nothing-printable state. */
function Notices({
  layout,
  marginValid,
  spacingValid,
}: {
  layout: ReturnType<typeof layoutPdf>;
  marginValid: boolean;
  spacingValid: boolean;
}): ReactElement | null {
  const notes: ReactNode[] = [];

  if (layout.skippedErrorCards > 0) {
    notes.push(
      <p
        key="skip"
        className="rounded border border-amber-900 bg-amber-950 px-2 py-1 text-xs text-amber-300"
      >
        {layout.skippedErrorCards} card{layout.skippedErrorCards === 1 ? "" : "s"} with
        errors will be skipped.
      </p>,
    );
  }

  for (const fit of layout.fitErrors) {
    notes.push(
      <p
        key={`fit-${fit.deckIndex}`}
        className="rounded border border-red-900 bg-red-950 px-2 py-1 text-xs text-red-300"
      >
        “{fit.deckName}” cards ({fit.cardWidthMm} × {fit.cardHeightMm} mm) don’t fit on the
        page inside these margins — reduce the margin/spacing or choose a larger page.
      </p>,
    );
  }

  if (
    marginValid &&
    spacingValid &&
    layout.fitErrors.length === 0 &&
    layout.placedCards === 0
  ) {
    notes.push(
      <p
        key="empty"
        className="rounded border border-red-900 bg-red-950 px-2 py-1 text-xs text-red-300"
      >
        Nothing to export — every card is an error placeholder.
      </p>,
    );
  }

  if (notes.length === 0) return null;
  return <div className="mt-3 flex flex-col gap-2">{notes}</div>;
}

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------

export interface ExportPdfButtonContentProps {
  lastGood: LastGoodModel | null;
  rasterize?: RasterizeFaces;
}

/** The store-free button + modal pair (exported for markup tests, same split
 * as the other windows). Disabled until a good model with ≥1 card exists
 * (§6.1 trigger; error placeholders still count as cards here — the modal
 * owns the "everything is skipped" message). */
export function ExportPdfButtonContent({
  lastGood,
  rasterize,
}: ExportPdfButtonContentProps): ReactElement {
  const [open, setOpen] = useState(false);
  const totalCards =
    lastGood?.model.decks.reduce((n, deck) => n + deck.cards.length, 0) ?? 0;
  const disabled = lastGood === null || totalCards === 0;
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={disabled ? "Nothing to export yet" : "Export the deck as a print PDF"}
        className="rounded border border-gray-600 bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Export PDF
      </button>
      {open && lastGood !== null && (
        <PdfExportModal
          model={lastGood.model}
          onClose={() => setOpen(false)}
          {...(rasterize ? { rasterize } : {})}
        />
      )}
    </>
  );
}

/** Store-connected wrapper — reads `lastGoodModel` ONLY (keep-last-good:
 * export always prints what the preview shows, never a broken compile). */
export default function ExportPdfButton(): ReactElement {
  const lastGood = useEditorStore((s) => s.lastGoodModel);
  return <ExportPdfButtonContent lastGood={lastGood} />;
}
