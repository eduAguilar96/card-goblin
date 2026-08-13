/**
 * Expression + element evaluator for Goblin script (DESIGN.md §3.3–§3.5, §3.7).
 *
 * Everything here runs inside ONE card instance's try/catch (⚑8): data
 * problems throw `DataError`, which generate.ts converts into an
 * error-placeholder instance; no exception escapes upward. Name resolution
 * and typing are NOT re-implemented — every ref/bare name is looked up in
 * the checker's per-Card `resolutions`, and a missing entry (which occurs
 * only in already-diagnosed poisoned contexts) degrades to a D000 DataError
 * — outside the §3.8 catalog by design, mirroring the checker's E000: it
 * means "this card has compile errors", never a data-entry mistake.
 *
 * Decisions resolved here beyond the spec text (each documented at its site):
 * - `and`/`or` short-circuit and `if` evaluates only the taken branch, so
 *   guards like `if [n] == 0 then 0 else 10 / [n]` cannot trip D008.
 * - `size:` uses the X axis for `full`/`half` (the axis of an em height is
 *   genuinely ambiguous; X keeps `size: half` independent of `y_units`) —
 *   on TextBox too, for consistency with Text.
 * - `x: middle` forces the anchor's HORIZONTAL component to center even when
 *   an explicit `anchor:` is also written — the sugar wins horizontally; the
 *   anchor's vertical component still applies (§3.4, M3).
 * - D005 fires only for COMPUTED icon codes: literal codes were already
 *   W004-checked at compile time (§3.8); re-reporting would double-flag.
 * - Text cells pass through verbatim (no trimming); trimming applies only
 *   to validation and Number/Enum parsing.
 */

import type {
  ElementNode,
  Expr,
  RepeatNode,
  StringLit,
  TemplateDecl,
  TemplateNode,
} from "./ast";
import type { CardBindings, ResolvableNode, Resolution } from "./check";
import type {
  Anchor,
  DataDiagnostic,
  FontFace,
  IconStyle,
  ImageFit,
  LoopCaseBinding,
  QrLevel,
  Shape,
  TextAnchor,
  TextBoxOverflow,
} from "./model";
import {
  DEFAULT_ANCHOR,
  DEFAULT_FONT,
  DEFAULT_ICON_STYLE,
  DEFAULT_IMAGE_FIT,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_QR_LEVEL,
  DEFAULT_TEXTBOX_OVERFLOW,
} from "./model";
import { DICIER_CODES } from "./dicier-codes";
import { encodeQr } from "./qr";
import { layoutTextBox, metricsForFace } from "./wrap";

// ---------------------------------------------------------------------------
// Values and errors
// ---------------------------------------------------------------------------

/** A resolved runtime value (§3.5). All numbers are finite by construction:
 * cell validation rejects non-finite cells and every arithmetic result is
 * D008-checked, so no NaN/Infinity ever flows onward. */
export type Value =
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "enumCase"; enumName: string; caseName: string }
  | { kind: "color"; value: string };

/** A data-time failure of the current card instance (⚑8). Caught per
 * instance in generate.ts and turned into an error placeholder. */
export class DataError extends Error {
  readonly diagnostics: DataDiagnostic[];

  constructor(diagnostics: DataDiagnostic[]) {
    super(diagnostics.map((d) => d.message).join("; "));
    this.name = "DataError";
    this.diagnostics = diagnostics;
  }
}

/** Repeat-iteration budget per card instance (◆27: 500 per card). The budget
 * is shared by both faces of one instance, and EVERY iteration of every
 * Repeat — nested included — counts toward it, so nested repeats multiply
 * against the same total. */
export const REPEAT_CAP = 500;

/** Evaluation context for one row × loop-case combination (§3.6, §3.7).
 * Built by generate.ts; the cell accessors close over that sheet's
 * validation results so invalid-cell diagnostics are REUSED, not duplicated. */
