/**
 * Generator semantics (DESIGN.md §3.7, §3.8 D001–D008, §4.1): the §3.9 demo
 * fixture end to end, cell validation, pristine rows (◆29), cross-product
 * order (⚑1/◆25), both expansion caps (◆27†), content-hash determinism
 * (§4.1 †), and the never-throws contract (⚑8).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../check";
import type {
  EditedRows,
  IconShape,
  ImageShape,
  ProjectResult,
  QrShape,
  RectShape,
  SheetRows,
  TextBoxShape,
  TextShape,
} from "../index";
import {
  GEIST_METRICS,
  SIZE_PRESETS,
  compileProject,
  generateModel,
  measureText,
  metricsForFace,
} from "../index";
import { parse } from "../parser";
import { CARD_CAP } from "../generate";
import { encodeQr, resetQrCacheForTests } from "../qr";

const demoSource = readFileSync(
  fileURLToPath(new URL("./fixtures/demo.goblin", import.meta.url)),
  "utf8",
);

/** The DESIGN.md §3.9 acceptance rows: (Dragon, 5, 4, 2) and (Imp, 1, 2, 1). */
const demoRows = (): SheetRows => ({
  Monsters: [
    { name: "Dragon", cost: "5", health: "4", count: "2" },
    { name: "Imp", cost: "1", health: "2", count: "1" },
  ],
});

// -- helpers ----------------------------------------------------------------

const src = (...lines: string[]): string => lines.join("\n") + "\n";

/** compileProject asserting zero compile ERRORS (warnings allowed). */
function projectOf(code: string, sheets: SheetRows): ProjectResult {
  const result = compileProject(code, sheets);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return result;
}

const CARD_LINES = [
  "Card: C",
  "  sheet: Sh",
  "  size: poker",
  "  x_units: 20",
  "  y_units: auto",
];

const sheetLines = (columns: string[]): string[] => [
  "Sheet: Sh",
  ...columns.map((c) => `  column ${c}`),
];

const textTemplate = (expr: string): string[] => [
  "Template: T",
  "  Text:",
  "    x: 0",
  "    y: 0",
  "    size: 1",
  `    text: ${expr}`,
];

interface MiniOpts {
  enums?: string[];
  cardExtra?: string[];
}

/** Minimal project: Sheet Sh + Template T (one Text showing `expr`) + Card C
 * (poker, 20 × auto). */
function textProject(
  expr: string,
  columns: string[],
  rows: Record<string, string>[],
  opts: MiniOpts = {},
): ProjectResult {
  const code = src(
    ...(opts.enums ?? []),
    ...sheetLines(columns),
    ...textTemplate(expr),
    ...CARD_LINES,
    ...(opts.cardExtra ?? []).map((l) => `  ${l}`),
    "  Front: T",
  );
  return projectOf(code, { Sh: rows });
}

const dataCodes = (p: ProjectResult): string[] => p.dataDiagnostics.map((d) => d.code);
const errorCodes = (p: ProjectResult, cardIndex = 0): string[] | undefined =>
  p.model.decks[0]?.cards[cardIndex]?.error?.diagnostics.map((d) => d.code);

// -- the acceptance fixture (§3.9) ------------------------------------------

describe("demo fixture end to end (§3.9)", () => {
  const p = compileProject(demoSource, demoRows());
  const deck = p.model.decks[0];

  it("compiles clean and produces one poker deck: 63.5×88.9 mm, 20 × exactly 28 units", () => {
    expect(p.diagnostics).toEqual([]);
    expect(p.model.decks).toHaveLength(1);
    expect(deck.cardName).toBe("Monster");
    expect(deck.widthMm).toBe(63.5);
    expect(deck.heightMm).toBe(88.9);
    expect(deck.xUnits).toBe(20);
    expect(deck.yUnits).toBe(28); // ⚑7†: poker@20 → 28 EXACTLY
  });

  it("generates 9 instances: 2 rows × 3 suits, ×(2,1) copies, row-major", () => {
    expect(deck.cards).toHaveLength(9);
    expect(
      deck.cards.map((c) => [
        c.meta.rowIndex,
        c.meta.loopBindings.current_suit.case,
        c.meta.copyIndex,
      ]),
    ).toEqual([
      [0, "Rock", 0],
      [0, "Rock", 1],
      [0, "Paper", 0],
      [0, "Paper", 1],
      [0, "Scissors", 0],
      [0, "Scissors", 1],
      [1, "Rock", 0],
      [1, "Paper", 0],
      [1, "Scissors", 0],
    ]);
    expect(deck.cards[0].meta.loopBindings).toEqual({
      current_suit: { enum: "Suit", case: "Rock" },
    });
  });

  it("has exactly 6 distinct faces by content hash; copies share theirs", () => {
    const hashes = deck.cards.map((c) => c.contentHash);
    expect(new Set(hashes).size).toBe(6);
    expect(hashes[0]).toBe(hashes[1]); // Dragon×Rock copies
    expect(hashes[0]).not.toBe(hashes[2]); // Dragon×Paper differs
  });

  it("banner color follows the suit if-chain: grey / gold / mediumpurple", () => {
    const bannerColor = (i: number): string => (deck.cards[i].front[0] as RectShape).color;
    expect(bannerColor(0)).toBe("grey");
    expect(bannerColor(2)).toBe("gold");
    expect(bannerColor(4)).toBe("mediumpurple");
    const banner = deck.cards[0].front[0] as RectShape;
    expect(banner).toEqual({
      kind: "rect",
      x: 0,
      y: 0,
      width: 20,
      height: 3,
      color: "grey",
      pivot: { h: "left", v: "top" }, // §3.4 default, materialized
    });
  });

  it("title: `x: middle` centers at x=10 and forces pivot middle", () => {
    const title = deck.cards[0].front[1] as TextShape;
    expect(title).toEqual({
      kind: "text",
      x: 10,
      y: 0.7,
      size: 1.6,
      color: "black",
      text: "Dragon",
      pivot: { h: "center", v: "top" }, // the sugar centers horizontally (§3.4)
      font: "geist", // no font: in the demo → the §3.3 default (◆41)
    });
  });

  it("cost interpolates: 'Cost: 5' right-pivoted at x 19", () => {
    const cost = deck.cards[0].front[2] as TextShape;
    expect(cost.text).toBe("Cost: 5");
    expect(cost.x).toBe(19);
    expect(cost.pivot).toEqual({ h: "right", v: "top" }); // legacy alias ≡ top_right
    expect((deck.cards[6].front[2] as TextShape).text).toBe("Cost: 1");
  });

  it("attack icon: SWORDS, white, default left pivot and flat_dark style", () => {
    const attack = deck.cards[0].front[3] as IconShape;
    expect(attack).toEqual({
      kind: "icon",
      x: 1,
      y: 0.7,
      size: 1.6,
      color: "white",
      code: "SWORDS",
      pivot: { h: "left", v: "top" },
      style: "flat_dark", // no style: in the demo → the §3.3 default
    });
  });

  it("hearts: [health] icons at x = 1.5 + i×2 (Dragon 4, Imp 2)", () => {
    const dragonHearts = deck.cards[0].front.slice(4) as IconShape[];
    expect(dragonHearts.map((h) => h.x)).toEqual([1.5, 3.5, 5.5, 7.5]);
    for (const heart of dragonHearts) {
      expect(heart).toMatchObject({ kind: "icon", y: 25, size: 1.8, color: "red", code: "HEARTS" });
    }
    const impHearts = deck.cards[6].front.slice(4) as IconShape[];
    expect(impHearts.map((h) => h.x)).toEqual([1.5, 3.5]);
  });

  it("PlainBack: one full-card teal rect using the exact 28-unit height", () => {
    expect(deck.cards[0].back).toEqual([
      { kind: "rect", x: 0, y: 0, width: 20, height: 28, color: "teal", pivot: { h: "left", v: "top" } },
    ]);
  });

  it("has no data diagnostics and no pristine exclusions", () => {
    expect(p.dataDiagnostics).toEqual([]);
    expect(p.excludedPristineRows).toEqual({});
  });

  it("BYTE-IDENTICAL demo output (§3.3, ◆41): the fixture writes no font:, so every Text shape defaults to geist", () => {
    // The demo source itself is unchanged (demo.test.ts pins it byte-for-byte
    // against demoProject.ts) and has no `font:` anywhere — this is the other
    // half of that guarantee: recompiling it must not silently CHANGE what
    // gets drawn, only ADD the new field at its pre-existing default. Every
    // text-bearing shape across every card must agree on exactly "geist".
    for (const card of deck.cards) {
      for (const shape of [...card.front, ...card.back]) {
        if (shape.kind === "text" || shape.kind === "textbox") {
          expect(shape.font).toBe("geist");
        }
      }
    }
  });
});

// -- geometry (§3.4 ⚑7†) ----------------------------------------------------

describe("geometry resolution: full / half / middle, fractional y (⚑7†)", () => {
  const geoProject = (): ProjectResult =>
    projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Rectangle:",
        "    x: half",
        "    y: half",
        "    width: full - 2",
        "    height: full",
        "    color: teal",
        "  Text:",
        "    x: middle",
        "    y: 0",
        "    size: half",
        "    pivot: right",
        "    text: [t]",
        "Card: C",
        "  sheet: Sh",
        "  size: tarot",
        "  x_units: 20",
        "  y_units: auto",
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );

  it("tarot y_units auto is exactly 240/7 and full-height rects use it", () => {
    const deck = geoProject().model.decks[0];
    expect(deck.yUnits).toBe(240 / 7); // ≈ 34.2857… — the exact fractional value
    const rect = deck.cards[0].front[0] as RectShape;
    expect(rect.height).toBe(240 / 7);
    expect(rect.y).toBe(120 / 7); // half of the Y axis
  });

  it("full/half resolve per axis: x/width on X, y/height on Y", () => {
    const rect = geoProject().model.decks[0].cards[0].front[0] as RectShape;
    expect(rect.x).toBe(10); // half of 20 X units
    expect(rect.width).toBe(18); // full - 2 as a subexpression
  });

  it("`size: half` uses the X axis (documented decision), not the fractional Y", () => {
    const text = geoProject().model.decks[0].cards[0].front[1] as TextShape;
    expect(text.size).toBe(10);
  });

  it("`x: middle` wins over an explicit pivot's horizontal word (documented decision)", () => {
    const text = geoProject().model.decks[0].cards[0].front[1] as TextShape;
    expect(text.x).toBe(10);
    // The written `pivot: right` loses its horizontal say; its vertical
    // component (top, from the legacy alias) stands (§3.4).
    expect(text.pivot).toEqual({ h: "center", v: "top" });
  });

  it("an explicit integer y_units flows through (W003 warning, not an error)", () => {
    const p = projectOf(
      src(
        ...sheetLines(["t: Text"]),
        ...textTemplate("[t]"),
        "Card: C",
        "  sheet: Sh",
        "  size: poker",
        "  x_units: 20",
        "  y_units: 30",
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );
    expect(p.diagnostics.map((d) => d.code)).toContain("W003");
    expect(p.model.decks[0].yUnits).toBe(30);
  });

  it("colors: #hex passes through as written, named colors lower-cased", () => {
    const p = projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Rectangle:",
        "    x: 0",
        "    y: 0",
        "    width: 1",
        "    height: 1",
        "    color: #A1b2C3",
        "  Text:",
        "    x: 0",
        "    y: 0",
        "    size: 1",
        "    color: RED",
        "    text: [t]",
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );
    const [rect, text] = p.model.decks[0].cards[0].front as [RectShape, TextShape];
    expect(rect.color).toBe("#A1b2C3");
    expect(text.color).toBe("red");
  });

  it("absent Back (◆16) → a single full-card white rect generated here", () => {
    const p = textProject("[t]", ["t: Text"], [{ t: "x" }]);
    expect(p.model.decks[0].cards[0].back).toEqual([
      { kind: "rect", x: 0, y: 0, width: 20, height: 28, color: "white", pivot: { h: "left", v: "top" } },
    ]);
  });
});

