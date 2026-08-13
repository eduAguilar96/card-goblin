// Regenerates src/lib/lang/geist-metrics.ts and src/lib/lang/font-metrics.ts
// — the glyph-advance tables the TextBox wrap engine measures against
// (docs/DESIGN.md §3.3 TextBox row, font: row, §7.2, ◆41).
//
// RENAMED (M3, font: property) from generate-geist-metrics.mjs: the script
// now parses TWO sfnt container formats —
//   - WOFF1 (GeistVF.woff): the table directory's entries are individually
//     zlib-compressed; node's zlib inflates them.
//   - bare TTF/OTF (the eight bundled Text/TextBox faces, ◆41): actually
//     EASIER than WOFF — the table directory is uncompressed, so table
//     bytes are a plain subarray, no zlib step at all.
// Both formats share the same table CONTENTS once unwrapped (`head` for
// unitsPerEm, `maxp` for numGlyphs, `hhea` for numberOfHMetrics + the
// ascender this script now also reads, `hmtx` for advances, `cmap` formats
// 4/12 for codepoint → glyph) — so `readFontTables` below dispatches on the
// file's magic number, and every table-level reader below it is shared.
//
// DEPENDENCY CHOICE (unchanged from the original Geist-only script): NO
// dependency — not even a dev-only one. opentype.js or fontkit would parse
// all of this too, but each drags in a full font stack (and its own output
// quirks) for ~150 lines of DataView reads; hand-rolling keeps the generator
// dependency-free, deterministic, and auditable. Nothing here is imported by
// shipped code — only the two generated .ts files are.
//
// GeistVF is a VARIABLE font; hmtx carries the default instance's advances,
// which is exactly what next/font renders at the default weight the app
// uses. The eight bundled faces are static (one weight/style each, ◆41), so
// their hmtx is unambiguous.
//
// OUTPUT — two files, kept SEPARATE deliberately:
//   - geist-metrics.ts: UNCHANGED format/content from before this script was
//     renamed — same three exports (GEIST_UNITS_PER_EM, GEIST_FALLBACK_ADVANCE,
//     GEIST_ADVANCES), byte-identical regeneration still holds. Geist does
//     NOT get a generated `ascent` — cardSvg.tsx's TEXT_ASCENT stays a
//     hand-tuned visual constant (DESIGN.md §3.4 m10), deliberately not
//     derived from hhea (see cardSvg.tsx's ascentOf for the documented
//     inconsistency).
//   - font-metrics.ts: NEW, one module for the eight ◆41 faces, each entry
//     covering the same shape as geist-metrics.ts's exports PLUS `ascent`
//     (hhea ascender / unitsPerEm) — cardSvg.tsx uses this one directly,
//     since these faces have no hand-tuned constant to preserve. A single
//     shared `decode()` (defined once in the emitted file) keeps eight
//     packed tables from repeating that boilerplate eight times.
// Both use the SAME compact encoding as the original script (delta +
// base36 pairs, sorted ascending, no timestamps — regeneration is
// byte-identical): "<codepoint delta from previous, base36>.<advance in
// font units, base36>" entries joined by ",".
//
// CLI: `node scripts/generate-font-metrics.mjs [outDir]` — outDir defaults
// to src/lib/lang/; both files are written there under their fixed
// basenames. An override directory (argv[2]) is what the byte-identical
// regeneration test (metrics.test.ts) uses — writes to a scratch dir and
// diffs both files against the committed ones.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fontsDir = join(root, "src/app/fonts");
const outDir = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : join(root, "src/lib/lang");

// ---------------------------------------------------------------------------
// sfnt containers — WOFF1 and bare TTF/OTF, unified to tag → DataView
// ---------------------------------------------------------------------------

function tagAt(dv, off) {
  return String.fromCharCode(
    dv.getUint8(off),
    dv.getUint8(off + 1),
    dv.getUint8(off + 2),
    dv.getUint8(off + 3),
  );
}

/** WOFF1 (https://www.w3.org/TR/WOFF/): 44-byte header, 20-byte dir entries,
 * each table individually zlib-compressed when compLength < origLength. */
function readWoff1Tables(bytes, dv) {
  const numTables = dv.getUint16(12);
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const off = 44 + i * 20;
    const tag = tagAt(dv, off);
    const dataOffset = dv.getUint32(off + 4);
    const compLength = dv.getUint32(off + 8);
    const origLength = dv.getUint32(off + 12);
    const raw = bytes.subarray(dataOffset, dataOffset + compLength);
    const tableBytes = compLength < origLength ? inflateSync(raw) : raw;
    if (tableBytes.length !== origLength) {
      throw new Error(`table ${tag}: bad decompressed length`);
    }
    tables.set(tag, new DataView(tableBytes.buffer, tableBytes.byteOffset, tableBytes.byteLength));
  }
  return tables;
}

