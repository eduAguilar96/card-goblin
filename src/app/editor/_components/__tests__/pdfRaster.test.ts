/**
 * pdfRaster's PURE part (§6.1, §3.3 M2). The rasterization itself is DOM-only
 * and excluded from vitest by injection (see pdfRaster.tsx); what IS testable
 * is the font-coverage derivation: the embed CSS must cover exactly the
 * Dicier faces the exported shapes use — all ten families exist, but only the
 * used ones may be inlined (each is ~100 KB of base64 per rasterized SVG).
 */
import { describe, expect, it } from "vitest";
import type { IconStyle, Shape } from "@/lib/lang";
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
});
