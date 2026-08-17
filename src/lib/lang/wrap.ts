/**
 * The Text/TextBox layout engine (DESIGN.md §3.3 TextBox row, §7.2, §7.5).
 *
 * Pure functions, no React, no DOM: THE COMPILER IS THE WRAPPING AUTHORITY.
 * The evaluator calls `layoutTextBoxRuns` (and `layoutSingleLine` for Text)
 * and the model carries the resolved lines-of-runs, so the preview and the
 * PDF rasterizer render identical text by construction — neither ever
 * re-wraps or re-measures.
 *
 * Measurement is a sum of per-character advance widths from the generated
 * Geist metrics table (geist-metrics.ts, the dicier-codes pattern), scaled by
 * size / unitsPerEm, times a small safety margin (WIDTH_SAFETY_MARGIN below).
 * The margin absorbs what an advance sum cannot see — kerning is omitted and
 * a browser may rasterize at fractional pixel positions — and errs toward
 * wrapping a word EARLY rather than painting past the box.
 *
 * Inline icons (◆44, §7.5): input arrives as marker segments (markers.ts) —
 * plain text plus inline icons. An icon is ONE ATOMIC TOKEN with advance =
 * EXACTLY the em size (the 1-em slot — no safety margin on a width that is
 * true by construction): it wraps like a word, never breaks mid-slot, and
 * the spaces around it collapse at break points exactly like word wrap.
 * Text is measured exactly as before — a marker-free input takes literally
 * the same arithmetic through this engine as it did before runs existed
 * (each fit decision measures the line's contiguous text as ONE string),
 * which is what keeps every pre-◆44 wrap byte-identical.
 *
 * Wrap semantics (§3.3, in order):
 * 1. Split on hard breaks first: every real `\n` in the resolved text (from
 *    the §3.1 string escapes or straight from cell data) ends a line,
 *    unconditionally. Leading/trailing/consecutive newlines produce empty
 *    lines — a hard break is data, never collapsed.
 * 2. Within a segment, greedy word-wrap on spaces: words (and icon slots)
 *    move to the next line whole. The space run at a chosen break point
 *    collapses (it became the line break); interior spacing is preserved
 *    verbatim, including leading/trailing spaces of a segment (deliberate
 *    indentation survives).
 * 3. A single word wider than the box breaks MID-WORD rather than overflow
 *    horizontally — as many characters per line as fit, and always at least
 *    one, so a degenerately narrow box still makes progress. An icon slot
 *    NEVER breaks: wider than the box, it overflows on its own line (the
 *    slot is atomic; progress is still guaranteed).
 *
 * Vertical fit is lines × lineHeight × size ≤ height:
 * - `clip` keeps the lines up to the last fully fitting one and marks the
 *   box clipped (possibly ZERO lines in a box shorter than one line — the
 *   honest reading of "last fully-fitting line").
 * - `shrink` retries at 5%-of-declared-size steps (SHRINK_STEP) down to a
 *   60% floor (SHRINK_FLOOR), taking the FIRST size that fits — re-wrapping
 *   at each step, since a smaller size fits more per line — then clips at
 *   the floor if none fits. The result carries the FINAL size (and run
 *   x-offsets recomputed at that size).
 */

import type { FontFace, InlineIcon, TextBoxLine, TextBoxOverflow, TextRun } from "./model";
import type { MarkerSegment } from "./markers";
import {
  GEIST_ADVANCES,
  GEIST_FALLBACK_ADVANCE,
  GEIST_UNITS_PER_EM,
} from "./geist-metrics";
import { FONT_METRICS } from "./font-metrics";

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
 * scripts/generate-font-metrics.mjs — what the evaluator wraps with. */
export const GEIST_METRICS: FontMetrics = {
  unitsPerEm: GEIST_UNITS_PER_EM,
  fallbackAdvance: GEIST_FALLBACK_ADVANCE,
  advances: GEIST_ADVANCES,
};

/**
 * The measuring stick for one `font:` face (§3.3, M3 — ◆41). THIS is the
 * function that makes per-font wrapping correct: `geist` (the default) uses
 * GEIST_METRICS above; every other face uses ITS OWN generated advances from
 * font-metrics.ts — a TextBox in Courier must wrap against Courier's
 * advances, not Geist's, or the compiler's "wrapping authority" promise
 * (§7.2) would be wrong for eight of the nine faces. `FONT_METRICS[face]`
 * (not `GeneratedFontMetrics` itself) is structurally a superset of
 * `FontMetrics` — it also carries `ascent`, which wrap.ts's measurement
 * never reads (that's cardSvg.tsx's job) but this function does not need to
 * strip.
 */
