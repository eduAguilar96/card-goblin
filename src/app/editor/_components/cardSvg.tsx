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
  IconStyle,
  ImageFit,
  ImageShape,
  Shape,
  TextAnchor,
} from "@/lib/lang";

// ---------------------------------------------------------------------------
// Font realization constants (§3.4 m10)
// ---------------------------------------------------------------------------

/**
 * A shape's `y` is the TOP of the em box (§3.4); SVG `text` positions the
 * BASELINE. The renderer realizes the spec with a per-family ascent constant
 * — baseline y = shape.y + ASCENT × size — instead of `dominant-baseline`,
 * which is inconsistent across browsers (§4.2).
 *
 * VISUAL-TUNING CONSTANTS (task 7): both values below are starting points to
 * be eyeballed against real cards during the acceptance pass. Geist's metrics
 * put its ascender around 0.73 em; Dicier's glyphs are drawn tall on the em
 * square, so it starts a bit higher.
 */
export const TEXT_ASCENT = 0.73;

/** Dicier's ascent/em — see TEXT_ASCENT's tuning note (task 7). */
export const ICON_ASCENT = 0.8;

/** v1 renders Geist only (§8); the CSS variable comes from the root layout. */
const TEXT_FONT_FAMILY = "var(--font-geist-sans), sans-serif";

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

/** Model anchor (§3.4) → SVG text-anchor. */
const SVG_ANCHOR: Record<TextAnchor, "start" | "middle" | "end"> = {
  left: "start",
  middle: "middle",
  right: "end",
};

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
 * Loading/failure of an image URL is RENDERER state, never the model's
 * (§3.3: no D-code — the model stays pure). This module-level store tracks
 * one status per URL for the live preview — including the natural size on
 * success, which is what `auto` dimensions resolve against;
 * `useSyncExternalStore` in LiveImage keeps SSR/static output on the
 * "loading" placeholder and lets the real image swap in after the browser
 * probe settles. Status objects are minted once per settle, so snapshots
 * stay referentially stable.
 */
export type ImageLoadStatus =
  | { state: "loading" }
  | ({ state: "loaded" } & ImageNaturalSize)
  | { state: "failed" };

/** Probe seam: browser-only image loading stays OUT of vitest by injection
 * (same policy as the PDF rasterizer) — tests replace this with a stub.
 * Resolves the art's natural size, or null on failure. */
export type ImageProbe = (src: string) => Promise<ImageNaturalSize | null>;

const browserImageProbe: ImageProbe = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });

let imageProbe: ImageProbe = browserImageProbe;
/** The one "loading" status — a singleton so getSnapshot is stable for URLs
 * the store has not settled (or even seen) yet. */
const LOADING_STATUS: ImageLoadStatus = { state: "loading" };
const imageStatuses = new Map<string, ImageLoadStatus>();
const imageListeners = new Map<string, Set<() => void>>();

/** Test seam: replace (or with null, restore) the browser probe. */
export function setImageProbeForTests(probe: ImageProbe | null): void {
  imageProbe = probe ?? browserImageProbe;
}

/** Test seam: forget every probed status so cases don't leak into each other. */
export function resetImageStatusesForTests(): void {
  imageStatuses.clear();
  imageListeners.clear();
}

function imageStatusOf(src: string): ImageLoadStatus {
  return imageStatuses.get(src) ?? LOADING_STATUS;
}

/** Subscribe to one URL's status, kicking off the probe on first interest.
 * Subscription only ever happens client-side (React calls it on mount), so
 * the probe never runs during SSR/static rendering. */
