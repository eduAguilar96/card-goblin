/**
 * Inline-icon marker grammar (DESIGN.md §3.3.2/§3.3.3, M4 — ◆44, §7.5).
 *
 * Markers are parsed on a RESOLVED string — AFTER interpolation — which is
 * the only design under which a marker arriving from a sheet cell works
 * identically to a literal (◆44). Braces are ordinary string characters to
 * the lexer (§3.1); this module is the whole grammar, shared by the checker
 * (literal W004/W005 scanning), the evaluator (run layout), and nothing
 * else — the renderers only ever see the resulting runs.
 *
 * The grammar, exactly (§7.5):
 * - `{{`            → a literal `{` (the escape).
 * - `{NAME}`        → a Dicier marker, when NAME is non-empty and matches
 *                     the Dicier code shape: uppercase A–Z, digits,
 *                     underscore, and space (the curated list has
 *                     digit-leading codes like `3_ON_D6` and one code with
 *                     a space, `OUI ET` — ◆20).
 * - `{asset:name}`  → an asset marker, when `name` matches the §3.1
 *                     identifier rules (letter, then letters/digits/
 *                     underscores — the Assets drawer's own name rules).
 * - `{color:value}` … `{/color}` → a scoped run-color override, where value
 *                     is a CSS named color or #RRGGBB; scopes may nest.
 * - anything else   → RAW TEXT, no diagnostic: lowercase, empty, or
 *                     unclosed `{...}` stays exactly as typed (the `{` is
 *                     kept literal and scanning resumes right after it, so
 *                     a valid marker later in the text still parses).
 * - a lone `}`      → literal.
 */

import { CSS_COLOR_NAMES } from "./css-colors";
import type { InlineIcon } from "./model";

/** One parsed visible piece of a resolved string: plain text or one inline
 * icon, optionally carrying the active scoped color. Adjacent text with the
 * SAME color is merged; a color boundary deliberately remains a run boundary. */
export type MarkerSegment =
  | { kind: "text"; text: string; color?: string }
  | {
      kind: "icon";
      icon: InlineIcon;
      color?: string;
      /** Evaluator-only provenance: the marker spelling came from a runtime
       * alias replacement rather than the literal host text. */
      computed?: boolean;
    };

type ParsedPiece =
  | { kind: "text"; text: string }
  | { kind: "icon"; icon: InlineIcon; computed?: boolean }
  | { kind: "color-open"; color: string; raw: string }
  | { kind: "color-close"; raw: string };

/** The Dicier code shape (§7.5): uppercase A–Z, digits, underscore, space —
 * non-empty. Deliberately the SHAPE, not the curated list: an unknown code
 * still parses as a marker (W004/D005 territory), exactly like Icon `code:`. */
const DICIER_MARKER_RE = /^[A-Z0-9_ ]+$/;

/** `asset:` + a §3.1 identifier (the ASSET_NAME_PATTERN shape — letter
 * first, then letters/digits/underscores). */
const ASSET_MARKER_RE = /^asset:([A-Za-z][A-Za-z0-9_]*)$/;

/**
 * Parse one resolved string into text/icon segments. Total — never throws,
 * and every input character lands in exactly one segment (markers as their
 * parsed icon, everything else verbatim, `{{` as one `{`). Empty input →
 * empty array.
 */
