// Regenerates src/lib/lang/geist-metrics.ts from src/app/fonts/GeistVF.woff —
// the glyph-advance table the TextBox wrap engine measures against
// (docs/DESIGN.md §3.3 TextBox row, §7.2: "the compiler is the wrapping
// authority"; the dicier-codes generation pattern).
//
// DEPENDENCY CHOICE (documented per the M3 plan): NO dependency — not even a
// dev-only one. GeistVF.woff is WOFF1, which is just an sfnt (TrueType) whose
// tables are individually zlib-compressed, and node ships zlib. The four
// tables we need are trivially fixed-layout (`head` for unitsPerEm, `maxp`
// for numGlyphs, `hhea` for numberOfHMetrics, `hmtx` for the advances) plus
// `cmap` formats 4/12 for codepoint → glyph. opentype.js or fontkit would
// parse all of that too, but each drags in a full font stack (and its own
// output quirks) for ~120 lines of DataView reads; hand-rolling keeps the
// generator dependency-free, deterministic, and auditable. Nothing here is
// imported by shipped code — only the generated .ts file is.
//
// GeistVF is a VARIABLE font; hmtx carries the default instance's advances,
// which is exactly what next/font renders at the default weight the app uses.
//
// Generated file format (compact, deterministic — regeneration is
// byte-identical: codepoints sorted ascending, no timestamps):
// - GEIST_UNITS_PER_EM: number.
// - GEIST_FALLBACK_ADVANCE: number — the rounded mean advance over all mapped
//   BMP codepoints; what the wrap engine charges for uncovered characters.
// - an encoded advances string: one entry per covered BMP codepoint, sorted;
//   each entry is `<codepoint delta from previous, base36>.<advance in font
//   units, base36>`, entries joined by ",". Delta + base36 keeps the file a
//   fraction of a JSON record's size; the module decodes it into a
//   ReadonlyMap at load.
//
// Output path may be overridden with argv[2] (the byte-identical
// regeneration test writes to a scratch file and compares).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src/app/fonts/GeistVF.woff");
const target = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : join(root, "src/lib/lang/geist-metrics.ts");

// -- WOFF1 container (https://www.w3.org/TR/WOFF/) ---------------------------

const woff = readFileSync(source);
const dv = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
if (dv.getUint32(0) !== 0x774f4646) throw new Error("not a WOFF1 file (wOFF magic missing)");
const numTables = dv.getUint16(12);

