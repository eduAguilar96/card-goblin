/**
 * The TextBox wrap engine (DESIGN.md §3.3 TextBox row, §7.2): measurement
 * with the safety margin, greedy word-wrap with mid-word breaking, hard
 * breaks, space collapsing at break points, and the clip/shrink vertical
 * pass. Everything runs against a hand-made FAKE font whose arithmetic is
 * predictable (unitsPerEm 100; letters 100 units = 1 em each, space 50,
 * `W` 200); the REAL Geist table is covered by metrics.test.ts and the
 * end-to-end evaluator tests in generate.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { FontMetrics } from "../wrap";
import {
  SHRINK_FLOOR,
  SHRINK_STEP,
  WIDTH_SAFETY_MARGIN,
  layoutTextBox,
  measureText,
  wrapText,
} from "../wrap";

// -- the fake font -----------------------------------------------------------

/** 1 em per lowercase letter/digit, half an em per space, 2 em for `W` —
 * a font where "how many chars fit" is mental arithmetic. */
const FAKE: FontMetrics = (() => {
  const advances = new Map<number, number>();
  for (const ch of "abcdefghijklmnopqrstuvwxyz0123456789") {
    advances.set(ch.codePointAt(0) as number, 100);
  }
  advances.set(" ".codePointAt(0) as number, 50);
  advances.set("W".codePointAt(0) as number, 200);
  return { unitsPerEm: 100, fallbackAdvance: 100, advances };
})();

/** Box width that fits `text` EXACTLY (inclusive boundary) at `size` — the
 * engine's own measurement, so the fit predicate's `<=` is what's probed. */
const exactWidth = (text: string, size = 1): number => measureText(text, size, FAKE);

describe("measureText", () => {
  it("sums advances × size/unitsPerEm × the safety margin", () => {
    // 3 letters at 100 units, size 2: (300 × 2 × 1.02) / 100.
    expect(measureText("abc", 2, FAKE)).toBe((300 * 2 * WIDTH_SAFETY_MARGIN) / 100);
  });

  it("charges the fallback advance for uncovered chars", () => {
    expect(measureText("é", 1, FAKE)).toBe(measureText("a", 1, FAKE));
  });

  it("charges a surrogate PAIR one fallback advance, not two", () => {
    expect(measureText("𝄞", 1, FAKE)).toBe(measureText("a", 1, FAKE));
  });

  it("the empty string measures zero", () => {
    expect(measureText("", 1, FAKE)).toBe(0);
  });
});

describe("wrapText: basics", () => {
  it("empty text wraps to one empty line", () => {
    expect(wrapText("", 10, 1, FAKE)).toEqual([""]);
  });

  it("a single fitting word is one line", () => {
    expect(wrapText("abc", 10, 1, FAKE)).toEqual(["abc"]);
  });

  it("wraps at a space, collapsing the space run at the break", () => {
    expect(wrapText("aa bb", exactWidth("aa"), 1, FAKE)).toEqual(["aa", "bb"]);
  });

  it("a LONG space run at the break collapses whole", () => {
    expect(wrapText("aa      bb", exactWidth("aaa"), 1, FAKE)).toEqual(["aa", "bb"]);
  });

  it("interior spaces are preserved when no break lands on them", () => {
    expect(wrapText("aa  bb", 20, 1, FAKE)).toEqual(["aa  bb"]);
  });

  it("greedy: fills each line as far as words fit", () => {
    // "aa bb cc dd" at width fitting "aa bb": two per line.
    expect(wrapText("aa bb cc dd", exactWidth("aa bb"), 1, FAKE)).toEqual([
      "aa bb",
      "cc dd",
    ]);
  });

  it("leading spaces of a segment are preserved (indentation), never a break", () => {
    expect(wrapText("  aa", 20, 1, FAKE)).toEqual(["  aa"]);
  });

  it("trailing spaces are preserved (interior to no break)", () => {
    expect(wrapText("aa  ", 20, 1, FAKE)).toEqual(["aa  "]);
  });

  it("a spaces-only text stays one line of spaces", () => {
    expect(wrapText("   ", 20, 1, FAKE)).toEqual(["   "]);
  });
});

