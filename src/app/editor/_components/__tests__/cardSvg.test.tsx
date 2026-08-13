/**
 * CardSVG (task 5): markup tests against the REAL demo model — compileProject
 * on the shared §3.9 seed — plus the exported §4.2 memo comparator. Geometry
 * flows through verbatim (fractional yUnits included), text baselines follow
 * the §3.4 ascent realization, and icons carry the Dicier family with all
 * four ligature features (§4.2 † — dlig is required for double-digit codes).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  compileProject,
  FONT_METRICS,
  type DataDiagnostic,
  type Deck,
  type FontFace,
  type IconShape,
  type ImageShape,
  type Pivot,
  type QrShape,
  type RectShape,
  type Shape,
  type TextBoxShape,
  type TextShape,
} from "@/lib/lang";
import { DEMO_PROJECT_ROWS, DEMO_PROJECT_SOURCE } from "@/lib/lang/demoProject";
import {
  CardFaceSvg,
  CardSVG,
  ERROR_MESSAGE_MAX,
  ICON_ASCENT,
  IMAGE_PRESERVE_ASPECT,
  TEXT_ASCENT,
  cardSvgPropsEqual,
  faceHasTextBoxOverflow,
  imagePlaceholderStroke,
  imageStatusOf,
  pivotedBaselineY,
  pivotedBoxOrigin,
  resetImageStatusesForTests,
  resolveImageBox,
  setImageProbeForTests,
  subscribeImageStatus,
  textBoxLineX,
  type CardSvgProps,
  type ImageLoadStatus,
  type ResolvedImages,
} from "@/app/editor/_components/cardSvg";
import {
  attachAssetAdapterForTests,
  createInMemoryAssetAdapter,
  resetAssetStoreForTests,
  type StoredAsset,
} from "@/app/editor/_store/assetStore";

// -- fixtures ----------------------------------------------------------------

const demoRows = (): Record<string, Record<string, string>[]> => ({
  Monsters: DEMO_PROJECT_ROWS.map((row) => ({ ...row })),
});
const allEdited = { Monsters: DEMO_PROJECT_ROWS.map(() => true) };

function demoDeck(source: string = DEMO_PROJECT_SOURCE): Deck {
  const result = compileProject(source, demoRows(), allEdited);
  expect(result.diagnostics).toEqual([]);
  return result.model.decks[0];
}

const deck = demoDeck();
const dragonRock = deck.cards[0]; // row 0 (Dragon) × Rock × copy 0

function renderFace(face: "front" | "back", of = dragonRock, geometry = deck): string {
  return renderToStaticMarkup(
    <CardSVG
      xUnits={geometry.xUnits}
      yUnits={geometry.yUnits}
      widthMm={geometry.widthMm}
      heightMm={geometry.heightMm}
      face={of[face]}
      contentHash={of.contentHash}
      error={of.error}
    />,
  );
}

// -- tiny markup helpers (static markup is stable enough to regex) -----------

const unescapeHtml = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attrs[m[1]] = unescapeHtml(m[2]);
  }
  return attrs;
}

const rectTags = (markup: string): Record<string, string>[] =>
  [...markup.matchAll(/<rect\b([^>]*?)\/?>/g)].map((m) => parseAttrs(m[1]));

interface TextTag {
  attrs: Record<string, string>;
  content: string;
}
const textTags = (markup: string): TextTag[] =>
  [...markup.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((m) => ({
    attrs: parseAttrs(m[1]),
    content: unescapeHtml(m[2]),
  }));

// -- Dragon front ------------------------------------------------------------

describe("CardSVG: Dragon front (demo model)", () => {
  const markup = renderFace("front");

  it("uses the unit grid as the viewBox and the physical size as CSS aspect", () => {
    expect(markup).toContain('viewBox="0 0 20 28"');
    expect(markup).toContain('preserveAspectRatio="none"');
    expect(markup).toContain("aspect-ratio:63.5 / 88.9");
  });

  it("renders the banner rect at 0/0/20/3 in grey (Rock suit)", () => {
    const [banner] = rectTags(markup);
    expect(banner).toMatchObject({
      x: "0",
      y: "0",
      width: "20",
      height: "3",
      fill: "grey",
    });
  });

  it("renders the title centered with the §3.4 ascent baseline", () => {
    const title = textTags(markup).find((t) => t.content === "Dragon");
    expect(title).toBeDefined();
    expect(title!.attrs).toMatchObject({
      "text-anchor": "middle",
      x: "10",
      "font-size": "1.6",
      y: String(0.7 + TEXT_ASCENT * 1.6),
    });
  });

  it("renders the cost right-pivoted (pivot right → text-anchor end)", () => {
    const cost = textTags(markup).find((t) => t.content === "Cost: 5");
    expect(cost).toBeDefined();
    expect(cost!.attrs).toMatchObject({
      "text-anchor": "end",
      x: "19",
      y: String(0.9 + TEXT_ASCENT * 1.2),
    });
  });

  it("renders the SWORDS icon in Dicier with all four font features", () => {
    const swords = textTags(markup).find((t) => t.content === "SWORDS");
    expect(swords).toBeDefined();
    // No style: on the demo icons → the flat_dark default family (§3.3 M2).
    expect(swords!.attrs["font-family"]).toBe("Dicier-Flat-Dark");
    for (const feature of ['"liga" 1', '"calt" 1', '"dlig" 1', '"kern" 1']) {
      expect(swords!.attrs.style).toContain(feature);
    }
    expect(swords!.attrs.y).toBe(String(0.7 + ICON_ASCENT * 1.6));
  });

  it("renders exactly [health] hearts at x 1.5/3.5/5.5/7.5, red, baseline from 25", () => {
    const hearts = textTags(markup).filter((t) => t.content === "HEARTS");
    expect(hearts).toHaveLength(4); // Dragon health = 4
    expect(hearts.map((h) => h.attrs.x)).toEqual(["1.5", "3.5", "5.5", "7.5"]);
    for (const heart of hearts) {
      expect(heart.attrs.fill).toBe("red");
      expect(heart.attrs.y).toBe(String(25 + ICON_ASCENT * 1.8));
      expect(heart.attrs["font-family"]).toBe("Dicier-Flat-Dark");
    }
  });

  it("renders the back as the full-bleed teal rect", () => {
    const back = renderFace("back");
    expect(rectTags(back)).toEqual([
      { x: "0", y: "0", width: "20", height: "28", fill: "teal" },
    ]);
  });
});

// -- fractional yUnits (⚑7†) -------------------------------------------------

describe("CardSVG: tarot variant (fractional yUnits)", () => {
  const tarotDeck = demoDeck(DEMO_PROJECT_SOURCE.replace("size: poker", "size: tarot"));

  it("the model's full-height back rect passes 240/7 through fractionally", () => {
    expect(tarotDeck.yUnits).toBe(240 / 7);
    const backRect = tarotDeck.cards[0].back[0];
    expect(backRect.kind).toBe("rect");
    expect(backRect.kind === "rect" && backRect.height).toBe(240 / 7);
  });

  it("renders the fractional value verbatim in viewBox and rect", () => {
    const markup = renderFace("back", tarotDeck.cards[0], tarotDeck);
    expect(markup).toContain(`viewBox="0 0 20 ${240 / 7}"`);
    expect(markup).toContain(`height="${240 / 7}"`);
    expect(markup).toContain("aspect-ratio:70 / 120");
  });
});

// -- icon style → Dicier face family (§3.3 M2) --------------------------------

describe("CardSVG: icon style picks the Dicier face family", () => {
  it("style: round_heavy renders in Dicier-Round-Heavy (others untouched)", () => {
    const styledDeck = demoDeck(
      DEMO_PROJECT_SOURCE.replace('code: "SWORDS"', 'code: "SWORDS"\n    style: round_heavy'),
    );
    const markup = renderFace("front", styledDeck.cards[0], styledDeck);
    const swords = textTags(markup).find((t) => t.content === "SWORDS");
    expect(swords!.attrs["font-family"]).toBe("Dicier-Round-Heavy");
    // The un-styled hearts on the same face keep the flat_dark default.
    const heart = textTags(markup).find((t) => t.content === "HEARTS");
    expect(heart!.attrs["font-family"]).toBe("Dicier-Flat-Dark");
  });
});

// -- Text font: → per-face family AND ascent (§3.3 M3, ◆41) ------------------

describe("CardSVG: Text font: picks the family and the per-face ascent (§3.3 M3, ◆41)", () => {
  it("font: garamond_bold renders CormorantGaramond-Bold at its OWN ascent, not TEXT_ASCENT", () => {
    const fontedDeck = demoDeck(
      DEMO_PROJECT_SOURCE.replace("text: [name]", "text: [name]\n    font: garamond_bold"),
    );
    const markup = renderFace("front", fontedDeck.cards[0], fontedDeck);
    const title = textTags(markup).find((t) => t.content === "Dragon")!;
    expect(title.attrs["font-family"]).toBe("CormorantGaramond-Bold");

    // The shape's declared y is 0.7, size 1.6, top pivot (§3.4 default):
    // baseline = y + ascent × size — with garamond_bold's OWN generated
    // ascent, which must differ from Geist's hand-tuned 0.73 (the whole
    // point of ascentOf's per-face routing).
    const garamondAscent = FONT_METRICS.garamond_bold.ascent;
    expect(garamondAscent).not.toBe(TEXT_ASCENT);
    expect(Number(title.attrs.y)).toBeCloseTo(0.7 + garamondAscent * 1.6, 12);

    // The un-fonted "Cost: 5" text on the same face keeps rendering Geist,
    // at the unchanged TEXT_ASCENT — font: is per-element, not per-card.
    const cost = textTags(markup).find((t) => t.content === "Cost: 5")!;
    expect(cost.attrs["font-family"]).toBe("var(--font-geist-sans), sans-serif");
    expect(Number(cost.attrs.y)).toBeCloseTo(0.9 + TEXT_ASCENT * 1.2, 12);
  });

  it("omitted font: keeps rendering Geist at TEXT_ASCENT exactly as before ◆41 (byte-identical)", () => {
    const markup = renderFace("front");
    const title = textTags(markup).find((t) => t.content === "Dragon")!;
    expect(title.attrs["font-family"]).toBe("var(--font-geist-sans), sans-serif");
    expect(Number(title.attrs.y)).toBe(0.7 + TEXT_ASCENT * 1.6);
  });
});

// -- TextBox font: → per-face family AND ascent (§3.3 M3, ◆41) ---------------

describe("CardFaceSvg: TextBox font: picks the family and the per-face ascent (§3.3 M3, ◆41)", () => {
  const boxShape = (font: FontFace): TextBoxShape => ({
    kind: "textbox",
    x: 2,
    y: 3,
    width: 10,
    height: 6,
    size: 1.5,
    color: "navy",
    align: "left",
    pivot: { h: "left", v: "top" },
    lineHeight: 1.3,
    lines: ["first", "second"],
    clipped: false,
    shrunk: false,
    font,
  });

  const render = (shape: TextBoxShape): string =>
    renderToStaticMarkup(<CardFaceSvg xUnits={20} yUnits={28} face={[shape]} />);

  it("font: courier renders CourierPrime-Regular, tspans offset by courier's own ascent", () => {
    const markup = render(boxShape("courier"));
    const textTag = /<text\b([^>]*)>/.exec(markup)!;
    expect(parseAttrs(textTag[1])["font-family"]).toBe("CourierPrime-Regular");

    const courierAscent = FONT_METRICS.courier.ascent;
    expect(courierAscent).not.toBe(TEXT_ASCENT);
    const tspans = [...markup.matchAll(/<tspan\b([^>]*)>/g)].map((m) => parseAttrs(m[1]));
    expect(Number(tspans[0].y)).toBeCloseTo(3 + courierAscent * 1.5, 12);
    expect(Number(tspans[1].y)).toBeCloseTo(3 + courierAscent * 1.5 + 1.3 * 1.5, 12);
  });

  it("font: geist (explicit or omitted) renders exactly as before ◆41", () => {
    const markup = render(boxShape("geist"));
    const textTag = /<text\b([^>]*)>/.exec(markup)!;
    expect(parseAttrs(textTag[1])["font-family"]).toBe("var(--font-geist-sans), sans-serif");
    const tspans = [...markup.matchAll(/<tspan\b([^>]*)>/g)].map((m) => parseAttrs(m[1]));
    expect(Number(tspans[0].y)).toBe(3 + TEXT_ASCENT * 1.5);
  });
});

// -- error placeholder (⚑8) --------------------------------------------------

describe("CardSVG: error placeholder", () => {
  it("renders placeholder art + the real D002 message for a bad cell", () => {
    const rows = demoRows();
    rows.Monsters[0].health = "banana"; // D002: not numeric
    const result = compileProject(DEMO_PROJECT_SOURCE, rows, allEdited);
    const card = result.model.decks[0].cards[0];
    expect(card.error).toBeDefined();
    expect(card.front).toEqual([]); // model contract: empty faces + error
    const first = card.error!.diagnostics[0];
    expect(first.code).toBe("D002");

    const markup = renderFace("front", card);
    const texts = textTags(markup);
    expect(texts.some((t) => t.content === "⚠")).toBe(true);
    const clamped =
      first.message.length <= ERROR_MESSAGE_MAX
        ? first.message
        : `${first.message.slice(0, ERROR_MESSAGE_MAX - 1)}…`;
    expect(texts.some((t) => t.content === clamped)).toBe(true);
    // Same outer geometry as a healthy card.
    expect(markup).toContain('viewBox="0 0 20 28"');
  });

  it("clamps a long first message and counts the further issues", () => {
    const diagnostics: DataDiagnostic[] = [
      { code: "D002", message: "m".repeat(80) },
      { code: "D003", message: "second" },
      { code: "D008", message: "third" },
    ];
    const markup = renderToStaticMarkup(
      <CardSVG
        xUnits={20}
        yUnits={28}
        widthMm={63.5}
        heightMm={88.9}
        face={[]}
        contentHash="deadbeef"
        error={{ diagnostics }}
      />,
    );
    const texts = textTags(markup);
    expect(
      texts.some((t) => t.content === `${"m".repeat(ERROR_MESSAGE_MAX - 1)}…`),
    ).toBe(true);
    expect(texts.some((t) => t.content === "+2 more issues")).toBe(true);
  });
});

// -- the §4.2 memo comparator ------------------------------------------------

describe("CardFaceSvg: TextBox shapes (§3.3 M3)", () => {
  const boxShape = (over: Partial<TextBoxShape> = {}): TextBoxShape => ({
    kind: "textbox",
    x: 2,
    y: 3,
    width: 10,
    height: 6,
    size: 1.5,
    color: "navy",
    align: "left",
    pivot: { h: "left", v: "top" },
    lineHeight: 1.3,
    lines: ["first", "second", "third"],
    clipped: false,
    shrunk: false,
    font: "geist",
    ...over,
  });

  const render = (shape: TextBoxShape): string =>
    renderToStaticMarkup(<CardFaceSvg xUnits={20} yUnits={28} face={[shape]} />);

  interface Tspan {
    attrs: Record<string, string>;
    content: string;
  }
  const tspans = (markup: string): Tspan[] =>
    [...markup.matchAll(/<tspan\b([^>]*)>([^<]*)<\/tspan>/g)].map((m) => ({
      attrs: parseAttrs(m[1]),
      content: unescapeHtml(m[2]),
    }));

  it("renders ONE <text> in Geist with the model's size and color — never re-wrapping", () => {
    const markup = render(boxShape());
    const texts = [...markup.matchAll(/<text\b([^>]*)>/g)].map((m) => parseAttrs(m[1]));
    expect(texts).toHaveLength(1);
    expect(texts[0]["font-size"]).toBe("1.5");
    expect(texts[0].fill).toBe("navy");
    expect(texts[0]["font-family"]).toContain("--font-geist-sans");
  });

  it("each line is a tspan at baseline y + ascent·size + i·line_height·size", () => {
    const markup = render(boxShape());
    const lines = tspans(markup);
    expect(lines.map((t) => t.content)).toEqual(["first", "second", "third"]);
    for (const [i, t] of lines.entries()) {
      expect(Number(t.attrs.y)).toBeCloseTo(3 + TEXT_ASCENT * 1.5 + i * 1.3 * 1.5, 12);
      expect(t.attrs.x).toBe("2"); // align left → the box's left edge
    }
  });

  it("align middle/right positions each line at the box's center/right edge", () => {
    const middle = render(boxShape({ align: "middle" }));
    expect(parseAttrs(/<text\b([^>]*)>/.exec(middle)![1])["text-anchor"]).toBe("middle");
    for (const t of tspans(middle)) expect(t.attrs.x).toBe("7"); // 2 + 10/2
    const right = render(boxShape({ align: "right" }));
    expect(parseAttrs(/<text\b([^>]*)>/.exec(right)![1])["text-anchor"]).toBe("end");
    for (const t of tspans(right)) expect(t.attrs.x).toBe("12"); // 2 + 10
  });

  it("textBoxLineX is the pure form of that arithmetic", () => {
    expect(textBoxLineX({ x: 2, width: 10 }, "left")).toBe(2);
    expect(textBoxLineX({ x: 2, width: 10 }, "middle")).toBe(7);
    expect(textBoxLineX({ x: 2, width: 10 }, "right")).toBe(12);
  });

  it("blank lines (consecutive hard breaks) render as empty tspans holding their slot", () => {
    const markup = render(boxShape({ lines: ["a", "", "b"] }));
    const lines = tspans(markup);
    expect(lines.map((t) => t.content)).toEqual(["a", "", "b"]);
    expect(Number(lines[2].attrs.y)).toBeCloseTo(3 + TEXT_ASCENT * 1.5 + 2 * 1.3 * 1.5, 12);
  });

  it("a compiled TextBox reaches the markup with its resolved lines (end to end)", () => {
    const source = [
      "Sheet: S",
      "  column t: Text",
      "Template: T",
      "  TextBox:",
      "    x: 1",
      "    y: 1",
      "    width: 18",
      "    height: 10",
      "    text: [t]",
      "    size: 1",
      "Card: C",
      "  sheet: S",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: T",
      "",
    ].join("\n");
    const result = compileProject(source, { S: [{ t: "one\ntwo" }] });
    expect(result.diagnostics).toEqual([]);
    const card = result.model.decks[0].cards[0];
    const markup = renderToStaticMarkup(
      <CardFaceSvg xUnits={20} yUnits={28} face={card.front} />,
    );
    expect(tspans(markup).map((t) => t.content)).toEqual(["one", "two"]);
  });
});

describe("CardSVG: the clipped/shrunk badge (§3.3 M3)", () => {
  const geometry = { xUnits: 20, yUnits: 28, widthMm: 63.5, heightMm: 88.9 };
  const boxShape = (over: Partial<TextBoxShape>): TextBoxShape => ({
    kind: "textbox",
    x: 0,
    y: 0,
    width: 10,
    height: 6,
    size: 1,
    color: "black",
    align: "left",
    pivot: { h: "left", v: "top" },
    lineHeight: 1.3,
    lines: ["a"],
    clipped: false,
    shrunk: false,
    font: "geist",
    ...over,
  });

  const render = (face: TextBoxShape[], error?: { diagnostics: DataDiagnostic[] }): string =>
    renderToStaticMarkup(
      <CardSVG {...geometry} face={face} contentHash="x" error={error} />,
    );

  it("a clipped box shows the subtle badge; a clean one doesn't", () => {
    expect(render([boxShape({ clipped: true })])).toContain("data-textbox-overflow");
    expect(render([boxShape({})])).not.toContain("data-textbox-overflow");
  });

  it("a shrunk-but-fitting box badges too — shrinking is a visible intervention", () => {
    expect(render([boxShape({ shrunk: true, size: 0.8 })])).toContain(
      "data-textbox-overflow",
    );
  });

  it("faceHasTextBoxOverflow is the pure trigger: any textbox, clipped OR shrunk", () => {
    expect(faceHasTextBoxOverflow([boxShape({})])).toBe(false);
    expect(faceHasTextBoxOverflow([boxShape({ clipped: true })])).toBe(true);
    expect(faceHasTextBoxOverflow([boxShape({ shrunk: true })])).toBe(true);
    expect(faceHasTextBoxOverflow(dragonRock.front)).toBe(false); // no boxes at all
  });

  it("error placeholders never badge — the placeholder owns that surface (⚑8)", () => {
    const markup = render([], {
      diagnostics: [{ code: "D002", message: "bad cell" }],
    });
    expect(markup).not.toContain("data-textbox-overflow");
  });

  it("the badge never reaches CardFaceSvg — PDF and landing markup stay clean", () => {
    const markup = renderToStaticMarkup(
      <CardFaceSvg xUnits={20} yUnits={28} face={[boxShape({ clipped: true })]} />,
    );
    expect(markup).not.toContain("data-textbox-overflow");
  });
});

describe("CardFaceSvg: Image shapes (§3.3 M2)", () => {
  const imageShape = (fit: ImageShape["fit"]): ImageShape => ({
    kind: "image",
    x: 1,
    y: 2,
    width: 10,
    height: 8,
    src: "https://example.com/a.png",
    fit,
    pivot: { h: "left", v: "top" },
  });

  const render = (shape: ImageShape, images?: ResolvedImages): string =>
    renderToStaticMarkup(
      <CardFaceSvg xUnits={20} yUnits={28} face={[shape]} images={images} />,
    );

  it("a resolved source renders an <image> with box and per-fit preserveAspectRatio", () => {
    for (const [fit, expected] of [
      ["contain", "xMidYMid meet"],
      ["cover", "xMidYMid slice"],
      ["stretch", "none"],
    ] as const) {
      const markup = render(
        imageShape(fit),
        new Map([
          [
            "https://example.com/a.png",
            { href: "data:image/png;base64,AAA", naturalWidth: 4, naturalHeight: 4 },
          ],
        ]),
      );
      const image = /<image\b[^>]*\/?>/.exec(markup)?.[0];
      expect(image, fit).toBeDefined();
      const attrs = parseAttrs(image!);
      expect(attrs.href).toBe("data:image/png;base64,AAA");
      expect(attrs.x).toBe("1");
      expect(attrs.y).toBe("2");
      expect(attrs.width).toBe("10");
      expect(attrs.height).toBe("8");
      expect(attrs.preserveAspectRatio).toBe(expected);
      expect(IMAGE_PRESERVE_ASPECT[fit]).toBe(expected);
    }
  });

  it("static rendering WITHOUT resolutions is the loading placeholder (SSR default; the live swap is browser-only)", () => {
    const markup = render(imageShape("contain"));
    expect(markup).not.toContain("<image");
    expect(markup).toContain('data-image-placeholder="loading"');
    expect(markup).toContain("Loading image: https://example.com/a.png");
    // Subtle box, same geometry the image would occupy — layout never shifts.
    const rect = rectTags(markup)[0];
    expect(rect.x).toBe("1");
    expect(rect.width).toBe("10");
    expect(rect.fill).toBe("#f3f4f6");
    expect(Number(rect["stroke-width"])).toBeCloseTo(
      imagePlaceholderStroke({ width: 10, height: 8 }),
    );
    // No diagonal cross while merely loading.
    expect(markup).not.toContain("<line");
  });

  it("a failed (null) resolution renders the marked warning box", () => {
    const markup = render(
      imageShape("contain"),
      new Map([["https://example.com/a.png", null]]),
    );
    expect(markup).not.toContain("<image");
    expect(markup).toContain('data-image-placeholder="failed"');
    expect(markup).toContain("Image failed to load: https://example.com/a.png");
    const rect = rectTags(markup)[0];
    expect(rect.fill).toBe("#fef3c7");
    expect(rect.stroke).toBe("#b45309");
    // The diagonal cross marks the box without depending on any font.
    expect([...markup.matchAll(/<line\b/g)]).toHaveLength(2);
  });

  it("a source MISSING from the resolutions map renders the warning box too (never a broken href)", () => {
    const markup = render(imageShape("contain"), new Map());
    expect(markup).not.toContain("<image");
    expect(markup).toContain('data-image-placeholder="failed"');
  });
});

// -- auto dimension (§3.3, 2026-08-10) ----------------------------------------

describe("CardFaceSvg: auto dimension resolves at load time (§3.3)", () => {
  /** width: 16, height: auto — the canonical banner-art shape. */
  const autoHeight: ImageShape = {
    kind: "image",
    x: 2,
    y: 3,
    width: 16,
    height: "auto",
    src: "https://example.com/banner.png",
    fit: "contain",
    pivot: { h: "left", v: "top" },
  };

  const render = (shape: ImageShape, images?: ResolvedImages): string =>
    renderToStaticMarkup(
      <CardFaceSvg xUnits={20} yUnits={28} face={[shape]} images={images} />,
    );

  it("resolveImageBox: 200×100 art in a width:16 auto-height box → height 8 exactly", () => {
    expect(
      resolveImageBox(autoHeight, { naturalWidth: 200, naturalHeight: 100 }),
    ).toEqual({ width: 16, height: 8 });
  });

  it("resolveImageBox: auto WIDTH mirrors — height × w/h", () => {
    const autoWidth: ImageShape = { ...autoHeight, width: "auto", height: 6 };
    expect(
      resolveImageBox(autoWidth, { naturalWidth: 200, naturalHeight: 100 }),
    ).toEqual({ width: 12, height: 6 });
  });

  it("resolveImageBox: no natural size (loading/failed) or degenerate 0-px art → square", () => {
    expect(resolveImageBox(autoHeight, null)).toEqual({ width: 16, height: 16 });
    expect(
      resolveImageBox(autoHeight, { naturalWidth: 0, naturalHeight: 100 }),
    ).toEqual({ width: 16, height: 16 });
  });

  it("resolveImageBox: concrete dimensions pass through untouched, whatever the art says", () => {
    const concrete: ImageShape = { ...autoHeight, height: 12 };
    expect(
      resolveImageBox(concrete, { naturalWidth: 200, naturalHeight: 100 }),
    ).toEqual({ width: 16, height: 12 });
  });

  it("a loaded status carrying natural dims computes the auto dimension in the markup", () => {
    // The static path shares renderImageTag + resolveImageBox with the live
    // preview, so this markup IS what both the preview (post-load) and the
    // rasterizer draw: 200×100 art in a width:16 box → height="8".
    const markup = render(
      autoHeight,
      new Map([
        [
          "https://example.com/banner.png",
          { href: "data:image/png;base64,AAA", naturalWidth: 200, naturalHeight: 100 },
        ],
      ]),
    );
    const image = /<image\b[^>]*\/?>/.exec(markup)?.[0];
    expect(image).toBeDefined();
    const attrs = parseAttrs(image!);
    expect(attrs.width).toBe("16");
    expect(attrs.height).toBe("8");
    expect(attrs.x).toBe("2");
    expect(attrs.y).toBe("3");
  });

  it("pre-load (static, no resolutions) the placeholder box is SQUARE", () => {
    const markup = render(autoHeight);
    expect(markup).toContain('data-image-placeholder="loading"');
    const rect = rectTags(markup)[0];
    expect(rect.width).toBe("16");
    expect(rect.height).toBe("16"); // auto mirrors its sibling — square
    expect(Number(rect["stroke-width"])).toBeCloseTo(
      imagePlaceholderStroke({ width: 16, height: 16 }),
    );
  });

  it("a failed load with auto renders the square warning box", () => {
    const markup = render(
      autoHeight,
      new Map([["https://example.com/banner.png", null]]),
    );
    expect(markup).toContain('data-image-placeholder="failed"');
    const rect = rectTags(markup)[0];
    expect(rect.width).toBe("16");
    expect(rect.height).toBe("16");
    // The diagonal cross spans the square box.
    const lines = [...markup.matchAll(/<line\b([^>]*)\/?>/g)].map((m) => parseAttrs(m[1]));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ x1: "2", y1: "3", x2: "18", y2: "19" });
  });
});

