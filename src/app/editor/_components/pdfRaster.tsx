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
 * enough — Dicier, the ◆41 Text/TextBox faces, and Geist must be re-declared
 * INSIDE the SVG as `@font-face` rules with data: URIs. `getFontEmbedCss`
 * scrapes the page's own @font-face rules for the needed families — Geist
 * plus exactly the Dicier faces (iconFamiliesUsed) and ◆41 text faces
 * (textFontFamiliesUsed) the exported shapes use — inlines their sources,
 * and also pins the `--font-geist-sans` variable (cardSvg's Geist text
 * family is `var(--font-geist-sans), sans-serif`, and CSS variables don't
 * cross into the img document either). Any scrape/fetch failure degrades to
 * fallback fonts rather than failing the export.
 *
 * Format handling (§3.3, ◆41): a `src` descriptor may list several
 * `url(...) format(...)` sources (a browser fallback chain — Dicier and the
 * ◆41 faces each declare exactly one, but next/font's Geist output isn't
 * this module's to assume about forever) and `findFontFaces` now reads every
 * one, trying them IN ORDER until one actually fetches — fixing the former
 * single-point-of-failure where only the first `url()` was ever tried.
 * `buildFamilyCss` embeds the format the RULE declares (`format("woff2")`,
 * `format("truetype")`, …), not a hardcoded `woff2` — the ◆41 faces are
 * `format("truetype")` in globals.css, and mislabeling their data: URI as
 * `font/woff2` would make some browsers refuse to parse it.
 *
 * Image shapes (§3.3, M2) hit the same wall: the img document fetches
 * nothing, so their URLs are pre-loaded here with `crossorigin=anonymous`
 * and re-encoded as PNG data URIs (per-URL session cache). A load failure
 * or canvas taint rasterizes as the §3.3 marked placeholder box — the deck
 * always exports; the modal's pre-flight warns "N images could not be
 * embedded" BEFORE the export runs.
 *
 * `asset:` sources (§7.1b) are a SEPARATE image path with no CORS concern at
 * all: the art is already local (the Assets-drawer's IndexedDB library), so
 * it is read as bytes and re-encoded the same way, but never fetched over
 * the network and never needs `crossorigin`. `resolveImageSources` below
 * routes each src by `parseAssetSrc` before deciding which loader to use — a
 * missing asset name still resolves to `null` (the same marked placeholder,
 * the same modal warning count), it just never touches `loadImageData`'s
 * CORS-sensitive fetch.
 */

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { parseAssetSrc } from "@/lib/lang";
import {
  CardFaceSvg,
  ICON_FONT_FAMILIES,
  TEXT_FONT_FAMILIES,
  type ResolvedImage,
  type ResolvedImages,
} from "@/app/editor/_components/cardSvg";
import type { FaceRasterSpec } from "@/app/editor/_components/pdfLayout";
import { assetStore } from "@/app/editor/_store/assetStore";

/** §6.1: rasterize at 300 DPI — px = mm × 300 / 25.4. */
export const RASTER_DPI = 300;

/** The injection seam: the export flow (pdfExportModal) takes one of these;
 * the app passes `rasterizeFaces`, tests pass a stub. `images` carries the
 * modal's pre-flight resolutions (§3.3 M2 — URL → data URI, null = failed);
 * omitted, the rasterizer resolves the specs' URLs itself. */
export type RasterizeFaces = (
  specs: ReadonlyMap<string, FaceRasterSpec>,
  images?: ResolvedImages,
) => Promise<Map<string, Uint8Array>>;

// ---------------------------------------------------------------------------
// Font embedding
// ---------------------------------------------------------------------------

/** Strip quotes from a CSS font-family token. */
const unquote = (s: string): string => s.trim().replace(/^["']|["']$/g, "");

/** CSS `format()` token → the MIME type its data: URI needs. `truetype` is
 * what globals.css declares for the ◆41 faces (§3.3) — mislabeling it
 * `font/woff2` (the old hardcoded value) risks a browser refusing to parse
 * the embedded face. Unrecognized/absent formats fall back to an octet
 * stream rather than guessing wrong. */
const FONT_MIME: Readonly<Record<string, string>> = {
  woff2: "font/woff2",
  woff: "font/woff",
  truetype: "font/ttf",
  opentype: "font/otf",
};

/** `format()` inferred from a URL's extension, for a source that omits the
 * hint (legal CSS — the browser is supposed to sniff). */
function formatFromExtension(url: string): string | null {
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase();
  switch (ext) {
    case "woff2":
      return "woff2";
    case "woff":
      return "woff";
    case "ttf":
      return "truetype";
    case "otf":
      return "opentype";
    default:
      return null;
  }
}

export interface FontSrcEntry {
  url: string;
  /** Lower-cased `format()` token (e.g. "woff2", "truetype"), from the rule
   * or inferred from the URL's extension — never hardcoded. */
  format: string;
}

/**
 * Every `url(...) format(...)?` entry in a CSS `src` descriptor, resolved
 * against the stylesheet URL (Next serves the font CSS same-origin). A `src`
 * may legally list several sources as a browser fallback chain; returning
 * ALL of them (not just the first) is what lets `buildFamilyCss` below try
 * each in turn instead of giving up on the first one's fetch failure — the
 * fragility the DESIGN.md task for this file calls out by name.
 *
 * Exported for direct unit tests: unlike `findFontFaces`/`buildFamilyCss`,
 * this function touches no DOM API as long as `baseHref` is non-null (its
 * only DOM reference, `window.location.href`, is purely a same-origin-page
 * fallback for a null `baseHref`) — so the format-detection fix (the actual
 * bug this task fixes) is testable without a browser.
 */
export function parseFontSrc(src: string, baseHref: string | null): FontSrcEntry[] {
  const out: FontSrcEntry[] = [];
  const re =
    /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"']+))\s*\)(?:\s*format\(\s*(?:"([^"]+)"|'([^']+)'|([^)"']+))\s*\))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw) continue;
    let url: string;
    try {
      url = new URL(raw, baseHref ?? window.location.href).href;
    } catch {
      continue;
    }
    const declared = match[4] ?? match[5] ?? match[6];
    const format = (declared ?? formatFromExtension(raw) ?? "woff2").toLowerCase();
    out.push({ url, format });
  }
  return out;
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
  entries: FontSrcEntry[];
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
      const entries = parseFontSrc(rule.style.getPropertyValue("src"), sheet.href);
      if (entries.length > 0) out.push({ family, entries });
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
 * The Dicier families the faces being exported ACTUALLY draw (§3.3, M2).
 * Ten faces exist and globals.css declares them all, but embedding every one
 * into each rasterized SVG would add ~1 MB of base64 per face — so the embed
 * CSS covers exactly the styles used across this export's specs (plus Geist
 * for Text shapes). Pure and exported for unit tests.
 */
