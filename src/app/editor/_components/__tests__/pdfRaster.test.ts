/**
 * pdfRaster's PURE part (§6.1, §3.3 M2, §7.1b, M3 ◆41). The rasterization
 * itself is DOM-only and excluded from vitest by injection (see
 * pdfRaster.tsx); what IS testable is the font-coverage derivation: the
 * embed CSS must cover exactly the Dicier faces AND the ◆41 Text/TextBox
 * faces the exported shapes use — all ten Dicier families and all eight ◆41
 * families exist, but only the used ones may be inlined (Dicier ~100 KB,
 * the ◆41 TTFs ~70 KB–670 KB, of base64 per rasterized SVG) — plus, since
 * §7.1b, which image `src`s are "remote" at all, and, since ◆41, the CSS
 * `src:` format-detection fix (`parseFontSrc`).
 *
 * `loadAssetData` (the asset: → data-URI path) is DOM-only for the same
 * reason `loadImageData` always has been (canvas/Image, no `document` here)
 * — on the manual browser checklist, not a gap introduced by this change.
 * What §7.1b actually needs guarded by a test is the ROUTING decision —
 * `remoteImageUrlsUsed` below is the pure predicate `resolveImageSources`
 * dispatches on, so the "never counted in the remote CORS pre-flight" claim
 * is checked directly rather than by proxy.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FontFace, IconStyle, ImageShape, Shape } from "@/lib/lang";
import { CardFaceSvg, type ResolvedImages } from "../cardSvg";
import type { FaceRasterSpec } from "../pdfLayout";
import {
  iconFamiliesUsed,
  imageUrlsUsed,
  parseFontSrc,
  remoteImageUrlsUsed,
  textFontFamiliesUsed,
} from "../pdfRaster";

const icon = (style: IconStyle): Shape => ({
  kind: "icon",
  x: 0,
  y: 0,
  size: 1,
  color: "black",
  code: "HEARTS",
  pivot: { h: "left", v: "top" },
  style,
});

const image = (src: string): Shape => ({
  kind: "image",
  x: 0,
  y: 0,
  width: 10,
  height: 8,
  src,
  fit: "contain",
  pivot: { h: "left", v: "top" },
});

const text: Shape = {
  kind: "text",
  x: 0,
  y: 0,
  size: 1,
  color: "black",
  text: "hi",
  pivot: { h: "left", v: "top" },
  font: "geist",
};

const textbox: Shape = {
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
  lines: ["wrapped", "lines"],
  clipped: false,
  shrunk: false,
  font: "geist",
};

/** Like `text`/`textbox` above but with a chosen `font:` (§3.3 M3, ◆41). */
const textFont = (font: FontFace): Shape => ({ ...text, font });
const textboxFont = (font: FontFace): Shape => ({ ...textbox, font });

function spec(face: Shape[]): FaceRasterSpec {
  return { xUnits: 20, yUnits: 28, widthMm: 63.5, heightMm: 88.9, face };
}

describe("iconFamiliesUsed", () => {
  it("collects exactly the families of the styles drawn, deduped and sorted", () => {
    const specs = new Map<string, FaceRasterSpec>([
      ["a:front", spec([icon("pixel"), icon("flat_dark"), text])],
      ["a:back", spec([icon("flat_dark")])],
    ]);
    expect(iconFamiliesUsed(specs)).toEqual(["Dicier-Flat-Dark", "Dicier-Pixel"]);
  });

  it("no icons → no Dicier families requested at all", () => {
    expect(iconFamiliesUsed(new Map([["a:front", spec([text])]]))).toEqual([]);
  });

  it("a TextBox needs NO font additions — it draws in Geist, which every export embeds", () => {
    // §3.3 M3: getFontEmbedCss starts from geistFamilies() unconditionally
    // (Text shapes have always needed it), so wrapped text rides along free;
    // the box must not request any Dicier family.
    expect(iconFamiliesUsed(new Map([["a:front", spec([textbox, text])]]))).toEqual([]);
    expect(imageUrlsUsed(new Map([["a:front", spec([textbox])]]))).toEqual([]);
    // And the serialized face markup carries the resolved lines verbatim —
    // the rasterizer re-renders CardFaceSvg, never re-wraps.
    const markup = renderToStaticMarkup(
      createElement(CardFaceSvg, { xUnits: 20, yUnits: 28, face: [textbox] }),
    );
    expect(markup).toContain(">wrapped</tspan>");
    expect(markup).toContain(">lines</tspan>");
  });
});

