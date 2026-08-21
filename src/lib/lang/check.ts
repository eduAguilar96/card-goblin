/**
 * Binder + type checker for Goblin script (DESIGN.md §3.2–§3.8, §4.1).
 *
 * `check(program)` resolves every name, types every expression, and emits the
 * compile-time diagnostics E002–E010 and W001–W005 (E001 is the parser's).
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
  IfNode,
  LetNode,
  NumberLit,
  Program,
  PropertyNode,
  QualifiedName,
  RepeatNode,
  SheetDecl,
  StringLit,
  StringRefPart,
  TemplateDecl,
  TemplateArgumentNode,
  TemplateCallNode,
  TemplateNode,
  TemplateParamDecl,
  VirtualColumnDecl,
} from "./ast";
import type { Diagnostic, Range, Severity } from "./diagnostics";
import type { FontFace, IconStyle, ImageFit, Pivot, QrLevel, TextBoxOverflow } from "./model";
import {
  FONT_FACES,
  ICON_STYLES,
  IMAGE_FITS,
  PIVOT_TOKENS,
  QR_LEVELS,
  TEXTBOX_OVERFLOWS,
  parseAssetSrc,
  parsePivot,
} from "./model";
import { CSS_COLOR_NAMES } from "./css-colors";
import { DICIER_CODES } from "./dicier-codes";
import { parseInlineMarkers } from "./markers";

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
  | { kind: "let"; binding: LetNode; scope: "global" | "local"; type: ValueType }
  | { kind: "param"; parameter: TemplateParamDecl; type: ValueType }
  | { kind: "enumCase"; enumName: string; caseName: string }
  | { kind: "colorName"; name: string }
  | { kind: "geometry"; keyword: "full" | "half" | "middle" }
  /** Nine-point `pivot:` (§3.4, M3): carries the NORMALIZED {h, v} — every
   * spelling variant (either word order, `center`, the legacy aliases) is
   * indistinguishable downstream, contentHash included. */
  | { kind: "pivot"; pivot: Pivot }
  /** TextBox `align:` (§3.3, M3): same three words as pivot, but a box
   * aligns lines within its own width — a distinct kind so the evaluator
   * can never confuse the two vocabularies. */
  | { kind: "align"; keyword: "left" | "middle" | "right" }
  | { kind: "iconStyle"; style: IconStyle }
  | { kind: "imageFit"; fit: ImageFit }
  /** Text/TextBox `font:` (§3.3, M3 — ◆41): resolved by expected type like
   * style/fit — the closed nine-face vocabulary (FONT_FACES). */
  | { kind: "font"; face: FontFace }
  /** TextBox `overflow:` (§3.3, M3): clip | shrink, resolved like fit. */
  | { kind: "overflow"; value: TextBoxOverflow }
  /** Qr `level:` (§7.1a): l | m | q | h, resolved like fit/style. */
  | { kind: "qrLevel"; level: QrLevel }
  /** Bare `auto` as the ENTIRE width:/height: value of an Image (§3.3): the
   * dimension derives from the art's intrinsic ratio at LOAD time, so the
   * model carries the keyword and the renderer/exporter resolve it. */
  | { kind: "autoDim" }
  /** Built-in generated-instance identity bindings (§3.6, ◆42): resolved LAST,
   * after sheet columns, so a sheet's own same-named column shadows them
   * (warned at the column's declaration — buildSheetInfo, not here). */
  | {
      kind: "position";
      which: "row" | "card" | "copy" | "deck" | "deck_card" | "project_card";
    };

/** AST nodes that get an entry in `CardBindings.resolutions`. */
export type ResolvableNode = DataRef | IdentifierExpr | QualifiedName | StringRefPart;

export interface ColumnInfo {
  decl: ColumnDecl;
  /** Text | Number | Enum; Unknown when the type name did not resolve (E002). */
  type: ValueType;
}

export interface VirtualColumnInfo {
  decl: VirtualColumnDecl;
  /** Text | Number | Enum; Unknown when the type name did not resolve (E002). */
  type: ValueType;
}

export interface SheetInfo {
  decl: SheetDecl;
  /** Column name → info; first declaration wins on E005 duplicates. */
  columns: ReadonlyMap<string, ColumnInfo>;
  /** Export-only computed columns; never part of ordinary name resolution. */
  virtualColumns: ReadonlyMap<string, VirtualColumnInfo>;
}

/** One physical size (§3.4): a named preset, or `name: "custom"` when the
 * Card declared a `width_mm:`/`height_mm:` pair instead (M2). */
export interface SizePreset {
  name: string;
  widthMm: number;
  heightMm: number;
}

/** The built-in presets (§3.4), widest-use first — completion offers them in
 * this order. Exported for the evaluator/renderer. Every entry must be exact
 * in hundredths of a millimetre, like a custom pair: the unit math downstream
 * works in integer mm-hundredths. */
export const SIZE_PRESETS: ReadonlyMap<string, SizePreset> = new Map([
  ["poker", { name: "poker", widthMm: 63.5, heightMm: 88.9 }],
  ["bridge", { name: "bridge", widthMm: 57.15, heightMm: 88.9 }],
  ["american", { name: "american", widthMm: 56, heightMm: 87 }],
  ["tarot", { name: "tarot", widthMm: 70, heightMm: 120 }],
  ["square", { name: "square", widthMm: 70, heightMm: 70 }],
  ["mini", { name: "mini", widthMm: 44, heightMm: 63.5 }],
  ["domino", { name: "domino", widthMm: 44.45, heightMm: 88.9 }],
]);

/** "poker, bridge, …, or domino" — derived, so adding a preset can never leave
 * a stale list behind in the E008 message. */
