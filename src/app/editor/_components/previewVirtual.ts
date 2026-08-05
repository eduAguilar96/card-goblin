/**
 * Pure layout math for the virtualized preview grid (DESIGN.md §4.2, M6).
 *
 * No dependencies, no DOM: the preview does simple row windowing — fixed row
 * height per deck (derived from the zoom card width + the deck's physical
 * aspect), only the rows overlapping the viewport (± overscan) are rendered,
 * and spacer divs stand in for everything else so the scroll height (and the
 * scrollbar) stay truthful. Everything here is exported for unit tests.
 *
 * All lengths are CSS pixels; all functions are total (no throwing) — a
 * nonsense input degrades to "render everything" rather than to a blank
 * panel, because a blank preview is the one failure mode §4.2 forbids.
 */

import type { Deck } from "@/lib/lang";

/** Gap between cards, and between card rows (the row height includes it). */
export const CARD_GAP_PX = 12;

/** Fixed height of a deck section's header line. */
export const SECTION_HEADER_PX = 36;

/** Vertical gap after each deck section. */
export const SECTION_GAP_PX = 24;

/** Rows rendered beyond each viewport edge. Also absorbs the scroll
 * container's content padding, which the windowing math ignores. */
export const OVERSCAN_ROWS = 2;

export interface VisibleRange {
  /** First rendered row (inclusive). */
  start: number;
  /** Last rendered row (exclusive). */
  end: number;
  /** Top spacer height: start × rowH. */
  padTop: number;
  /** Bottom spacer height: (totalRows − end) × rowH. */
  padBottom: number;
}

/**
 * Which rows of a uniform-height row list are visible, given the scroll
 * position RELATIVE to the list's own top (callers subtract their section's
 * offset, so `scrollTop` may be negative when the section starts below the
 * viewport top).
 *
 * Invariant (by construction): padTop + (end − start)·rowH + padBottom
 * === totalRows·rowH — the scroll height never changes as rows window in
 * and out.
 *
 * Edge semantics, unit-tested:
 * - totalRows ≤ 0 → empty range, zero spacers.
 * - rowH not a positive finite number (no measurement yet), or a non-finite
 *   scrollTop/viewportH (NaN from a garbage measurement) → render ALL rows
 *   — the never-blank fallback (§4.2; the total-function promise above).
 * - list entirely below the viewport (scrollTop + viewportH ≤ 0) → nothing
 *   rendered, all height in padBottom.
 * - list entirely ABOVE the viewport (scrolled fully past) → nothing
 *   rendered, all height in padTop (task 7 — no last rows kept mounted).
 * - scrolled to just before the end → the range stays anchored on the last
 *   row (still valid, still non-crashing).
 */
export function visibleRange(
  scrollTop: number,
  viewportH: number,
  rowH: number,
  totalRows: number,
  overscan: number,
): VisibleRange {
  if (totalRows <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  if (
    !Number.isFinite(rowH) ||
    rowH <= 0 ||
    !Number.isFinite(scrollTop) ||
    !Number.isFinite(viewportH)
  ) {
    // Total function, never blank (§4.2): any unusable measurement — an
    // unmeasured/zero row height OR a NaN scroll position — degrades to
    // rendering everything rather than to an empty panel.
    return { start: 0, end: totalRows, padTop: 0, padBottom: 0 };
  }
  const pad = Math.max(0, Math.floor(overscan));
  const rawBottom = scrollTop + Math.max(0, viewportH);
  if (rawBottom <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: totalRows * rowH };
  }
  if (scrollTop >= totalRows * rowH) {
    // Fully scrolled past: nothing of this list can be visible, so nothing
    // renders — the last rows must not stay mounted (task 7 review MINOR).
    return { start: totalRows, end: totalRows, padTop: totalRows * rowH, padBottom: 0 };
  }
  const top = Math.max(0, scrollTop);
  const first = Math.min(totalRows - 1, Math.floor(top / rowH));
  const lastExclusive = Math.min(
    totalRows,
    Math.max(first + 1, Math.ceil(rawBottom / rowH)),
  );
  const start = Math.max(0, first - pad);
  const end = Math.min(totalRows, lastExclusive + pad);
  return {
    start,
    end,
    padTop: start * rowH,
    padBottom: (totalRows - end) * rowH,
  };
}

/** Cards per row at a given content width and card width (≥ 1 — a card wider
 * than the panel overflows rather than vanishing). */
export function columnCount(
  contentW: number,
  cardW: number,
  gap: number = CARD_GAP_PX,
): number {
  if (!(cardW > 0) || !(contentW > 0)) return 1;
  return Math.max(1, Math.floor((contentW + gap) / (cardW + gap)));
}

/** One row's height: card height from the deck's PHYSICAL aspect (§3.4 — the
 * SVG viewBox may be a different aspect when units are non-square, W003; the
 * on-screen box always keeps the physical shape) plus the row gap. */
export function rowHeightPx(
  cardW: number,
  widthMm: number,
  heightMm: number,
  gap: number = CARD_GAP_PX,
): number {
  if (!(cardW > 0) || !(widthMm > 0) || !(heightMm > 0)) return gap;
  return cardW * (heightMm / widthMm) + gap;
}

/** Where one deck section sits inside the scroll content, in px from the top
 * of the first section. */
export interface DeckLayout {
  /** Section top (the header line). */
  top: number;
  /** Where the card rows start (top + header). */
  cardsTop: number;
  /** Cards per row for this deck at the current width/zoom. */
  cols: number;
  /** Total card rows (0 for an empty deck — header only). */
  rows: number;
  /** Uniform row height for this deck (includes the row gap). */
  rowH: number;
  /** Full section height: header + rows·rowH + section gap. */
  height: number;
}

/** Lay all deck sections out top-to-bottom. Pure arithmetic — no measurement
 * beyond the container's content width, so the same numbers drive SSR, the
 * spacer divs, and the per-section windowing. */
export function layoutDecks(
  decks: readonly Deck[],
  contentW: number,
  cardW: number,
): DeckLayout[] {
  let y = 0;
  return decks.map((deck) => {
    const cols = columnCount(contentW, cardW);
    const rows = Math.ceil(deck.cards.length / cols);
    const rowH = rowHeightPx(cardW, deck.widthMm, deck.heightMm);
    const height = SECTION_HEADER_PX + rows * rowH + SECTION_GAP_PX;
    const layout: DeckLayout = {
      top: y,
      cardsTop: y + SECTION_HEADER_PX,
      cols,
      rows,
      rowH,
      height,
    };
    y += height;
    return layout;
  });
}