describe("textFontFamiliesUsed (§3.3 M3, ◆41)", () => {
  it("collects exactly the ◆41 families drawn, deduped and sorted, on Text AND TextBox", () => {
    const specs = new Map<string, FaceRasterSpec>([
      ["a:front", spec([textFont("garamond_bold"), textFont("courier"), icon("pixel")])],
      ["a:back", spec([textboxFont("courier")])],
    ]);
    expect(textFontFamiliesUsed(specs)).toEqual([
      "CormorantGaramond-Bold",
      "CourierPrime-Regular",
    ]);
  });

  it("geist (explicit or omitted) requests NO ◆41 family — every export already embeds it", () => {
    // Mirrors the "TextBox needs no font additions" Dicier test above:
    // geist's family is a CSS var(), not a real @font-face family name
    // findFontFaces could match, and geistFamilies() covers it unconditionally.
    expect(textFontFamiliesUsed(new Map([["a:front", spec([text, textbox])]]))).toEqual([]);
    expect(
      textFontFamiliesUsed(new Map([["a:front", spec([textFont("geist"), textboxFont("geist")])]])),
    ).toEqual([]);
  });

  it("no text/textbox shapes → no ◆41 families requested at all", () => {
    expect(textFontFamiliesUsed(new Map([["a:front", spec([icon("pixel")])]]))).toEqual([]);
  });

  it("a mix across faces still dedupes to one entry per family", () => {
    const specs = new Map<string, FaceRasterSpec>([
      ["a:front", spec([textFont("courier"), textboxFont("courier")])],
    ]);
    expect(textFontFamiliesUsed(specs)).toEqual(["CourierPrime-Regular"]);
  });
});

describe("parseFontSrc (§3.3 M3, ◆41 — the format-detection fix)", () => {
  it("reads the DECLARED format, never hardcoding woff2 (the bug this fixes)", () => {
    const entries = parseFontSrc(
      `url("./fonts/CormorantGaramond/CormorantGaramond-Bold.ttf") format("truetype")`,
      "https://example.com/styles.css",
    );
    expect(entries).toEqual([
      { url: "https://example.com/fonts/CormorantGaramond/CormorantGaramond-Bold.ttf", format: "truetype" },
    ]);
  });

  it("infers the format from the URL's extension when format() is omitted", () => {
    const entries = parseFontSrc(`url(./a.woff2)`, "https://example.com/styles.css");
    expect(entries).toEqual([{ url: "https://example.com/a.woff2", format: "woff2" }]);
  });

  it("returns EVERY declared source in order, not just the first (the other half of the fix)", () => {
    const entries = parseFontSrc(
      `url("./a.woff2") format("woff2"), url("./a.woff") format("woff"), url("./a.ttf") format("truetype")`,
      "https://example.com/styles.css",
    );
    expect(entries.map((e) => e.format)).toEqual(["woff2", "woff", "truetype"]);
    expect(entries.map((e) => e.url)).toEqual([
      "https://example.com/a.woff2",
      "https://example.com/a.woff",
      "https://example.com/a.ttf",
    ]);
  });

  it("resolves a relative url() against the stylesheet's own href", () => {
    const entries = parseFontSrc(
      `url(../fonts/CourierPrime/CourierPrime-Italic.ttf) format("truetype")`,
      "https://example.com/assets/styles.css",
    );
    expect(entries[0].url).toBe("https://example.com/fonts/CourierPrime/CourierPrime-Italic.ttf");
  });

  it("handles unquoted, single-, and double-quoted url()/format() forms alike", () => {
    for (const src of [
      `url(a.ttf) format(truetype)`,
      `url('a.ttf') format('truetype')`,
      `url("a.ttf") format("truetype")`,
    ]) {
      const entries = parseFontSrc(src, "https://example.com/styles.css");
      expect(entries, src).toEqual([{ url: "https://example.com/a.ttf", format: "truetype" }]);
    }
  });

  it("a src with no url() at all yields no entries", () => {
    expect(parseFontSrc("local(Arial)", "https://example.com/styles.css")).toEqual([]);
  });
});

