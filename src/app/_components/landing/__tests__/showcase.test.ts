/**
 * The landing page's showcase deck must actually compile.
 *
 * It's rendered by the real compiler at build time, so a language change that
 * broke it would break the front door of the site — and `next build` would
 * happily ship blank cards rather than fail. This test is the tripwire.
 */

import { describe, expect, it } from "vitest";
import { compileProject } from "@/lib/lang";
import {
  SHOWCASE_ROWS,
  SHOWCASE_SHEET,
  SHOWCASE_SOURCE,
} from "@/app/_components/landing/showcase";

const compiled = compileProject(SHOWCASE_SOURCE, {
  [SHOWCASE_SHEET]: SHOWCASE_ROWS.map((row) => ({ ...row })),
});

describe("landing page showcase", () => {
  it("compiles with no errors or warnings", () => {
    expect(compiled.diagnostics).toEqual([]);
  });

  it("evaluates with no data errors", () => {
    expect(compiled.dataDiagnostics).toEqual([]);
  });

  it("generates one card per row, in one deck", () => {
    expect(compiled.model.decks).toHaveLength(1);
    expect(compiled.model.decks[0].cards).toHaveLength(SHOWCASE_ROWS.length);
  });

  it("draws every card — none are error placeholders", () => {
    for (const card of compiled.model.decks[0].cards) {
      expect(card.error).toBeUndefined();
      expect(card.front.length).toBeGreaterThan(0);
    }
  });

  it("turns the power column into that many repeated icons", () => {
    // The whole pitch in one assertion: a number in a cell becomes N drawn
    // shapes. Ember Dart has power 2, Tidal Surge 4, Stone Ward 3.
    const coinCounts = compiled.model.decks[0].cards.map(
      (card) =>
        card.front.filter((shape) => shape.kind === "icon" && shape.code === "COIN")
          .length,
    );
    expect(coinCounts).toEqual([2, 4, 3]);
  });

  it("uses a poker card at a square 20 × 28 unit grid", () => {
    const deck = compiled.model.decks[0];
    expect([deck.widthMm, deck.heightMm]).toEqual([63.5, 88.9]);
    expect([deck.xUnits, deck.yUnits]).toEqual([20, 28]);
  });

  it("keeps the displayed source short enough to read beside the cards", () => {
    expect(SHOWCASE_SOURCE.trimEnd().split("\n").length).toBeLessThanOrEqual(50);
  });
});