export function parseInlineMarkers(
  text: string,
  computedAt?: (start: number, end: number) => boolean,
): MarkerSegment[] {
  const pieces: ParsedPiece[] = [];
  let plain = "";
  const flushPlain = (): void => {
    if (plain !== "") {
      pieces.push({ kind: "text", text: plain });
      plain = "";
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== "{") {
      plain += ch;
      i++;
      continue;
    }
    if (text[i + 1] === "{") {
      plain += "{"; // the escape: both braces consumed, one literal brace out
      i += 2;
      continue;
    }
    const close = text.indexOf("}", i + 1);
    if (close === -1) {
      plain += text.slice(i); // unclosed: raw text to the end
      break;
    }
    const inner = text.slice(i + 1, close);
    const icon = parseMarkerBody(inner);
    const color = parseColorOpen(inner);
    if (icon === null && color === null && inner !== "/color") {
      // Not a marker: the `{` is literal; resume right after it so a valid
      // marker inside (e.g. `{bad {HEARTS}`) still parses.
      plain += "{";
      i++;
      continue;
    }
    flushPlain();
    const raw = text.slice(i, close + 1);
    if (icon !== null) {
      pieces.push({
        kind: "icon",
        icon,
        ...(computedAt?.(i, close + 1) ? { computed: true } : {}),
      });
    }
    else if (color !== null) pieces.push({ kind: "color-open", color, raw });
    else pieces.push({ kind: "color-close", raw });
    i = close + 1;
  }
  flushPlain();

  // Pair color scopes before applying them. Unmatched controls remain visible
  // raw text, preserving the marker grammar's total/gentle failure posture.
  const matched = new Set<number>();
  const stack: number[] = [];
  for (let p = 0; p < pieces.length; p++) {
    const piece = pieces[p];
    if (piece.kind === "color-open") {
      stack.push(p);
    } else if (piece.kind === "color-close" && stack.length > 0) {
      matched.add(stack.pop() as number);
      matched.add(p);
    }
  }

  const segments: MarkerSegment[] = [];
  const colors: string[] = [];
  const activeColor = (): string | undefined => colors[colors.length - 1];
  const pushText = (visible: string): void => {
    if (visible === "") return;
    const colorNow = activeColor();
    const last = segments[segments.length - 1];
    if (last?.kind === "text" && last.color === colorNow) {
      last.text += visible;
      return;
    }
    segments.push({ kind: "text", text: visible, ...(colorNow ? { color: colorNow } : {}) });
  };
  for (let p = 0; p < pieces.length; p++) {
    const piece = pieces[p];
    if (piece.kind === "color-open") {
      if (matched.has(p)) colors.push(piece.color);
      else pushText(piece.raw);
    } else if (piece.kind === "color-close") {
      if (matched.has(p)) colors.pop();
      else pushText(piece.raw);
    } else if (piece.kind === "text") {
      pushText(piece.text);
    } else {
      const colorNow = activeColor();
      segments.push({
        kind: "icon",
        icon: piece.icon,
        ...(colorNow ? { color: colorNow } : {}),
        ...(piece.computed ? { computed: true } : {}),
      });
    }
  }
  return normalizeScalarBoundaries(segments);
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** Invisible color controls must not bisect one Unicode scalar into invalid
 * run strings. The scalar takes the color of its leading code unit (the left
 * run), and any remaining text keeps the right run's color. */
function normalizeScalarBoundaries(segments: readonly MarkerSegment[]): MarkerSegment[] {
  const out: MarkerSegment[] = [];
  for (const segment of segments) {
    if (segment.kind === "icon") {
      out.push(segment);
      continue;
    }
    let text = segment.text;
    let last = out[out.length - 1];
    if (
      last?.kind === "text" &&
      last.text.length > 0 &&
      text.length > 0 &&
      isHighSurrogate(last.text.charCodeAt(last.text.length - 1)) &&
      isLowSurrogate(text.charCodeAt(0))
    ) {
      last.text += text[0];
      text = text.slice(1);
    }
    if (text === "") continue;
    last = out[out.length - 1];
    if (last?.kind === "text" && last.color === segment.color) {
      last.text += text;
    } else {
      out.push({ kind: "text", text, ...(segment.color ? { color: segment.color } : {}) });
    }
  }
  return out;
}

/** A valid `{color:...}` body, normalized to the same values as `color:`. */
function parseColorOpen(inner: string): string | null {
  if (!inner.startsWith("color:")) return null;
  const value = inner.slice("color:".length);
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  const lower = value.toLowerCase();
  return CSS_COLOR_NAMES.has(lower) ? lower : null;
}

/** The body between one `{` and its `}`: a Dicier code shape, an `asset:`
 * reference, or null (raw text). */
function parseMarkerBody(inner: string): InlineIcon | null {
  if (DICIER_MARKER_RE.test(inner)) return { kind: "dicier", code: inner };
  const asset = ASSET_MARKER_RE.exec(inner);
  if (asset) return { kind: "asset", name: asset[1] };
  return null;
}

/** The raw source spelling of a marker (§3.8 D005: an unknown COMPUTED
 * dicier code renders as this raw text — its own visible indicator). */
export function rawMarkerText(icon: InlineIcon): string {
  return icon.kind === "dicier" ? `{${icon.code}}` : `{asset:${icon.name}}`;
}

/** Merge same-colored adjacent text segments (used after the evaluator
 * downgrades an unknown computed dicier marker back to its raw text — matching
 * neighbors fuse while genuine color boundaries remain paint boundaries). */
export function mergeTextSegments(segments: readonly MarkerSegment[]): MarkerSegment[] {
  const out: MarkerSegment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (segment.kind === "text" && last?.kind === "text" && segment.color === last.color) {
      out[out.length - 1] = {
        kind: "text",
        text: last.text + segment.text,
        ...(last.color ? { color: last.color } : {}),
      };
    } else {
      out.push(segment);
    }
  }
  return normalizeScalarBoundaries(out);
}
