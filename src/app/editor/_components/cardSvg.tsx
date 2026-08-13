"use client";

/**
 * CardSVG — one card face as inline SVG (DESIGN.md §4.2, task 5).
 *
 * Pure presentational: the RenderModel hands it fully resolved Shapes in card
 * units (§4.1 — never an expression), and this component only translates them
 * to SVG. The `viewBox` is the deck's unit grid — `yUnits` verbatim, which
 * may be fractional (⚑7†: poker@20 → 28, tarot@20 → 240/7) — while the
 * on-screen box keeps the PHYSICAL aspect via CSS `aspect-ratio`, so
 * non-square units (explicit `y_units`, W003) stretch exactly as specced
 * (`preserveAspectRatio="none"`).
 *
 * Memoization (§4.2 †): `React.memo` with `cardSvgPropsEqual` below —
 * `contentHash` is the key. Shape arrays are SHARED between `count:` copies
 * and replaced wholesale on every recompile, so array identity is
 * deliberately ignored: equal hashes mean equal pixels. Never mutate a shape.
 */

import {
  memo,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type SVGProps,
} from "react";
import type {
  DataDiagnostic,
  FontFace,
  IconStyle,
  ImageFit,
  ImageShape,
  Pivot,
  PivotH,
  PivotV,
  QrShape,
  Shape,
  TextAnchor,
  TextBoxShape,
} from "@/lib/lang";
import { FONT_METRICS, parseAssetSrc } from "@/lib/lang";
import { assetStore, type AssetChangeEvent } from "@/app/editor/_store/assetStore";

// ---------------------------------------------------------------------------
// Font realization constants (§3.4 m10)
// ---------------------------------------------------------------------------

/**
 * A shape's `y` is the TOP of the em box (§3.4); SVG `text` positions the
 * BASELINE. The renderer realizes the spec with a per-family ascent constant
 * — baseline y = shape.y + ASCENT × size — instead of `dominant-baseline`,
 * which is inconsistent across browsers (§4.2).
 *
 * VISUAL-TUNING CONSTANT (task 7): a starting point to be eyeballed against
 * real cards during the acceptance pass. Geist's OWN metrics put its
 * ascender around 0.8 em (hhea-derived, like the ◆41 faces below) — 0.73 is
 * a deliberately tuned visual constant, kept EXACTLY as-is (§3.3, ◆41):
 * every existing card's Text/TextBox y-position was designed against it, so
 * changing it now would shift every one of them. See `ascentOf` below for
 * how this interacts with the eight ◆41 faces, which have no such history
 * to preserve and so use their true hhea ascent instead — a documented
 * inconsistency, not an oversight.
 */
export const TEXT_ASCENT = 0.73;

/** Dicier's ascent/em — see TEXT_ASCENT's tuning note (task 7). */
export const ICON_ASCENT = 0.8;

/** Geist's CSS variable comes from the root layout (next/font/local). */
const TEXT_FONT_FAMILY = "var(--font-geist-sans), sans-serif";

/**
 * CSS font-family per Text/TextBox `font:` (§3.3, M3 — ◆41). NAMING SCHEME:
 * the family is the vendor's TTF filename stem
 * ("CormorantGaramond-BoldItalic"), same convention as ICON_FONT_FAMILIES
 * below — must match the @font-face families in globals.css, whose header
 * comment explains why these are eight DISTINCT families rather than one
 * family per typeface with weight/style descriptors (the PDF embed
 * scraper's family-name matching, mirrored here by textFontFamiliesUsed in
 * pdfRaster.tsx). The Record type keeps this total when a face is added.
 */
export const TEXT_FONT_FAMILIES: Record<FontFace, string> = {
  geist: TEXT_FONT_FAMILY,
  garamond: "CormorantGaramond-Regular",
  garamond_bold: "CormorantGaramond-Bold",
  garamond_italic: "CormorantGaramond-Italic",
  garamond_bold_italic: "CormorantGaramond-BoldItalic",
  courier: "CourierPrime-Regular",
  courier_bold: "CourierPrime-Bold",
  courier_italic: "CourierPrime-Italic",
  courier_bold_italic: "CourierPrime-BoldItalic",
};

/**
 * Per-face baseline ascent (§3.4 m10, ◆41) — the ASCENT that
 * `pivotedBaselineY` multiplies by `size`. KNOWN INCONSISTENCY, documented
 * as a follow-up rather than fixed now: `geist` keeps the hand-tuned
 * TEXT_ASCENT constant (0.73) UNCHANGED — retuning it would shift the
 * y-position of every existing Text/TextBox on every existing card, and
 * this feature's job is to add fonts, not relitigate Geist's baseline. The
 * eight ◆41 faces have no such installed base to protect, so they use their
 * ACTUAL hhea ascender ÷ unitsPerEm from the generated font-metrics.ts
 * table (garamond ≈ 0.924, courier ≈ 0.781) — truer to each font's own
 * design, and there is nothing to keep byte-identical for a property that
 * didn't exist before this milestone. A future pass could revisit whether
 * Geist should also switch to its hhea-derived ascent (~0.8) for
 * consistency; that is a visual change to every card and is out of scope
 * here.
 */
