/**
 * Binder + type checker for Goblin script (DESIGN.md §3.2–§3.8, §4.1).
 *
 * `check(program)` resolves every name, types every expression, and emits the
 * compile-time diagnostics E002–E008 and W001–W004 (E001 is the parser's).
 * It also returns a `Bindings` artifact — resolution and typing keyed by AST
 * node — sufficient for the evaluator (task 3) to generate cards WITHOUT
 * re-implementing any resolution:
 *
 * - Templates receive data ambiently and are checked PER USING CARD (⚑5,
 *   §3.6): a template used by two Cards is checked twice, once in each Card's
 *   context, and its expressions may resolve/type differently each time. All
 *   per-expression information therefore lives in `CardBindings`, one per
 *   Card declaration; identical diagnostics at the same range are deduped.
 *
 * - NAMESPACE CLARIFICATION (spec addition, 2026-08): ALL declared names —
 *   Enums, Sheets, Templates, and Cards — share ONE global namespace; any
 *   collision is E005. Rationale: bare-name resolution (`sheet: Monsters`,
 *   `loop: Suit`, `Front: MonsterFront`) and error messages stay unambiguous.
 *   Duplicate columns within a Sheet, duplicate cases within an Enum, and
 *   duplicate loop variables within a Card are E005 too.
 *
 * - Bare identifiers resolve by EXPECTED TYPE (◆14†, ◆21†, ◆30†, §3.5):
 *   Color positions see CSS color names, Enum-typed positions see that enum's
 *   cases, geometry (Number) positions see `full`/`half`. Where no expected
 *   type is derivable, a bare enum case resolves only if globally unique
 *   (else E004); a name matching nothing is E002.
 */

import type {
  CardDecl,
  ColumnDecl,
  DataRef,
  ElementNode,
  EnumDecl,
  Expr,
  FaceNode,
  IdentifierExpr,
  NumberLit,
  Program,
  PropertyNode,
  QualifiedName,
  RepeatNode,
  SheetDecl,
  StringLit,
  StringRefPart,
  TemplateDecl,
  TemplateNode,
} from "./ast";
import type { Diagnostic, Range, Severity } from "./diagnostics";
import type { IconStyle, ImageFit } from "./model";
import { ICON_STYLES, IMAGE_FITS } from "./model";
import { CSS_COLOR_NAMES } from "./css-colors";
import { DICIER_CODES } from "./dicier-codes";

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

/** A value's static type (§3.5). `Unknown` is the poison type: an error was
 * already reported (or the context is unavailable) — downstream checks skip it
 * so one mistake yields one diagnostic. */
export type ValueType =
  | { kind: "Number" }
  | { kind: "Text" }
  | { kind: "Bool" }
  | { kind: "Color" }
  | { kind: "Enum"; enumName: string }
  | { kind: "Unknown" };

const NUMBER: ValueType = { kind: "Number" };
const TEXT: ValueType = { kind: "Text" };
const BOOL: ValueType = { kind: "Bool" };
const COLOR: ValueType = { kind: "Color" };
const UNKNOWN: ValueType = { kind: "Unknown" };
const enumType = (enumName: string): ValueType => ({ kind: "Enum", enumName });

/** Human-readable type name for messages. */
export function typeName(t: ValueType): string {
  return t.kind === "Enum" ? `enum ${t.enumName}` : t.kind;
}

/** What a Ref / bare Identifier / Qualified name / string-interpolation part
 * resolved to, in one Card's context. */
export type Resolution =
  | { kind: "column"; sheet: string; column: string; type: ValueType }
  | { kind: "loopVar"; enumName: string | null }
  | { kind: "repeatVar" }
  | { kind: "enumCase"; enumName: string; caseName: string }
  | { kind: "colorName"; name: string }
  | { kind: "geometry"; keyword: "full" | "half" | "middle" }
  | { kind: "anchor"; keyword: "left" | "middle" | "right" }
  | { kind: "iconStyle"; style: IconStyle }
  | { kind: "imageFit"; fit: ImageFit };

/** AST nodes that get an entry in `CardBindings.resolutions`. */
export type ResolvableNode = DataRef | IdentifierExpr | QualifiedName | StringRefPart;

export interface ColumnInfo {
  decl: ColumnDecl;
  /** Text | Number | Enum; Unknown when the type name did not resolve (E002). */
  type: ValueType;
}

export interface SheetInfo {
  decl: SheetDecl;
  /** Column name → info; first declaration wins on E005 duplicates. */
  columns: ReadonlyMap<string, ColumnInfo>;
}

/** One physical size (§3.4): a named preset, or `name: "custom"` when the
 * Card declared a `width_mm:`/`height_mm:` pair instead (M2). */
export interface SizePreset {
  name: string;
  widthMm: number;
  heightMm: number;
}

/** The five presets (§3.4). Exported for the evaluator/renderer. */
export const SIZE_PRESETS: ReadonlyMap<string, SizePreset> = new Map([
  ["poker", { name: "poker", widthMm: 63.5, heightMm: 88.9 }],
  ["bridge", { name: "bridge", widthMm: 57.15, heightMm: 88.9 }],
  ["tarot", { name: "tarot", widthMm: 70, heightMm: 120 }],
  ["square", { name: "square", widthMm: 70, heightMm: 70 }],
  ["mini", { name: "mini", widthMm: 44, heightMm: 63.5 }],
]);

export interface LoopBinding {
  /** The `as` variable name. */
  variable: string;
  varRange: Range;
  /** null when the enum name did not resolve (E002 already emitted). */
  enumDecl: EnumDecl | null;
  property: PropertyNode;
}

/** Everything the generator needs about one Card declaration (§3.7). All the
 * `null`s mean "did not resolve / not given" — a diagnostic already covers it
 * (except `back`, where null legitimately means the plain white default ◆16). */
export interface CardBindings {
  decl: CardDecl;
  sheet: SheetInfo | null;
  size: SizePreset | null;
  xUnits: number | null;
  /** "auto" (units square, fractional row count ⚑7†) or an explicit integer. */
  yUnits: number | "auto" | null;
  /** In declaration order (nested cross-product ◆25). */
  loops: readonly LoopBinding[];
  /** null → count defaults to 1. */
  countExpr: Expr | null;
  front: TemplateDecl | null;
  back: TemplateDecl | null;
  /** Static type of every expression checked in THIS card's context
   * (the card's own `count:` plus both face templates' bodies). */
  exprTypes: ReadonlyMap<Expr, ValueType>;
  /** Resolution of every ref/bare name/qualified name in this card's context. */
  resolutions: ReadonlyMap<ResolvableNode, Resolution>;
}