// -- the built-in presets (§3.4) --------------------------------------------

describe("every size preset reaches the RenderModel intact (§3.4)", () => {
  // Sweeps the map rather than naming presets: a size added to SIZE_PRESETS
  // gets these guarantees automatically, which is the point — a preset that
  // isn't exact in mm-hundredths would be a size the language ships but its
  // own custom-size rule rejects, and `y_units: auto` would stop being square.
  for (const [name, preset] of SIZE_PRESETS) {
    it(`${name} → ${preset.widthMm}×${preset.heightMm} mm, square auto units`, () => {
      const p = projectOf(
        src(
          ...sheetLines(["t: Text"]),
          ...textTemplate("[t]"),
          "Card: C",
          "  sheet: Sh",
          `  size: ${name}`,
          "  x_units: 20",
          "  y_units: auto",
          "  Front: T",
        ),
        { Sh: [{ t: "x" }] },
      );
      const deck = p.model.decks[0];
      expect(deck.widthMm).toBe(preset.widthMm);
      expect(deck.heightMm).toBe(preset.heightMm);

      // Exact in hundredths of a millimetre — the floor custom sizes are held
      // to (E008), and what keeps the unit math off non-finite numbers.
      for (const mm of [preset.widthMm, preset.heightMm]) {
        expect(mm * 100, `${name}: ${mm} mm`).toBe(Math.round(mm * 100));
        expect(mm).toBeGreaterThanOrEqual(0.01);
      }

      // ⚑7†: auto y_units is exactly x_units × height/width in mm-hundredths.
      expect(deck.yUnits).toBe(
        (20 * Math.round(preset.heightMm * 100)) / Math.round(preset.widthMm * 100),
      );
      expect(Number.isFinite(deck.yUnits)).toBe(true);
    });
  }
});

// -- custom card sizes (§3.4, M2) -------------------------------------------

describe("custom card sizes flow to the RenderModel (§3.4 M2)", () => {
  it("width_mm/height_mm reach the Deck; auto y_units stays exact", () => {
    const p = projectOf(
      src(
        ...sheetLines(["t: Text"]),
        ...textTemplate("[t]"),
        "Card: C",
        "  sheet: Sh",
        "  width_mm: 40",
        "  height_mm: 60",
        "  x_units: 20",
        "  y_units: auto",
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );
    const deck = p.model.decks[0];
    expect(deck.widthMm).toBe(40);
    expect(deck.heightMm).toBe(60);
    // Units square (⚑7†): 20 × 60/40 — exactly 30, custom sizes included.
    expect(deck.yUnits).toBe(30);
    // The synthetic default back spans the custom grid exactly (◆16).
    expect(deck.cards[0].back).toEqual([
      { kind: "rect", x: 0, y: 0, width: 20, height: 30, color: "white", pivot: { h: "left", v: "top" } },
    ]);
  });

  it("an incomplete pair binds no size → NO deck (compile errors own it)", () => {
    const p = compileProject(
      src(
        ...sheetLines(["t: Text"]),
        ...textTemplate("[t]"),
        "Card: C",
        "  sheet: Sh",
        "  width_mm: 40",
        "  x_units: 20",
        "  y_units: auto",
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );
    expect(p.diagnostics.some((d) => d.code === "E008")).toBe(true);
    expect(p.model.decks).toEqual([]);
  });
});

// -- Icon style: (§3.3, M2) --------------------------------------------------

describe("Icon style: flows to the shape (§3.3 M2)", () => {
  const iconProject = (styleLine: string[]): ProjectResult =>
    projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Icon:",
        "    x: 1",
        "    y: 1",
        "    size: 2",
        '    code: "HEARTS"',
        ...styleLine.map((l) => `    ${l}`),
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );

  it("a declared style reaches the IconShape", () => {
    const icon = iconProject(["style: round_heavy"]).model.decks[0].cards[0]
      .front[0] as IconShape;
    expect(icon.style).toBe("round_heavy");
  });

  it("omitted style defaults to flat_dark (§3.3)", () => {
    const icon = iconProject([]).model.decks[0].cards[0].front[0] as IconShape;
    expect(icon.style).toBe("flat_dark");
  });

  it("a style change changes the contentHash (styles are visible content)", () => {
    const flat = iconProject(["style: flat_dark"]).model.decks[0].cards[0];
    const pixel = iconProject(["style: pixel"]).model.decks[0].cards[0];
    expect(flat.contentHash).not.toBe(pixel.contentHash);
  });
});

// -- Text/TextBox font: (§3.3 M3, ◆41) — Icon style: is the closest stencil --

describe("Text/TextBox font: flows to the shape (§3.3 M3, ◆41)", () => {
  const textProject = (fontLine: string[]): ProjectResult =>
    projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Text:",
        "    x: 1",
        "    y: 1",
        "    size: 2",
        '    text: "hello"',
        ...fontLine.map((l) => `    ${l}`),
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );

  const boxProject = (fontLine: string[]): ProjectResult =>
    projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  TextBox:",
        "    x: 1",
        "    y: 1",
        "    width: 10",
        "    height: 6",
        '    text: "hello there"',
        "    size: 1",
        ...fontLine.map((l) => `    ${l}`),
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );

  it("a declared font reaches the TextShape", () => {
    const text = textProject(["font: garamond_bold"]).model.decks[0].cards[0]
      .front[0] as TextShape;
    expect(text.font).toBe("garamond_bold");
  });

  it("omitted font defaults to geist on Text (§3.3, ◆41 — unchanged pre-existing behavior)", () => {
    const text = textProject([]).model.decks[0].cards[0].front[0] as TextShape;
    expect(text.font).toBe("geist");
  });

  it("a font change changes the contentHash on Text (fonts are visible content)", () => {
    const geist = textProject(["font: geist"]).model.decks[0].cards[0];
    const courier = textProject(["font: courier"]).model.decks[0].cards[0];
    expect(geist.contentHash).not.toBe(courier.contentHash);
  });

  it("explicit font: geist ≡ omitted on Text — same contentHash (the style/fit precedent)", () => {
    expect(textProject(["font: geist"]).model.decks[0].cards[0].contentHash).toBe(
      textProject([]).model.decks[0].cards[0].contentHash,
    );
  });

  it("a declared font reaches the TextBoxShape", () => {
    const box = boxProject(["font: courier"]).model.decks[0].cards[0].front[0] as TextBoxShape;
    expect(box.font).toBe("courier");
  });

  it("omitted font defaults to geist on TextBox (§3.3, ◆41 — unchanged pre-existing behavior)", () => {
    const box = boxProject([]).model.decks[0].cards[0].front[0] as TextBoxShape;
    expect(box.font).toBe("geist");
  });

  it("a font change changes the contentHash on TextBox (fonts are visible content)", () => {
    const geist = boxProject(["font: geist"]).model.decks[0].cards[0];
    const garamond = boxProject(["font: garamond"]).model.decks[0].cards[0];
    expect(geist.contentHash).not.toBe(garamond.contentHash);
  });

  it("explicit font: geist ≡ omitted on TextBox — same contentHash", () => {
    expect(boxProject(["font: geist"]).model.decks[0].cards[0].contentHash).toBe(
      boxProject([]).model.decks[0].cards[0].contentHash,
    );
  });

  /** A TextBox with ONLY width/text/font varying — the wrapping-correctness
   * test below needs full control over width and text, unlike boxProject
   * (fixed width 10 / text "hello there") above. */
  const wrapProject = (font: string): ProjectResult =>
    projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  TextBox:",
        "    x: 1",
        "    y: 1",
        "    width: 5",
        "    height: 6",
        '    text: "mint mint mint"',
        "    size: 1",
        `    font: ${font}`,
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );

  // -- THE test that proves the feature works: identical text, identical box,
  // wraps to a DIFFERENT number of lines depending on font: — because eval.ts
  // routes metricsForFace(font) into layoutTextBox, not a hardcoded Geist
  // table (§7.2's "compiler is the wrapping authority" only holds if the
  // authority actually consults the right font). Hand-verified against the
  // committed tables (metrics.test.ts pins their byte-identity), independent
  // of wrapText/measureText's own logic:
  //   GEIST (unitsPerEm 1000):   m=877 i=244 n=581 t=395 space=250
  //   COURIER (unitsPerEm 2048): every one of those = 1228 (monospace)
  // "mint" measures (× 1.02 margin ÷ unitsPerEm): Geist 2.139, Courier 2.446.
  // "mint mint": Geist 4.533 (fits a 5-unit box), Courier 5.504 (does NOT).
  // So at width 5, size 1: Geist fits two "mint"s per line (2 lines total);
  // Courier's wider, uniformly-spaced glyphs fit only one (3 lines total).
  it("the SAME text in the SAME box wraps differently in Courier vs Geist (§7.2)", () => {
    const geistBox = wrapProject("geist").model.decks[0].cards[0].front[0] as TextBoxShape;
    const courierBox = wrapProject("courier").model.decks[0].cards[0].front[0] as TextBoxShape;

    expect(geistBox.lines).toEqual(["mint mint", "mint"]);
    expect(courierBox.lines).toEqual(["mint", "mint", "mint"]);
    expect(geistBox.lines.length).not.toBe(courierBox.lines.length);
    expect(geistBox.clipped).toBe(false);
    expect(courierBox.clipped).toBe(false);

    // Cross-check with the wrap engine's OWN measurement (belt and suspenders
    // — the hand math above and measureText must agree on why each line fits).
    for (const line of geistBox.lines) {
      expect(measureText(line, 1, metricsForFace("geist"))).toBeLessThanOrEqual(5);
    }
    for (const line of courierBox.lines) {
      expect(measureText(line, 1, metricsForFace("courier"))).toBeLessThanOrEqual(5);
    }
    // And the DECISIVE cross-check: "mint mint" fits Geist's own table but
    // overflows Courier's — that asymmetry is the entire reason the two
    // faces wrap differently, so assert it directly rather than just trusting
    // the line arrays above.
    expect(measureText("mint mint", 1, metricsForFace("geist"))).toBeLessThanOrEqual(5);
    expect(measureText("mint mint", 1, metricsForFace("courier"))).toBeGreaterThan(5);
  });
});

// -- Image (§3.3, M2) --------------------------------------------------------