export function iconFamiliesUsed(specs: ReadonlyMap<string, FaceRasterSpec>): string[] {
  const families = new Set<string>();
  for (const spec of specs.values()) {
    for (const shape of spec.face) {
      if (shape.kind === "icon") families.add(ICON_FONT_FAMILIES[shape.style]);
    }
  }
  return [...families].sort();
}

/**
 * The Text/TextBox `font:` families the faces being exported ACTUALLY draw
 * (§3.3, M3 — ◆41), mirroring iconFamiliesUsed exactly. `geist` is excluded
 * — its family is already covered by `geistFamilies()` unconditionally
 * (every export needs it), and TEXT_FONT_FAMILIES.geist is a CSS var()
 * expression, not a real @font-face family name findFontFaces could match.
 * Skipping it here is what keeps a Geist-only deck from requesting all eight
 * ~70 KB–670 KB TTFs it never draws. Pure and exported for unit tests.
 */
export function textFontFamiliesUsed(specs: ReadonlyMap<string, FaceRasterSpec>): string[] {
  const families = new Set<string>();
  for (const spec of specs.values()) {
    for (const shape of spec.face) {
      if ((shape.kind === "text" || shape.kind === "textbox") && shape.font !== "geist") {
        families.add(TEXT_FONT_FAMILIES[shape.font]);
      }
    }
  }
  return [...families].sort();
}

/**
 * Data-URI @font-face rules for ONE family, scraped from the page's own
 * stylesheets (a family may own several RULES — Geist can — and each rule
 * may list several SOURCES, a fallback chain). Every source of every rule is
 * tried in declared order until one actually fetches, embedding the FORMAT
 * that source declares (never a hardcoded one) — fixing the two fragilities
 * the old single-url/hardcoded-woff2 version had. A source that fails to
 * fetch falls through to the next; a rule with no fetchable source at all
 * degrades to fallback fonts instead of blocking the export.
 */
