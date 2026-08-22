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
 * - Image pre-flight (§3.3 M2): the spec wants "N images could not be
 *   embedded" warned BEFORE export, so a lightweight probe of the export's
 *   image URLs runs when the modal opens (injectable `resolveImages` seam;
 *   per-URL cache makes reopening free). Export is held until the probe
 *   settles, failures only warn, and the resolved data URIs are handed to
 *   the rasterizer so the warning describes exactly the produced PDF.
 * - Filename: single-deck models download as `<deckname>.pdf` (sanitized),
 *   anything else as `cardgoblin.pdf` (spec).
 * - Dialog a11y, dependency-free: role="dialog" aria-modal, the dialog takes
 *   focus on open, Tab wraps at its ends, and Escape / a backdrop click close
 *   it — except while an export is running (same rule as the Cancel button;
 *   losing a render mid-flight to a stray click helps nobody). Static tests
 *   cover the roles/attributes; the focus/keyboard behavior itself has no
 *   driver here and is on the manual browser checklist.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
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
import {
  assemblePdf,
  type AssemblePdfProgress,
} from "@/app/editor/_components/pdfAssemble";
import { focusableElementsIn } from "@/app/editor/_components/dialogFocusTrap";
import { PdfPagePreview } from "@/app/editor/_components/pdfPagePreview";
import type { ResolvedImage } from "@/app/editor/_components/cardSvg";
import {
  imageUrlsUsed,
  rasterizeFaces,
  remoteImageUrlsUsed,
  resolveImageSources,
  type RasterizeFaces,
  type ResolveImages,
} from "@/app/editor/_components/pdfRaster";
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

/** The margin/spacing inline validation message (adversarial review item 7):
 * an invalid field used to signal ONLY via a red border — nothing named the
 * problem, and nothing told a screen-reader user the field was invalid at
 * all. Both fields share this exact rule (parseNonNegativeMm above), so one
 * message serves both; each field's own label sits right above it. */
export const INVALID_MM_MESSAGE = "Enter a number ≥ 0.";

/** §3.3 (M2): the pre-export image warning, worded per the spec ("N images
 * could not be embedded"). Warning only — the deck always exports, with the
 * failures as marked placeholder boxes. */
export function imageEmbedWarning(count: number): string {
  return count === 1
    ? "1 image could not be embedded — it will print as a marked placeholder box."
    : `${count} images could not be embedded — they will print as marked placeholder boxes.`;
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
  /** Injection seam for tests (default: the real browser image loader). */
  resolveImages?: ResolveImages;
  /** Test seams (no interaction driver in this project, same pattern as
   * ResetToDemoButton's `initialConfirming`): seed the margin/spacing text
   * fields and the failure banner so their states render statically instead
   * of needing a simulated typing/click flow. */
  initialMarginText?: string;
  initialSpacingText?: string;
  initialFailure?: string | null;
  /** Static-render test seam for the in-flight progress UI. */
  initialProgress?: PdfExportProgress | null;
}

export interface PdfExportProgress {
  completed: number;
  total: number;
  label: string;
}