export function metricsForFace(face: FontFace): FontMetrics {
  return face === "geist" ? GEIST_METRICS : FONT_METRICS[face];
}

/**
 * Measured widths are inflated by 2% (§3.3: "a 2% measurement safety
 * margin"). An advance sum ignores kerning and sub-pixel rasterization; the
 * margin makes the engine wrap slightly EARLY instead of ever painting past
 * the box edge. Applied in `measureText`, so every fit decision shares it.
 * Icon slots are exempt (◆44): their advance is exactly the em size by
 * construction, not a measurement.
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
// Tokens and line pieces (◆44)
// ---------------------------------------------------------------------------

/** One wrap token: a run of spaces, a word, or an atomic icon slot. */
type WrapToken =
  | { kind: "spaces"; text: string }
  | { kind: "word"; text: string }
  | { kind: "icon"; icon: InlineIcon };

/** A line being built: contiguous text is kept MERGED into one piece so
 * every fit decision can measure it as one string — the arithmetic
 * pre-◆44 wraps used, preserved exactly for marker-free input. */
type LinePiece = { kind: "text"; text: string } | { kind: "icon"; icon: InlineIcon };

/** Marker segments → one token array per HARD line (semantics rule 1:
 * every real `\n` ends a line, unconditionally). Always ≥ 1 line. */
function hardLineTokens(segments: readonly MarkerSegment[]): WrapToken[][] {
  const lines: WrapToken[][] = [[]];
  for (const segment of segments) {
    if (segment.kind === "icon") {
      lines[lines.length - 1].push({ kind: "icon", icon: segment.icon });
      continue;
    }
    const parts = segment.text.split("\n");
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) lines.push([]);
      // Alternating space runs and words; both are tokens, so interior
      // spacing survives verbatim and only the run AT a break collapses.
      for (const token of parts[p].match(/ +|[^ ]+/g) ?? []) {
        lines[lines.length - 1].push(
          token[0] === " " ? { kind: "spaces", text: token } : { kind: "word", text: token },
        );
      }
    }
  }
  return lines;
}

/**
 * Width of `pieces` + `extraText` appended after them + `extraIcons` slots,
 * with all contiguous text measured as ONE string per stretch (exact-
 * arithmetic parity with the pre-◆44 engine for text-only lines) and each
 * icon contributing exactly `size` (the 1-em slot, ◆44).
 */
function widthWith(
  pieces: readonly LinePiece[],
  extraText: string,
  extraIcons: number,
  size: number,
  metrics: FontMetrics,
): number {
  let width = 0;
  let text = "";
  for (const piece of pieces) {
    if (piece.kind === "text") {
      text += piece.text;
    } else {
      if (text !== "") {
        width += measureText(text, size, metrics);
        text = "";
      }
      width += size;
    }
  }
  text += extraText;
  if (text !== "") width += measureText(text, size, metrics);
  return width + extraIcons * size;
}

/** Finalize one built line into runs with absolute x-offsets (◆44): text
 * advances measured (margin included), icon advances exactly `size`. The
 * final x IS the line's carried width. */
function piecesToLine(
  pieces: readonly LinePiece[],
  size: number,
  metrics: FontMetrics,
): TextBoxLine {
  const runs: TextRun[] = [];
  let x = 0;
  for (const piece of pieces) {
    if (piece.kind === "text") {
      runs.push({ kind: "text", text: piece.text, x });
      x += measureText(piece.text, size, metrics);
    } else {
      runs.push({ kind: "icon", x, icon: piece.icon });
      x += size;
    }
  }
  return { runs, width: x };
}

/** The concatenated text of one line's runs — what a marker-free line reads
 * as (the legacy string `lines`), and what the renderers draw for pure-text
 * content. Exported for renderers and tests. */