async function buildFamilyCss(family: string): Promise<string> {
  const parts: string[] = [];
  for (const { family: found, entries } of findFontFaces([family])) {
    for (const entry of entries) {
      try {
        const response = await fetch(entry.url);
        if (!response.ok) continue;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const mime = FONT_MIME[entry.format] ?? "application/octet-stream";
        parts.push(
          `@font-face{font-family:'${found}';src:url(data:${mime};base64,${bytesToBase64(
            bytes,
          )}) format('${entry.format}');}`,
        );
        break; // this rule is embedded — no need to try its other sources
      } catch {
        // Try this rule's next declared source before giving up on it.
      }
    }
  }
  return parts.join("\n");
}

/** Per-family session cache (fonts never change at runtime) — but never a
 * REJECTED promise: an unexpected failure mid-scrape must poison only its own
 * export, not every later one. */
const familyCssCache = new Map<string, Promise<string>>();

function getFamilyCss(family: string): Promise<string> {
  let cached = familyCssCache.get(family);
  if (cached === undefined) {
    cached = buildFamilyCss(family).catch((error: unknown) => {
      familyCssCache.delete(family); // evict so the next export retries
      throw error;
    });
    familyCssCache.set(family, cached);
  }
  return cached;
}

/**
 * Build the `<style>` CSS injected into every rasterized SVG of one export:
 * data-URI @font-face rules for the icon families AND the ◆41 text families
 * these faces use + the page's Geist, plus a `--font-geist-sans` definition
 * so cardSvg's var() resolves inside the img document.
 */
async function getFontEmbedCss(specs: ReadonlyMap<string, FaceRasterSpec>): Promise<string> {
  const geist = geistFamilies();
  const parts: string[] = [];
  for (const family of [...geist, ...iconFamiliesUsed(specs), ...textFontFamiliesUsed(specs)]) {
    const css = await getFamilyCss(family);
    if (css) parts.push(css);
  }
  if (geist.length > 0) {
    parts.push(`svg{--font-geist-sans:${geist.map((f) => `'${f}'`).join(",")};}`);
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Image embedding (§3.3, M2)
// ---------------------------------------------------------------------------

/**
 * Every distinct image `src` the faces being exported draw — URL or
 * `asset:name` alike — sorted. Pure and exported for unit tests — the
 * modal's pre-flight check and the rasterizer both start from this list (it
 * is what gets resolved AND what the "N images could not be embedded"
 * warning counts, §7.1b included).
 */
export function imageUrlsUsed(specs: ReadonlyMap<string, FaceRasterSpec>): string[] {
  const urls = new Set<string>();
  for (const spec of specs.values()) {
    for (const shape of spec.face) {
      if (shape.kind === "image") urls.add(shape.src);
    }
  }
  return [...urls].sort();
}

/**
 * The subset of `imageUrlsUsed` that is an actual remote URL — i.e. what
 * NEEDS the CORS-sensitive `crossorigin=anonymous` fetch (§7.1b: "never
 * counted in the remote CORS pre-flight"). `asset:` sources resolve from the
 * local Assets-drawer library (loadAssetData) instead and never appear here.
 * Pure and exported so the exclusion is testable without the DOM-only
 * loaders themselves.
 */
export function remoteImageUrlsUsed(specs: ReadonlyMap<string, FaceRasterSpec>): string[] {
  return imageUrlsUsed(specs).filter((src) => parseAssetSrc(src) === null);
}

/** The pre-flight/embedding seam (injectable like RasterizeFaces): resolve
 * each URL to a data URI plus the art's natural size, or null when it cannot
 * be embedded. */
export type ResolveImages = (
  urls: readonly string[],
) => Promise<Map<string, ResolvedImage | null>>;

/**
 * Load one image URL for embedding: `crossorigin=anonymous` (§3.3 — the
 * rasterized SVG lives in an `<img>` document that cannot fetch external
 * resources, AND the canvas must stay untainted), redrawn at natural size
 * onto a canvas and re-encoded as a PNG data URI. The natural size rides
 * along (it is already in hand from this load) so `auto` dimensions resolve
 * in the serialized SVG exactly as the live preview resolves them. A load
 * failure, a missing CORS header, or a taint at toDataURL all resolve to
 * null — the §3.3 marked placeholder box, never a blocked export.
 */
async function loadImageData(url: string): Promise<ResolvedImage | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!loaded || img.naturalWidth === 0 || img.naturalHeight === 0) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return {
      href: canvas.toDataURL("image/png"),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    };
  } catch {
    return null; // tainted canvas or encoding failure — placeholder box
  }
}

