/**
 * Parser for Goblin script (DESIGN.md §3.1–§3.5, §4.1).
 *
 * Hand-written recursive descent for blocks; precedence-climbing (Pratt-style)
 * for expressions (§3.5). Implements the two Revision-A grammar rules:
 *
 * - Contextual keywords (◆30†): block openers (Enum, Sheet, Template, Card,
 *   Rectangle, Text, Icon, Repeat, Front, Back) are only special in HEADER
 *   position — start of a line, followed by ':'. Everywhere else they are
 *   ordinary identifiers, so `column count: Number`, `[count]`, `x: full`,
 *   `anchor: right` all parse. Reserved words are however ILLEGAL as DECLARED
 *   names (§3.1): declaration names, column names, enum cases, and loop/repeat
 *   variables reject block-opener words with E001 (the declaration words and
 *   expression words already lex as keywords). Value positions still accept
 *   them — that is how `column name: Text` names the `Text` type.
 *
 * - Property-line continuation (◆23†): only a property line (lowercase key +
 *   ':') continues — its expression extends across following lines while they
 *   are indented strictly deeper than the key. Block headers never continue
 *   (their deeper lines are children); `Repeat:` headers are single-line.
 *
 * Error tolerance (⚑8/§4.1): a parse NEVER throws. Every syntax problem is an
 * E001 with a precise range, and the parser recovers at the next line at the
 * same-or-shallower indent, so all errors in a document are reported and valid
 * siblings still produce AST nodes.
 */

import type {
  CardDecl,
  CardItem,
  Declaration,
  ElementKind,
  ElementNode,
  EnumCase,
  Expr,
  FaceNode,
  NameRef,
  Program,
  PropertyNode,
  RepeatNode,
  SheetDecl,
  TemplateNode,
} from "./ast";
import type { Diagnostic, Range } from "./diagnostics";
import { spanRanges, syntaxError } from "./diagnostics";
import type { Token } from "./lexer";
import { lex } from "./lexer";

export interface ParseResult {
  program: Program;
  diagnostics: Diagnostic[];
}

/** Block-opener words — contextual: reserved only in header position (◆30†).
 * Exported so the wiki's reserved-word list can be tested against it
 * (`src/lib/docs/__tests__/docFacts.test.ts`). */
export const BLOCK_OPENERS: ReadonlySet<string> = new Set([
  "Enum",
  "Sheet",
  "Template",
  "Card",
  "Rectangle",
  "Text",
  "Icon",
  "Repeat",
  "Front",
  "Back",
]);

const COMPARISON_OPS = ["==", "!=", "<", "<=", ">", ">="] as const;
type ComparisonOp = (typeof COMPARISON_OPS)[number];

const isComparisonOp = (op: string): op is ComparisonOp =>
  (COMPARISON_OPS as readonly string[]).includes(op);

/** Lex + parse a Goblin script source. Never throws. */
export function parse(source: string): ParseResult {
  const { tokens, diagnostics } = lex(source);
  const parser = new Parser(tokens, diagnostics);
  const program = parser.parseProgram();
  // Lexer and parser diagnostics interleave; present them in source order.
  diagnostics.sort(
    (a, b) =>
      a.range.startLine - b.range.startLine ||
      a.range.startCol - b.range.startCol ||
      a.range.endLine - b.range.endLine ||
      a.range.endCol - b.range.endCol,
  );
  return { program, diagnostics };
}

/**
 * Expression-parsing context: whether the current value position may continue
 * onto deeper-indented lines (◆23†), and how many INDENT levels the
 * continuation has consumed so far.
 */
interface ExprContext {
  multiline: boolean;
  contDepth: number;
}

/**
 * A lookahead across possible line continuations. When `found`, `token` is the
 * next meaningful token (`index` its position, `depth` the continuation depth
 * after crossing to it); when not found, the expression must end here and
 * `token` is the layout token (newline/eof) at the current position.
 */
interface Lookahead {
  found: boolean;
  token: Token;
  index: number;
  depth: number;
}

class Parser {
  private pos = 0;
  private exprCtx: ExprContext | null = null;
  private exprHadError = false;
  private exprNesting = 0;
  private blockDepth = 0;
  /** Range of the last consumed non-layout token — used to close node spans. */
  private lastRange: Range;

