/**
 * Row-windowing math for the virtualized preview (DESIGN.md §4.2, M6) —
 * pure-function tests over every documented edge: zero cards, fewer rows
 * than the viewport, mid-scroll, scroll past the end, sections below the
 * viewport, the no-measurement fallback, and zoom (rowH) changes.
 */
import { describe, expect, it } from "vitest";
import type { Deck } from "@/lib/lang";
import {
  CARD_GAP_PX,
  SECTION_GAP_PX,
  SECTION_HEADER_PX,
  columnCount,
  layoutDecks,
  rowHeightPx,
  visibleRange,
  type VisibleRange,
} from "@/app/editor/_components/previewVirtual";

/** The invariant that keeps the scrollbar truthful: spacers + rendered rows
 * always add up to the full list height. */
function totalHeight(range: VisibleRange, rowH: number): number {
  return range.padTop + (range.end - range.start) * rowH + range.padBottom;
}

describe("visibleRange", () => {
  it("zero rows → empty range, zero spacers", () => {
    expect(visibleRange(0, 600, 100, 0, 2)).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
    expect(visibleRange(500, 600, 100, -3, 2)).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
  });

  it("fewer rows than the viewport → renders all, no spacers", () => {
    expect(visibleRange(0, 1000, 100, 3, 2)).toEqual({
      start: 0,
      end: 3,
      padTop: 0,
      padBottom: 0,
    });
  });

  it("mid-scroll windows the visible band ± overscan with exact spacers", () => {
    const range = visibleRange(2050, 500, 100, 100, 2);
    // Visible rows: floor(2050/100)=20 … ceil(2550/100)=26 (exclusive).
    expect(range).toEqual({ start: 18, end: 28, padTop: 1800, padBottom: 7200 });
    expect(totalHeight(range, 100)).toBe(100 * 100);
  });

  it("overscan 0 renders exactly the visible band", () => {
    expect(visibleRange(2050, 500, 100, 100, 0)).toEqual({
      start: 20,
      end: 26,
      padTop: 2000,
      padBottom: 7400,
    });
  });

  it("scroll to just before the end stays anchored on the last row (valid, non-crashing)", () => {
    const range = visibleRange(9_950, 500, 100, 100, 2);
    expect(range.start).toBe(97);
    expect(range.end).toBe(100);
    expect(totalHeight(range, 100)).toBe(100 * 100);
  });

  it("section fully scrolled PAST renders nothing — all height in padTop (task 7)", () => {
    // At the exact boundary (scrollTop === totalRows·rowH) and beyond, no
    // row can be visible: the last rows must unmount, not stay anchored.
    for (const scrollTop of [10_000, 20_000]) {
      const range = visibleRange(scrollTop, 500, 100, 100, 2);
      expect(range).toEqual({ start: 100, end: 100, padTop: 10_000, padBottom: 0 });
      expect(totalHeight(range, 100)).toBe(100 * 100);
    }
    // One px earlier the last row is still (barely) in view.
    expect(visibleRange(9_999, 500, 100, 100, 0).end).toBe(100);
  });

  it("negative scrollTop: section partially below the viewport top renders its head", () => {
    // Section starts 300px below the viewport top; 600px viewport → 300px
    // of the section is visible: rows 0..3 (+ overscan).
    const range = visibleRange(-300, 600, 100, 50, 2);
    expect(range.start).toBe(0);
    expect(range.end).toBe(5);
    expect(totalHeight(range, 100)).toBe(50 * 100);
  });

  it("section entirely below the viewport renders nothing — all height in padBottom", () => {
    expect(visibleRange(-2000, 500, 100, 50, 2)).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 5000,
    });
  });

  it("no usable row height (unmeasured/zero/NaN) → renders ALL rows, never blank", () => {
    expect(visibleRange(0, 600, 0, 7, 2)).toEqual({
      start: 0,
      end: 7,
      padTop: 0,
      padBottom: 0,
    });
    expect(visibleRange(0, 600, Number.NaN, 7, 2)).toEqual({
      start: 0,
      end: 7,
      padTop: 0,
      padBottom: 0,
    });
    expect(visibleRange(0, 600, -5, 7, 2)).toEqual({
      start: 0,
      end: 7,
      padTop: 0,
      padBottom: 0,
    });
  });

  it("non-finite scrollTop/viewportH → renders ALL rows (total function, never blank — task 7)", () => {
    const all = { start: 0, end: 7, padTop: 0, padBottom: 0 };
    expect(visibleRange(Number.NaN, 600, 100, 7, 2)).toEqual(all);
    expect(visibleRange(Number.POSITIVE_INFINITY, 600, 100, 7, 2)).toEqual(all);
    expect(visibleRange(0, Number.NaN, 100, 7, 2)).toEqual(all);
  });

  it("zoom changes (any fractional rowH) keep the height invariant", () => {
    for (const rowH of [151.9, 226.0157480314961, 320.5, 572]) {
      for (const scrollTop of [0, 133, 999.5, 5000]) {
        const range = visibleRange(scrollTop, 640, rowH, 37, 2);
        expect(totalHeight(range, rowH)).toBeCloseTo(37 * rowH, 9);
        expect(range.start).toBeGreaterThanOrEqual(0);
        expect(range.end).toBeGreaterThanOrEqual(range.start);
        expect(range.end).toBeLessThanOrEqual(37);
      }
    }
  });

  it("row boundaries are exact: scrollTop landing on a boundary starts that row", () => {
    const range = visibleRange(200, 100, 100, 10, 0);
    expect(range.start).toBe(2);
    expect(range.end).toBe(3);
  });
});

