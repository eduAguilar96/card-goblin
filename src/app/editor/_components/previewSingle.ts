/**
 * Pure logic for the preview's SINGLE-CARD view — the default mode (§4.2).
 *
 * The grid view (previewVirtual.ts) windows many cards; this view shows ONE,
 * as large as the panel allows. Two jobs, both pure and unit-tested here:
 *
 * (The index CLAMP that keeps a remembered position addressable lives with
 * the nav control itself — pager.ts's `clampIndex`, shared with the PDF
 * modal's page stepper.)
 *
 * - **Addressing.** The nav counter is `n / X` over EVERY card in the model,
 *   flat across decks in declaration order — so prev/next walks from the last
 *   card of one deck into the first of the next without a second control.
 *   `locateCard` maps that flat index back to its deck + card by walking the
 *   decks (there are few, and the walk allocates nothing — no flattened copy
 *   of a 500-card model per render).
 * - **Sizing.** `singleCardWidthPx` fits the card inside the measured panel,
 *   keeping its PHYSICAL aspect (§3.4). The zoom slider is a grid-view
 *   control and is hidden here: "as big as it fits" is the whole point of
 *   the view.
 *
 * Same total-function rule as previewVirtual: no throwing, and any unusable
 * input degrades to something renderable rather than to a blank panel or a
 * zero-width card (§4.2's never-blank rule).
 */

import type { CardInstance, Deck } from "@/lib/lang";

/** Which layout the preview body is showing. `single` is the default (§4.2). */
export type PreviewMode = "single" | "grid";

/** Content padding around the card area (matches the scroll container's
 * `p-4`, and previewVirtual's CONTENT_PADDING_PX). */
export const SINGLE_PADDING_PX = 16;

/** Height reserved for the caption line above the card (deck · position ·
 * physical size). Fixed, so the fit math needs no second measurement. */
export const SINGLE_CAPTION_PX = 28;

/** Card width used when the panel has not been measured yet, or reports
 * nonsense — never 0 (never-blank). Matches the grid view's default zoom, so
 * an unmeasured single view looks like an unmeasured grid one. */
export const SINGLE_FALLBACK_CARD_PX = 220;

/** Every card of every deck (what the `n / X` counter's X is). */
export function totalCardCount(decks: readonly Deck[]): number {
  return decks.reduce((total, deck) => total + deck.cards.length, 0);
}

/** One card plus where it sits: which deck (for geometry and the caption),
 * and its index WITHIN that deck (`cardIndex`) as opposed to the flat index. */
export interface LocatedCard {
  deck: Deck;
  card: CardInstance;
  /** Index into `RenderModel.decks`. */
  deckIndex: number;
  /** Index into that deck's `cards`. */
  cardIndex: number;
}

/**
 * Flat index → card. Decks are walked in declaration order, so index 0 is the
 * first card of the first deck and the last index is the last card of the
 * last deck; empty decks are skipped (they hold no addressable position).
 *
 * Returns null for any index that addresses nothing — negative, past the end,
 * or non-integer — rather than clamping: the caller decides what an empty
 * result looks like (the preview already owns "no cards" empty states, and
 * clamping is `clampIndex`'s job).
 */
export function locateCard(decks: readonly Deck[], index: number): LocatedCard | null {
  if (!Number.isInteger(index) || index < 0) return null;
  let remaining = index;
  for (let deckIndex = 0; deckIndex < decks.length; deckIndex++) {
    const deck = decks[deckIndex];
    if (remaining < deck.cards.length) {
      return { deck, card: deck.cards[remaining], deckIndex, cardIndex: remaining };
    }
    remaining -= deck.cards.length;
  }
  return null;
}

/**
 * Card width in px that fits `viewportW × viewportH` (the measured scroll
 * container) once padding and the caption line are taken out, at the card's
 * physical aspect — so a tall card is limited by the panel's height and a
 * wide one by its width.
 *
 * Degrades to SINGLE_FALLBACK_CARD_PX whenever the result would not be a
 * positive finite number: an unmeasured panel (SSR, first paint, tests), a
 * garbage measurement, or a deck with a nonsense physical size. A card that
 * overflows a very short panel is better than no card at all (never-blank).
 */
export function singleCardWidthPx(
  viewportW: number,
  viewportH: number,
  widthMm: number,
  heightMm: number,
): number {
  const availW = Number.isFinite(viewportW) ? viewportW - 2 * SINGLE_PADDING_PX : 0;
  const availH = Number.isFinite(viewportH)
    ? viewportH - 2 * SINGLE_PADDING_PX - SINGLE_CAPTION_PX
    : 0;
  const aspect =
    Number.isFinite(widthMm) && Number.isFinite(heightMm) && widthMm > 0 && heightMm > 0
      ? widthMm / heightMm
      : 1;
  const byWidth = availW > 0 ? availW : Infinity;
  const byHeight = availH > 0 ? availH * aspect : Infinity;
  const fit = Math.min(byWidth, byHeight);
  return Number.isFinite(fit) && fit > 0 ? fit : SINGLE_FALLBACK_CARD_PX;
}