  constructor(
    private readonly tokens: Token[],
    private readonly diagnostics: Diagnostic[],
  ) {
    this.lastRange = tokens[0]?.range ?? {
      startLine: 0,
      startCol: 0,
      endLine: 0,
      endCol: 0,
    };
  }

  // -- token plumbing -------------------------------------------------------

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private peekAt(offset: number): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (t.kind !== "eof") this.pos++;
    if (
      t.kind !== "newline" &&
      t.kind !== "indent" &&
      t.kind !== "dedent" &&
      t.kind !== "eof"
    ) {
      this.lastRange = t.range;
    }
    return t;
  }

  private atOp(op: string): boolean {
    const t = this.peek();
    return t.kind === "op" && t.op === op;
  }

  private error(message: string, range: Range): void {
    this.diagnostics.push(syntaxError(message, range));
  }

  private describe(t: Token): string {
    switch (t.kind) {
      case "identifier":
        return `'${t.text}'`;
      case "keyword":
        return `'${t.word}'`;
      case "number":
        return `number ${t.text}`;
      case "string":
        return "string";
      case "color":
        return `color ${t.value}`;
      case "ref":
        return `[${t.name}]`;
      case "op":
        return `'${t.op}'`;
      case "newline":
        return "end of line";
      case "indent":
        return "indentation";
      case "dedent":
        return "end of block";
      case "eof":
        return "end of file";
    }
  }

  // -- recovery (⚑8) --------------------------------------------------------

  /**
   * Skip to the start of the next line at the same-or-shallower indent than
   * the construct that failed. `extraDepth` is the number of INDENT levels
   * already open beyond that construct (continuation lines); they are consumed
   * on the way out. DEDENTs belonging to enclosing blocks are left in place.
   */
  private sync(extraDepth: number): void {
    let depth = extraDepth;
    for (;;) {
      const t = this.peek();
      switch (t.kind) {
        case "eof":
          return;
        case "indent":
          depth++;
          this.next();
          break;
        case "dedent":
          if (depth === 0) return;
          depth--;
          this.next();
          if (depth === 0) {
            const after = this.peek().kind;
            if (after !== "indent" && after !== "dedent") return;
          }
          break;
        case "newline":
          this.next();
          if (depth === 0) {
            const after = this.peek().kind;
            if (after !== "indent" && after !== "dedent" && after !== "eof") {
              return;
            }
            if (after === "eof") return;
          }
          break;
        default:
          this.next();
          break;
      }
    }
  }

  /** Consume the rest of the current line (no diagnostic) incl. its newline. */
  private skipToEol(): void {
    while (this.peek().kind !== "newline" && this.peek().kind !== "eof") {
      this.next();
    }
    if (this.peek().kind === "newline") this.next();
  }

  /** Expect end of line; report the first stray token, then skip to next line. */
  private finishLine(): void {
    const t = this.peek();
    if (t.kind === "newline") {
      this.next();
      return;
    }
    if (t.kind === "eof") return;
    this.error(`Expected end of line, found ${this.describe(t)}`, t.range);
    this.skipToEol();
  }

  private expectIdent(message: string): NameRef | null {
    const t = this.peek();
    if (t.kind === "identifier") {
      this.next();
      return { name: t.text, range: t.range };
    }
    this.error(`${message}, found ${this.describe(t)}`, t.range);
    return null;
  }

  /**
   * Like expectIdent, but for DECLARED-name positions (declaration names,
   * column names, enum cases, loop/repeat variables): reserved words are
   * illegal there (§3.1). The declaration words and expression words already
   * lex as keywords (so expectIdent rejects them); block-opener words lex as
   * identifiers and are rejected here. The name is still returned so the
   * declaration parses and siblings/children survive (⚑8) — one E001.
   */
  private expectDeclaredName(message: string): NameRef | null {
    const name = this.expectIdent(message);
    if (name && BLOCK_OPENERS.has(name.name)) {
      this.error(
        `'${name.name}' is a reserved word and cannot be used as a declared name`,
        name.range,
      );
    }
    return name;
  }

  // -- program & declarations (§3.2) ---------------------------------------

  parseProgram(): Program {
    const declarations: Declaration[] = [];
    const first = this.peek().range;
    for (;;) {
      const t = this.peek();
      if (t.kind === "eof") break;
      if (t.kind === "newline" || t.kind === "dedent") {
        this.next(); // defensive; the lexer should not produce these here
        continue;
      }
      if (t.kind === "indent") {
        this.error("Unexpected indentation at top level", t.range);
        this.sync(0);
        continue;
      }
      if (
        t.kind === "identifier" &&
        this.peekAt(1).kind === "op" &&
        (this.peekAt(1) as Token & { kind: "op" }).op === ":" &&
        (t.text === "Enum" ||
          t.text === "Sheet" ||
          t.text === "Template" ||
          t.text === "Card")
      ) {
        const decl = this.parseDeclaration(t.text);
        if (decl) declarations.push(decl);
        continue;
      }
      this.error(
        `Expected a top-level declaration (Enum:, Sheet:, Template:, or Card:), found ${this.describe(t)}`,
        t.range,
      );
      this.sync(0);
    }
    const last = this.tokens[this.tokens.length - 1].range;
    return {
      kind: "Program",
      declarations,
      range: spanRanges(first, last),
    };
  }

  private parseDeclaration(
    word: "Enum" | "Sheet" | "Template" | "Card",
  ): Declaration | null {
    const head = this.next(); // the opener identifier
    this.next(); // ':'
    const name = this.expectDeclaredName(`Expected a name after '${word}:'`);
    if (!name) {
      this.sync(0);
      return null;
    }
    this.finishLine();
    switch (word) {
      case "Enum": {
        const cases: EnumCase[] = [];
        this.parseBlockChildren(() => this.parseEnumCase(cases));
        return {
          kind: "EnumDecl",
          name,
          cases,
          range: spanRanges(head.range, this.lastRange),
        };
      }
      case "Sheet": {
        const decl: SheetDecl = {
          kind: "SheetDecl",
          name,
          columns: [],
          range: head.range,
        };
        this.parseBlockChildren(() => this.parseColumn(decl));
        decl.range = spanRanges(head.range, this.lastRange);
        return decl;
      }
      case "Template": {
        const children: TemplateNode[] = [];
        this.parseBlockChildren(() => {
          const node = this.parseTemplateNode();
          if (node) children.push(node);
        });
        return {
          kind: "TemplateDecl",
          name,
          children,
          range: spanRanges(head.range, this.lastRange),
        };
      }
      case "Card": {
        const items: CardItem[] = [];
        this.parseBlockChildren(() => this.parseCardItem(items));
        const card: CardDecl = {
          kind: "CardDecl",
          name,
          items,
          range: spanRanges(head.range, this.lastRange),
        };
        return card;
      }
    }
  }

  /** Parse an optional INDENT…DEDENT block of children after a header line. */
  private parseBlockChildren(parseChild: () => void): void {
    if (this.peek().kind !== "indent") return; // empty block is legal (⚑13†)
    if (this.blockDepth >= 500) {
      // Depth cap so pathological nesting degrades to an E001 instead of a
      // stack overflow — a parse never throws (⚑8). sync(0) consumes the
      // whole indented subtree.
      this.error("Blocks are too deeply nested", this.peek().range);
      this.sync(0);
      return;
    }
    this.next();
    this.blockDepth++;
    try {
      for (;;) {
        const t = this.peek();
        if (t.kind === "dedent" || t.kind === "eof") break;
        if (t.kind === "indent") {
          this.error("Unexpected indentation", t.range);
          this.sync(0);
          continue;
        }
        if (t.kind === "newline") {
          this.next(); // defensive
          continue;
        }
        parseChild();
      }
    } finally {
      this.blockDepth--;
    }
    if (this.peek().kind === "dedent") this.next();
  }

  private parseEnumCase(cases: EnumCase[]): void {
    const t = this.peek();
    if (t.kind === "keyword" && t.word === "case") {
      this.next();
      const name = this.expectDeclaredName("Expected a case name after 'case'");
      if (!name) {
        this.skipToEol();
        return;
      }
      this.finishLine();
      cases.push({
        kind: "EnumCase",
        name,
        range: spanRanges(t.range, name.range),
      });
      return;
    }
    this.error(
      `Expected 'case <Name>' inside Enum, found ${this.describe(t)}`,
      t.range,
    );
    this.sync(0);
  }

  private parseColumn(sheet: SheetDecl): void {
    const t = this.peek();
    if (t.kind === "keyword" && t.word === "column") {
      this.next();
      // The column name is an ordinary identifier — `column count: Number`
      // is legal (◆30†) — but reserved words are not (§3.1): a declared
      // name cannot be `Rectangle`, `Text`, etc.
      const name = this.expectDeclaredName(
        "Expected a column name after 'column'",
      );
      if (!name) {
        this.skipToEol();
        return;
      }
      if (!this.atOp(":")) {
        const bad = this.peek();
        this.error(
          `Expected ':' after the column name, found ${this.describe(bad)}`,
          bad.range,
        );
        this.skipToEol();
        return;
      }
      this.next();
      const columnType = this.expectIdent(
        "Expected a column type (Text, Number, or an enum name)",
      );
      if (!columnType) {
        this.skipToEol();
        return;
      }
      this.finishLine();
      sheet.columns.push({
        kind: "ColumnDecl",
        name,
        columnType,
        range: spanRanges(t.range, columnType.range),
      });
      return;
    }
    this.error(
      `Expected 'column <name>: <Type>' inside Sheet, found ${this.describe(t)}`,
      t.range,
    );
    this.sync(0);
  }

  // -- template nodes (§3.3) ------------------------------------------------

  private parseTemplateNode(): TemplateNode | null {
    const t = this.peek();
    if (
      t.kind === "identifier" &&
      this.peekAt(1).kind === "op" &&
      (this.peekAt(1) as Token & { kind: "op" }).op === ":"
    ) {
      if (t.text === "Rectangle" || t.text === "Text" || t.text === "Icon") {
        return this.parseElement(t.text);
      }
      if (t.text === "Repeat") return this.parseRepeat();
      if (BLOCK_OPENERS.has(t.text)) {
        this.error(`'${t.text}:' is not allowed inside a template`, t.range);
        this.sync(0);
        return null;
      }
      if (/^[a-z]/.test(t.text)) {
        this.error(
          `Property line '${t.text}:' is only allowed inside an element (Rectangle:, Text:, Icon:)`,
          t.range,
        );
        this.sync(0);
        return null;
      }
      this.error(
        `Unknown element '${t.text}:' — expected Rectangle:, Text:, Icon:, or Repeat:`,
        t.range,
      );
      this.sync(0);
      return null;
    }
    this.error(
      `Expected an element (Rectangle:, Text:, Icon:, or Repeat:), found ${this.describe(t)}`,
      t.range,
    );
    this.sync(0);
    return null;
  }

  private parseElement(kind: ElementKind): ElementNode {
    const head = this.next(); // element word
    this.next(); // ':'
    let label: ElementNode["label"] = null;
    const labelTok = this.peek();
    if (labelTok.kind === "string") {
      this.next();
      label = { kind: "String", parts: labelTok.parts, range: labelTok.range };
    }
    this.finishLine();
    const properties: PropertyNode[] = [];
    this.parseBlockChildren(() => {
      const t = this.peek();
      if (
        t.kind === "identifier" &&
        this.peekAt(1).kind === "op" &&
        (this.peekAt(1) as Token & { kind: "op" }).op === ":"
      ) {
        if (/^[a-z]/.test(t.text)) {
          properties.push(this.parseProperty());
          return;
        }
        this.error(
          `'${t.text}:' cannot be nested inside a ${kind}: element — only 'key: value' property lines are allowed`,
          t.range,
        );
        this.sync(0);
        return;
      }
      this.error(
        `Expected a property line ('key: value') inside ${kind}:, found ${this.describe(t)}`,
        t.range,
      );
      this.sync(0);
    });
    return {
      kind: "Element",
      element: kind,
      label,
      properties,
      range: spanRanges(head.range, this.lastRange),
    };
  }

  /** `Repeat: <expr> as <var>` — header is single-line by rule (◆23†). */
  private parseRepeat(): RepeatNode {
    const head = this.next(); // 'Repeat'
    this.next(); // ':'
    this.exprCtx = { multiline: false, contDepth: 0 };
    this.exprHadError = false;
    const count = this.parseExpr();
    let variable: NameRef | null = null;
    const t = this.peek();
    if (t.kind === "keyword" && t.word === "as") {
      this.next();
      variable = this.expectDeclaredName("Expected a variable name after 'as'");
      // One mistake, one diagnostic: a bad variable token already reported —
      // don't also complain about the leftovers on this line.
      if (!variable) this.exprHadError = true;
    } else if (!this.exprHadError) {
      this.error(
        `Repeat: needs 'as <variable>' after its count expression (e.g. "Repeat: [health] as i"), found ${this.describe(t)}`,
        t.range,
      );
      this.exprHadError = true;
    }
    this.exprCtx = null;
    if (this.exprHadError) this.skipToEol();
    else this.finishLine();
    this.exprHadError = false;
    const children: TemplateNode[] = [];
    this.parseBlockChildren(() => {
      const node = this.parseTemplateNode();
      if (node) children.push(node);
    });
    return {
      kind: "Repeat",
      count,
      variable,
      children,
      range: spanRanges(head.range, this.lastRange),
    };
  }

  // -- card items (§3.2) ----------------------------------------------------

  private parseCardItem(items: CardItem[]): void {
    const t = this.peek();
    if (
      t.kind === "identifier" &&
      this.peekAt(1).kind === "op" &&
      (this.peekAt(1) as Token & { kind: "op" }).op === ":"
    ) {
      if (t.text === "Front" || t.text === "Back") {
        items.push(this.parseFace(t.text));
        return;
      }
      if (/^[a-z]/.test(t.text)) {
        items.push(this.parseProperty());
        return;
      }
      if (BLOCK_OPENERS.has(t.text)) {
        this.error(`'${t.text}:' is not allowed inside a Card`, t.range);
        this.sync(0);
        return;
      }
      this.error(
        `Unknown entry '${t.text}:' — Card blocks contain 'key: value' properties, 'Front: <Template>', and 'Back: <Template>'`,
        t.range,
      );
      this.sync(0);
      return;
    }
    this.error(
      `Expected 'key: value', 'Front: <Template>', or 'Back: <Template>' inside Card, found ${this.describe(t)}`,
      t.range,
    );
    this.sync(0);
  }

  /** `Front:`/`Back:` take a template name inline (§3.2); no children. */
  private parseFace(face: "Front" | "Back"): FaceNode {
    const head = this.next();
    this.next(); // ':'
    const template = this.expectIdent(
      `Expected a template name after '${face}:'`,
    );
    if (template) this.finishLine();
    else this.skipToEol();
    const t = this.peek();
    if (t.kind === "indent") {
      // Block headers never continue and Front:/Back: take their template
      // inline — indented content under them is always an error (◆23†, §3.2).
      // If the name was already missing, that E001 covers this too — skip the
      // block silently rather than double-report one mistake.
      if (template) {
        this.error(
          `'${face}:' takes a template name inline; indented content under it is not allowed`,
          t.range,
        );
      }
      this.sync(0);
    }
    return {
      kind: "Face",
      face,
      template,
      range: spanRanges(head.range, this.lastRange),
    };
  }

  // -- property lines with continuation (◆23†) ------------------------------

  private parseProperty(): PropertyNode {
    const keyTok = this.next() as Token & { kind: "identifier" };
    this.next(); // ':'
    const key: NameRef = { name: keyTok.text, range: keyTok.range };
    this.exprCtx = { multiline: true, contDepth: 0 };
    this.exprHadError = false;
    const value = this.parseExpr();

    // Optional `as <var>` clause — used by `loop:` (§3.2). The parser accepts
    // it on any property line; task 2 rejects it where it is meaningless.
    let asVar: NameRef | null = null;
    const asLook = this.lookahead();
    if (asLook.found && asLook.token.kind === "keyword" && asLook.token.word === "as") {
      this.take(asLook);
      const nameLook = this.lookahead();
      if (nameLook.found && nameLook.token.kind === "identifier") {
        const tok = this.take(nameLook) as Token & { kind: "identifier" };
        asVar = { name: tok.text, range: tok.range };
        if (BLOCK_OPENERS.has(tok.text)) {
          // Loop variables are declared names — reserved words illegal (§3.1).
          this.error(
            `'${tok.text}' is a reserved word and cannot be used as a declared name`,
            tok.range,
          );
        }
      } else {
        this.exprError(
          `Expected a variable name after 'as', found ${this.describe(nameLook.token)}`,
          nameLook.token.range,
        );
      }
    }

    // End of the property: anything meaningful still reachable (same line or
    // a continuation line) is stray input — one E001, then recover at the
    // next line at same-or-shallower indent (⚑8).
    const endLook = this.lookahead();
    const ctx = this.exprCtx;
    if (endLook.found) {
      if (!this.exprHadError) {
        this.error(
          `Expected end of line, found ${this.describe(endLook.token)} — indented lines after a property continue its expression`,
          endLook.token.range,
        );
      }
      this.exprCtx = null;
      this.sync(ctx.contDepth);
    } else {
      this.exprCtx = null;
      if (this.peek().kind === "newline") this.next();
      let d = ctx.contDepth;
      while (d > 0 && this.peek().kind === "dedent") {
        this.next();
        d--;
      }
    }
    this.exprHadError = false;

    const end = asVar ? asVar.range : value.range;
    return {
      kind: "Property",
      key,
      value,
      asVar,
      range: spanRanges(key.range, end),
    };
  }

  // -- expressions (§3.5) ---------------------------------------------------

  /**
   * Peek at the next meaningful token, looking across a line break when the
   * following line is a legal continuation (strictly deeper than the property
   * key, ◆23†). Never consumes.
   */
  private lookahead(): Lookahead {
    const t = this.peek();
    const depth = this.exprCtx?.contDepth ?? 0;
    if (
      t.kind !== "newline" &&
      t.kind !== "indent" &&
      t.kind !== "dedent" &&
      t.kind !== "eof"
    ) {
      return { found: true, token: t, index: this.pos, depth };
    }
    if (t.kind !== "newline" || !this.exprCtx || !this.exprCtx.multiline) {
      return { found: false, token: t, index: this.pos, depth };
    }
    let i = this.pos + 1;
    let d = depth;
    for (;;) {
      const k = this.tokens[i].kind;
      if (k === "indent") {
        d++;
        i++;
      } else if (k === "dedent") {
        d--;
        i++;
      } else {
        break;
      }
    }
    if (d >= 1 && this.tokens[i].kind !== "eof") {
      return { found: true, token: this.tokens[i], index: i, depth: d };
    }
    return { found: false, token: t, index: this.pos, depth };
  }

  /** Commit a lookahead: jump to its token and consume it. */
  private take(look: Lookahead): Token {
    this.pos = look.index;
    if (this.exprCtx) this.exprCtx.contDepth = look.depth;
    return this.next();
  }

  /** Report an expression-level E001, suppressing cascades within one value. */
  private exprError(message: string, range: Range): void {
    if (!this.exprHadError) this.error(message, range);
    this.exprHadError = true;
  }

  private parseExpr(): Expr {
    if (this.exprNesting > 500) {
      const t = this.peek();
      this.exprError("Expression is too deeply nested", t.range);
      return { kind: "Error", range: t.range };
    }
    this.exprNesting++;
    try {
      const look = this.lookahead();
      if (look.found && look.token.kind === "keyword" && look.token.word === "if") {
        const ifTok = this.take(look);
        return this.parseIfTail(ifTok.range);
      }
      return this.parseOr();
    } finally {
      this.exprNesting--;
    }
  }

  /** `if c then a else b`; chains via `else if …`; `else` is mandatory (§3.5). */
  private parseIfTail(ifRange: Range): Expr {
    const condition = this.parseOr();
    const thenLook = this.lookahead();
    if (
      !thenLook.found ||
      thenLook.token.kind !== "keyword" ||
      thenLook.token.word !== "then"
    ) {
      this.exprError(
        `Expected 'then' in if expression, found ${this.describe(thenLook.token)}`,
        thenLook.token.range,
      );
      const range = spanRanges(ifRange, condition.range);
      const err: Expr = { kind: "Error", range: thenLook.token.range };
      return { kind: "If", condition, thenBranch: err, elseBranch: err, range };
    }
    this.take(thenLook);
    const thenBranch = this.parseExpr();
    const elseLook = this.lookahead();
    if (
      elseLook.found &&
      elseLook.token.kind === "keyword" &&
      elseLook.token.word === "else"
    ) {
      this.take(elseLook);
      const elseBranch = this.parseExpr();
      return {
        kind: "If",
        condition,
        thenBranch,
        elseBranch,
        range: spanRanges(ifRange, elseBranch.range),
      };
    }
    this.exprError(
      `An if expression requires an 'else' branch (else is mandatory), found ${this.describe(elseLook.token)}`,
      elseLook.token.range,
    );
    const elseBranch: Expr = { kind: "Error", range: elseLook.token.range };
    return {
      kind: "If",
      condition,
      thenBranch,
      elseBranch,
      range: spanRanges(ifRange, thenBranch.range),
    };
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    for (;;) {
      const look = this.lookahead();
      if (look.found && look.token.kind === "keyword" && look.token.word === "or") {
        this.take(look);
        const right = this.parseAnd();
        left = {
          kind: "Binary",
          op: "or",
          left,
          right,
          range: spanRanges(left.range, right.range),
        };
      } else {
        return left;
      }
    }
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    for (;;) {
      const look = this.lookahead();
      if (look.found && look.token.kind === "keyword" && look.token.word === "and") {
        this.take(look);
        const right = this.parseNot();
        left = {
          kind: "Binary",
          op: "and",
          left,
          right,
          range: spanRanges(left.range, right.range),
        };
      } else {
        return left;
      }
    }
  }

  /** `not` binds looser than comparisons (§3.5): `not a == b` is `not (a == b)`. */
  private parseNot(): Expr {
    const look = this.lookahead();
    if (look.found && look.token.kind === "keyword" && look.token.word === "not") {
      // Direct recursion — cap it like parseExpr does so a `not not not …`
      // pile degrades to E001, never a stack overflow (⚑8).
      if (this.exprNesting > 500) {
        this.exprError("Expression is too deeply nested", look.token.range);
        return { kind: "Error", range: look.token.range };
      }
      this.exprNesting++;
      try {
        const tok = this.take(look);
        const operand = this.parseNot();
        return {
          kind: "Unary",
          op: "not",
          operand,
          range: spanRanges(tok.range, operand.range),
        };
      } finally {
        this.exprNesting--;
      }
    }
    return this.parseComparison();
  }

  /**
   * Single, non-associative comparison; chaining is E001 (§3.5). Detection
   * counts comparisons taken by THIS call, so `(a == b) == c` (parenthesized
   * left operand) is a single comparison, not a chain.
   */
  private parseComparison(): Expr {
    let left = this.parseAdditive();
    let taken = 0;
    let reported = false;
    for (;;) {
      const look = this.lookahead();
      if (!(look.found && look.token.kind === "op" && isComparisonOp(look.token.op))) {
        return left;
      }
      const opTok = look.token;
      if (taken >= 1 && !reported) {
        // Fold anyway (recovery) but report the chain once.
        this.error(
          "Comparisons cannot be chained — combine them with 'and' or parenthesize",
          opTok.range,
        );
        reported = true;
      }
      this.take(look);
      const right = this.parseAdditive();
      left = {
        kind: "Binary",
        op: opTok.op as ComparisonOp,
        left,
        right,
        range: spanRanges(left.range, right.range),
      };
      taken++;
    }
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    for (;;) {
      const look = this.lookahead();
      if (
        look.found &&
        look.token.kind === "op" &&
        (look.token.op === "+" || look.token.op === "-")
      ) {
        const op = look.token.op;
        this.take(look);
        const right = this.parseMultiplicative();
        left = {
          kind: "Binary",
          op,
          left,
          right,
          range: spanRanges(left.range, right.range),
        };
      } else {
        return left;
      }
    }
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnaryMinus();
    for (;;) {
      const look = this.lookahead();
      if (
        look.found &&
        look.token.kind === "op" &&
        (look.token.op === "*" || look.token.op === "/" || look.token.op === "%")
      ) {
        const op = look.token.op;
        this.take(look);
        const right = this.parseUnaryMinus();
        left = {
          kind: "Binary",
          op,
          left,
          right,
          range: spanRanges(left.range, right.range),
        };
      } else {
        return left;
      }
    }
  }

  private parseUnaryMinus(): Expr {
    const look = this.lookahead();
    if (look.found && look.token.kind === "op" && look.token.op === "-") {
      // Direct recursion — capped like parseNot (⚑8: a parse never throws).
      if (this.exprNesting > 500) {
        this.exprError("Expression is too deeply nested", look.token.range);
        return { kind: "Error", range: look.token.range };
      }
      this.exprNesting++;
      try {
        const tok = this.take(look);
        const operand = this.parseUnaryMinus();
        return {
          kind: "Unary",
          op: "-",
          operand,
          range: spanRanges(tok.range, operand.range),
        };
      } finally {
        this.exprNesting--;
      }
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const look = this.lookahead();
    if (!look.found) {
      this.exprError("Expected an expression", look.token.range);
      return { kind: "Error", range: look.token.range };
    }
    const t = look.token;
    switch (t.kind) {
      case "number": {
        this.take(look);
        return { kind: "Number", value: t.value, text: t.text, range: t.range };
      }
      case "string": {
        this.take(look);
        return { kind: "String", parts: t.parts, range: t.range };
      }
      case "color": {
        this.take(look);
        return { kind: "Color", value: t.value, range: t.range };
      }
      case "ref": {
        this.take(look);
        return { kind: "Ref", name: t.name, range: t.range };
      }
      case "identifier": {
        this.take(look);
        return this.parseQualifiedTail({ name: t.text, range: t.range });
      }
      case "keyword": {
        if (t.word === "if") {
          // An if expression in operand position (e.g. `1 + (…)` omitted the
          // parens). §3.5 places if at the lowest precedence; the spec does
          // not forbid it as an operand, so we accept it — `then`/`else`
          // delimit it unambiguously.
          this.take(look);
          return this.parseIfTail(t.range);
        }
        break;
      }
      case "op": {
        if (t.op === "(") {
          this.take(look);
          const inner = this.parseExpr();
          const closeLook = this.lookahead();
          let end: Range = inner.range;
          if (
            closeLook.found &&
            closeLook.token.kind === "op" &&
            closeLook.token.op === ")"
          ) {
            this.take(closeLook);
            end = closeLook.token.range;
          } else {
            this.exprError(
              `Expected ')', found ${this.describe(closeLook.token)}`,
              closeLook.token.range,
            );
          }
          // No Paren node: the inner expression's span widens to include the
          // parentheses (keeps the AST small; §3.5 non-associativity of
          // comparisons is enforced grammatically, so no info is lost).
          return { ...inner, range: spanRanges(t.range, end) };
        }
        break;
      }
      default:
        break;
    }
    this.exprError(
      `Expected an expression, found ${this.describe(t)}`,
      t.range,
    );
    return { kind: "Error", range: t.range };
  }

  /** `Suit.Rock` — exactly one level of qualification (◆14). */
  private parseQualifiedTail(first: NameRef): Expr {
    const dotLook = this.lookahead();
    if (!(dotLook.found && dotLook.token.kind === "op" && dotLook.token.op === ".")) {
      return { kind: "Identifier", name: first.name, range: first.range };
    }
    this.take(dotLook);
    const memberLook = this.lookahead();
    if (!(memberLook.found && memberLook.token.kind === "identifier")) {
      this.exprError(
        `Expected a case name after '.', found ${this.describe(memberLook.token)}`,
        memberLook.token.range,
      );
      return { kind: "Identifier", name: first.name, range: first.range };
    }
    const memberTok = this.take(memberLook) as Token & { kind: "identifier" };
    let node: Expr = {
      kind: "Qualified",
      qualifier: first,
      member: { name: memberTok.text, range: memberTok.range },
      range: spanRanges(first.range, memberTok.range),
    };
    // Deeper chains (`A.B.C`) are not part of the language.
    let extraLook = this.lookahead();
    let reported = false;
    while (extraLook.found && extraLook.token.kind === "op" && extraLook.token.op === ".") {
      if (!reported) {
        this.error(
          "Only one level of qualification is allowed (Enum.Case)",
          extraLook.token.range,
        );
        reported = true;
      }
      this.take(extraLook);
      const junkLook = this.lookahead();
      if (junkLook.found && junkLook.token.kind === "identifier") {
        const junk = this.take(junkLook) as Token & { kind: "identifier" };
        node = { ...node, range: spanRanges(node.range, junk.range) };
      } else {
        break;
      }
      extraLook = this.lookahead();
    }
    return node;
  }
}