export function ascentOf(font: FontFace): number {
  return font === "geist" ? TEXT_ASCENT : FONT_METRICS[font].ascent;
}

/**
 * CSS font-family per Icon `style:` (§3.3, M2). NAMING SCHEME (documented
 * decision): the family is the vendor's woff2 filename stem — "Dicier-" +
 * the style token's words capitalized and hyphen-joined ("flat_dark" →
 * "Dicier-Flat-Dark") — so the globals.css @font-face block, the file on
 * disk, and this map can be eyeballed against each other. Must match the
 * @font-face families in globals.css; the Record type keeps it total when a
 * style is ever added.
 */
export const ICON_FONT_FAMILIES: Record<IconStyle, string> = {
  flat_dark: "Dicier-Flat-Dark",
  flat_light: "Dicier-Flat-Light",
  flat_heavy: "Dicier-Flat-Heavy",
  block_dark: "Dicier-Block-Dark",
  block_light: "Dicier-Block-Light",
  block_heavy: "Dicier-Block-Heavy",
  round_dark: "Dicier-Round-Dark",
  round_light: "Dicier-Round-Light",
  round_heavy: "Dicier-Round-Heavy",
  pixel: "Dicier-Pixel",
};

/** §4.2 † — liga+calt make codes ligate, `dlig` is REQUIRED for double-digit
 * codes like "13_ON_D20", kern per the Dicier guide (§9). */
const ICON_FONT_FEATURES = '"liga" 1, "calt" 1, "dlig" 1, "kern" 1';

const ICON_STYLE: CSSProperties = { fontFeatureSettings: ICON_FONT_FEATURES };

/** TextBox `align:` (left|middle|right, §3.3) → SVG text-anchor. */
const SVG_ALIGN: Record<TextAnchor, "start" | "middle" | "end"> = {
  left: "start",
  middle: "middle",
  right: "end",
};

/** Pivot horizontal component (§3.4) → SVG text-anchor for Text/Icon. */
const SVG_PIVOT_H: Record<PivotH, "start" | "middle" | "end"> = {
  left: "start",
  center: "middle",
  right: "end",
};

// ---------------------------------------------------------------------------
// Nine-point pivot math (§3.4, M3)
// ---------------------------------------------------------------------------

/** How far into the element each pivot component sits, as a fraction of its
 * extent (§3.4: fx/fy ∈ {0, ½, 1}). */
export const PIVOT_FRACTION_X: Record<PivotH, number> = { left: 0, center: 0.5, right: 1 };
export const PIVOT_FRACTION_Y: Record<PivotV, number> = { top: 0, center: 0.5, bottom: 1 };

/**
 * Top-left drawing origin of a pivoted BOX shape (Rectangle, Image,
 * TextBox — §3.4): the shape's x/y name its pivot point, so the origin
 * backs off by (width·fx, height·fy). `box` is the CONCRETE box — for an
 * Image with an `auto` dimension callers pass the RESOLVED box
 * (resolveImageBox), so the offset applies at render time once the natural
 * size is known, and the square fallback box pivots on that point while the
 * ratio is unknown (the same load-time rule as `auto` itself). Pure and
 * exported for the markup tests.
 */
export function pivotedBoxOrigin(
  shape: { x: number; y: number; pivot: Pivot },
  box: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: shape.x - box.width * PIVOT_FRACTION_X[shape.pivot.h],
    y: shape.y - box.height * PIVOT_FRACTION_Y[shape.pivot.v],
  };
}

/**
 * Baseline y of a pivoted Text/Icon line (§3.4 em-box semantics). The
 * shape's y names the `pivot.v` edge/center of the EM BOX, so the em TOP is
 * y − fy·size, and the baseline sits the per-family ascent below that top:
 *
 *   baseline = y − fy·size + ascent·size      (fy ∈ {0, ½, 1})
 *
 * v: top → y + ascent·size — exactly the pre-M3 realization; v: center →
 * that minus size/2; v: bottom → minus size. Same TEXT_ASCENT/ICON_ASCENT
 * constants as ever, never `dominant-baseline` (§4.2). Pure and exported
 * for the markup tests.
 */
export function pivotedBaselineY(
  shape: { y: number; size: number; pivot: Pivot },
  ascent: number,
): number {
  return shape.y - PIVOT_FRACTION_Y[shape.pivot.v] * shape.size + ascent * shape.size;
}

/** Error placeholders clamp the first diagnostic's message to this many
 * characters (single line, no wrapping — ◆24 applies to us too). */
export const ERROR_MESSAGE_MAX = 40;

// ---------------------------------------------------------------------------
// Images (§3.3, M2)
// ---------------------------------------------------------------------------

/** Image `fit:` → SVG preserveAspectRatio (§3.3). The `<image>` element is
 * its own viewport, so `cover`'s overflow clips to the box without an
 * explicit clipPath. */
