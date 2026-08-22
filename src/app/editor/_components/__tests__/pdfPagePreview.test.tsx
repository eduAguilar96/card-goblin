/**
 * The PDF page preview (pdfPagePreview.tsx), driven by a REAL layout of the
 * demo model — the same `layoutPdf` result the exporter consumes. What these
 * tests protect is the claim the preview makes: that it draws the export's
 * own geometry and honours every guide option, rather than approximating it.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { compileProject } from "@/lib/lang";
import { DEMO_PROJECT_ROWS, DEMO_PROJECT_SOURCE } from "@/lib/lang/demoProject";
import { DOTTED_DASH_MM } from "@/app/editor/_components/pdfAssemble";
import {
  DEFAULT_PDF_OPTIONS,
  GUIDE_STROKES,
  PAGE_SIZES,
  layoutPdf,
  type PdfExportOptions,
} from "@/app/editor/_components/pdfLayout";
import {
  PdfPagePreview,
  guideStrokeAttrs,
} from "@/app/editor/_components/pdfPagePreview";

function demoLayout(overrides: Partial<PdfExportOptions> = {}) {
  const rows = { Monsters: DEMO_PROJECT_ROWS.map((row) => ({ ...row })) };
  const result = compileProject(DEMO_PROJECT_SOURCE, rows, {
    Monsters: rows.Monsters.map(() => true),
  });
  expect(result.diagnostics).toEqual([]);
  return layoutPdf(result.model, { ...DEFAULT_PDF_OPTIONS, ...overrides });
}

function renderPage(
  layout: ReturnType<typeof layoutPdf>,
  pageIndex: number,
  options: PdfExportOptions = DEFAULT_PDF_OPTIONS,
): string {
  return renderToStaticMarkup(
    <PdfPagePreview
      page={layout.pages[pageIndex]}
      faceSpecs={layout.faceSpecs}
      cutLines={options.cutLines}
      crossMarks={options.crossMarks}
      pageNumbers={options.pageNumbers}
      sheetCount={layout.sheetCount}
    />,
  );
}

const countLines = (markup: string): number => (markup.match(/<line/g) ?? []).length;

describe("guideStrokeAttrs", () => {
  it("is null for off — nothing is drawn", () => {
    expect(guideStrokeAttrs("off")).toBeNull();
  });

  it("mirrors the PDF's own stroke spec, in mm", () => {
    expect(guideStrokeAttrs("bold")).toEqual({
      stroke: "rgb(0, 0, 0)",
      strokeWidth: GUIDE_STROKES.bold.widthMm,
    });
    expect(guideStrokeAttrs("red")).toEqual({
      stroke: "rgb(204, 0, 0)",
      strokeWidth: GUIDE_STROKES.red.widthMm,
    });
  });

  it("dots with the assembler's dash pattern, not a lookalike", () => {
    expect(guideStrokeAttrs("dotted")?.strokeDasharray).toBe(DOTTED_DASH_MM.join(" "));
  });
});

describe("PdfPagePreview", () => {
  it("draws the page at its true mm size, with one nested svg per placed card", () => {
    const layout = demoLayout();
    const page = layout.pages[0];
    const markup = renderPage(layout, 0);

    // The viewBox IS the page — placements need no scale factor.
    expect(markup).toContain(
      `viewBox="0 0 ${PAGE_SIZES.letter.widthMm} ${PAGE_SIZES.letter.heightMm}"`,
    );
    // One card svg per placement, at the layout's own coordinates.
    const cardSvgs = (markup.match(/<svg/g) ?? []).length - 1; // minus the page
    expect(cardSvgs).toBe(page.cards.length);
    expect(page.cards.length).toBeGreaterThan(0);
    const first = page.cards[0];
    expect(markup).toContain(`x="${first.xMm}"`);
    expect(markup).toContain(`width="${first.widthMm}"`);
    // Real card content, not a placeholder rectangle.
    expect(markup).toContain("Dragon");
  });

  it("draws cut lines by default and none when they are off", () => {
    const layout = demoLayout();
    const withLines = renderPage(layout, 0, DEFAULT_PDF_OPTIONS);
    expect(countLines(withLines)).toBe(layout.pages[0].cutLines.length);

    const withoutLines = renderPage(layout, 0, {
      ...DEFAULT_PDF_OPTIONS,
      cutLines: "off",
    });
    expect(countLines(withoutLines)).toBe(0);
  });

  it("adds cross marks only when they are switched on", () => {
    const layout = demoLayout();
    const page = layout.pages[0];
    const both = renderPage(layout, 0, { ...DEFAULT_PDF_OPTIONS, crossMarks: "red" });
    expect(countLines(both)).toBe(page.cutLines.length + page.crossMarks.length);
    expect(both).toContain("rgb(204, 0, 0)");
  });

  it("shows the duplex back page mirrored — the option most worth seeing", () => {
    const layout = demoLayout(); // duplex: page 1 is the back of page 0
    const front = layout.pages[0];
    const back = layout.pages[1];
    expect(back.side).toBe("back");
    // Same rows, mirrored columns: the leftmost front card sits rightmost.
    expect(back.cards[0].xMm).not.toBe(front.cards[0].xMm);
    expect(back.cards[0].yMm).toBe(front.cards[0].yMm);
    const markup = renderPage(layout, 1);
    expect(markup).toContain(`x="${back.cards[0].xMm}"`);
    // It really is the BACK face's markup: the demo's back is a teal panel,
    // and none of the front's text is on this page.
    expect(markup).toContain('fill="teal"');
    expect(markup).not.toContain("Dragon");
  });

  it("shows paired logical sheet labels only when enabled", () => {
    const layout = demoLayout({ pageNumbers: true });
    const front = renderPage(layout, 0, { ...DEFAULT_PDF_OPTIONS, pageNumbers: true });
    const back = renderPage(layout, 1, { ...DEFAULT_PDF_OPTIONS, pageNumbers: true });
    expect(front).toContain("data-page-number");
    expect(front).toContain("1/2 front");
    expect(back).toContain("1/2 back");
    expect(front).not.toContain('fill-opacity="0.94"');

    const off = renderPage(layout, 0, DEFAULT_PDF_OPTIONS);
    expect(off).not.toContain("data-page-number");
    expect(off).not.toContain("1/2 front");
  });
});