describe("Image flows to the shape (§3.3 M2)", () => {
  const imageProject = (extra: string[], row: Record<string, string> = { t: "x" }): ProjectResult =>
    projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Image:",
        "    x: 1",
        "    y: 2",
        "    width: half",
        "    height: full",
        '    src: "img/[t].png"',
        ...extra.map((l) => `    ${l}`),
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [row] },
    );

  it("resolves geometry per axis and src through interpolation", () => {
    const image = imageProject([], { t: "dragon" }).model.decks[0].cards[0]
      .front[0] as ImageShape;
    // width: half is the X axis (20 units → 10); height: full the Y axis.
    expect(image).toEqual({
      kind: "image",
      x: 1,
      y: 2,
      width: 10,
      height: 28,
      src: "img/dragon.png",
      fit: "contain",
      pivot: { h: "left", v: "top" },
    });
  });

  it("omitted fit is MATERIALIZED as contain — the shape always carries a concrete fit", () => {
    const image = imageProject([]).model.decks[0].cards[0].front[0] as ImageShape;
    expect(image.fit).toBe("contain");
  });

  it("a declared fit reaches the ImageShape", () => {
    const image = imageProject(["fit: stretch"]).model.decks[0].cards[0]
      .front[0] as ImageShape;
    expect(image.fit).toBe("stretch");
  });

  it("src and fit changes change the contentHash (both are visible content)", () => {
    const base = imageProject([]).model.decks[0].cards[0];
    const otherSrc = imageProject([], { t: "y" }).model.decks[0].cards[0];
    const otherFit = imageProject(["fit: cover"]).model.decks[0].cards[0];
    expect(base.contentHash).not.toBe(otherSrc.contentHash);
    expect(base.contentHash).not.toBe(otherFit.contentHash);
  });
});

// -- Image auto dimension (§3.3, 2026-08-10) ----------------------------------

describe("Image auto dimension flows to the shape (§3.3)", () => {
  const autoProject = (dims: string[]): ProjectResult =>
    compileProject(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Image:",
        "    x: 1",
        "    y: 2",
        ...dims.map((l) => `    ${l}`),
        '    src: "img/[t].png"',
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );

  it("the shape carries the KEYWORD — auto is the renderer's to resolve, never a number here", () => {
    const result = autoProject(["width: full", "height: auto"]);
    expect(result.diagnostics).toEqual([]);
    const image = result.model.decks[0].cards[0].front[0] as ImageShape;
    expect(image.width).toBe(20); // full on the X axis
    expect(image.height).toBe("auto"); // verbatim keyword, not a resolved unit count
  });

  it("auto width mirrors: numeric height, keyword width", () => {
    const result = autoProject(["width: auto", "height: 6"]);
    expect(result.diagnostics).toEqual([]);
    const image = result.model.decks[0].cards[0].front[0] as ImageShape;
    expect(image.width).toBe("auto");
    expect(image.height).toBe(6);
  });

  it("the hash distinguishes auto from any number — they are different visible content", () => {
    // height: auto vs the number the same box might resolve to: the model
    // cannot know the art's ratio, so the two must never collide.
    const auto = autoProject(["width: 16", "height: auto"]).model.decks[0].cards[0];
    const sixteen = autoProject(["width: 16", "height: 16"]).model.decks[0].cards[0];
    const eight = autoProject(["width: 16", "height: 8"]).model.decks[0].cards[0];
    expect(auto.contentHash).not.toBe(sixteen.contentHash);
    expect(auto.contentHash).not.toBe(eight.contentHash);
  });

  it("BOTH auto: E008 owns the surface and the instance degrades to a D000 placeholder", () => {
    const result = autoProject(["width: auto", "height: auto"]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["E008"]);
    // The deck still generates (essentials resolved); the poisoned element
    // degrades exactly one instance to the compile-error placeholder — a
    // model can never carry a two-auto shape.
    const card = result.model.decks[0].cards[0];
    expect(card.front).toEqual([]);
    expect(card.error?.diagnostics[0].code).toBe("D000");
  });
});

// -- Qr (§7.1a) ----------------------------------------------------------------

describe("Qr flows to the shape (§7.1a)", () => {
  const qrProject = (extra: string[], row: Record<string, string> = { t: "x" }): ProjectResult =>
    projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Qr:",
        "    x: 1",
        "    y: 2",
        "    size: half",
        '    data: "card/[t]"',
        ...extra.map((l) => `    ${l}`),
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [row] },
    );

  it("resolves geometry (size on the X axis, the Icon-size precedent) and data through interpolation", () => {
    const qr = qrProject([], { t: "dragon" }).model.decks[0].cards[0].front[0] as QrShape;
    const expected = encodeQr("card/dragon", "m")!;
    expect(qr).toEqual({
      kind: "qr",
      x: 1,
      y: 2,
      size: 10, // half of 20 X units
      color: "black",
      background: "white",
      pivot: { h: "left", v: "top" },
      moduleCount: expected.moduleCount,
      modules: expected.modules,
    });
  });

  it("omitted color/background/level are MATERIALIZED to black/white/m", () => {
    const qr = qrProject([]).model.decks[0].cards[0].front[0] as QrShape;
    expect(qr.color).toBe("black");
    expect(qr.background).toBe("white");
    expect(qr.modules).toBe(encodeQr("card/x", "m")!.modules);
  });

  it("declared color/background/level reach the shape, and level changes the encoding", () => {
    const qr = qrProject(["color: red", "background: navy", "level: h"]).model.decks[0].cards[0]
      .front[0] as QrShape;
    expect(qr.color).toBe("red");
    expect(qr.background).toBe("navy");
    expect(qr.modules).toBe(encodeQr("card/x", "h")!.modules);
  });

  it("data and level changes change the contentHash; the same inputs hash identically", () => {
    const base = qrProject([]).model.decks[0].cards[0];
    const again = qrProject([]).model.decks[0].cards[0];
    const otherData = qrProject([], { t: "y" }).model.decks[0].cards[0];
    const otherLevel = qrProject(["level: h"]).model.decks[0].cards[0];
    expect(again.contentHash).toBe(base.contentHash);
    expect(otherData.contentHash).not.toBe(base.contentHash);
    expect(otherLevel.contentHash).not.toBe(base.contentHash);
  });

  it("empty-string data encodes normally — a valid tiny QR, no special case (§7.1a)", () => {
    const result = projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Qr:",
        "    x: 0",
        "    y: 0",
        "    size: 5",
        '    data: ""',
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );
    const card = result.model.decks[0].cards[0];
    expect(card.error).toBeUndefined();
    const qr = card.front[0] as QrShape;
    expect(qr.modules).toBe(encodeQr("", "m")!.modules);
  });
});

// -- D009 — QR data too long for one code -------------------------------------

describe("D009 — QR data too long for one code", () => {
  const qrTooLongSource = (): string =>
    src(
      ...sheetLines(["t: Text"]),
      "Template: T",
      "  Qr:",
      "    x: 0",
      "    y: 0",
      "    size: 5",
      "    data: [t]",
      "    level: h",
      ...CARD_LINES,
      "  Front: T",
    );

  it("data exceeding the level's capacity → one placeholder with D009 + cardRef", () => {
    const p = projectOf(qrTooLongSource(), { Sh: [{ t: "x".repeat(3000) }] });
    const card = p.model.decks[0].cards[0];
    expect(card.error?.diagnostics.map((d) => d.code)).toEqual(["D009"]);
    expect(card.error?.diagnostics[0].message).toBe("QR data is too long for one code");
    expect(p.dataDiagnostics.map((d) => d.code)).toEqual(["D009"]);
    expect(p.dataDiagnostics[0].cardRef).toEqual({ deck: "C", deckIndex: 0, cardIndex: 0 });
    expect(p.dataDiagnostics[0].cell).toBeUndefined(); // computed-value diagnostic (§3.8 †)
  });

  it("one row's overlong data does not affect a sibling row (⚑8 isolation)", () => {
    const p = projectOf(qrTooLongSource(), {
      Sh: [{ t: "x".repeat(3000) }, { t: "short" }],
    });
    const cards = p.model.decks[0].cards;
    expect(cards).toHaveLength(2);
    expect(cards[0].error?.diagnostics.map((d) => d.code)).toEqual(["D009"]);
    expect(cards[1].error).toBeUndefined();
    expect((cards[1].front[0] as QrShape).kind).toBe("qr");
  });
});

// -- QR cache perf regression (adversarial review, 2026-08-13) ---------------

describe("QR cache — warm recompile stays inside the debounce at CARD_CAP scale", () => {
  it("a CARD_CAP-sized deck of DISTINCT QR codes recompiles warm in well under 150ms", () => {
    // Regression for the cache-cliff bug: qr.ts's old CACHE_LIMIT (1000) was
    // exactly HALF of CARD_CAP (2000), and clear-on-overflow meant the cache
    // held NOTHING once a full-size deck finished compiling — so even a
    // "warm" recompile with IDENTICAL data re-encoded all 2000 QR codes
    // synchronously (measured ~1.1s), stalling every debounced keystroke
    // (300ms). This drives the REAL pipeline (parse + check + generate), not
    // just encodeQr, so the bound covers everything a keystroke actually
    // pays for.
    resetQrCacheForTests();
    const code = src(
      ...sheetLines(["t: Text"]),
      "Template: T",
      "  Qr:",
      "    x: 0",
      "    y: 0",
      "    size: 5",
      "    data: [t]",
      ...CARD_LINES,
      "  Front: T",
    );
    const rows = Array.from({ length: CARD_CAP }, (_, i) => ({ t: `payload-${i}` }));
    const sheets: SheetRows = { Sh: rows };

    // Cold pass: populates the cache with CARD_CAP distinct encodings.
    const cold = projectOf(code, sheets);
    expect(cold.model.decks[0].cards).toHaveLength(CARD_CAP);

    // Warm pass: identical data — every encodeQr call should be a cache hit
    // (the scenario a debounced recompile after an unrelated keystroke hits).
    const startedAt = performance.now();
    const warm = projectOf(code, sheets);
    const elapsedMs = performance.now() - startedAt;

    expect(warm.model.decks[0].cards).toHaveLength(CARD_CAP);
    expect(elapsedMs).toBeLessThan(150); // generous CI bound; old code: ~1.1s
    resetQrCacheForTests();
  });
});

// -- nine-point pivots (§3.4, M3) ---------------------------------------------

