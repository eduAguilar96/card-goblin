/**
 * PDF export — pdf-lib assembly (DESIGN.md §6.1, M2).
 *
 * The thin deterministic layer between the pure layout (pdfLayout.ts) and the
 * downloaded bytes: pages at exact mm→pt, each distinct face PNG embedded
 * ONCE (keyed by faceKey) and drawn per placement, guides as native PDF
 * vector lines. No DOM — node-testable with stub PNG bytes; the browser-only
 * rasterizer supplies the real images.
 *
 * Coordinates: the layout speaks mm from the page's TOP-LEFT; PDF's origin is
 * the BOTTOM-LEFT with y up. `yFlipMmToPt` owns that conversion (exported for
 * direct unit tests).
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import {
  GUIDE_STROKES,
  PAGE_NUMBER_BOX_HEIGHT_MM,
  PAGE_NUMBER_BOX_WIDTH_MM,
  PAGE_NUMBER_FONT_SIZE_MM,
  PAGE_NUMBER_PADDING_MM,
  pageNumberBoxPosition,
  pageNumberLabel,
  type GuideSegment,
  type GuideStyle,
  type LayoutPage,
  type PdfExportOptions,
  type PdfLayoutResult,
} from "@/app/editor/_components/pdfLayout";

/** Exact §6.1 conversion: 1 mm = 72/25.4 pt. */
export const MM_TO_PT = 72 / 25.4;

/** Dotted guides: dash/gap pattern in mm (§6.1 fixes the 0.2 mm width and
 * "dotted"; the pattern itself is a rendering choice, kept here as the one
 * tuning constant). */
export const DOTTED_DASH_MM: readonly [number, number] = [0.5, 1];

/** Top-left-mm y → PDF pt for a box of height `boxHeightMm` (0 for lines):
 * PDF anchors at the BOTTOM edge of what is drawn. */
export function yFlipMmToPt(pageHeightMm: number, yMm: number, boxHeightMm: number): number {
  return (pageHeightMm - yMm - boxHeightMm) * MM_TO_PT;
}

function drawSegments(
  page: PDFPage,
  pageHeightMm: number,
  segments: readonly GuideSegment[],
  style: GuideStyle,
): void {
  if (style === "off") return;
  const stroke = GUIDE_STROKES[style];
  const color = rgb(stroke.color.r, stroke.color.g, stroke.color.b);
  const dashArray = stroke.dashed ? DOTTED_DASH_MM.map((mm) => mm * MM_TO_PT) : undefined;
  for (const seg of segments) {
    page.drawLine({
      start: { x: seg.x1Mm * MM_TO_PT, y: yFlipMmToPt(pageHeightMm, seg.y1Mm, 0) },
      end: { x: seg.x2Mm * MM_TO_PT, y: yFlipMmToPt(pageHeightMm, seg.y2Mm, 0) },
      thickness: stroke.widthMm * MM_TO_PT,
      color,
      ...(dashArray ? { dashArray } : {}),
    });
  }
}

function drawPage(
  doc: PDFDocument,
  layoutPage: LayoutPage,
  embedded: ReadonlyMap<string, PDFImage>,
  options: PdfExportOptions,
  sheetCount: number,
  pageNumberFont?: PDFFont,
): void {
  const page = doc.addPage([layoutPage.widthMm * MM_TO_PT, layoutPage.heightMm * MM_TO_PT]);

  for (const card of layoutPage.cards) {
    const image = embedded.get(card.imageKey);
    if (!image) throw new Error(`pdfAssemble: no image for face ${card.imageKey}`);
    page.drawImage(image, {
      x: card.xMm * MM_TO_PT,
      y: yFlipMmToPt(layoutPage.heightMm, card.yMm, card.heightMm),
      width: card.widthMm * MM_TO_PT,
      height: card.heightMm * MM_TO_PT,
    });
  }

  // Guides AFTER images: with spacing 0 the cut line runs along card edges
  // and must stay visible on top of them.
  drawSegments(page, layoutPage.heightMm, layoutPage.cutLines, options.cutLines);
  drawSegments(page, layoutPage.heightMm, layoutPage.crossMarks, options.crossMarks);

  if (options.pageNumbers && pageNumberFont !== undefined) {
    const { xMm: boxX, yMm: boxTopY } = pageNumberBoxPosition(
      layoutPage,
      options.marginMm,
    );
    const boxBottomY = yFlipMmToPt(
      layoutPage.heightMm,
      boxTopY,
      PAGE_NUMBER_BOX_HEIGHT_MM,
    );
    const label = pageNumberLabel(layoutPage, sheetCount);
    const fontSize = PAGE_NUMBER_FONT_SIZE_MM * MM_TO_PT;
    const textWidth = pageNumberFont.widthOfTextAtSize(label, fontSize);
    page.drawRectangle({
      x: boxX * MM_TO_PT,
      y: boxBottomY,
      width: PAGE_NUMBER_BOX_WIDTH_MM * MM_TO_PT,
      height: PAGE_NUMBER_BOX_HEIGHT_MM * MM_TO_PT,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.35, 0.35, 0.35),
      borderWidth: 0.2 * MM_TO_PT,
      opacity: 0.94,
      borderOpacity: 0.94,
    });
    page.drawText(label, {
      x:
        (boxX + PAGE_NUMBER_BOX_WIDTH_MM - PAGE_NUMBER_PADDING_MM) * MM_TO_PT -
        textWidth,
      y: boxBottomY + PAGE_NUMBER_PADDING_MM * MM_TO_PT,
      size: fontSize,
      font: pageNumberFont,
      color: rgb(0.08, 0.08, 0.08),
    });
  }
}

/**
 * Assemble the final document. `images` maps faceKey → PNG bytes and must
 * cover every face the layout references (the rasterizer produces exactly
 * `layout.faceSpecs`' keys). Each distinct face is embedded once; placements
 * reuse the embedded object (§6.1 — copies cost one image).
 */
export async function assemblePdf(
  layout: PdfLayoutResult,
  images: ReadonlyMap<string, Uint8Array>,
  options: PdfExportOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pageNumberFont = options.pageNumbers
    ? await doc.embedFont(StandardFonts.HelveticaBold)
    : undefined;

  const embedded = new Map<string, PDFImage>();
  for (const [key] of layout.faceSpecs) {
    const bytes = images.get(key);
    if (!bytes) throw new Error(`pdfAssemble: missing PNG for face ${key}`);
    embedded.set(key, await doc.embedPng(bytes));
  }

  for (const layoutPage of layout.pages) {
    drawPage(doc, layoutPage, embedded, options, layout.sheetCount, pageNumberFont);
  }

  return doc.save();
}
