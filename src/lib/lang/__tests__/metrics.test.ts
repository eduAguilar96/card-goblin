/**
 * The generated Geist metrics table (DESIGN.md §3.3 TextBox row, §7.2) —
 * sanity of the COMMITTED src/lib/lang/geist-metrics.ts, and the
 * dicier-codes-pattern guarantee that regenerating from the font is
 * byte-identical (sorted, no timestamps): the committed file can never
 * drift from what the script would produce.
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
import { GEIST_METRICS } from "../wrap";

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

describe("regeneration is byte-identical", () => {
  it("running the generator reproduces the committed file exactly", () => {
    const root = fileURLToPath(new URL("../../../..", import.meta.url));
    const committed = readFileSync(join(root, "src/lib/lang/geist-metrics.ts"), "utf8");
    const dir = mkdtempSync(join(tmpdir(), "geist-metrics-"));
    try {
      const out = join(dir, "regen.ts");
      execFileSync(process.execPath, [join(root, "scripts/generate-geist-metrics.mjs"), out], {
        stdio: "pipe",
      });
      expect(readFileSync(out, "utf8")).toBe(committed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