export function lineText(line: TextBoxLine): string {
  let out = "";
  for (const run of line.runs) {
    if (run.kind === "text") out += run.text;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Horizontal wrap
// ---------------------------------------------------------------------------

/**
 * Wrap marker segments into lines-of-runs no wider than `boxWidth` at
 * `size` — semantics 1–3 of the header. Exported for direct tests;
 * `layoutTextBoxRuns` below adds the vertical clip/shrink pass. Always
 * returns at least one line (empty input wraps to one empty line); every
 * hard break contributes a line boundary.
 */
export function wrapRuns(
  segments: readonly MarkerSegment[],
  boxWidth: number,
  size: number,
  metrics: FontMetrics,
): TextBoxLine[] {
  const built: LinePiece[][] = [];
  for (const tokens of hardLineTokens(segments)) {
    wrapSegment(tokens, boxWidth, size, metrics, built);
  }
  return built.map((pieces) => piecesToLine(pieces, size, metrics));
}

/**
 * Wrap plain text into string lines — the pre-◆44 surface, kept working
 * (and marker-AGNOSTIC: braces are ordinary characters here; marker parsing
 * is the evaluator's job). Thin wrapper over the run engine, whose
 * text-only arithmetic is exactly the old engine's.
 */
export function wrapText(
  text: string,
  boxWidth: number,
  size: number,
  metrics: FontMetrics,
): string[] {
  const segments: MarkerSegment[] = text === "" ? [] : [{ kind: "text", text }];
  return wrapRuns(segments, boxWidth, size, metrics).map(lineText);
}

/** One hard-break-free token list → one or more built lines appended to
 * `out`. The exact greedy structure of the pre-◆44 string engine, ported
 * to pieces; every text-only path measures the same strings it always did. */
function wrapSegment(
  tokens: readonly WrapToken[],
  boxWidth: number,
  size: number,
  metrics: FontMetrics,
  out: LinePiece[][],
): void {
  let pieces: LinePiece[] = [];
  /** Space run seen since the last word/icon — pending: it joins the line
   * only if more content follows on the SAME line, and collapses if a break
   * lands. */
  let pendingSpaces = "";
  let lineHasContent = false;
  let pushedAny = false;

  const appendText = (text: string): void => {
    if (text === "") return;
    const last = pieces[pieces.length - 1];
    if (last?.kind === "text") last.text += text;
    else pieces.push({ kind: "text", text });
  };

  const flush = (): void => {
    out.push(pieces);
    pushedAny = true;
    pieces = [];
    pendingSpaces = "";
    lineHasContent = false;
  };

  for (const token of tokens) {
    if (token.kind === "spaces") {
      if (!lineHasContent) {
        appendText(token.text); // leading spaces: preserved indentation, never a break
      } else {
        pendingSpaces += token.text;
      }
      continue;
    }

    if (token.kind === "icon") {
      // ◆44: one atomic token, advance exactly `size` — wraps like a word.
      if (widthWith(pieces, pendingSpaces, 1, size, metrics) <= boxWidth) {
        appendText(pendingSpaces);
        pendingSpaces = "";
        pieces.push({ kind: "icon", icon: token.icon });
        lineHasContent = true;
        continue;
      }
      if (lineHasContent) {
        flush(); // break here — the pending space run collapses with it
      }
      // The slot starts its own line (possibly after preserved leading
      // spaces). It NEVER breaks mid-slot: wider than the box, it simply
      // overflows — placing it is what guarantees progress (the icon
      // analogue of "at least one codepoint always ships").
      pieces.push({ kind: "icon", icon: token.icon });
      lineHasContent = true;
      continue;
    }

    // A word.
    if (widthWith(pieces, pendingSpaces + token.text, 0, size, metrics) <= boxWidth) {
      appendText(pendingSpaces + token.text);
      pendingSpaces = "";
      lineHasContent = true;
      continue;
    }
    if (lineHasContent) {
      flush(); // break here — the pending space run collapses with it
    }
    // The word starts its own line. Reaching here, the line is text-only by
    // construction (icons set lineHasContent, which forced the flush), so
    // the mid-word loop measures plain strings — the pre-◆44 arithmetic.
    let lineTextSoFar = "";
    for (const piece of pieces) {
      if (piece.kind === "text") lineTextSoFar += piece.text;
    }
    let word = token.text;
    // `word !== ""` guards negative box widths (a `width: -1` cell): with
    // boxWidth < 0 even the empty string "exceeds" the box, and widestPrefix
    // on an exhausted word would crash — degrade like width 0 instead (one
    // codepoint per line; ⚑8: one bad cell never blanks the deck).
    while (word !== "" && measureText(lineTextSoFar + word, size, metrics) > boxWidth) {
      const head = widestPrefix(lineTextSoFar, word, boxWidth, size, metrics);
      lineTextSoFar += word.slice(0, head);
      word = word.slice(head);
      pieces = lineTextSoFar === "" ? [] : [{ kind: "text", text: lineTextSoFar }];
      flush();
      lineTextSoFar = "";
    }
    appendText(word);
    // A word fully consumed by mid-word flushes leaves NO open line — the
    // next token starts fresh (and no spurious trailing "" is pushed below).
    if (word !== "") lineHasContent = true;
  }
  // Close the segment's open line. Trailing pending spaces sit after the
  // last word — interior to no break, so they are preserved (invisible, but
  // honest). Skipped only when mid-word flushes already emitted everything
  // AND the segment produced at least one line (an empty segment yields one
  // empty line).
  if (!pushedAny || pieces.length > 0 || pendingSpaces !== "" || lineHasContent) {
    appendText(pendingSpaces);
    out.push(pieces);
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
// Single-line layout (Text, ◆44)
// ---------------------------------------------------------------------------

/**
 * Lay out marker segments as ONE line of runs with absolute x-offsets — the
 * `Text` element (◆24: single line, always; no wrapping, no box). Newlines
 * should already have been replaced by spaces (the §3.3.2 Text rule) before
 * marker parsing; any that slip through measure as ordinary fallback
 * characters, exactly as pre-◆44 rendering treated them.
 */
export function layoutSingleLine(
  segments: readonly MarkerSegment[],
  size: number,
  metrics: FontMetrics,
): TextBoxLine {
  const pieces: LinePiece[] = segments.map((segment) =>
    segment.kind === "text"
      ? { kind: "text", text: segment.text }
      : { kind: "icon", icon: segment.icon },
  );
  return piecesToLine(pieces, size, metrics);
}

// ---------------------------------------------------------------------------
// Vertical fit — clip and shrink
// ---------------------------------------------------------------------------

/** The run-model layout result (◆44) — what the evaluator puts on the
 * TextBoxShape. */
export interface TextBoxRunsLayout {
  /** The lines that survived the vertical pass, top to bottom. */
  lines: TextBoxLine[];
  /** The FINAL size — the declared one unless `shrunk`. */
  size: number;
  /** Lines were dropped (clip, or shrink that bottomed out at the floor). */
  clipped: boolean;
  /** `overflow: shrink` reduced the size (whether or not it then fit). */
  shrunk: boolean;
}

/** The pre-◆44 string-lines layout result — kept for the string-surface
 * `layoutTextBox` below (tests and any caller that thinks in plain text). */
export interface TextBoxLayout {
  lines: string[];
  size: number;
  clipped: boolean;
  shrunk: boolean;
}

export interface TextBoxRunsLayoutInput {
  /** Marker segments of the resolved text (markers.ts) — the evaluator
   * parses (and D005-downgrades) BEFORE layout; this engine never sees a
   * raw brace as anything but text. */
  segments: readonly MarkerSegment[];
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

export interface TextBoxLayoutInput {
  text: string;
  width: number;
  height: number;
  size: number;
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
 * The full §3.3 TextBox layout over marker segments: wrap at the declared
 * size, then resolve vertical overflow per `overflow:`. Deterministic and
 * pure — same inputs, same lines, wherever it runs. Shrink RE-WRAPS at each
 * candidate size, so run x-offsets always belong to the FINAL size.
 */
export function layoutTextBoxRuns(input: TextBoxRunsLayoutInput): TextBoxRunsLayout {
  const { segments, width, height, size, lineHeight, overflow, metrics } = input;

  const attempt = (trySize: number): { lines: TextBoxLine[]; fit: number } => {
    const lines = wrapRuns(segments, width, trySize, metrics);
    return { lines, fit: fittingLines(lines.length, height, trySize, lineHeight) };
  };

  const first = attempt(size);
  if (first.fit >= first.lines.length) {
    return { lines: first.lines, size, clipped: false, shrunk: false };
  }
  // Whitespace-only content (no icons — a slot is content) can't be
  // meaningfully "clipped" — truncate quietly rather than badge a card that
  // has nothing to show (review finding).
  const hasContent = segments.some(
    (segment) => segment.kind === "icon" || segment.text.trim() !== "",
  );
  if (!hasContent) {
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

/**
 * The pre-◆44 string surface, kept working: plain text in, string lines
 * out — marker-agnostic, same clip/shrink semantics (it IS the run engine
 * underneath, with each surviving line read back as its text).
 */
export function layoutTextBox(input: TextBoxLayoutInput): TextBoxLayout {
  const { text, ...rest } = input;
  const segments: MarkerSegment[] = text === "" ? [] : [{ kind: "text", text }];
  const layout = layoutTextBoxRuns({ segments, ...rest });
  return {
    lines: layout.lines.map(lineText),
    size: layout.size,
    clipped: layout.clipped,
    shrunk: layout.shrunk,
  };
}
