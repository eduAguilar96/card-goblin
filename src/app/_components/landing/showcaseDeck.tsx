/**
 * The showcase cards — compiled by the real compiler, rendered as real SVG.
 *
 * No screenshots and no image files: `compileProject` runs at build time and
 * `CardFaceSvg` is the same markup the editor preview and the PDF rasterizer
 * use. That means these cards cannot drift from what the product actually
 * produces, they scale losslessly, and they cost no image bandwidth.
 *
 * The compile happens once at module scope — this is a static page, so it runs
 * during `next build` and never at request time.
 */

import type { ReactElement } from "react";
import { compileProject } from "@/lib/lang";
import { CardFaceSvg } from "@/app/editor/_components/cardSvg";
import {
  SHOWCASE_ROWS,
  SHOWCASE_SHEET,
  SHOWCASE_SOURCE,
} from "@/app/_components/landing/showcase";

const compiled = compileProject(SHOWCASE_SOURCE, {
  [SHOWCASE_SHEET]: SHOWCASE_ROWS.map((row) => ({ ...row })),
});

const deck = compiled.model.decks[0];

export default function ShowcaseDeck({
  className = "",
}: {
  className?: string;
}): ReactElement | null {
  if (deck === undefined) return null;

  return (
    <ul className={`flex gap-4 ${className}`}>
      {deck.cards.map((card, index) => (
        <li
          key={card.contentHash}
          // The wrapper owns the physical shape and the card-stock look, the
          // same way the editor preview does.
          className="w-40 shrink-0 overflow-hidden rounded-lg border border-gray-700 bg-white shadow-xl sm:w-44"
          style={{ aspectRatio: `${deck.widthMm} / ${deck.heightMm}` }}
        >
          <CardFaceSvg
            xUnits={deck.xUnits}
            yUnits={deck.yUnits}
            face={card.front}
            svgAttributes={{
              className: "block h-full w-full",
              role: "img",
              "aria-label": `Example card ${index + 1} of ${deck.cards.length}, generated from a spreadsheet row`,
            }}
          />
        </li>
      ))}
    </ul>
  );
}

/** How many cards the showcase produces — used in the page's copy. */
export const SHOWCASE_CARD_COUNT = deck?.cards.length ?? 0;
