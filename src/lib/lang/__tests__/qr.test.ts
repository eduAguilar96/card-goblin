/**
 * QR encoding (DESIGN.md §7.1a): determinism, capacity, and STRUCTURAL
 * validation of the real encoding — the finder patterns and timing pattern
 * every QR code carries, independent of any external decoder.
 */
import { describe, expect, it } from "vitest";
import { encodeQr, QR_LEVELS, qrCacheHitsForTests, resetQrCacheForTests } from "../qr";

describe("encodeQr — determinism and capacity", () => {
  it("the same (data, level) always produces the identical matrix", () => {
    const a = encodeQr("https://cardgoblin.app/c/abc123", "m");
    const b = encodeQr("https://cardgoblin.app/c/abc123", "m");
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });

  it("different data produces a different matrix", () => {
    const a = encodeQr("https://cardgoblin.app/c/abc123", "m");
    const b = encodeQr("https://cardgoblin.app/c/xyz789", "m");
    expect(a?.modules).not.toBe(b?.modules);
  });

  it("different level produces a different matrix for the same data", () => {
    const data = "https://cardgoblin.app/c/abc123";
    const l = encodeQr(data, "l");
    const h = encodeQr(data, "h");
    expect(l).not.toBeNull();
    expect(h).not.toBeNull();
    // Higher redundancy generally needs more modules (or at least a
    // different mask/data layout) for the same content.
    expect(l?.modules).not.toBe(h?.modules);
  });

  it("moduleCount is always a legal QR size: 21 + 4k", () => {
    for (const level of QR_LEVELS) {
      const enc = encodeQr("some reasonably sized payload " + level, level)!;
      expect(enc).not.toBeNull();
      expect((enc.moduleCount - 21) % 4).toBe(0);
      expect(enc.moduleCount).toBeGreaterThanOrEqual(21);
      expect(enc.moduleCount).toBeLessThanOrEqual(177); // version 40
      expect(enc.modules).toHaveLength(enc.moduleCount ** 2);
    }
  });

  it("data exceeding capacity even at the largest version (level h) → null", () => {
    const huge = "x".repeat(3000);
    expect(encodeQr(huge, "h")).toBeNull();
  });

  it("a data string that fits comfortably at low redundancy is non-null", () => {
    expect(encodeQr("short", "l")).not.toBeNull();
  });

  it("empty string encodes normally — a valid tiny QR, no special case", () => {
    const enc = encodeQr("", "m");
    expect(enc).not.toBeNull();
    expect(enc?.moduleCount).toBeGreaterThanOrEqual(21);
    expect(enc?.modules).toMatch(/^[01]+$/);
  });
});

// ---------------------------------------------------------------------------
// Memoization (adversarial review, 2026-08-11): the canonical §7.1a idiom is
// the SAME data/level on every card's back, so re-encoding must be cheap.
// Cache-hit counter, not a wall-clock bound — deterministic across CI
// machines instead of a "generous" timing margin that could still flake.
// ---------------------------------------------------------------------------

describe("encodeQr — memoization", () => {
  it("500 identical (data, level) calls are 1 miss + 499 hits; 500 distinct calls are all misses", () => {
    resetQrCacheForTests();
    const fixed = "https://cardgoblin.app/fixed-logo";
    for (let i = 0; i < 500; i++) encodeQr(fixed, "m");
    expect(qrCacheHitsForTests()).toBe(499);

    resetQrCacheForTests();
    for (let i = 0; i < 500; i++) encodeQr(`${fixed}/${i}`, "m");
    expect(qrCacheHitsForTests()).toBe(0);
  });

  it("caches null (capacity-overflow) results too — a broken row isn't re-encoded on every reference", () => {
    resetQrCacheForTests();
    const huge = "x".repeat(3000);
    expect(encodeQr(huge, "h")).toBeNull();
    expect(encodeQr(huge, "h")).toBeNull();
    expect(qrCacheHitsForTests()).toBe(1);
  });

  it("different level is a different cache key, even for identical data", () => {
    resetQrCacheForTests();
    encodeQr("same data", "l");
    encodeQr("same data", "h");
    expect(qrCacheHitsForTests()).toBe(0);
  });

  it("overflow past 1000 distinct entries clears the whole map (no partial LRU eviction)", () => {
    resetQrCacheForTests();
    for (let i = 0; i < 1000; i++) encodeQr(`seed-${i}`, "m");
    // The cache is exactly at the 1000 cap; the next DISTINCT key clears it
    // before inserting, so every earlier seed is now a fresh miss again.
    encodeQr("seed-1000", "m");
    encodeQr("seed-0", "m");
    expect(qrCacheHitsForTests()).toBe(0);
    resetQrCacheForTests();
  });
});