export interface EvalContext {
  /** Bindings of the Card whose context we evaluate in (per-Card
   * resolutions — a template shared by N cards has N recorder contexts). */
  card: CardBindings;
  xUnits: number;
  /** May be fractional (⚑7†). */
  yUnits: number;
  /** Raw text of a cell in the current row ("" for a missing key). */
  rawCell: (column: string) => string;
  /** The D001/D002 validation diagnostic for a cell of the current row. */
  cellIssue: (column: string) => DataDiagnostic | undefined;
  /** Create-or-reuse the D003 for an empty referenced Number/Enum cell
   * (◆19): the factory dedupes per cell and registers it globally. */
  emptyCellIssue: (column: string, typeLabel: "Number" | "Enum") => DataDiagnostic;
  /** Loop variable → enum case for the current combination. */
  loopValues: ReadonlyMap<string, LoopCaseBinding>;
  /** Innermost-last stack of enclosing Repeat variables. */
  repeatStack: { name: string; value: number }[];
  /** Remaining Repeat iterations for this instance (◆27). */
  budget: { remaining: number };
  /** D005 icon-code diagnostics collected during face evaluation — the
   * icons still render (§3.8 †); generate.ts fills in cardRef. Keyed by
   * code, so one combination reports each unknown code ONCE no matter how
   * many Repeat iterations draw it (mirrors the D001–D003 sharing rule). */
  iconIssues: Map<string, DataDiagnostic>;
}

// ---------------------------------------------------------------------------
// Cell parsing (shared with generate.ts's validation pass)
// ---------------------------------------------------------------------------

/** Decimal number with optional sign and exponent — deliberately narrower
 * than `Number()`: no hex/binary/octal, no "Infinity", no bare "". */
const NUMBER_CELL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Parse a trimmed cell under a Number column (§3.8 D002): finite decimal
 * or null. Overflow to Infinity (e.g. "1e999") is invalid too — the D002
 * contract says finite. */
