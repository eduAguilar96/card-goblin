import { describe, expect, it } from "vitest";
import { compileProject } from "@/lib/lang";
import { DEMO_PROJECT_ROWS, DEMO_PROJECT_SOURCE } from "@/lib/lang/demoProject";
import {
  computeGrid,
  DEFAULT_PDF_OPTIONS,
  faceKey,
  layoutPdf,
  PAGE_SIZES,
  type PdfExportOptions,
} from "../pdfLayout";
import { assemblePdf } from "../pdfAssemble";

function demoModel() {
  const result = compileProject(
    DEMO_PROJECT_SOURCE,
    { Monsters: DEMO_PROJECT_ROWS.map((r) => ({ ...r })) },
    { Monsters: [true, true] },
  );
  expect(result.diagnostics).toEqual([]);
  return result.model;
}

function opts(overrides: Partial<PdfExportOptions>): PdfExportOptions {
  return { ...DEFAULT_PDF_OPTIONS, ...overrides };
}

// A valid 1×1 transparent PNG for assembly tests.
const PNG_1PX = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

describe("computeGrid (§6.1 formula)", () => {
  it("fits 3×2 poker cards on letter at the default margins", () => {
    const grid = computeGrid(PAGE_SIZES.letter, 10, 0, 63.5, 88.9);
    expect(grid).toMatchObject({ cols: 3, rows: 2, perPage: 6 });
  });

  it("spacing shrinks the fit per the formula", () => {
    // (215.9 − 20 + 10) / (63.5 + 10) = 2.8 → 2 cols
    const grid = computeGrid(PAGE_SIZES.letter, 10, 10, 63.5, 88.9);
    expect(grid?.cols).toBe(2);
  });

  it("returns null when a card cannot fit inside the margins", () => {
    expect(computeGrid(PAGE_SIZES.letter, 105, 0, 63.5, 88.9)).toBeNull();
  });

  it("accepts an exact-width fit without float jitter", () => {
    // usable width exactly 2 cards: margin = (215.9 − 127) / 2
    const grid = computeGrid(PAGE_SIZES.letter, (215.9 - 127) / 2, 0, 63.5, 88.9);
    expect(grid?.cols).toBe(2);
  });
});