// ---------------------------------------------------------------------------
// Structural validation: real QR geometry, not just noise
// ---------------------------------------------------------------------------

describe("encodeQr — structural validation (finder + timing patterns)", () => {
  const enc = encodeQr("https://cardgoblin.app/scan", "m")!;
  const n = enc.moduleCount;
  const at = (row: number, col: number): boolean => enc.modules[row * n + col] === "1";

  /** The standard QR finder shape, checked against a 7×7 window: outer ring
   * dark, next ring light, solid 3×3 center dark — the same geometry every
   * QR code carries at all three probe corners, per the spec. */
  function isFinderDark(r: number, c: number): boolean {
    return r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
  }

  function checkFinder(originRow: number, originCol: number): void {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        expect(at(originRow + r, originCol + c), `corner (${originRow},${originCol}) @ ${r},${c}`).toBe(
          isFinderDark(r, c),
        );
      }
    }
  }

  it("encodes at least version 2 (25 modules) for this payload — corners are unambiguous", () => {
    expect(n).toBeGreaterThanOrEqual(25);
  });

  it("the three finder patterns (top-left, top-right, bottom-left) are the standard 7×7 shape", () => {
    checkFinder(0, 0);
    checkFinder(0, n - 7);
    checkFinder(n - 7, 0);
  });

  it("the timing pattern alternates dark/light between the finders, on row 6 and column 6", () => {
    for (let col = 8; col <= n - 9; col++) {
      expect(at(6, col), `row 6, col ${col}`).toBe(col % 2 === 0);
    }
    for (let row = 8; row <= n - 9; row++) {
      expect(at(row, 6), `row ${row}, col 6`).toBe(row % 2 === 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Frozen known-answer matrix (adversarial review, 2026-08-11)
// ---------------------------------------------------------------------------
//
// The finder/timing checks above are symmetric under transposition — a
// probe that swapped isDark(col, row) for isDark(row, col) still passed the
// whole structural suite, because finder patterns and the timing pattern
// are themselves symmetric shapes. Only a full, frozen matrix (every
// module, not just the structural landmarks) catches that class of bug, or
// any mask-selection / data-placement drift. The frozen string below was
// independently jsQR-decoded back to "HELLO" during adversarial review.

// frozen known-answer matrix — validated by independent jsQR decode during
// adversarial review (2026-08-11); catches transposition/mask drift
const HELLO_M_MODULES =
  "111111100001001111111100000100010101000001101110101100001011101101110101010101011101101110101100101011101100000101111001000001111111101010101111111000000001100000000000101111100011001111100011011010111111001100001111101000101101110011010000111111001100010111111000100100101000000001010100101000111111100111010010110100000101010000111110101110101101010010110101110101101111101000101110101100101100100100000100111111011100111111101100100010110";

describe("encodeQr — frozen known-answer matrix", () => {
  it('encodes "HELLO" at level m to the exact, independently-decoded matrix', () => {
    const enc = encodeQr("HELLO", "m")!;
    expect(enc.moduleCount).toBe(21);
    expect(enc.modules).toHaveLength(441);
    expect(enc.modules).toBe(HELLO_M_MODULES);
  });
});
