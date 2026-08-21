/**
 * Pure completion logic for Goblin script (DESIGN.md §6.3).
 *
 * `(documentText, offset, snapshot) → suggestions + replace range`, with no
 * Monaco types anywhere — the provider in goblinLanguage.ts is a thin adapter
 * over `computeCompletions`, and everything here is unit-tested without an
 * editor.
 *
 * The context scan is TEXTUAL, never a parse: completions must keep working
 * mid-edit on broken code (§6.3's no-hard-dependency-on-a-good-compile rule).
 * The last compile's bindings supply the *names* (via `buildCompletionSnapshot`,
 * falling back to `lastGoodSchema` when the latest check yielded nothing); the
 * current document supplies the *position* — indentation plus nearest block
 * headers, `Repeat`/`loop` variables, and the Template→Card usage map are all
 * read straight off the text. When the scan cannot place the cursor, brackets
 * degrade to the union of all sheets' columns rather than to silence.
 *
 * Property-key tables here mirror the checker's (CARD_PROPERTY_KEYS and
 * ELEMENT_SPECS in check.ts are module-private); the test file pins them to
 * the compiler by probing E008 behavior, so drift fails the suite.
 */

import type { Bindings } from "@/lib/lang";
import {
  CSS_COLOR_NAMES,
  DEFAULT_FONT,
  DEFAULT_ICON_STYLE,
  DEFAULT_IMAGE_FIT,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_PIVOT,
  DEFAULT_QR_LEVEL,
  DEFAULT_TEXTBOX_OVERFLOW,
  DICIER_CODES,
  DICIER_CODE_CATEGORIES,
  FONT_FACES,
  ICON_STYLES,
  IMAGE_FITS,
  PIVOT_TOKENS,
  QR_LEVELS,
  SHRINK_FLOOR,
  SIZE_PRESETS,
  TEXTBOX_OVERFLOWS,
  typeName,
} from "@/lib/lang";
import type { SchemaSnapshot } from "@/app/editor/_store/editorStore";

// ---------------------------------------------------------------------------
// Snapshot — the name universe, derived from store state
// ---------------------------------------------------------------------------

export interface SnapshotColumn {
  name: string;
  /** Display string ("Number", "Text", "enum Suit") for detail text. */
  type: string;
  /** Set when the column is enum-typed — drives expected-enum completions. */
  enumName: string | null;
}

export interface SnapshotSheet {
  name: string;
  columns: SnapshotColumn[];
}

export interface SnapshotEnum {
  name: string;
  cases: string[];
}

export interface CompletionSnapshot {
  sheets: SnapshotSheet[];
  enums: SnapshotEnum[];
  templates: string[];
}

export const EMPTY_SNAPSHOT: CompletionSnapshot = { sheets: [], enums: [], templates: [] };

/**
 * Build the name universe from the LATEST compile's bindings (partial bindings
 * from a broken compile are fine — check() never throws and fills what it
 * can), falling back per category to the last good schema when the latest
 * check yielded nothing (e.g. the E000 empty-bindings path).
 */