describe("layoutPdf on the real demo model", () => {
  it("duplex: interleaved F/B pages with horizontally mirrored backs", () => {
    const layout = layoutPdf(demoModel(), opts({}));
    expect(layout.fitErrors).toEqual([]);
    expect(layout.skippedErrorCards).toBe(0);
    expect(layout.placedCards).toBe(9); // copies count individually
    // 9 cards at 6/page → 2 front pages, interleaved with their back pages.
    expect(layout.pages.map((p) => p.side)).toEqual(["front", "back", "front", "back"]);
    const [front, back] = layout.pages;
    expect(front.cards).toHaveLength(6);
    expect(back.cards).toHaveLength(6);
    // Mirror: the back of the card in column 0 sits at column cols−1 (same row),
    // so sorted x-positions match while each card's partner x is mirrored.
    const xs = (cards: { xMm: number }[]) => cards.map((c) => c.xMm);
    expect([...xs(back.cards)].sort((a, b) => a - b)).toEqual(
      [...xs(front.cards)].sort((a, b) => a - b),
    );
    const mirrored = front.cards.map(
      (c) => front.widthMm - c.xMm - c.widthMm,
    );
    expect(xs(back.cards).map((x) => Math.round(x * 1e6) / 1e6)).toEqual(
      mirrored.map((x) => Math.round(x * 1e6) / 1e6),
    );
    // Rows unchanged on the back (long-edge duplex).
    expect(back.cards.map((c) => c.yMm)).toEqual(front.cards.map((c) => c.yMm));
  });

  it("separate: back pages appended after all front pages; none: fronts only", () => {
    const separate = layoutPdf(demoModel(), opts({ backs: "separate" }));
    expect(separate.pages.map((p) => p.side)).toEqual(["front", "front", "back", "back"]);
    const none = layoutPdf(demoModel(), opts({ backs: "none" }));
    expect(none.pages.map((p) => p.side)).toEqual(["front", "front"]);
  });

  it("cut lines are edge-to-edge and deduped at shared boundaries (spacing 0)", () => {
    const layout = layoutPdf(demoModel(), opts({ backs: "none" }));
    const page = layout.pages[0];
    const vertical = page.cutLines.filter((s) => s.x1Mm === s.x2Mm);
    const horizontal = page.cutLines.filter((s) => s.y1Mm === s.y2Mm);
    // 3 cols sharing edges → 4 distinct vertical cuts; 2 rows → 3 horizontal.
    expect(vertical).toHaveLength(4);
    expect(horizontal).toHaveLength(3);
    for (const s of vertical) expect([s.y1Mm, s.y2Mm]).toEqual([0, page.heightMm]);
    for (const s of horizontal) expect([s.x1Mm, s.x2Mm]).toEqual([0, page.widthMm]);
  });

  it("spacing > 0 draws a line along each edge of the gap", () => {
    const layout = layoutPdf(demoModel(), opts({ backs: "none", spacingMm: 5 }));
    const vertical = layout.pages[0].cutLines.filter((s) => s.x1Mm === s.x2Mm);
    // 2 cols with a gap → 2 outer edges + 2 gap edges = 4 distinct verticals.
    expect(vertical).toHaveLength(4);
  });

  it("cross marks: two segments per distinct corner", () => {
    const layout = layoutPdf(demoModel(), opts({ backs: "none" }));
    // 3×2 grid, spacing 0 → 4×3 = 12 distinct corners → 24 segments.
    expect(layout.pages[0].crossMarks).toHaveLength(24);
  });

  it("error cards are skipped and counted; faceSpecs cover every placement", () => {
    const rows = DEMO_PROJECT_ROWS.map((r) => ({ ...r }));
    rows[0] = { ...rows[0], cost: "abc" }; // Dragon rows → placeholders
    const result = compileProject(DEMO_PROJECT_SOURCE, { Monsters: rows }, {
      Monsters: [true, true],
    });
    const layout = layoutPdf(result.model, opts({}));
    expect(layout.skippedErrorCards).toBe(6);
    expect(layout.placedCards).toBe(3);
    for (const page of layout.pages) {
      for (const card of page.cards) {
        expect(layout.faceSpecs.has(card.imageKey)).toBe(true);
      }
    }
  });

  it("a deck that cannot fit is reported, not silently dropped", () => {
    const layout = layoutPdf(demoModel(), opts({ marginMm: 105 }));
    expect(layout.pages).toEqual([]);
    expect(layout.fitErrors).toMatchObject([{ deckName: "Monster" }]);
  });

  it("copies share one raster face per side", () => {
    const layout = layoutPdf(demoModel(), opts({ backs: "none" }));
    // 6 distinct faces (2 rows × 3 suits); 9 placements.
    expect(layout.faceSpecs.size).toBe(6);
    expect(layout.pages.reduce((n, p) => n + p.cards.length, 0)).toBe(9);
  });
});

describe("assemblePdf (node smoke with stub images)", () => {
  it("produces a PDF with the right page count and mm-exact page size", async () => {
    const layout = layoutPdf(demoModel(), opts({}));
    const images = new Map<string, Uint8Array>();
    for (const key of layout.faceSpecs.keys()) images.set(key, PNG_1PX);
    const bytes = await assemblePdf(layout, images, opts({}));
    expect(bytes.slice(0, 5)).toEqual(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])); // %PDF-
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(215.9 * (72 / 25.4), 3);
    expect(height).toBeCloseTo(279.4 * (72 / 25.4), 3);
  });

  it("throws on a missing face image instead of emitting a broken document", async () => {
    const layout = layoutPdf(demoModel(), opts({ backs: "none" }));
    await expect(assemblePdf(layout, new Map(), opts({}))).rejects.toThrow(/missing PNG/);
  });

  it("faceKey distinguishes sides of one card", () => {
    expect(faceKey("abc", "front")).not.toBe(faceKey("abc", "back"));
  });
});
