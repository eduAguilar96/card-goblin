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
 * - anything else   → RAW TEXT, no diagnostic: lowercase, empty, or
 *                     unclosed `{...}` stays exactly as typed (the `{` is
 *                     kept literal and scanning resumes right after it, so
 *                     a valid marker later in the text still parses).
 * - a lone `}`      → literal.
 */

import type { InlineIcon } from "./model";

/** One parsed piece of a resolved string: plain text (adjacent pieces are
 * always merged — `parseInlineMarkers` never returns two text segments in a
 * row, and never an empty text segment) or one inline icon. */
export type MarkerSegment =
  | { kind: "text"; text: string }
  | { kind: "icon"; icon: InlineIcon };

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
export function parseInlineMarkers(text: string): MarkerSegment[] {
  const segments: MarkerSegment[] = [];
  let plain = "";
  const flushPlain = (): void => {
    if (plain !== "") {
      segments.push({ kind: "text", text: plain });
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
    if (icon === null) {
      // Not a marker: the `{` is literal; resume right after it so a valid
      // marker inside (e.g. `{bad {HEARTS}`) still parses.
      plain += "{";
      i++;
      continue;
    }
    flushPlain();
    segments.push({ kind: "icon", icon });
    i = close + 1;
  }
  flushPlain();
  return segments;
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

/** Merge adjacent text segments (used after the evaluator downgrades an
 * unknown computed dicier marker back to its raw text — the neighbors must
 * fuse so wrapping sees `x{BAD}y` as ONE word, never three tokens). */
export function mergeTextSegments(segments: readonly MarkerSegment[]): MarkerSegment[] {
  const out: MarkerSegment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (segment.kind === "text" && last?.kind === "text") {
      out[out.length - 1] = { kind: "text", text: last.text + segment.text };
    } else {
      out.push(segment);
    }
  }
  return out;
}
