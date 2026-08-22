/**
 * PDF export — pure layout math (DESIGN.md §6.1, M2).
 *
 * Everything in this module is a pure function of (RenderModel, options):
 * page grids, row-major placement, duplex column mirroring, guide segments,
 * fit errors, and error-card skip counts. No canvas, no pdf-lib, no DOM —
 * the assembly layer (pdfAssemble.ts) and the rasterizer (pdfRaster.tsx)
 * consume this module's output.
 *
 * All lengths are millimetres with the page's TOP-LEFT as origin (screen
 * convention, matching the RenderModel); pdfAssemble converts to PDF points
 * and flips to PDF's bottom-left origin.
 *
 * The grid is horizontally CENTERED between the margins and top-anchored
 * vertically, making the margin option a MINIMUM (§6.1 "grid anchoring":
 * col-index mirroring aligns duplex backs under a long-edge flip only when
 * the column x-positions are symmetric about the page's vertical center).
 *
 * Spec decisions beyond §6.1's literal text (each marked at its code site):
 * - "Separate" appends ALL back pages after ALL front pages globally (across
 *   decks), backs in the same page order as the fronts, so a re-fed stack
 *   pairs sheet k with sheet k (§6.1 says "all back pages appended after all
 *   front pages" without a per-deck qualifier).
 * - A deck whose every card is an error placeholder produces no pages and no
 *   fit error (there is nothing to fit); the fit check applies only to decks
 *   with at least one printable card.
 * - Fractional-mm arithmetic gets a tiny epsilon in the fit floor so a card
 *   that exactly fills the printable width (in real numbers) is not rejected
 *   by float noise (215.9 − 2×10 !== 195.9 in doubles).
 */

import type { RenderModel, Shape } from "@/lib/lang";

// ---------------------------------------------------------------------------
// Options (§6.1 modal options; defaults bold in the spec)
// ---------------------------------------------------------------------------

export interface PageSizeSpec {
  /** Display name for the modal. */
  name: string;
  widthMm: number;
  heightMm: number;
}

/** §6.1: Letter 215.9×279.4 mm, A4 210×297 mm. */
export const PAGE_SIZES = {
  letter: { name: "Letter", widthMm: 215.9, heightMm: 279.4 },
  a4: { name: "A4", widthMm: 210, heightMm: 297 },
} as const satisfies Record<string, PageSizeSpec>;

export type PageSizeId = keyof typeof PAGE_SIZES;

/** Guide rendering style — cut lines and cross marks share the vocabulary;
 * they differ only in their §6.1 defaults (dotted vs off). */
export type GuideStyle = "off" | "dotted" | "red" | "bold";

/** How back faces are emitted (§6.1). */
export type BacksMode = "duplex" | "separate" | "none";

export interface PdfExportOptions {
  pageSize: PageSizeId;
  /** Minimum outer margin, mm (see the centering note above). */
  marginMm: number;
  /** Gap between adjacent cards, mm. */
  spacingMm: number;
  cutLines: GuideStyle;
  crossMarks: GuideStyle;
  backs: BacksMode;
  /** Add a native-PDF logical sheet label to each page. */
  pageNumbers: boolean;
}

/** §6.1 defaults (bold in the spec text). */
export const DEFAULT_PDF_OPTIONS: PdfExportOptions = {
  pageSize: "letter",
  marginMm: 10,
  spacingMm: 0,
  cutLines: "dotted",
  crossMarks: "off",
  backs: "duplex",
  pageNumbers: false,
};

/** Shared native-PDF / modal-preview geometry for the optional label. The
 * width/height describe its text area; the label has no painted background. */
export const PAGE_NUMBER_BOX_WIDTH_MM = 30;
export const PAGE_NUMBER_BOX_HEIGHT_MM = 6;
export const PAGE_NUMBER_PADDING_MM = 1;
export const PAGE_NUMBER_FONT_SIZE_MM = 2.8;
/** Blank separation between the lowest card edge and the page label. */
export const PAGE_NUMBER_GAP_MM = 1;

