/**
 * The generated font metrics tables (DESIGN.md §3.3 TextBox row, font: row,
 * §7.2, ◆41) — sanity of the COMMITTED src/lib/lang/geist-metrics.ts AND
 * font-metrics.ts, and the dicier-codes-pattern guarantee that regenerating
 * from the fonts is byte-identical (sorted, no timestamps): the committed
 * files can never drift from what scripts/generate-font-metrics.mjs would
 * produce.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GEIST_ADVANCES,
  GEIST_FALLBACK_ADVANCE,
  GEIST_UNITS_PER_EM,
} from "../geist-metrics";
import { FONT_METRICS, type BundledFontFace } from "../font-metrics";
import { FONT_FACES } from "../model";
import { GEIST_METRICS, metricsForFace } from "../wrap";

const cp = (ch: string): number => ch.codePointAt(0) as number;
const adv = (ch: string): number => GEIST_ADVANCES.get(cp(ch)) as number;

describe("geist-metrics sanity", () => {
  it("unitsPerEm is Geist's 1000", () => {
    expect(GEIST_UNITS_PER_EM).toBe(1000);
  });

  it("covers all of printable ASCII — the wrap engine's bread and butter", () => {
    for (let c = 0x20; c <= 0x7e; c++) {
      expect(GEIST_ADVANCES.has(c), `U+${c.toString(16)} missing`).toBe(true);
    }
  });

  it("every advance is a non-negative integer in font units, within one em-ish", () => {
    expect(GEIST_ADVANCES.size).toBeGreaterThan(500);
    for (const [c, a] of GEIST_ADVANCES) {
      expect(Number.isInteger(a), `U+${c.toString(16)}`).toBe(true);
      // Combining marks (U+0300…) legitimately advance ZERO — an accent
      // doesn't move the pen, and summing 0 for them is exactly what the
      // wrap engine wants for decomposed text like "café".
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(3 * GEIST_UNITS_PER_EM);
    }
    // Zero must stay the combining-mark exception, not the norm.
    const zeros = [...GEIST_ADVANCES.values()].filter((a) => a === 0).length;
    expect(zeros).toBeLessThan(GEIST_ADVANCES.size / 20);
  });

  it("common-char advances are proportionally plausible (i < a < m; space narrow)", () => {
    expect(adv("i")).toBeLessThan(adv("a"));
    expect(adv("a")).toBeLessThan(adv("m"));
    expect(adv("l")).toBeLessThan(adv("W"));
    expect(adv(" ")).toBeLessThan(GEIST_UNITS_PER_EM / 2);
    expect(adv(" ")).toBeGreaterThan(GEIST_UNITS_PER_EM / 10);
  });

  it("the fallback is the rounded mean over the covered codepoints", () => {
    let sum = 0;
    for (const a of GEIST_ADVANCES.values()) sum += a;
    expect(GEIST_FALLBACK_ADVANCE).toBe(Math.round(sum / GEIST_ADVANCES.size));
  });

  it("GEIST_METRICS packages exactly these constants for the wrap engine", () => {
    expect(GEIST_METRICS.unitsPerEm).toBe(GEIST_UNITS_PER_EM);
    expect(GEIST_METRICS.fallbackAdvance).toBe(GEIST_FALLBACK_ADVANCE);
    expect(GEIST_METRICS.advances).toBe(GEIST_ADVANCES);
  });
});

// ---------------------------------------------------------------------------
// The eight ◆41 bundled Text/TextBox faces (font-metrics.ts)
// ---------------------------------------------------------------------------

describe("font-metrics sanity (◆41)", () => {
  it("covers exactly the non-geist FONT_FACES — the vocabulary and the generated table agree", () => {
    // font-metrics.ts is generated and imports nothing (see its header
    // comment) — this is the drift guard that stands in for a type-level
    // check: BundledFontFace can't itself be compared to FONT_FACES at
    // runtime, so the guard is the key SET both agree on.
    const bundled: readonly BundledFontFace[] = [
      "garamond",
      "garamond_bold",
      "garamond_italic",
      "garamond_bold_italic",
      "courier",
      "courier_bold",
      "courier_italic",
      "courier_bold_italic",
    ];
    expect(Object.keys(FONT_METRICS).sort()).toEqual([...bundled].sort());
    expect(FONT_FACES.filter((f) => f !== "geist").sort()).toEqual([...bundled].sort());
  });

  it("every face covers printable ASCII with plausible, non-negative advances", () => {
    for (const [token, metrics] of Object.entries(FONT_METRICS)) {
      for (let c = 0x20; c <= 0x7e; c++) {
        expect(metrics.advances.has(c), `${token}: U+${c.toString(16)} missing`).toBe(true);
      }
      const space = metrics.advances.get(0x20) as number;
      const capA = metrics.advances.get(0x41) as number; // 'A'
      expect(space, token).toBeGreaterThan(0);
      expect(space, token).toBeLessThan(metrics.unitsPerEm);
      expect(capA, token).toBeGreaterThan(0);
      for (const a of metrics.advances.values()) {
        expect(Number.isInteger(a), token).toBe(true);
        expect(a, token).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("the fallback advance is the rounded mean over each face's covered codepoints", () => {
    for (const [token, metrics] of Object.entries(FONT_METRICS)) {
      let sum = 0;
      for (const a of metrics.advances.values()) sum += a;
      expect(metrics.fallbackAdvance, token).toBe(Math.round(sum / metrics.advances.size));
    }
  });

  it("ascent is hhea ascender / unitsPerEm — a plausible fraction of the em, and shared within a family", () => {
    for (const [token, metrics] of Object.entries(FONT_METRICS)) {
      expect(metrics.ascent, token).toBeGreaterThan(0.5);
      expect(metrics.ascent, token).toBeLessThan(1.2);
    }
    // The four weights/styles of one typeface share one hhea vertical
    // metrics design (same drawing board) — their ascent should agree.
    expect(FONT_METRICS.garamond.ascent).toBe(FONT_METRICS.garamond_bold.ascent);
    expect(FONT_METRICS.garamond.ascent).toBe(FONT_METRICS.garamond_italic.ascent);
    expect(FONT_METRICS.garamond.ascent).toBe(FONT_METRICS.garamond_bold_italic.ascent);
    expect(FONT_METRICS.courier.ascent).toBe(FONT_METRICS.courier_bold.ascent);
    expect(FONT_METRICS.courier.ascent).toBe(FONT_METRICS.courier_italic.ascent);
    expect(FONT_METRICS.courier.ascent).toBe(FONT_METRICS.courier_bold_italic.ascent);
  });

  it("Courier Prime is monospace: every NON-COMBINING covered codepoint shares one advance", () => {
    // Same combining-mark exception as Geist's (metrics.test.ts above): a
    // handful of codepoints (e.g. U+0326 COMBINING COMMA BELOW) legitimately
    // advance ZERO even in a monospace font — an accent doesn't move the pen.
    const { advances } = FONT_METRICS.courier;
    const widths = new Set([...advances.values()].filter((a) => a !== 0));
    expect(widths.size).toBe(1);
    const zeros = [...advances.values()].filter((a) => a === 0).length;
    expect(zeros).toBeLessThan(advances.size / 20); // exception, not the norm
  });

  it("metricsForFace routes geist to GEIST_METRICS and every other token to its generated table", () => {
    expect(metricsForFace("geist")).toBe(GEIST_METRICS);
    for (const face of FONT_FACES) {
      if (face === "geist") continue;
      const metrics = metricsForFace(face);
      expect(metrics.unitsPerEm).toBe(FONT_METRICS[face as BundledFontFace].unitsPerEm);
      expect(metrics.advances).toBe(FONT_METRICS[face as BundledFontFace].advances);
    }
  });
});

// ---------------------------------------------------------------------------
// Byte-identical regeneration (both generated files)
// ---------------------------------------------------------------------------

describe("regeneration is byte-identical", () => {
  it("running the generator reproduces both committed files exactly", () => {
    const root = fileURLToPath(new URL("../../../..", import.meta.url));
    const committedGeist = readFileSync(join(root, "src/lib/lang/geist-metrics.ts"), "utf8");
    const committedFonts = readFileSync(join(root, "src/lib/lang/font-metrics.ts"), "utf8");
    const dir = mkdtempSync(join(tmpdir(), "font-metrics-"));
    try {
      execFileSync(process.execPath, [join(root, "scripts/generate-font-metrics.mjs"), dir], {
        stdio: "pipe",
      });
      expect(readFileSync(join(dir, "geist-metrics.ts"), "utf8")).toBe(committedGeist);
      expect(readFileSync(join(dir, "font-metrics.ts"), "utf8")).toBe(committedFonts);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
