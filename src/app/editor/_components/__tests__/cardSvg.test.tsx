/**
 * CardSVG (task 5): markup tests against the REAL demo model — compileProject
 * on the shared §3.9 seed — plus the exported §4.2 memo comparator. Geometry
 * flows through verbatim (fractional yUnits included), text baselines follow
 * the §3.4 ascent realization, and icons carry the Dicier family with all
 * four ligature features (§4.2 † — dlig is required for double-digit codes).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  compileProject,
  type DataDiagnostic,
  type Deck,
  type ImageShape,
  type TextBoxShape,
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
  resolveImageBox,
  textBoxLineX,
  type CardSvgProps,
  type ResolvedImages,
} from "@/app/editor/_components/cardSvg";

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

  it("renders the cost right-anchored (anchor right → text-anchor end)", () => {
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
    lineHeight: 1.3,
    lines: ["first", "second", "third"],
    clipped: false,
    shrunk: false,
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

  it("align middle/right anchor each line at the box's center/right edge", () => {
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
    lineHeight: 1.3,
    lines: ["a"],
    clipped: false,
    shrunk: false,
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