describe("nine-point pivot flows to the shape (§3.4 M3)", () => {
  const rectProject = (extra: string[]): ProjectResult =>
    projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Rectangle:",
        "    x: 10",
        "    y: 10",
        "    width: 4",
        "    height: 2",
        "    color: teal",
        ...extra.map((l) => `    ${l}`),
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );
  const rectCard = (extra: string[]) => rectProject(extra).model.decks[0].cards[0];

  it("a declared pivot reaches the shape NORMALIZED — x/y stay as authored (no baked offset)", () => {
    const rect = rectCard(["pivot: bottom_right"]).front[0] as RectShape;
    expect(rect.pivot).toEqual({ h: "right", v: "bottom" });
    // Eval does NOT bake the offset: the renderer applies it (§3.4 — an
    // Image `auto` box only resolves at load time, and every kind follows
    // the same rule for consistency).
    expect(rect.x).toBe(10);
    expect(rect.y).toBe(10);
  });

  it("every shape kind materializes the top-left default when pivot: is omitted", () => {
    const p = projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Rectangle:",
        "    x: 0",
        "    y: 0",
        "    width: 1",
        "    height: 1",
        "    color: teal",
        "  Text:",
        "    x: 0",
        "    y: 2",
        "    size: 1",
        '    text: "a"',
        "  TextBox:",
        "    x: 0",
        "    y: 4",
        "    width: 5",
        "    height: 2",
        '    text: "b"',
        "    size: 1",
        "  Icon:",
        "    x: 0",
        "    y: 7",
        "    size: 1",
        '    code: "HEARTS"',
        "  Image:",
        "    x: 0",
        "    y: 9",
        "    width: 2",
        "    height: 2",
        '    src: "a.png"',
        "  Qr:",
        "    x: 0",
        "    y: 12",
        "    size: 2",
        '    data: "a"',
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );
    const front = p.model.decks[0].cards[0].front;
    expect(front).toHaveLength(6);
    for (const shape of front) {
      expect(shape.pivot, shape.kind).toEqual({ h: "left", v: "top" });
    }
  });

  it("explicit default ≡ omitted — same contentHash (the fit/style precedent)", () => {
    const omitted = rectCard([]).contentHash;
    expect(rectCard(["pivot: top_left"]).contentHash).toBe(omitted);
    // Reversed spelling of the same point too: normalization runs at check
    // time, so the model (and the hash) can't tell spellings apart.
    expect(rectCard(["pivot: left_top"]).contentHash).toBe(omitted);
  });

  it("bottom_right ≠ the default — pivots are visible content", () => {
    expect(rectCard(["pivot: bottom_right"]).contentHash).not.toBe(rectCard([]).contentHash);
  });

  it("alias ≡ canonical on the DEMO: right ↔ top_right ↔ right_top give deep-equal models", () => {
    // The demo fixture itself is untouched by M3 (byte-identical, `pivot:
    // right` and all); respelling its one pivot canonically must change
    // NOTHING — hashes included.
    const base = compileProject(demoSource, demoRows());
    expect(base.diagnostics).toEqual([]);
    for (const spelling of ["top_right", "right_top"]) {
      const variant = compileProject(
        demoSource.replace("pivot: right", `pivot: ${spelling}`),
        demoRows(),
      );
      expect(variant.diagnostics, spelling).toEqual([]);
      expect(variant.model, spelling).toEqual(base.model);
    }
  });

  it("x: middle + pivot: bottom_left → h center (sugar wins), v bottom (pivot's say)", () => {
    const p = projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Text:",
        "    x: middle",
        "    y: 26",
        "    size: 1",
        '    text: "footer"',
        "    pivot: bottom_left",
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );
    const text = p.model.decks[0].cards[0].front[0] as TextShape;
    expect(text.x).toBe(10); // half of 20 X units
    expect(text.pivot).toEqual({ h: "center", v: "bottom" });
  });

  it("the centring recipe (x: half, y: half, pivot: center_center) centers a shape on the card (hand-computed)", () => {
    const p = projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Rectangle:",
        "    x: half",
        "    y: half",
        "    width: 4",
        "    height: 2",
        "    color: teal",
        "    pivot: center_center",
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );
    const rect = p.model.decks[0].cards[0].front[0] as RectShape;
    // CARD_LINES: x_units 20, y_units auto → 28 (poker's 88.9/63.5 ratio).
    // `half` of each axis is the card's own center point: (10, 14).
    expect(rect.x).toBe(10);
    expect(rect.y).toBe(14);
    expect(rect.pivot).toEqual({ h: "center", v: "center" });
    // Hand-computed: a center_center pivot backs the drawn box off by HALF
    // its own size on each axis (§3.4's fx/fy = ½), so the box's top-left
    // origin is (x − width/2, y − height/2) = (10 − 4/2, 14 − 2/2) = (8, 13)
    // — the box (4×2) therefore spans (8, 13)–(12, 15), whose own center is
    // (10, 14): the SAME point x/y named. The shape's center, not a corner,
    // lands on the card's center — this is the recipe for "centered on the
    // card" the owner expected from `pivot: center_center` alone (§3.4/◆36†).
    const handComputedOrigin = { x: 8, y: 13 };
    const actualOrigin = { x: rect.x - rect.width / 2, y: rect.y - rect.height / 2 };
    expect(actualOrigin).toEqual(handComputedOrigin);
  });
});

// -- TextBox (§3.3, M3): the compiler is the wrapping authority --------------

describe("TextBox evaluates to a wrapped TextBoxShape (§3.3 M3)", () => {
  /** One TextBox on a poker/20 card (X axis = 20 units, size 1 default),
   * text from the `t` column so cell-data newlines can be probed. */
  const boxProject = (
    props: string[],
    cell = "aaa aaa aaa",
    text = "text: [t]",
  ): ProjectResult =>
    compileProject(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  TextBox:",
        "    x: 2",
        "    y: 3",
        `    ${text}`,
        ...props.map((l) => `    ${l}`),
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: cell }] },
    );

  const boxOf = (result: ProjectResult): TextBoxShape => {
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const card = result.model.decks[0].cards[0];
    expect(card.error).toBeUndefined();
    return card.front[0] as TextBoxShape;
  };

  const WIDE = ["width: 18", "height: 20", "size: 1"];

  it("materializes every default: black, left, 1.3, unclipped, geist font — and geometry verbatim", () => {
    const shape = boxOf(boxProject(WIDE));
    expect(shape).toEqual({
      kind: "textbox",
      x: 2,
      y: 3,
      width: 18,
      height: 20,
      size: 1,
      color: "black",
      align: "left",
      pivot: { h: "left", v: "top" },
      lineHeight: 1.3,
      lines: ["aaa aaa aaa"], // fits an 18-unit box on one line
      clipped: false,
      shrunk: false,
      font: "geist", // no font: → the §3.3 default (◆41)
    });
  });

  it("declared color/align/line_height reach the shape", () => {
    const shape = boxOf(
      boxProject([...WIDE, "color: navy", "align: right", "line_height: 1.5"]),
    );
    expect(shape.color).toBe("navy");
    expect(shape.align).toBe("right");
    expect(shape.lineHeight).toBe(1.5);
  });

  it("geometry keywords resolve per axis: width full = 20 (X), height half = 14 (Y), size on X", () => {
    const shape = boxOf(
      boxProject(["width: full", "height: half", "size: half"], "aaa"),
    );
    expect(shape.width).toBe(20);
    expect(shape.height).toBe(14); // poker@20 → 28 y-units; half = 14
    expect(shape.size).toBe(10); // documented decision: size uses the X axis
  });

  it("wraps against the real Geist metrics: a 3-unit box breaks 'aaa aaa aaa' per word", () => {
    // Geist 'a' advances 570/1000 em, space 250: "aaa" measures ~1.74 units
    // at size 1 and "aaa aaa" ~3.74 — so each word takes a line, spaces
    // collapsing at the breaks. Deterministic because the metrics table is
    // committed (metrics.test.ts pins regeneration).
    const shape = boxOf(boxProject(["width: 3", "height: 20", "size: 1"]));
    expect(shape.lines).toEqual(["aaa", "aaa", "aaa"]);
    for (const line of shape.lines) {
      expect(measureText(line, shape.size, GEIST_METRICS)).toBeLessThanOrEqual(3);
    }
    expect(shape.clipped).toBe(false);
  });

  it("hard breaks arrive from string-literal escapes (§3.1)", () => {
    const shape = boxOf(
      boxProject(WIDE, "unused", 'text: "one\\ntwo\\n\\nfour"'),
    );
    expect(shape.lines).toEqual(["one", "two", "", "four"]);
  });

  it("hard breaks arrive from CELL data — a newline in a cell is data, not escaping", () => {
    const shape = boxOf(boxProject(WIDE, "first\nsecond"));
    expect(shape.lines).toEqual(["first", "second"]);
  });

  it("interpolation substitutes BEFORE wrapping — cell newlines survive inside a literal", () => {
    const shape = boxOf(boxProject(WIDE, "x\ny", 'text: "pre [t] post"'));
    expect(shape.lines).toEqual(["pre x", "y post"]);
  });

  it("clip: keeps the last fully fitting line, marks the box, keeps the size", () => {
    // 3 wrapped lines × 1.3 × 1 = 3.9; height 2 fits one line.
    const shape = boxOf(boxProject(["width: 3", "height: 2", "size: 1"]));
    expect(shape.lines).toEqual(["aaa"]);
    expect(shape.clipped).toBe(true);
    expect(shape.shrunk).toBe(false);
    expect(shape.size).toBe(1);
  });

  it("shrink: converges to the first fitting step, re-wrapping as it goes", () => {
    // At size 1 the 3-unit box holds one "aaa" per line (3 lines — too tall
    // for height 2). At 0.8 two words fit a line but 2 × 1.3 × 0.8 > 2;
    // 0.75 fits both ways → FINAL size 0.75, two re-wrapped lines.
    const shape = boxOf(
      boxProject(["width: 3", "height: 2", "size: 1", "overflow: shrink"]),
    );
    expect(shape.size).toBe(0.75);
    expect(shape.lines).toEqual(["aaa aaa", "aaa"]);
    expect(shape.shrunk).toBe(true);
    expect(shape.clipped).toBe(false);
  });

  it("shrink bottoms out at the 60% floor and clips there", () => {
    const shape = boxOf(
      boxProject(["width: 3", "height: 1", "size: 1", "overflow: shrink"]),
    );
    expect(shape.size).toBe(0.6);
    expect(shape.shrunk).toBe(true);
    expect(shape.clipped).toBe(true);
    expect(shape.lines).toEqual(["aaa aaa"]); // one 0.78-unit line fits height 1
  });

  it("every content knob changes the contentHash: text, width, align, line_height, clipping", () => {
    const base = boxProject(WIDE).model.decks[0].cards[0];
    const variants = [
      boxProject(WIDE, "different text"),
      boxProject(["width: 17", ...WIDE.slice(1)]),
      boxProject([...WIDE, "align: middle"]),
      boxProject([...WIDE, "line_height: 1.4"]),
      boxProject(["width: 3", "height: 2", "size: 1"]), // clips
    ];
    for (const variant of variants) {
      expect(variant.model.decks[0].cards[0].contentHash).not.toBe(base.contentHash);
    }
  });

  it("two identical projects hash identically — wrapping is deterministic", () => {
    const a = boxProject(["width: 3", "height: 2", "size: 1", "overflow: shrink"]);
    const b = boxProject(["width: 3", "height: 2", "size: 1", "overflow: shrink"]);
    expect(a.model.decks[0].cards[0].contentHash).toBe(b.model.decks[0].cards[0].contentHash);
  });
});

// -- cell validation: D001 / D002 -------------------------------------------