describe("wrapText: exact-fit boundary and the safety margin", () => {
  it("a word at EXACTLY the box width fits (the predicate is ≤)", () => {
    expect(wrapText("abcde", exactWidth("abcde"), 1, FAKE)).toEqual(["abcde"]);
  });

  it("one character more than exact overflows", () => {
    expect(wrapText("abcdef", exactWidth("abcde"), 1, FAKE)).toEqual(["abcde", "f"]);
  });

  it("the 2% margin is visible near-fit: 5 naive ems do NOT fit a 5-unit box", () => {
    // Without the margin "aaaaa" (5 × 1 em at size 1) would exactly fill a
    // width-5 box; the margin charges 5.1, so the wrap breaks a char early.
    expect(measureText("aaaaa", 1, FAKE)).toBeGreaterThan(5);
    expect(wrapText("aaaaa", 5, 1, FAKE)).toEqual(["aaaa", "a"]);
  });
});

describe("wrapText: mid-word breaking", () => {
  it("a single word wider than the box breaks mid-word", () => {
    expect(wrapText("abcdefgh", exactWidth("abc"), 1, FAKE)).toEqual(["abc", "def", "gh"]);
  });

  it("a one-char box yields one char per line", () => {
    expect(wrapText("abcd", exactWidth("a"), 1, FAKE)).toEqual(["a", "b", "c", "d"]);
  });

  it("a box NARROWER than one char still takes one char per line (progress)", () => {
    expect(wrapText("WW", exactWidth("a"), 1, FAKE)).toEqual(["W", "W"]);
  });

  it("after a mid-word break the remainder continues greedily with later words", () => {
    // "abcde fg" in a 3-char box: abc / de fg? "de" (2) + space + "fg" → 2+0.5+2 = 4.5 em > 3 chars… so de / fg.
    expect(wrapText("abcde fg", exactWidth("abc"), 1, FAKE)).toEqual(["abc", "de", "fg"]);
  });

  it("a word following a broken word joins the remainder's line when it fits", () => {
    expect(wrapText("abcd e", exactWidth("abc"), 1, FAKE)).toEqual(["abc", "d e"]);
  });

  it("a fully consumed mid-word break leaves NO spurious empty trailing line", () => {
    expect(wrapText("abcabc", exactWidth("abc"), 1, FAKE)).toEqual(["abc", "abc"]);
  });

  it("wrapping happens after a first word: 'aa abcdef' breaks the long word cleanly", () => {
    expect(wrapText("aa abcdef", exactWidth("aaa"), 1, FAKE)).toEqual(["aa", "abc", "def"]);
  });
});

describe("wrapText: hard breaks (§3.1 escapes / cell newlines)", () => {
  it("a newline always breaks, wrapping within each segment", () => {
    expect(wrapText("aa\nbb", 20, 1, FAKE)).toEqual(["aa", "bb"]);
  });

  it("a leading newline yields a leading empty line", () => {
    expect(wrapText("\naa", 20, 1, FAKE)).toEqual(["", "aa"]);
  });

  it("a trailing newline yields a trailing empty line", () => {
    expect(wrapText("aa\n", 20, 1, FAKE)).toEqual(["aa", ""]);
  });

  it("consecutive newlines yield empty lines between (a blank line is data)", () => {
    expect(wrapText("aa\n\nbb", 20, 1, FAKE)).toEqual(["aa", "", "bb"]);
  });

  it("a newline-only text is two empty lines", () => {
    expect(wrapText("\n", 20, 1, FAKE)).toEqual(["", ""]);
  });

  it("hard breaks and soft wraps compose: each segment wraps on its own", () => {
    expect(wrapText("aa bb\ncc dd", exactWidth("aa"), 1, FAKE)).toEqual([
      "aa",
      "bb",
      "cc",
      "dd",
    ]);
  });

  it("spaces do NOT collapse across a hard break (the newline is the break)", () => {
    // "aa \n bb": trailing space before the break and leading space after it
    // both survive — hard breaks are data, not wrap points.
    expect(wrapText("aa \n bb", 20, 1, FAKE)).toEqual(["aa ", " bb"]);
  });
});

