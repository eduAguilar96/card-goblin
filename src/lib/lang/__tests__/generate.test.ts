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
  RectShape,
  SheetRows,
  TextBoxShape,
  TextShape,
} from "../index";
import { GEIST_METRICS, compileProject, generateModel, measureText } from "../index";
import { parse } from "../parser";

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
    expect(banner).toEqual({ kind: "rect", x: 0, y: 0, width: 20, height: 3, color: "grey" });
  });

  it("title: `x: middle` centers at x=10 and forces anchor middle", () => {
    const title = deck.cards[0].front[1] as TextShape;
    expect(title).toEqual({
      kind: "text",
      x: 10,
      y: 0.7,
      size: 1.6,
      color: "black",
      text: "Dragon",
      anchor: "middle",
    });
  });

  it("cost interpolates: 'Cost: 5' right-anchored at x 19", () => {
    const cost = deck.cards[0].front[2] as TextShape;
    expect(cost.text).toBe("Cost: 5");
    expect(cost.x).toBe(19);
    expect(cost.anchor).toBe("right");
    expect((deck.cards[6].front[2] as TextShape).text).toBe("Cost: 1");
  });

  it("attack icon: SWORDS, white, default left anchor and flat_dark style", () => {
    const attack = deck.cards[0].front[3] as IconShape;
    expect(attack).toEqual({
      kind: "icon",
      x: 1,
      y: 0.7,
      size: 1.6,
      color: "white",
      code: "SWORDS",
      anchor: "left",
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
      { kind: "rect", x: 0, y: 0, width: 20, height: 28, color: "teal" },
    ]);
  });

  it("has no data diagnostics and no pristine exclusions", () => {
    expect(p.dataDiagnostics).toEqual([]);
    expect(p.excludedPristineRows).toEqual({});
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
        "    anchor: right",
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

  it("`x: middle` wins over an explicit anchor (documented decision)", () => {
    const text = geoProject().model.decks[0].cards[0].front[1] as TextShape;
    expect(text.x).toBe(10);
    expect(text.anchor).toBe("middle"); // the written `anchor: right` loses
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
      { kind: "rect", x: 0, y: 0, width: 20, height: 28, color: "white" },
    ]);
  });
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
      { kind: "rect", x: 0, y: 0, width: 20, height: 30, color: "white" },
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

  it("materializes every default: black, left, 1.3, unclipped — and geometry verbatim", () => {
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
      lineHeight: 1.3,
      lines: ["aaa aaa aaa"], // fits an 18-unit box on one line
      clipped: false,
      shrunk: false,
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