describe("D001 — enum cell not a case", () => {
  const enumSheet = {
    enums: ["Enum: S", "  case A", "  case B"],
  };

  it("flags the cell, and a referencing card becomes a placeholder sharing the diagnostic", () => {
    const p = textProject("[s]", ["s: S"], [{ s: "Banana" }, { s: "A" }], enumSheet);
    const d001 = p.dataDiagnostics.filter((d) => d.code === "D001");
    expect(d001).toHaveLength(1);
    expect(d001[0].cell).toEqual({ sheet: "Sh", rowIndex: 0, column: "s" });
    expect(d001[0].cardRef).toBeUndefined();
    const [bad, good] = p.model.decks[0].cards;
    expect(bad.front).toEqual([]);
    expect(bad.back).toEqual([]);
    expect(bad.error?.diagnostics[0]).toBe(d001[0]); // reused, not duplicated
    expect(good.error).toBeUndefined();
    expect((good.front[0] as TextShape).text).toBe("A");
  });

  it("case matching is exact and case-sensitive; an unreferenced bad cell still flags but the card renders", () => {
    const p = textProject("[t]", ["s: S", "t: Text"], [{ s: "a", t: "hello" }], enumSheet);
    expect(dataCodes(p)).toEqual(["D001"]); // "a" ≠ "A"
    const card = p.model.decks[0].cards[0];
    expect(card.error).toBeUndefined();
    expect((card.front[0] as TextShape).text).toBe("hello");
  });
});

describe("D002 — non-numeric cell in a Number column", () => {
  it("rejects non-decimal values; the referencing card is a placeholder", () => {
    const p = textProject(
      "[n]",
      ["n: Number"],
      [{ n: "abc" }, { n: "1e999" }, { n: "0x10" }],
    );
    const d002 = p.dataDiagnostics.filter((d) => d.code === "D002");
    expect(d002.map((d) => d.cell?.rowIndex)).toEqual([0, 1, 2]);
    for (const card of p.model.decks[0].cards) {
      expect(card.error?.diagnostics.map((d) => d.code)).toEqual(["D002"]);
    }
  });

  it("accepts signed, fractional, exponent, and whitespace-padded decimals", () => {
    const p = textProject("[n]", ["n: Number"], [{ n: "-3" }, { n: ".5" }, { n: "2e3" }, { n: " 7 " }]);
    expect(p.dataDiagnostics).toEqual([]);
    expect(p.model.decks[0].cards.map((c) => (c.front[0] as TextShape).text)).toEqual([
      "-3",
      "0.5",
      "2000",
      "7",
    ]);
  });
});

// -- D003 — empty cell referenced (◆19) -------------------------------------

describe("D003 — empty Number/Enum cell referenced", () => {
  it("empty referenced Number cell → placeholder with cell provenance", () => {
    const p = textProject("[n]", ["n: Number", "t: Text"], [{ t: "keep", n: "" }]);
    const d003 = p.dataDiagnostics.filter((d) => d.code === "D003");
    expect(d003).toHaveLength(1);
    expect(d003[0].cell).toEqual({ sheet: "Sh", rowIndex: 0, column: "n" });
    expect(errorCodes(p)).toEqual(["D003"]);
  });

  it("is deduped per cell: every loop case shares ONE diagnostic", () => {
    const p = textProject("[n]", ["n: Number", "t: Text"], [{ t: "keep", n: "" }], {
      enums: ["Enum: S", "  case A", "  case B"],
      cardExtra: ["loop: S as s"],
    });
    expect(dataCodes(p).filter((c) => c === "D003")).toHaveLength(1);
    const cards = p.model.decks[0].cards;
    expect(cards).toHaveLength(2);
    expect(cards[0].error?.diagnostics[0]).toBe(cards[1].error?.diagnostics[0]);
  });

  it("empty Text cell → \"\" and an unreferenced empty cell is silent", () => {
    const p = textProject("[t]", ["n: Number", "t: Text"], [{ n: "1", t: "" }]);
    expect(p.dataDiagnostics).toEqual([]);
    expect((p.model.decks[0].cards[0].front[0] as TextShape).text).toBe("");
  });
});

// -- D004 — Repeat cap (◆27) ------------------------------------------------

const repeatProject = (repeatLines: string[], rows = [{ t: "x" }]): ProjectResult =>
  projectOf(
    src(...sheetLines(["t: Text"]), "Template: T", ...repeatLines, ...CARD_LINES, "  Front: T"),
    { Sh: rows },
  );

const RECT_CHILD = (indent: string): string[] => [
  `${indent}Rectangle:`,
  `${indent}  x: 0`,
  `${indent}  y: 0`,
  `${indent}  width: 1`,
  `${indent}  height: 1`,
  `${indent}  color: red`,
];

describe("D004 — repeat count negative or beyond the 500/card cap", () => {
  it("Repeat: 501 → placeholder with D004 and cardRef", () => {
    const p = repeatProject(["  Repeat: 501 as i", ...RECT_CHILD("    ")]);
    expect(errorCodes(p)).toEqual(["D004"]);
    const d004 = p.dataDiagnostics.find((d) => d.code === "D004");
    expect(d004?.cardRef).toEqual({ deck: "C", deckIndex: 0, cardIndex: 0 });
    expect(d004?.cell).toBeUndefined();
  });

  it("Repeat: 500 is exactly legal; negative and fractional counts are D004", () => {
    expect(
      repeatProject(["  Repeat: 500 as i", ...RECT_CHILD("    ")]).model.decks[0].cards[0].front,
    ).toHaveLength(500);
    expect(errorCodes(repeatProject(["  Repeat: -1 as i", ...RECT_CHILD("    ")]))).toEqual([
      "D004",
    ]);
    expect(errorCodes(repeatProject(["  Repeat: 2.5 as i", ...RECT_CHILD("    ")]))).toEqual([
      "D004",
    ]);
  });

  it("nested Repeats multiply toward the same per-card total", () => {
    // 25 outer iterations + 25×25 inner = 650 > 500 → D004.
    const bad = repeatProject([
      "  Repeat: 25 as a",
      "    Repeat: 25 as b",
      ...RECT_CHILD("      "),
    ]);
    expect(errorCodes(bad)).toEqual(["D004"]);
    // 20 + 20×20 = 420 ≤ 500 → fine, 400 rectangles.
    const ok = repeatProject([
      "  Repeat: 20 as a",
      "    Repeat: 20 as b",
      ...RECT_CHILD("      "),
    ]);
    expect(ok.dataDiagnostics).toEqual([]);
    expect(ok.model.decks[0].cards[0].front).toHaveLength(400);
  });

  it("a D004 placeholder isolates its combination — other rows still render", () => {
    const p = projectOf(
      src(
        ...sheetLines(["n: Number"]),
        "Template: T",
        "  Repeat: [n] as i",
        ...RECT_CHILD("    "),
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ n: "600" }, { n: "3" }] },
    );
    const [bad, good] = p.model.decks[0].cards;
    expect(bad.error?.diagnostics.map((d) => d.code)).toEqual(["D004"]);
    expect(good.error).toBeUndefined();
    expect(good.front).toHaveLength(3);
  });
});

// -- D005 — unknown computed icon code (§3.8 †) -----------------------------

const iconProject = (codeExpr: string, rows: Record<string, string>[]): ProjectResult =>
  projectOf(
    src(
      ...sheetLines(["t: Text"]),
      "Template: T",
      "  Icon:",
      "    x: 0",
      "    y: 0",
      "    size: 1",
      `    code: ${codeExpr}`,
      ...CARD_LINES,
      "  Front: T",
    ),
    { Sh: rows },
  );

describe("D005 — unknown computed icon code still renders", () => {
  it("emits the icon shape AND the diagnostic (cardRef only, no placeholder)", () => {
    const p = iconProject("[t]", [{ t: "BOGUS_GLYPH" }, { t: "HEARTS" }]);
    const d005 = p.dataDiagnostics.filter((d) => d.code === "D005");
    expect(d005).toHaveLength(1);
    expect(d005[0].cardRef).toEqual({ deck: "C", deckIndex: 0, cardIndex: 0 });
    expect(d005[0].cell).toBeUndefined();
    const [flagged, known] = p.model.decks[0].cards;
    expect(flagged.error).toBeUndefined(); // NOT a placeholder
    expect((flagged.front[0] as IconShape).code).toBe("BOGUS_GLYPH");
    expect((known.front[0] as IconShape).code).toBe("HEARTS");
  });

  it("literal unknown codes are W004 at compile time, not D005 (no double-flag)", () => {
    const p = iconProject('"NOT_A_REAL_CODE_123"', [{ t: "x" }]);
    expect(p.diagnostics.map((d) => d.code)).toContain("W004");
    expect(dataCodes(p)).toEqual([]);
    expect((p.model.decks[0].cards[0].front[0] as IconShape).code).toBe("NOT_A_REAL_CODE_123");
  });
});

// -- D006 — bad count: (§3.7 †) ---------------------------------------------

describe("D006 — count: non-integer, negative, or unevaluable", () => {
  it("count: 2.5 → exactly ONE placeholder with D006 + cardRef", () => {
    const p = textProject("[t]", ["t: Text"], [{ t: "x" }], { cardExtra: ["count: 2.5"] });
    expect(p.model.decks[0].cards).toHaveLength(1);
    expect(errorCodes(p)).toEqual(["D006"]);
    const d006 = p.dataDiagnostics.find((d) => d.code === "D006");
    expect(d006?.cardRef).toEqual({ deck: "C", deckIndex: 0, cardIndex: 0 });
  });

  it("count: -1 → one placeholder with D006", () => {
    const p = textProject("[t]", ["t: Text"], [{ t: "x" }], { cardExtra: ["count: -1"] });
    expect(errorCodes(p)).toEqual(["D006"]);
  });

  it("count from a bad cell carries the cell diagnostic plus D006", () => {
    const p = textProject("1", ["n: Number"], [{ n: "abc" }], { cardExtra: ["count: [n]"] });
    expect(errorCodes(p)).toEqual(["D002", "D006"]);
    expect(dataCodes(p).sort()).toEqual(["D002", "D006"]);
  });

  it("fires once per row × case combination", () => {
    const p = textProject("[t]", ["t: Text"], [{ t: "x" }], {
      enums: ["Enum: S", "  case A", "  case B"],
      cardExtra: ["loop: S as s", "count: 2.5"],
    });
    expect(p.model.decks[0].cards).toHaveLength(2); // one placeholder each
    const d006 = p.dataDiagnostics.filter((d) => d.code === "D006");
    expect(d006.map((d) => d.cardRef?.cardIndex)).toEqual([0, 1]);
  });

  it("count: 0 is legal — zero instances, zero diagnostics", () => {
    const p = textProject("[t]", ["t: Text"], [{ t: "x" }], { cardExtra: ["count: 0"] });
    expect(p.model.decks[0].cards).toEqual([]);
    expect(p.dataDiagnostics).toEqual([]);
  });
});

// -- D007 — per-Card instance cap (◆27†) ------------------------------------