export interface Bindings {
  /** First declaration wins where E005 collisions exist. */
  enums: ReadonlyMap<string, EnumDecl>;
  sheets: ReadonlyMap<string, SheetInfo>;
  templates: ReadonlyMap<string, TemplateDecl>;
  /** One entry per Card declaration, in source order (duplicates included —
   * the generator iterates declarations, not names). */
  cards: readonly CardBindings[];
  /** Which Cards use each template (Front/Back that resolved to it). */
  templateUsage: ReadonlyMap<TemplateDecl, readonly CardDecl[]>;
}

export interface CheckResult {
  diagnostics: Diagnostic[];
  bindings: Bindings;
}

/** Source-order comparator shared with the parser's ordering convention. */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    a.range.startLine - b.range.startLine ||
    a.range.startCol - b.range.startCol ||
    a.range.endLine - b.range.endLine ||
    a.range.endCol - b.range.endCol
  );
}

/** Bind + type check a parsed program. Never throws (⚑8): expression depth is
 * budgeted (MAX_EXPR_DEPTH), and any residual internal failure degrades to a
 * single synthetic diagnostic instead of an exception. */
export function check(program: Program): CheckResult {
  try {
    return new Checker().run(program);
  } catch (err) {
    // Last resort — never-throws is structural, not best-effort. E000 is
    // deliberately OUTSIDE the §3.8 catalog: it marks a checker bug, never a
    // user error, and the depth budget makes it unreachable for known inputs.
    const message = err instanceof Error ? err.message : String(err);
    return {
      diagnostics: [
        {
          code: "E000",
          severity: "error",
          message: `Internal checker error: ${message}`,
          range: program.range,
        },
      ],
      bindings: {
        enums: new Map(),
        sheets: new Map(),
        templates: new Map(),
        cards: [],
        templateUsage: new Map(),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Expected type of a position — drives bare-name resolution (§3.5). "None"
 * marks an underivable position (e.g. a bare identifier as a `text:` value),
 * where enum cases fall back to global uniqueness (E004 when ambiguous). */
type Expected =
  | { kind: "None" }
  | { kind: "Number" }
  | { kind: "Text" }
  | { kind: "Bool" }
  | { kind: "Color" }
  | { kind: "Enum"; enumDecl: EnumDecl };

const EXP_NONE: Expected = { kind: "None" };
const EXP_NUMBER: Expected = { kind: "Number" };
const EXP_TEXT: Expected = { kind: "Text" };
const EXP_BOOL: Expected = { kind: "Bool" };
const EXP_COLOR: Expected = { kind: "Color" };

const GEOMETRY_WORDS: ReadonlySet<string> = new Set(["full", "half", "middle", "auto"]);

/** Recursion budget for expression typing. The parser caps its own NESTING
 * the same way (⚑8), but binary chains parse iteratively, so a 10k-term
 * `1 + 1 + …` arrives here as a 10k-deep left spine: the budget poisons it
 * to Unknown with one diagnostic instead of a RangeError. Reported as E003 —
 * the §3.8 catalog has no resource-limit code, and this is an expression-
 * level failure surfaced once per property value. */
const MAX_EXPR_DEPTH = 500;

const CARD_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  "sheet",
  "size",
  "width_mm",
  "height_mm",
  "x_units",
  "y_units",
  "loop",
  "count",
]);

/** Membership set over the §3.3 ICON_STYLES vocabulary (ten Dicier faces). */
const ICON_STYLE_SET: ReadonlySet<string> = new Set(ICON_STYLES);

/** Membership set over the §3.3 IMAGE_FITS vocabulary (three fit modes). */
const IMAGE_FIT_SET: ReadonlySet<string> = new Set(IMAGE_FITS);

interface ElementSpec {
  required: readonly string[];
  optional: readonly string[];
}

/** §3.3 property tables. Text/Icon color defaults to black, anchor to left;
 * Icon style defaults to flat_dark, Image fit to contain (M2). */
const ELEMENT_SPECS: Record<ElementNode["element"], ElementSpec> = {
  Rectangle: { required: ["x", "y", "width", "height", "color"], optional: [] },
  Text: { required: ["x", "y", "size", "text"], optional: ["color", "anchor"] },
  Icon: { required: ["x", "y", "size", "code"], optional: ["color", "anchor", "style"] },
  Image: { required: ["x", "y", "width", "height", "src"], optional: ["fit"] },
};

/** Mutable recording target while checking in one Card's context; null during
 * the structural pass over unused templates (nothing to evaluate later). */
interface Recorder {
  exprTypes: Map<Expr, ValueType>;
  resolutions: Map<ResolvableNode, Resolution>;
}

/** Name-resolution context for `[refs]` and bare identifiers (§3.6). A null
 * `sheet` means the context has no usable column set (unknown/missing sheet,
 * or an unused template with no Card at all): column lookups poison silently —
 * the cause already carries its own diagnostic. */
interface Ctx {
  sheet: SheetInfo | null;
  loops: ReadonlyMap<string, LoopBinding>;
  /** Innermost-last stack of enclosing Repeat variables. */
  repeats: { name: string; range: Range }[];
  record: Recorder | null;
}

class Checker {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly seen = new Set<string>();
  /** >0 during a trial typing pass (trialType): diagnostics, recording, and
   * usage marking are all suppressed. */
  private silent = 0;
  /** Current typeOf recursion depth against MAX_EXPR_DEPTH. */
  private exprDepth = 0;
  /** One budget-breach diagnostic per property value (reset in checkValue). */
  private depthReported = false;

  private readonly enums = new Map<string, EnumDecl>();
  private readonly sheets = new Map<string, SheetInfo>();
  private readonly templates = new Map<string, TemplateDecl>();
  private readonly globalKinds = new Map<string, string>(); // name → kind word

  private readonly usedEnums = new Set<EnumDecl>();
  private readonly usedSheets = new Set<SheetDecl>();
  private readonly usedTemplates = new Set<TemplateDecl>();
  /** Declarations whose name collided (E005): suppress their W002 — one
   * mistake, one diagnostic. */
  private readonly collided = new Set<EnumDecl | SheetDecl | TemplateDecl | CardDecl>();

  run(program: Program): CheckResult {
    this.collectDeclarations(program);

    const cards: CardBindings[] = [];
    const templateUsage = new Map<TemplateDecl, CardDecl[]>();
    for (const decl of program.declarations) {
      if (decl.kind !== "CardDecl") continue;
      const bound = this.checkCard(decl);
      cards.push(bound);
      for (const tpl of [bound.front, bound.back]) {
        if (!tpl) continue;
        const users = templateUsage.get(tpl) ?? [];
        if (!users.includes(decl)) users.push(decl);
        templateUsage.set(tpl, users);
      }
    }

    // Unused templates: structural checks only (W002 §3.8) — property
    // presence/duplicates, literal types, geometry keywords, icon codes. No
    // Card context exists, so [refs] silently type as Unknown and every
    // context-dependent check is suppressed.
    for (const decl of program.declarations) {
      if (decl.kind !== "TemplateDecl" || this.usedTemplates.has(decl)) continue;
      const ctx: Ctx = { sheet: null, loops: new Map(), repeats: [], record: null };
      this.checkTemplateBody(decl, ctx);
      if (!this.collided.has(decl)) {
        this.warn("W002", `Template '${decl.name.name}' is never used`, decl.name.range);
      }
    }

    // W002 for enums and sheets.
    for (const decl of program.declarations) {
      if (this.collided.has(decl)) continue;
      if (decl.kind === "EnumDecl" && this.enums.get(decl.name.name) === decl && !this.usedEnums.has(decl)) {
        this.warn("W002", `Enum '${decl.name.name}' is never used`, decl.name.range);
      }
      if (decl.kind === "SheetDecl" && this.sheets.get(decl.name.name)?.decl === decl && !this.usedSheets.has(decl)) {
        this.warn("W002", `Sheet '${decl.name.name}' is never bound by a Card`, decl.name.range);
      }
    }

    this.diagnostics.sort(compareDiagnostics);
    return {
      diagnostics: this.diagnostics,
      bindings: {
        enums: this.enums,
        sheets: this.sheets,
        templates: this.templates,
        cards,
        templateUsage,
      },
    };
  }

  // -- diagnostics ----------------------------------------------------------

  /** Emit with dedupe: templates are checked once per using Card (§3.6), so
   * identical findings at the same range collapse to one. Suppressed while a
   * trial pass is running. */
  private report(code: string, severity: Severity, message: string, range: Range): void {
    if (this.silent > 0) return;
    const key = `${code}|${range.startLine}|${range.startCol}|${range.endLine}|${range.endCol}|${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.diagnostics.push({ code, severity, message, range });
  }

  private error(code: string, message: string, range: Range): void {
    this.report(code, "error", message, range);
  }

  private warn(code: string, message: string, range: Range): void {
    this.report(code, "warning", message, range);
  }

  /** W002 usage marking — inert during trial passes so a speculative
   * resolution can never hide a real unused-enum warning. */
  private markEnumUsed(decl: EnumDecl): void {
    if (this.silent === 0) this.usedEnums.add(decl);
  }

  // -- phase 1: declarations (§3.2) -----------------------------------------

  private collectDeclarations(program: Program): void {
    // One global namespace for all declared names (see header comment): first
    // declaration wins, later same-name declarations are E005.
    for (const decl of program.declarations) {
      const name = decl.name.name;
      const existingKind = this.globalKinds.get(name);
      if (existingKind !== undefined) {
        this.error(
          "E005",
          `Duplicate declaration '${name}' — already declared as ${existingKind} (all declared names share one namespace)`,
          decl.name.range,
        );
        this.collided.add(decl);
      } else {
        this.globalKinds.set(name, kindWord(decl.kind));
        if (decl.kind === "EnumDecl") this.enums.set(name, decl);
        else if (decl.kind === "TemplateDecl") this.templates.set(name, decl);
        // Sheets registered below once their columns are resolved; Cards are
        // never referenced by name, so only the namespace entry matters.
      }
      if (decl.kind === "EnumDecl") this.checkEnumCases(decl);
    }
    // Second pass for sheets so column types can reference enums declared
    // later (forward references are allowed, §3.2).
    for (const decl of program.declarations) {
      if (decl.kind !== "SheetDecl") continue;
      const info = this.buildSheetInfo(decl);
      if (!this.sheets.has(decl.name.name) && !this.collided.has(decl)) {
        this.sheets.set(decl.name.name, info);
      }
    }
  }

  private checkEnumCases(decl: EnumDecl): void {
    const seen = new Set<string>();
    for (const c of decl.cases) {
      if (seen.has(c.name.name)) {
        this.error(
          "E005",
          `Duplicate case '${c.name.name}' in enum '${decl.name.name}'`,
          c.name.range,
        );
      } else {
        seen.add(c.name.name);
      }
    }
  }

  private buildSheetInfo(decl: SheetDecl): SheetInfo {
    const columns = new Map<string, ColumnInfo>();
    for (const col of decl.columns) {
      const name = col.name.name;
      if (columns.has(name)) {
        this.error(
          "E005",
          `Duplicate column '${name}' in sheet '${decl.name.name}'`,
          col.name.range,
        );
        continue;
      }
      columns.set(name, { decl: col, type: this.resolveColumnType(col) });
    }
    return { decl, columns };
  }

  private resolveColumnType(col: ColumnDecl): ValueType {
    const name = col.columnType.name;
    if (name === "Text") return TEXT;
    if (name === "Number") return NUMBER;
    const enumDecl = this.enums.get(name);
    if (enumDecl) {
      this.markEnumUsed(enumDecl);
      return enumType(name);
    }
    const other = this.globalKinds.get(name);
    this.error(
      "E002",
      other !== undefined
        ? `'${name}' is ${other}, not a column type — expected Text, Number, or an enum name`
        : `Unknown column type '${name}' — expected Text, Number, or an enum name`,
      col.columnType.range,
    );
    return UNKNOWN;
  }

  // -- phase 2: cards (§3.2, §3.4, §3.7) ------------------------------------

  private checkCard(decl: CardDecl): CardBindings {
    const recorder: Recorder = { exprTypes: new Map(), resolutions: new Map() };
    const seenKeys = new Map<string, Range>();
    const loops: LoopBinding[] = [];
    const loopProps: PropertyNode[] = [];
    let sheet: SheetInfo | null = null;
    let size: SizePreset | null = null;
    let customWidthMm: number | null = null;
    let customHeightMm: number | null = null;
    let xUnits: number | null = null;
    let yUnits: number | "auto" | null = null;
    let yUnitsRange: Range | null = null;
    let countExpr: Expr | null = null;
    let front: TemplateDecl | null = null;
    let back: TemplateDecl | null = null;
    const present = new Set<string>();

    for (const item of decl.items) {
      if (item.kind === "Face") {
        if (present.has(item.face)) {
          this.error("E005", `Duplicate '${item.face}:' on Card '${decl.name.name}'`, item.range);
          continue;
        }
        present.add(item.face);
        const tpl = this.resolveFace(item);
        if (item.face === "Front") front = tpl;
        else back = tpl;
        continue;
      }

      const key = item.key.name;
      // `as` is only meaningful on `loop:` (§3.2) — E007 elsewhere.
      if (item.asVar && key !== "loop") {
        this.error(
          "E007",
          `'as' is only allowed on a Card's 'loop:' property`,
          item.asVar.range,
        );
      }
      if (!CARD_PROPERTY_KEYS.has(key)) {
        this.error("E008", `Unknown property '${key}:' on Card`, item.key.range);
        continue;
      }
      // `loop:` may repeat (multiple loops ◆25); every other key may not.
      if (key !== "loop") {
        const first = seenKeys.get(key);
        if (first) {
          this.error("E005", `Duplicate property '${key}:'`, item.key.range);
          continue;
        }
        seenKeys.set(key, item.key.range);
        present.add(key);
      }

      const value = item.value;
      switch (key) {
        case "sheet": {
          if (value.kind === "Error") break; // E001 already covered it
          if (value.kind === "Identifier") {
            const info = this.sheets.get(value.name);
            if (info) {
              sheet = info;
              this.usedSheets.add(info.decl);
              break;
            }
            const other = this.globalKinds.get(value.name);
            this.error(
              "E002",
              other !== undefined && other !== "a Sheet"
                ? `'${value.name}' is ${other}, not a Sheet`
                : `Unknown sheet '${value.name}'`,
              value.range,
            );
            break;
          }
          this.error("E002", `sheet: must name a Sheet`, value.range);
          break;
        }
        case "size": {
          if (value.kind === "Error") break;
          if (value.kind === "Identifier") {
            const preset = SIZE_PRESETS.get(value.name);
            if (preset) {
              size = preset;
              break;
            }
            this.error(
              "E008",
              `Unknown size preset '${value.name}' — expected poker, bridge, tarot, square, or mini`,
              value.range,
            );
            break;
          }
          this.error(
            "E008",
            `size: must be one of poker, bridge, tarot, square, mini`,
            value.range,
          );
          break;
        }
        case "width_mm":
        case "height_mm": {
          // Custom sizes (§3.4, M2): positive number LITERALS, like x_units —
          // physical dimensions are layout constants, never data-driven. Values
          // must be exact in hundredths of a mm with a 0.01 floor: the unit
          // math (here and in generate.ts) works in integer mm-hundredths, and
          // this bound is what keeps y_units:auto exactly square and NaN/
          // Infinity out of the model for every accepted size.
          if (value.kind === "Error") break;
          const hundredths = isPositiveNumberLiteral(value)
            ? Math.round(value.value * 100)
            : 0;
          if (hundredths >= 1 && isPositiveNumberLiteral(value) && hundredths / 100 === value.value) {
            if (key === "width_mm") customWidthMm = value.value;
            else customHeightMm = value.value;
            break;
          }
          this.error(
            "E008",
            `${key}: must be a positive number literal in millimetres, at least 0.01 and exact to two decimals (e.g. ${key}: 63.5)`,
            value.range,
          );
          break;
        }
        case "x_units": {
          if (value.kind === "Error") break;
          if (isPositiveIntegerLiteral(value)) {
            xUnits = value.value;
            break;
          }
          this.error(
            "E008",
            `x_units: must be a positive integer literal (e.g. x_units: 20)`,
            value.range,
          );
          break;
        }
        case "y_units": {
          if (value.kind === "Error") break;
          if (value.kind === "Identifier" && value.name === "auto") {
            yUnits = "auto";
            break;
          }
          if (isPositiveIntegerLiteral(value)) {
            yUnits = value.value;
            yUnitsRange = value.range; // W003 decided after size/x_units resolve
            break;
          }
          this.error(
            "E008",
            `y_units: must be 'auto' or a positive integer literal`,
            value.range,
          );
          break;
        }
        case "loop": {
          loopProps.push(item);
          let enumDecl: EnumDecl | null = null;
          if (value.kind === "Identifier") {
            const found = this.enums.get(value.name);
            if (found) {
              enumDecl = found;
              this.usedEnums.add(found);
            } else {
              const other = this.globalKinds.get(value.name);
              this.error(
                "E002",
                other !== undefined && other !== "an Enum"
                  ? `'${value.name}' is ${other}, not an Enum`
                  : `Unknown enum '${value.name}'`,
                value.range,
              );
            }
          } else if (value.kind !== "Error") {
            this.error("E002", `loop: must name an Enum`, value.range);
          }
          if (!item.asVar) {
            // A loop without a variable would multiply the deck with nothing
            // to reference — the spec always shows `loop: E as v`, so the
            // clause is required (resolved ambiguity; §3.2 shows no varless
            // form). E008: missing required part of the property.
            this.error(
              "E008",
              `loop: requires 'as <variable>' (e.g. loop: Suit as current_suit)`,
              item.range,
            );
            break;
          }
          const varName = item.asVar.name;
          if (loops.some((l) => l.variable === varName)) {
            this.error("E005", `Duplicate loop variable '${varName}'`, item.asVar.range);
            break;
          }
          loops.push({
            variable: varName,
            varRange: item.asVar.range,
            enumDecl,
            property: item,
          });
          break;
        }
        case "count": {
          countExpr = value;
          break;
        }
      }
    }

    // Custom sizes (§3.4, M2): width_mm/height_mm travel as a PAIR and are an
    // alternative to size: — combining them with the preset, or giving only
    // one, is E008. A clean pair becomes a synthetic "custom" preset so
    // everything downstream (auto y_units, W003, the generator) flows
    // unchanged; on any misuse `size` stays/becomes null — no deck is
    // generated, the squiggle owns the surface (same as an unknown preset).
    const mmKeys = (["width_mm", "height_mm"] as const).filter((k) => present.has(k));
    if (mmKeys.length > 0 && present.has("size")) {
      this.error(
        "E008",
        `Card '${decl.name.name}' declares both size: and ${mmKeys.join("/")}: — use the preset or the custom pair, not both`,
        seenKeys.get(mmKeys[0]) ?? decl.name.range,
      );
      size = null;
    } else if (mmKeys.length === 1) {
      const missing = mmKeys[0] === "width_mm" ? "height_mm" : "width_mm";
      this.error(
        "E008",
        `A custom card size needs both width_mm: and height_mm: — '${missing}:' is missing`,
        seenKeys.get(mmKeys[0]) ?? decl.name.range,
      );
    } else if (customWidthMm !== null && customHeightMm !== null) {
      size = { name: "custom", widthMm: customWidthMm, heightMm: customHeightMm };
    }

    // Required properties (E008 †): sheet, size, Front, x_units, y_units —
    // except that any width_mm/height_mm presence stands in for size: (its
    // OWN diagnostics above already cover an incomplete pair).
    for (const req of ["sheet", "size", "x_units", "y_units", "Front"] as const) {
      if (req === "size" && mmKeys.length > 0) continue;
      if (!present.has(req)) {
        this.error(
          "E008",
          `Card '${decl.name.name}' is missing required property '${req}:'`,
          decl.name.range,
        );
      }
    }

    // W003 — an explicit integer y_units stretches units (§3.4 ⚑7†), UNLESS
    // it is exactly the square value x_units × height/width (§3.8 amendment;
    // §3.4's own poker@20 → 28 example). Compared in integer hundredths of a
    // millimetre so mathematically-exact stays exact under floating point.
    // Property order is free, so this runs after the item loop. When size or
    // x_units did not resolve, the warning fires as before.
    if (typeof yUnits === "number" && yUnitsRange) {
      const exactSquare =
        size !== null &&
        xUnits !== null &&
        yUnits * Math.round(size.widthMm * 100) === xUnits * Math.round(size.heightMm * 100);
      if (!exactSquare) {
        this.warn(
          "W003",
          `Explicit y_units makes units non-square — use 'auto' to keep units square`,
          yUnitsRange,
        );
      }
    }

    // Loop variables shadowing sheet columns → W001 at the declaration site.
    if (sheet) {
      for (const loop of loops) {
        if (sheet.columns.has(loop.variable)) {
          this.warn(
            "W001",
            `Loop variable '${loop.variable}' shadows column '${loop.variable}' of sheet '${sheet.decl.name.name}'`,
            loop.varRange,
          );
        }
      }
    }

    const loopMap = new Map<string, LoopBinding>();
    for (const loop of loops) loopMap.set(loop.variable, loop);
    const ctx: Ctx = { sheet, loops: loopMap, repeats: [], record: recorder };

    // `count:` is the Card's only expression property — evaluated per
    // row × loop combination (§3.7), so loop vars and columns are in scope,
    // but no Repeat vars and no geometry keywords.
    if (countExpr) this.checkValue(countExpr, EXP_NUMBER, ctx, false);

    // Faces: templates are checked in THIS card's context (⚑5, §3.6). A
    // template used as both faces is checked once — same context, same result.
    if (front) this.checkTemplateBody(front, ctx);
    if (back && back !== front) this.checkTemplateBody(back, ctx);

    return {
      decl,
      sheet,
      size,
      xUnits,
      yUnits,
      loops,
      countExpr,
      front,
      back,
      exprTypes: recorder.exprTypes,
      resolutions: recorder.resolutions,
    };
  }

  private resolveFace(face: FaceNode): TemplateDecl | null {
    if (!face.template) return null; // parser-null: E001 already covered it
    const tpl = this.templates.get(face.template.name);
    if (tpl) {
      this.usedTemplates.add(tpl);
      return tpl;
    }
    const other = this.globalKinds.get(face.template.name);
    this.error(
      "E002",
      other !== undefined && other !== "a Template"
        ? `'${face.template.name}' is ${other}, not a Template`
        : `Unknown template '${face.template.name}'`,
      face.template.range,
    );
    return null;
  }

  // -- templates and elements (§3.3, §3.6) ----------------------------------

  private checkTemplateBody(tpl: TemplateDecl, ctx: Ctx): void {
    for (const node of tpl.children) this.checkTemplateNode(node, ctx);
  }

  private checkTemplateNode(node: TemplateNode, ctx: Ctx): void {
    if (node.kind === "Repeat") this.checkRepeat(node, ctx);
    else this.checkElement(node, ctx);
  }

  private checkRepeat(node: RepeatNode, ctx: Ctx): void {
    // The count is a Number expression; outer Repeat vars are in scope,
    // geometry keywords are not (they belong to element geometry positions).
    this.checkValue(node.count, EXP_NUMBER, ctx, false);
    if (node.variable) {
      const name = node.variable.name;
      const shadowed = ctx.repeats.some((r) => r.name === name)
        ? "an enclosing Repeat variable"
        : ctx.loops.has(name)
          ? "a loop variable"
          : ctx.sheet?.columns.has(name)
            ? `column '${name}' of sheet '${ctx.sheet.decl.name.name}'`
            : null;
      if (shadowed) {
        this.warn(
          "W001",
          `Repeat variable '${name}' shadows ${shadowed}`,
          node.variable.range,
        );
      }
      ctx.repeats.push({ name, range: node.variable.range });
      for (const child of node.children) this.checkTemplateNode(child, ctx);
      ctx.repeats.pop();
    } else {
      // Parser-null variable (E001 covered): children still get checked.
      for (const child of node.children) this.checkTemplateNode(child, ctx);
    }
  }

  private checkElement(el: ElementNode, ctx: Ctx): void {
    const spec = ELEMENT_SPECS[el.element];
    const seenKeys = new Set<string>();
    for (const prop of el.properties) {
      const key = prop.key.name;
      if (prop.asVar) {
        this.error("E007", `'as' is only allowed on a Card's 'loop:' property`, prop.asVar.range);
      }
      if (!spec.required.includes(key) && !spec.optional.includes(key)) {
        this.error("E008", `Unknown property '${key}:' on ${el.element}`, prop.key.range);
        continue;
      }
      if (seenKeys.has(key)) {
        this.error("E005", `Duplicate property '${key}:'`, prop.key.range);
        continue;
      }
      seenKeys.add(key);
      this.checkElementProperty(el, prop, ctx);
    }
    for (const req of spec.required) {
      if (!seenKeys.has(req)) {
        this.error(
          "E008",
          `${el.element} is missing required property '${req}:'`,
          elementHeaderRange(el),
        );
      }
    }
  }

  private checkElementProperty(el: ElementNode, prop: PropertyNode, ctx: Ctx): void {
    const key = prop.key.name;
    const value = prop.value;
    switch (key) {
      case "x": {
        // `middle` is legal ONLY as the ENTIRE x: value of Text/Icon (§3.4:
        // sugar for `x: half` + `anchor: middle`; Rectangle and Image have no
        // anchor, so `x: middle` there is E007 like any other misplacement).
        if (
          (el.element === "Text" || el.element === "Icon") &&
          value.kind === "Identifier" &&
          value.name === "middle"
        ) {
          this.recordResolution(ctx, value, { kind: "geometry", keyword: "middle" });
          this.recordType(ctx, value, NUMBER);
          return;
        }
        this.checkValue(value, EXP_NUMBER, ctx, true);
        return;
      }
      case "y":
      case "width":
      case "height":
      case "size":
        this.checkValue(value, EXP_NUMBER, ctx, true);
        return;
      case "color":
        this.checkValue(value, EXP_COLOR, ctx, false);
        return;
      case "text":
        this.checkValue(value, EXP_TEXT, ctx, false);
        return;
      case "src":
        // Image only (ELEMENT_SPECS): a Text expression with the usual §3.5
        // coercions — URLs routinely come from a sheet column or an
        // interpolated string, so no literal-shape restriction applies.
        this.checkValue(value, EXP_TEXT, ctx, false);
        return;
      case "code": {
        this.checkValue(value, EXP_TEXT, ctx, false);
        // W004: literal codes are checked against the curated Dicier list
        // (⚑10†). Interpolated/computed codes are runtime territory (D005).
        const literal = literalStringValue(value);
        if (literal !== null && !DICIER_CODES.has(literal)) {
          this.warn(
            "W004",
            `Unknown icon code "${literal}" — not in the curated Dicier list (which is non-exhaustive; the glyph may still exist)`,
            value.range,
          );
        }
        return;
      }
      case "anchor": {
        if (value.kind === "Error") return;
        if (
          value.kind === "Identifier" &&
          (value.name === "left" || value.name === "middle" || value.name === "right")
        ) {
          this.recordResolution(ctx, value, {
            kind: "anchor",
            keyword: value.name,
          });
          return;
        }
        this.error("E008", `anchor: must be left, middle, or right`, value.range);
        return;
      }
      case "style": {
        // Icon only (ELEMENT_SPECS): a bare identifier from the closed ten-
        // face vocabulary, resolved by expected type like anchor (§3.3, M2).
        // Unlike codes (open list, W004) the faces ARE the full set — E008.
        if (value.kind === "Error") return;
        if (value.kind === "Identifier" && ICON_STYLE_SET.has(value.name)) {
          this.recordResolution(ctx, value, {
            kind: "iconStyle",
            style: value.name as IconStyle,
          });
          return;
        }
        this.error("E008", `style: must be one of ${ICON_STYLES.join(", ")}`, value.range);
        return;
      }
      case "fit": {
        // Image only (ELEMENT_SPECS): a bare identifier from the closed
        // three-mode vocabulary, resolved by expected type like style (§3.3,
        // M2) — E008 on anything else.
        if (value.kind === "Error") return;
        if (value.kind === "Identifier" && IMAGE_FIT_SET.has(value.name)) {
          this.recordResolution(ctx, value, {
            kind: "imageFit",
            fit: value.name as ImageFit,
          });
          return;
        }
        this.error("E008", `fit: must be one of ${IMAGE_FITS.join(", ")}`, value.range);
        return;
      }
    }
  }

  // -- expressions (§3.5) ---------------------------------------------------

  /** Type a property-value expression and enforce the position's expected
   * type (with the Text coercions of §3.5) at the top level. `geometryOk`
   * says whether `full`/`half` may appear as (sub)expressions — true exactly
   * for element geometry positions (x, y, width, height, size). */
  private checkValue(expr: Expr, expected: Expected, ctx: Ctx, geometryOk: boolean): ValueType {
    this.depthReported = false; // one budget-breach diagnostic per value
    const t = this.typeOf(expr, expected, ctx, geometryOk);
    this.requireType(t, expected, expr.range);
    return t;
  }

  /** Enforce `expected` on an already-computed type (poison-safe). */
  private requireType(t: ValueType, expected: Expected, range: Range): void {
    if (t.kind === "Unknown") return;
    switch (expected.kind) {
      case "None":
        return;
      case "Number":
        if (t.kind !== "Number") {
          this.error("E003", `Type mismatch: expected Number, got ${typeName(t)}`, range);
        }
        return;
      case "Text":
        // Coercion (◆†): Number and Enum coerce to Text; Bool/Color do not.
        if (t.kind !== "Text" && t.kind !== "Number" && t.kind !== "Enum") {
          this.error(
            "E003",
            `Type mismatch: ${typeName(t)} cannot be used as Text (only Number and enum values coerce)`,
            range,
          );
        }
        return;
      case "Bool":
        if (t.kind !== "Bool") {
          this.error("E003", `Type mismatch: expected Bool, got ${typeName(t)}`, range);
        }
        return;
      case "Color":
        if (t.kind !== "Color") {
          this.error("E003", `Type mismatch: expected Color, got ${typeName(t)}`, range);
        }
        return;
      case "Enum":
        if (t.kind !== "Enum" || t.enumName !== expected.enumDecl.name.name) {
          this.error(
            "E003",
            `Type mismatch: expected enum ${expected.enumDecl.name.name}, got ${typeName(t)}`,
            range,
          );
        }
        return;
    }
  }

  /** Compute an expression's type, resolving names along the way. `expected`
   * only steers bare-name resolution and if-branch inference — enforcement
   * happens at operator/top level so each mistake is reported once. */
  private typeOf(expr: Expr, expected: Expected, ctx: Ctx, geometryOk: boolean): ValueType {
    if (this.exprDepth >= MAX_EXPR_DEPTH) {
      // Depth budget (never-throws ⚑8): poison to Unknown, one E003 per value.
      if (this.silent === 0 && !this.depthReported) {
        this.error("E003", "Expression is too deeply nested to check", expr.range);
        this.depthReported = true;
      }
      this.recordType(ctx, expr, UNKNOWN);
      return UNKNOWN;
    }
    this.exprDepth++;
    try {
      const t = this.typeOfInner(expr, expected, ctx, geometryOk);
      this.recordType(ctx, expr, t);
      return t;
    } finally {
      this.exprDepth--;
    }
  }

  /** Type an expression with diagnostics, recording, and usage marking
   * suppressed — used to learn whether a side/branch pins a derivable type
   * BEFORE committing to a typing order (◆14†). Callers gate on
   * `silent === 0`, so trials never nest: the extra work is bounded to one
   * silent pass per subtree. */
  private trialType(expr: Expr, expected: Expected, ctx: Ctx, geometryOk: boolean): ValueType {
    this.silent++;
    try {
      return this.typeOf(expr, expected, ctx, geometryOk);
    } finally {
      this.silent--;
    }
  }

  private typeOfInner(expr: Expr, expected: Expected, ctx: Ctx, geometryOk: boolean): ValueType {
    switch (expr.kind) {
      case "Error":
        return UNKNOWN; // E001 already covered it
      case "Number":
        return NUMBER;
      case "Color":
        return COLOR;
      case "String": {
        // Interpolation (§3.5): each [ref] part must coerce to Text.
        for (const part of expr.parts) {
          if (part.kind !== "ref") continue;
          const t = this.resolveRef(part.name, part.range, ctx, part);
          if (t.kind === "Bool" || t.kind === "Color") {
            this.error(
              "E003",
              `[${part.name}] is ${typeName(t)} — it cannot be interpolated into Text`,
              part.range,
            );
          }
        }
        return TEXT;
      }
      case "Ref":
        return this.resolveRef(expr.name, expr.range, ctx, expr);
      case "Identifier":
        return this.resolveBare(expr, expected, ctx, geometryOk);
      case "Qualified":
        return this.resolveQualified(expr, ctx);
      case "Unary": {
        const wanted = expr.op === "not" ? EXP_BOOL : EXP_NUMBER;
        const ok = expr.op === "not" ? "Bool" : "Number";
        const t = this.typeOf(expr.operand, wanted, ctx, geometryOk);
        if (t.kind === ok) return expr.op === "not" ? BOOL : NUMBER;
        // A bad operand poisons the result — one mistake, one diagnostic.
        if (t.kind !== "Unknown") this.requireType(t, wanted, expr.operand.range);
        return UNKNOWN;
      }
      case "Binary":
        return this.typeOfBinary(expr, ctx, geometryOk);
      case "If": {
        const condT = this.typeOf(expr.condition, EXP_BOOL, ctx, geometryOk);
        this.requireType(condT, EXP_BOOL, expr.condition.range);

        // Branch inference (§3.5): branches inherit the position's expected
        // type when it carries a vocabulary (Color/Enum/Number). Coercing
        // Text positions and vocabulary-less None/Bool positions leave bare
        // branch names underivable, so a sibling branch with a derivable
        // type lends its expectation — in either direction, decided by a
        // silent trial pass (this is the exact ◆14† regression class: a
        // shared case name must not E004 when the sibling pins the enum).
        const inferable =
          expected.kind === "None" || expected.kind === "Text" || expected.kind === "Bool";
        let thenT: ValueType;
        let elseT: ValueType;
        if (!inferable) {
          thenT = this.typeOf(expr.thenBranch, expected, ctx, geometryOk);
          elseT = this.typeOf(expr.elseBranch, expected, ctx, geometryOk);
        } else {
          let elseFirst = false;
          if (
            this.silent === 0 &&
            !this.derive(this.trialType(expr.thenBranch, expected, ctx, geometryOk))
          ) {
            elseFirst =
              this.derive(this.trialType(expr.elseBranch, expected, ctx, geometryOk)) !== null;
          }
          if (elseFirst) {
            elseT = this.typeOf(expr.elseBranch, expected, ctx, geometryOk);
            thenT = this.typeOf(expr.thenBranch, this.derive(elseT) ?? expected, ctx, geometryOk);
          } else {
            thenT = this.typeOf(expr.thenBranch, expected, ctx, geometryOk);
            elseT = this.typeOf(expr.elseBranch, this.derive(thenT) ?? expected, ctx, geometryOk);
          }
        }
        if (thenT.kind === "Unknown") return elseT;
        if (elseT.kind === "Unknown") return thenT;
        if (sameType(thenT, elseT)) return thenT;
        this.error(
          "E003",
          `Both branches of an if must have the same type: got ${typeName(thenT)} and ${typeName(elseT)}`,
          expr.elseBranch.range,
        );
        return UNKNOWN;
      }
    }
  }

  private typeOfBinary(
    expr: Extract<Expr, { kind: "Binary" }>,
    ctx: Ctx,
    geometryOk: boolean,
  ): ValueType {
    const { op, left, right } = expr;
    switch (op) {
      case "and":
      case "or":
        return this.checkOperands(expr, EXP_BOOL, "Bool", ctx, geometryOk) ? BOOL : UNKNOWN;
      case "==":
      case "!=": {
        // Expected-type inference for bare names (◆14†): type whichever side
        // pins a derivable type FIRST, decided by a silent trial pass — so
        // `(if … then Rock else Scissors) == [suit]` infers exactly like its
        // mirror, regardless of either side's node shape.
        let first = left;
        let second = right;
        if (
          this.silent === 0 &&
          !this.derive(this.trialType(left, EXP_NONE, ctx, geometryOk)) &&
          this.derive(this.trialType(right, EXP_NONE, ctx, geometryOk))
        ) {
          first = right;
          second = left;
        }
        const firstT = this.typeOf(first, EXP_NONE, ctx, geometryOk);
        const secondT = this.typeOf(second, this.derive(firstT) ?? EXP_NONE, ctx, geometryOk);
        // A poisoned or ill-typed side poisons the comparison (one mistake,
        // one diagnostic — the Unknown's cause is already reported).
        if (firstT.kind === "Unknown" || secondT.kind === "Unknown") return UNKNOWN;
        if (!sameType(firstT, secondT)) {
          const [leftT, rightT] = first === left ? [firstT, secondT] : [secondT, firstT];
          this.error(
            "E003",
            `Cannot compare ${typeName(leftT)} with ${typeName(rightT)}`,
            expr.range,
          );
          return UNKNOWN;
        }
        if (firstT.kind === "Bool" || firstT.kind === "Color") {
          this.error(
            "E003",
            `${typeName(firstT)} values cannot be compared with '${op}'`,
            expr.range,
          );
          return UNKNOWN;
        }
        return BOOL;
      }
      case "<":
      case "<=":
      case ">":
      case ">=":
        return this.checkOperands(expr, EXP_NUMBER, "Number", ctx, geometryOk) ? BOOL : UNKNOWN;
      default:
        // + - * / % — arithmetic needs Numbers (§3.5).
        return this.checkOperands(expr, EXP_NUMBER, "Number", ctx, geometryOk) ? NUMBER : UNKNOWN;
    }
  }

  /** Type both operands against one required primitive type. Only the FIRST
   * offender is reported and a bad/poisoned operand poisons the whole
   * operation — one mistake, one diagnostic. Returns true when clean. */
  private checkOperands(
    expr: Extract<Expr, { kind: "Binary" }>,
    expected: Expected,
    ok: ValueType["kind"],
    ctx: Ctx,
    geometryOk: boolean,
  ): boolean {
    let clean = true;
    for (const side of [expr.left, expr.right]) {
      const t = this.typeOf(side, expected, ctx, geometryOk);
      if (t.kind === ok) continue;
      if (t.kind !== "Unknown" && clean) this.requireType(t, expected, side.range);
      clean = false;
    }
    return clean;
  }

  /** Derive an Expected from a computed type, for `==` and if-branch
   * inference. Only Enum (case vocabulary) and Number (geometry vocabulary)
   * matter; Color deliberately not — comparisons on Color are E003 anyway
   * and ◆21† restricts color names to Color-typed *positions*. */
  private derive(t: ValueType): Expected | null {
    if (t.kind === "Enum") {
      const decl = this.enums.get(t.enumName);
      if (decl) return { kind: "Enum", enumDecl: decl };
      return null;
    }
    if (t.kind === "Number") return EXP_NUMBER;
    return null;
  }

  // -- name resolution (§3.5, §3.6) -----------------------------------------

  /** `[name]`: innermost Repeat vars → the Card's loop vars → the bound
   * sheet's columns. When the context has no usable sheet (unknown/missing
   * sheet, unused template), unmatched refs poison silently — the cause has
   * its own diagnostic already. */
  private resolveRef(name: string, range: Range, ctx: Ctx, node: ResolvableNode): ValueType {
    for (let i = ctx.repeats.length - 1; i >= 0; i--) {
      if (ctx.repeats[i].name === name) {
        this.recordResolution(ctx, node, { kind: "repeatVar" });
        return NUMBER; // 0-based index (◆18)
      }
    }
    const loop = ctx.loops.get(name);
    if (loop) {
      this.recordResolution(ctx, node, {
        kind: "loopVar",
        enumName: loop.enumDecl ? loop.enumDecl.name.name : null,
      });
      return loop.enumDecl ? enumType(loop.enumDecl.name.name) : UNKNOWN;
    }
    if (ctx.sheet) {
      const col = ctx.sheet.columns.get(name);
      if (col) {
        this.recordResolution(ctx, node, {
          kind: "column",
          sheet: ctx.sheet.decl.name.name,
          column: name,
          type: col.type,
        });
        return col.type;
      }
      // Message is deliberately context-free so a template used by several
      // Cards dedupes to ONE diagnostic at the template's range (§3.6).
      this.error("E002", `Unknown reference [${name}]`, range);
    }
    return UNKNOWN;
  }

  /** Bare identifier: expected-type-driven resolution (◆14†, ◆21†, ◆30†). */
  private resolveBare(
    node: IdentifierExpr,
    expected: Expected,
    ctx: Ctx,
    geometryOk: boolean,
  ): ValueType {
    const name = node.name;
    switch (expected.kind) {
      case "Color": {
        const lower = name.toLowerCase();
        if (CSS_COLOR_NAMES.has(lower)) {
          this.recordResolution(ctx, node, { kind: "colorName", name: lower });
          return COLOR;
        }
        if (GEOMETRY_WORDS.has(name)) return this.keywordMisuse(name, node.range);
        this.error("E002", `Unknown color name '${name}'`, node.range);
        return UNKNOWN;
      }
      case "Enum": {
        const enumDecl = expected.enumDecl;
        if (enumDecl.cases.some((c) => c.name.name === name)) {
          this.markEnumUsed(enumDecl);
          this.recordResolution(ctx, node, {
            kind: "enumCase",
            enumName: enumDecl.name.name,
            caseName: name,
          });
          return enumType(enumDecl.name.name);
        }
        if (GEOMETRY_WORDS.has(name)) return this.keywordMisuse(name, node.range);
        this.error("E002", `'${name}' is not a case of enum ${enumDecl.name.name}`, node.range);
        return UNKNOWN;
      }
      case "Number": {
        if (name === "full" || name === "half") {
          if (geometryOk) {
            this.recordResolution(ctx, node, { kind: "geometry", keyword: name });
            return NUMBER;
          }
          return this.keywordMisuse(name, node.range);
        }
        if (GEOMETRY_WORDS.has(name)) return this.keywordMisuse(name, node.range);
        // In a derivable Number position the vocabulary is only full/half —
        // no enum-case fallback (a color word here is E002 by design).
        this.error("E002", `Unknown name '${name}'`, node.range);
        return UNKNOWN;
      }
      default: {
        // Underivable (None) plus Text/Bool positions: a bare enum case
        // resolves only when globally unique (◆14†) — enum-case lookup runs
        // before the geometry-keyword check so an enum that deliberately
        // declares a case like `full` stays usable (◆30: ordinary
        // identifiers; meaning comes from expected type first).
        const owners: EnumDecl[] = [];
        for (const enumDecl of this.enums.values()) {
          if (enumDecl.cases.some((c) => c.name.name === name)) owners.push(enumDecl);
        }
        if (owners.length === 1) {
          const enumDecl = owners[0];
          this.markEnumUsed(enumDecl);
          this.recordResolution(ctx, node, {
            kind: "enumCase",
            enumName: enumDecl.name.name,
            caseName: name,
          });
          return enumType(enumDecl.name.name);
        }
        if (owners.length > 1) {
          const list = owners.map((e) => `${e.name.name}.${name}`).join(" or ");
          this.error("E004", `'${name}' is a case of multiple enums — qualify it as ${list}`, node.range);
          return UNKNOWN;
        }
        if (GEOMETRY_WORDS.has(name)) return this.keywordMisuse(name, node.range);
        this.error("E002", `Unknown name '${name}'`, node.range);
        return UNKNOWN;
      }
    }
  }

  /** E007 — geometry keyword outside its one valid position (§3.4, §3.8). */
  private keywordMisuse(name: string, range: Range): ValueType {
    const message =
      name === "middle"
        ? `'middle' is only valid as the entire x: value of a Text or Icon element`
        : name === "auto"
          ? `'auto' is only valid as the y_units: value of a Card`
          : `'${name}' is only valid in geometry positions (x, y, width, height, or size of an element)`;
    this.error("E007", message, range);
    return UNKNOWN;
  }

  /** `Enum.Case` — always resolvable regardless of expected type (◆14). */
  private resolveQualified(node: QualifiedName, ctx: Ctx): ValueType {
    const enumDecl = this.enums.get(node.qualifier.name);
    if (!enumDecl) {
      const other = this.globalKinds.get(node.qualifier.name);
      this.error(
        "E002",
        other !== undefined && other !== "an Enum"
          ? `'${node.qualifier.name}' is ${other}, not an Enum`
          : `Unknown enum '${node.qualifier.name}'`,
        node.qualifier.range,
      );
      return UNKNOWN;
    }
    this.markEnumUsed(enumDecl);
    if (!enumDecl.cases.some((c) => c.name.name === node.member.name)) {
      this.error(
        "E002",
        `'${node.member.name}' is not a case of enum ${enumDecl.name.name}`,
        node.member.range,
      );
      return UNKNOWN;
    }
    this.recordResolution(ctx, node, {
      kind: "enumCase",
      enumName: enumDecl.name.name,
      caseName: node.member.name,
    });
    return enumType(enumDecl.name.name);
  }

  // -- recording ------------------------------------------------------------

  private recordType(ctx: Ctx, expr: Expr, t: ValueType): void {
    if (this.silent > 0) return;
    ctx.record?.exprTypes.set(expr, t);
  }

  private recordResolution(ctx: Ctx, node: ResolvableNode, res: Resolution): void {
    if (this.silent > 0) return;
    ctx.record?.resolutions.set(node, res);
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function kindWord(kind: string): string {
  switch (kind) {
    case "EnumDecl":
      return "an Enum";
    case "SheetDecl":
      return "a Sheet";
    case "TemplateDecl":
      return "a Template";
    default:
      return "a Card";
  }
}

function sameType(a: ValueType, b: ValueType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "Enum" && b.kind === "Enum") return a.enumName === b.enumName;
  return true;
}

function isPositiveIntegerLiteral(expr: Expr): expr is NumberLit {
  return expr.kind === "Number" && Number.isInteger(expr.value) && expr.value > 0;
}

/** §3.4 width_mm/height_mm: any positive number literal (decimals welcome —
 * bridge itself is 57.15 mm). A leading minus parses as unary negation, so a
 * NumberLit is non-negative already; `> 0` only excludes zero. */
function isPositiveNumberLiteral(expr: Expr): expr is NumberLit {
  return expr.kind === "Number" && expr.value > 0;
}

/** The literal value of a string with NO interpolation parts, else null. */
function literalStringValue(expr: Expr): string | null {
  if (expr.kind !== "String") return null;
  let out = "";
  for (const part of (expr as StringLit).parts) {
    if (part.kind !== "text") return null;
    out += part.value;
  }
  return out;
}

/** The header line of an element block ("Rectangle:") — nicer squiggle target
 * for missing-property E008s than the whole block. */
function elementHeaderRange(el: ElementNode): Range {
  return {
    startLine: el.range.startLine,
    startCol: el.range.startCol,
    endLine: el.range.startLine,
    endCol: el.range.startCol + el.element.length + 1,
  };
}