/** Stroke spec of a non-"off" guide style (§6.1): dotted = 0.2 mm dotted
 * black; red = 0.2 mm solid #cc0000; bold = 0.5 mm solid black. Colors are
 * rgb fractions (0–1) ready for pdf-lib's `rgb()`. */
export interface GuideStroke {
  widthMm: number;
  color: { r: number; g: number; b: number };
  dashed: boolean;
}

export const GUIDE_STROKES: Record<Exclude<GuideStyle, "off">, GuideStroke> = {
  dotted: { widthMm: 0.2, color: { r: 0, g: 0, b: 0 }, dashed: true },
  red: { widthMm: 0.2, color: { r: 0.8, g: 0, b: 0 }, dashed: false },
  bold: { widthMm: 0.5, color: { r: 0, g: 0, b: 0 }, dashed: false },
};

// ---------------------------------------------------------------------------
// Grid fit (§6.1 formula)
// ---------------------------------------------------------------------------

/** Absorbs double-rounding in mm arithmetic at exact-fit boundaries; one
 * nanometre of slack is far below print tolerance. */
const FIT_EPSILON = 1e-6;

export interface GridFit {
  cols: number;
  rows: number;
  /** cols × rows. */
  perPage: number;
  /** x of column 0 (grid horizontally centered — module note above). */
  startXMm: number;
  /** y of row 0 (top-anchored at the margin). */
  startYMm: number;
}

/**
 * §6.1: cols = ⌊(pageW − 2·margin + spacing) / (cardW + spacing)⌋, rows
 * analog. Returns null when the card cannot fit 1×1 inside the margins —
 * the modal-surfaced error case.
 */
export function computeGrid(
  page: PageSizeSpec,
  marginMm: number,
  spacingMm: number,
  cardWidthMm: number,
  cardHeightMm: number,
): GridFit | null {
  const cols = Math.floor(
    (page.widthMm - 2 * marginMm + spacingMm) / (cardWidthMm + spacingMm) + FIT_EPSILON,
  );
  const rows = Math.floor(
    (page.heightMm - 2 * marginMm + spacingMm) / (cardHeightMm + spacingMm) + FIT_EPSILON,
  );
  if (cols < 1 || rows < 1) return null;
  const gridWidthMm = cols * cardWidthMm + (cols - 1) * spacingMm;
  return {
    cols,
    rows,
    perPage: cols * rows,
    startXMm: (page.widthMm - gridWidthMm) / 2,
    startYMm: marginMm,
  };
}

// ---------------------------------------------------------------------------
// Layout result types
// ---------------------------------------------------------------------------

export type PdfSide = "front" | "back";

/** One raster image key: a card face. `contentHash` covers BOTH faces of a
 * card (model.ts), so hash + side identifies one face's pixels. */
export function faceKey(contentHash: string, side: PdfSide): string {
  return `${contentHash}:${side}`;
}

/** What the rasterizer needs to draw one distinct face (browser layer). The
 * `face` array is SHARED with the RenderModel — never mutate. Error
 * placeholders are skipped before this point, so there is no error variant. */
export interface FaceRasterSpec {
  xUnits: number;
  yUnits: number;
  widthMm: number;
  heightMm: number;
  face: readonly Shape[];
}

/** One card image placement on a page (top-left origin, mm). */
export interface PlacedCard {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  imageKey: string;
}

/** One straight guide segment (top-left origin, mm). */
export interface GuideSegment {
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
}

export interface LayoutPage {
  widthMm: number;
  heightMm: number;
  /** The deck this page belongs to — decks never share pages (§6.1). */
  deckName: string;
  side: PdfSide;
  /** Zero-based logical sheet position. A matching front/back pair shares it. */
  sheetIndex: number;
  cards: PlacedCard[];
  /** Edge-to-edge cut lines at every card boundary; always computed (cheap,
   * directly testable) — the assembler draws them only when the style ≠ off. */
  cutLines: GuideSegment[];
  /** ~3 mm crop crosses at card corners only; two segments per cross. */
  crossMarks: GuideSegment[];
}