/** Bare sfnt (TrueType `\x00\x01\x00\x00`, or OpenType/CFF `OTTO`): a
 * 12-byte header then 16-byte dir entries, tables UNCOMPRESSED — easier than
 * WOFF, since each table is just a subarray of the file (no zlib step). */
function readSfntTables(bytes, dv) {
  const numTables = dv.getUint16(4);
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tag = tagAt(dv, off);
    const tableOffset = dv.getUint32(off + 8);
    const length = dv.getUint32(off + 12);
    const tableBytes = bytes.subarray(tableOffset, tableOffset + length);
    tables.set(tag, new DataView(tableBytes.buffer, tableBytes.byteOffset, tableBytes.byteLength));
  }
  return tables;
}

const WOFF1_MAGIC = 0x774f4646; // 'wOFF'
const SFNT_TRUETYPE = 0x00010000;
const SFNT_OTTO = 0x4f54544f; // 'OTTO' — CFF-based OpenType (not used by our faces, handled for completeness)

/** tag → decompressed/unwrapped table bytes, dispatching on the file's magic
 * number — the one place format detection happens. */
function readFontTables(path) {
  const bytes = readFileSync(path);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint32(0);
  if (magic === WOFF1_MAGIC) return readWoff1Tables(bytes, dv);
  if (magic === SFNT_TRUETYPE || magic === SFNT_OTTO) return readSfntTables(bytes, dv);
  throw new Error(`${path}: not a WOFF1 or TrueType/OpenType sfnt file (magic 0x${magic.toString(16)})`);
}

// ---------------------------------------------------------------------------
// sfnt tables → { unitsPerEm, ascender, advanceOfGlyph, glyphOf } — shared by
// every face regardless of container format
// ---------------------------------------------------------------------------

function extractFontMetrics(tables, label) {
  const table = (tag) => {
    const t = tables.get(tag);
    if (!t) throw new Error(`${label}: font has no ${tag} table`);
    return t;
  };

  const unitsPerEm = table("head").getUint16(18);
  const numGlyphs = table("maxp").getUint16(4);
  const numberOfHMetrics = table("hhea").getUint16(34);
  // NEW (◆41): the ascender, for the font: faces' generated `ascent` — Geist
  // deliberately keeps its own hand-tuned TEXT_ASCENT instead (see this
  // script's header comment and cardSvg.tsx's ascentOf).
  const ascender = table("hhea").getInt16(4);

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
  if (!pick) throw new Error(`${label}: no usable cmap subtable (need format 4 or 12)`);

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
    throw new Error(`${label}: unsupported cmap format ${format}`);
  }

  if (glyphOf.size === 0) throw new Error(`${label}: cmap mapped zero BMP codepoints`);
  return { unitsPerEm, ascender, advanceOfGlyph, glyphOf };
}

// ---------------------------------------------------------------------------
// Advance-table packing — identical encoding for every face
// ---------------------------------------------------------------------------

/** codepoints ascending, each entry `<Δcp base36>.<advance base36>`, ~100
 * chars/line so the file diffs sanely. Returns the packed string, the sorted
 * fallback (rounded mean advance), and the codepoint count (for logging). */
function packAdvances({ advanceOfGlyph, glyphOf }) {
  const codepoints = [...glyphOf.keys()].sort((a, b) => a - b);
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
  const packed = entries.join(",");
  const lines = [];
  for (let i = 0; i < packed.length; i += 100) lines.push(packed.slice(i, i + 100));
  return { lines, fallback, count: codepoints.length };
}

const wrappedStringLiteral = (lines) => lines.map((l) => `  "${l}"`).join(" +\n");

// ---------------------------------------------------------------------------
// Geist — UNCHANGED output shape (byte-identical to the pre-rename script)
// ---------------------------------------------------------------------------

