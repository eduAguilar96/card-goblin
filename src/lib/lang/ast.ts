/**
 * AST for Goblin script (DESIGN.md §3.1–§3.5).
 *
 * Every node carries its source `range` (0-based, end-exclusive — see
 * diagnostics.ts). The parser is purely syntactic: bare identifiers stay
 * `Identifier` nodes, `Suit.Rock` stays a `Qualified` node, and property
 * keys/values are recorded as written — name resolution, typing, and
 * required-property checks are the checker's job (task 2).
 */

import type { Range } from "./diagnostics";

/** A spanned identifier occurrence (declaration or reference position). */
export interface NameRef {
  name: string;
  range: Range;
}

// ---------------------------------------------------------------------------
// Program structure (§3.2)
// ---------------------------------------------------------------------------

export interface Program {
  kind: "Program";
  declarations: Declaration[];
  range: Range;
}

export type Declaration = EnumDecl | SheetDecl | TemplateDecl | CardDecl | LetNode;

export interface EnumDecl {
  kind: "EnumDecl";
  name: NameRef;
  cases: EnumCase[];
  range: Range;
}

export interface EnumCase {
  kind: "EnumCase";
  name: NameRef;
  range: Range;
}

export interface SheetDecl {
  kind: "SheetDecl";
  name: NameRef;
  /** Zero columns is legal (⚑13†, loop-only decks). */
  columns: ColumnDecl[];
  /** Computed, export-only columns (◆48); never materialized in sheet rows. */
  virtualColumns: VirtualColumnDecl[];
  range: Range;
}

export interface ColumnDecl {
  kind: "ColumnDecl";
  name: NameRef;
  /** `Text`, `Number`, or an enum name — resolved in task 2. */
  columnType: NameRef;
  range: Range;
}

/** `virtual column name: Type = expression` inside a Sheet (◆48). */
export interface VirtualColumnDecl {
  kind: "VirtualColumnDecl";
  name: NameRef;
  /** `Text`, `Number`, or an enum name — resolved by the checker. */
  columnType: NameRef;
  initializer: Expr;
  range: Range;
}

export interface TemplateDecl {
  kind: "TemplateDecl";
  name: NameRef;
  /** Hoisted, typed, immutable inputs supplied explicitly by each invocation. */
  params: TemplateParamDecl[];
  children: TemplateNode[];
  range: Range;
}

/** `param name: Type` directly inside a Template declaration. */
export interface TemplateParamDecl {
  kind: "TemplateParam";
  name: NameRef;
  /** `Text`, `Number`, `Bool`, `Color`, or an enum name. */
  paramType: NameRef;
  range: Range;
}

export interface CardDecl {
  kind: "CardDecl";
  name: NameRef;
  /** Properties and Front:/Back: faces, in declaration order (order preserved for task 2). */
  items: CardItem[];
  range: Range;
}

export type CardItem = PropertyNode | FaceNode;

/** `Front: MonsterFront` / `Back: PlainBack` — template name inline (§3.2). */
export interface FaceNode {
  kind: "Face";
  face: "Front" | "Back";
  /** null when the name was missing/malformed (E001 already emitted). */
  template: NameRef | null;
  /** Explicit caller-scoped values for the selected Template's parameters. */
  arguments: TemplateArgumentNode[];
  range: Range;
}

// ---------------------------------------------------------------------------
// Template contents (§3.3)
// ---------------------------------------------------------------------------

export type TemplateNode =
  | ElementNode
  | RepeatNode
  | LetNode
  | IfNode
  | TemplateCallNode;

/** `let name: <expr>` at program or template-node scope. */
export interface LetNode {
  kind: "Let";
  name: NameRef;
  initializer: Expr;
  range: Range;
}

/** Structural `If: <expr>` with an optional paired `Else:` sibling. */
export interface IfNode {
  kind: "IfBlock";
  condition: Expr;
  thenChildren: TemplateNode[];
  elseBranch: ElseNode | null;
  range: Range;
}

/** The paired `Else:` portion of an {@link IfNode}. */
export interface ElseNode {
  kind: "ElseBlock";
  children: TemplateNode[];
  range: Range;
}