// -- nine-point pivots (§3.4, M3) ---------------------------------------------

describe("CardFaceSvg: nine-point pivots (§3.4 M3)", () => {
  const render = (face: Shape[], images?: ResolvedImages): string =>
    renderToStaticMarkup(
      <CardFaceSvg xUnits={20} yUnits={28} face={face} images={images} />,
    );
  const pivot = (h: Pivot["h"], v: Pivot["v"]): Pivot => ({ h, v });

  it("Rectangle bottom_right at x10,y10 w4,h2 draws the rect at 6,8 (hand-computed)", () => {
    const shape: RectShape = {
      kind: "rect",
      x: 10,
      y: 10,
      width: 4,
      height: 2,
      color: "teal",
      pivot: pivot("right", "bottom"),
    };
    const [rect] = rectTags(render([shape]));
    expect(rect).toMatchObject({ x: "6", y: "8", width: "4", height: "2", fill: "teal" });
  });

  it("pivotedBoxOrigin: the §3.4 (w·fx, h·fy) back-off, all nine points on a 4×2 box", () => {
    const cases: [Pivot["h"], Pivot["v"], number, number][] = [
      ["left", "top", 10, 10],
      ["center", "top", 8, 10],
      ["right", "top", 6, 10],
      ["left", "center", 10, 9],
      ["center", "center", 8, 9],
      ["right", "center", 6, 9],
      ["left", "bottom", 10, 8],
      ["center", "bottom", 8, 8],
      ["right", "bottom", 6, 8],
    ];
    for (const [h, v, x, y] of cases) {
      expect(
        pivotedBoxOrigin({ x: 10, y: 10, pivot: pivot(h, v) }, { width: 4, height: 2 }),
        `${h}/${v}`,
      ).toEqual({ x, y });
    }
  });

  it("Text center_center: baseline = y − size/2 + TEXT_ASCENT·size, exactly; x untouched", () => {
    const shape: TextShape = {
      kind: "text",
      x: 5,
      y: 10,
      size: 2,
      color: "black",
      text: "mid",
      pivot: pivot("center", "center"),
      font: "geist",
    };
    const t = textTags(render([shape])).find((x) => x.content === "mid")!;
    expect(t.attrs["text-anchor"]).toBe("middle");
    // Em top = y − size/2; baseline = top + ascent·size. Written with the
    // renderer's operation order so the float math is bit-identical.
    expect(t.attrs.y).toBe(String(10 - 1 + TEXT_ASCENT * 2));
    // Horizontal pivoting is text-anchor's job — x passes through as-is.
    expect(t.attrs.x).toBe("5");
  });

  it("Text vertical rows: top ≡ the legacy baseline; center/bottom back off ½/1 em", () => {
    const yAt = (v: Pivot["v"]): string => {
      const shape: TextShape = {
        kind: "text",
        x: 1,
        y: 10,
        size: 2,
        color: "black",
        text: "t",
        pivot: pivot("left", v),
        font: "geist",
      };
      return textTags(render([shape]))[0].attrs.y;
    };
    expect(yAt("top")).toBe(String(10 + TEXT_ASCENT * 2)); // the pre-M3 realization
    expect(yAt("center")).toBe(String(10 - 1 + TEXT_ASCENT * 2));
    expect(yAt("bottom")).toBe(String(10 - 2 + TEXT_ASCENT * 2));
  });

  it("Icon pivots run the same em-box formula with ICON_ASCENT", () => {
    const shape: IconShape = {
      kind: "icon",
      x: 3,
      y: 20,
      size: 1.5,
      color: "red",
      code: "HEARTS",
      pivot: pivot("right", "bottom"),
      style: "flat_dark",
    };
    const t = textTags(render([shape]))[0];
    expect(t.attrs["text-anchor"]).toBe("end");
    expect(t.attrs.y).toBe(String(20 - 1.5 + ICON_ASCENT * 1.5));
  });

  it("pivotedBaselineY is the pure form of the em-box formula", () => {
    expect(pivotedBaselineY({ y: 10, size: 2, pivot: pivot("left", "top") }, TEXT_ASCENT)).toBe(
      10 + TEXT_ASCENT * 2,
    );
    expect(
      pivotedBaselineY({ y: 10, size: 2, pivot: pivot("left", "center") }, TEXT_ASCENT),
    ).toBe(10 - 1 + TEXT_ASCENT * 2);
    expect(
      pivotedBaselineY({ y: 10, size: 2, pivot: pivot("left", "bottom") }, ICON_ASCENT),
    ).toBe(10 - 2 + ICON_ASCENT * 2);
  });

  /** width: 16, height: auto, pivoted at its bottom-center point (10, 20). */
  const autoPivoted: ImageShape = {
    kind: "image",
    x: 10,
    y: 20,
    width: 16,
    height: "auto",
    src: "https://x/banner.png",
    fit: "contain",
    pivot: { h: "center", v: "bottom" },
  };

  it("Image bottom_center + auto height: the offset comes from the RESOLVED box", () => {
    // 200×100 art in a width:16 box → height 8 (resolveImageBox), so
    // bottom_center backs the origin off by (16/2, 8) → (2, 12).
    const markup = render(
      [autoPivoted],
      new Map([
        [
          "https://x/banner.png",
          { href: "data:image/png;base64,AAA", naturalWidth: 200, naturalHeight: 100 },
        ],
      ]),
    );
    const attrs = parseAttrs(/<image\b([^>]*)\/?>/.exec(markup)![1]);
    expect(attrs).toMatchObject({ x: "2", y: "12", width: "16", height: "8" });
  });

  it("Image auto + pivot in the square-fallback states pivots the 16×16 square", () => {
    // Loading (no resolutions): the square box (16×16) pivots → (2, 4).
    const loading = render([autoPivoted]);
    expect(loading).toContain('data-image-placeholder="loading"');
    expect(rectTags(loading)[0]).toMatchObject({ x: "2", y: "4", width: "16", height: "16" });
    // Failed: same pivoted square, warning-styled, the cross spans it.
    const failed = render([autoPivoted], new Map([["https://x/banner.png", null]]));
    expect(failed).toContain('data-image-placeholder="failed"');
    expect(rectTags(failed)[0]).toMatchObject({ x: "2", y: "4", width: "16", height: "16" });
    const lines = [...failed.matchAll(/<line\b([^>]*)\/?>/g)].map((m) => parseAttrs(m[1]));
    expect(lines[0]).toMatchObject({ x1: "2", y1: "4", x2: "18", y2: "20" });
  });

  it("TextBox bottom_right: the whole box moves; interior align keeps its arithmetic", () => {
    const shape: TextBoxShape = {
      kind: "textbox",
      x: 12,
      y: 9,
      width: 10,
      height: 6,
      size: 1.5,
      color: "navy",
      align: "middle",
      pivot: pivot("right", "bottom"),
      lineHeight: 1.3,
      lines: ["a", "b"],
      clipped: false,
      shrunk: false,
      font: "geist",
    };
    const markup = render([shape]);
    // Box origin: (12 − 10, 9 − 6) = (2, 3); align middle → line x = 2 + 10/2.
    expect(parseAttrs(/<text\b([^>]*)>/.exec(markup)![1])["text-anchor"]).toBe("middle");
    const lines = [...markup.matchAll(/<tspan\b([^>]*)>/g)].map((m) => parseAttrs(m[1]));
    expect(lines.map((l) => l.x)).toEqual(["7", "7"]);
    expect(Number(lines[0].y)).toBeCloseTo(3 + TEXT_ASCENT * 1.5, 12);
    expect(Number(lines[1].y)).toBeCloseTo(3 + TEXT_ASCENT * 1.5 + 1.3 * 1.5, 12);
  });
});

