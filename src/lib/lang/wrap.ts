/**
 * The TextBox wrap engine (DESIGN.md §3.3 TextBox row, §7.2).
 *
 * Pure functions, no React, no DOM: THE COMPILER IS THE WRAPPING AUTHORITY.
 * The evaluator calls `layoutTextBox` and the model carries the resolved
 * lines, so the preview and the PDF rasterizer render identical text by
 * construction — neither ever re-wraps.
 *
 * Measurement is a sum of per-character advance widths from the generated
 * Geist metrics table (geist-metrics.ts, the dicier-codes pattern), scaled by
 * size / unitsPerEm, times a small safety margin (WIDTH_SAFETY_MARGIN below).
 * The margin absorbs what an advance sum cannot see — kerning is omitted and
 * a browser may rasterize at fractional pixel positions — and errs toward
 * wrapping a word EARLY rather than painting past the box.
 *
 * Wrap semantics (§3.3, in order):
 * 1. Split on hard breaks first: every real `\n` in the resolved text (from
 *    the §3.1 string escapes or straight from cell data) ends a line,
 *    unconditionally. Leading/trailing/consecutive newlines produce empty
 *    lines — a hard break is data, never collapsed.
 * 2. Within a segment, greedy word-wrap on spaces: words move to the next
 *    line whole. The space run at a chosen break point collapses (it became
 *    the line break); interior spacing is preserved verbatim, including
 *    leading/trailing spaces of a segment (deliberate indentation survives).
 * 3. A single word wider than the box breaks MID-WORD rather than overflow
 *    horizontally — as many characters per line as fit, and always at least
 *    one, so a degenerately narrow box still makes progress.
 *
 * Vertical fit is lines × lineHeight × size ≤ height:
 * - `clip` keeps the lines up to the last fully fitting one and marks the
 *   box clipped (possibly ZERO lines in a box shorter than one line — the
 *   honest reading of "last fully-fitting line").
 * - `shrink` retries at 5%-of-declared-size steps (SHRINK_STEP) down to a
 *   60% floor (SHRINK_FLOOR), taking the FIRST size that fits — re-wrapping
 *   at each step, since a smaller size fits more per line — then clips at
 *   the floor if none fits. The result carries the FINAL size.
 */

import type { TextBoxOverflow } from "./model";
import {
  GEIST_ADVANCES,
  GEIST_FALLBACK_ADVANCE,
  GEIST_UNITS_PER_EM,
} from "./geist-metrics";

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** An advance-width table the engine measures against. Injectable so tests
 * can use tiny hand-made fonts with predictable arithmetic. */
export interface FontMetrics {
  unitsPerEm: number;
  /** Advance charged for a codepoint absent from `advances`. */
  fallbackAdvance: number;
  /** BMP codepoint → advance width in font units. */
  advances: ReadonlyMap<number, number>;
}

/** The real table: Geist's default instance, generated from GeistVF.woff by
 * scripts/generate-geist-metrics.mjs — what the evaluator wraps with. */
export const GEIST_METRICS: FontMetrics = {
  unitsPerEm: GEIST_UNITS_PER_EM,
  fallbackAdvance: GEIST_FALLBACK_ADVANCE,
  advances: GEIST_ADVANCES,
};

/**
 * Measured widths are inflated by 2% (§3.3: "a 2% measurement safety
 * margin"). An advance sum ignores kerning and sub-pixel rasterization; the
 * margin makes the engine wrap slightly EARLY instead of ever painting past
 * the box edge. Applied in `measureText`, so every fit decision shares it.
 */
export const WIDTH_SAFETY_MARGIN = 1.02;

/** `overflow: shrink` reduces the size in steps of 5% OF THE DECLARED SIZE
 * (§3.3) — absolute steps, not compounding, so the floor is reached in
 * exactly (1 − SHRINK_FLOOR) / SHRINK_STEP = 8 retries. */
export const SHRINK_STEP = 0.05;

/** The smallest size `shrink` will try, as a fraction of the declared size
 * (§3.3: "a 60% floor") — below this, shrinking would trade overflow for
 * illegibility, so the engine clips at the floor instead. */
export const SHRINK_FLOOR = 0.6;

