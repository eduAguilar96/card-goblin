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
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type SVGProps,
} from "react";
import type { DataDiagnostic, IconStyle, Shape, TextAnchor } from "@/lib/lang";

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

function renderShape(shape: Shape, index: number): ReactElement {
  switch (shape.kind) {
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
  children,
}: CardFaceSvgProps): ReactElement {
  return (
    <svg
      viewBox={`0 0 ${xUnits} ${yUnits}`}
      preserveAspectRatio="none"
      {...svgAttributes}
    >
      {children}
      {error ? renderErrorFace(xUnits, yUnits, error) : face.map(renderShape)}
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