const SIZE_PRESET_LIST = ((names) =>
  `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`)([
  ...SIZE_PRESETS.keys(),
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
  /** Root invocations retain their explicit argument expressions for evaluation. */
  frontFace: FaceNode | null;
  backFace: FaceNode | null;
  /** Static type of every expression checked in THIS card's context
   * (the card's own `count:` plus both face templates' bodies). */
  exprTypes: ReadonlyMap<Expr, ValueType>;
  /** Resolution of every ref/bare name/qualified name in this card's context. */
  resolutions: ReadonlyMap<ResolvableNode, Resolution>;
  /** Contextual inferred type of each reachable global/local binding. */
  letTypes: ReadonlyMap<LetNode, ValueType>;
  /** Per-Card resolution of every reachable composition edge. */
  templateCalls: ReadonlyMap<TemplateCallNode, TemplateDecl>;
}

export interface Bindings {
  /** First declaration wins where E005 collisions exist. */
  enums: ReadonlyMap<string, EnumDecl>;
  sheets: ReadonlyMap<string, SheetInfo>;
  templates: ReadonlyMap<string, TemplateDecl>;
  /** Program-scope value bindings; separate from the declaration namespace. */
  globals: ReadonlyMap<string, LetNode>;
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

/**
 * Bind + type check a parsed program. Never throws (⚑8): expression depth is
 * budgeted (MAX_EXPR_DEPTH), and any residual internal failure degrades to a
 * single synthetic diagnostic instead of an exception.
 *
 * `assetNames` (§7.1b, additive): the Assets-drawer library's current names,
 * for W005 ("unknown asset"). Omitted (not just empty) — the overwhelming
 * majority of callers, including every pre-§7.1b test — means W005 never
 * fires, exactly like `code:`'s W004 needs no such gate (its DICIER_CODES
 * list is a compiler constant, not caller state).
 */
export function check(program: Program, assetNames?: ReadonlySet<string>): CheckResult {
  try {
    return new Checker(assetNames).run(program);
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
        globals: new Map(),
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

/** Membership set over the §3.3 FONT_FACES vocabulary (◆41: geist + eight
 * bundled faces). */
const FONT_FACE_SET: ReadonlySet<string> = new Set(FONT_FACES);

/** Membership set over the §3.3 TEXTBOX_OVERFLOWS vocabulary (clip/shrink). */
const TEXTBOX_OVERFLOW_SET: ReadonlySet<string> = new Set(TEXTBOX_OVERFLOWS);

/** Membership set over the §7.1a QR_LEVELS vocabulary (l/m/q/h). */
const QR_LEVEL_SET: ReadonlySet<string> = new Set(QR_LEVELS);

interface ElementSpec {
  required: readonly string[];
  optional: readonly string[];
}

/** §3.3 property tables. Text/Icon color defaults to black; Icon style
 * defaults to flat_dark, Image fit to contain and tint to white (M2); TextBox align defaults
 * to left, line_height to 1.3 × size, overflow to clip (M3); Qr color
 * defaults to black, background to white, level to m (§7.1a); Text/TextBox
 * font defaults to geist (M3 — ◆41). EVERY drawable element takes an
 * optional nine-point `pivot:` (§3.4, M3; default top_left) and an optional
 * Number `rotate:` (§3.4, M4 — ◆43; degrees clockwise, default 0). */
const ELEMENT_SPECS: Record<ElementNode["element"], ElementSpec> = {
  Rectangle: {
    required: ["x", "y", "width", "height", "color"],
    optional: ["pivot", "rotate"],
  },
  Text: {
    required: ["x", "y", "size", "text"],
    optional: ["color", "pivot", "font", "rotate"],
  },
  TextBox: {
    required: ["x", "y", "width", "height", "text", "size"],
    optional: ["color", "align", "line_height", "overflow", "pivot", "font", "rotate"],
  },
  Icon: {
    required: ["x", "y", "size", "code"],
    optional: ["color", "pivot", "style", "rotate"],
  },
  Image: {
    required: ["x", "y", "width", "height", "src"],
    optional: ["fit", "color", "pivot", "rotate"],
  },
  Qr: {
    required: ["x", "y", "size", "data"],
    optional: ["color", "background", "level", "pivot", "rotate"],
  },
};

/** Mutable recording target while checking in one Card's context; null during
 * the structural pass over unused templates (nothing to evaluate later). */
interface Recorder {
  exprTypes: Map<Expr, ValueType>;
  resolutions: Map<ResolvableNode, Resolution>;
  letTypes: Map<LetNode, ValueType>;
  templateCalls: Map<TemplateCallNode, TemplateDecl>;
}

interface LetScope {
  lets: ReadonlyMap<string, LetNode>;
  /** Repeat introduced for this child block, if any. */
  repeat: { name: string; range: Range } | null;
}

interface LetState {
  state: "evaluating" | "done";
  type: ValueType;
}

interface TemplateCallEdge {
  target: TemplateDecl;
  call: TemplateCallNode;
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
  /** Lexical scopes in the current template activation, outermost first. */
  scopes: LetScope[];
  /** Parameters of the current Template activation. Calls replace, never inherit, this map. */
  params: ReadonlyMap<string, TemplateParamDecl>;
  /** Per-Card contextual binding state; declarations are AST-identity keys. */
  letStates: Map<LetNode, LetState>;
  letStack: LetNode[];
  blockDepth: number;
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
  private globalInitDepth = 0;

  private readonly enums = new Map<string, EnumDecl>();
  private readonly sheets = new Map<string, SheetInfo>();
  private readonly templates = new Map<string, TemplateDecl>();
  private readonly paramTypes = new Map<TemplateParamDecl, ValueType>();
  private readonly globals = new Map<string, LetNode>();
  private readonly globalKinds = new Map<string, string>(); // name → kind word

  private readonly usedEnums = new Set<EnumDecl>();
  private readonly usedSheets = new Set<SheetDecl>();
  private readonly usedTemplates = new Set<TemplateDecl>();
  /** Declarations whose name collided (E005): suppress their W002 — one
   * mistake, one diagnostic. */
  private readonly collided = new Set<EnumDecl | SheetDecl | TemplateDecl | CardDecl | LetNode>();
  private readonly usedLets = new Set<LetNode>();
  /** One primary cycle report per dependency SCC across contextual Card passes. */
  private readonly cyclicLets = new Set<LetNode>();
  private readonly cyclicTemplates = new Set<TemplateDecl>();

  private callPath: TemplateDecl[] = [];
  private activeCalls = 0;
  private compositionVisits = 0;
  private callNodes: TemplateCallNode[] = [];
  private compositionBlocked = false;
  private currentCard: CardDecl | null = null;
  private readonly templateUsers = new Map<TemplateDecl, CardDecl[]>();

  private static readonly MAX_TEMPLATE_CALL_DEPTH = 64;
  private static readonly MAX_COMPOSITION_VISITS = 10_000;
  private static readonly MAX_BLOCK_DEPTH = 500;

  /** §7.1b W005: undefined means "no asset library in scope" — the literal
   * `asset:` check in `case "src":` is skipped entirely, not run against an
   * empty set (see the `check()` doc comment). */
  constructor(private readonly assetNames?: ReadonlySet<string>) {}

  run(program: Program): CheckResult {
    this.collectDeclarations(program);

    const cards: CardBindings[] = [];
    for (const decl of program.declarations) {
      if (decl.kind !== "CardDecl") continue;
      this.currentCard = decl;
      const bound = this.checkCard(decl);
      cards.push(bound);
    }
    this.currentCard = null;

    // Unused templates: structural checks only (W002 §3.8) — property
    // presence/duplicates, literal types, geometry keywords, icon codes. No
    // Card context exists, so [refs] silently type as Unknown and every
    // context-dependent check is suppressed.
    for (const decl of program.declarations) {
      if (decl.kind !== "TemplateDecl" || this.usedTemplates.has(decl)) continue;
      const ctx: Ctx = {
        sheet: null,
        loops: new Map(),
        repeats: [],
        scopes: [],
        params: new Map(),
        letStates: new Map(),
        letStack: [],
        blockDepth: 0,
        record: null,
      };
      this.checkFaceTemplate(decl, ctx);
      if (!this.collided.has(decl)) {
        this.warn("W002", `Template '${decl.name.name}' is never used`, decl.name.range);
      }
    }

    // Local lets are lexical declarations, so a syntactically referenced one
    // counts even when its owning template has no Card context. Globals only
    // become used through a reachable Card/count/face/call graph.
    for (const decl of program.declarations) {
      if (decl.kind === "Let" && !this.collided.has(decl) && !this.usedLets.has(decl)) {
        this.warn("W002", `Binding '${decl.name.name}' is never used`, decl.name.range);
      }
      if (decl.kind === "TemplateDecl") this.warnUnusedLets(decl.children);
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
        globals: this.globals,
        cards,
        templateUsage: this.templateUsers,
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

  private markTemplateUsed(decl: TemplateDecl): void {
    if (!this.currentCard) return;
    this.usedTemplates.add(decl);
    const users = this.templateUsers.get(decl) ?? [];
    if (!users.includes(this.currentCard)) users.push(this.currentCard);
    this.templateUsers.set(decl, users);
  }

  private warnUnusedLets(children: readonly TemplateNode[]): void {
    for (const child of children) {
      if (child.kind === "Let" && !this.collided.has(child) && !this.usedLets.has(child)) {
        this.warn("W002", `Binding '${child.name.name}' is never used`, child.name.range);
      } else if (child.kind === "Repeat") {
        this.warnUnusedLets(child.children);
      } else if (child.kind === "IfBlock") {
        this.warnUnusedLets(child.thenChildren);
        if (child.elseBranch) this.warnUnusedLets(child.elseBranch.children);
      }
    }
  }

  // -- phase 1: declarations (§3.2) -----------------------------------------

  private collectDeclarations(program: Program): void {
    // One global namespace for all declared names (see header comment): first
    // declaration wins, later same-name declarations are E005.
    for (const decl of program.declarations) {
      if (decl.kind === "Let") {
        const previous = this.globals.get(decl.name.name);
        if (previous) {
          this.error("E005", `Duplicate global binding '${decl.name.name}'`, decl.name.range);
          this.collided.add(decl);
        } else {
          this.globals.set(decl.name.name, decl);
        }
        continue;
      }
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
    // Template parameter types may reference enums declared later, so resolve
    // them only after the declaration namespace is complete.
    for (const decl of program.declarations) {
      if (decl.kind !== "TemplateDecl") continue;
      const seen = new Set<string>();
      for (const param of decl.params) {
        if (seen.has(param.name.name)) {
          this.error(
            "E005",
            `Duplicate parameter '${param.name.name}' in Template '${decl.name.name}'`,
            param.name.range,
          );
          continue;
        }
        seen.add(param.name.name);
        this.paramTypes.set(param, this.resolveParameterType(param));
      }
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

    // Compatibility warning: columns keep precedence over program globals.
    for (const global of this.globals.values()) {
      for (const sheet of this.sheets.values()) {
        if (sheet.columns.has(global.name.name)) {
          this.warn(
            "W001",
            `Global binding '${global.name.name}' is hidden by column '${global.name.name}' of sheet '${sheet.decl.name.name}'`,
            global.name.range,
          );
        }
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
    const virtualColumns = new Map<string, VirtualColumnInfo>();
    const names = new Set<string>();
    for (const col of decl.columns) {
      const name = col.name.name;
      if (names.has(name)) {
        this.error(
          "E005",
          `Duplicate column '${name}' in sheet '${decl.name.name}'`,
          col.name.range,
        );
        continue;
      }
      names.add(name);
      if (
        name === "row" ||
        name === "card" ||
        name === "copy" ||
        name === "deck" ||
        name === "deck_card" ||
        name === "project_card"
      ) {
        // ◆42: a sheet's own same-named column shadows the built-in binding of
        // the same name for every Card that binds this sheet (§3.6 resolves
        // columns before built-ins) — warn at the column's declaration, like
        // the loop-/Repeat-variable shadow warnings below, rather than at
        // each `[ref]` that happens to resolve to it.
        this.warn(
          "W001",
          `Column '${name}' of sheet '${decl.name.name}' shadows the built-in [${name}] binding`,
          col.name.range,
        );
      }
      columns.set(name, { decl: col, type: this.resolveColumnType(col) });
    }
    for (const col of decl.virtualColumns) {
      const name = col.name.name;
      if (names.has(name)) {
        this.error(
          "E005",
          `Duplicate column '${name}' in sheet '${decl.name.name}'`,
          col.name.range,
        );
        continue;
      }
      names.add(name);
      virtualColumns.set(name, { decl: col, type: this.resolveColumnType(col) });
    }
    return { decl, columns, virtualColumns };
  }

  private resolveColumnType(col: ColumnDecl | VirtualColumnDecl): ValueType {
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

  private resolveParameterType(param: TemplateParamDecl): ValueType {
    const name = param.paramType.name;
    if (name === "Text") return TEXT;
    if (name === "Number") return NUMBER;
    if (name === "Bool") return BOOL;
    if (name === "Color") return COLOR;
    const enumDecl = this.enums.get(name);
    if (enumDecl) {
      this.markEnumUsed(enumDecl);
      return enumType(name);
    }
    const other = this.globalKinds.get(name);
    this.error(
      "E002",
      other !== undefined
        ? `'${name}' is ${other}, not a parameter type — expected Text, Number, Bool, Color, or an enum name`
        : `Unknown parameter type '${name}' — expected Text, Number, Bool, Color, or an enum name`,
      param.paramType.range,
    );
    return UNKNOWN;
  }

  // -- phase 2: cards (§3.2, §3.4, §3.7) ------------------------------------

  private checkCard(decl: CardDecl): CardBindings {
    const recorder: Recorder = {
      exprTypes: new Map(),
      resolutions: new Map(),
      letTypes: new Map(),
      templateCalls: new Map(),
    };
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
    let frontFace: FaceNode | null = null;
    let backFace: FaceNode | null = null;
    const present = new Set<string>();

    for (const item of decl.items) {
      if (item.kind === "Face") {
        if (present.has(item.face)) {
          this.error("E005", `Duplicate '${item.face}:' on Card '${decl.name.name}'`, item.range);
          continue;
        }
        present.add(item.face);
        const tpl = this.resolveFace(item);
        if (item.face === "Front") {
          front = tpl;
          frontFace = item;
        } else {
          back = tpl;
          backFace = item;
        }
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
              `Unknown size preset '${value.name}' — expected ${SIZE_PRESET_LIST}`,
              value.range,
            );
            break;
          }
          this.error(
            "E008",
            `size: must be one of ${SIZE_PRESET_LIST}`,
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
    for (const loop of loops) {
      if (sheet) {
        if (sheet.columns.has(loop.variable)) {
          this.warn(
            "W001",
            `Loop variable '${loop.variable}' shadows column '${loop.variable}' of sheet '${sheet.decl.name.name}'`,
            loop.varRange,
          );
        }
      }
      if (this.globals.has(loop.variable)) {
        this.warn(
          "W001",
          `Loop variable '${loop.variable}' shadows a global binding`,
          loop.varRange,
        );
      }
    }

    const loopMap = new Map<string, LoopBinding>();
    for (const loop of loops) loopMap.set(loop.variable, loop);
    const ctx: Ctx = {
      sheet,
      loops: loopMap,
      repeats: [],
      scopes: [],
      params: new Map(),
      letStates: new Map(),
      letStack: [],
      blockDepth: 0,
      record: recorder,
    };
    // ◆48: virtual columns are sheet-owned but evaluate in this Card's
    // complete context. They deliberately do NOT join sheet.columns, so
    // `[virtual_name]` cannot recursively or transitively read a computed
    // export field; share formulas through a program `let` instead.
    if (sheet) {
      for (const virtual of sheet.virtualColumns.values()) {
        this.checkValue(
          virtual.decl.initializer,
          this.expectedForVirtualColumn(virtual.type),
          ctx,
          false,
        );
      }
    }
    this.collectReachableTemplates([front, back], recorder);

    // `count:` is the Card's only expression property — evaluated per
    // row × loop combination (§3.7), so loop vars and columns are in scope,
    // but no Repeat vars and no geometry keywords.
    if (countExpr) this.checkValue(countExpr, EXP_NUMBER, ctx, false);

    // Faces: templates are checked in THIS card's context (⚑5, §3.6). A
    // template used as both faces is checked once — same context, same result.
    if (front) this.checkFaceTemplate(front, ctx, frontFace);
    if (back) this.checkFaceTemplate(back, ctx, backFace);

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
      frontFace,
      backFace,
      exprTypes: recorder.exprTypes,
      resolutions: recorder.resolutions,
      letTypes: recorder.letTypes,
      templateCalls: recorder.templateCalls,
    };
  }

  private expectedForVirtualColumn(type: ValueType): Expected {
    switch (type.kind) {
      case "Text":
        return EXP_TEXT;
      case "Number":
        return EXP_NUMBER;
      case "Enum": {
        const enumDecl = this.enums.get(type.enumName);
        return enumDecl ? { kind: "Enum", enumDecl } : EXP_NONE;
      }
      default:
        return EXP_NONE;
    }
  }

  private resolveFace(face: FaceNode): TemplateDecl | null {
    if (!face.template) return null; // parser-null: E001 already covered it
    const tpl = this.templates.get(face.template.name);
    if (tpl) {
      this.usedTemplates.add(tpl);
      this.markTemplateUsed(tpl);
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

  private checkFaceTemplate(
    tpl: TemplateDecl,
    ctx: Ctx,
    invocation: FaceNode | null = null,
  ): void {
    this.callPath = [tpl];
    this.activeCalls = 0;
    this.callNodes = [];
    this.compositionVisits = 0;
    this.compositionBlocked = false;
    ctx.scopes = [];
    ctx.repeats = [];
    ctx.params = new Map();
    ctx.letStates = new Map();
    ctx.letStack = [];
    ctx.blockDepth = 0;
    this.markTemplateUsed(tpl);
    if (invocation) {
      this.checkInvocationArguments(tpl, invocation.arguments, ctx, invocation.template?.range ?? invocation.range);
    }
    ctx.params = this.parameterMap(tpl);
    this.checkParameterShadows(tpl, ctx);
    this.checkTemplateBody(tpl, ctx);
    this.callPath = [];
  }

  private checkTemplateBody(tpl: TemplateDecl, ctx: Ctx): void {
    // Every invocation has its own lexical root. A call deliberately arrives
    // with no caller scopes/repeats, preserving one resolution per AST node.
    this.checkBlock(tpl.children, ctx, null, true);
  }

  private checkTemplateNode(node: TemplateNode, ctx: Ctx): void {
    if (this.compositionBlocked) return;
    if (
      this.activeCalls > 0 &&
      !this.chargeComposition(node.range, node.kind === "TemplateCall" ? node : undefined)
    ) return;
    if (ctx.blockDepth >= Checker.MAX_BLOCK_DEPTH) {
      this.error("E010", "Template structure is too deeply nested to check", node.range);
      return;
    }
    ctx.blockDepth++;
    try {
      switch (node.kind) {
        case "Repeat":
          this.checkRepeat(node, ctx);
          return;
        case "IfBlock":
          this.checkIfBlock(node, ctx);
          return;
        case "TemplateCall":
          this.checkTemplateCall(node, ctx);
          return;
        case "Let":
          // Hoisted and lazily typed when referenced.
          return;
        case "Element":
          this.checkElement(node, ctx);
          return;
      }
    } finally {
      ctx.blockDepth--;
    }
  }

  private checkBlock(
    children: readonly TemplateNode[],
    ctx: Ctx,
    repeat: { name: string; range: Range } | null,
    templateRoot = false,
  ): void {
    const lets = new Map<string, LetNode>();
    for (const child of children) {
      if (child.kind !== "Let") continue;
      if (templateRoot && ctx.params.has(child.name.name)) {
        this.error(
          "E005",
          `Root binding '${child.name.name}' conflicts with a parameter of the same Template`,
          child.name.range,
        );
        this.collided.add(child);
        continue;
      }
      const previous = lets.get(child.name.name);
      if (previous) {
        this.error("E005", `Duplicate binding '${child.name.name}' in the same scope`, child.name.range);
        this.collided.add(child);
      } else {
        lets.set(child.name.name, child);
      }
    }

    const scope: LetScope = { lets, repeat };
    ctx.scopes.push(scope);
    if (repeat) ctx.repeats.push(repeat);
    for (const binding of lets.values()) this.checkLetShadow(binding, ctx);
    // Local declarations belong to a statically reachable template block, so
    // type their initializers even when the value is runtime-lazy. This also
    // builds the complete dependency graph for W002/E009; globals retain the
    // stricter per-Card reachability exception and are inferred on reference.
    for (const binding of lets.values()) {
      this.inferLet(binding, "local", binding.name.range, ctx);
    }
    for (const child of children) this.checkTemplateNode(child, ctx);
    if (repeat) ctx.repeats.pop();
    ctx.scopes.pop();
  }

  /** Populate the complete transitive usage/target graph independently of
   * expansion checking. A diamond is visited once, and cycles terminate by
   * Template identity, so caps never leave Bindings only half-resolved. */
  private collectReachableTemplates(
    roots: readonly (TemplateDecl | null)[],
    recorder: Recorder,
  ): void {
    const seen = new Set<TemplateDecl>();
    const graph = new Map<TemplateDecl, TemplateCallEdge[]>();
    const stack = roots.filter((tpl): tpl is TemplateDecl => tpl !== null).reverse();
    while (stack.length > 0) {
      const tpl = stack.pop()!;
      if (seen.has(tpl)) continue;
      seen.add(tpl);
      const edges = graph.get(tpl) ?? [];
      graph.set(tpl, edges);
      this.markTemplateUsed(tpl);
      const nodes = [...tpl.children].reverse();
      while (nodes.length > 0) {
        const node = nodes.pop()!;
        if (node.kind === "TemplateCall") {
          const target = this.templates.get(node.template.name);
          if (target) {
            edges.push({ target, call: node });
            recorder.templateCalls.set(node, target);
            this.usedTemplates.add(target);
            this.markTemplateUsed(target);
            if (!seen.has(target)) stack.push(target);
          }
        } else if (node.kind === "Repeat") {
          for (let i = node.children.length - 1; i >= 0; i--) nodes.push(node.children[i]);
        } else if (node.kind === "IfBlock") {
          if (node.elseBranch) {
            for (let i = node.elseBranch.children.length - 1; i >= 0; i--) {
              nodes.push(node.elseBranch.children[i]);
            }
          }
          for (let i = node.thenChildren.length - 1; i >= 0; i--) nodes.push(node.thenChildren[i]);
        }
      }
    }
    this.reportTemplateGraphCycles(graph);
  }

  /** Report cycles from the complete reachable graph before composition caps
   * truncate the expansion walk. Kosaraju's two iterative passes keep very
   * long cycles never-throw and yield one primary E009 per SCC. */
  private reportTemplateGraphCycles(graph: ReadonlyMap<TemplateDecl, TemplateCallEdge[]>): void {
    const order: TemplateDecl[] = [];
    const visited = new Set<TemplateDecl>();
    for (const start of graph.keys()) {
      if (visited.has(start)) continue;
      visited.add(start);
      const stack: { template: TemplateDecl; next: number }[] = [{ template: start, next: 0 }];
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const edges = graph.get(frame.template) ?? [];
        if (frame.next < edges.length) {
          const target = edges[frame.next++].target;
          if (!visited.has(target)) {
            visited.add(target);
            stack.push({ template: target, next: 0 });
          }
        } else {
          order.push(frame.template);
          stack.pop();
        }
      }
    }

    const reverse = new Map<TemplateDecl, TemplateDecl[]>();
    for (const template of graph.keys()) reverse.set(template, []);
    for (const [from, edges] of graph) {
      for (const { target } of edges) {
        const incoming = reverse.get(target) ?? [];
        incoming.push(from);
        reverse.set(target, incoming);
      }
    }

    const assigned = new Set<TemplateDecl>();
    for (let i = order.length - 1; i >= 0; i--) {
      const start = order[i];
      if (assigned.has(start)) continue;
      const component: TemplateDecl[] = [];
      const pending = [start];
      assigned.add(start);
      while (pending.length > 0) {
        const template = pending.pop()!;
        component.push(template);
        for (const source of reverse.get(template) ?? []) {
          if (!assigned.has(source)) {
            assigned.add(source);
            pending.push(source);
          }
        }
      }
      const selfLoop =
        component.length === 1 &&
        (graph.get(component[0]) ?? []).some(({ target }) => target === component[0]);
      if ((component.length === 1 && !selfLoop) || component.some((t) => this.cyclicTemplates.has(t))) {
        continue;
      }

      const members = new Set(component);
      const path: TemplateDecl[] = [];
      const positions = new Map<TemplateDecl, number>();
      const colors = new Map<TemplateDecl, 0 | 1 | 2>();
      let found: { templates: TemplateDecl[]; closing: TemplateCallNode } | null = null;
      for (const root of component) {
        if (found || (colors.get(root) ?? 0) !== 0) continue;
        colors.set(root, 1);
        positions.set(root, path.length);
        path.push(root);
        const frames: { template: TemplateDecl; next: number }[] = [{ template: root, next: 0 }];
        while (frames.length > 0 && !found) {
          const frame = frames[frames.length - 1];
          const edges = (graph.get(frame.template) ?? []).filter(({ target }) => members.has(target));
          if (frame.next < edges.length) {
            const edge = edges[frame.next++];
            const color = colors.get(edge.target) ?? 0;
            if (color === 0) {
              colors.set(edge.target, 1);
              positions.set(edge.target, path.length);
              path.push(edge.target);
              frames.push({ template: edge.target, next: 0 });
            } else if (color === 1) {
              const at = positions.get(edge.target) ?? 0;
              found = { templates: [...path.slice(at), edge.target], closing: edge.call };
            }
          } else {
            frames.pop();
            const done = path.pop();
            if (done) {
              positions.delete(done);
              colors.set(done, 2);
            }
          }
        }
      }
      if (!found) continue;
      for (const template of component) this.cyclicTemplates.add(template);
      this.error(
        "E009",
        `Template call cycle: ${found.templates.map((t) => t.name.name).join(" -> ")}`,
        found.closing.template.range,
      );
    }
  }

  private checkIfBlock(node: IfNode, ctx: Ctx): void {
    this.checkValue(node.condition, EXP_BOOL, ctx, false);
    this.checkBlock(node.thenChildren, ctx, null);
    if (node.elseBranch) this.checkBlock(node.elseBranch.children, ctx, null);
  }

  private checkLetShadow(binding: LetNode, ctx: Ctx): void {
    const name = binding.name.name;
    let shadowed: string | null = null;
    const current = ctx.scopes[ctx.scopes.length - 1];
    if (current?.repeat?.name === name) shadowed = "an enclosing Repeat variable";
    for (let i = ctx.scopes.length - 2; i >= 0 && !shadowed; i--) {
      const scope = ctx.scopes[i];
      if (scope.lets.has(name)) shadowed = "an outer binding";
      else if (scope.repeat?.name === name) shadowed = "an enclosing Repeat variable";
    }
    if (!shadowed && ctx.params.has(name)) shadowed = "a Template parameter";
    if (!shadowed && ctx.loops.has(name)) shadowed = "a Card loop variable";
    if (!shadowed && ctx.sheet?.columns.has(name)) {
      shadowed = `column '${name}' of sheet '${ctx.sheet.decl.name.name}'`;
    }
    if (!shadowed && this.globals.has(name)) shadowed = "a global binding";
    if (shadowed) {
      this.warn("W001", `Binding '${name}' shadows ${shadowed}`, binding.name.range);
    }
  }

  private checkRepeat(node: RepeatNode, ctx: Ctx): void {
    // The count is a Number expression; outer Repeat vars are in scope,
    // geometry keywords are not (they belong to element geometry positions).
    this.checkValue(node.count, EXP_NUMBER, ctx, false);
    if (node.variable) {
      const name = node.variable.name;
      let shadowed: string | null = null;
      for (let i = ctx.scopes.length - 1; i >= 0 && !shadowed; i--) {
        const scope = ctx.scopes[i];
        if (scope.lets.has(name)) shadowed = "an enclosing binding";
        else if (scope.repeat?.name === name) shadowed = "an enclosing Repeat variable";
      }
      if (!shadowed && ctx.params.has(name)) shadowed = "a Template parameter";
      if (!shadowed && ctx.loops.has(name)) shadowed = "a loop variable";
      if (!shadowed && ctx.sheet?.columns.has(name)) {
        shadowed = `column '${name}' of sheet '${ctx.sheet.decl.name.name}'`;
      }
      if (!shadowed && this.globals.has(name)) shadowed = "a global binding";
      if (shadowed) {
        this.warn(
          "W001",
          `Repeat variable '${name}' shadows ${shadowed}`,
          node.variable.range,
        );
      }
      this.checkBlock(node.children, ctx, { name, range: node.variable.range });
    } else {
      // Parser-null variable (E001 covered): children still get checked.
      this.checkBlock(node.children, ctx, null);
    }
  }

  private checkTemplateCall(node: TemplateCallNode, ctx: Ctx): void {
    // A root-level call itself is the first composition-only visit. Nested
    // calls were already charged by checkTemplateNode.
    if (this.activeCalls === 0 && !this.chargeComposition(node.range, node)) return;
    const tpl = this.templates.get(node.template.name);
    if (!tpl) {
      const other = this.globalKinds.get(node.template.name);
      this.error(
        "E002",
        other && other !== "a Template"
          ? `'${node.template.name}' is ${other}, not a Template`
          : `Unknown template '${node.template.name}'`,
        node.template.range,
      );
      return;
    }
    this.checkInvocationArguments(tpl, node.arguments, ctx, node.template.range);
    ctx.record?.templateCalls.set(node, tpl);
    if (this.currentCard) {
      this.usedTemplates.add(tpl);
      this.markTemplateUsed(tpl);
    }

    const cycleAt = this.callPath.indexOf(tpl);
    if (cycleAt >= 0) {
      const members = this.callPath.slice(cycleAt);
      if (!members.some((member) => this.cyclicTemplates.has(member))) {
        for (const member of members) this.cyclicTemplates.add(member);
        const path = [...members, tpl].map((t) => t.name.name).join(" -> ");
        this.error("E009", `Template call cycle: ${path}`, node.template.range);
      }
      return;
    }
    if (this.activeCalls >= Checker.MAX_TEMPLATE_CALL_DEPTH) {
      this.error(
        "E010",
        `Template composition exceeds ${Checker.MAX_TEMPLATE_CALL_DEPTH} active calls`,
        node.template.range,
      );
      return;
    }

    this.activeCalls++;
    this.callNodes.push(node);
    this.callPath.push(tpl);
    const callerScopes = ctx.scopes;
    const callerRepeats = ctx.repeats;
    const callerParams = ctx.params;
    ctx.scopes = [];
    ctx.repeats = [];
    ctx.params = this.parameterMap(tpl);
    this.checkParameterShadows(tpl, ctx);
    this.checkTemplateBody(tpl, ctx);
    ctx.scopes = callerScopes;
    ctx.repeats = callerRepeats;
    ctx.params = callerParams;
    this.callPath.pop();
    this.callNodes.pop();
    this.activeCalls--;
  }

  private parameterMap(tpl: TemplateDecl): ReadonlyMap<string, TemplateParamDecl> {
    const params = new Map<string, TemplateParamDecl>();
    for (const param of tpl.params) {
      if (!params.has(param.name.name)) params.set(param.name.name, param);
    }
    return params;
  }

  private expectedForParameter(param: TemplateParamDecl): Expected {
    const type = this.paramTypes.get(param) ?? UNKNOWN;
    if (type.kind === "Number") return EXP_NUMBER;
    if (type.kind === "Text") return EXP_TEXT;
    if (type.kind === "Bool") return EXP_BOOL;
    if (type.kind === "Color") return EXP_COLOR;
    if (type.kind === "Enum") {
      const enumDecl = this.enums.get(type.enumName);
      return enumDecl ? { kind: "Enum", enumDecl } : EXP_NONE;
    }
    return EXP_NONE;
  }

  /** Check arguments in the caller activation; the callee scope is installed afterwards. */
  private checkInvocationArguments(
    tpl: TemplateDecl,
    args: readonly TemplateArgumentNode[],
    ctx: Ctx,
    callRange: Range,
  ): void {
    const params = this.parameterMap(tpl);
    const seen = new Set<string>();
    for (const arg of args) {
      const name = arg.name.name;
      if (seen.has(name)) {
        this.depthReported = false;
        this.typeOf(arg.value, EXP_NONE, ctx, false);
        this.error("E005", `Duplicate argument '${name}'`, arg.name.range);
        continue;
      }
      seen.add(name);
      const param = params.get(name);
      if (!param) {
        this.depthReported = false;
        this.typeOf(arg.value, EXP_NONE, ctx, false);
        this.error(
          "E008",
          `Unknown argument '${name}' for Template '${tpl.name.name}'`,
          arg.name.range,
        );
        continue;
      }
      this.depthReported = false;
      const expected = this.expectedForParameter(param);
      const actual = this.typeOf(arg.value, expected, ctx, false);
      const declared = this.paramTypes.get(param) ?? UNKNOWN;
      // Parameter values retain their declared runtime kind. Unlike a text:
      // property, the Number/Enum-to-Text display coercion is not an assignment
      // conversion and would make later uses of [param] unsound.
      if (actual.kind !== "Unknown" && declared.kind !== "Unknown" && !sameType(actual, declared)) {
        this.error(
          "E003",
          `Argument '${name}' expects ${typeName(declared)}, got ${typeName(actual)}`,
          arg.value.range,
        );
      }
    }
    for (const [name] of params) {
      if (!seen.has(name)) {
        this.error(
          "E008",
          `Missing argument '${name}' for Template '${tpl.name.name}'`,
          callRange,
        );
      }
    }
  }

  private checkParameterShadows(tpl: TemplateDecl, ctx: Ctx): void {
    for (const param of this.parameterMap(tpl).values()) {
      const name = param.name.name;
      let shadowed: string | null = null;
      if (ctx.loops.has(name)) shadowed = "a Card loop variable";
      else if (ctx.sheet?.columns.has(name)) {
        shadowed = `column '${name}' of sheet '${ctx.sheet.decl.name.name}'`;
      } else if (this.globals.has(name)) shadowed = "a global binding";
      if (shadowed) {
        this.warn("W001", `Parameter '${name}' shadows ${shadowed}`, param.name.range);
      }
    }
  }

  private chargeComposition(range: Range, crossing?: TemplateCallNode): boolean {
    this.compositionVisits++;
    if (this.compositionVisits <= Checker.MAX_COMPOSITION_VISITS) return true;
    const call = crossing ?? this.callNodes[this.callNodes.length - 1];
    this.error(
      "E010",
      `Template composition exceeds ${Checker.MAX_COMPOSITION_VISITS.toLocaleString()} expanded node visits`,
      call?.template.range ?? range,
    );
    this.compositionBlocked = true;
    return false;
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
        // §3.4/◆36†: `anchor:` was renamed to `pivot:` — a saved project
        // using the old name should fail loudly and self-explain why,
        // rather than read like an ordinary unknown-property typo.
        const hint =
          key === "anchor"
            ? ` — it was renamed to 'pivot:' (a future 'anchor:' will position relative to the card)`
            : "";
        this.error("E008", `Unknown property '${key}:' on ${el.element}${hint}`, prop.key.range);
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
    // §3.3 auto dimension: BOTH width: and height: as bare `auto` leaves no
    // dimension to derive the ratio from — E008 once, at the later value.
    // checkElementProperty records no autoDim resolution for either (the
    // property-level guard mirrors this check), so evaluation degrades the
    // instance to a D000 placeholder like any other compile-poisoned card.
    if (el.element === "Image") {
      const w = firstPropValue(el, "width");
      const h = firstPropValue(el, "height");
      if (isBareAuto(w) && isBareAuto(h)) {
        const later =
          w.range.startLine > h.range.startLine ||
          (w.range.startLine === h.range.startLine && w.range.startCol > h.range.startCol)
            ? w
            : h;
        this.error(
          "E008",
          `Image cannot use 'auto' for both width: and height: — give one dimension a number so the other can follow the art's ratio`,
          later.range,
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
        // sugar for `x: half` + `pivot: middle`; Rectangle and Image get no
        // such sugar, so `x: middle` there is E007 like any other misplacement).
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
      case "width":
      case "height": {
        // Image `auto` dimension (§3.3): the bare keyword as the ENTIRE
        // width:/height: value of an Image derives that dimension from the
        // art's intrinsic ratio at LOAD time. Like `x: middle`, the checker
        // only blesses the position — the model carries the keyword. Only
        // ONE of the pair may be auto: when the sibling dimension is auto
        // too, checkElement already reported E008 and NO resolution is
        // recorded here, so evaluation degrades to the D000 placeholder.
        if (el.element === "Image" && isBareAuto(value)) {
          const sibling = key === "width" ? "height" : "width";
          if (!isBareAuto(firstPropValue(el, sibling))) {
            this.recordResolution(ctx, value, { kind: "autoDim" });
            this.recordType(ctx, value, NUMBER);
          }
          return;
        }
        this.checkValue(value, EXP_NUMBER, ctx, true);
        return;
      }
      case "y":
      case "size":
        this.checkValue(value, EXP_NUMBER, ctx, true);
        return;
      case "rotate":
        // Every drawable element (§3.4, M4 — ◆43): degrees clockwise around
        // the pivot point, any Number expression (data-driven allowed),
        // default 0. An ANGLE, not a length — geometryOk is false, so a bare
        // `full`/`half` here is the usual E007 keyword misuse, exactly as in
        // any non-geometry Number position. Non-Number is the usual E003.
        this.checkValue(value, EXP_NUMBER, ctx, false);
        return;
      case "color":
        this.checkValue(value, EXP_COLOR, ctx, false);
        return;
      case "background":
        // Qr only (ELEMENT_SPECS): the quiet-zone/background fill, Color-
        // typed exactly like color: (§7.1a); default white.
        this.checkValue(value, EXP_COLOR, ctx, false);
        return;
      case "text": {
        this.checkValue(value, EXP_TEXT, ctx, false);
        // Inline icons (◆44, §7.5): a LITERAL text: (no interpolation,
        // literalStringValue's contract — interpolated/computed text is
        // runtime territory, D005, same rationale as Icon codes) is scanned
        // for markers. An unknown dicier code is W004 exactly like Icon
        // `code:` (the curated list is non-exhaustive, ⚑10†); an asset
        // marker whose name isn't in the supplied library is W005 exactly
        // like an `asset:` Image src (skipped entirely when no library was
        // supplied — see check()'s doc comment).
        const raw = literalStringValue(value);
        // Single-line Text renders newlines as spaces BEFORE marker parsing
        // (§3.3.2) — scan the same string the evaluator will parse, or a
        // literal like "{HEA\nRTS}" would silently become a marker the
        // checker never saw (space IS in the code alphabet). TextBox keeps
        // newlines as hard breaks, where a brace-spanning newline never
        // forms a marker on either side — no normalization there.
        const literal = raw !== null && el.element === "Text" ? raw.replace(/\n/g, " ") : raw;
        if (literal !== null) {
          for (const segment of parseInlineMarkers(literal)) {
            if (segment.kind !== "icon") continue;
            if (segment.icon.kind === "dicier") {
              if (!DICIER_CODES.has(segment.icon.code)) {
                this.warn(
                  "W004",
                  `Unknown icon code "${segment.icon.code}" — not in the curated Dicier list (which is non-exhaustive; the glyph may still exist)`,
                  value.range,
                );
              }
            } else if (this.assetNames && !this.assetNames.has(segment.icon.name)) {
              this.warn("W005", `Unknown asset '${segment.icon.name}'`, value.range);
            }
          }
        }
        return;
      }
      case "src": {
        // Image only (ELEMENT_SPECS): a Text expression with the usual §3.5
        // coercions — URLs routinely come from a sheet column or an
        // interpolated string, so no literal-shape restriction applies.
        this.checkValue(value, EXP_TEXT, ctx, false);
        // W005 (§7.1b): mirrors W004's shape exactly — a LITERAL src (no
        // interpolation, literalStringValue's contract) starting with the
        // asset: scheme is checked against the current library; computed
        // srcs (interpolated, [refs], conditionals) are runtime territory,
        // same rationale as computed icon codes not getting W004. Skipped
        // entirely when no library was supplied (see check()'s doc comment)
        // — never a false "unknown asset" for a caller with no library.
        if (this.assetNames) {
          const literal = literalStringValue(value);
          const name = literal !== null ? parseAssetSrc(literal) : null;
          if (name !== null && !this.assetNames.has(name)) {
            this.warn("W005", `Unknown asset '${name}'`, value.range);
          }
        }
        return;
      }
      case "data":
        // Qr only (ELEMENT_SPECS): a Text expression with the usual §3.5
        // coercions, exactly like src: — QR content routinely comes from a
        // sheet column of codes (§7.1a's canonical per-card-backs idiom).
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
      case "pivot": {
        // Nine-point pivots (§3.4, M3): every drawable element names which
        // point of it x/y refer to. parsePivot (model.ts) owns the accepted
        // vocabulary — the canonical tokens in either word order, the
        // `center` shorthand, and the legacy Text/Icon words as top-row
        // aliases — and the recorded resolution carries the NORMALIZED
        // {h, v}, so every spelling of one point is identical downstream.
        // The E008 names the canonical vocabulary only: aliases are
        // compatibility, not the language.
        if (value.kind === "Error") return;
        if (value.kind === "Identifier") {
          const pivot = parsePivot(value.name);
          if (pivot) {
            this.recordResolution(ctx, value, { kind: "pivot", pivot });
            return;
          }
        }
        this.error(
          "E008",
          `pivot: must be one of ${PIVOT_TOKENS.join(", ")} (either word order), or center`,
          value.range,
        );
        return;
      }
      case "align": {
        // TextBox only (ELEMENT_SPECS): the same three words as pivot, but
        // recorded as its own kind — a box aligns lines within its width
        // (§3.3, M3). Resolved by expected type like pivot; E008 otherwise.
        if (value.kind === "Error") return;
        if (
          value.kind === "Identifier" &&
          (value.name === "left" || value.name === "middle" || value.name === "right")
        ) {
          this.recordResolution(ctx, value, {
            kind: "align",
            keyword: value.name,
          });
          return;
        }
        this.error("E008", `align: must be left, middle, or right`, value.range);
        return;
      }
      case "overflow": {
        // TextBox only (ELEMENT_SPECS): a bare identifier from the closed
        // clip/shrink vocabulary, resolved like fit (§3.3, M3).
        if (value.kind === "Error") return;
        if (value.kind === "Identifier" && TEXTBOX_OVERFLOW_SET.has(value.name)) {
          this.recordResolution(ctx, value, {
            kind: "overflow",
            value: value.name as TextBoxOverflow,
          });
          return;
        }
        this.error(
          "E008",
          `overflow: must be ${TEXTBOX_OVERFLOWS.join(" or ")}`,
          value.range,
        );
        return;
      }
      case "line_height": {
        // TextBox only (ELEMENT_SPECS): a positive number LITERAL, like
        // width_mm — line spacing is a layout constant, never data-driven
        // (§3.3, M3). The evaluator reads the same literal shape directly,
        // so accepting exactly this form here keeps the two in lockstep.
        if (value.kind === "Error") return;
        if (isPositiveNumberLiteral(value)) {
          this.recordType(ctx, value, NUMBER);
          return;
        }
        this.error(
          "E008",
          `line_height: must be a positive number literal (a multiplier on size:, e.g. line_height: 1.3)`,
          value.range,
        );
        return;
      }
      case "style": {
        // Icon only (ELEMENT_SPECS): a bare identifier from the closed ten-
        // face vocabulary, resolved by expected type like pivot (§3.3, M2).
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
      case "font": {
        // Text/TextBox only (ELEMENT_SPECS): a bare identifier from the
        // closed nine-face vocabulary, resolved by expected type exactly
        // like Icon's style: (§3.3, M3 — ◆41). Like style (and unlike codes'
        // open W004 list) the faces ARE the full set — unknown or a
        // non-identifier expression is E008, not a warning.
        if (value.kind === "Error") return;
        if (value.kind === "Identifier" && FONT_FACE_SET.has(value.name)) {
          this.recordResolution(ctx, value, {
            kind: "font",
            face: value.name as FontFace,
          });
          return;
        }
        this.error("E008", `font: must be one of ${FONT_FACES.join(", ")}`, value.range);
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
      case "level": {
        // Qr only (ELEMENT_SPECS): a bare identifier from the closed four-
        // level error-correction vocabulary, resolved by expected type like
        // fit/style (§7.1a) — E008 on anything else.
        if (value.kind === "Error") return;
        if (value.kind === "Identifier" && QR_LEVEL_SET.has(value.name)) {
          this.recordResolution(ctx, value, {
            kind: "qrLevel",
            level: value.name as QrLevel,
          });
          return;
        }
        this.error("E008", `level: must be one of ${QR_LEVELS.join(", ")}`, value.range);
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
    const states = ctx.letStates;
    const stack = ctx.letStack;
    ctx.letStates = new Map(states);
    ctx.letStack = [...stack];
    this.silent++;
    try {
      return this.typeOf(expr, expected, ctx, geometryOk);
    } finally {
      this.silent--;
      ctx.letStates = states;
      ctx.letStack = stack;
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
   * sheet's columns → built-in generated-instance identity bindings (§3.6,
   * ◆42). When the context has no usable sheet (unknown/missing sheet,
   * unused template), sheet-column lookup is skipped and unmatched refs
   * poison silently — the cause has its own diagnostic already — but the
   * built-ins still resolve: they never depend on sheet DATA, only on a
   * Card's generation position, so there is nothing to poison against. */
  private resolveRef(name: string, range: Range, ctx: Ctx, node: ResolvableNode): ValueType {
    if (this.globalInitDepth === 0) {
      for (let i = ctx.scopes.length - 1; i >= 0; i--) {
        const scope = ctx.scopes[i];
        const binding = scope.lets.get(name);
        if (binding) return this.resolveLet(binding, "local", range, ctx, node);
        if (scope.repeat?.name === name) {
          this.recordResolution(ctx, node, { kind: "repeatVar" });
          return NUMBER;
        }
      }
      const param = ctx.params.get(name);
      if (param) {
        const type = this.paramTypes.get(param) ?? UNKNOWN;
        this.recordResolution(ctx, node, { kind: "param", parameter: param, type });
        return type;
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

    // A global initializer gives program bindings precedence over ambient
    // columns, keeping its dependency graph stable across Sheets. Ordinary
    // expressions preserve the compatibility lookup (column before global).
    if (this.globalInitDepth > 0) {
      const global = this.globals.get(name);
      if (global) return this.resolveLet(global, "global", range, ctx, node);
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
    }
    if (this.globalInitDepth === 0 && ctx.record) {
      const global = this.globals.get(name);
      if (global) return this.resolveLet(global, "global", range, ctx, node);
    }
    // Built-in generated-instance identity bindings are last. `[deck]` is
    // Text; every numbering binding is a 1-based Number.
    if (
      name === "row" ||
      name === "card" ||
      name === "copy" ||
      name === "deck" ||
      name === "deck_card" ||
      name === "project_card"
    ) {
      this.recordResolution(ctx, node, { kind: "position", which: name });
      return name === "deck" ? TEXT : NUMBER;
    }
    if (ctx.sheet) this.error("E002", `Unknown reference [${name}]`, range);
    return UNKNOWN;
  }

  private resolveLet(
    binding: LetNode,
    scope: "global" | "local",
    range: Range,
    ctx: Ctx,
    node: ResolvableNode,
  ): ValueType {
    if (this.silent === 0 && (scope === "local" || ctx.record)) this.usedLets.add(binding);
    const type = this.inferLet(binding, scope, range, ctx);
    this.recordResolution(ctx, node, { kind: "let", binding, scope, type });
    return type;
  }

  private inferLet(
    binding: LetNode,
    scope: "global" | "local",
    range: Range,
    ctx: Ctx,
  ): ValueType {
    const state = ctx.letStates.get(binding);
    if (state?.state === "evaluating") {
      const start = Math.max(0, ctx.letStack.indexOf(binding));
      const cycle = [...ctx.letStack.slice(start), binding];
      const members = cycle.slice(0, -1);
      // Speculative typing suppresses diagnostics and must not permanently
      // mark the SCC: the committed pass still needs to emit its one E009.
      if (this.silent === 0 && !members.some((decl) => this.cyclicLets.has(decl))) {
        for (const decl of members) this.cyclicLets.add(decl);
        this.error(
          "E009",
          `Binding dependency cycle: ${cycle.map((decl) => decl.name.name).join(" -> ")}`,
          range,
        );
      }
      return UNKNOWN;
    }
    if (state?.state === "done") return state.type;

    ctx.letStates.set(binding, { state: "evaluating", type: UNKNOWN });
    ctx.letStack.push(binding);
    if (scope === "global") this.globalInitDepth++;
    // A dependency edge between bindings is not syntactic expression
    // nesting. Give each initializer its own expression-depth budget so a
    // long dependency cycle reaches the evaluating-slot E009 detector.
    const callerExprDepth = this.exprDepth;
    this.exprDepth = 0;
    let type: ValueType;
    try {
      type = this.typeOf(binding.initializer, EXP_NONE, ctx, false);
    } finally {
      this.exprDepth = callerExprDepth;
      if (scope === "global") this.globalInitDepth--;
    }
    ctx.letStack.pop();
    ctx.letStates.set(binding, { state: "done", type });
    if (this.silent === 0) ctx.record?.letTypes.set(binding, type);
    return type;
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
          ? `'auto' is only valid as a Card's y_units: value or as the entire width: or height: of an Image`
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

/** First property value with this key (the checker E005s duplicates and
 * checks only the first — the same one the evaluator's findProp takes). */
function firstPropValue(el: ElementNode, key: string): Expr | null {
  for (const prop of el.properties) {
    if (prop.key.name === key) return prop.value;
  }
  return null;
}

/** Bare `auto` as a whole property value (§3.3 Image auto dimension). */
function isBareAuto(expr: Expr | null): expr is IdentifierExpr {
  return expr !== null && expr.kind === "Identifier" && expr.name === "auto";
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