/**
 * The width of `text` (no newlines expected) drawn at `size` units per em,
 * in card units, safety margin included. The per-codepoint loop iterates
 * String's [Symbol.iterator] — surrogate PAIRS arrive as one (non-BMP)
 * codepoint and charge one fallback advance, not two.
 */
export function measureText(text: string, size: number, metrics: FontMetrics): number {
  let units = 0;
  for (const ch of text) {
    units += metrics.advances.get(ch.codePointAt(0) as number) ?? metrics.fallbackAdvance;
  }
  return (units * size * WIDTH_SAFETY_MARGIN) / metrics.unitsPerEm;
}

// ---------------------------------------------------------------------------
// Horizontal wrap
// ---------------------------------------------------------------------------

/**
 * Wrap `text` into lines no wider than `boxWidth` at `size` — semantics 1–3
 * of the header. Exported for direct tests; `layoutTextBox` below adds the
 * vertical clip/shrink pass. Always returns at least one line (`""` wraps to
 * [""]); every hard break contributes a line boundary.
 */
export function wrapText(
  text: string,
  boxWidth: number,
  size: number,
  metrics: FontMetrics,
): string[] {
  const lines: string[] = [];
  for (const segment of text.split("\n")) {
    wrapSegment(segment, boxWidth, size, metrics, lines);
  }
  return lines;
}

/** One hard-break-free segment → one or more lines appended to `out`. */
function wrapSegment(
  segment: string,
  boxWidth: number,
  size: number,
  metrics: FontMetrics,
  out: string[],
): void {
  // Tokenize into alternating space runs and words; both are tokens, so
  // interior spacing survives verbatim and only the run AT a break collapses.
  const tokens = segment.match(/ +|[^ ]+/g) ?? [];
  let line = "";
  /** Space run seen since the last word — pending: it joins the line only if
   * another word follows on the SAME line, and collapses if a break lands. */
  let pendingSpaces = "";
  let lineHasContent = false;
  let pushedAny = false;

  const flush = (): void => {
    out.push(line);
    pushedAny = true;
    line = "";
    pendingSpaces = "";
    lineHasContent = false;
  };

  for (const token of tokens) {
    if (token[0] === " ") {
      if (!lineHasContent) {
        line += token; // leading spaces: preserved indentation, never a break
      } else {
        pendingSpaces += token;
      }
      continue;
    }
    const candidate = line + pendingSpaces + token;
    if (measureText(candidate, size, metrics) <= boxWidth) {
      line = candidate;
      pendingSpaces = "";
      lineHasContent = true;
      continue;
    }
    if (lineHasContent) {
      flush(); // break here — the pending space run collapses with it
    }
    // The word starts its own line (possibly after leading spaces). If it
    // still doesn't fit, it is wider than the box: break mid-word.
    let word = token;
    // `word !== ""` guards negative box widths (a `width: -1` cell): with
    // boxWidth < 0 even the empty string "exceeds" the box, and widestPrefix
    // on an exhausted word would crash — degrade like width 0 instead (one
    // codepoint per line; ⚑8: one bad cell never blanks the deck).
    while (word !== "" && measureText(line + word, size, metrics) > boxWidth) {
      const head = widestPrefix(line, word, boxWidth, size, metrics);
      line += word.slice(0, head);
      word = word.slice(head);
      flush();
    }
    line += word;
    // A word fully consumed by mid-word flushes leaves NO open line — the
    // next token starts fresh (and no spurious trailing "" is pushed below).
    if (word !== "") lineHasContent = true;
  }
  // Close the segment's open line. Trailing pending spaces sit after the
  // last word — interior to no break, so they are preserved (invisible, but
  // honest). Skipped only when mid-word flushes already emitted everything
  // AND the segment produced at least one line (an empty segment yields "").
  if (!pushedAny || line !== "" || pendingSpaces !== "" || lineHasContent) {
    out.push(line + pendingSpaces);
  }
}

/** Longest prefix of `word` (≥ 1 codepoint) that fits after `prefix` — the
 * mid-word break point. At least one codepoint always ships per line, so a
 * box narrower than one character still terminates. Grows codepoint-wise
 * but returns the prefix's UTF-16 LENGTH, which is what slicing needs. */