export interface DeckFitError {
  deckName: string;
  deckIndex: number;
  cardWidthMm: number;
  cardHeightMm: number;
}

export interface PdfLayoutResult {
  /** In final PDF page order (duplex interleaving / separate appending done). */
  pages: LayoutPage[];
  /** Every distinct face referenced by `pages`, keyed by faceKey(). */
  faceSpecs: Map<string, FaceRasterSpec>;
  /** Error-placeholder instances skipped (§6.1 — the modal warns). */
  skippedErrorCards: number;
  /** Decks whose card cannot fit 1×1 inside the margins (export-blocking). */
  fitErrors: DeckFitError[];
  /** Printable card instances placed (fronts; copies count individually). */
  placedCards: number;
  /** Number of logical front sheets; also the page-label denominator. */
  sheetCount: number;
}

/** The physical pairing label shown on a numbered export page. */
export function pageNumberLabel(page: LayoutPage, sheetCount: number): string {
  return `${page.sheetIndex + 1}/${sheetCount} ${page.side}`;
}

/** Top-left position for the label's unpainted text area. It is right-aligned
 * with the final occupied card row and starts BELOW that row's lower edge.
 *
 * Deliberately do not clamp it back onto the page: a full-height grid may put
 * the label in a printer's unprintable area (or outside the PDF page, where it
 * is clipped), but a print aid must never cover card artwork to save itself. */
export function pageNumberBoxPosition(
  page: Pick<LayoutPage, "cards">,
): { xMm: number; yMm: number } {
  if (page.cards.length === 0) return { xMm: 0, yMm: PAGE_NUMBER_GAP_MM };
  const lowerEdgeMm = Math.max(...page.cards.map((card) => card.yMm + card.heightMm));
  const rightEdgeMm = Math.max(
    ...page.cards
      .filter(
        (card) =>
          Math.abs(card.yMm + card.heightMm - lowerEdgeMm) <= COINCIDE_EPSILON,
      )
      .map((card) => card.xMm + card.widthMm),
  );
  return {
    xMm: rightEdgeMm - PAGE_NUMBER_BOX_WIDTH_MM,
    yMm: lowerEdgeMm + PAGE_NUMBER_GAP_MM,
  };
}

// ---------------------------------------------------------------------------
// Guide segments
// ---------------------------------------------------------------------------

/** Half-length of a crop cross arm: ~3 mm total per §6.1. */
export const CROSS_ARM_MM = 1.5;

/** Dedup tolerance for coincident edges/corners (spacing 0 → neighbouring
 * cards share an edge; positions come from one formula so they are usually
 * bit-identical, but the tolerance keeps float noise out of the contract). */
const COINCIDE_EPSILON = 1e-6;

function dedupSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > COINCIDE_EPSILON) out.push(v);
  }
  return out;
}

/**
 * §6.1: cut lines run edge-to-edge across the page at every card boundary.
 * Spacing 0 → adjacent cards share an edge → the dedup collapses it to ONE
 * line; spacing > 0 → both edges of the gap get their own line. Derived from
 * the placed cards themselves, so partially filled pages get exactly the
 * boundaries of their occupied region.
 */
export function computeCutLines(
  cards: readonly PlacedCard[],
  pageWidthMm: number,
  pageHeightMm: number,
): GuideSegment[] {
  const xs = dedupSorted(cards.flatMap((c) => [c.xMm, c.xMm + c.widthMm]));
  const ys = dedupSorted(cards.flatMap((c) => [c.yMm, c.yMm + c.heightMm]));
  return [
    ...xs.map((x) => ({ x1Mm: x, y1Mm: 0, x2Mm: x, y2Mm: pageHeightMm })),
    ...ys.map((y) => ({ x1Mm: 0, y1Mm: y, x2Mm: pageWidthMm, y2Mm: y })),
  ];
}