export function buildCompletionSnapshot(
  bindings: Bindings | null,
  schema: SchemaSnapshot | null,
): CompletionSnapshot {
  const sheets: SnapshotSheet[] = [];
  const enums: SnapshotEnum[] = [];
  const templates: string[] = [];
  if (bindings) {
    for (const [name, info] of bindings.sheets) {
      const columns: SnapshotColumn[] = [];
      for (const [colName, col] of info.columns) {
        columns.push({
          name: colName,
          type: typeName(col.type),
          enumName: col.type.kind === "Enum" ? col.type.enumName : null,
        });
      }
      sheets.push({ name, columns });
    }
    for (const [name, decl] of bindings.enums) {
      enums.push({ name, cases: decl.cases.map((c) => c.name.name) });
    }
    templates.push(...bindings.templates.keys());
  }
  if (sheets.length === 0 && schema) {
    for (const sheet of schema) {
      sheets.push({
        name: sheet.name,
        columns: sheet.columns.map((c) => ({
          name: c.name,
          type: c.type.kind === "Enum" ? `enum ${c.type.enumName}` : c.type.kind,
          enumName: c.type.kind === "Enum" ? c.type.enumName : null,
        })),
      });
    }
  }
  if (enums.length === 0 && schema) {
    const seen = new Set<string>();
    for (const sheet of schema) {
      for (const c of sheet.columns) {
        if (c.type.kind === "Enum" && !seen.has(c.type.enumName)) {
          seen.add(c.type.enumName);
          enums.push({ name: c.type.enumName, cases: c.type.cases });
        }
      }
    }
  }
  return { sheets, enums, templates };
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SuggestionKind =
  | "column"
  | "variable"
  | "property"
  | "element"
  | "keyword"
  | "enum"
  | "enumCase"
  | "color"
  | "iconCode"
  | "sheet"
  | "template"
  | "sizePreset"
  | "value"
  | "hint";

export interface CompletionSuggestion {
  label: string;
  insertText: string;
  /** Monaco interprets `insertText` as a snippet when true. Kept as a pure
   * boolean here so the completion engine remains independent of Monaco. */
  snippet?: boolean;
  kind: SuggestionKind;
  detail?: string;
  /** Sort tier: 0 context-primary · 1 secondary (enum names, unique bare
   * cases) · 2 keywords · 3 hints. Within a tier, array order is the order. */
  group: 0 | 1 | 2 | 3;
}

export interface CompletionResult {
  suggestions: CompletionSuggestion[];
  /** Document offset where the replaced segment starts (word start, after
   * `[`, after `.`, or after the opening `"` of a code: string). ≤ offset. */
  replaceStart: number;
  /** End of the word/segment the cursor sits in. ≥ offset. */
  replaceEnd: number;
}

// ---------------------------------------------------------------------------
// Static vocabularies
// ---------------------------------------------------------------------------

/** §3.5 expression-structure keywords, offered at low priority. `as` is
 * position-specific (loop:) and handled where it is legal. */
const EXPRESSION_KEYWORDS = ["if", "then", "else", "and", "or", "not"] as const;

type ElementKind = "Rectangle" | "Text" | "TextBox" | "Icon" | "Image" | "Qr";
type StructuralKind = "Template" | "Repeat" | "If" | "Else";
type BlockKind = ElementKind | StructuralKind | "Card" | "Sheet" | "Enum";

/** §3.3 property tables — mirrors check.ts's private ELEMENT_SPECS (pinned by
 * a compiler-probe test). Order here is the suggestion order. */
/** §3.4 nine-point pivot (M3): one key detail for every drawable element. */
const DEFAULT_PIVOT_TOKEN = `${DEFAULT_PIVOT.v}_${DEFAULT_PIVOT.h}`;
const PIVOT_KEY = {
  key: "pivot",
  detail: `which point x/y name (optional, default ${DEFAULT_PIVOT_TOKEN})`,
};
/** §3.4 rotation (M4 — ◆43): one key detail for every drawable element. No
 * value completion — an angle is an open Number, not a closed vocabulary. */
const ROTATE_KEY = {
  key: "rotate",
  detail: "Number — degrees clockwise, around the pivot (optional, default 0)",
};

const ELEMENT_KEYS: Record<ElementKind, { key: string; detail: string }[]> = {
  Rectangle: [
    { key: "x", detail: "Number — units" },
    { key: "y", detail: "Number — units" },
    { key: "width", detail: "Number — units" },
    { key: "height", detail: "Number — units" },
    { key: "color", detail: "Color" },
    PIVOT_KEY,
    ROTATE_KEY,
  ],
  Text: [
    { key: "x", detail: "Number — units (or middle)" },
    { key: "y", detail: "Number — units" },
    { key: "size", detail: "Number — em height in units" },
    { key: "text", detail: "Text" },
    { key: "color", detail: "Color (optional, default black)" },
    PIVOT_KEY,
    { key: "font", detail: `bundled font face (optional, default ${DEFAULT_FONT})` },
    ROTATE_KEY,
  ],
  TextBox: [
    { key: "x", detail: "Number — units" },
    { key: "y", detail: "Number — units" },
    { key: "width", detail: "Number — units" },
    { key: "height", detail: "Number — units" },
    { key: "text", detail: "Text — wraps; \\n is a hard break" },
    { key: "size", detail: "Number — em height in units" },
    { key: "color", detail: "Color (optional, default black)" },
    { key: "align", detail: "left | middle | right (optional)" },
    { key: "line_height", detail: `number × size (optional, default ${DEFAULT_LINE_HEIGHT})` },
    { key: "overflow", detail: `${TEXTBOX_OVERFLOWS.join(" | ")} (optional, default ${DEFAULT_TEXTBOX_OVERFLOW})` },
    PIVOT_KEY,
    { key: "font", detail: `bundled font face (optional, default ${DEFAULT_FONT}) — wraps per font` },
    ROTATE_KEY,
  ],
  Icon: [
    { key: "x", detail: "Number — units (or middle)" },
    { key: "y", detail: "Number — units" },
    { key: "size", detail: "Number — em height in units" },
    { key: "code", detail: "Text — Dicier code" },
    { key: "color", detail: "Color (optional, default black)" },
    PIVOT_KEY,
    { key: "style", detail: `Dicier face (optional, default ${DEFAULT_ICON_STYLE})` },
    ROTATE_KEY,
  ],
  Image: [
    { key: "x", detail: "Number — units" },
    { key: "y", detail: "Number — units" },
    { key: "width", detail: "Number — units (or auto)" },
    { key: "height", detail: "Number — units (or auto)" },
    { key: "src", detail: "Text — image URL" },
    { key: "fit", detail: `${IMAGE_FITS.join(" | ")} (optional, default ${DEFAULT_IMAGE_FIT})` },
    { key: "color", detail: "Color multiplier (optional, default white / unchanged)" },
    PIVOT_KEY,
    ROTATE_KEY,
  ],
  Qr: [
    { key: "x", detail: "Number — units" },
    { key: "y", detail: "Number — units" },
    { key: "size", detail: "Number — units (square side)" },
    { key: "data", detail: "Text — the encoded content" },
    { key: "color", detail: "Color (optional, default black)" },
    { key: "background", detail: "Color (optional, default white)" },
    { key: "level", detail: `${QR_LEVELS.join(" | ")} (optional, default ${DEFAULT_QR_LEVEL})` },
    PIVOT_KEY,
    ROTATE_KEY,
  ],
};

/** §3.2 Card properties — mirrors check.ts's private CARD_PROPERTY_KEYS
 * (pinned by the same probe test), plus the Front:/Back: face lines. */
const CARD_KEYS: { key: string; detail: string }[] = [
  { key: "sheet", detail: "Sheet name" },
  { key: "size", detail: [...SIZE_PRESETS.keys()].join(" | ") },
  { key: "width_mm", detail: "positive number (mm) — custom size, with height_mm" },
  { key: "height_mm", detail: "positive number (mm) — custom size, with width_mm" },
  { key: "x_units", detail: "positive integer — grid columns" },
  { key: "y_units", detail: "auto | positive integer" },
  { key: "loop", detail: "<Enum> as <variable>" },
  { key: "count", detail: "Number — copies per row × case" },
  { key: "Front", detail: "Template name" },
  { key: "Back", detail: "Template name (optional — plain white)" },
];

const ELEMENT_OPENERS: { key: string; detail: string }[] = [
  { key: "Rectangle", detail: "x y width height color" },
  { key: "Text", detail: "x y size text (color pivot)" },
  { key: "TextBox", detail: "x y width height text size (color align line_height overflow)" },
  { key: "Icon", detail: "x y size code (color pivot)" },
  { key: "Image", detail: "x y width height src (fit color pivot rotate)" },
  { key: "Qr", detail: "x y size data (color background level pivot)" },
  { key: "Repeat", detail: "<count expr> as <variable>" },
  { key: "If", detail: "<Bool expr> — draw only the selected branch" },
];

const TOP_LEVEL_OPENERS: { key: string; detail: string }[] = [
  { key: "Enum", detail: "Enum: <Name> — case …" },
  { key: "Sheet", detail: "Sheet: <Name> — column …" },
  { key: "Template", detail: "Template: <Name> — elements" },
  { key: "Card", detail: "Card: <Name> — sheet/size/units/faces" },
];

const BLOCK_HEADER_RE =
  /^(Enum|Sheet|Template|Card|Rectangle|TextBox|Text|Icon|Image|Qr|Repeat|If|Else|Front|Back)[ \t]*:[ \t]*(.*)$/;
const WORD_CHAR = /[A-Za-z0-9_]/;

// ---------------------------------------------------------------------------
// Line-level scanning
// ---------------------------------------------------------------------------

interface LineState {
  inComment: boolean;
  inString: boolean;
  /** Column just after the opening quote when inString. */
  stringOpenCol: number;
}

/** Walk the line up to the cursor (`col`) tracking string/comment state, using
 * the lexer's `#` disambiguation (§3.1 ◆22): `#` + exactly 6 hex digits + no
 * identifier char is a color literal, anything else starts a comment. The hex
 * lookahead runs over the FULL line, not just the text before the cursor —
 * `#cc0000x` is a comment even with the cursor sitting after the sixth digit. */
function scanLineState(line: string, col: number): LineState {
  let inString = false;
  let stringOpenCol = -1;
  for (let i = 0; i < col; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      stringOpenCol = i + 1;
      continue;
    }
    if (ch === "#") {
      if (/^#[0-9a-fA-F]{6}(?![0-9a-zA-Z_])/.test(line.slice(i))) {
        i += 6;
        continue;
      }
      return { inComment: true, inString: false, stringOpenCol: -1 };
    }
  }
  return { inComment: false, inString, stringOpenCol: inString ? stringOpenCol : -1 };
}

function indentOf(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0].length : 0;
}

function isBlankOrComment(line: string): boolean {
  const t = line.trim();
  return t === "" || t.startsWith("#");
}

// ---------------------------------------------------------------------------
// Block-context scanning (textual, backwards from the cursor)
// ---------------------------------------------------------------------------

interface Ancestors {
  /** Innermost enclosing block header, if recognizable. */
  innermost: BlockKind | null;
  /** Nearest enclosing top-level declaration. */
  topKind: "Card" | "Template" | "Sheet" | "Enum" | null;
  topName: string | null;
  /** Line index of the top declaration's header (for Card property scans). */
  topLine: number;
  /** Innermost enclosing element, when inside one. */
  elementKind: ElementKind | null;
  /** `Repeat … as v` variables in scope, innermost first. */
  repeatVars: string[];
  /** Lexical node frames, innermost first. Lets are hoisted within each. */
  lexicalFrames: { kind: StructuralKind; line: number; repeatVar: string | null }[];
  /** Set when the cursor hangs below a property line (value continuation). */
  continuationKey: string | null;
}

/**
 * Walk upwards from `lineIndex` collecting every line whose indent is strictly
 * less than the narrowing minimum — the ancestor chain of a position with
 * indent `startIndent`. Purely textual and tolerant: unrecognizable ancestors
 * are stepped over, so broken code degrades to "context unknown", never to a
 * crash or a stale parse.
 */