export const IMAGE_PRESERVE_ASPECT: Record<ImageFit, string> = {
  contain: "xMidYMid meet",
  cover: "xMidYMid slice",
  stretch: "none",
};

/** Intrinsic pixel size of loaded art — what `auto` dimensions resolve
 * against (§3.3: intrinsic size is LOAD-time knowledge, so the model carries
 * the keyword and this module resolves it). */
export interface ImageNaturalSize {
  naturalWidth: number;
  naturalHeight: number;
}

/** One pre-resolved image source for STATIC rendering: a renderable href
 * (the rasterizer supplies data URIs) plus the art's natural size, captured
 * at the same load, so `auto` dimensions resolve identically here and in
 * the live preview. */
export interface ResolvedImage extends ImageNaturalSize {
  href: string;
}

/**
 * Pre-resolved image sources for STATIC rendering: shape `src` → resolved
 * source, or null when the load failed. Supplied by the PDF rasterizer (an
 * SVG in an `<img>` document cannot fetch external resources, so URLs must
 * arrive as data URIs) — and by tests. When absent, image shapes render
 * through the LIVE path below: placeholder first, real image swapped in
 * client-side.
 */
export type ResolvedImages = ReadonlyMap<string, ResolvedImage | null>;

/**
 * The concrete drawing box of an image shape, in card units (§3.3 auto
 * dimension). An `auto` dimension is the other dimension × the art's
 * intrinsic ratio; before that ratio is known (loading), or when it never
 * arrives (failed load, degenerate 0-px art), the box falls back to a
 * SQUARE — the auto dimension mirrors its sibling, holding a sensible spot
 * without pretending to know the ratio. Pure and exported for tests; the
 * checker guarantees at most one dimension is "auto" (both = E008).
 */
export function resolveImageBox(
  shape: ImageShape,
  natural: ImageNaturalSize | null,
): { width: number; height: number } {
  const { width, height } = shape;
  if (width !== "auto" && height !== "auto") return { width, height };
  const known =
    natural !== null && natural.naturalWidth > 0 && natural.naturalHeight > 0;
  if (width === "auto") {
    const h = height as number; // checker: at most one dimension is auto
    return { width: known ? h * (natural.naturalWidth / natural.naturalHeight) : h, height: h };
  }
  const w = width as number;
  return { width: w, height: known ? w * (natural.naturalHeight / natural.naturalWidth) : w };
}

/**
 * Loading/failure of an image `src` is RENDERER state, never the model's
 * (§3.3: no D-code — the model stays pure). This module-level store tracks
 * one status per `src` string for the live preview — including the natural
 * size on success, which is what `auto` dimensions resolve against;
 * `useSyncExternalStore` in LiveImage keeps SSR/static output on the
 * "loading" placeholder and lets the real image swap in after the browser
 * probe settles. Status objects are minted once per settle, so snapshots
 * stay referentially stable. `href` (§7.1b) is what actually gets drawn —
 * for a URL `src` it's the src itself; for an `asset:` src it's the object
 * URL resolved from the Assets-drawer library (resolveAssetObjectUrl below).
 */
export type ImageLoadStatus =
  | { state: "loading" }
  | ({ state: "loaded"; href: string } & ImageNaturalSize)
  | { state: "failed" };

/** Probe seam: browser-only image loading stays OUT of vitest by injection
 * (same policy as the PDF rasterizer) — tests replace this with a stub.
 * Resolves the art's natural size, or null on failure. Takes the resolved
 * HREF (a URL src verbatim, or an asset's object URL), never the raw
 * `asset:` scheme string. */
export type ImageProbe = (href: string) => Promise<ImageNaturalSize | null>;

const browserImageProbe: ImageProbe = (href) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = href;
  });

let imageProbe: ImageProbe = browserImageProbe;
/** The one "loading" status — a singleton so getSnapshot is stable for
 * sources the store has not settled (or even seen) yet. */
const LOADING_STATUS: ImageLoadStatus = { state: "loading" };
const imageStatuses = new Map<string, ImageLoadStatus>();
const imageListeners = new Map<string, Set<() => void>>();

/** Test seam: replace (or with null, restore) the browser probe. */
export function setImageProbeForTests(probe: ImageProbe | null): void {
  imageProbe = probe ?? browserImageProbe;
}

/** Test seam: forget every probed status AND cached asset object URL so
 * cases don't leak into each other. */
export function resetImageStatusesForTests(): void {
  imageStatuses.clear();
  imageListeners.clear();
  for (const url of assetObjectUrls.values()) {
    if (url !== null) URL.revokeObjectURL(url);
  }
  assetObjectUrls.clear();
  assetObjectUrlPromises.clear();
}

/** Exported ONLY for tests: the live resolution machinery (this whole
 * section) is otherwise browser-only glue reached exclusively through
 * `useSyncExternalStore` in `LiveImage`, which `renderToStaticMarkup` never
 * invokes (it reads `getServerSnapshot` instead — see LiveImage below), so
 * component tests can't exercise it. `resolveAssetObjectUrl` needs only
 * `Blob`/`URL.createObjectURL` (present in Node, unlike `Image`/canvas), so
 * asset resolution specifically CAN run headless via this direct call —
 * real production code path, not a parallel test implementation. */
