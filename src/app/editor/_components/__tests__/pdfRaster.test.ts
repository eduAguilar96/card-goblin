/**
 * pdfRaster's PURE part (§6.1, §3.3 M2). The rasterization itself is DOM-only
 * and excluded from vitest by injection (see pdfRaster.tsx); what IS testable
 * is the font-coverage derivation: the embed CSS must cover exactly the
 * Dicier faces the exported shapes use — all ten families exist, but only the
 * used ones may be inlined (each is ~100 KB of base64 per rasterized SVG).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { IconStyle, ImageShape, Shape } from "@/lib/lang";
import { CardFaceSvg, type ResolvedImages } from "../cardSvg";
import type { FaceRasterSpec } from "../pdfLayout";
import { iconFamiliesUsed, imageUrlsUsed } from "../pdfRaster";

const icon = (style: IconStyle): Shape => ({
  kind: "icon",
  x: 0,
  y: 0,
  size: 1,
  color: "black",
  code: "HEARTS",
  anchor: "left",
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
});

const text: Shape = {
  kind: "text",
  x: 0,
  y: 0,
  size: 1,
  color: "black",
  text: "hi",
  anchor: "left",
};

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
    };
    expect(imageUrlsUsed(new Map([["a:front", spec([banner])]]))).toEqual([
      "https://x/banner.png",
    ]);
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