describe("imageUrlsUsed (§3.3 M2)", () => {
  it("collects the distinct image URLs across all faces, deduped and sorted", () => {
    const specs = new Map<string, FaceRasterSpec>([
      ["a:front", spec([image("https://x/b.png"), image("https://x/a.png"), text])],
      ["a:back", spec([image("https://x/a.png"), icon("pixel")])],
    ]);
    expect(imageUrlsUsed(specs)).toEqual(["https://x/a.png", "https://x/b.png"]);
  });

  it("no image shapes → no URLs (the modal pre-flight is then a no-op)", () => {
    expect(imageUrlsUsed(new Map([["a:front", spec([text, icon("pixel")])]]))).toEqual([]);
  });

  it("an auto-dimensioned shape's URL is collected like any other", () => {
    const banner: ImageShape = {
      kind: "image",
      x: 0,
      y: 0,
      width: 20,
      height: "auto",
      src: "https://x/banner.png",
      fit: "contain",
      pivot: { h: "left", v: "top" },
    };
    expect(imageUrlsUsed(new Map([["a:front", spec([banner])]]))).toEqual([
      "https://x/banner.png",
    ]);
  });

  it("includes asset: sources too (§7.1b) — they're still checked/counted, just not fetched", () => {
    const specs = new Map<string, FaceRasterSpec>([
      ["a:front", spec([image("asset:dragon"), image("https://x/a.png")])],
    ]);
    expect(imageUrlsUsed(specs)).toEqual(["asset:dragon", "https://x/a.png"]);
  });
});

describe("remoteImageUrlsUsed (§7.1b: the CORS pre-flight excludes asset:)", () => {
  it("drops asset: sources, keeps URLs, same dedup/sort as imageUrlsUsed", () => {
    const specs = new Map<string, FaceRasterSpec>([
      [
        "a:front",
        spec([image("asset:dragon"), image("https://x/b.png"), image("https://x/a.png")]),
      ],
      ["a:back", spec([image("asset:dragon"), image("asset:imp")])],
    ]);
    expect(remoteImageUrlsUsed(specs)).toEqual(["https://x/a.png", "https://x/b.png"]);
  });

  it("all-asset faces → an empty remote list (nothing to CORS pre-flight)", () => {
    const specs = new Map([["a:front", spec([image("asset:dragon")])]]);
    expect(remoteImageUrlsUsed(specs)).toEqual([]);
    expect(imageUrlsUsed(specs)).toEqual(["asset:dragon"]); // still in the full list
  });

  it("no image shapes → both lists empty", () => {
    const specs = new Map([["a:front", spec([text, icon("pixel")])]]);
    expect(remoteImageUrlsUsed(specs)).toEqual([]);
    expect(imageUrlsUsed(specs)).toEqual([]);
  });
});

describe("auto dimension in the rasterized markup (§3.3, 2026-08-10)", () => {
  // serializeFaceSvg itself is DOM-only (createRoot/XMLSerializer — manual
  // checklist), but the markup it serializes is EXACTLY CardFaceSvg with the
  // rasterizer's svgAttributes and its resolved images (§6.1: never a
  // parallel shape renderer). Rendering that same element statically pins
  // that a ResolvedImage's natural size — captured by resolveImageSources at
  // embed time — resolves the auto dimension in the exported SVG, and that a
  // failed resolution exports the square placeholder box.
  const banner: ImageShape = {
    kind: "image",
    x: 2,
    y: 0,
    width: 16,
    height: "auto",
    src: "https://x/banner.png",
    fit: "contain",
    pivot: { h: "left", v: "top" },
  };

  const serialize = (images: ResolvedImages): string =>
    renderToStaticMarkup(
      createElement(CardFaceSvg, {
        xUnits: 20,
        yUnits: 28,
        face: [banner],
        images,
        svgAttributes: { xmlns: "http://www.w3.org/2000/svg", width: 750, height: 1050 },
      }),
    );

  it("stubbed 200×100 natural dims resolve height: auto to 8 in the serialized SVG", () => {
    const markup = serialize(
      new Map([
        [
          "https://x/banner.png",
          { href: "data:image/png;base64,AAA", naturalWidth: 200, naturalHeight: 100 },
        ],
      ]),
    );
    expect(markup).toContain('width="16"');
    expect(markup).toContain('height="8"');
    expect(markup).toContain('href="data:image/png;base64,AAA"');
  });

  it("a failed (null) resolution exports the marked placeholder as a SQUARE box", () => {
    const markup = serialize(new Map([["https://x/banner.png", null]]));
    expect(markup).toContain('data-image-placeholder="failed"');
    expect(markup).toContain('width="16"');
    expect(markup).toContain('height="16"');
  });
});