function scanAncestors(lines: string[], lineIndex: number, startIndent: number): Ancestors {
  const out: Ancestors = {
    innermost: null,
    topKind: null,
    topName: null,
    topLine: -1,
    elementKind: null,
    repeatVars: [],
    lexicalFrames: [],
    continuationKey: null,
  };
  let minIndent = startIndent;
  let sawHeader = false;
  for (let i = lineIndex - 1; i >= 0 && minIndent > 0; i--) {
    const raw = lines[i];
    if (isBlankOrComment(raw)) continue;
    const indent = indentOf(raw);
    if (indent >= minIndent) continue;
    minIndent = indent;
    const body = raw.trim();
    const header = BLOCK_HEADER_RE.exec(body);
    if (header) {
      const kind = header[1] as BlockKind | "Front" | "Back";
      if (kind === "Front" || kind === "Back") continue; // inline faces, never parents
      sawHeader = true;
      if (out.innermost === null) out.innermost = kind;
      if (kind === "Repeat") {
        const asMatch = /\bas[ \t]+([A-Za-z_][A-Za-z0-9_]*)/.exec(header[2]);
        if (asMatch) out.repeatVars.push(asMatch[1]);
        out.lexicalFrames.push({ kind, line: i, repeatVar: asMatch?.[1] ?? null });
        continue;
      }
      if (kind === "If" || kind === "Else") {
        out.lexicalFrames.push({ kind, line: i, repeatVar: null });
        continue;
      }
      if (
        kind === "Rectangle" ||
        kind === "Text" ||
        kind === "TextBox" ||
        kind === "Icon" ||
        kind === "Image" ||
        kind === "Qr"
      ) {
        if (out.elementKind === null) out.elementKind = kind;
        continue;
      }
      // Top-level declaration: chain complete.
      out.topKind = kind;
      out.topLine = i;
      const nameMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(header[2]);
      out.topName = nameMatch ? nameMatch[1] : null;
      if (kind === "Template") {
        out.lexicalFrames.push({ kind, line: i, repeatVar: null });
      }
      break;
    }
    // Property-ish line (lowercase key, incl. `column name: …`): the cursor is
    // in its value continuation ONLY while no block header sits between them.
    const letDecl = /^let[ \t]+[A-Za-z][A-Za-z0-9_]*[ \t]*:/.test(body);
    const virtual = /^virtual[ \t]+column[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*:/.test(body);
    const prop = /^(?:column[ \t]+)?([a-z_][A-Za-z0-9_]*)[ \t]*:/.exec(body);
    if (letDecl && !sawHeader && out.continuationKey === null) {
      out.continuationKey = "let";
    }
    if (prop && !sawHeader && out.continuationKey === null) {
      out.continuationKey = prop[1];
    }
    if (virtual && !sawHeader && out.continuationKey === null) {
      out.continuationKey = "virtual";
    }
    // Anything else (a continuation line itself, broken text): transparent.
  }
  return out;
}

interface CardScope {
  sheetName: string | null;
  loopVars: { name: string; enumName: string }[];
}

/** Textually read a Card block's `sheet:` and `loop:` lines. */
function scanCardBlock(lines: string[], headerLine: number): CardScope {
  const scope: CardScope = { sheetName: null, loopVars: [] };
  const headerIndent = indentOf(lines[headerLine]);
  for (let i = headerLine + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (isBlankOrComment(raw)) continue;
    if (indentOf(raw) <= headerIndent) break;
    const body = raw.trim();
    const sheet = /^sheet[ \t]*:[ \t]*([A-Za-z_][A-Za-z0-9_]*)/.exec(body);
    if (sheet) scope.sheetName = sheet[1];
    const loop =
      /^loop[ \t]*:[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]+as[ \t]+([A-Za-z_][A-Za-z0-9_]*)/.exec(
        body,
      );
    if (loop) scope.loopVars.push({ name: loop[2], enumName: loop[1] });
  }
  return scope;
}

/** All Card blocks whose Front:/Back: reference `templateName` (whole-document
 * textual scan — templates are checked per using Card, §3.6, and completions
 * follow the same rule). */
function scanDeclaredTemplates(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (indentOf(line) !== 0) continue;
    const match = /^Template[ \t]*:[ \t]*([A-Za-z_][A-Za-z0-9_]*)/.exec(line.trim());
    if (match && !out.includes(match[1])) out.push(match[1]);
  }
  return out;
}

/** Textual Template call graph. A lowercase `name:` at node indentation is a
 * call, while the same spelling below an element remains a property. */
function scanTemplateCallGraph(lines: string[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (isBlankOrComment(raw)) continue;
    const indent = indentOf(raw);
    const call = /^([A-Za-z][A-Za-z0-9_]*)[ \t]*:[ \t]*(?:#.*)?$/.exec(raw.trim());
    if (!call || indent === 0) continue;
    const ancestors = scanAncestors(lines, i, indent);
    if (ancestors.topKind !== "Template" || !ancestors.topName) continue;
    if (!["Template", "Repeat", "If", "Else"].includes(ancestors.innermost ?? "")) continue;
    const name = call[1];
    if (["Rectangle", "Text", "TextBox", "Icon", "Image", "Qr", "Repeat", "If", "Else"].includes(name)) {
      continue;
    }
    const calls = graph.get(ancestors.topName) ?? new Set<string>();
    calls.add(name);
    graph.set(ancestors.topName, calls);
  }
  return graph;
}

function scanUsingCards(lines: string[], templateName: string): CardScope[] {
  const scopes: CardScope[] = [];
  const graph = scanTemplateCallGraph(lines);
  const reaches = (root: string): boolean => {
    const pending = [root];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const name = pending.pop()!;
      if (name === templateName) return true;
      if (seen.has(name)) continue;
      seen.add(name);
      for (const called of graph.get(name) ?? []) pending.push(called);
    }
    return false;
  };
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) !== 0) continue;
    if (!/^Card[ \t]*:/.test(lines[i].trim())) continue;
    let uses = false;
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j];
      if (isBlankOrComment(raw)) continue;
      if (indentOf(raw) === 0) break;
      const face = /^(?:Front|Back)[ \t]*:[ \t]*([A-Za-z_][A-Za-z0-9_]*)/.exec(raw.trim());
      if (face && reaches(face[1])) uses = true;
    }
    if (uses) scopes.push(scanCardBlock(lines, i));
  }
  return scopes;
}

/** Every textual Card context. Global lets are checked per reachable Card and
 * can legally reference that Card's loop variables and sheet columns. */
function scanAllCards(lines: string[]): CardScope[] {
  const scopes: CardScope[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) !== 0 || !/^Card[ \t]*:/.test(lines[i].trim())) continue;
    scopes.push(scanCardBlock(lines, i));
  }
  return scopes;
}

// ---------------------------------------------------------------------------
// Suggestion builders
// ---------------------------------------------------------------------------

/** First occurrence wins. Suggestion arrays are built context-relevant-first,
 * so this is the shadowing rule for free: an innermost `Repeat` variable beats
 * a loop variable beats a same-named column (§3.6 order), and a CSS color
 * beats an enum that happens to be named `red`. */
function dedupeByLabel(list: CompletionSuggestion[]): CompletionSuggestion[] {
  const seen = new Set<string>();
  const out: CompletionSuggestion[] = [];
  for (const s of list) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    out.push(s);
  }
  return out;
}

function keySuggestions(
  keys: { key: string; detail: string }[],
  colonFollows: boolean,
  opener: boolean,
): CompletionSuggestion[] {
  return keys.map(({ key, detail }) => ({
    label: key,
    insertText: colonFollows ? key : `${key}: `,
    kind: (opener ? "element" : "property") as SuggestionKind,
    detail,
    group: 0 as const,
  }));
}

/** Bindings visible to `[refs]` and expressions at the cursor: the enclosing
 * Card's (or the using Cards' union, inside a Template) sheet columns + loop
 * vars, plus enclosing Repeat vars. `certain` is false when the scan could
 * not place the cursor — brackets then union ALL sheets' columns. */
interface RefScope {
  lexical: { name: string; detail: string }[];
  columns: SnapshotColumn[];
  columnSheets: Map<string, string>; // column name → owning sheet (detail text)
  loopVars: { name: string; enumName: string }[];
  repeatVars: string[];
  /** Global initializers resolve globals before ambient sheet columns. */
  globalsBeforeColumns: boolean;
  certain: boolean;
}