export function imageStatusOf(src: string): ImageLoadStatus {
  return imageStatuses.get(src) ?? LOADING_STATUS;
}

function notifySrc(src: string): void {
  for (const cb of imageListeners.get(src) ?? []) cb();
}

// ---------------------------------------------------------------------------
// asset: resolution (§7.1b) — name → object URL, cached per name
// ---------------------------------------------------------------------------

/** Asset name → its object URL, or `null` once resolution settled on "no
 * such asset" (missing name — same terminal outcome as a failed URL fetch).
 * Kept separate from `imageStatuses` (keyed by the raw `src` string) because
 * invalidation is per NAME (a rename/delete/replace in the drawer), while
 * `imageStatuses`/`imageListeners` are keyed by whatever `src` string shapes
 * actually carry (always `"asset:" + name` for the asset scheme, since the
 * scheme has no other variation). */
const assetObjectUrls = new Map<string, string | null>();
const assetObjectUrlPromises = new Map<string, Promise<string | null>>();

function revokeAssetUrl(name: string): void {
  const existing = assetObjectUrls.get(name);
  if (existing) URL.revokeObjectURL(existing);
  assetObjectUrls.delete(name);
  assetObjectUrlPromises.delete(name);
}

/** Resolve one asset name to an object URL (cached; concurrent callers for
 * the same name share one in-flight promise). `null` = no such asset in the
 * library — the caller renders the failed placeholder, exactly like a URL
 * that failed to load (§7.1b: "missing asset → existing failed/broken
 * placeholder path"). */
function resolveAssetObjectUrl(name: string): Promise<string | null> {
  if (assetObjectUrls.has(name)) return Promise.resolve(assetObjectUrls.get(name) ?? null);
  let pending = assetObjectUrlPromises.get(name);
  if (!pending) {
    pending = assetStore.getBytes(name).then((asset) => {
      if (!asset) {
        assetObjectUrls.set(name, null);
        return null;
      }
      // Cast: Uint8Array is a structurally valid BlobPart at runtime in every
      // engine (and in Node 22, per the manual check backing this feature),
      // but lib.dom's BlobPart narrows ArrayBufferView to an ArrayBuffer
      // (not SharedArrayBuffer) backing store, which TS can't prove here.
      const blob =
        asset.bytes instanceof Blob
          ? asset.bytes
          : new Blob([asset.bytes as BlobPart], { type: asset.mime });
      const url = URL.createObjectURL(blob);
      assetObjectUrls.set(name, url);
      return url;
    });
    assetObjectUrlPromises.set(name, pending);
  }
  return pending;
}

/** Kick off resolution for one `src` (URL or `asset:name`), settling
 * `imageStatuses` and notifying that src's listeners. Shared by first-
 * subscribe and by asset-change re-resolution. */
function beginResolution(src: string): void {
  imageStatuses.set(src, LOADING_STATUS);
  const settle = (natural: ImageNaturalSize | null, href: string | null): void => {
    imageStatuses.set(
      src,
      natural && href !== null ? { state: "loaded", href, ...natural } : { state: "failed" },
    );
    notifySrc(src);
  };
  const assetName = parseAssetSrc(src);
  if (assetName !== null) {
    void resolveAssetObjectUrl(assetName).then((url) => {
      if (url === null) {
        settle(null, null);
        return;
      }
      void imageProbe(url).then((natural) => settle(natural, url));
    });
  } else {
    void imageProbe(src).then((natural) => settle(natural, src));
  }
}

/** Drop a `src`'s cached status and, if anything is still watching it,
 * re-resolve immediately (rather than waiting for a future subscribe) so a
 * mounted card heals/breaks live as the drawer changes the library. */
function invalidateSrc(src: string): void {
  imageStatuses.delete(src);
  if ((imageListeners.get(src)?.size ?? 0) > 0) beginResolution(src);
}

/** Assets-drawer changes → invalidate exactly the affected `asset:` src(s)
 * (§7.1b: "cache per name; revoke + re-resolve on rename/delete/replace").
 * Subscribed once at module load — this module's whole lifetime is the
 * app's, like `imageStatuses` itself. */
function onAssetChange(event: AssetChangeEvent): void {
  switch (event.type) {
    case "put":
    case "delete":
      revokeAssetUrl(event.name);
      invalidateSrc(`asset:${event.name}`);
      return;
    case "rename":
      revokeAssetUrl(event.from);
      invalidateSrc(`asset:${event.from}`);
      // The target name may have been a previously-unknown (W005) reference
      // that's now satisfied — clear any cached "missing" outcome for it too.
      revokeAssetUrl(event.to);
      invalidateSrc(`asset:${event.to}`);
      return;
    case "clear":
    case "replaceAll":
      for (const name of [...assetObjectUrls.keys()]) revokeAssetUrl(name);
      for (const src of [...imageStatuses.keys()]) {
        if (parseAssetSrc(src) !== null) invalidateSrc(src);
      }
      return;
    case "disabled":
      // Nothing cached becomes valid; existing loading/failed states already
      // describe the right outcome (an asset store that never answers reads
      // as "missing", same as before it was disabled).
      return;
  }
}