// -- layoutTextBox -----------------------------------------------------------

/** lineHeight 1.25 at size 2 → 2.5 units per line, EXACT in binary floats,
 * so the vertical boundary tests probe the ≤ predicate, not float noise. */
const box = (over: {
  text: string;
  width?: number;
  height?: number;
  size?: number;
  lineHeight?: number;
  overflow?: "clip" | "shrink";
}) =>
  layoutTextBox({
    text: over.text,
    width: over.width ?? 100,
    height: over.height ?? 100,
    size: over.size ?? 2,
    lineHeight: over.lineHeight ?? 1.25,
    overflow: over.overflow ?? "clip",
    metrics: FAKE,
  });

describe("layoutTextBox: clip", () => {
  it("fitting text keeps its size and is neither clipped nor shrunk", () => {
    const r = box({ text: "aa\nbb", height: 5 }); // 2 lines × 2.5 = 5 ≤ 5
    expect(r).toEqual({ lines: ["aa", "bb"], size: 2, clipped: false, shrunk: false });
  });

  it("the boundary is inclusive: k lines at exactly k × lineHeight × size fit", () => {
    const r = box({ text: "a\nb\nc\nd", height: 10 }); // 4 × 2.5 = 10
    expect(r.lines).toEqual(["a", "b", "c", "d"]);
    expect(r.clipped).toBe(false);
  });

  it("one unit less clips the last line, keeping the declared size", () => {
    const r = box({ text: "a\nb\nc\nd", height: 9.5 }); // 3 × 2.5 = 7.5 ≤ 9.5 < 10
    expect(r).toEqual({ lines: ["a", "b", "c"], size: 2, clipped: true, shrunk: false });
  });

  it("a box shorter than one line clips to ZERO lines", () => {
    const r = box({ text: "aa", height: 2 }); // 2.5 > 2
    expect(r).toEqual({ lines: [], size: 2, clipped: true, shrunk: false });
  });

  it("clip counts WRAPPED lines, not source lines", () => {
    // "aa bb cc" in a 2-char box wraps to 3 lines; height fits 2.
    const r = box({ text: "aa bb cc", width: exactWidth("aa", 2), height: 5 });
    expect(r).toEqual({ lines: ["aa", "bb"], size: 2, clipped: true, shrunk: false });
  });
});

