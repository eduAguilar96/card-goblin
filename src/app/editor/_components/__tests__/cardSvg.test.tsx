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
  imagePlaceholderStroke,
  type CardSvgProps,
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

  const render = (
    shape: ImageShape,
    images?: ReadonlyMap<string, string | null>,
  ): string =>
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
        new Map([["https://example.com/a.png", "data:image/png;base64,AAA"]]),
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
      imagePlaceholderStroke(imageShape("contain")),
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
