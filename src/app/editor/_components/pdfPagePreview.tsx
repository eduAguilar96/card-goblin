"use client";

/**
 * One page of the export, drawn as SVG (M2 §6.1 †, 2026-08-06) — what the
 * export modal shows while the user pokes at the options.
 *
 * Same principle as the landing page's showcase: this is REAL output, not a
 * mock of it. The geometry comes from `layoutPdf` — the very function the
 * exporter lays pages out with — and each card is the same `CardFaceSvg`
 * markup the rasterizer serializes. There is no second layout implementation
 * that could drift from the PDF.
 *
 * What it therefore shows honestly: page size, margins, card grid, row-major
 * fill, duplex mirroring, and every guide style at true print scale. What it
 * cannot show: the 300 DPI rasterization step (the PDF embeds PNGs of these
 * faces, this draws them as live SVG) — a fidelity difference, never a
 * placement one.
 *
 * Everything is in MILLIMETRES: the viewBox is the page itself, so
 * placements, stroke widths, and the dotted dash pattern are used verbatim
 * from pdfLayout/pdfAssemble with no scale factor to keep in sync.
 */

import type { ReactElement } from "react";
import { CardFaceSvg } from "@/app/editor/_components/cardSvg";
import { DOTTED_DASH_MM } from "@/app/editor/_components/pdfAssemble";
import {
  GUIDE_STROKES,
  PAGE_NUMBER_BOX_HEIGHT_MM,
  PAGE_NUMBER_BOX_WIDTH_MM,
  PAGE_NUMBER_FONT_SIZE_MM,
  PAGE_NUMBER_PADDING_MM,
  pageNumberBoxPosition,
  pageNumberLabel,
  type FaceRasterSpec,
  type GuideSegment,
  type GuideStyle,
  type LayoutPage,
} from "@/app/editor/_components/pdfLayout";

/** SVG stroke attributes for a guide style, or null for "off". Mirrors what
 * pdfAssemble draws: GUIDE_STROKES' mm width and color, and the assembler's
 * own dash pattern for dotted — imported, not restated, so the preview can't
 * claim a look the PDF doesn't have. */
export interface GuideStrokeAttrs {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
}

export function guideStrokeAttrs(style: GuideStyle): GuideStrokeAttrs | null {
  if (style === "off") return null;
  const { color, widthMm, dashed } = GUIDE_STROKES[style];
  const channel = (value: number): number => Math.round(value * 255);
  return {
    stroke: `rgb(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)})`,
    strokeWidth: widthMm,
    ...(dashed ? { strokeDasharray: DOTTED_DASH_MM.join(" ") } : {}),
  };
}

export interface PdfPagePreviewProps {
  page: LayoutPage;
  /** From the same layout result as `page` — cards reference faces by key. */
  faceSpecs: ReadonlyMap<string, FaceRasterSpec>;
  cutLines: GuideStyle;
  crossMarks: GuideStyle;
  pageNumbers: boolean;
  sheetCount: number;
  marginMm: number;
}

export function PdfPagePreview({
  page,
  faceSpecs,
  cutLines,
  crossMarks,
  pageNumbers,
  sheetCount,
  marginMm,
}: PdfPagePreviewProps): ReactElement {
  return (
    <svg
      viewBox={`0 0 ${page.widthMm} ${page.heightMm}`}
      // Default preserveAspectRatio: the page letterboxes inside whatever box
      // the modal gives it, so the paper keeps its real proportions.
      className="h-full w-full"
      role="img"
      aria-label={`Page preview: ${page.deckName}, ${page.side}, ${page.cards.length} card${
        page.cards.length === 1 ? "" : "s"
      }`}
    >
      <rect x={0} y={0} width={page.widthMm} height={page.heightMm} fill="#ffffff" />
      {page.cards.map((card, i) => {
        const spec = faceSpecs.get(card.imageKey);
        if (spec === undefined) return null; // unreachable: same layout result
        return (
          <CardFaceSvg
            key={i}
            xUnits={spec.xUnits}
            yUnits={spec.yUnits}
            face={spec.face}
            // A nested <svg> clips to its own box, which is exactly how the
            // embedded PNG behaves. No rounded corners here on purpose: the
            // PDF prints square-cornered rectangles, and the preview must not
            // promise a cut it doesn't make (the on-screen card preview
            // rounds because it depicts a finished card).
            svgAttributes={{
              x: card.xMm,
              y: card.yMm,
              width: card.widthMm,
              height: card.heightMm,
            }}
          />
        );
      })}
      <Guides segments={page.cutLines} style={cutLines} />
      <Guides segments={page.crossMarks} style={crossMarks} />
      {pageNumbers && (
        <PageNumber page={page} sheetCount={sheetCount} marginMm={marginMm} />
      )}
    </svg>
  );
}

function PageNumber({
  page,
  sheetCount,
  marginMm,
}: {
  page: LayoutPage;
  sheetCount: number;
  marginMm: number;
}): ReactElement {
  const { xMm: x, yMm: y } = pageNumberBoxPosition(page, marginMm);
  return (
    <g data-page-number>
      <rect
        x={x}
        y={y}
        width={PAGE_NUMBER_BOX_WIDTH_MM}
        height={PAGE_NUMBER_BOX_HEIGHT_MM}
        fill="#ffffff"
        fillOpacity={0.94}
        stroke="#595959"
        strokeWidth={0.2}
      />
      <text
        x={x + PAGE_NUMBER_BOX_WIDTH_MM - PAGE_NUMBER_PADDING_MM}
        y={y + PAGE_NUMBER_BOX_HEIGHT_MM - PAGE_NUMBER_PADDING_MM}
        textAnchor="end"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="bold"
        fontSize={PAGE_NUMBER_FONT_SIZE_MM}
        fill="#141414"
      >
        {pageNumberLabel(page, sheetCount)}
      </text>
    </g>
  );
}

/** Guides are drawn at TRUE print width (0.2 mm hairlines really are thin at
 * page scale) — the preview would otherwise oversell how visible a dotted
 * line is next to a bold one. */
function Guides({
  segments,
  style,
}: {
  segments: readonly GuideSegment[];
  style: GuideStyle;
}): ReactElement | null {
  const attrs = guideStrokeAttrs(style);
  if (attrs === null || segments.length === 0) return null;
  return (
    <g {...attrs}>
      {segments.map((segment, i) => (
        <line
          key={i}
          x1={segment.x1Mm}
          y1={segment.y1Mm}
          x2={segment.x2Mm}
          y2={segment.y2Mm}
        />
      ))}
    </g>
  );
}