describe("D007 — 2,000-instance cap", () => {
  it("count cell 999999 → exactly 2,000 instances + one D007, copies share the hash", () => {
    const p = textProject("[t]", ["n: Number", "t: Text"], [{ n: "999999", t: "x" }], {
      cardExtra: ["count: [n]"],
    });
    const deck = p.model.decks[0];
    expect(deck.cards).toHaveLength(2000);
    expect(dataCodes(p)).toEqual(["D007"]);
    expect(deck.cards[0].contentHash).toBe(deck.cards[1999].contentHash);
    expect(deck.cards[1999].meta.copyIndex).toBe(1999);
    expect(deck.cards[0].error).toBeUndefined(); // capped, not broken
  });

  it("truncation stops the Card: later rows contribute nothing, one D007 total", () => {
    const p = textProject("[t]", ["n: Number", "t: Text"], [
      { n: "1999", t: "a" },
      { n: "5", t: "b" },
      { n: "5", t: "c" },
    ], { cardExtra: ["count: [n]"] });
    const deck = p.model.decks[0];
    expect(deck.cards).toHaveLength(2000);
    expect(dataCodes(p)).toEqual(["D007"]);
    // Row 2 filled the deck to the cap; row 3 never generated.
    expect(deck.cards[1999].meta.rowIndex).toBe(1);
    expect(deck.cards.some((c) => c.meta.rowIndex === 2)).toBe(false);
  });
});

// -- D008 — non-finite arithmetic -------------------------------------------

describe("D008 — non-finite numeric result", () => {
  it("division by zero → placeholder with D008 + cardRef", () => {
    const p = textProject("1 / 0", ["t: Text"], [{ t: "x" }]);
    expect(errorCodes(p)).toEqual(["D008"]);
    expect(p.dataDiagnostics[0].cardRef).toEqual({ deck: "C", deckIndex: 0, cardIndex: 0 });
  });

  it("NaN from % 0 is D008 too; ordinary division is fine", () => {
    expect(errorCodes(textProject("0 % 0", ["t: Text"], [{ t: "x" }]))).toEqual(["D008"]);
    const ok = textProject("7 / 2", ["t: Text"], [{ t: "x" }]);
    expect(ok.dataDiagnostics).toEqual([]);
    expect((ok.model.decks[0].cards[0].front[0] as TextShape).text).toBe("3.5");
  });
});

// -- pristine rows (◆29) ----------------------------------------------------

describe("pristine rows (◆29)", () => {
  it("all-empty and whitespace-only rows are excluded, counted, and diagnostic-free", () => {
    const p = textProject("[name]", ["name: Text", "cost: Number"], [
      { name: "A", cost: "1" },
      { name: "", cost: "   " },
      {},
    ]);
    expect(p.model.decks[0].cards).toHaveLength(1);
    expect(p.excludedPristineRows).toEqual({ Sh: 2 });
    expect(p.dataDiagnostics).toEqual([]);
  });

  it("exclusion happens before the loop cross-product — no D003 spray ×cases", () => {
    const p = textProject("[name]", ["name: Text", "cost: Number"], [{}, { name: "A", cost: "1" }], {
      enums: ["Enum: S", "  case A1", "  case A2", "  case A3"],
      cardExtra: ["loop: S as s"],
    });
    expect(p.model.decks[0].cards).toHaveLength(3); // 1 edited row × 3 cases
    expect(p.dataDiagnostics).toEqual([]);
    expect(p.excludedPristineRows).toEqual({ Sh: 1 });
  });

  it("zero-column sheet rows are never pristine (⚑13† loop-only decks)", () => {
    const p = projectOf(
      src(
        "Enum: S",
        "  case A",
        "  case B",
        "Sheet: Sh",
        "Template: T",
        "  Rectangle:",
        "    x: 0",
        "    y: 0",
        "    width: full",
        "    height: full",
        "    color: teal",
        ...CARD_LINES,
        "  loop: S as s",
        "  Front: T",
      ),
      { Sh: [{}, {}, {}] },
    );
    expect(p.model.decks[0].cards).toHaveLength(6); // 3 rows × 2 cases
    expect(p.excludedPristineRows).toEqual({});
  });
});

// -- edited-flag pristine override (◆29†, task 4) ----------------------------

describe("edited-flag pristine override (◆29† — the store's per-row flags)", () => {
  // Template references [n], so a non-pristine row with an empty n cell D003s.
  const code = src(
    ...sheetLines(["n: Number", "t: Text"]),
    ...textTemplate("[n]"),
    ...CARD_LINES,
    "  Front: T",
  );

  it("unflagged (or false-flagged) all-empty rows stay pristine — the derivation fallback is unchanged", () => {
    const p = compileProject(code, { Sh: [{}] });
    expect(p.model.decks[0].cards).toEqual([]);
    expect(p.excludedPristineRows).toEqual({ Sh: 1 });
    expect(p.dataDiagnostics).toEqual([]);
    const q = compileProject(code, { Sh: [{}] }, { Sh: [false] });
    expect(q.excludedPristineRows).toEqual({ Sh: 1 });
    expect(q.dataDiagnostics).toEqual([]);
  });

  it("a flagged-but-empty row is NOT pristine → D003 on reference (deleting the row is the remedy)", () => {
    const p = compileProject(code, { Sh: [{}] }, { Sh: [true] });
    expect(p.excludedPristineRows).toEqual({});
    const d003 = p.dataDiagnostics.filter((d) => d.code === "D003");
    expect(d003).toHaveLength(1);
    expect(d003[0].cell).toEqual({ sheet: "Sh", rowIndex: 0, column: "n" });
    expect(errorCodes(p)).toEqual(["D003"]);
  });

  it("a flagged row whose only content sits in orphaned keys is NOT pristine either", () => {
    const p = compileProject(code, { Sh: [{ orphan: "z" }] }, { Sh: [true] });
    expect(p.excludedPristineRows).toEqual({});
    expect(errorCodes(p)).toEqual(["D003"]);
    // Unflagged, the same row still derives pristine (the grid shows it
    // all-empty; ◆26 keeps the orphaned data invisible).
    const q = compileProject(code, { Sh: [{ orphan: "z" }] });
    expect(q.excludedPristineRows).toEqual({ Sh: 1 });
  });

  it("flags are tolerated garbage: short arrays leave later rows derived; non-arrays mean no flags", () => {
    const p = compileProject(code, { Sh: [{}, {}] }, { Sh: [true] });
    expect(p.excludedPristineRows).toEqual({ Sh: 1 }); // row 1 unflagged → still pristine
    const q = compileProject(code, { Sh: [{}] }, { Sh: "junk" } as unknown as EditedRows);
    expect(q.excludedPristineRows).toEqual({ Sh: 1 });
  });

  it("a flag on a filled row changes nothing — it was already non-pristine", () => {
    const p = compileProject(code, { Sh: [{ n: "1", t: "x" }] }, { Sh: [true] });
    expect(p.dataDiagnostics).toEqual([]);
    expect(p.model.decks[0].cards).toHaveLength(1);
    expect(p.excludedPristineRows).toEqual({});
  });
});

// -- cross-product order (⚑1, ◆25) ------------------------------------------

describe("cross-product order", () => {
  it("row-major; loops nest in declaration order; cases in enum order (last loop fastest)", () => {
    const p = textProject("[t]", ["t: Text"], [{ t: "r0" }, { t: "r1" }], {
      enums: ["Enum: A", "  case A1", "  case A2", "Enum: B", "  case B1", "  case B2", "  case B3"],
      cardExtra: ["loop: A as a", "loop: B as b"],
    });
    const cards = p.model.decks[0].cards;
    expect(cards).toHaveLength(12);
    expect(
      cards.map(
        (c) => `${c.meta.rowIndex}:${c.meta.loopBindings.a.case}:${c.meta.loopBindings.b.case}`,
      ),
    ).toEqual([
      "0:A1:B1", "0:A1:B2", "0:A1:B3", "0:A2:B1", "0:A2:B2", "0:A2:B3",
      "1:A1:B1", "1:A1:B2", "1:A1:B3", "1:A2:B1", "1:A2:B2", "1:A2:B3",
    ]);
    expect(cards[0].meta.loopBindings).toEqual({
      a: { enum: "A", case: "A1" },
      b: { enum: "B", case: "B1" },
    });
  });

  it("loop variables are usable in the count expression", () => {
    const p = textProject("[t]", ["t: Text"], [{ t: "x" }], {
      enums: ["Enum: S", "  case A", "  case B"],
      cardExtra: ["loop: S as s", "count: if [s] == A then 2 else 1"],
    });
    expect(
      p.model.decks[0].cards.map((c) => [c.meta.loopBindings.s.case, c.meta.copyIndex]),
    ).toEqual([
      ["A", 0],
      ["A", 1],
      ["B", 0],
    ]);
  });
});

// -- determinism and content hashes (§4.1 †) --------------------------------

describe("determinism and content hashes", () => {
  it("two runs produce deep-equal models with identical hashes", () => {
    const a = compileProject(demoSource, demoRows());
    const b = compileProject(demoSource, demoRows());
    expect(a.model).toEqual(b.model);
    expect(a.model.decks[0].cards.map((c) => c.contentHash)).toEqual(
      b.model.decks[0].cards.map((c) => c.contentHash),
    );
  });

  it("a cell edit changes the affected faces' hashes and no others", () => {
    const before = compileProject(demoSource, demoRows());
    const rows = demoRows();
    rows.Monsters[0].health = "5";
    const after = compileProject(demoSource, rows);
    expect(after.model.decks[0].cards[0].contentHash).not.toBe(
      before.model.decks[0].cards[0].contentHash,
    );
    // Imp cards are untouched by the Dragon edit.
    expect(after.model.decks[0].cards[6].contentHash).toBe(
      before.model.decks[0].cards[6].contentHash,
    );
  });

  it("placeholder instances hash deterministically too", () => {
    const run = (): string =>
      textProject("[n]", ["n: Number"], [{ n: "abc" }]).model.decks[0].cards[0].contentHash;
    expect(run()).toBe(run());
  });
});

// -- never throws (⚑8) ------------------------------------------------------