/**
 * §6.1: ~3 mm crop crosses at card corners only (never edge-to-edge). Shared
 * corners (spacing 0) are deduped — one cross per distinct corner point. Each
 * cross is two segments: horizontal then vertical. Arms are CLAMPED to the
 * page box: at margins below CROSS_ARM_MM an unclamped arm would extend
 * off-page (negative mm — outside the PDF page box and the preview viewBox).
 */
export function computeCrossMarks(
  cards: readonly PlacedCard[],
  pageWidthMm: number,
  pageHeightMm: number,
): GuideSegment[] {
  const clampX = (v: number): number => Math.min(Math.max(v, 0), pageWidthMm);
  const clampY = (v: number): number => Math.min(Math.max(v, 0), pageHeightMm);
  const seen = new Set<string>();
  const out: GuideSegment[] = [];
  for (const c of cards) {
    const corners: [number, number][] = [
      [c.xMm, c.yMm],
      [c.xMm + c.widthMm, c.yMm],
      [c.xMm, c.yMm + c.heightMm],
      [c.xMm + c.widthMm, c.yMm + c.heightMm],
    ];
    for (const [x, y] of corners) {
      // Quantized key — corners from one grid formula coincide exactly; the
      // rounding only guards against float noise (COINCIDE_EPSILON's job).
      const key = `${Math.round(x / COINCIDE_EPSILON)}:${Math.round(y / COINCIDE_EPSILON)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        { x1Mm: clampX(x - CROSS_ARM_MM), y1Mm: y, x2Mm: clampX(x + CROSS_ARM_MM), y2Mm: y },
        { x1Mm: x, y1Mm: clampY(y - CROSS_ARM_MM), x2Mm: x, y2Mm: clampY(y + CROSS_ARM_MM) },
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Full layout
// ---------------------------------------------------------------------------

/**
 * Lay out the whole model per §6.1. Row-major fill; per-deck pages; error
 * placeholders skipped (counted); duplex → each front page immediately
 * followed by its column-mirrored back page; separate → all backs after all
 * fronts (module note); none → fronts only. `count:` copies are separate
 * CardInstances in the model, so they place (and count) individually. They
 * share a contentHash — one raster, embedded once, drawn N times — UNLESS a
 * face reads the built-in `[card]` binding (§3.6, ◆42): a numbered print run
 * has genuinely different pixels per copy, so THAT face rasterizes N times.
 * Dedup is two-layered in `registerFace` below: identical copies collapse by
 * hash, and when copies diverge (each copy carries its own contentHash even
 * if only ONE face read `[card]`), the face that did NOT diverge still
 * collapses by REFERENCE — the generator shares its Shape array across
 * copies (generate.ts, MINOR-5), so array identity marks bit-identical
 * pixels the hash key can no longer see.
 */
export function layoutPdf(model: RenderModel, options: PdfExportOptions): PdfLayoutResult {
  const page = PAGE_SIZES[options.pageSize];
  const { marginMm, spacingMm, backs } = options;

  const fronts: LayoutPage[] = [];
  const backs_: LayoutPage[] = [];
  const faceSpecs = new Map<string, FaceRasterSpec>();
  const fitErrors: DeckFitError[] = [];
  let skippedErrorCards = 0;
  let placedCards = 0;
  /** duplex interleaves per front page; collected in final order directly. */
  const interleaved: LayoutPage[] = [];

  model.decks.forEach((deck, deckIndex) => {
    const printable = deck.cards.filter((card) => !card.error);
    skippedErrorCards += deck.cards.length - printable.length;
    if (printable.length === 0) return; // nothing to fit or print (module note)

    const grid = computeGrid(page, marginMm, spacingMm, deck.widthMm, deck.heightMm);
    if (grid === null) {
      fitErrors.push({
        deckName: deck.cardName,
        deckIndex,
        cardWidthMm: deck.widthMm,
        cardHeightMm: deck.heightMm,
      });
      return;
    }

    /** Reference-identity dedup (◆42 — see the function comment): maps a face's
     * Shape array to the key it was first registered under. Safe because the
     * RenderModel is immutable by contract, so an array reference is a stable
     * identity for its pixels. Scoped PER DECK — ◆42 sharing only ever spans
     * one card's `count:` copies, so a wider map buys nothing and would let a
     * hypothetical cross-deck shared array alias another deck's geometry. */
    const keyByFaceRef = new Map<readonly Shape[], string>();

    const registerFace = (hash: string, side: PdfSide, face: readonly Shape[]): string => {
      const existing = keyByFaceRef.get(face);
      if (existing !== undefined) return existing; // shared face of a ◆42 copy
      const key = faceKey(hash, side);
      keyByFaceRef.set(face, key);
      if (!faceSpecs.has(key)) {
        faceSpecs.set(key, {
          xUnits: deck.xUnits,
          yUnits: deck.yUnits,
          widthMm: deck.widthMm,
          heightMm: deck.heightMm,
          face,
        });
      }
      return key;
    };

    const cellX = (col: number): number => grid.startXMm + col * (deck.widthMm + spacingMm);
    const cellY = (row: number): number => grid.startYMm + row * (deck.heightMm + spacingMm);

    for (let start = 0; start < printable.length; start += grid.perPage) {
      const chunk = printable.slice(start, start + grid.perPage);
      const sheetIndex = fronts.length;

      const frontCards = chunk.map((card, i): PlacedCard => ({
        xMm: cellX(i % grid.cols),
        yMm: cellY(Math.floor(i / grid.cols)),
        widthMm: deck.widthMm,
        heightMm: deck.heightMm,
        imageKey: registerFace(card.contentHash, "front", card.front),
      }));
      placedCards += frontCards.length;

      const frontPage: LayoutPage = {
        widthMm: page.widthMm,
        heightMm: page.heightMm,
        deckName: deck.cardName,
        side: "front",
        sheetIndex,
        cards: frontCards,
        cutLines: computeCutLines(frontCards, page.widthMm, page.heightMm),
        crossMarks: computeCrossMarks(frontCards, page.widthMm, page.heightMm),
      };
      fronts.push(frontPage);
      interleaved.push(frontPage);

      if (backs !== "none") {
        // §6.1 duplex mirroring: col′ = cols − 1 − col, rows unchanged —
        // long-edge double-sided alignment (exact because the grid is
        // horizontally centered; see the module note).
        const backCards = chunk.map((card, i): PlacedCard => ({
          xMm: cellX(grid.cols - 1 - (i % grid.cols)),
          yMm: cellY(Math.floor(i / grid.cols)),
          widthMm: deck.widthMm,
          heightMm: deck.heightMm,
          imageKey: registerFace(card.contentHash, "back", card.back),
        }));
        const backPage: LayoutPage = {
          widthMm: page.widthMm,
          heightMm: page.heightMm,
          deckName: deck.cardName,
          side: "back",
          sheetIndex,
          cards: backCards,
          // §6.1: guides render on back pages too, from the mirrored grid.
          cutLines: computeCutLines(backCards, page.widthMm, page.heightMm),
          crossMarks: computeCrossMarks(backCards, page.widthMm, page.heightMm),
        };
        backs_.push(backPage);
        interleaved.push(backPage);
      }
    }
  });

  const pages =
    backs === "duplex" ? interleaved : backs === "separate" ? [...fronts, ...backs_] : fronts;

  return {
    pages,
    faceSpecs,
    skippedErrorCards,
    fitErrors,
    placedCards,
    sheetCount: fronts.length,
  };
}