/** `<identifier>:` in template-node position invokes that Template. */
export interface TemplateCallNode {
  kind: "TemplateCall";
  template: NameRef;
  /** Explicit caller-scoped values for the selected Template's parameters. */
  arguments: TemplateArgumentNode[];
  range: Range;
}

/** `name: expression` nested beneath a Front/Back or Template call. */
export interface TemplateArgumentNode {
  kind: "TemplateArgument";
  name: NameRef;
  value: Expr;
  range: Range;
}

export type ElementKind = "Rectangle" | "Text" | "TextBox" | "Icon" | "Image" | "Qr";

export interface ElementNode {
  kind: "Element";
  element: ElementKind;
  /** Optional quoted display label (`Rectangle: "Banner"`) — purely descriptive (⚑11). */
  label: StringLit | null;
  properties: PropertyNode[];
  range: Range;
}

/** `Repeat: <expr> as <var>` — header is single-line (◆23†); children may nest. */
export interface RepeatNode {
  kind: "Repeat";
  count: Expr;
  /** null when `as <var>` was missing/malformed (E001 already emitted). */
  variable: NameRef | null;
  children: TemplateNode[];
  range: Range;
}

/**
 * `key: <expr>` — any lowercase key with any expression value (◆30; validation
 * is task 2's E008). `asVar` captures the `as <var>` clause of `loop:` lines;
 * the parser accepts it on any property and task 2 rejects misuse.
 * `range` spans key through end of value (incl. multi-line continuations, ◆23†).
 */
export interface PropertyNode {
  kind: "Property";
  key: NameRef;
  value: Expr;
  asVar: NameRef | null;
  range: Range;
}

// ---------------------------------------------------------------------------
// Expressions (§3.5)
// ---------------------------------------------------------------------------

export type Expr =
  | IfExpr
  | BinaryExpr
  | UnaryExpr
  | NumberLit
  | StringLit
  | ColorLit
  | DataRef
  | IdentifierExpr
  | QualifiedName
  | ErrorExpr;

/** `if c then a else b`; `else` is mandatory (§3.5) — a missing one is an E001 + ErrorExpr branch. */
export interface IfExpr {
  kind: "If";
  condition: Expr;
  thenBranch: Expr;
  elseBranch: Expr;
  range: Range;
}

export type BinaryOp =
  | "or"
  | "and"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "+"
  | "-"
  | "*"
  | "/"
  | "%";

export interface BinaryExpr {
  kind: "Binary";
  op: BinaryOp;
  left: Expr;
  right: Expr;
  range: Range;
}

export interface UnaryExpr {
  kind: "Unary";
  op: "not" | "-";
  operand: Expr;
  range: Range;
}

export interface NumberLit {
  kind: "Number";
  value: number;
  /** Source text, e.g. "1.5". */
  text: string;
  range: Range;
}

/** Double-quoted, single-line, lexed into text/ref parts (§3.5 interpolation). */
export interface StringLit {
  kind: "String";
  parts: StringPart[];
  range: Range;
}

export type StringPart = StringTextPart | StringRefPart;

export interface StringTextPart {
  kind: "text";
  value: string;
  range: Range;
}

export interface StringRefPart {
  kind: "ref";
  name: string;
  range: Range;
}

/** `#RRGGBB` literal; `value` preserves source text (e.g. "#A1b2C3"). */
export interface ColorLit {
  kind: "Color";
  value: string;
  range: Range;
}

/** `[name]` — always a data reference (◆30). */
export interface DataRef {
  kind: "Ref";
  name: string;
  range: Range;
}

/**
 * Bare identifier in expression position — geometry keyword, CSS color name,
 * enum case, template name, size preset… resolution by expected type is task 2
 * (◆14†, ◆21†, ◆30†).
 */
export interface IdentifierExpr {
  kind: "Identifier";
  name: string;
  range: Range;
}

/** `Enum.Case` qualification (◆14). Exactly one level; deeper chains are E001. */
export interface QualifiedName {
  kind: "Qualified";
  qualifier: NameRef;
  member: NameRef;
  range: Range;
}

/** Placeholder where an expression failed to parse (E001 already emitted) — keeps siblings alive (⚑8). */
export interface ErrorExpr {
  kind: "Error";
  range: Range;
}