export function parseNumberCell(trimmed: string): number | null {
  if (!NUMBER_CELL_RE.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Expression evaluation (§3.5)
// ---------------------------------------------------------------------------

/** The per-card D000 diagnostic for compile-poisoned contexts — shared by
 * every poison path here and by generate.ts's statically-mistyped `count:`
 * arm, so all of them degrade identically. */
export function compileErrorDiagnostic(): DataDiagnostic {
  return {
    code: "D000",
    message:
      "Card cannot be rendered while its code has compile errors — fix the errors in the code window",
  };
}

/** Compile-poisoned context (missing resolution / a kind the checker already
 * squiggled): degrade to a per-card D000 placeholder, never throw raw. */
function poisoned(): never {
  throw new DataError([compileErrorDiagnostic()]);
}

const num = (value: number): Value => ({ kind: "number", value });
const bool = (value: boolean): Value => ({ kind: "bool", value });
const text = (value: string): Value => ({ kind: "text", value });

/** Recursion budget, mirroring check.ts's MAX_EXPR_DEPTH (⚑8): a 10k-term
 * `1 + 1 + …` chain parses ITERATIVELY but arrives here as a 10k-deep left
 * spine — the budget turns a would-be RangeError into a per-card DataError
 * instead of degrading the whole deck to an "internal error" D000. The
 * checker cuts (and E003s) the same shapes at the same depth, so any value
 * this budget rejects was already squiggled. Module-level counter is safe:
 * evaluation is synchronous and the finally rebalances on every unwind. */
const MAX_EVAL_DEPTH = 500;
let evalDepth = 0;

/**
 * Evaluate one expression. `axisUnits` is the unit count of the axis of the
 * enclosing geometry property (x/width/size → X, y/height → Y) so `full` and
 * `half` can resolve; null in non-geometry positions, where the checker has
 * already ruled the keywords out (E007).
 */
export function evalExpr(expr: Expr, ctx: EvalContext, axisUnits: number | null): Value {
  if (evalDepth >= MAX_EVAL_DEPTH) {
    throw new DataError([
      { code: "D000", message: "Expression is too deeply nested to evaluate" },
    ]);
  }
  evalDepth++;
  try {
    return evalExprInner(expr, ctx, axisUnits);
  } finally {
    evalDepth--;
  }
}

function evalExprInner(expr: Expr, ctx: EvalContext, axisUnits: number | null): Value {
  switch (expr.kind) {
    case "Error":
      return poisoned(); // E001 already covered it
    case "Number":
      return num(expr.value);
    case "Color":
      return { kind: "color", value: expr.value }; // #hex passes through as written
    case "String": {
      // Interpolation (§3.5): text parts verbatim, [ref] parts coerced.
      let out = "";
      for (const part of expr.parts) {
        if (part.kind === "text") out += part.value;
        else out += toText(resolveName(part.name, part, ctx));
      }
      return text(out);
    }
    case "Ref":
      return resolveName(expr.name, expr, ctx);
    case "Identifier":
      return resolveIdentifier(expr, ctx, axisUnits);
    case "Qualified": {
      const res = ctx.card.resolutions.get(expr);
      if (res?.kind !== "enumCase") return poisoned();
      return { kind: "enumCase", enumName: res.enumName, caseName: res.caseName };
    }
    case "Unary": {
      const v = evalExpr(expr.operand, ctx, axisUnits);
      if (expr.op === "not") {
        if (v.kind !== "bool") return poisoned();
        return bool(!v.value);
      }
      if (v.kind !== "number") return poisoned();
      return num(-v.value); // negation of finite is finite — no D008 check needed
    }
    case "Binary":
      return evalBinary(expr, ctx, axisUnits);
    case "If": {
      const cond = evalExpr(expr.condition, ctx, axisUnits);
      if (cond.kind !== "bool") return poisoned();
      // Only the taken branch evaluates (documented decision): the untaken
      // branch must not be able to spray D003/D008 — `if [n] == 0 then 0
      // else 10 / [n]` is the supported guard idiom.
      return evalExpr(cond.value ? expr.thenBranch : expr.elseBranch, ctx, axisUnits);
    }
  }
}

function evalBinary(
  expr: Extract<Expr, { kind: "Binary" }>,
  ctx: EvalContext,
  axisUnits: number | null,
): Value {
  const { op } = expr;
  switch (op) {
    case "and":
    case "or": {
      // Short-circuit (documented decision): `[n] != 0 and 10 / [n] > 1`
      // must be able to guard against D008.
      const left = evalExpr(expr.left, ctx, axisUnits);
      if (left.kind !== "bool") return poisoned();
      if (op === "and" ? !left.value : left.value) return left;
      const right = evalExpr(expr.right, ctx, axisUnits);
      if (right.kind !== "bool") return poisoned();
      return right;
    }
    case "==":
    case "!=": {
      const eq = valuesEqual(
        evalExpr(expr.left, ctx, axisUnits),
        evalExpr(expr.right, ctx, axisUnits),
      );
      return bool(op === "==" ? eq : !eq);
    }
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const l = numOperand(expr.left, ctx, axisUnits);
      const r = numOperand(expr.right, ctx, axisUnits);
      switch (op) {
        case "<":
          return bool(l < r);
        case "<=":
          return bool(l <= r);
        case ">":
          return bool(l > r);
        default:
          return bool(l >= r);
      }
    }
    default: {
      // + - * / % — JS float semantics, `%` is the JS remainder (§3.5). Any
      // non-finite intermediate or final result is D008 (§3.8): NaN and
      // ±Infinity are checked HERE, at every arithmetic node, so a poisoned
      // number can never flow onward.
      const l = numOperand(expr.left, ctx, axisUnits);
      const r = numOperand(expr.right, ctx, axisUnits);
      const result =
        op === "+" ? l + r : op === "-" ? l - r : op === "*" ? l * r : op === "/" ? l / r : l % r;
      if (!Number.isFinite(result)) {
        throw new DataError([
          {
            code: "D008",
            message: `'${l} ${op} ${r}' does not produce a finite number — division by zero or overflow`,
          },
        ]);
      }
      return num(result);
    }
  }
}

/** Strict equality (§3.5): both sides share a kind — Number, Text, or the
 * same Enum (the checker guarantees this; anything else is poisoned). */
function valuesEqual(l: Value, r: Value): boolean {
  if (l.kind === "number" && r.kind === "number") return l.value === r.value;
  if (l.kind === "text" && r.kind === "text") return l.value === r.value;
  if (l.kind === "enumCase" && r.kind === "enumCase") {
    return l.enumName === r.enumName && l.caseName === r.caseName;
  }
  return poisoned(); // Bool/Color comparisons are E003 at compile time
}

function numOperand(expr: Expr, ctx: EvalContext, axisUnits: number | null): number {
  const v = evalExpr(expr, ctx, axisUnits);
  if (v.kind !== "number") return poisoned();
  return v.value;
}

/** Coercion in Text positions (§3.5 ◆†): Number → trailing-zeros-trimmed
 * (JS number formatting never prints trailing zeros), Enum → its case name.
 * Bool/Color in a Text position is E003 — poisoned here. */
function toText(v: Value): string {
  switch (v.kind) {
    case "number":
      return String(v.value);
    case "text":
      return v.value;
    case "enumCase":
      return v.caseName;
    default:
      return poisoned();
  }
}

// ---------------------------------------------------------------------------
// Name resolution — consuming the checker's per-Card bindings (§3.6)
// ---------------------------------------------------------------------------

/** `[name]` in expression or interpolation position: the checker already
 * resolved it (repeat var → loop var → column); we only follow its answer. */
function resolveName(name: string, node: ResolvableNode, ctx: EvalContext): Value {
  const res = ctx.card.resolutions.get(node);
  if (!res) return poisoned();
  switch (res.kind) {
    case "repeatVar": {
      // Innermost-first by name (§3.6) — shadowing already warned (W001).
      for (let i = ctx.repeatStack.length - 1; i >= 0; i--) {
        if (ctx.repeatStack[i].name === name) return num(ctx.repeatStack[i].value);
      }
      return poisoned();
    }
    case "loopVar": {
      const lv = ctx.loopValues.get(name);
      if (!lv) return poisoned(); // unresolved loop enum — E002 owns it
      return { kind: "enumCase", enumName: lv.enum, caseName: lv.case };
    }
    case "column":
      return readCell(res, ctx);
    default:
      return poisoned();
  }
}

/** Read one cell of the current row under its column type (◆19, §3.8). */
function readCell(res: Extract<Resolution, { kind: "column" }>, ctx: EvalContext): Value {
  const issue = ctx.cellIssue(res.column);
  if (issue) throw new DataError([issue]); // reuse the D001/D002 — never duplicate
  const raw = ctx.rawCell(res.column);
  switch (res.type.kind) {
    case "Text":
      return text(raw); // verbatim; empty Text cell → "" (◆19)
    case "Number": {
      const trimmed = raw.trim();
      if (trimmed === "") throw new DataError([ctx.emptyCellIssue(res.column, "Number")]);
      const n = parseNumberCell(trimmed);
      if (n === null) return poisoned(); // unreachable: validation flagged it (D002)
      return num(n);
    }
    case "Enum": {
      const trimmed = raw.trim();
      if (trimmed === "") throw new DataError([ctx.emptyCellIssue(res.column, "Enum")]);
      // Exact case-sensitive match guaranteed by validation (D001 otherwise).
      return { kind: "enumCase", enumName: res.type.enumName, caseName: trimmed };
    }
    default:
      return poisoned(); // Unknown column type — E002 owns it
  }
}

/** Bare identifier: the checker's resolution says what it IS; we only
 * produce the value. Geometry `full`/`half` need the axis; `middle` and
 * `anchor` keywords are handled at the property level, never here. */
function resolveIdentifier(
  expr: Extract<Expr, { kind: "Identifier" }>,
  ctx: EvalContext,
  axisUnits: number | null,
): Value {
  const res = ctx.card.resolutions.get(expr);
  if (!res) return poisoned();
  switch (res.kind) {
    case "colorName":
      return { kind: "color", value: res.name }; // already lower-cased by the checker
    case "enumCase":
      return { kind: "enumCase", enumName: res.enumName, caseName: res.caseName };
    case "geometry": {
      if (axisUnits === null || res.keyword === "middle") return poisoned();
      return num(res.keyword === "full" ? axisUnits : axisUnits / 2);
    }
    default:
      return poisoned();
  }
}

// ---------------------------------------------------------------------------
// Faces, elements, Repeat (§3.3, §3.7)
// ---------------------------------------------------------------------------

/** Evaluate one face template into resolved shapes, in declaration order
 * (z-order ◆15). Throws DataError on any data problem — the caller turns
 * the whole instance into a placeholder (⚑8). */
export function evalFace(template: TemplateDecl, ctx: EvalContext): Shape[] {
  const shapes: Shape[] = [];
  for (const node of template.children) emitNode(node, ctx, shapes);
  return shapes;
}

function emitNode(node: TemplateNode, ctx: EvalContext, out: Shape[]): void {
  if (node.kind === "Repeat") emitRepeat(node, ctx, out);
  else out.push(evalElement(node, ctx));
}

function emitRepeat(node: RepeatNode, ctx: EvalContext, out: Shape[]): void {
  const v = evalExpr(node.count, ctx, null);
  if (v.kind !== "number") return poisoned();
  const n = v.value;
  if (!Number.isInteger(n) || n < 0) {
    throw new DataError([
      { code: "D004", message: `Repeat count must be a whole number ≥ 0, got ${n}` },
    ]);
  }
  for (let i = 0; i < n; i++) {
    if (--ctx.budget.remaining < 0) {
      throw new DataError([
        {
          code: "D004",
          message: `Repeat expansion cap exceeded — a card may draw at most ${REPEAT_CAP} repeated elements (◆27)`,
        },
      ]);
    }
    if (node.variable) ctx.repeatStack.push({ name: node.variable.name, value: i });
    try {
      for (const child of node.children) emitNode(child, ctx, out);
    } finally {
      if (node.variable) ctx.repeatStack.pop();
    }
  }
}

function evalElement(el: ElementNode, ctx: EvalContext): Shape {
  switch (el.element) {
    case "Rectangle":
      return {
        kind: "rect",
        x: numberProp(el, "x", ctx, ctx.xUnits),
        y: numberProp(el, "y", ctx, ctx.yUnits),
        width: numberProp(el, "width", ctx, ctx.xUnits),
        height: numberProp(el, "height", ctx, ctx.yUnits),
        color: colorProp(el, ctx, null), // required (§3.3) — no default
        anchor: anchorOf(el, ctx),
      };
    case "Text": {
      const { x, anchor } = xAndAnchor(el, ctx);
      return {
        kind: "text",
        x,
        y: numberProp(el, "y", ctx, ctx.yUnits),
        // Documented decision: `size` resolves full/half on the X axis.
        size: numberProp(el, "size", ctx, ctx.xUnits),
        color: colorProp(el, ctx, "black"), // default black (§3.3)
        // §3.3 (M3): Text stays single-line (◆24) — newline characters in
        // the resolved text (escapes or cell data) render as SPACES; hard
        // breaks belong to TextBox. Resolved here so the model, the hash,
        // and every renderer agree on the visible text.
        text: toText(evalExpr(requireProp(el, "text"), ctx, null)).replace(/\n/g, " "),
        anchor,
        font: fontOf(el, ctx),
      };
    }
    case "TextBox": {
      // §3.3 (M3, §7.2): THE COMPILER IS THE WRAPPING AUTHORITY — the box
      // wraps here, against the CHOSEN FONT'S generated metrics (◆41:
      // metricsForFace routes geist to geist-metrics.ts and every other
      // face to its own table in font-metrics.ts — a Courier box must wrap
      // against Courier's advances, not Geist's), and the shape carries the
      // resolved lines + the FINAL size, so preview and PDF agree by
      // construction. Size resolves full/half on the X axis like Text;
      // width on X, height on Y like Rectangle.
      const width = numberProp(el, "width", ctx, ctx.xUnits);
      const height = numberProp(el, "height", ctx, ctx.yUnits);
      const size = numberProp(el, "size", ctx, ctx.xUnits);
      const lineHeight = lineHeightOf(el);
      const font = fontOf(el, ctx);
      const layout = layoutTextBox({
        text: toText(evalExpr(requireProp(el, "text"), ctx, null)),
        width,
        height,
        size,
        lineHeight,
        overflow: overflowOf(el, ctx),
        metrics: metricsForFace(font),
      });
      return {
        kind: "textbox",
        x: numberProp(el, "x", ctx, ctx.xUnits),
        y: numberProp(el, "y", ctx, ctx.yUnits),
        width,
        height,
        size: layout.size,
        color: colorProp(el, ctx, "black"),
        align: alignOf(el, ctx),
        anchor: anchorOf(el, ctx), // §3.4: moves the box; align lays lines in it
        lineHeight,
        lines: layout.lines,
        clipped: layout.clipped,
        shrunk: layout.shrunk,
        font,
      };
    }
    case "Icon": {
      const { x, anchor } = xAndAnchor(el, ctx);
      const codeExpr = requireProp(el, "code");
      const code = toText(evalExpr(codeExpr, ctx, null));
      // D005 (§3.8 †): computed code not in the curated list — collect the
      // diagnostic but STILL emit the icon (the failed ligature is its own
      // visible indicator). Literal codes were W004-checked at compile time,
      // so they are exempt here (no double-flagging); each code is reported
      // once per combination, however many Repeat iterations draw it.
      if (!DICIER_CODES.has(code) && !ctx.iconIssues.has(code) && literalText(codeExpr) === null) {
        ctx.iconIssues.set(code, {
          code: "D005",
          message: `Icon code "${code}" is not in the known Dicier list — the glyph may not exist`,
        });
      }
      return {
        kind: "icon",
        x,
        y: numberProp(el, "y", ctx, ctx.yUnits),
        size: numberProp(el, "size", ctx, ctx.xUnits),
        color: colorProp(el, ctx, "black"),
        code,
        anchor,
        style: styleOf(el, ctx),
      };
    }
    case "Image":
      // §3.3 (M2): src resolves like text (Text coercions apply); fit is
      // materialized to its default like style — the shape (and therefore
      // the contentHash) always carries concrete values. Whether the URL
      // loads is the RENDERER's state, never the model's (no D-code).
      return {
        kind: "image",
        x: numberProp(el, "x", ctx, ctx.xUnits),
        y: numberProp(el, "y", ctx, ctx.yUnits),
        width: imageDimProp(el, "width", ctx, ctx.xUnits),
        height: imageDimProp(el, "height", ctx, ctx.yUnits),
        src: toText(evalExpr(requireProp(el, "src"), ctx, null)),
        fit: fitOf(el, ctx),
        anchor: anchorOf(el, ctx), // §3.4: applied to the RESOLVED box at render time
      };
    case "Qr": {
      // §7.1a: data resolves like text (Text coercions apply, same as
      // Image's src); level materializes to its default like fit/style.
      // Encoding happens HERE, at eval time (pure, deterministic — the
      // wrap.ts precedent): the shape carries the resolved module matrix,
      // never the source data, so the renderer only draws.
      const data = toText(evalExpr(requireProp(el, "data"), ctx, null));
      const level = qrLevelOf(el, ctx);
      const encoded = encodeQr(data, level);
      if (!encoded) {
        throw new DataError([
          { code: "D009", message: "QR data is too long for one code" },
        ]);
      }
      return {
        kind: "qr",
        // §7.1a: a square box — size resolves full/half on the X axis, the
        // same documented convention as Icon's size and TextBox's size.
        x: numberProp(el, "x", ctx, ctx.xUnits),
        y: numberProp(el, "y", ctx, ctx.yUnits),
        size: numberProp(el, "size", ctx, ctx.xUnits),
        color: colorProp(el, ctx, "black"),
        background: backgroundProp(el, ctx),
        anchor: anchorOf(el, ctx),
        moduleCount: encoded.moduleCount,
        modules: encoded.modules,
      };
    }
  }
}

/** Image `width:`/`height:` (§3.3 auto dimension): a checker-blessed bare
 * `auto` flows through AS the keyword — intrinsic size is load-time
 * knowledge, so the renderer/exporter resolve it, never the model. A bare
 * `auto` WITHOUT the blessing (both dimensions auto — E008 already reported)
 * falls through to evalExpr, whose missing resolution poisons the instance
 * into a D000 placeholder. Everything else is ordinary per-axis geometry. */
function imageDimProp(
  el: ElementNode,
  key: "width" | "height",
  ctx: EvalContext,
  axisUnits: number,
): number | "auto" {
  const expr = requireProp(el, key);
  if (expr.kind === "Identifier") {
    const res = ctx.card.resolutions.get(expr);
    if (res?.kind === "autoDim") return "auto";
  }
  const v = evalExpr(expr, ctx, axisUnits);
  if (v.kind !== "number") return poisoned();
  return v.value;
}

/** First property with this key (the checker E005s duplicates and checked
 * only the first — same one we take), or null. */
function findProp(el: ElementNode, key: string): Expr | null {
  for (const prop of el.properties) {
    if (prop.key.name === key) return prop.value;
  }
  return null;
}

/** A required property that is missing was E008'd — poisoned path. */
function requireProp(el: ElementNode, key: string): Expr {
  return findProp(el, key) ?? poisoned();
}

function numberProp(el: ElementNode, key: string, ctx: EvalContext, axisUnits: number): number {
  const v = evalExpr(requireProp(el, key), ctx, axisUnits);
  if (v.kind !== "number") return poisoned();
  return v.value;
}

function colorProp(el: ElementNode, ctx: EvalContext, fallback: string | null): string {
  const expr = findProp(el, "color");
  if (!expr) return fallback ?? poisoned();
  const v = evalExpr(expr, ctx, null);
  if (v.kind !== "color") return poisoned();
  return v.value;
}

/** Qr `background:` (§7.1a): the same Color-property shape as colorProp, on
 * its own key so the two never collide — default white. */
function backgroundProp(el: ElementNode, ctx: EvalContext): string {
  const expr = findProp(el, "background");
  if (!expr) return "white";
  const v = evalExpr(expr, ctx, null);
  if (v.kind !== "color") return poisoned();
  return v.value;
}

/** Text/Icon `x` + anchor (§3.4): `x: middle` (whole-value, checker-blessed)
 * → x = xUnits/2 AND a centered HORIZONTAL anchor component — an explicit
 * `anchor:` beside it keeps only its vertical say (§3.4: the sugar forces
 * the horizontal component to center; honoring a stray horizontal word
 * would silently un-center the element). Otherwise x evaluates on the X
 * axis and the full anchor comes from the property (default top-left). */
function xAndAnchor(el: ElementNode, ctx: EvalContext): { x: number; anchor: Anchor } {
  const expr = requireProp(el, "x");
  if (expr.kind === "Identifier") {
    const res = ctx.card.resolutions.get(expr);
    if (res?.kind === "geometry" && res.keyword === "middle") {
      return { x: ctx.xUnits / 2, anchor: { h: "center", v: anchorOf(el, ctx).v } };
    }
  }
  const v = evalExpr(expr, ctx, ctx.xUnits);
  if (v.kind !== "number") return poisoned();
  return { x: v.value, anchor: anchorOf(el, ctx) };
}

/** Nine-point `anchor:` (§3.4, M3), on every drawable element: checker-
 * blessed identifier or the top-left default. The checker already NORMALIZED
 * the token (either word order, `center`, and the legacy aliases collapse to
 * one {h, v}), so explicit-default ≡ omitted and alias ≡ canonical by
 * construction — the shape, and therefore the contentHash, can't tell the
 * spellings apart. Offsets are NOT baked into x/y here: an Image `auto`
 * dimension resolves only at load time, so the RENDERER applies every
 * anchor's offset (consistency across kinds beats a micro-optimization). */
function anchorOf(el: ElementNode, ctx: EvalContext): Anchor {
  const expr = findProp(el, "anchor");
  if (!expr) return DEFAULT_ANCHOR; // top-left (§3.4)
  if (expr.kind !== "Identifier") return poisoned();
  const res = ctx.card.resolutions.get(expr);
  if (res?.kind !== "anchor") return poisoned();
  return res.anchor;
}

/** Icon `style:` (§3.3, M2): checker-blessed identifier or the flat_dark
 * default — the same follow-the-resolution shape as anchorOf. */
function styleOf(el: ElementNode, ctx: EvalContext): IconStyle {
  const expr = findProp(el, "style");
  if (!expr) return DEFAULT_ICON_STYLE;
  if (expr.kind !== "Identifier") return poisoned();
  const res = ctx.card.resolutions.get(expr);
  if (res?.kind !== "iconStyle") return poisoned();
  return res.style;
}

/** Text/TextBox `font:` (§3.3, M3 — ◆41): checker-blessed identifier or the
 * geist default — the same follow-the-resolution shape as styleOf. */
function fontOf(el: ElementNode, ctx: EvalContext): FontFace {
  const expr = findProp(el, "font");
  if (!expr) return DEFAULT_FONT;
  if (expr.kind !== "Identifier") return poisoned();
  const res = ctx.card.resolutions.get(expr);
  if (res?.kind !== "font") return poisoned();
  return res.face;
}

/** TextBox `align:` (§3.3, M3): checker-blessed identifier or the left
 * default — the same follow-the-resolution shape as anchorOf, reading the
 * distinct `align` resolution kind (a box aligns within its width). */
function alignOf(el: ElementNode, ctx: EvalContext): TextAnchor {
  const expr = findProp(el, "align");
  if (!expr) return "left"; // default (§3.3)
  if (expr.kind !== "Identifier") return poisoned();
  const res = ctx.card.resolutions.get(expr);
  if (res?.kind !== "align") return poisoned();
  return res.keyword;
}

/** TextBox `overflow:` (§3.3, M3): checker-blessed identifier or the clip
 * default — the same follow-the-resolution shape as fitOf. */
function overflowOf(el: ElementNode, ctx: EvalContext): TextBoxOverflow {
  const expr = findProp(el, "overflow");
  if (!expr) return DEFAULT_TEXTBOX_OVERFLOW;
  if (expr.kind !== "Identifier") return poisoned();
  const res = ctx.card.resolutions.get(expr);
  if (res?.kind !== "overflow") return poisoned();
  return res.value;
}

/** TextBox `line_height:` (§3.3, M3): the checker accepts exactly a positive
 * number LITERAL (E008 otherwise), so the evaluator reads the same literal
 * shape directly — no resolution entry needed, and any other shape here is
 * a compile-poisoned context. Default 1.3 × size. */
function lineHeightOf(el: ElementNode): number {
  const expr = findProp(el, "line_height");
  if (!expr) return DEFAULT_LINE_HEIGHT;
  if (expr.kind !== "Number" || expr.value <= 0) return poisoned();
  return expr.value;
}

/** Image `fit:` (§3.3, M2): checker-blessed identifier or the contain
 * default — the same follow-the-resolution shape as styleOf. */
function fitOf(el: ElementNode, ctx: EvalContext): ImageFit {
  const expr = findProp(el, "fit");
  if (!expr) return DEFAULT_IMAGE_FIT;
  if (expr.kind !== "Identifier") return poisoned();
  const res = ctx.card.resolutions.get(expr);
  if (res?.kind !== "imageFit") return poisoned();
  return res.fit;
}

/** Qr `level:` (§7.1a): checker-blessed identifier or the medium default —
 * the same follow-the-resolution shape as fitOf/styleOf. */
function qrLevelOf(el: ElementNode, ctx: EvalContext): QrLevel {
  const expr = findProp(el, "level");
  if (!expr) return DEFAULT_QR_LEVEL;
  if (expr.kind !== "Identifier") return poisoned();
  const res = ctx.card.resolutions.get(expr);
  if (res?.kind !== "qrLevel") return poisoned();
  return res.level;
}

/** The literal value of a string with NO interpolation parts, else null. */
function literalText(expr: Expr): string | null {
  if (expr.kind !== "String") return null;
  let out = "";
  for (const part of (expr as StringLit).parts) {
    if (part.kind !== "text") return null;
    out += part.value;
  }
  return out;
}