describe("CardFaceSvg: Qr shapes (§7.1a)", () => {
  const render = (face: Shape[]): string =>
    renderToStaticMarkup(<CardFaceSvg xUnits={20} yUnits={28} face={face} />);

  /** moduleCount 21 (a real QR's smallest size), one dark module at (0,0) —
   * the top-left corner of the top-left finder pattern, which is always dark
   * in a real QR (qr.test.ts's structural check), so this is representative
   * without needing the whole matrix to hand-compute the path. */
  const oneModule: QrShape = {
    kind: "qr",
    x: 2,
    y: 2,
    size: 10,
    color: "black",
    background: "white",
    pivot: { h: "left", v: "top" },
    moduleCount: 21,
    modules: "1" + "0".repeat(21 * 21 - 1),
  };

  it("hand-computable markup: background rect, module unit, and the one dark module's path", () => {
    const markup = render([oneModule]);
    const [rect] = rectTags(markup);
    expect(rect).toMatchObject({ x: "2", y: "2", width: "10", height: "10", fill: "white" });

    // grid = moduleCount + 8 (4-module quiet zone per side, §7.1a); unit =
    // size / grid, ROUNDED to 4 decimal places (adversarial review,
    // 2026-08-11 — 0.0001 unit is far below print resolution, and full
    // float precision bloated the path); the box origin is (2,2) for
    // top_left, so the module at row0/col0 sits 4 (rounded) units in from
    // the origin on both axes, rounded again.
    const unit = 0.3448; // round(10/29, 4)
    const mx = 3.3792; // round(2 + 4 × 0.3448, 4)
    const my = 3.3792;
    const expectedD = `M${mx} ${my}h${unit}v${unit}h-${unit}z`;

    const path = /<path\b([^>]*)\/?>/.exec(markup)!;
    const attrs = parseAttrs(path[1]);
    expect(attrs.fill).toBe("black");
    expect(attrs.d).toBe(expectedD);
    // Full precision (17 significant digits) never leaks into the path.
    expect(attrs.d).not.toContain("0.34482758620689655");
    // ONE <path> for the whole matrix, regardless of module count.
    expect([...markup.matchAll(/<path\b/g)]).toHaveLength(1);
  });

  it("pivot bottom_right shifts the box by (size, size) — same pivotedBoxOrigin math as Rectangle/Image", () => {
    const shifted: QrShape = { ...oneModule, pivot: { h: "right", v: "bottom" } };
    const markup = render([shifted]);
    const [rect] = rectTags(markup);
    // top_left origin was (2,2); bottom_right backs off by (size, size).
    expect(rect).toMatchObject({ x: "-8", y: "-8", width: "10", height: "10" });
    expect(
      pivotedBoxOrigin(shifted, { width: shifted.size, height: shifted.size }),
    ).toEqual({ x: -8, y: -8 });
  });

  it("background and color are independent CSS strings, not swapped", () => {
    const markup = render([{ ...oneModule, color: "red", background: "navy" }]);
    expect(rectTags(markup)[0].fill).toBe("navy");
    expect(parseAttrs(/<path\b([^>]*)\/?>/.exec(markup)![1]).fill).toBe("red");
  });

  it("no dark modules → an empty path (still one <path> element, valid empty d)", () => {
    const blank: QrShape = { ...oneModule, modules: "0".repeat(21 * 21) };
    const markup = render([blank]);
    const attrs = parseAttrs(/<path\b([^>]*)\/?>/.exec(markup)![1]);
    expect(attrs.d).toBe("");
  });
});

