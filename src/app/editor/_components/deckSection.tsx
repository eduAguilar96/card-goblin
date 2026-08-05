"use client";

/**
 * One deck's labeled section in the preview: header (name, instance count,
 * physical size) + a windowed grid of CardSVGs (DESIGN.md §4.2, M6).
 *
 * Windowing: the section receives the shared scroll position and windows its
 * OWN rows with `visibleRange`, using a scroll offset relative to where its
 * card rows start (`layout.cardsTop`) — so all sections share one scroll
 * container and one measurement, and spacer divs keep the section's full
 * height (and the scrollbar) truthful while offscreen rows don't exist.
 */

import type { ReactElement } from "react";
import type { Deck } from "@/lib/lang";
import { CardSVG } from "@/app/editor/_components/cardSvg";
import {
  CARD_GAP_PX,
  OVERSCAN_ROWS,
  SECTION_GAP_PX,
  SECTION_HEADER_PX,
  visibleRange,
  type DeckLayout,
} from "@/app/editor/_components/previewVirtual";

export type CardSide = "front" | "back";

export interface DeckSectionProps {
  deck: Deck;
  /** Which face every card shows (the global toolbar toggle, §4.2). */
  side: CardSide;
  /** Card width in px (the zoom control). */
  cardW: number;
  /** This section's precomputed offsets/rows (previewVirtual.layoutDecks). */
  layout: DeckLayout;
  /** The shared scroll container's scrollTop. */
  scrollTop: number;
  /** The shared scroll container's viewport height (or the SSR fallback). */
  viewportH: number;
}

export default function DeckSection({
  deck,
  side,
  cardW,
  layout,
  scrollTop,
  viewportH,
}: DeckSectionProps): ReactElement {
  const { cols, rows, rowH } = layout;
  const range = visibleRange(
    scrollTop - layout.cardsTop,
    viewportH,
    rowH,
    rows,
    OVERSCAN_ROWS,
  );

  const errorCount = deck.cards.reduce((n, card) => n + (card.error ? 1 : 0), 0);

  const rowElements: ReactElement[] = [];
  for (let r = range.start; r < range.end; r++) {
    const rowCards = deck.cards.slice(r * cols, (r + 1) * cols);
    rowElements.push(
      // Row height is pinned to the same arithmetic the spacers use, so the
      // scroll height cannot drift from the rendered rows.
      <div
        key={r}
        className="flex items-start"
        style={{ height: rowH - CARD_GAP_PX, marginBottom: CARD_GAP_PX, gap: CARD_GAP_PX }}
      >
        {rowCards.map((card, i) => (
          // The key includes the side: cardSvgPropsEqual memoizes on
          // contentHash, which covers BOTH faces, so a front↔back toggle
          // must remount rather than rely on the comparator (cardSvg.tsx).
          <div key={`${side}:${r * cols + i}`} style={{ width: cardW }} className="shrink-0">
            <CardSVG
              xUnits={deck.xUnits}
              yUnits={deck.yUnits}
              widthMm={deck.widthMm}
              heightMm={deck.heightMm}
              face={side === "front" ? card.front : card.back}
              contentHash={card.contentHash}
              error={card.error}
            />
          </div>
        ))}
      </div>,
    );
  }

  return (
    // flex-col prevents CSS margin collapse (task 7, task-5 review MINOR):
    // as plain blocks, the last row's marginBottom (CARD_GAP_PX) would
    // collapse through the section's bottom edge into its own marginBottom
    // when no padBottom spacer is rendered, shrinking the section below the
    // height layoutDecks computed (header + rows·rowH + gap) and letting the
    // scroll math drift. Flex containers never collapse child margins.
    <section className="flex flex-col" style={{ marginBottom: SECTION_GAP_PX }}>
      <header
        className="flex items-baseline gap-2"
        style={{ height: SECTION_HEADER_PX }}
      >
        <h3 className="text-sm font-semibold text-gray-200">{deck.cardName}</h3>
        <span className="text-xs text-gray-400">
          {deck.cards.length} card{deck.cards.length === 1 ? "" : "s"}
          {errorCount > 0 && (
            <span className="text-amber-400">
              {" "}
              · {errorCount} error{errorCount === 1 ? "" : "s"}
            </span>
          )}{" "}
          · {deck.widthMm}×{deck.heightMm} mm
        </span>
      </header>
      {range.padTop > 0 && <div style={{ height: range.padTop }} aria-hidden />}
      {rowElements}
      {range.padBottom > 0 && <div style={{ height: range.padBottom }} aria-hidden />}
    </section>
  );
}