assetStore.subscribe(onAssetChange);

/** Subscribe to one `src`'s status, kicking off resolution on first
 * interest. Subscription only ever happens client-side (React calls it on
 * mount), so probes never run during SSR/static rendering. Exported for
 * tests — see `imageStatusOf`'s comment. */
export function subscribeImageStatus(src: string, onChange: () => void): () => void {
  let listeners = imageListeners.get(src);
  if (!listeners) {
    listeners = new Set();
    imageListeners.set(src, listeners);
  }
  listeners.add(onChange);
  if (!imageStatuses.has(src)) beginResolution(src);
  return () => {
    listeners.delete(onChange);
  };
}

/** Placeholder stroke width, relative to the box so it reads the same at any
 * unit scale. Exported for the markup tests. */
export function imagePlaceholderStroke(box: { width: number; height: number }): number {
  return Math.min(box.width, box.height) * 0.06;
}

/**
 * The §3.3 placeholder box: subtle while loading, warning-styled (amber, with
 * a diagonal cross so the mark survives rasterization without any font) when
 * the load failed. `box` is the RESOLVED geometry and the §3.4 pivot offset
 * is taken from it — for concrete dimensions the placeholder occupies exactly
 * what the image would, so layout never shifts when the real art arrives; an
 * `auto` dimension resolves square here (the ratio is unknown by definition
 * while the placeholder shows), and the pivoted box may shift once the true
 * ratio arrives — inherent to pivoting a load-time-sized box.
 */
function renderImagePlaceholder(
  shape: ImageShape,
  index: number,
  variant: "loading" | "failed",
  box: { width: number; height: number },
): ReactElement {
  const origin = pivotedBoxOrigin(shape, box);
  const stroke = imagePlaceholderStroke(box);
  const failed = variant === "failed";
  return (
    <g key={index} data-image-placeholder={variant}>
      <title>
        {failed ? `Image failed to load: ${shape.src}` : `Loading image: ${shape.src}`}
      </title>
      <rect
        x={origin.x}
        y={origin.y}
        width={box.width}
        height={box.height}
        fill={failed ? "#fef3c7" : "#f3f4f6"}
        stroke={failed ? "#b45309" : "#d1d5db"}
        strokeWidth={stroke}
      />
      {failed && (
        <>
          <line
            x1={origin.x}
            y1={origin.y}
            x2={origin.x + box.width}
            y2={origin.y + box.height}
            stroke="#b45309"
            strokeWidth={stroke}
          />
          <line
            x1={origin.x + box.width}
            y1={origin.y}
            x2={origin.x}
            y2={origin.y + box.height}
            stroke="#b45309"
            strokeWidth={stroke}
          />
        </>
      )}
    </g>
  );
}

function renderImageTag(
  shape: ImageShape,
  index: number,
  href: string,
  box: { width: number; height: number },
): ReactElement {
  // §3.4: the pivot offsets the RESOLVED box — with an `auto` dimension the
  // offset can only be known here, at render time, natural size in hand.
  const origin = pivotedBoxOrigin(shape, box);
  return (
    <image
      key={index}
      href={href}
      x={origin.x}
      y={origin.y}
      width={box.width}
      height={box.height}
      preserveAspectRatio={IMAGE_PRESERVE_ASPECT[shape.fit]}
    />
  );
}

/** Live image path (no ResolvedImages supplied): SSR/static output is the
 * loading placeholder — renderToStaticMarkup runs no effects, so this IS the
 * static default — and the client swaps in the real `<image>` (or the failed
 * placeholder) once the probe settles. An `auto` dimension resolves against
 * the natural size the probe captured; until it settles (and on failure) the
 * placeholder box is square. */
function LiveImage({ shape, index }: { shape: ImageShape; index: number }): ReactElement {
  const status = useSyncExternalStore(
    (onChange) => subscribeImageStatus(shape.src, onChange),
    () => imageStatusOf(shape.src),
    () => LOADING_STATUS,
  );
  if (status.state === "loaded") {
    return renderImageTag(shape, index, status.href, resolveImageBox(shape, status));
  }
  return renderImagePlaceholder(
    shape,
    index,
    status.state === "failed" ? "failed" : "loading",
    resolveImageBox(shape, null),
  );
}

// ---------------------------------------------------------------------------
// Qr (§7.1a)
// ---------------------------------------------------------------------------

/** The spec's quiet zone: 4 modules of `background` on every side, drawn
 * INSIDE the declared box so adjacent art can never crowd a code's scan
 * margin (§7.1a) — the matrix itself (`shape.modules`) does not include it. */
const QR_QUIET_ZONE_MODULES = 4;

