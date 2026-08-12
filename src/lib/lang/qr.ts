/**
 * QR encoding wrapper (DESIGN.md §7.1a) — the ONLY file in the codebase that
 * imports `qrcode-generator` (the second sanctioned runtime dependency,
 * zero-dep MIT). Everything outside this module sees `encodeQr` only: a
 * pure, deterministic `(data, level) → matrix | null` function, called at
 * EVAL time (the wrap.ts precedent — the compiler is the encoding
 * authority, so the model carries the resolved module matrix and the
 * renderer only draws).
 *
 * UTF-8 byte mode (§7.1a "Semantics"): the library's default byte encoder
 * just masks each char code to `& 0xff`, which mangles anything outside
 * Latin-1. Its README documents `stringToBytes` as overridable for exactly
 * this ("Overwrite this function to encode using a multibyte charset"), but
 * the packaged CJS and ESM builds disagree on how — only the CJS build
 * ships a ready-made `stringToBytesFuncs['UTF-8']`. `TextEncoder` is the
 * standard, build-independent way to get the same bytes, so it's used
 * directly here instead of depending on that internal split. Installed
 * once at module load, before any QR is ever built, so every encoding in
 * the process uses it.
 */

import qrcode from "qrcode-generator";

qrcode.stringToBytes = (s: string): number[] => Array.from(new TextEncoder().encode(s));

/** `level:` vocabulary (§7.1a), lowercase per the language's bare-identifier
 * convention — mapped below to the library's own L/M/Q/H. */
export const QR_LEVELS = ["l", "m", "q", "h"] as const;
export type QrLevel = (typeof QR_LEVELS)[number];

const LIBRARY_LEVEL: Record<QrLevel, "L" | "M" | "Q" | "H"> = {
  l: "L",
  m: "M",
  q: "Q",
  h: "H",
};

export interface QrEncoding {
  /** Modules per side — one of the legal QR sizes, 21 + 4k (k = 0..39). */
  moduleCount: number;
  /** Row-major "1" (dark) / "0" (light) string, length moduleCount². The
   * quiet zone is NOT included — the renderer draws it (§7.1a). */
  modules: string;
}

/**
 * Encode `data` at `level`, no caching — the real work. `null` when `data`
 * exceeds the level's capacity even at the largest version (40) — the
 * library throws a bare string (or, conceivably, some other internal
 * fault) on overflow. Every throw here is caught and reported as capacity
 * exhaustion (D009 at the call site): that mislabels a hypothetical
 * non-capacity library fault too, but the alternative — letting anything
 * unexpected propagate — has a worse failure mode. The wrap.ts (TextBox)
 * engine review found exactly this class of bug: a non-DataError throw
 * from inside one element's evaluation degrades the WHOLE deck (or a whole
 * Card's worth of instances) to an internal-error placeholder instead of
 * isolating the one bad card, because nothing between here and the
 * generator's per-Card catch is DataError-aware. A bounded, per-card blast
 * radius (one placeholder, wrong code but still isolated) beats deck
 * truncation.
 */
function encodeQrUncached(data: string, level: QrLevel): QrEncoding | null {
  try {
    const qr = qrcode(0, LIBRARY_LEVEL[level]);
    qr.addData(data, "Byte");
    qr.make();
    const moduleCount = qr.getModuleCount();
    let modules = "";
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        modules += qr.isDark(row, col) ? "1" : "0";
      }
    }
    return { moduleCount, modules };
  } catch {
    return null;
  }
}

/**
 * Memoization (adversarial review, 2026-08-11): the canonical §7.1a idiom
 * puts the SAME `data:`/`level:` on every card's back (`data: [code]` reads
 * a different cell per card, but a fixed-content QR — a logo, a URL that
 * doesn't vary — re-encodes identically on every one of N cards per
 * compile). Keyed on `level + "\0" + data` (a level letter never collides
 * with a NUL byte a real data string might contain). Capped at 1000
 * entries; on overflow the WHOLE map is cleared rather than evicting one
 * entry — deterministic, no LRU bookkeeping, and 1000 distinct QR bodies in
 * one deck is already an unusual document. `null` results (capacity
 * failures) are cached too, so a broken row doesn't re-attempt encoding on
 * every reference.
 */
const CACHE_LIMIT = 1000;
const cache = new Map<string, QrEncoding | null>();

/** Test-observable hit count — a deterministic, portable alternative to a
 * wall-clock CI assertion for proving the cache actually short-circuits
 * re-encoding. Reset alongside the cache by `resetQrCacheForTests`. */
let cacheHits = 0;

/** Test seam: how many `encodeQr` calls were served from the cache since
 * the last reset (or process start). */
export function qrCacheHitsForTests(): number {
  return cacheHits;
}

/** Test seam: forget every cached encoding and zero the hit counter, so
 * cases don't leak into each other. */
export function resetQrCacheForTests(): void {
  cache.clear();
  cacheHits = 0;
}

/**
 * Encode `data` as a QR code at the given error-correction level. Pure and
 * deterministic: the same (data, level) always produces an identical
 * matrix (memoized — see above), and typeNumber 0 (auto) picks the
 * smallest version that fits. Never throws (⚑8, mirroring every other pure
 * compiler step's never-throws contract) — see `encodeQrUncached`.
 */
export function encodeQr(data: string, level: QrLevel): QrEncoding | null {
  const key = level + "\0" + data;
  const cached = cache.get(key);
  if (cached !== undefined) {
    cacheHits++;
    return cached;
  }
  const result = encodeQrUncached(data, level);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}
