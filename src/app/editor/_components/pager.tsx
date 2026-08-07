"use client";

/**
 * The editor's one prev/next control: two chevron buttons around an `n / X`
 * readout. Used by the preview's single-card nav (windowPreview) and the PDF
 * export modal's page stepper — one implementation, so two identical-looking
 * controls can't drift apart.
 *
 * Two behaviours worth stating, because both are choices:
 * - The ends DISABLE rather than wrap. With `n / X` on screen, a jump from
 *   the last item back to the first reads as a glitch, not as a feature.
 * - The readout is `aria-live="polite"`: for a screen-reader user it is the
 *   only feedback that pressing the button did anything.
 *
 * `clampIndex` lives here too: keeping a browsing index addressable is the
 * pager's own concern, and both callers clamp at RENDER time against a count
 * that changes underneath them (a recompile, an options change).
 */

import type { ReactElement } from "react";

/**
 * Keep a remembered index addressable against the CURRENT count.
 *
 * Callers clamp at render and leave their raw state untouched (the pattern
 * the grid's active-tab fallback uses, windowSpreadsheet.tsx): a list that
 * shrinks shows its last item instead of nothing, and growing back restores
 * the position the user was on — no state write, no effect, no lost place.
 */
export function clampIndex(index: number, total: number): number {
  if (!Number.isFinite(index) || total <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index)), total - 1);
}

export interface PagerProps {
  /** 0-based; callers pass an already-clamped value. */
  index: number;
  count: number;
  onChange(next: number): void;
  /** Accessible names — the caller says what it is paging ("Previous card",
   * "Previous page"), since an icon button has no text of its own. */
  previousLabel: string;
  nextLabel: string;
}

export function Pager({
  index,
  count,
  onChange,
  previousLabel,
  nextLabel,
}: PagerProps): ReactElement {
  return (
    <div className="flex items-center gap-1 text-xs text-gray-400">
      <PagerButton
        label={previousLabel}
        disabled={index <= 0}
        onClick={() => onChange(clampIndex(index - 1, count))}
      >
        <Chevron direction="left" />
      </PagerButton>
      <span aria-live="polite" className="min-w-16 text-center tabular-nums">
        {index + 1} / {count}
      </span>
      <PagerButton
        label={nextLabel}
        disabled={index >= count - 1}
        onClick={() => onChange(clampIndex(index + 1, count))}
      >
        <Chevron direction="right" />
      </PagerButton>
    </div>
  );
}

interface PagerButtonProps {
  label: string;
  disabled: boolean;
  onClick(): void;
  children: ReactElement;
}

function PagerButton({ label, disabled, onClick, children }: PagerButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex items-center rounded border border-gray-600 bg-gray-800 px-1.5 py-1 text-gray-300 hover:bg-gray-700 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-gray-800"
    >
      {children}
    </button>
  );
}

/** Hand-drawn, like the preview's view-mode icons: the project has no icon
 * dependency and one glyph doesn't justify one. Decorative — the button
 * carries the accessible name. */
function Chevron({ direction }: { direction: "left" | "right" }): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === "left" ? "M10 3.5 L5.5 8 L10 12.5" : "M6 3.5 L10.5 8 L6 12.5"} />
    </svg>
  );
}