/** Per-URL session cache. Successes are kept (an image's bytes are assumed
 * stable for the session, like fonts); FAILURES are evicted on settle so the
 * next modal open / export retries — a fixed CORS header or a network blip
 * should not stay failed until reload. */
const imageDataCache = new Map<string, Promise<ResolvedImage | null>>();

function getImageData(url: string): Promise<ResolvedImage | null> {
  let cached = imageDataCache.get(url);
  if (cached === undefined) {
    cached = loadImageData(url).then((data) => {
      if (data === null) imageDataCache.delete(url);
      return data;
    });
    imageDataCache.set(url, cached);
  }
  return cached;
}

/**
 * Load one LOCAL asset (§7.1b) for embedding: bytes come straight from the
 * Assets-drawer's IndexedDB library (`assetStore.getBytes`), no network and
 * no `crossorigin` — a same-origin object URL never taints the canvas the
 * way an uncooperative remote host would. Missing name → null, exactly like
 * `loadImageData`'s failure outcomes (the §3.3 marked placeholder box, and
 * the modal's "N images could not be embedded" count).
 */
async function loadAssetData(name: string): Promise<ResolvedImage | null> {
  const asset = await assetStore.getBytes(name);
  if (!asset) return null;
  // See cardSvg.tsx's identical cast note: Uint8Array is a valid BlobPart at
  // runtime everywhere this ships; lib.dom's type just can't prove it.
  const blob =
    asset.bytes instanceof Blob ? asset.bytes : new Blob([asset.bytes as BlobPart], { type: asset.mime });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    if (img.naturalWidth === 0 || img.naturalHeight === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return {
      href: canvas.toDataURL("image/png"),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    };
  } catch {
    return null; // no asset by this name, or a decode failure — placeholder box
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Per-name session cache, same eviction posture as `imageDataCache` — a
 * failed lookup retries next time (the asset may get uploaded mid-session). */
const assetDataCache = new Map<string, Promise<ResolvedImage | null>>();

function getAssetData(name: string): Promise<ResolvedImage | null> {
  let cached = assetDataCache.get(name);
  if (cached === undefined) {
    cached = loadAssetData(name).then((data) => {
      if (data === null) assetDataCache.delete(name);
      return data;
    });
    assetDataCache.set(name, cached);
  }
  return cached;
}

/** The real (browser) ResolveImages — concurrent per src, cache-backed.
 * Routes by `parseAssetSrc` (§7.1b): a URL src takes the CORS-fetch path
 * (`getImageData`), an `asset:name` src takes the local IndexedDB path
 * (`getAssetData`) and never touches the network. */
export const resolveImageSources: ResolveImages = async (urls) => {
  const out = new Map<string, ResolvedImage | null>();
  await Promise.all(
    urls.map(async (src) => {
      const assetName = parseAssetSrc(src);
      out.set(src, assetName !== null ? await getAssetData(assetName) : await getImageData(src));
    }),
  );
  return out;
};

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
  images: ResolvedImages,
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
          images={images}
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

async function rasterizeOne(
  spec: FaceRasterSpec,
  fontCss: string,
  images: ResolvedImages,
): Promise<Uint8Array> {
  const widthPx = Math.round((spec.widthMm * RASTER_DPI) / 25.4);
  const heightPx = Math.round((spec.heightMm * RASTER_DPI) / 25.4);
  const markup = serializeFaceSvg(spec, widthPx, heightPx, fontCss, images);
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
export const rasterizeFaces: RasterizeFaces = async (specs, images) => {
  await document.fonts.ready;
  const fontCss = await getFontEmbedCss(specs);
  // Image sources must arrive as data URIs (the img document fetches
  // nothing): use the modal's pre-flight resolutions when given — its
  // "N images could not be embedded" warning then describes exactly this
  // export — or resolve here (cache-backed, so this is cheap either way).
  const resolved = images ?? (await resolveImageSources(imageUrlsUsed(specs)));
  const out = new Map<string, Uint8Array>();
  for (const [key, spec] of specs) {
    out.set(key, await rasterizeOne(spec, fontCss, resolved));
  }
  return out;
};