function subscribeImageStatus(src: string, onChange: () => void): () => void {
  let listeners = imageListeners.get(src);
  if (!listeners) {
    listeners = new Set();
    imageListeners.set(src, listeners);
  }
  listeners.add(onChange);
  if (!imageStatuses.has(src)) {
    imageStatuses.set(src, LOADING_STATUS);
    void imageProbe(src).then((natural) => {
      imageStatuses.set(
        src,
        natural ? { state: "loaded", ...natural } : { state: "failed" },
      );
      for (const cb of imageListeners.get(src) ?? []) cb();
    });
  }
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
 * the load failed. `box` is the RESOLVED geometry — for concrete dimensions
 * it is exactly what the image would occupy, so layout never shifts when the
 * real art arrives; an `auto` dimension resolves square here (the ratio is
 * unknown by definition while the placeholder shows).
 */
function renderImagePlaceholder(
  shape: ImageShape,
  index: number,
  variant: "loading" | "failed",
  box: { width: number; height: number },
): ReactElement {
  const stroke = imagePlaceholderStroke(box);
  const failed = variant === "failed";
  return (
    <g key={index} data-image-placeholder={variant}>
      <title>
        {failed ? `Image failed to load: ${shape.src}` : `Loading image: ${shape.src}`}
      </title>
      <rect
        x={shape.x}
        y={shape.y}
        width={box.width}
        height={box.height}
        fill={failed ? "#fef3c7" : "#f3f4f6"}
        stroke={failed ? "#b45309" : "#d1d5db"}
        strokeWidth={stroke}
      />
      {failed && (
        <>
          <line
            x1={shape.x}
            y1={shape.y}
            x2={shape.x + box.width}
            y2={shape.y + box.height}
            stroke="#b45309"
            strokeWidth={stroke}
          />
          <line
            x1={shape.x + box.width}
            y1={shape.y}
            x2={shape.x}
            y2={shape.y + box.height}
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
  return (
    <image
      key={index}
      href={href}
      x={shape.x}
      y={shape.y}
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
    return renderImageTag(shape, index, shape.src, resolveImageBox(shape, status));
  }
  return renderImagePlaceholder(
    shape,
    index,
    status.state === "failed" ? "failed" : "loading",
    resolveImageBox(shape, null),
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
    case "rect":
      return (
        <rect
          key={index}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          fill={shape.color}
        />
      );
    case "text":
      return (
        <text
          key={index}
          x={shape.x}
          y={shape.y + TEXT_ASCENT * shape.size}
          fontSize={shape.size}
          fill={shape.color}
          textAnchor={SVG_ANCHOR[shape.anchor]}
          fontFamily={TEXT_FONT_FAMILY}
        >
          {shape.text}
        </text>
      );
    case "icon":
      // The code IS the text content: known codes ligate into glyphs; an
      // unknown code deliberately stays raw text — that failed ligature is
      // D005's visible indicator (§3.8 †), not a bug.
      return (
        <text
          key={index}
          x={shape.x}
          y={shape.y + ICON_ASCENT * shape.size}
          fontSize={shape.size}
          fill={shape.color}
          textAnchor={SVG_ANCHOR[shape.anchor]}
          fontFamily={ICON_FONT_FAMILIES[shape.style]}
          style={ICON_STYLE}
        >
          {shape.code}
        </text>
      );
  }
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
  return (
    // The wrapper owns the card's physical shape (CSS aspect-ratio in mm) and
    // the cosmetic frame: white stock, rounded corner, hairline border,
    // overflow hidden so shapes drawn past the edge clip like a real cut
    // card. Corner radius is cosmetic chrome — a task-7 tuning knob.
    <div
      className="overflow-hidden rounded-md border border-gray-600 bg-white"
      style={{ aspectRatio: `${widthMm} / ${heightMm}` }}
    >
      <CardFaceSvg
        xUnits={xUnits}
        yUnits={yUnits}
        face={face}
        error={error}
        svgAttributes={{ className: "block h-full w-full", role: "img" }}
      />
    </div>
  );
}

/** Memoized on `contentHash` (§4.2 †) — see cardSvgPropsEqual. */
export const CardSVG = memo(CardSvgImpl, cardSvgPropsEqual);
