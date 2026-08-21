import { describe, expect, it } from "vitest";
import { compileProject } from "@/lib/lang";
import { DEMO_PROJECT_ROWS, DEMO_PROJECT_SOURCE } from "@/lib/lang/demoProject";
import {
  computeGrid,
  DEFAULT_PDF_OPTIONS,
  faceKey,
  GUIDE_STROKES,
  layoutPdf,
  pageNumberBoxPosition,
  pageNumberLabel,
  PAGE_SIZES,
  type PdfExportOptions,
} from "../pdfLayout";
import { assemblePdf, DOTTED_DASH_MM, MM_TO_PT } from "../pdfAssemble";

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

describe("page number placement", () => {
  it("stays inside the configured right margin and centers in the bottom margin", () => {
    const page = { widthMm: 215.9, heightMm: 279.4 };
    expect(pageNumberBoxPosition(page, 10)).toEqual({ xMm: 175.9, yMm: 271.4 });
    const zeroMargin = pageNumberBoxPosition(page, 0);
    expect(zeroMargin.xMm).toBe(182.9); // 3 mm minimum print inset
    expect(zeroMargin.yMm).toBe(271.4); // centered in a 10 mm fallback band
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
    expect(layout.sheetCount).toBe(2);
    expect(layout.pages.map((p) => p.sheetIndex)).toEqual([0, 0, 1, 1]);
    expect(layout.pages.map((p) => pageNumberLabel(p, layout.sheetCount))).toEqual([
      "1/2 front",
      "1/2 back",
      "2/2 front",
      "2/2 back",
    ]);
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
    expect(separate.pages.map((p) => p.sheetIndex)).toEqual([0, 1, 0, 1]);
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

  it("clamps cross-mark arms to the page box at sub-arm margins (1 mm probe)", () => {
    // margin 1 mm < CROSS_ARM_MM 1.5 mm: the top row's upward arms would
    // reach y = −0.5 mm unclamped and bleed off the page.
    const layout = layoutPdf(demoModel(), opts({ marginMm: 1 }));
    const segments = layout.pages.flatMap((p) => p.crossMarks);
    expect(segments.length).toBeGreaterThan(0);
    const { widthMm, heightMm } = layout.pages[0];
    for (const s of segments) {
      expect(Math.min(s.x1Mm, s.x2Mm)).toBeGreaterThanOrEqual(0);
      expect(Math.max(s.x1Mm, s.x2Mm)).toBeLessThanOrEqual(widthMm);
      expect(Math.min(s.y1Mm, s.y2Mm)).toBeGreaterThanOrEqual(0);
      expect(Math.max(s.y1Mm, s.y2Mm)).toBeLessThanOrEqual(heightMm);
    }
    // And the clamp really engaged: a top-corner arm now stops exactly at 0.
    expect(segments.some((s) => s.y1Mm === 0)).toBe(true);
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

  it("[card] copies (◆42): the divergent face rasterizes per copy, the shared face ONCE", () => {
    // Front reads [card] → every copy's contentHash differs, so hash-keyed
    // dedup alone would mint 5 bit-identical back specs. The generator shares
    // the static Back's Shape array by reference across copies; registerFace
    // dedupes on that reference, so the back stays a single spec/PNG.
    const result = compileProject(
      [
        "Sheet: Sh",
        "  column t: Text",
        "Template: F",
        "  Text:",
        "    x: 0",
        "    y: 0",
        "    size: 1",
        '    text: "[t] No. [card]"',
        "Template: B",
        "  Rectangle:",
        "    x: 0",
        "    y: 0",
        "    width: full",
        "    height: full",
        "    color: teal",
        "Card: Numbered",
        "  sheet: Sh",
        "  size: poker",
        "  x_units: 20",
        "  y_units: auto",
        "  count: 5",
        "  Front: F",
        "  Back: B",
      ].join("\n") + "\n",
      { Sh: [{ t: "x" }] },
    );
    expect(result.diagnostics).toEqual([]);
    const cards = result.model.decks[0].cards;
    // Premise (generate.ts MINOR-5): one shared back array across copies.
    expect(new Set(cards.map((c) => c.back)).size).toBe(1);

    const layout = layoutPdf(result.model, opts({}));
    expect(layout.placedCards).toBe(5);
    // 5 numbered fronts + exactly 1 shared back.
    const keys = [...layout.faceSpecs.keys()];
    expect(keys.filter((k) => k.endsWith(":front"))).toHaveLength(5);
    expect(keys.filter((k) => k.endsWith(":back"))).toHaveLength(1);
    expect(layout.faceSpecs.size).toBe(6);
    // Every copy's back page-slot resolves to that one key, and it is placed.
    const backKey = keys.find((k) => k.endsWith(":back"))!;
    const backSlots = layout.pages
      .filter((p) => p.side === "back")
      .flatMap((p) => p.cards.map((c) => c.imageKey));
    expect(backSlots).toHaveLength(5);
    for (const slot of backSlots) expect(slot).toBe(backKey);
    // And every placement (both sides) still resolves to a registered spec.
    for (const page of layout.pages) {
      for (const card of page.cards) {
        expect(layout.faceSpecs.has(card.imageKey)).toBe(true);
      }
    }
  });

  it("custom-size decks (§3.4 M2) lay out from their own mm — fit both ways", () => {
    const customModel = (widthMm: number, heightMm: number) => {
      const result = compileProject(
        [
          "Sheet: Sh",
          "  column t: Text",
          "Template: T",
          "  Text:",
          "    x: 0",
          "    y: 0",
          "    size: 1",
          "    text: [t]",
          "Card: Token",
          "  sheet: Sh",
          `  width_mm: ${widthMm}`,
          `  height_mm: ${heightMm}`,
          "  x_units: 10",
          "  y_units: auto",
          "  Front: T",
        ].join("\n") + "\n",
        { Sh: [{ t: "x" }] },
      );
      expect(result.diagnostics).toEqual([]);
      return result.model;
    };

    // 40×40 mm on letter, margin 10: ⌊195.9/40⌋ × ⌊259.4/40⌋ = 4 × 6 per page.
    const fits = layoutPdf(customModel(40, 40), opts({ backs: "none" }));
    expect(fits.fitErrors).toEqual([]);
    expect(fits.pages[0].cards[0]).toMatchObject({ widthMm: 40, heightMm: 40 });
    expect(computeGrid(PAGE_SIZES.letter, 10, 0, 40, 40)).toMatchObject({
      cols: 4,
      rows: 6,
    });

    // 250 mm exceeds letter's printable width → the fit error carries the mm.
    const tooBig = layoutPdf(customModel(250, 250), opts({ backs: "none" }));
    expect(tooBig.pages).toEqual([]);
    expect(tooBig.fitErrors).toMatchObject([
      { deckName: "Token", cardWidthMm: 250, cardHeightMm: 250 },
    ]);
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

  it("adds native text labels only when page numbering is enabled", async () => {
    const without = await pageOperators(await assembleDemo({ pageNumbers: false }), 0);
    const withNumbers = await pageOperators(await assembleDemo({ pageNumbers: true }), 0);
    expect(without).not.toMatch(/\bTj\b/);
    expect(withNumbers).toMatch(/\bTj\b/);
  });

  it("faceKey distinguishes sides of one card", () => {
    expect(faceKey("abc", "front")).not.toBe(faceKey("abc", "back"));
  });
});

/**
 * The assembler draws guides itself (pdf-lib `drawLine`) while the export
 * modal's preview draws them as SVG (pdfPagePreview). The SEGMENTS and the
 * STROKE SPEC are shared — but the two draw calls are not, so this is the one
 * place the preview could quietly stop matching the file. These tests pin the
 * PDF side to the same constants the preview imports.
 *
 * Reading the drawing back means inflating the page's content stream and
 * counting operators; the numbers are matched loosely (pdf-lib prints full
 * float precision), so only the VALUES are asserted, never their formatting.
 */
async function pageOperators(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const { inflateSync } = await import("node:zlib");
  const { PDFDocument, PDFArray, PDFStream } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(pageIndex).node.Contents();
  const parts =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  return parts
    .map((part) => (part instanceof PDFStream ? part.getContents() : new Uint8Array()))
    .map((raw) => {
      const buffer = Buffer.from(raw);
      // Content streams are Flate-compressed on save; a future pdf-lib that
      // stops compressing them should still read fine.
      try {
        return inflateSync(buffer).toString("latin1");
      } catch {
        return buffer.toString("latin1");
      }
    })
    .join("\n");
}

const strokeCount = (ops: string): number => (ops.match(/^S$/gm) ?? []).length;
const strokeWidthsPt = (ops: string): number[] =>
  [...ops.matchAll(/^([\d.]+) w$/gm)].map((m) => Number(m[1]));
const dashArraysPt = (ops: string): number[][] =>
  [...ops.matchAll(/^\[([^\]]*)\] \d+ d$/gm)].map((m) =>
    m[1].trim().split(/\s+/).filter(Boolean).map(Number),
  );

async function assembleDemo(overrides: Partial<PdfExportOptions>): Promise<Uint8Array> {
  const options = opts(overrides);
  const layout = layoutPdf(demoModel(), options);
  const images = new Map<string, Uint8Array>();
  for (const key of layout.faceSpecs.keys()) images.set(key, PNG_1PX);
  return assemblePdf(layout, images, options);
}

describe("assemblePdf guides (shared spec with the modal's page preview)", () => {
  it("strokes one dotted line per cut-line segment, at the shared width and dash", async () => {
    const layout = layoutPdf(demoModel(), opts({}));
    const ops = await pageOperators(await assembleDemo({}), 0);

    // Every segment layoutPdf computed is drawn — the same array the preview
    // renders as <line> elements.
    expect(strokeCount(ops)).toBe(layout.pages[0].cutLines.length);
    for (const width of strokeWidthsPt(ops)) {
      expect(width).toBeCloseTo(GUIDE_STROKES.dotted.widthMm * MM_TO_PT, 6);
    }
    // The dash pattern the preview reads from DOTTED_DASH_MM, in points.
    const expectedDash = DOTTED_DASH_MM.map((mm) => mm * MM_TO_PT);
    expect(dashArraysPt(ops).length).toBeGreaterThan(0);
    for (const dash of dashArraysPt(ops)) {
      expect(dash).toHaveLength(expectedDash.length);
      dash.forEach((value, i) => expect(value).toBeCloseTo(expectedDash[i], 6));
    }
  });

  it("draws guides on BACK pages too (§6.1), from the mirrored grid", async () => {
    const layout = layoutPdf(demoModel(), opts({}));
    const back = layout.pages[1];
    expect(back.side).toBe("back");
    const ops = await pageOperators(await assembleDemo({}), 1);
    expect(strokeCount(ops)).toBe(back.cutLines.length);
  });

  it("draws bold guides solid at 0.5 mm — style really reaches the page", async () => {
    const ops = await pageOperators(await assembleDemo({ cutLines: "bold" }), 0);
    // Solid: pdf-lib still writes a dash operator, with an EMPTY array.
    expect(dashArraysPt(ops).flat()).toEqual([]);
    for (const width of strokeWidthsPt(ops)) {
      expect(width).toBeCloseTo(GUIDE_STROKES.bold.widthMm * MM_TO_PT, 6);
    }
  });

  it("strokes nothing when both guide styles are off", async () => {
    const ops = await pageOperators(await assembleDemo({ cutLines: "off", crossMarks: "off" }), 0);
    expect(strokeCount(ops)).toBe(0);
  });
});