function scanDirectLets(lines: string[], headerLine: number): string[] {
  const headerIndent = indentOf(lines[headerLine]);
  let childIndent = Number.POSITIVE_INFINITY;
  let end = lines.length;
  for (let i = headerLine + 1; i < lines.length; i++) {
    if (isBlankOrComment(lines[i])) continue;
    const indent = indentOf(lines[i]);
    if (indent <= headerIndent) {
      end = i;
      break;
    }
    childIndent = Math.min(childIndent, indent);
  }
  if (!Number.isFinite(childIndent)) return [];
  const names: string[] = [];
  for (let i = headerLine + 1; i < end; i++) {
    if (indentOf(lines[i]) !== childIndent) continue;
    const match = /^let[ \t]+([A-Za-z][A-Za-z0-9_]*)[ \t]*:/.exec(lines[i].trim());
    if (match && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

interface ScannedTemplateParam {
  name: string;
  type: string;
}

/** Direct `param name: Type` declarations are hoisted across one Template
 * activation. This remains a textual scan so declarations typed after the
 * cursor (and declarations in a temporarily broken document) still help. */
function scanDirectParams(lines: string[], headerLine: number): ScannedTemplateParam[] {
  const headerIndent = indentOf(lines[headerLine]);
  let childIndent = Number.POSITIVE_INFINITY;
  let end = lines.length;
  for (let i = headerLine + 1; i < lines.length; i++) {
    if (isBlankOrComment(lines[i])) continue;
    const indent = indentOf(lines[i]);
    if (indent <= headerIndent) {
      end = i;
      break;
    }
    childIndent = Math.min(childIndent, indent);
  }
  if (!Number.isFinite(childIndent)) return [];
  const params: ScannedTemplateParam[] = [];
  for (let i = headerLine + 1; i < end; i++) {
    if (indentOf(lines[i]) !== childIndent) continue;
    const match = /^param[ \t]+([A-Za-z][A-Za-z0-9_]*)[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9_]*)/.exec(
      lines[i].trim(),
    );
    if (match && !params.some((param) => param.name === match[1])) {
      params.push({ name: match[1], type: match[2] });
    }
  }
  return params;
}

function scanTemplateParams(lines: string[], templateName: string): ScannedTemplateParam[] {
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) !== 0) continue;
    const match = /^Template[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9_]*)/.exec(lines[i].trim());
    if (match?.[1] === templateName) return scanDirectParams(lines, i);
  }
  return [];
}