describe("columnCount / rowHeightPx", () => {
  it("fits columns with gaps; never fewer than one", () => {
    // 3×220 cards + 2×12 gaps = 684 ≤ 700 < 4×220 + 3×12 = 916.
    expect(columnCount(700, 220)).toBe(3);
    expect(columnCount(100, 220)).toBe(1); // card wider than the panel
    expect(columnCount(0, 220)).toBe(1);
    expect(columnCount(700, 0)).toBe(1);
  });

  it("derives row height from the physical aspect + gap", () => {
    expect(rowHeightPx(200, 63.5, 88.9)).toBe(200 * (88.9 / 63.5) + CARD_GAP_PX);
    expect(rowHeightPx(0, 63.5, 88.9)).toBe(CARD_GAP_PX);
  });
});

describe("layoutDecks", () => {
  const deck = (cards: number, widthMm = 63.5, heightMm = 88.9): Deck => ({
    cardName: "D",
    widthMm,
    heightMm,
    xUnits: 20,
    yUnits: 28,
    cards: Array.from({ length: cards }, () => ({
      front: [],
      back: [],
      meta: { rowIndex: 0, loopBindings: {}, copyIndex: 0 },
      contentHash: "0",
    })),
  });

  it("stacks sections cumulatively; empty decks are header-only", () => {
    const layouts = layoutDecks([deck(7), deck(0), deck(1)], 700, 220);
    const rowH = rowHeightPx(220, 63.5, 88.9);
    expect(layouts[0]).toMatchObject({ top: 0, cols: 3, rows: 3, rowH });
    expect(layouts[0].cardsTop).toBe(SECTION_HEADER_PX);
    expect(layouts[0].height).toBe(SECTION_HEADER_PX + 3 * rowH + SECTION_GAP_PX);
    expect(layouts[1].top).toBe(layouts[0].height);
    expect(layouts[1].rows).toBe(0);
    expect(layouts[1].height).toBe(SECTION_HEADER_PX + SECTION_GAP_PX);
    expect(layouts[2].top).toBe(layouts[0].height + layouts[1].height);
    expect(layouts[2].rows).toBe(1);
  });
});