describe("never throws (⚑8)", () => {
  it("garbage source → empty model, no exception", () => {
    const p = compileProject("Card: ((((\n  ???!\n", {});
    expect(p.model.decks).toEqual([]);
    expect(p.dataDiagnostics).toEqual([]);
  });

  it("demo code with no sheets entry → one empty deck", () => {
    const p = compileProject(demoSource, {});
    expect(p.model.decks).toHaveLength(1);
    expect(p.model.decks[0].cards).toEqual([]);
    expect(p.excludedPristineRows).toEqual({});
  });

  it("rows with wrong keys are all-empty → pristine, excluded, silent", () => {
    const p = compileProject(demoSource, { Monsters: [{ bogus: "1" }] });
    expect(p.model.decks[0].cards).toEqual([]);
    expect(p.excludedPristineRows).toEqual({ Monsters: 1 });
    expect(p.dataDiagnostics).toEqual([]);
  });

  it("extra/orphaned columns are ignored", () => {
    const p = compileProject(demoSource, {
      Monsters: [{ name: "D", cost: "1", health: "1", count: "1", orphan: "zzz" }],
    });
    expect(p.model.decks[0].cards).toHaveLength(3);
    expect(p.dataDiagnostics).toEqual([]);
  });

  it("a non-array sheet entry and non-object rows degrade to empty", () => {
    const garbage = { Monsters: "garbage" } as unknown as SheetRows;
    expect(compileProject(demoSource, garbage).model.decks[0].cards).toEqual([]);
    const mixed = { Monsters: [null, 7, [1]] } as unknown as SheetRows;
    const p = compileProject(demoSource, mixed);
    expect(p.model.decks[0].cards).toEqual([]); // 3 all-empty rows → pristine
    expect(p.excludedPristineRows).toEqual({ Monsters: 3 });
  });

  it("E000-style empty bindings generate zero decks", () => {
    const { program } = parse("");
    const empty: Bindings = {
      enums: new Map(),
      sheets: new Map(),
      templates: new Map(),
      cards: [],
      templateUsage: new Map(),
    };
    const result = generateModel(program, empty, { X: [{ a: "1" }] });
    expect(result.model.decks).toEqual([]);
    expect(result.dataDiagnostics).toEqual([]);
    expect(result.excludedPristineRows).toEqual({});
  });

  it("a Card with unresolved essentials emits NO deck (compile errors own it)", () => {
    const p = compileProject(
      src(...sheetLines(["t: Text"]), ...textTemplate("[t]"), "Card: C", "  sheet: Sh", "  Front: T"),
      { Sh: [{ t: "x" }] },
    );
    expect(p.diagnostics.some((d) => d.code === "E008")).toBe(true);
    expect(p.model.decks).toEqual([]);
  });

  it("a compile error inside a used template → placeholders (D000), not a crash", () => {
    const p = compileProject(
      src(...sheetLines(["t: Text"]), ...textTemplate("[missing_column]"), ...CARD_LINES, "  Front: T"),
      { Sh: [{ t: "x" }] },
    );
    expect(p.diagnostics.some((d) => d.code === "E002")).toBe(true);
    const card = p.model.decks[0].cards[0];
    expect(card.front).toEqual([]);
    expect(card.error?.diagnostics.map((d) => d.code)).toEqual(["D000"]);
  });
});

// -- per-Card template contexts (⚑5, §3.6) ----------------------------------

describe("templates are evaluated per using Card", () => {
  it("one template bound to two sheets resolves [t] per Card (Text vs Number)", () => {
    const p = projectOf(
      src(
        "Sheet: Words",
        "  column t: Text",
        "Sheet: Numbers",
        "  column t: Number",
        ...textTemplate("[t]"),
        "Card: WordCard",
        "  sheet: Words",
        "  size: poker",
        "  x_units: 20",
        "  y_units: auto",
        "  Front: T",
        "Card: NumberCard",
        "  sheet: Numbers",
        "  size: poker",
        "  x_units: 20",
        "  y_units: auto",
        "  Front: T",
      ),
      { Words: [{ t: "05.50" }], Numbers: [{ t: "05.50" }] },
    );
    // Decks in Card-declaration order (§3.7).
    expect(p.model.decks.map((d) => d.cardName)).toEqual(["WordCard", "NumberCard"]);
    const [words, numbers] = p.model.decks;
    expect((words.cards[0].front[0] as TextShape).text).toBe("05.50"); // Text verbatim
    expect((numbers.cards[0].front[0] as TextShape).text).toBe("5.5"); // Number coerced
  });
});

// -- error isolation (⚑8) ---------------------------------------------------

describe("per-card error isolation (⚑8)", () => {
  it("one bad row breaks only its own instances; a valid count multiplies placeholders", () => {
    const p = textProject("10 / [n]", ["n: Number"], [{ n: "0" }, { n: "5" }], {
      cardExtra: ["count: 2"],
    });
    const cards = p.model.decks[0].cards;
    expect(cards).toHaveLength(4); // 2 copies × 2 rows — count was valid data
    expect(cards[0].error?.diagnostics.map((d) => d.code)).toEqual(["D008"]);
    expect(cards[1].error?.diagnostics.map((d) => d.code)).toEqual(["D008"]);
    expect(cards[1].contentHash).toBe(cards[0].contentHash); // placeholder copies share too
    expect(cards[2].error).toBeUndefined();
    expect((cards[2].front[0] as TextShape).text).toBe("2");
    expect(dataCodes(p)).toEqual(["D008"]); // registered once, against the first copy
  });
});

// -- prototype-named columns (own-property cell access) ---------------------

describe("columns named after Object.prototype members", () => {
  const PROTO_COLUMNS = ["constructor: Text", "toString: Number", "valueOf: Number"];

  it("an empty row is pristine — no prototype-chain leakage", () => {
    const p = textProject("[constructor]", PROTO_COLUMNS, [{}]);
    expect(p.model.decks[0].cards).toEqual([]);
    expect(p.excludedPristineRows).toEqual({ Sh: 1 });
    expect(p.dataDiagnostics).toEqual([]);
  });

  it("empty Text cell → \"\"; empty Number cell is silent until referenced", () => {
    const p = textProject("[constructor]", PROTO_COLUMNS, [{ valueOf: "5" }]);
    expect(p.dataDiagnostics).toEqual([]); // no spurious D002 for empty toString
    const card = p.model.decks[0].cards[0];
    expect(card.error).toBeUndefined();
    expect((card.front[0] as TextShape).text).toBe("");
  });

  it("empty referenced Number cell → D003; a real value reads normally", () => {
    const empty = textProject("[toString]", PROTO_COLUMNS, [{ constructor: "x" }]);
    const d003 = empty.dataDiagnostics.filter((d) => d.code === "D003");
    expect(d003).toHaveLength(1);
    expect(d003[0].cell).toEqual({ sheet: "Sh", rowIndex: 0, column: "toString" });
    expect(errorCodes(empty)).toEqual(["D003"]);
    const filled = textProject("[toString]", PROTO_COLUMNS, [{ toString: "5" }]);
    expect(filled.dataDiagnostics).toEqual([]);
    expect((filled.model.decks[0].cards[0].front[0] as TextShape).text).toBe("5");
  });
});

// -- statically mistyped count: → D000, not D006 ----------------------------

describe("statically mistyped count:", () => {
  it("count: \"abc\" is E003 at compile time → D000 placeholder, NO D006 double-flag", () => {
    const p = compileProject(
      src(
        ...sheetLines(["t: Text"]),
        ...textTemplate("[t]"),
        ...CARD_LINES,
        '  count: "abc"',
        "  Front: T",
      ),
      { Sh: [{ t: "x" }] },
    );
    expect(p.diagnostics.some((d) => d.code === "E003")).toBe(true);
    expect(p.model.decks[0].cards).toHaveLength(1);
    expect(errorCodes(p)).toEqual(["D000"]);
    expect(dataCodes(p)).not.toContain("D006");
  });
});

// -- D005 dedupe per (combination, code) ------------------------------------

describe("D005 dedupe", () => {
  it("a Repeat drawing the same bogus code N times reports ONE D005", () => {
    const p = projectOf(
      src(
        ...sheetLines(["t: Text"]),
        "Template: T",
        "  Repeat: 3 as i",
        "    Icon:",
        "      x: [i]",
        "      y: 0",
        "      size: 1",
        "      code: [t]",
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "BOGUS" }] },
    );
    expect(dataCodes(p)).toEqual(["D005"]);
    expect(p.model.decks[0].cards[0].front).toHaveLength(3); // all icons still render
  });

  it("distinct bogus codes in one combination each get their own D005", () => {
    const p = projectOf(
      src(
        ...sheetLines(["t: Text", "u: Text"]),
        "Template: T",
        "  Icon:",
        "    x: 0",
        "    y: 0",
        "    size: 1",
        "    code: [t]",
        "  Icon:",
        "    x: 2",
        "    y: 0",
        "    size: 1",
        "    code: [u]",
        ...CARD_LINES,
        "  Front: T",
      ),
      { Sh: [{ t: "BOG_ONE", u: "BOG_TWO" }] },
    );
    expect(dataCodes(p)).toEqual(["D005", "D005"]);
  });
});

// -- deckIndex disambiguates duplicate Card names ---------------------------

describe("CardRef.deckIndex", () => {
  it("duplicate Card names (E005) generate two decks; cardRef points at the right one", () => {
    const cardBlock = (extra: string[]): string[] => [
      "Card: C",
      "  sheet: Sh",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      ...extra,
      "  Front: T",
    ];
    const p = compileProject(
      src(
        ...sheetLines(["t: Text"]),
        ...textTemplate("[t]"),
        ...cardBlock([]),
        ...cardBlock(["  count: 2.5"]),
      ),
      { Sh: [{ t: "x" }] },
    );
    expect(p.diagnostics.some((d) => d.code === "E005")).toBe(true);
    expect(p.model.decks.map((d) => d.cardName)).toEqual(["C", "C"]);
    const d006 = p.dataDiagnostics.find((d) => d.code === "D006");
    expect(d006?.cardRef).toEqual({ deck: "C", deckIndex: 1, cardIndex: 0 });
    expect(p.model.decks[0].cards[0].error).toBeUndefined(); // first deck untouched
  });
});

// -- deep expressions degrade per card, not per deck ------------------------

describe("evaluation depth budget", () => {
  it("a 5,000-term chain → per-card D000 placeholder, deck and model intact", () => {
    const deep = "1 + ".repeat(5000) + "1";
    const p = compileProject(
      src(...sheetLines(["t: Text"]), ...textTemplate(deep), ...CARD_LINES, "  Front: T"),
      { Sh: [{ t: "x" }] },
    );
    expect(p.diagnostics.some((d) => d.code === "E003")).toBe(true); // checker cut it too
    expect(p.model.decks).toHaveLength(1);
    expect(errorCodes(p)).toEqual(["D000"]);
    // NOT the whole-deck "Internal generator error" degradation.
    expect(p.dataDiagnostics.every((d) => !d.message.includes("Internal generator error"))).toBe(
      true,
    );
  });
});

// -- built-in [row]/[card] bindings — values (§3.6, ◆42) --------------------