export function PdfExportModal({
  model,
  onClose,
  rasterize = rasterizeFaces,
  resolveImages = resolveImageSources,
  initialMarginText,
  initialSpacingText,
  initialFailure = null,
  initialProgress = null,
}: PdfExportModalProps): ReactElement {
  const [options, setOptions] = useState<PdfExportOptions>(() => ({ ...sessionOptions }));
  const [marginText, setMarginText] = useState(
    () => initialMarginText ?? String(sessionOptions.marginMm),
  );
  const [spacingText, setSpacingText] = useState(
    () => initialSpacingText ?? String(sessionOptions.spacingMm),
  );
  const [working, setWorking] = useState(initialProgress !== null);
  const [progress, setProgress] = useState<PdfExportProgress | null>(initialProgress);
  const [failure, setFailure] = useState<string | null>(initialFailure);
  /** Previewed page. Clamped at render, never in state (module note). */
  const [pageIndex, setPageIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the dialog on open (tabIndex −1 makes it focusable) so keyboard
  // users land inside it and Escape works immediately. Effects never run in
  // renderToStaticMarkup — behavior is on the manual browser checklist.
  // Capture the opener BEFORE moving focus in, and restore it on close
  // (adversarial review item 5) — every close path (Escape, backdrop,
  // Cancel, a successful export) unmounts this component the same way, so
  // one cleanup covers all of them.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => opener?.focus();
  }, []);

  /** Escape closes; Tab wraps at the dialog's ends (minimal focus trap over
   * the modal's own controls — no dependency, no portal). Closing is blocked
   * while exporting, matching the Cancel button. */
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!working) onClose();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    // dialogFocusTrap.ts (item 5, shared with assetsDrawer.tsx): filters the
    // selector's matches down to elements a real Tab press can reach, so a
    // future non-visible control here can't silently break Tab wrapping the
    // way assetsDrawer's hidden file input did.
    const focusable = focusableElementsIn(dialogRef.current);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const update = (patch: Partial<PdfExportOptions>): void => {
    setOptions((prev) => ({ ...prev, ...patch }));
    // Session persistence (module note) — OUTSIDE the state updater, which
    // React expects to be pure (StrictMode re-invokes it). `options` started
    // as a copy of `sessionOptions` and both receive every patch, so the two
    // never drift.
    sessionOptions = { ...sessionOptions, ...patch };
  };

  const marginValid = parseNonNegativeMm(marginText) !== null;
  const spacingValid = parseNonNegativeMm(spacingText) !== null;

  const layout = useMemo(() => layoutPdf(model, options), [model, options]);
  const previewIndex = clampIndex(pageIndex, layout.pages.length);
  const previewPage = layout.pages[previewIndex];

  // PRE-FLIGHT image check (§3.3 M2; §7.1b): the spec's "N images could not
  // be embedded" warning must appear BEFORE export, so the exported faces'
  // image sources are probed when the modal opens (and when the option-
  // dependent set changes — e.g. backs: none drops the back faces' images).
  // Export is held until the probe settles; failures only WARN — the deck
  // always exports, with failed images as marked placeholder boxes. The key
  // is JSON (sources come from cell data and could contain any character),
  // and the resolved map remembers which key it answered so an in-flight
  // option change can never pair stale results with a new source set.
  //
  // resolveImages(urls) still receives the FULL set — `asset:` sources
  // included — because `resolveImageSources` (its real implementation) is
  // what actually resolves them (from the IndexedDB library to a data URI)
  // and their failures must still count toward "N images could not be
  // embedded" and toward the rasterizer's image map. `remoteImageUrlsUsed`
  // (§7.1b) instead governs the "Checking N images…" WORDING specifically:
  // that message describes a network-sensitive CORS check, which is only
  // true of remote URLs — an uploaded asset resolves from local IDB bytes,
  // never touches the network, and so was never part of "the CORS pre-
  // flight" this notice names (adversarial M2 — a test pins this).
  const imageUrlsKey = useMemo(
    () => JSON.stringify(imageUrlsUsed(layout.faceSpecs)),
    [layout.faceSpecs],
  );
  const remoteImageCount = useMemo(
    () => remoteImageUrlsUsed(layout.faceSpecs).length,
    [layout.faceSpecs],
  );
  const [resolvedImages, setResolvedImages] = useState<{
    key: string;
    images: Map<string, ResolvedImage | null>;
  } | null>(null);
  useEffect(() => {
    const urls = JSON.parse(imageUrlsKey) as string[];
    if (urls.length === 0) return; // nothing to probe; readiness is immediate
    let cancelled = false;
    void resolveImages(urls).then((images) => {
      if (!cancelled) setResolvedImages({ key: imageUrlsKey, images });
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrlsKey, resolveImages]);

  const imageUrls = JSON.parse(imageUrlsKey) as string[];
  const imagesReady =
    imageUrls.length === 0 ||
    (resolvedImages !== null && resolvedImages.key === imageUrlsKey);
  const failedImages = imagesReady
    ? imageUrls.filter((url) => resolvedImages?.images.get(url) == null).length
    : 0;

  const exportBlocked =
    working ||
    !marginValid ||
    !spacingValid ||
    !imagesReady ||
    layout.fitErrors.length > 0 ||
    layout.placedCards === 0;

  const handleExport = async (): Promise<void> => {
    const faceCount = layout.faceSpecs.size;
    const pageCount = layout.pages.length;
    const totalWork = Math.max(1, faceCount * 2 + pageCount + 1);
    const reportAssemblyProgress = (next: AssemblePdfProgress): void => {
      if (next.phase === "embedding") {
        setProgress({
          completed: faceCount + next.completed,
          total: totalWork,
          label: `Embedding card faces ${next.completed} of ${next.total}…`,
        });
      } else if (next.phase === "pages") {
        setProgress({
          completed: faceCount * 2 + next.completed,
          total: totalWork,
          label: `Building PDF pages ${next.completed} of ${next.total}…`,
        });
      } else {
        setProgress({
          completed: faceCount * 2 + pageCount + next.completed,
          total: totalWork,
          label: next.completed === 0 ? "Finalizing PDF…" : "PDF ready",
        });
      }
    };

    setWorking(true);
    setFailure(null);
    setProgress({
      completed: 0,
      total: totalWork,
      label: `Preparing ${faceCount} card face${faceCount === 1 ? "" : "s"}…`,
    });
    try {
      const images = await rasterize(
        layout.faceSpecs,
        imagesReady && resolvedImages !== null ? resolvedImages.images : undefined,
        (next) => {
          setProgress({
            completed: next.completed,
            total: totalWork,
            label: `Rendering card faces ${next.completed} of ${next.total}…`,
          });
        },
      );
      // An injected rasterizer used by tests/integrators may omit callbacks;
      // establish the completed boundary before assembly in either case.
      setProgress({
        completed: faceCount,
        total: totalWork,
        label: `Rendered ${faceCount} card face${faceCount === 1 ? "" : "s"}.`,
      });
      const bytes = await assemblePdf(layout, images, options, reportAssemblyProgress);
      downloadPdf(bytes, pdfFileName(model));
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setWorking(false);
      setProgress(null);
    }
  };

  return (
    <div
      // `whitespace-normal`: prophylactic, same reason as assetsDrawer's —
      // an overlay mounted under a `whitespace-nowrap` ancestor inherits it
      // through the DOM (fixed positioning does not break inheritance).
      className="fixed inset-0 z-50 flex items-center justify-center whitespace-normal bg-black/60 p-4"
      role="presentation"
      // Backdrop click closes; clicks inside the dialog bubble here with a
      // different target, so only true backdrop hits pass the guard.
      onClick={(event) => {
        if (event.target === event.currentTarget && !working) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-export-title"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 p-4 text-sm text-gray-200 shadow-xl outline-none"
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
                  aria-invalid={!marginValid}
                  aria-describedby={marginValid ? undefined : "pdf-margin-error"}
                  onChange={(e) => {
                    const text = e.currentTarget.value;
                    setMarginText(text);
                    const value = parseNonNegativeMm(text);
                    if (value !== null) update({ marginMm: value });
                  }}
                />
                {/* item 7: a red border alone names nothing to a sighted
                    user and nothing at all to a screen reader. */}
                {!marginValid && (
                  <span id="pdf-margin-error" role="alert" className="text-red-400">
                    {INVALID_MM_MESSAGE}
                  </span>
                )}
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
                  aria-invalid={!spacingValid}
                  aria-describedby={spacingValid ? undefined : "pdf-spacing-error"}
                  onChange={(e) => {
                    const text = e.currentTarget.value;
                    setSpacingText(text);
                    const value = parseNonNegativeMm(text);
                    if (value !== null) update({ spacingMm: value });
                  }}
                />
                {!spacingValid && (
                  <span id="pdf-spacing-error" role="alert" className="text-red-400">
                    {INVALID_MM_MESSAGE}
                  </span>
                )}
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

              <label className="col-span-2 flex items-center gap-2 rounded border border-gray-700 bg-gray-900 px-2 py-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={options.pageNumbers}
                  disabled={working}
                  onChange={(e) => update({ pageNumbers: e.currentTarget.checked })}
                  className="accent-gray-400"
                />
                Print page numbers
              </label>
            </div>

            <Notices
              layout={layout}
              marginValid={marginValid}
              spacingValid={spacingValid}
              checkingImages={!imagesReady ? remoteImageCount : 0}
              failedImages={failedImages}
            />

            {failure !== null && (
              // item 6: progress has role="status"; failure had no role at
              // all, so an assistive-tech user got no announcement that the
              // export had failed — only the (silent) disappearance of the
              // "Exporting…" status text.
              <p
                role="alert"
                className="mt-3 rounded border border-red-900 bg-red-950 px-2 py-1 text-xs text-red-300"
              >
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
                  pageNumbers={options.pageNumbers}
                  sheetCount={layout.sheetCount}
                />
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          {working && progress !== null && (
            <div className="mr-auto min-w-0 max-w-sm flex-1 text-xs text-gray-400">
              <div className="mb-1 flex items-center justify-between gap-3" aria-live="polite">
                <span className="truncate" role="status">
                  {progress.label}
                </span>
                <span className="shrink-0 tabular-nums">
                  {Math.round((progress.completed / progress.total) * 100)}%
                </span>
              </div>
              <progress
                aria-label="PDF export progress"
                aria-valuetext={progress.label}
                value={progress.completed}
                max={progress.total}
                className="block h-2 w-full accent-sky-500"
              />
            </div>
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
 * error(s), plus the nothing-printable state — and the §3.3 image pre-flight
 * (probing status, then the could-not-embed warning). */
function Notices({
  layout,
  marginValid,
  spacingValid,
  checkingImages,
  failedImages,
}: {
  layout: ReturnType<typeof layoutPdf>;
  marginValid: boolean;
  spacingValid: boolean;
  /** Number of REMOTE image URLs still being probed (0 = settled or none) —
   * §7.1b: `asset:` sources resolve locally and never appear in this count,
   * since "Checking…" specifically describes the network-sensitive CORS
   * pre-flight (remoteImageUrlsUsed), not asset resolution. */
  checkingImages: number;
  failedImages: number;
}): ReactElement | null {
  const notes: ReactNode[] = [];

  if (checkingImages > 0) {
    notes.push(
      <p
        key="img-check"
        role="status"
        className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-400"
      >
        Checking {checkingImages} image{checkingImages === 1 ? "" : "s"}…
      </p>,
    );
  }

  if (failedImages > 0) {
    notes.push(
      <p
        key="img-fail"
        className="rounded border border-amber-900 bg-amber-950 px-2 py-1 text-xs text-amber-300"
      >
        {imageEmbedWarning(failedImages)}
      </p>,
    );
  }

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
