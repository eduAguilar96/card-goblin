"use client";

/**
 * PDF export — browser-only rasterization (DESIGN.md §6.1, M2).
 *
 * For each distinct card face (faceKey → FaceRasterSpec from pdfLayout), this
 * module serializes the SAME CardFaceSvg markup the preview renders, loads it
 * into an `<img>` via an SVG blob URL, draws it onto a canvas at 300 DPI, and
 * encodes a PNG — so fonts and ligatures match the preview exactly (§6.1).
 *
 * DOM-only by nature (canvas, Image, fonts). It is EXCLUDED from vitest by
 * injection: the export flow takes a `RasterizeFaces` function and tests pass
 * a stub. Everything in this file is on the manual browser checklist.
 *
 * The font trap this file exists to handle: an SVG loaded through `<img>`
 * renders in an isolated document that can neither see the page's loaded
 * fonts nor fetch external resources. `document.fonts.ready` alone is NOT
 * enough — Dicier (and Geist) must be re-declared INSIDE the SVG as
 * `@font-face` rules with data: URIs. `buildFontEmbedCss` scrapes the page's
 * own @font-face rules for the needed families, inlines their sources, and
 * also pins the `--font-geist-sans` variable (cardSvg's text family is
 * `var(--font-geist-sans), sans-serif`, and CSS variables don't cross into
 * the img document either). Any scrape/fetch failure degrades to fallback
 * fonts rather than failing the export.
 */

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { CardFaceSvg, ICON_FONT_FAMILY } from "@/app/editor/_components/cardSvg";
import type { FaceRasterSpec } from "@/app/editor/_components/pdfLayout";

/** §6.1: rasterize at 300 DPI — px = mm × 300 / 25.4. */
export const RASTER_DPI = 300;

/** The injection seam: the export flow (pdfExportModal) takes one of these;
 * the app passes `rasterizeFaces`, tests pass a stub. */
export type RasterizeFaces = (
  specs: ReadonlyMap<string, FaceRasterSpec>,
) => Promise<Map<string, Uint8Array>>;

// ---------------------------------------------------------------------------
// Font embedding
// ---------------------------------------------------------------------------

/** Strip quotes from a CSS font-family token. */
const unquote = (s: string): string => s.trim().replace(/^["']|["']$/g, "");

/** First url(...) of a CSS `src` descriptor, resolved against the stylesheet
 * URL (Next serves the font CSS same-origin). */
function firstFontUrl(src: string, baseHref: string | null): string | null {
  const match = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"']+))\s*\)/.exec(src);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!raw) return null;
  try {
    return new URL(raw, baseHref ?? window.location.href).href;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

interface FontFaceSource {
  family: string;
  url: string;
}

/** Scan the page's stylesheets for @font-face rules whose family is in
 * `families` (case-insensitive). Cross-origin sheets that refuse cssRules
 * access are skipped. */
function findFontFaces(families: readonly string[]): FontFaceSource[] {
  const wanted = new Set(families.map((f) => f.toLowerCase()));
  const out: FontFaceSource[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin — not ours
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = unquote(rule.style.getPropertyValue("font-family"));
      if (!wanted.has(family.toLowerCase())) continue;
      const url = firstFontUrl(rule.style.getPropertyValue("src"), sheet.href);
      if (url) out.push({ family, url });
    }
  }
  return out;
}

/** The Geist family names behind cardSvg's `var(--font-geist-sans)` (next/
 * font mints hashed names like `'__Geist_abc123'`). */
function geistFamilies(): string[] {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-geist-sans")
    .trim();
  if (!value) return [];
  return value.split(",").map(unquote).filter((f) => f.length > 0);
}

/**
 * Build the `<style>` CSS injected into every rasterized SVG: data-URI
 * @font-face rules for Dicier + the page's Geist, plus a `--font-geist-sans`
 * definition so cardSvg's var() resolves inside the img document. Cached for
 * the session (fonts never change at runtime).
 */
async function buildFontEmbedCss(): Promise<string> {
  const geist = geistFamilies();
  const sources = findFontFaces([ICON_FONT_FAMILY, ...geist]);
  const parts: string[] = [];
  for (const { family, url } of sources) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      parts.push(
        `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${bytesToBase64(
          bytes,
        )}) format('woff2');}`,
      );
    } catch {
      // Degrade: the face renders with fallback fonts instead of blocking.
    }
  }
  if (geist.length > 0) {
    parts.push(`svg{--font-geist-sans:${geist.map((f) => `'${f}'`).join(",")};}`);
  }
  return parts.join("\n");
}

let fontCssCache: Promise<string> | null = null;
const getFontEmbedCss = (): Promise<string> => (fontCssCache ??= buildFontEmbedCss());

// ---------------------------------------------------------------------------
// SVG serialization and rasterization
// ---------------------------------------------------------------------------

/** Serialize one face to standalone SVG markup by rendering the SHARED
 * CardFaceSvg component (never a parallel shape renderer) into a detached
 * node. flushSync makes the render synchronous; XMLSerializer emits proper
 * namespaces for the blob document. */
export function serializeFaceSvg(
  spec: FaceRasterSpec,
  widthPx: number,
  heightPx: number,
  fontCss: string,
): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(
        <CardFaceSvg
          xUnits={spec.xUnits}
          yUnits={spec.yUnits}
          face={spec.face}
          svgAttributes={{
            xmlns: "http://www.w3.org/2000/svg",
            width: widthPx,
            height: heightPx,
          }}
        >
          {fontCss ? <style>{fontCss}</style> : null}
        </CardFaceSvg>,
      );
    });
    const svg = host.firstElementChild;
    if (!svg) throw new Error("pdfRaster: face markup did not render");
    return new XMLSerializer().serializeToString(svg);
  } finally {
    root.unmount();
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("pdfRaster: SVG image failed to load"));
    img.src = url;
  });
}

async function rasterizeOne(spec: FaceRasterSpec, fontCss: string): Promise<Uint8Array> {
  const widthPx = Math.round((spec.widthMm * RASTER_DPI) / 25.4);
  const heightPx = Math.round((spec.heightMm * RASTER_DPI) / 25.4);
  const markup = serializeFaceSvg(spec, widthPx, heightPx, fontCss);
  const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("pdfRaster: no 2d canvas context");
    // White card stock: the preview's wrapper div paints it; the standalone
    // SVG is transparent, so the canvas paints it here.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png) throw new Error("pdfRaster: PNG encoding failed");
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The real (browser) RasterizeFaces: awaits the page's fonts (so the embed
 * scrape sees settled @font-face rules and the preview itself is final),
 * then rasterizes each distinct face sequentially — 300 DPI poker faces are
 * ~750×1050 px, and one canvas at a time keeps memory flat on 500-card decks
 * (copies share faces, so distinct faces stay small).
 */
export const rasterizeFaces: RasterizeFaces = async (specs) => {
  await document.fonts.ready;
  const fontCss = await getFontEmbedCss();
  const out = new Map<string, Uint8Array>();
  for (const [key, spec] of specs) {
    out.set(key, await rasterizeOne(spec, fontCss));
  }
  return out;
};