describe("cardSvgPropsEqual (the §4.2 memo comparator)", () => {
  const base: CardSvgProps = {
    xUnits: 20,
    yUnits: 28,
    widthMm: 63.5,
    heightMm: 88.9,
    face: dragonRock.front,
    contentHash: dragonRock.contentHash,
  };

  it("same contentHash + geometry → skip, even for DIFFERENT face arrays", () => {
    // Recompiles mint fresh arrays for unchanged cards; the hash is the key.
    expect(cardSvgPropsEqual(base, { ...base, face: [...dragonRock.front] })).toBe(true);
  });

  it("copies share hashes by design — the comparator treats them as identical", () => {
    const copy = deck.cards[1]; // Dragon × Rock, copy 1
    expect(copy.contentHash).toBe(dragonRock.contentHash);
    expect(
      cardSvgPropsEqual(base, { ...base, face: copy.front, contentHash: copy.contentHash }),
    ).toBe(true);
  });

  it("a changed hash re-renders", () => {
    const imp = deck.cards[6]; // Imp × Rock
    expect(imp.contentHash).not.toBe(dragonRock.contentHash);
    expect(
      cardSvgPropsEqual(base, { ...base, face: imp.front, contentHash: imp.contentHash }),
    ).toBe(false);
  });

  it("changed geometry re-renders", () => {
    expect(cardSvgPropsEqual(base, { ...base, yUnits: 240 / 7 })).toBe(false);
    expect(cardSvgPropsEqual(base, { ...base, xUnits: 24 })).toBe(false);
    expect(cardSvgPropsEqual(base, { ...base, heightMm: 120 })).toBe(false);
  });

  it("error is compared by identity", () => {
    const error = { diagnostics: [{ code: "D002", message: "x" } as DataDiagnostic] };
    const withError = { ...base, error };
    expect(cardSvgPropsEqual(withError, { ...base, error })).toBe(true);
    expect(cardSvgPropsEqual(withError, { ...base, error: { ...error } })).toBe(false);
    expect(cardSvgPropsEqual(base, withError)).toBe(false);
  });
});

