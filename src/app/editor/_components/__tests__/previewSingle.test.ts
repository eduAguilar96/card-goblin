/**
 * Unit tests for the single-card view's pure logic (previewSingle.ts):
 * flat-index addressing across decks, the render-time clamp, and the
 * fit-to-panel sizing — including the total-function edges, which is where
 * the never-blank rule (§4.2) actually lives.
 */
import { describe, expect, it } from "vitest";
import type { CardInstance, Deck } from "@/lib/lang";
import {
  locateCard,
  singleCardWidthPx,
  totalCardCount,
  SINGLE_CAPTION_PX,
  SINGLE_FALLBACK_CARD_PX,
  SINGLE_PADDING_PX,
} from "@/app/editor/_components/previewSingle";

const card = (hash: string): CardInstance => ({
  front: [],
  back: [],
  meta: { rowIndex: 0, loopBindings: {}, copyIndex: 0 },
  contentHash: hash,
});

const deck = (cardName: string, hashes: string[], widthMm = 63, heightMm = 88): Deck => ({
  cardName,
  widthMm,
  heightMm,
  xUnits: 20,
  yUnits: 28,
  cards: hashes.map(card),
});

/** Two decks, 2 + 3 cards → flat indices 0–4. */
const DECKS: Deck[] = [deck("Monster", ["a", "b"]), deck("Spell", ["c", "d", "e"])];

describe("totalCardCount", () => {
  it("sums every deck's cards", () => {
    expect(totalCardCount(DECKS)).toBe(5);
  });

  it("is 0 for no decks and for decks with no cards", () => {
    expect(totalCardCount([])).toBe(0);
    expect(totalCardCount([deck("Empty", [])])).toBe(0);
  });
});

describe("locateCard", () => {
  it("addresses cards flat, in declaration order, across the deck boundary", () => {
    expect(locateCard(DECKS, 0)).toMatchObject({ deckIndex: 0, cardIndex: 0 });
    expect(locateCard(DECKS, 1)).toMatchObject({ deckIndex: 0, cardIndex: 1 });
    // The boundary: 2 is the FIRST card of the second deck.
    expect(locateCard(DECKS, 2)).toMatchObject({ deckIndex: 1, cardIndex: 0 });
    expect(locateCard(DECKS, 4)).toMatchObject({ deckIndex: 1, cardIndex: 2 });
  });

  it("returns the card and its deck, not just indices", () => {
    const located = locateCard(DECKS, 3);
    expect(located?.card.contentHash).toBe("d");
    expect(located?.deck.cardName).toBe("Spell");
  });

  it("skips empty decks — they hold no addressable position", () => {
    const withHole = [deck("A", ["a"]), deck("Empty", []), deck("B", ["b"])];
    expect(locateCard(withHole, 1)).toMatchObject({ deckIndex: 2, cardIndex: 0 });
  });

  it("returns null for anything that addresses nothing", () => {
    expect(locateCard(DECKS, -1)).toBeNull();
    expect(locateCard(DECKS, 5)).toBeNull();
    expect(locateCard(DECKS, 1.5)).toBeNull();
    expect(locateCard(DECKS, NaN)).toBeNull();
    expect(locateCard([], 0)).toBeNull();
  });
});

describe("singleCardWidthPx", () => {
  /** A tall panel: width is the binding constraint. */
  it("fills the width, minus padding, when height is plentiful", () => {
    expect(singleCardWidthPx(500, 4000, 63, 88)).toBe(500 - 2 * SINGLE_PADDING_PX);
  });

  /** A short panel: height binds, and the card keeps its physical aspect. */
  it("fits the height at the card's physical aspect when height binds", () => {
    const availH = 300 - 2 * SINGLE_PADDING_PX - SINGLE_CAPTION_PX;
    expect(singleCardWidthPx(4000, 300, 63, 88)).toBeCloseTo(availH * (63 / 88));
  });

  it("respects the aspect: a landscape card is wider than a portrait one at the same height", () => {
    const portrait = singleCardWidthPx(4000, 300, 63, 88);
    const landscape = singleCardWidthPx(4000, 300, 88, 63);
    expect(landscape).toBeGreaterThan(portrait);
  });

  it("never returns a zero or negative width — the never-blank rule", () => {
    // Panel smaller than its own padding, unmeasured, and garbage sizes.
    expect(singleCardWidthPx(10, 10, 63, 88)).toBe(SINGLE_FALLBACK_CARD_PX);
    expect(singleCardWidthPx(0, 0, 63, 88)).toBe(SINGLE_FALLBACK_CARD_PX);
    expect(singleCardWidthPx(NaN, NaN, 63, 88)).toBe(SINGLE_FALLBACK_CARD_PX);
    expect(singleCardWidthPx(-100, -100, 63, 88)).toBe(SINGLE_FALLBACK_CARD_PX);
  });

  it("degrades a nonsense card size to a square aspect rather than NaN", () => {
    const availH = 300 - 2 * SINGLE_PADDING_PX - SINGLE_CAPTION_PX;
    expect(singleCardWidthPx(4000, 300, 0, 0)).toBe(availH);
    expect(singleCardWidthPx(4000, 300, NaN, 88)).toBe(availH);
  });
});
