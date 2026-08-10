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
import { iconFamiliesUsed } from "../pdfRaster";

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