/** table tag → decompressed table bytes (as DataView). */
const tables = new Map();
for (let i = 0; i < numTables; i++) {
  const off = 44 + i * 20; // WOFF header is 44 bytes; dir entries 20
  const tag = String.fromCharCode(
    dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3),
  );
  const dataOffset = dv.getUint32(off + 4);
  const compLength = dv.getUint32(off + 8);
  const origLength = dv.getUint32(off + 12);
  const raw = woff.subarray(dataOffset, dataOffset + compLength);
  const bytes = compLength < origLength ? inflateSync(raw) : raw;
  if (bytes.length !== origLength) throw new Error(`table ${tag}: bad decompressed length`);
  tables.set(tag, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

function table(tag) {
  const t = tables.get(tag);
  if (!t) throw new Error(`font has no ${tag} table`);
  return t;
}

// -- sfnt tables -------------------------------------------------------------

const unitsPerEm = table("head").getUint16(18);
const numGlyphs = table("maxp").getUint16(4);
const numberOfHMetrics = table("hhea").getUint16(34);

/** glyph id → advance width in font units (glyphs past numberOfHMetrics
 * share the last explicit advance — the sfnt monospace-tail rule). */
const hmtx = table("hmtx");
const advanceOfGlyph = (gid) => {
  const i = Math.min(gid, numberOfHMetrics - 1);
  return hmtx.getUint16(i * 4);
};

// cmap: prefer the (3,10) full-Unicode subtable, else (3,1) BMP, else any
// format-4/12 subtable. We only keep BMP codepoints either way.
const cmap = table("cmap");
const subtables = [];
for (let i = 0; i < cmap.getUint16(2); i++) {
  subtables.push({
    platform: cmap.getUint16(4 + i * 8),
    encoding: cmap.getUint16(6 + i * 8),
    offset: cmap.getUint32(8 + i * 8),
  });
}
const pick =
  subtables.find((s) => s.platform === 3 && s.encoding === 10) ??
  subtables.find((s) => s.platform === 3 && s.encoding === 1) ??
  subtables.find((s) => [4, 12].includes(cmap.getUint16(s.offset)));
if (!pick) throw new Error("no usable cmap subtable (need format 4 or 12)");

/** BMP codepoint → glyph id. */
const glyphOf = new Map();
const format = cmap.getUint16(pick.offset);
if (format === 4) {
  const base = pick.offset;
  const segCount = cmap.getUint16(base + 6) / 2;
  const endsAt = base + 14;
  const startsAt = endsAt + segCount * 2 + 2; // +2: reservedPad
  const deltasAt = startsAt + segCount * 2;
  const rangesAt = deltasAt + segCount * 2;
  for (let seg = 0; seg < segCount; seg++) {
    const end = cmap.getUint16(endsAt + seg * 2);
    const start = cmap.getUint16(startsAt + seg * 2);
    const delta = cmap.getInt16(deltasAt + seg * 2);
    const rangeOffset = cmap.getUint16(rangesAt + seg * 2);
    if (start === 0xffff) continue; // the required terminator segment
    for (let cp = start; cp <= end; cp++) {
      let gid;
      if (rangeOffset === 0) {
        gid = (cp + delta) & 0xffff;
      } else {
        // The infamous format-4 self-relative glyphId array.
        const at = rangesAt + seg * 2 + rangeOffset + (cp - start) * 2;
        const g = cmap.getUint16(at);
        gid = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (gid !== 0 && gid < numGlyphs) glyphOf.set(cp, gid);
    }
  }
} else if (format === 12) {
  const base = pick.offset;
  const nGroups = cmap.getUint32(base + 12);
  for (let g = 0; g < nGroups; g++) {
    const at = base + 16 + g * 12;
    const start = cmap.getUint32(at);
    const end = cmap.getUint32(at + 4);
    const startGid = cmap.getUint32(at + 8);
    for (let cp = start; cp <= end; cp++) {
      if (cp > 0xffff) break; // BMP only — the wrap engine's contract
      const gid = startGid + (cp - start);
      if (gid !== 0 && gid < numGlyphs) glyphOf.set(cp, gid);
    }
  }
} else {
  throw new Error(`unsupported cmap format ${format}`);
}

// -- encode ------------------------------------------------------------------

const codepoints = [...glyphOf.keys()].sort((a, b) => a - b);
if (codepoints.length === 0) throw new Error("cmap mapped zero BMP codepoints");
let sum = 0;
const entries = [];
let prev = 0;
for (const cp of codepoints) {
  const advance = advanceOfGlyph(glyphOf.get(cp));
  sum += advance;
  entries.push(`${(cp - prev).toString(36)}.${advance.toString(36)}`);
  prev = cp;
}
const fallback = Math.round(sum / codepoints.length);

// Wrap the packed string at ~100 chars per line so the file diffs sanely.
const packed = entries.join(",");
const lines = [];
for (let i = 0; i < packed.length; i += 100) lines.push(packed.slice(i, i + 100));

writeFileSync(
  target,
  `// Generated by scripts/generate-geist-metrics.mjs — do not edit by hand.
// Advance widths of GeistVF.woff's ${codepoints.length} covered BMP codepoints, in font units
// (unitsPerEm ${unitsPerEm}) — the TextBox wrap engine's measuring stick (DESIGN.md §3.3).
// Encoding: "<codepoint delta base36>.<advance base36>" entries joined by ",",
// codepoints ascending — decoded into a Map at module load.

export const GEIST_UNITS_PER_EM = ${unitsPerEm};

/** Mean advance over the covered codepoints — charged for uncovered chars. */
export const GEIST_FALLBACK_ADVANCE = ${fallback};

const PACKED =
${lines.map((l) => `  "${l}"`).join(" +\n")};

function decode(packed: string): ReadonlyMap<number, number> {
  const map = new Map<number, number>();
  let cp = 0;
  for (const entry of packed.split(",")) {
    const dot = entry.indexOf(".");
    cp += parseInt(entry.slice(0, dot), 36);
    map.set(cp, parseInt(entry.slice(dot + 1), 36));
  }
  return map;
}

/** BMP codepoint → advance width in font units. */
export const GEIST_ADVANCES: ReadonlyMap<number, number> = decode(PACKED);
`,
);
console.log(
  `Wrote ${codepoints.length} advances (unitsPerEm ${unitsPerEm}, fallback ${fallback}) to ${target}`,
);