/**
 * Round a path coordinate/length to 4 decimal places (adversarial review,
 * 2026-08-11): 0.0001 card-units is 0.0000125 in on a 20-unit card — far
 * below print resolution — but full float precision (up to 17 significant
 * digits per number) made one module's `d` segment up to 98 characters,
 * ballooning a URL-sized QR's path to ~31 KB (and a capacity QR to
 * ~1.56 MB). `Math.round`, not `toFixed` — `toFixed` would pad "0.3448"
 * out to trailing zeros and stringify via a slower path.
 */
function roundQrCoord(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * QR modules → SVG (§7.1a). `pivotedBoxOrigin` places the size×size box
 * exactly like Rectangle/Image; inside it, one background `<rect>` covers
 * the whole box (including the quiet zone) and ONE `<path>` carries every
 * dark module — a single DOM node regardless of QR size, built as
 * `M{x} {y}h{u}v{u}h-{u}z` per module (a fresh `M` starts an unconnected
 * subpath, so nonzero-rule fill paints every module without the path ever
 * "closing" across modules). The module unit is rounded once and its
 * string reused for every module (never re-stringified per h/v segment);
 * each module's origin is rounded too — see `roundQrCoord`.
 */
function renderQr(shape: QrShape, index: number): ReactElement {
  const origin = pivotedBoxOrigin(shape, { width: shape.size, height: shape.size });
  const grid = shape.moduleCount + QR_QUIET_ZONE_MODULES * 2;
  const unit = roundQrCoord(shape.size / grid);
  const unitStr = String(unit);
  const edge = `h${unitStr}v${unitStr}h-${unitStr}z`;
  let d = "";
  for (let row = 0; row < shape.moduleCount; row++) {
    for (let col = 0; col < shape.moduleCount; col++) {
      if (shape.modules[row * shape.moduleCount + col] !== "1") continue;
      const x = roundQrCoord(origin.x + (col + QR_QUIET_ZONE_MODULES) * unit);
      const y = roundQrCoord(origin.y + (row + QR_QUIET_ZONE_MODULES) * unit);
      d += `M${x} ${y}${edge}`;
    }
  }
  return (
    <g key={index}>
      <rect x={origin.x} y={origin.y} width={shape.size} height={shape.size} fill={shape.background} />
      <path d={d} fill={shape.color} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Props and the §4.2 memo comparator
// ---------------------------------------------------------------------------

/** Matches `CardInstance["error"]` (model.ts): empty faces + why. */
export interface CardSvgError {
  diagnostics: readonly DataDiagnostic[];
}

export interface CardSvgProps {
  /** Deck geometry (shared by every card of the deck, §4.1). */
  xUnits: number;
  /** May be fractional (⚑7†) — rendered into the viewBox verbatim. */
  yUnits: number;
  widthMm: number;
  heightMm: number;
  /** The face to draw (front or back), in declaration order (◆15). */
  face: readonly Shape[];
  /** The §4.2 memo key — covers BOTH faces + deck geometry. */
  contentHash: string;
  /** Present on error-placeholder instances (`face` is then empty). */
  error?: CardSvgError;
}

/**
 * The §4.2 memoization comparator, exported for direct unit tests: equal
 * (contentHash, geometry, error identity) → skip the re-render. Notes:
 * - `face` identity is IGNORED on purpose: recompiles mint fresh arrays for
 *   unchanged cards, and `contentHash` already covers the resolved content.
 *   Consequence: the hash covers BOTH faces, so a front↔back switch is
 *   invisible to this comparator — the preview remounts cards via a React
 *   key that includes the side (deckSection.tsx).
 * - geometry is compared even though the hash includes it — cheap, and it
 *   keeps the comparator honest if hashing ever changes.
 * - `error` is compared by identity: error hashes cover the diagnostics, so
 *   this only forces a (rare, conservative) re-render when a recompile mints
 *   a new error object for an unchanged placeholder.
 */
export function cardSvgPropsEqual(
  prev: Readonly<CardSvgProps>,
  next: Readonly<CardSvgProps>,
): boolean {
  return (
    prev.contentHash === next.contentHash &&
    prev.xUnits === next.xUnits &&
    prev.yUnits === next.yUnits &&
    prev.widthMm === next.widthMm &&
    prev.heightMm === next.heightMm &&
    prev.error === next.error
  );
}

// ---------------------------------------------------------------------------
// Shape → SVG
// ---------------------------------------------------------------------------

function renderShape(shape: Shape, index: number, images?: ResolvedImages): ReactElement {
  switch (shape.kind) {
    case "image": {
      if (images) {
        // Static path (rasterizer/tests): the caller resolved every URL,
        // capturing natural sizes so `auto` dimensions resolve exactly as
        // the live preview resolves them. A resolved source renders
        // directly; a failed (or unexpectedly missing) resolution renders
        // the marked warning box — §3.3: failures export as marked
        // placeholder boxes (square when a dimension is `auto`), the deck
        // always exports.
        const resolved = images.get(shape.src);
        return resolved
          ? renderImageTag(shape, index, resolved.href, resolveImageBox(shape, resolved))
          : renderImagePlaceholder(shape, index, "failed", resolveImageBox(shape, null));
      }
      return <LiveImage key={index} shape={shape} index={index} />;
    }
    case "rect": {
      // Nine-point pivot (§3.4): x/y name the pivot point of the box.
      const origin = pivotedBoxOrigin(shape, shape);
      return (
        <rect
          key={index}
          x={origin.x}
          y={origin.y}
          width={shape.width}
          height={shape.height}
          fill={shape.color}
        />
      );
    }
    case "text":
      // §3.4: horizontal pivoting via SVG text-anchor, vertical via the
      // em-box formula in pivotedBaselineY (top row ≡ the pre-M3 markup).
      // §3.3 (◆41): family AND ascent follow the chosen font: — geist's
      // ascent stays the tuned TEXT_ASCENT, the other eight use their own
      // generated ascent (ascentOf's doc comment).
      return (
        <text
          key={index}
          x={shape.x}
          y={pivotedBaselineY(shape, ascentOf(shape.font))}
          fontSize={shape.size}
          fill={shape.color}
          textAnchor={SVG_PIVOT_H[shape.pivot.h]}
          fontFamily={TEXT_FONT_FAMILIES[shape.font]}
        >
          {shape.text}
        </text>
      );
    case "textbox":
      return renderTextBox(shape, index);
    case "qr":
      return renderQr(shape, index);
    case "icon":
      // The code IS the text content: known codes ligate into glyphs; an
      // unknown code deliberately stays raw text — that failed ligature is
      // D005's visible indicator (§3.8 †), not a bug. Pivoting works like
      // Text, with Dicier's own ascent in the em-box formula.
      return (
        <text
          key={index}
          x={shape.x}
          y={pivotedBaselineY(shape, ICON_ASCENT)}
          fontSize={shape.size}
          fill={shape.color}
          textAnchor={SVG_PIVOT_H[shape.pivot.h]}
          fontFamily={ICON_FONT_FAMILIES[shape.style]}
          style={ICON_STYLE}
        >
          {shape.code}
        </text>
      );
  }
}

// ---------------------------------------------------------------------------
// TextBox (§3.3, M3)
// ---------------------------------------------------------------------------

/** Where a line's x sits (and which SVG text-anchor realizes it) for each
 * TextBox `align:` — left edge / center / right edge of the BOX, not the
 * card (§3.3: a box aligns lines within its own width). Pure and exported
 * for the markup tests. */
export function textBoxLineX(box: { x: number; width: number }, align: TextAnchor): number {
  if (align === "middle") return box.x + box.width / 2;
  if (align === "right") return box.x + box.width;
  return box.x;
}

/**
 * A wrapped text box: ONE `<text>` element per box (a single DOM node keeps
 * the box inspectable as a unit), with one absolutely positioned `<tspan>`
 * per resolved line — explicit x/y on every tspan rather than dy chaining,
 * so each line's position is independent, testable arithmetic (documented
 * decision). The model already wrapped and clip/shrunk (§7.2: the compiler
 * is the wrapping authority) — this function draws lines, nothing more.
 * Line i's baseline: box top + the §3.4 ascent realization (the chosen
 * font's ascent × final size, same realization as Text — ascentOf, ◆41) +
 * i × lineHeight × size of advance.
 */
function renderTextBox(shape: TextBoxShape, index: number): ReactElement {
  // Nine-point pivot (§3.4): the WHOLE box moves — x/y name its pivot
  // point, so the drawn origin backs off by (w·fx, h·fy) — while the
  // interior line layout (align within the box's width, the ascent
  // realization, the lineHeight advance) is unchanged, just computed from
  // the moved origin.
  const origin = pivotedBoxOrigin(shape, shape);
  const x = textBoxLineX({ x: origin.x, width: shape.width }, shape.align);
  const ascent = ascentOf(shape.font);
  return (
    <text
      key={index}
      fontSize={shape.size}
      fill={shape.color}
      textAnchor={SVG_ALIGN[shape.align]}
      fontFamily={TEXT_FONT_FAMILIES[shape.font]}
    >
      {shape.lines.map((line, i) => (
        <tspan
          key={i}
          x={x}
          y={origin.y + ascent * shape.size + i * shape.lineHeight * shape.size}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

/** True when any shape of `face` is a TextBox that clipped or shrunk — the
 * §3.3 per-card preview badge trigger. Pure and exported for tests. */
export function faceHasTextBoxOverflow(face: readonly Shape[]): boolean {
  return face.some((s) => s.kind === "textbox" && (s.clipped || s.shrunk));
}

/** Single line, no wrapping (◆24) — clamp with an ellipsis instead. */
function clampMessage(message: string, max: number): string {
  return message.length <= max ? message : `${message.slice(0, max - 1)}…`;
}

/**
 * Error-placeholder art (⚑8: the model marks the card, rendering it is our
 * job): muted background, warning glyph, first diagnostic (clamped), count
 * of further issues. Same outer geometry as a healthy card, so the grid
 * never reflows around a broken cell. Baseline positions here are freehand
 * cosmetic fractions of the card, not §3.4 shapes.
 */
function renderErrorFace(
  xUnits: number,
  yUnits: number,
  error: CardSvgError,
): ReactElement {
  const first = error.diagnostics[0];
  const message = first ? clampMessage(first.message, ERROR_MESSAGE_MAX) : "unknown error";
  const more = error.diagnostics.length - 1;
  const cx = xUnits / 2;
  return (
    <>
      <title>
        {error.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n")}
      </title>
      <rect x={0} y={0} width={xUnits} height={yUnits} fill="#e5e7eb" />
      <text
        x={cx}
        y={yUnits * 0.4}
        fontSize={xUnits * 0.22}
        fill="#b45309"
        textAnchor="middle"
        fontFamily={TEXT_FONT_FAMILY}
      >
        ⚠
      </text>
      <text
        x={cx}
        y={yUnits * 0.5}
        fontSize={xUnits * 0.055}
        fill="#374151"
        textAnchor="middle"
        fontFamily={TEXT_FONT_FAMILY}
      >
        {message}
      </text>
      {more > 0 && (
        <text
          x={cx}
          y={yUnits * 0.57}
          fontSize={xUnits * 0.05}
          fill="#6b7280"
          textAnchor="middle"
          fontFamily={TEXT_FONT_FAMILY}
        >
          {`+${more} more issue${more === 1 ? "" : "s"}`}
        </text>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Face markup (shared with the PDF rasterizer — M2 §6.1)
// ---------------------------------------------------------------------------

export interface CardFaceSvgProps {
  xUnits: number;
  yUnits: number;
  face: readonly Shape[];
  error?: CardSvgError;
  /** Extra attributes on the `<svg>` element. The preview passes its CSS
   * classes; the PDF rasterizer passes xmlns + pixel width/height so the
   * serialized markup is a standalone SVG document. */
  svgAttributes?: SVGProps<SVGSVGElement>;
  /** Pre-resolved image sources (§3.3, M2) — the rasterizer passes data URIs
   * (or null for failures); the preview omits this and gets the live
   * placeholder-then-swap behavior. */
  images?: ResolvedImages;
  /** Rendered before the shapes — the rasterizer injects a `<style>` block
   * with embedded fonts here. The preview passes nothing. */
  children?: ReactNode;
}

/**
 * ONE card face as a bare `<svg>` — the single source of shape markup for
 * both the on-screen preview (CardSVG below) and the PDF rasterizer
 * (pdfRaster.tsx), which serializes exactly this element. §6.1's "fonts/
 * ligatures match the preview exactly" hinges on the two paths sharing this
 * function — never duplicate the shape rendering.
 */
export function CardFaceSvg({
  xUnits,
  yUnits,
  face,
  error,
  svgAttributes,
  images,
  children,
}: CardFaceSvgProps): ReactElement {
  return (
    <svg
      viewBox={`0 0 ${xUnits} ${yUnits}`}
      preserveAspectRatio="none"
      {...svgAttributes}
    >
      {children}
      {error
        ? renderErrorFace(xUnits, yUnits, error)
        : face.map((shape, index) => renderShape(shape, index, images))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function CardSvgImpl({
  xUnits,
  yUnits,
  widthMm,
  heightMm,
  face,
  error,
}: CardSvgProps): ReactElement {
  // §3.3 (M3): a subtle per-card badge when any TextBox on the SHOWN face
  // clipped or shrunk — never an error placeholder (⚑8; overflow is a
  // design nudge, not a data mistake). The shown face only: the badge sits
  // on what the user is looking at, and flipping reveals the other side's.
  // Rendered here (not in CardFaceSvg) so the preview gets it in both views
  // while the PDF rasterizer and the landing page stay badge-free.
  const overflow = !error && faceHasTextBoxOverflow(face);
  return (
    // The wrapper owns the card's physical shape (CSS aspect-ratio in mm) and
    // the cosmetic frame: white stock, rounded corner, hairline border,
    // overflow hidden so shapes drawn past the edge clip like a real cut
    // card. Corner radius is cosmetic chrome — a task-7 tuning knob.
    <div
      className="relative overflow-hidden rounded-md border border-gray-600 bg-white"
      style={{ aspectRatio: `${widthMm} / ${heightMm}` }}
    >
      <CardFaceSvg
        xUnits={xUnits}
        yUnits={yUnits}
        face={face}
        error={error}
        svgAttributes={{ className: "block h-full w-full", role: "img" }}
      />
      {overflow && (
        <span
          data-textbox-overflow
          title="Some text didn't fit its box — it was clipped or shrunk (see TextBox overflow)"
          className="absolute right-1 top-1 block h-2 w-2 rounded-full border border-amber-600 bg-amber-400"
        />
      )}
    </div>
  );
}

/** Memoized on `contentHash` (§4.2 †) — see cardSvgPropsEqual. */
export const CardSVG = memo(CardSvgImpl, cardSvgPropsEqual);