// -- asset: resolution, live preview (§7.1b) ---------------------------------
//
// `renderToStaticMarkup` never reaches this machinery (LiveImage's
// useSyncExternalStore reads getServerSnapshot — the "loading" placeholder —
// without ever calling `subscribe`, exactly like the pre-existing URL image
// path, which has never been component-tested for the same reason). What CAN
// run headless is the resolution logic itself: `resolveAssetObjectUrl` only
// needs `Blob`/`URL.createObjectURL` (present in Node 22), and `imageProbe`
// is the existing injectable seam that keeps the real `Image`/network probe
// out of these tests. So these tests call the exported machinery directly —
// the real production code path `LiveImage` drives, not a parallel one.

const dragonBytes = new Uint8Array([1, 2, 3, 4]);
const dragonAsset: StoredAsset = { name: "dragon", mime: "image/png", bytes: dragonBytes };

/** Wait for one full microtask+macrotask turn — long enough for the
 * (synchronous-resolving, in this test setup) getBytes → probe chain to
 * settle, regardless of how many `.then()` hops it takes. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Subscribe and resolve once `imageStatusOf(src)` stops being "loading". */
async function settledStatus(src: string): Promise<ImageLoadStatus> {
  const unsubscribe = subscribeImageStatus(src, () => {});
  await flush();
  unsubscribe();
  return imageStatusOf(src);
}