function writeGeistMetrics() {
  const source = join(fontsDir, "GeistVF.woff");
  const metrics = extractFontMetrics(readFontTables(source), "GeistVF.woff");
  const { lines, fallback, count } = packAdvances(metrics);
  const target = join(outDir, "geist-metrics.ts");

  writeFileSync(
    target,
    `// Generated by scripts/generate-font-metrics.mjs — do not edit by hand.
// Advance widths of GeistVF.woff's ${count} covered BMP codepoints, in font units
// (unitsPerEm ${metrics.unitsPerEm}) — the TextBox wrap engine's measuring stick (DESIGN.md §3.3).
// Encoding: "<codepoint delta base36>.<advance base36>" entries joined by ",",
// codepoints ascending — decoded into a Map at module load.

export const GEIST_UNITS_PER_EM = ${metrics.unitsPerEm};

/** Mean advance over the covered codepoints — charged for uncovered chars. */
export const GEIST_FALLBACK_ADVANCE = ${fallback};

const PACKED =
${wrappedStringLiteral(lines)};

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
    `Wrote ${count} advances (unitsPerEm ${metrics.unitsPerEm}, fallback ${fallback}) to ${target}`,
  );
}

// ---------------------------------------------------------------------------
// The eight ◆41 bundled Text/TextBox faces — one combined font-metrics.ts
// ---------------------------------------------------------------------------

// ADDING A FACE: one entry here + a regen (`npm run generate:font-metrics`)
// — see model.ts's FONT_FACES comment for the other half (the checker
// vocabulary entry). The other six Cormorant Garamond weights already sit in
// src/app/fonts/CormorantGaramond/ but are deliberately not exposed (◆41).
const BUNDLED_FACES = [
  { token: "garamond", file: "CormorantGaramond/CormorantGaramond-Regular.ttf" },
  { token: "garamond_bold", file: "CormorantGaramond/CormorantGaramond-Bold.ttf" },
  { token: "garamond_italic", file: "CormorantGaramond/CormorantGaramond-Italic.ttf" },
  { token: "garamond_bold_italic", file: "CormorantGaramond/CormorantGaramond-BoldItalic.ttf" },
  { token: "courier", file: "CourierPrime/CourierPrime-Regular.ttf" },
  { token: "courier_bold", file: "CourierPrime/CourierPrime-Bold.ttf" },
  { token: "courier_italic", file: "CourierPrime/CourierPrime-Italic.ttf" },
  { token: "courier_bold_italic", file: "CourierPrime/CourierPrime-BoldItalic.ttf" },
];

const CONST_NAME = (token) => `${token.toUpperCase()}_PACKED`;

function writeFontMetrics() {
  const target = join(outDir, "font-metrics.ts");
  const packedConsts = [];
  const mapEntries = [];
  const logLines = [];

  for (const { token, file } of BUNDLED_FACES) {
    const metrics = extractFontMetrics(readFontTables(join(fontsDir, file)), file);
    const { lines, fallback, count } = packAdvances(metrics);
    const ascent = metrics.ascender / metrics.unitsPerEm;
    const constName = CONST_NAME(token);
    packedConsts.push(`const ${constName} =\n${wrappedStringLiteral(lines)};`);
    mapEntries.push(
      `  ${token}: {\n` +
        `    unitsPerEm: ${metrics.unitsPerEm},\n` +
        `    fallbackAdvance: ${fallback},\n` +
        `    advances: decode(${constName}),\n` +
        `    ascent: ${ascent},\n` +
        `  },`,
    );
    logLines.push(
      `  ${token}: ${count} advances (unitsPerEm ${metrics.unitsPerEm}, fallback ${fallback}, ascent ${ascent.toFixed(4)})`,
    );
  }

  const faceUnion = BUNDLED_FACES.map(({ token }) => `  | "${token}"`).join("\n");

  writeFileSync(
    target,
    `// Generated by scripts/generate-font-metrics.mjs — do not edit by hand.
// Advance widths (+ ascent) of the eight bundled Text/TextBox \`font:\` faces
// (DESIGN.md §3.3 font: row, ◆41) — the TextBox wrap engine's per-font
// measuring stick, same encoding as geist-metrics.ts. Geist itself stays
// generated separately into geist-metrics.ts (unchanged format) because its
// renderer-side ascent is a hand-tuned constant, not hhea-derived — see
// cardSvg.tsx's ascentOf for the documented inconsistency.
// Encoding: "<codepoint delta base36>.<advance base36>" entries joined by ",",
// codepoints ascending — decoded into a Map at module load (one shared
// decode() rather than one per face).

/** One face's measuring stick — the same three fields as geist-metrics.ts's
 * exports, plus \`ascent\` (hhea ascender ÷ unitsPerEm) for baseline
 * realization (cardSvg.tsx), which Geist deliberately does not get here. */
export interface GeneratedFontMetrics {
  unitsPerEm: number;
  /** Mean advance over the covered codepoints — charged for uncovered chars. */
  fallbackAdvance: number;
  /** BMP codepoint → advance width in font units. */
  advances: ReadonlyMap<number, number>;
  /** hhea ascender / unitsPerEm. */
  ascent: number;
}

/** The eight ◆41 face tokens this module covers (mirrors the non-"geist"
 * subset of model.ts's FONT_FACES — pinned by a test, since a generated file
 * imports nothing by convention, geist-metrics.ts included). */
export type BundledFontFace =
${faceUnion};

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

${packedConsts.join("\n\n")}

export const FONT_METRICS: Readonly<Record<BundledFontFace, GeneratedFontMetrics>> = {
${mapEntries.join("\n")}
};
`,
  );
  console.log(`Wrote font-metrics.ts (${BUNDLED_FACES.length} faces) to ${target}:`);
  for (const line of logLines) console.log(line);
}

writeGeistMetrics();
writeFontMetrics();