function widestPrefix(
  prefix: string,
  word: string,
  boxWidth: number,
  size: number,
  metrics: FontMetrics,
): number {
  const chars = [...word];
  let head = chars[0];
  for (let i = 1; i < chars.length; i++) {
    const next = head + chars[i];
    if (measureText(prefix + next, size, metrics) > boxWidth) break;
    head = next;
  }
  return head.length;
}

// ---------------------------------------------------------------------------
// Vertical fit — clip and shrink
// ---------------------------------------------------------------------------

export interface TextBoxLayout {
  /** The lines that survived the vertical pass, top to bottom. */
  lines: string[];
  /** The FINAL size — the declared one unless `shrunk`. */
  size: number;
  /** Lines were dropped (clip, or shrink that bottomed out at the floor). */
  clipped: boolean;
  /** `overflow: shrink` reduced the size (whether or not it then fit). */
  shrunk: boolean;
}

export interface TextBoxLayoutInput {
  text: string;
  /** Box width in card units. */
  width: number;
  /** Box height in card units. */
  height: number;
  /** Declared em size in card units. */
  size: number;
  /** Baseline advance multiplier — line i advances lineHeight × size. */
  lineHeight: number;
  overflow: TextBoxOverflow;
  metrics: FontMetrics;
}

/** How many of `count` lines fit in `height` at `size`: the §3.3 vertical
 * fit. The predicate `k × lineHeight × size ≤ height` is authoritative —
 * computed by multiplication exactly as the spec writes it, with the
 * division only seeding the search (division and multiplication round
 * differently at boundaries; the spec's formula must win). */
function fittingLines(count: number, height: number, size: number, lineHeight: number): number {
  if (size <= 0 || lineHeight <= 0) return count; // degenerate: everything "fits"
  const perLine = lineHeight * size;
  let k = Math.max(0, Math.min(count, Math.floor(height / perLine)));
  while (k < count && (k + 1) * perLine <= height) k++;
  while (k > 0 && k * perLine > height) k--;
  return k;
}

/**
 * The full §3.3 TextBox layout: wrap at the declared size, then resolve
 * vertical overflow per `overflow:`. Deterministic and pure — same inputs,
 * same lines, wherever it runs.
 */
export function layoutTextBox(input: TextBoxLayoutInput): TextBoxLayout {
  const { text, width, height, size, lineHeight, overflow, metrics } = input;

  const attempt = (trySize: number): { lines: string[]; fit: number } => {
    const lines = wrapText(text, width, trySize, metrics);
    return { lines, fit: fittingLines(lines.length, height, trySize, lineHeight) };
  };

  const first = attempt(size);
  if (first.fit >= first.lines.length) {
    return { lines: first.lines, size, clipped: false, shrunk: false };
  }
  // Whitespace-only text can't be meaningfully "clipped" — truncate quietly
  // rather than badge a card that has nothing to show (review finding).
  if (text.trim() === "") {
    return { lines: first.lines.slice(0, first.fit), size, clipped: false, shrunk: false };
  }

  if (overflow === "shrink") {
    // 5%-of-DECLARED-size steps down to the 60% floor: factors 0.95 … 0.60.
    // INTEGER percent arithmetic throughout — 0.05 and 0.6 are not exactly
    // representable as floats, so both the loop bounds and the candidate
    // sizes are derived from rounded integer percents (0.85 · size is then
    // one rounding, not a product of drifting 0.05s).
    const stepPct = Math.round(SHRINK_STEP * 100);
    const floorPct = Math.round(SHRINK_FLOOR * 100);
    for (let pct = 100 - stepPct; pct >= floorPct; pct -= stepPct) {
      const trySize = (size * pct) / 100;
      const retry = attempt(trySize);
      if (retry.fit >= retry.lines.length) {
        return { lines: retry.lines, size: trySize, clipped: false, shrunk: true };
      }
      if (pct === floorPct) {
        // Nothing fits even at the floor: clip there (§3.3).
        return {
          lines: retry.lines.slice(0, retry.fit),
          size: trySize,
          clipped: true,
          shrunk: true,
        };
      }
    }
  }

  return { lines: first.lines.slice(0, first.fit), size, clipped: true, shrunk: false };
}