beforeEach(() => {
  resetImageStatusesForTests();
  resetAssetStoreForTests();
  // Stub probe (module note): always "succeeds" at a fixed natural size,
  // whatever href it's given (a blob: URL for assets, a plain URL string for
  // the pre-existing path) — the real `Image`/network probe stays out of
  // these tests, same seam pdfRaster.tsx's tests would use if it had any
  // node-testable DOM-dependent surface.
  setImageProbeForTests(async () => ({ naturalWidth: 200, naturalHeight: 100 }));
});

afterEach(() => {
  setImageProbeForTests(null);
  resetImageStatusesForTests();
  resetAssetStoreForTests();
});

describe("asset: resolution — cache per name, revoke/re-resolve on change (§7.1b)", () => {
  it("resolves a known asset to a loaded status carrying a blob: href and the probed natural size", async () => {
    attachAssetAdapterForTests(createInMemoryAssetAdapter([dragonAsset]));
    const status = await settledStatus("asset:dragon");
    expect(status).toMatchObject({ state: "loaded", naturalWidth: 200, naturalHeight: 100 });
    expect(status.state === "loaded" && status.href.startsWith("blob:")).toBe(true);
  });

  it("a missing asset name resolves to failed — the existing broken-image placeholder path", async () => {
    attachAssetAdapterForTests(createInMemoryAssetAdapter([])); // no "dragon"
    const status = await settledStatus("asset:dragon");
    expect(status).toEqual({ state: "failed" });
  });

  it("a plain URL src still resolves through imageProbe directly (unaffected by §7.1b)", async () => {
    attachAssetAdapterForTests(createInMemoryAssetAdapter([]));
    const status = await settledStatus("https://example.com/a.png");
    expect(status).toMatchObject({
      state: "loaded",
      href: "https://example.com/a.png",
      naturalWidth: 200,
      naturalHeight: 100,
    });
  });

  it("rename invalidates the OLD name (now broken) via the assetStore subscription", async () => {
    attachAssetAdapterForTests(createInMemoryAssetAdapter([dragonAsset]));
    const loaded = await settledStatus("asset:dragon");
    expect(loaded.state).toBe("loaded");

    // Simulate a still-mounted card: subscribe and stay subscribed through
    // the rename, exactly like a live LiveImage instance would.
    const unsubscribe = subscribeImageStatus("asset:dragon", () => {});
    const { assetStore } = await import("@/app/editor/_store/assetStore");
    await assetStore.refresh(); // rename validates against the store's own meta cache
    await assetStore.rename("dragon", "wyrm");
    await flush();
    unsubscribe();

    expect(imageStatusOf("asset:dragon")).toEqual({ state: "failed" });
    const wyrm = await settledStatus("asset:wyrm");
    expect(wyrm.state).toBe("loaded");
  });

  it("delete invalidates a mounted reference to failed", async () => {
    attachAssetAdapterForTests(createInMemoryAssetAdapter([dragonAsset]));
    await settledStatus("asset:dragon");
    const { assetStore } = await import("@/app/editor/_store/assetStore");
    const unsubscribe = subscribeImageStatus("asset:dragon", () => {});
    await assetStore.remove("dragon");
    await flush();
    unsubscribe();
    expect(imageStatusOf("asset:dragon")).toEqual({ state: "failed" });
  });

  it("replace (re-upload the same name) re-resolves rather than keeping the stale object URL", async () => {
    attachAssetAdapterForTests(createInMemoryAssetAdapter([dragonAsset]));
    const first = await settledStatus("asset:dragon");
    const firstHref = first.state === "loaded" ? first.href : null;
    expect(firstHref).not.toBeNull();

    const unsubscribe = subscribeImageStatus("asset:dragon", () => {});
    const { assetStore } = await import("@/app/editor/_store/assetStore");
    await assetStore.upload("dragon", "image/png", new Uint8Array([9, 9, 9]));
    await flush();
    unsubscribe();

    const second = imageStatusOf("asset:dragon");
    expect(second.state).toBe("loaded");
    // A fresh object URL — the stale one from before the replace was revoked
    // and dropped from the cache, not reused.
    expect(second.state === "loaded" && second.href).not.toBe(firstHref);
  });

  it("clear() invalidates every cached asset src at once", async () => {
    const impAsset: StoredAsset = { name: "imp", mime: "image/png", bytes: new Uint8Array([1]) };
    attachAssetAdapterForTests(createInMemoryAssetAdapter([dragonAsset, impAsset]));
    await settledStatus("asset:dragon");
    await settledStatus("asset:imp");
    const u1 = subscribeImageStatus("asset:dragon", () => {});
    const u2 = subscribeImageStatus("asset:imp", () => {});
    const { assetStore } = await import("@/app/editor/_store/assetStore");
    await assetStore.refresh(); // clear() no-ops on an empty meta cache
    await assetStore.clear();
    await flush();
    u1();
    u2();
    expect(imageStatusOf("asset:dragon")).toEqual({ state: "failed" });
    expect(imageStatusOf("asset:imp")).toEqual({ state: "failed" });
  });
});