describe("built-in [row]/[card] bindings", () => {
  const textsOf = (p: ProjectResult): string[] =>
    p.model.decks[0].cards.map((c) => (c.front[0] as TextShape).text);

  it("a plain deck (no loop, no count): [row] and [card] coincide, 1-based", () => {
    const p = textProject('"R[row]C[card]"', [], [{}, {}, {}]);
    expect(textsOf(p)).toEqual(["R1C1", "R2C2", "R3C3"]);
  });

  it("with loop: — 2 rows × 3 suits — matches the §3.6 table exactly (1,1,1,2,2,2 vs 1…6)", () => {
    const p = textProject('"R[row]C[card]"', [], [{}, {}], {
      enums: ["Enum: Suit", "  case Rock", "  case Paper", "  case Scissors"],
      cardExtra: ["loop: Suit as s"],
    });
    expect(textsOf(p)).toEqual(["R1C1", "R1C2", "R1C3", "R2C4", "R2C5", "R2C6"]);
    // Every combination's [row]-[card] pair is unique, so all 6 hash distinctly.
    expect(new Set(p.model.decks[0].cards.map((c) => c.contentHash)).size).toBe(6);
  });

  it("with count: copies — one row, three copies: [row] repeats, [card] increments", () => {
    const p = textProject('"R[row]C[card]"', [], [{}], { cardExtra: ["count: 3"] });
    expect(textsOf(p)).toEqual(["R1C1", "R1C2", "R1C3"]);
    // Two cards differing only in [card] ARE different cards (§3.6, ◆42):
    // three copies of the same row/loop combo still earn three hashes.
    expect(new Set(p.model.decks[0].cards.map((c) => c.contentHash)).size).toBe(3);
  });

  it("loop: AND count: together: [row] steps once per row, [card] runs 1…12 straight through", () => {
    const p = textProject('"R[row]C[card]"', [], [{}, {}], {
      enums: ["Enum: Suit", "  case Rock", "  case Paper", "  case Scissors"],
      cardExtra: ["loop: Suit as s", "count: 2"],
    });
    expect(textsOf(p)).toEqual([
      "R1C1",
      "R1C2",
      "R1C3",
      "R1C4",
      "R1C5",
      "R1C6",
      "R2C7",
      "R2C8",
      "R2C9",
      "R2C10",
      "R2C11",
      "R2C12",
    ]);
  });

  it("a real column named row/card SHADOWS the built-in — the cell value wins, not the position", () => {
    const p = textProject("[row]", ["row: Text"], [{ row: "hello" }, { row: "world" }]);
    expect(textsOf(p)).toEqual(["hello", "world"]);
  });

  it("count: copies that fail (a [card]-dependent D008) degrade ATOMICALLY, and never renumber", () => {
    // row 0's copy #3 (card 3) divides by (3-3)=0 → D008 — the WHOLE 3-copy
    // group becomes placeholders together (§3.7: failure stays combination-
    // scoped, not per copy). Row 1 starts at card 4 regardless — a failed
    // group still consumed its [card] numbers.
    const p = textProject("60 / ([card] - 3)", [], [{}, {}], { cardExtra: ["count: 3"] });
    const cards = p.model.decks[0].cards;
    expect(cards).toHaveLength(6);
    expect(cards.slice(0, 3).every((c) => c.error !== undefined)).toBe(true);
    expect(errorCodes(p, 0)).toEqual(["D008"]);
    expect(p.dataDiagnostics.filter((d) => d.code === "D008")).toHaveLength(1);
    // MAJOR-2 (adversarial review): copy 1's own expression is 60 / -2 —
    // it's copy 3 (card 3) whose 60 / 0 actually threw. The shared message
    // must name the ACTUAL offender, not silently imply all three computed
    // the same (false) thing.
    expect(cards[0].error?.diagnostics[0].message).toContain("(copy 3 of 3)");
    expect(cards[0].error?.diagnostics[0].message).toContain("60 / 0");
    // Placeholder copies still share one hash (unchanged §4.1 rule).
    expect(cards[1].contentHash).toBe(cards[0].contentHash);
    expect(cards[2].contentHash).toBe(cards[0].contentHash);

    // Row 1: NOT renumbered back to 1 — cards 4, 5, 6 divide cleanly.
    expect(cards.slice(3).every((c) => c.error === undefined)).toBe(true);
    expect(cards.slice(3).map((c) => (c.front[0] as TextShape).text)).toEqual(["60", "30", "20"]);
    // Each of row 1's copies resolved its own [card] → its own hash.
    expect(new Set(cards.slice(3).map((c) => c.contentHash)).size).toBe(3);
  });

  it("MAJOR-2 repro 2: Repeat: [card] as i at count: 501 blames copy 501, not copy 1 (which draws one element)", () => {
    // Copy 1's repeat draws exactly ONE element — nowhere near the 500 cap —
    // but the whole 501-copy group still degrades together (atomic
    // failure), so the message must name copy 501 (whose repeat count IS
    // 501, one past the cap), not copy 1.
    const p = projectOf(
      src(
        ...sheetLines([]),
        "Template: T",
        "  Repeat: [card] as i",
        "    Rectangle:",
        "      x: 0",
        "      y: 0",
        "      width: 1",
        "      height: 1",
        "      color: red",
        ...CARD_LINES,
        "  count: 501",
        "  Front: T",
      ),
      { Sh: [{}] },
    );
    const cards = p.model.decks[0].cards;
    expect(cards).toHaveLength(501);
    expect(cards.every((c) => c.error !== undefined)).toBe(true);
    const d004 = p.dataDiagnostics.filter((d) => d.code === "D004");
    expect(d004).toHaveLength(1);
    expect(d004[0].message).toContain("(copy 501 of 501)");
  });

  it("MINOR-7: count: [card] is legal and self-referential — deterministic, cap-bounded", () => {
    // Each combination's [card] is fixed BEFORE its own count: runs (the
    // position its first copy would occupy), so four rows request counts
    // 1, 2, 4, 8 — each group's size equals where it started.
    const p = textProject('"row"', [], [{}, {}, {}, {}], { cardExtra: ["count: [card]"] });
    const cards = p.model.decks[0].cards;
    expect(cards).toHaveLength(1 + 2 + 4 + 8); // 15
    expect(cards.map((c) => c.meta.rowIndex)).toEqual([
      0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3,
    ]);
    expect(p.dataDiagnostics).toEqual([]); // no D007 — well under CARD_CAP
  });

  it("using [row]/[card] never writes back into the SheetRows input (nothing to leak into persistence)", () => {
    // [row]/[card] are derived from rowIndex/cards.length alone — there is no
    // code path that could inject them into a row object. This is the
    // compiler-level half of that guarantee; the store/persistence half
    // (serializeProject's actual output) is covered in editorStore.test.ts.
    const rows: SheetRows = { Sh: [{}, {}] };
    const before = JSON.parse(JSON.stringify(rows));
    textProject('"R[row]C[card]"', [], rows.Sh);
    expect(rows).toEqual(before);
  });

  // -- reference identity (adversarial review MAJOR-1) -----------------------
  // The whole point of tracking [card]-usage is to keep the FAST path fast:
  // count: copies must share their Shape arrays BY REFERENCE (not merely by
  // equal content) whenever nothing in that face reads [card]. Every
  // existing contentHash-equality assertion above stays green even if the
  // fast path silently stopped firing (equal content still hashes equal) —
  // these tests are what actually pins reference sharing in place.

  describe("copies share Shape arrays BY REFERENCE unless a face reads [card]", () => {
    it("no [card] anywhere: front AND back are the SAME array reference across every copy", () => {
      const p = textProject('"R[row]"', [], [{}], { cardExtra: ["count: 3"] });
      const cards = p.model.decks[0].cards;
      expect(cards).toHaveLength(3);
      expect(cards[0].front).toBe(cards[1].front);
      expect(cards[1].front).toBe(cards[2].front);
      expect(cards[0].back).toBe(cards[1].back);
      expect(cards[1].back).toBe(cards[2].back);
    });

    it("front reads [card]: front diverges, but back (never reads it) STAYS shared by reference", () => {
      const p = projectOf(
        src(
          ...sheetLines([]),
          "Template: F",
          "  Text:",
          "    x: 0",
          "    y: 0",
          "    size: 1",
          '    text: "F[card]"',
          "Template: B",
          "  Text:",
          "    x: 0",
          "    y: 0",
          "    size: 1",
          '    text: "B"',
          ...CARD_LINES,
          "  count: 3",
          "  Front: F",
          "  Back: B",
        ),
        { Sh: [{}] },
      );
      const cards = p.model.decks[0].cards;
      expect(cards).toHaveLength(3);
      expect(cards.map((c) => (c.front[0] as TextShape).text)).toEqual(["F1", "F2", "F3"]);
      expect(cards[0].front).not.toBe(cards[1].front);
      expect(cards[1].front).not.toBe(cards[2].front);
      // MINOR-5 (adversarial review): Back never reads [card] — re-evaluating
      // it per copy would be pure waste. It must be the literal SAME array.
      expect(cards[0].back).toBe(cards[1].back);
      expect(cards[1].back).toBe(cards[2].back);
    });

    it("back reads [card]: back diverges, but front (never reads it) STAYS shared by reference", () => {
      // The adversarial review's exact counterexample: "back reads it → 2000
      // identical front arrays" if front were re-evaluated needlessly.
      const p = projectOf(
        src(
          ...sheetLines([]),
          "Template: F",
          "  Text:",
          "    x: 0",
          "    y: 0",
          "    size: 1",
          '    text: "F"',
          "Template: B",
          "  Text:",
          "    x: 0",
          "    y: 0",
          "    size: 1",
          '    text: "B[card]"',
          ...CARD_LINES,
          "  count: 3",
          "  Front: F",
          "  Back: B",
        ),
        { Sh: [{}] },
      );
      const cards = p.model.decks[0].cards;
      expect(cards).toHaveLength(3);
      expect(cards.map((c) => (c.back[0] as TextShape).text)).toEqual(["B1", "B2", "B3"]);
      expect(cards[0].back).not.toBe(cards[1].back);
      expect(cards[1].back).not.toBe(cards[2].back);
      expect(cards[0].front).toBe(cards[1].front);
      expect(cards[1].front).toBe(cards[2].front);
    });

    it("both faces read [card]: both diverge independently", () => {
      const p = projectOf(
        src(
          ...sheetLines([]),
          "Template: F",
          "  Text:",
          "    x: 0",
          "    y: 0",
          "    size: 1",
          '    text: "F[card]"',
          "Template: B",
          "  Text:",
          "    x: 0",
          "    y: 0",
          "    size: 1",
          '    text: "B[card]"',
          ...CARD_LINES,
          "  count: 3",
          "  Front: F",
          "  Back: B",
        ),
        { Sh: [{}] },
      );
      const cards = p.model.decks[0].cards;
      expect(cards[0].front).not.toBe(cards[1].front);
      expect(cards[0].back).not.toBe(cards[1].back);
    });

    it("error placeholders still share BOTH arrays by reference (the fast path, unchanged)", () => {
      const p = textProject("60 / ([card] - 3)", [], [{}], { cardExtra: ["count: 3"] });
      const cards = p.model.decks[0].cards;
      expect(cards[0].front).toBe(cards[1].front);
      expect(cards[1].front).toBe(cards[2].front);
      expect(cards[0].back).toBe(cards[1].back);
      expect(cards[1].back).toBe(cards[2].back);
    });

    it("mixed case pins PER-COMBINATION granularity: one row diverges via a conditional, the other doesn't", () => {
      // Row 1 ([row] == 1) takes the [card]-reading branch; row 2 takes the
      // other branch, which never touches [card] — only the TAKEN branch
      // evaluates (eval.ts), so row 2's context never sees [card] read at
      // all, regardless of what row 1 did with ITS OWN fresh context.
      const p = textProject(
        'if [row] == 1 then "R[row]C[card]" else "R[row]"',
        [],
        [{}, {}],
        { cardExtra: ["count: 3"] },
      );
      const cards = p.model.decks[0].cards;
      expect(cards).toHaveLength(6);
      expect(cards.map((c) => (c.front[0] as TextShape).text)).toEqual([
        "R1C1",
        "R1C2",
        "R1C3",
        "R2",
        "R2",
        "R2",
      ]);
      // Row 1 (cards 0–2): diverges.
      expect(cards[0].front).not.toBe(cards[1].front);
      expect(cards[1].front).not.toBe(cards[2].front);
      // Row 2 (cards 3–5): shares — untouched by row 1's divergence.
      expect(cards[3].front).toBe(cards[4].front);
      expect(cards[4].front).toBe(cards[5].front);
    });
  });
});