describe("layoutTextBox: shrink", () => {
  it("fitting text never shrinks", () => {
    const r = box({ text: "aa", height: 5, overflow: "shrink" });
    expect(r).toEqual({ lines: ["aa"], size: 2, clipped: false, shrunk: false });
  });

  it("takes the FIRST step that fits: purely vertical overflow → 0.95×", () => {
    // Hard-break lines: wrapping can't change the count, so only the line
    // height shrinks. 3 lines × 1.25 × size ≤ 7.2 needs size ≤ 1.92 → 0.95
    // (1.9) fits on the first step.
    const r = box({ text: "a\nb\nc", height: 7.2, overflow: "shrink" });
    expect(r).toEqual({
      lines: ["a", "b", "c"],
      size: (2 * 95) / 100,
      clipped: false,
      shrunk: true,
    });
  });

  it("converges further down when needed (0.8×) — and never below", () => {
    // 3 lines × 1.25 × size ≤ 6 needs size ≤ 1.6 = 0.8 × 2 exactly: steps
    // 0.95/0.9/0.85 fail, 0.8 fits (inclusive boundary at the step itself).
    const r = box({ text: "a\nb\nc", height: 6, overflow: "shrink" });
    expect(r).toEqual({
      lines: ["a", "b", "c"],
      size: (2 * 80) / 100,
      clipped: false,
      shrunk: true,
    });
  });

  it("re-wraps at each step: a smaller size fits more per line", () => {
    // Width fits exactly 4 chars at size 2 (800 glyph·units). "abcde" (500
    // units) overflows to two lines down through 0.85× — the height (one
    // 2-unit line) rejects every two-line attempt. At 0.8× (size 1.6),
    // 500 × 1.6 = 800 units again: "abcde" re-wraps to ONE line, and
    // 1 × 1.25 × 1.6 = 2 ≤ 2 fits. Both dimensions had to move — the
    // re-wrap at the smaller size is what unlocked the fit.
    const r = box({
      text: "abcde",
      width: exactWidth("abcd", 2),
      height: 2,
      overflow: "shrink",
    });
    expect(r.lines).toEqual(["abcde"]);
    expect(r.size).toBe((2 * 80) / 100);
    expect(r.clipped).toBe(false);
    expect(r.shrunk).toBe(true);
  });

  it("bottoms out at the floor and clips there", () => {
    // 9 hard lines can never fit 5 units: even at the floor (1.2) a line is
    // 1.5 units — 3 fit. Final: floor size, clipped AND shrunk.
    const r = box({ text: "a\nb\nc\nd\ne\nf\ng\nh\ni", height: 5, overflow: "shrink" });
    expect(r.size).toBe((2 * Math.round(SHRINK_FLOOR * 100)) / 100);
    expect(r.lines).toEqual(["a", "b", "c"]);
    expect(r.clipped).toBe(true);
    expect(r.shrunk).toBe(true);
  });

  it("the floor itself is tried (not stepped past): a floor-exact fit is clean", () => {
    // 3 lines × 1.25 × size ≤ 4.5 needs size ≤ 1.2 — exactly the 0.6 floor.
    const r = box({ text: "a\nb\nc", height: 4.5, overflow: "shrink" });
    expect(r).toEqual({
      lines: ["a", "b", "c"],
      size: (2 * 60) / 100,
      clipped: false,
      shrunk: true,
    });
  });

  it("the step ladder is 5% of the DECLARED size — 8 steps from 95% to 60%", () => {
    expect(Math.round(((1 - SHRINK_FLOOR) / SHRINK_STEP) * 100) / 100).toBe(8);
  });
});

describe("layoutTextBox: degenerate inputs stay total (never-throws ⚑8)", () => {
  it("zero/negative size wraps to one line per segment and 'fits'", () => {
    expect(box({ text: "aa bb", size: 0 }).clipped).toBe(false);
    expect(box({ text: "aa\nbb", size: -1 }).lines).toEqual(["aa", "bb"]);
  });

  it("a zero-width box makes one-char lines yet terminates", () => {
    const r = box({ text: "abc", width: 0, height: 100 });
    expect(r.lines).toEqual(["a", "b", "c"]);
  });

  it("zero height clips everything", () => {
    const r = box({ text: "aa", height: 0 });
    expect(r).toEqual({ lines: [], size: 2, clipped: true, shrunk: false });
  });

  it("NEGATIVE width degrades like width 0 — one codepoint per line, no throw (review CRITICAL)", () => {
    // Reachable from a single sheet cell (width: [w] with a -1 cell); the
    // unguarded loop used to crash and truncate every later card in the deck.
    const r = box({ text: "abc", width: -1, height: 100 });
    expect(r.lines).toEqual(["a", "b", "c"]);
    expect(r.clipped).toBe(false);
  });

  it("whitespace-only text in a too-short box truncates quietly, never badges", () => {
    expect(box({ text: "", height: 0.5 })).toMatchObject({ clipped: false, shrunk: false });
    expect(box({ text: "   ", height: 0.5 }).clipped).toBe(false);
  });
});