function scanGlobalLets(lines: string[]): string[] {
  const names: string[] = [];
  for (const line of lines) {
    if (indentOf(line) !== 0) continue;
    const match = /^let[ \t]+([A-Za-z][A-Za-z0-9_]*)[ \t]*:/.exec(line.trim());
    if (match && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

function resolveRefScope(
  lines: string[],
  ancestors: Ancestors,
  snapshot: CompletionSnapshot,
  globalInitializer = false,
): RefScope {
  const scopes: CardScope[] = [];
  let directSheetName: string | null = null;
  let certain = false;
  if (globalInitializer) {
    scopes.push(...scanAllCards(lines));
    certain = scopes.length > 0;
  } else if (ancestors.topKind === "Card" && ancestors.topLine >= 0) {
    scopes.push(scanCardBlock(lines, ancestors.topLine));
    certain = true;
  } else if (ancestors.topKind === "Template" && ancestors.topName) {
    const using = scanUsingCards(lines, ancestors.topName);
    if (using.length > 0) {
      scopes.push(...using);
      certain = true;
    }
  } else if (ancestors.topKind === "Sheet" && ancestors.topName) {
    // ◆48 virtual initializer: its own physical columns plus the union of
    // loop variables from every Card bound to this Sheet.
    directSheetName = ancestors.topName;
    scopes.push(...scanAllCards(lines).filter((scope) => scope.sheetName === directSheetName));
    certain = true;
  }
  const columns: SnapshotColumn[] = [];
  const columnSheets = new Map<string, string>();
  const addSheet = (sheet: SnapshotSheet) => {
    for (const col of sheet.columns) {
      if (!columnSheets.has(col.name)) {
        columnSheets.set(col.name, sheet.name);
        columns.push(col);
      }
    }
  };
  let anySheetResolved = false;
  if (directSheetName !== null) {
    const sheet = snapshot.sheets.find((candidate) => candidate.name === directSheetName);
    if (sheet) {
      anySheetResolved = true;
      addSheet(sheet);
    }
  }
  for (const scope of scopes) {
    const sheet = snapshot.sheets.find((s) => s.name === scope.sheetName);
    if (sheet) {
      anySheetResolved = true;
      addSheet(sheet);
    }
  }
  if (!certain || !anySheetResolved) {
    // Context unknown (broken code) or the Card names no resolvable sheet:
    // degrade to the union of every sheet's columns (§6.3). A Card bound to
    // a zero-column sheet resolves and correctly stays column-less.
    for (const sheet of snapshot.sheets) addSheet(sheet);
  }
  const loopVars: { name: string; enumName: string }[] = [];
  for (const scope of scopes) {
    for (const v of scope.loopVars) {
      if (!loopVars.some((l) => l.name === v.name)) loopVars.push(v);
    }
  }
  const lexical: { name: string; detail: string }[] = [];
  for (const frame of ancestors.lexicalFrames) {
    for (const name of scanDirectLets(lines, frame.line)) {
      lexical.push({ name, detail: "local let — immutable, type inferred" });
    }
    if (frame.repeatVar) {
      lexical.push({ name: frame.repeatVar, detail: "repeat index (0-based)" });
    }
    if (frame.kind === "Template") {
      for (const param of scanDirectParams(lines, frame.line)) {
        lexical.push({
          name: param.name,
          detail: `Template parameter — immutable ${param.type}`,
        });
      }
    }
  }
  for (const name of scanGlobalLets(lines)) {
    lexical.push({ name, detail: "global let — immutable, type inferred" });
  }
  return {
    lexical,
    columns,
    columnSheets,
    loopVars,
    repeatVars: ancestors.repeatVars,
    globalsBeforeColumns: globalInitializer,
    certain,
  };
}

function bracketSuggestions(scope: RefScope): CompletionSuggestion[] {
  const out: CompletionSuggestion[] = [];
  const globals: CompletionSuggestion[] = [];
  for (const binding of scope.lexical) {
    const suggestion = {
      label: binding.name,
      insertText: binding.name,
      kind: "variable" as const,
      detail: binding.detail,
      group: 0 as const,
    };
    if (binding.detail.startsWith("global")) globals.push(suggestion);
    else out.push(suggestion);
  }
  for (const name of scope.repeatVars) {
    if (out.some((s) => s.label === name)) continue;
    out.push({
      label: name,
      insertText: name,
      kind: "variable",
      detail: "repeat index (0-based)",
      group: 0,
    });
  }
  for (const v of scope.loopVars) {
    out.push({
      label: v.name,
      insertText: v.name,
      kind: "variable",
      detail: `loop — enum ${v.enumName}`,
      group: 0,
    });
  }
  if (scope.globalsBeforeColumns) out.push(...globals);
  for (const col of scope.columns) {
    out.push({
      label: col.name,
      insertText: col.name,
      kind: "column",
      detail: `${col.type} — ${scope.columnSheets.get(col.name) ?? "column"}`,
      group: 0,
    });
  }
  // Ordinary expressions preserve compatibility by ranking columns before
  // globals. Inside a global initializer the checker deliberately reverses
  // those two so global dependency graphs are stable.
  if (!scope.globalsBeforeColumns) out.push(...globals);
  // Built-in generation bindings (§3.6, ◆42/◆49): offered LAST, after every real
  // column — matching their resolution order, and (since sortText combines
  // group with array position, goblinLanguage.ts) sorting after them in the
  // menu too. A column named after any built-in shadows that built-in and
  // already claimed the label above — dedupeByLabel (computeCompletions)
  // drops this one for free, the same "first occurrence wins" mechanism
  // that already resolves every other shadowing case here.
  out.push({
    label: "row",
    insertText: "row",
    kind: "variable",
    detail: "built-in — 1-based row position in its sheet (the grid gutter number)",
    group: 0,
  });
  out.push({
    label: "card",
    insertText: "card",
    kind: "variable",
    detail: "built-in — 1-based card position in the generated deck (rows × loop × count)",
    group: 0,
  });
  out.push({
    label: "copy",
    insertText: "copy",
    kind: "variable",
    detail: "built-in — 1-based copy within this row × loop combination",
    group: 0,
  });
  out.push({
    label: "deck",
    insertText: "deck",
    kind: "variable",
    detail: "built-in — Card declaration name for this generated deck",
    group: 0,
  });
  out.push({
    label: "deck_card",
    insertText: "deck_card",
    kind: "variable",
    detail: "built-in — clearer alias of [card], 1-based within this deck",
    group: 0,
  });
  out.push({
    label: "project_card",
    insertText: "project_card",
    kind: "variable",
    detail: "built-in — 1-based physical card position across the generated project",
    group: 0,
  });
  return out;
}

/** Generic expression vocabulary: enum names for `.` qualification and bare
 * cases where §3.5 makes them legal — after `==`/`!=` against an enum-typed
 * ref or a qualified `Enum.Case` (expected type known → that enum's cases,
 * top priority, ◆14), plus globally unique cases anywhere. Keywords ride
 * along at low priority. Directly after a closing quote nothing bare is
 * legal, so the `"` trigger stays silent. */
function expressionExtras(
  beforeWord: string,
  scope: RefScope,
  snapshot: CompletionSnapshot,
): CompletionSuggestion[] {
  if (/"[ \t]*$/.test(beforeWord)) return NO_SUGGESTIONS;
  const out: CompletionSuggestion[] = [];
  const cmp =
    /(?:\[([A-Za-z_][A-Za-z0-9_]*)\]|([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*)[ \t]*(?:==|!=)[ \t]*$/.exec(
      beforeWord,
    );
  if (cmp) {
    const ref = cmp[1];
    const enumName =
      ref !== undefined
        ? (scope.loopVars.find((v) => v.name === ref)?.enumName ??
          scope.columns.find((c) => c.name === ref)?.enumName ??
          null)
        : snapshot.enums.some((e) => e.name === cmp[2])
          ? cmp[2]
          : null;
    const en = snapshot.enums.find((e) => e.name === enumName);
    if (en) {
      for (const c of en.cases) {
        out.push({
          label: c,
          insertText: c,
          kind: "enumCase",
          detail: `${en.name} case`,
          group: 0,
        });
      }
    }
  }
  const caseCounts = new Map<string, number>();
  for (const en of snapshot.enums) {
    for (const c of en.cases) caseCounts.set(c, (caseCounts.get(c) ?? 0) + 1);
  }
  for (const en of snapshot.enums) {
    out.push({
      label: en.name,
      insertText: en.name,
      kind: "enum",
      detail: `enum — ${en.name}.<case>`,
      group: 1,
    });
    for (const c of en.cases) {
      if (caseCounts.get(c) === 1 && !out.some((s) => s.label === c && s.group === 0)) {
        out.push({
          label: c,
          insertText: c,
          kind: "enumCase",
          detail: `${en.name} case`,
          group: 1,
        });
      }
    }
  }
  for (const kw of EXPRESSION_KEYWORDS) {
    out.push({ label: kw, insertText: kw, kind: "keyword", group: 2 });
  }
  return out;
}

function colorSuggestions(): CompletionSuggestion[] {
  const out: CompletionSuggestion[] = [];
  for (const name of CSS_COLOR_NAMES) {
    out.push({ label: name, insertText: name, kind: "color", detail: "CSS color", group: 0 });
  }
  out.push({
    label: "#RRGGBB",
    insertText: "#",
    kind: "hint",
    detail: "hex color literal, e.g. #cc0000",
    group: 3,
  });
  return out;
}

function iconCodeSuggestions(): CompletionSuggestion[] {
  const out: CompletionSuggestion[] = [];
  for (const code of DICIER_CODES) {
    out.push({
      label: code,
      insertText: code,
      kind: "iconCode",
      detail: DICIER_CODE_CATEGORIES.get(code),
      group: 0,
    });
  }
  return out;
}

/** A paired resolved-text color scope. The opening `{` is already present
 * when this suggestion is offered; the snippet supplies both tags and puts
 * the two tab stops on the color and content. */
function colorScopeSuggestion(): CompletionSuggestion {
  return {
    label: "color scope",
    insertText: "color:${1:red}}${2:text}{/color}",
    snippet: true,
    kind: "color",
    detail: "{color:red}text{/color} — nested; does not affect wrapping",
    group: 0,
  };
}

function geometrySuggestions(includeMiddle: boolean): CompletionSuggestion[] {
  const out: CompletionSuggestion[] = [
    { label: "full", insertText: "full", kind: "value", detail: "the axis's unit count", group: 0 },
    { label: "half", insertText: "half", kind: "value", detail: "half the axis's unit count", group: 0 },
  ];
  if (includeMiddle) {
    out.push({
      label: "middle",
      insertText: "middle",
      kind: "value",
      detail: "horizontally centered (x of Text/Icon only)",
      group: 0,
    });
  }
  return out;
}

function previousSiblingIsIf(lines: string[], lineIndex: number, indent: number): boolean {
  for (let i = lineIndex - 1; i >= 0; i--) {
    if (isBlankOrComment(lines[i])) continue;
    const siblingIndent = indentOf(lines[i]);
    if (siblingIndent > indent) continue;
    return siblingIndent === indent && /^If[ \t]*:/.test(lines[i].trim());
  }
  return false;
}

interface CallArgumentContext {
  templateName: string;
  params: ScannedTemplateParam[];
  /** Set for a continuation line beneath `argument: expression`. */
  argumentName: string | null;
}

function previousLessIndentedLine(
  lines: string[],
  fromLine: number,
  indent: number,
): { line: number; indent: number; body: string } | null {
  for (let i = fromLine - 1; i >= 0; i--) {
    if (isBlankOrComment(lines[i])) continue;
    const candidateIndent = indentOf(lines[i]);
    if (candidateIndent >= indent) continue;
    return { line: i, indent: candidateIndent, body: lines[i].trim() };
  }
  return null;
}

/** Locate the explicit argument block surrounding the cursor. Both
 * `Front: Name`/`Back: Name` and nested `Name:` calls use the same child
 * `name: expression` spelling. */
function callArgumentContext(
  lines: string[],
  lineIndex: number,
  indent: number,
): CallArgumentContext | null {
  const parent = previousLessIndentedLine(lines, lineIndex, indent);
  if (!parent) return null;

  const targetOf = (body: string): string | null => {
    const face = /^(?:Front|Back)[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9_]*)[ \t]*(?:#.*)?$/.exec(
      body,
    );
    const nested = /^([A-Za-z][A-Za-z0-9_]*)[ \t]*:[ \t]*(?:#.*)?$/.exec(body);
    const target = face?.[1] ?? nested?.[1] ?? null;
    if (
      target === null ||
      [
        "Template", "Card", "Front", "Back", "Rectangle", "Text", "TextBox", "Icon",
        "Image", "Qr", "Repeat", "If", "Else",
      ].includes(target)
    ) {
      return null;
    }
    return target;
  };

  // A continuation line first sees its argument line. Look one level farther
  // for the surrounding call before interpreting a bare `name:` as a nested
  // call of its own; this also supports uppercase parameter names.
  const argument = /^([A-Za-z][A-Za-z0-9_]*)[ \t]*:/.exec(parent.body);
  const grandparent = previousLessIndentedLine(lines, parent.line, parent.indent);
  const grandTarget = grandparent ? targetOf(grandparent.body) : null;
  if (argument && grandTarget !== null) {
    const params = scanTemplateParams(lines, grandTarget);
    if (params.some((param) => param.name === argument[1])) {
      return { templateName: grandTarget, params, argumentName: argument[1] };
    }
  }

  const templateName = targetOf(parent.body);
  if (templateName === null) return null;
  return { templateName, params: scanTemplateParams(lines, templateName), argumentName: null };
}

function parameterTypeSuggestions(snapshot: CompletionSnapshot): CompletionSuggestion[] {
  const out: CompletionSuggestion[] = ["Text", "Number", "Bool", "Color"].map(
    (name) => ({
      label: name,
      insertText: name,
      kind: "value",
      detail: "built-in parameter type",
      group: 0,
    }),
  );
  for (const en of snapshot.enums) {
    out.push({
      label: en.name,
      insertText: en.name,
      kind: "enum",
      detail: `enum parameter type — ${en.cases.length} cases`,
      group: 0,
    });
  }
  return out;
}

function argumentValueSuggestions(
  param: ScannedTemplateParam | undefined,
  beforeWord: string,
  scope: RefScope,
  snapshot: CompletionSnapshot,
): CompletionSuggestion[] {
  if (param?.type === "Color") {
    return [...colorSuggestions(), ...expressionExtras(beforeWord, scope, snapshot)];
  }
  const enumDecl = param ? snapshot.enums.find((en) => en.name === param.type) : undefined;
  if (enumDecl) {
    return [
      ...enumDecl.cases.map((name) => ({
        label: name,
        insertText: name,
        kind: "enumCase" as const,
        detail: `${enumDecl.name} case`,
        group: 0 as const,
      })),
      ...expressionExtras(beforeWord, scope, snapshot),
    ];
  }
  return expressionExtras(beforeWord, scope, snapshot);
}

function nodeSuggestions(
  lines: string[],
  lineIndex: number,
  indent: number,
  colonFollows: boolean,
  templates: string[],
  enclosingTemplate: string | null,
  allowParams: boolean,
): CompletionSuggestion[] {
  const out = keySuggestions(ELEMENT_OPENERS, colonFollows, true);
  if (allowParams) {
    out.push({
      label: "param",
      insertText: "param ${1:name}: ${2:Text}",
      snippet: true,
      kind: "keyword",
      detail: "param <name>: <Type> — immutable, required Template parameter",
      group: 0,
    });
  }
  out.push({
    label: "let",
    insertText: "let ",
    kind: "keyword",
    detail: "let <name>: <expression> — immutable local binding",
    group: 0,
  });
  if (previousSiblingIsIf(lines, lineIndex, indent)) {
    out.push({
      label: "Else",
      insertText: colonFollows ? "Else" : "Else:",
      kind: "keyword",
      detail: "optional branch paired with the preceding If",
      group: 0,
    });
  }
  for (const name of templates) {
    // `If:` and `Else:` are structural in node position. Templates carrying
    // those names remain valid direct Front:/Back: values, but have no nested
    // shorthand spelling.
    if (name === "If" || name === "Else" || name === enclosingTemplate) continue;
    out.push({
      // Keep the contextual binding keyword and a Template named `let`
      // independently selectable after label-based deduplication.
      label: name === "let" ? "let:" : name,
      insertText: colonFollows ? name : `${name}:`,
      kind: "template",
      detail: "Template call — pass parameters in an indented argument block",
      group: 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

const NO_SUGGESTIONS: CompletionSuggestion[] = [];

export function computeCompletions(
  text: string,
  offset: number,
  snapshot: CompletionSnapshot,
): CompletionResult {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const lines = text.split("\n");
  let lineStart = 0;
  let lineIndex = 0;
  for (; lineIndex < lines.length; lineIndex++) {
    const end = lineStart + lines[lineIndex].length;
    if (clamped <= end) break;
    lineStart = end + 1; // past the newline
  }
  if (lineIndex >= lines.length) {
    lineIndex = lines.length - 1;
    lineStart = text.length - lines[lineIndex].length;
  }
  const line = lines[lineIndex];
  const col = clamped - lineStart;
  const before = line.slice(0, col);

  // Word segment around the cursor (identifier chars) — the default replace
  // range; string/code contexts override it below.
  let wordStart = col;
  while (wordStart > 0 && WORD_CHAR.test(line[wordStart - 1])) wordStart--;
  let wordEnd = col;
  while (wordEnd < line.length && WORD_CHAR.test(line[wordEnd])) wordEnd++;
  const empty = (): CompletionResult => ({
    suggestions: NO_SUGGESTIONS,
    replaceStart: lineStart + wordStart,
    replaceEnd: lineStart + wordEnd,
  });
  const result = (suggestions: CompletionSuggestion[]): CompletionResult => ({
    suggestions: dedupeByLabel(suggestions),
    replaceStart: lineStart + wordStart,
    replaceEnd: lineStart + wordEnd,
  });

  const state = scanLineState(line, col);
  if (state.inComment) return empty();

  const indent = indentOf(line);
  const ancestors = scanAncestors(lines, lineIndex, indent);
  const currentTemplates = [
    ...snapshot.templates,
    ...scanDeclaredTemplates(lines).filter((name) => !snapshot.templates.includes(name)),
  ];
  const currentSnapshot = { ...snapshot, templates: currentTemplates };
  const globalLetContext =
    (indent === 0 && /^[ \t]*let[ \t]+[A-Za-z][A-Za-z0-9_]*[ \t]*:/.test(line)) ||
    (ancestors.topKind === null && ancestors.continuationKey === "let");

  // -- inside [brackets] — data refs, in or out of strings (◆30) ------------
  // `[[` is the literal-`[` escape (§3.5): pairs cancel, so only an ODD run
  // of `[` leaves a real ref opener ("a [[[cost]" is escape + ref).
  const bracket = /(\[+)[A-Za-z0-9_]*$/.exec(before);
  if (bracket && bracket[1].length % 2 === 1) {
    const scope = resolveRefScope(lines, ancestors, currentSnapshot, globalLetContext);
    return result(bracketSuggestions(scope));
  }

  // -- inside a string ------------------------------------------------------
  // Current line's `key:` (property or block header), when the cursor is past
  // the colon.
  const letLine = /^[ \t]*let[ \t]+[A-Za-z][A-Za-z0-9_]*[ \t]*:/.exec(line);
  const paramLine = /^[ \t]*param[ \t]+[A-Za-z][A-Za-z0-9_]*[ \t]*:/.exec(line);
  const virtualLine = /^[ \t]*virtual[ \t]+column[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*:/.exec(line);
  const propLine = /^[ \t]*(?:column[ \t]+([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))[ \t]*:/.exec(
    line,
  );
  const colonIndex = letLine
    ? letLine[0].length
    : paramLine
      ? paramLine[0].length
      : virtualLine
        ? virtualLine[0].length
        : propLine
          ? propLine[0].length
          : -1;
  const virtualEquals = virtualLine ? line.indexOf("=", virtualLine[0].length) : -1;
  const currentKey =
    col >= colonIndex && colonIndex >= 0
      ? letLine
        ? "let"
        : paramLine
          ? "param"
          : virtualLine
            ? virtualEquals >= 0 && col > virtualEquals
              ? "virtual"
              : "column"
          : propLine![1] !== undefined
            ? "column"
            : propLine![2]
      : null;

  if (state.inString) {
    const key = currentKey ?? ancestors.continuationKey;
    if (key === "text") {
      // Resolved-text color scopes are their own tiny language inside text:
      // after the opening brace offer the paired scope, and after `color:`
      // reuse the exact Color vocabulary used by element properties. The
      // bracket-ref branch above still wins, including inside these scopes.
      // An escaped `{{` must remain literal and therefore gets no scope menu.
      const stringBefore = line.slice(state.stringOpenCol, col);
      const braceRun = /\{+$/.exec(stringBefore)?.[0] ?? "";
      if (braceRun.length % 2 === 1) {
        return result([colorScopeSuggestion()]);
      }
      if (/(?:^|[^\{])\{color:[A-Za-z0-9_]*$/.test(stringBefore)) {
        return result(colorSuggestions());
      }
    }
    if (key === "code") {
      // Replace the whole string content: codes may contain spaces. On an
      // unclosed string the range runs to end of line, minus any CRLF `\r`
      // (split on "\n" leaves it) — the range must never cover the newline.
      const closing = line.indexOf('"', state.stringOpenCol);
      const lineEnd = line.endsWith("\r") ? line.length - 1 : line.length;
      return {
        suggestions: iconCodeSuggestions(),
        replaceStart: lineStart + state.stringOpenCol,
        replaceEnd: lineStart + (closing >= 0 ? closing : lineEnd),
      };
    }
    return empty();
  }

  // -- Enum.| case qualification (trigger ".") ------------------------------
  const dotted = /([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z0-9_]*$/.exec(before);
  if (dotted) {
    const en = currentSnapshot.enums.find((e) => e.name === dotted[1]);
    if (!en) return empty();
    return result(
      en.cases.map((c) => ({
        label: c,
        insertText: c,
        kind: "enumCase" as const,
        detail: `${en.name} case`,
        group: 0 as const,
      })),
    );
  }

  const scope = () => resolveRefScope(lines, ancestors, currentSnapshot, globalLetContext);
  const beforeWord = before.slice(0, wordStart);
  const callArgs = callArgumentContext(lines, lineIndex, indent);

  // -- value position on the current line -----------------------------------
  if (currentKey !== null) {
    if (currentKey === "param") {
      return result(parameterTypeSuggestions(currentSnapshot));
    }
    if (callArgs !== null) {
      const param = callArgs.params.find((candidate) => candidate.name === currentKey);
      return result(argumentValueSuggestions(param, beforeWord, scope(), currentSnapshot));
    }
    if (
      !["let", "If", "Else", "Repeat"].includes(currentKey) &&
      (ancestors.innermost === "Template" ||
        ancestors.innermost === "Repeat" ||
        ancestors.innermost === "If" ||
        ancestors.innermost === "Else")
    ) {
      // Any otherwise-unclaimed identifier header in template-node position
      // is a Template call, including lowercase names. Its value belongs in
      // indented argument lines rather than after this colon.
      return empty();
    }
    return result(
      valueSuggestions(
        currentKey,
        line.slice(colonIndex, col),
        beforeWord,
        ancestors,
        scope,
        currentSnapshot,
      ),
    );
  }

  // -- value continuation (deeper-indented expression lines, ◆23†) ----------
  if (callArgs !== null && callArgs.argumentName !== null) {
    const param = callArgs.params.find(
      (candidate) => candidate.name === callArgs.argumentName,
    );
    return result(argumentValueSuggestions(param, beforeWord, scope(), currentSnapshot));
  }
  if (ancestors.continuationKey !== null) {
    return result(
      valueSuggestions(
        ancestors.continuationKey,
        before,
        beforeWord,
        ancestors,
        scope,
        currentSnapshot,
      ),
    );
  }

  // -- property-key position (start of line, only indent + partial word) ----
  if (/^[ \t]*[A-Za-z_]?[A-Za-z0-9_]*$/.test(before)) {
    // `let <name>` is a naming position, not a keyword/value position.
    if (/^[ \t]*let(?:[ \t]+[A-Za-z][A-Za-z0-9_]*)?[ \t]*$/.test(before)) return empty();
    if (/^[ \t]*param(?:[ \t]+[A-Za-z][A-Za-z0-9_]*)?[ \t]*$/.test(before)) return empty();
    const colonFollows = /^[ \t]*:/.test(line.slice(wordEnd));
    if (callArgs !== null) {
      return result(
        keySuggestions(
          callArgs.params.map((param) => ({
            key: param.name,
            detail: `${param.type} parameter for ${callArgs.templateName}`,
          })),
          colonFollows,
          false,
        ),
      );
    }
    switch (ancestors.innermost) {
      case "Rectangle":
      case "Text":
      case "TextBox":
      case "Icon":
      case "Image":
      case "Qr":
        return result(keySuggestions(ELEMENT_KEYS[ancestors.innermost], colonFollows, false));
      case "Card": {
        const suggestions = CARD_KEYS.map(({ key, detail }) => ({
          label: key,
          insertText: colonFollows ? key : `${key}: `,
          kind: "property" as const,
          detail,
          group: 0 as const,
        }));
        return result(suggestions);
      }
      case "Template":
      case "Repeat":
      case "If":
      case "Else":
        return result(
          nodeSuggestions(
            lines,
            lineIndex,
            indent,
            colonFollows,
            currentTemplates,
            ancestors.topKind === "Template" ? ancestors.topName : null,
            ancestors.innermost === "Template",
          ),
        );
      case "Sheet":
        return result([
          {
            label: "column",
            insertText: "column ",
            kind: "property",
            detail: "column <name>: Text | Number | <Enum>",
            group: 0,
          },
          {
            label: "virtual column",
            insertText: "virtual column ${1:name}: ${2:Text} = ${3:\"[card]\"}",
            snippet: true,
            kind: "property",
            detail: "computed export-only column",
            group: 0,
          },
        ]);
      case "Enum":
        return result([
          { label: "case", insertText: "case ", kind: "property", detail: "case <Name>", group: 0 },
        ]);
      case null:
        if (indent === 0) {
          return result([
            ...keySuggestions(TOP_LEVEL_OPENERS, colonFollows, true),
            {
              label: "let",
              insertText: "let ",
              kind: "keyword",
              detail: "let <name>: <expression> — immutable global binding",
              group: 0,
            },
          ]);
        }
        return empty(); // unplaceable mid-indent position — silence beats noise
    }
  }

  return empty();
}

// ---------------------------------------------------------------------------
// Value-position dispatch
// ---------------------------------------------------------------------------

/**
 * Suggestions for the value of `key`, given the text between the colon and
 * the cursor (`afterColon` — for continuations, the continuation line's
 * before-cursor text, which serves the same token checks).
 */
function valueSuggestions(
  key: string,
  afterColon: string,
  beforeWord: string,
  ancestors: Ancestors,
  scope: () => RefScope,
  snapshot: CompletionSnapshot,
): CompletionSuggestion[] {
  switch (key) {
    // ---- block headers: naming positions, no completions ------------------
    case "Enum":
    case "Sheet":
    case "Template":
    case "Card":
    case "Rectangle":
    case "Text":
    case "TextBox":
    case "Icon":
    case "Image":
    case "Qr":
      return NO_SUGGESTIONS;
    case "Repeat":
      // `Repeat: <Number expr> as <var>` — expression until `as`, then naming.
      if (/\bas[ \t]+[A-Za-z0-9_]*$/.test(afterColon) || /\bas[ \t]*$/.test(afterColon)) {
        return NO_SUGGESTIONS;
      }
      return expressionExtras(beforeWord, scope(), snapshot);
    case "If":
      return expressionExtras(beforeWord, scope(), snapshot);
    case "Else":
      return NO_SUGGESTIONS;
    case "let":
      return expressionExtras(beforeWord, scope(), snapshot);
    case "virtual":
      return expressionExtras(beforeWord, scope(), snapshot);
    case "Front":
    case "Back":
      return snapshot.templates.map((t) => ({
        label: t,
        insertText: t,
        kind: "template" as const,
        detail: "Template",
        group: 0 as const,
      }));

    // ---- Card properties ---------------------------------------------------
    case "sheet":
      return snapshot.sheets.map((s) => ({
        label: s.name,
        insertText: s.name,
        kind: "sheet" as const,
        detail: `Sheet — ${s.columns.length} column${s.columns.length === 1 ? "" : "s"}`,
        group: 0 as const,
      }));
    case "size": {
      if (ancestors.elementKind !== null) {
        // Text/Icon `size:` is a geometry Number, not a preset.
        return [
          ...geometrySuggestions(false),
          ...expressionExtras(beforeWord, scope(), snapshot),
        ];
      }
      const presets: CompletionSuggestion[] = [...SIZE_PRESETS.values()].map((p) => ({
        label: p.name,
        insertText: p.name,
        kind: "sizePreset" as const,
        detail: `${p.widthMm} × ${p.heightMm} mm`,
        group: 0 as const,
      }));
      if (ancestors.innermost === "Card") return presets;
      // Block unknown (broken code): offer both readings.
      return [...presets, ...geometrySuggestions(false)];
    }
    case "loop": {
      if (/^[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]+as([ \t]|$)/.test(afterColon)) {
        return NO_SUGGESTIONS; // naming the variable
      }
      if (/^[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]+[A-Za-z0-9_]*$/.test(afterColon)) {
        return [{ label: "as", insertText: "as ", kind: "keyword", detail: "loop: <Enum> as <variable>", group: 0 }];
      }
      return snapshot.enums.map((e) => ({
        label: e.name,
        insertText: e.name,
        kind: "enum" as const,
        detail: `enum — ${e.cases.length} case${e.cases.length === 1 ? "" : "s"}`,
        group: 0 as const,
      }));
    }
    case "y_units":
      return [
        { label: "auto", insertText: "auto", kind: "value", detail: "square units (may be fractional)", group: 0 },
      ];
    case "x_units":
      return NO_SUGGESTIONS; // positive integer literal
    case "width_mm":
    case "height_mm":
      return NO_SUGGESTIONS; // positive number literal (millimetres)
    case "count":
      return expressionExtras(beforeWord, scope(), snapshot);

    // ---- element properties ------------------------------------------------
    case "x": {
      // `middle` must be the WHOLE value (E007), and only Text/Icon have the
      // pivot sugar (§3.4) — Rectangle, Image, TextBox (which has align:,
      // §3.3 M3), and Qr (§7.1a) get plain geometry. An unknown block
      // (broken code) keeps offering it. full/half are Numbers and stay
      // legal mid-expression.
      const bareValue = /^[ \t]*[A-Za-z0-9_]*$/.test(afterColon);
      const middleOk =
        ancestors.elementKind !== "Rectangle" &&
        ancestors.elementKind !== "Image" &&
        ancestors.elementKind !== "TextBox" &&
        ancestors.elementKind !== "Qr";
      return [
        ...geometrySuggestions(middleOk && bareValue),
        ...expressionExtras(beforeWord, scope(), snapshot),
      ];
    }
    case "y":
      return [
        ...geometrySuggestions(false),
        ...expressionExtras(beforeWord, scope(), snapshot),
      ];
    case "width":
    case "height": {
      // Image only (§3.3 auto dimension): `auto` must be the WHOLE value,
      // like `x: middle`, so it is offered only as a bare value inside an
      // Image block — Rectangle width and Text/Icon size never see it, and
      // mid-expression positions don't either.
      const out = geometrySuggestions(false);
      if (
        ancestors.elementKind === "Image" &&
        /^[ \t]*[A-Za-z0-9_]*$/.test(afterColon)
      ) {
        out.push({
          label: "auto",
          insertText: "auto",
          kind: "value",
          detail: "derived from the art's aspect ratio (Image only)",
          group: 0,
        });
      }
      return [...out, ...expressionExtras(beforeWord, scope(), snapshot)];
    }
    case "color":
      return [...colorSuggestions(), ...expressionExtras(beforeWord, scope(), snapshot)];
    case "background":
      // Qr only (§7.1a): the same Color vocabulary as color:.
      return [...colorSuggestions(), ...expressionExtras(beforeWord, scope(), snapshot)];
    case "pivot": {
      // Nine-point pivots (§3.4, M3): the nine canonical tokens plus the
      // `center` shorthand, on every drawable element. Reversed word orders
      // (`center_bottom` ≡ `bottom_center`) and the legacy Text/Icon words
      // (left | middle | right — the top row) stay ACCEPTED by the checker
      // but are not offered: one spelling per point keeps the menu
      // scannable (documented decision).
      const pivots: CompletionSuggestion[] = PIVOT_TOKENS.map((a) => ({
        label: a,
        insertText: a,
        kind: "value" as const,
        detail:
          a === DEFAULT_PIVOT_TOKEN
            ? "pivot point (the default)"
            : "pivot point (either word order works)",
        group: 0 as const,
      }));
      pivots.push({
        label: "center",
        insertText: "center",
        kind: "value",
        detail: "shorthand for center_center",
        group: 0,
      });
      return pivots;
    }
    case "align":
      // TextBox only (§3.3, M3): where lines sit within the box's width.
      return ["left", "middle", "right"].map((a) => ({
        label: a,
        insertText: a,
        kind: "value" as const,
        detail: a === "left" ? "align (the default)" : "align",
        group: 0 as const,
      }));
    case "overflow":
      // TextBox only (§3.3, M3): two modes, closed vocabulary.
      return TEXTBOX_OVERFLOWS.map((o) => ({
        label: o,
        insertText: o,
        kind: "value" as const,
        detail:
          o === DEFAULT_TEXTBOX_OVERFLOW
            ? "drop lines that don't fit (the default)"
            : `shrink the size (to a ${Math.round(SHRINK_FLOOR * 100)}% floor) until the text fits`,
        group: 0 as const,
      }));
    case "line_height":
      return NO_SUGGESTIONS; // positive number literal (× size)
    case "style":
      // Icon only (§3.3): the ten Dicier faces, closed vocabulary.
      return ICON_STYLES.map((s) => ({
        label: s,
        insertText: s,
        kind: "value" as const,
        detail: s === DEFAULT_ICON_STYLE ? "Dicier face (the default)" : "Dicier face",
        group: 0 as const,
      }));
    case "font":
      // Text/TextBox only (§3.3, M3 — ◆41): the nine repo-bundled faces
      // (geist + eight uploaded by the owner as a pragmatic unblock),
      // closed vocabulary like style/fit/level.
      return FONT_FACES.map((f) => ({
        label: f,
        insertText: f,
        kind: "value" as const,
        detail: f === DEFAULT_FONT ? "font face (the default)" : "font face",
        group: 0 as const,
      }));
    case "fit":
      // Image only (§3.3, M2): three fit modes, closed vocabulary.
      return IMAGE_FITS.map((f) => ({
        label: f,
        insertText: f,
        kind: "value" as const,
        detail: f === DEFAULT_IMAGE_FIT ? "image fit (the default)" : "image fit",
        group: 0 as const,
      }));
    case "level":
      // Qr only (§7.1a): the four error-correction levels, closed vocabulary.
      return QR_LEVELS.map((l) => ({
        label: l,
        insertText: l,
        kind: "value" as const,
        detail: l === DEFAULT_QR_LEVEL ? "QR error correction (the default)" : "QR error correction",
        group: 0 as const,
      }));
    case "text":
    case "code":
    case "src":
    case "data":
      // Outside the string: an expression (in-string handled by the caller).
      return expressionExtras(beforeWord, scope(), snapshot);

    // ---- Sheet: `column <name>: <type>` ------------------------------------
    case "column": {
      const builtins: CompletionSuggestion[] = [
        { label: "Text", insertText: "Text", kind: "value", detail: "built-in column type", group: 0 },
        { label: "Number", insertText: "Number", kind: "value", detail: "built-in column type", group: 0 },
      ];
      return [
        ...builtins,
        ...snapshot.enums.map((e) => ({
          label: e.name,
          insertText: e.name,
          kind: "enum" as const,
          detail: "enum column — dropdown in the grid",
          group: 0 as const,
        })),
      ];
    }
    case "case":
      return NO_SUGGESTIONS; // naming a new case

    default:
      // Unknown key (typo mid-edit): generic expression vocabulary.
      return expressionExtras(beforeWord, scope(), snapshot);
  }
}
