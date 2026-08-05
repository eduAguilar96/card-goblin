/** Shared helpers for the lexer/parser test suites (not a test file itself). */
import type { CardDecl, Expr, Program, PropertyNode } from "../ast";
import type { Diagnostic } from "../diagnostics";
import { parse } from "../parser";

/** Parse and assert zero diagnostics; returns the program. */
export function parseClean(source: string): Program {
  const { program, diagnostics } = parse(source);
  if (diagnostics.length > 0) {
    const detail = diagnostics
      .map(
        (d) =>
          `${d.code} @${d.range.startLine}:${d.range.startCol}-${d.range.endLine}:${d.range.endCol} ${d.message}`,
      )
      .join("\n");
    throw new Error(`expected zero diagnostics, got ${diagnostics.length}:\n${detail}`);
  }
  return program;
}

/** Parse and return only the diagnostics. */
export function diags(source: string): Diagnostic[] {
  return parse(source).diagnostics;
}

/**
 * Parse a single expression by wrapping it as a Card property value:
 * `Card: C\n  p: <expr>`. Single-line expressions only.
 */
export function parseExprClean(expr: string): Expr {
  const program = parseClean(`Card: C\n  p: ${expr}\n`);
  return firstProperty(program).value;
}

/** Diagnostics produced by an expression in property-value position. */
export function exprDiags(expr: string): Diagnostic[] {
  return diags(`Card: C\n  p: ${expr}\n`);
}

export function firstProperty(program: Program): PropertyNode {
  const card = program.declarations[0] as CardDecl;
  const item = card.items[0];
  if (item.kind !== "Property") throw new Error("expected a property");
  return item;
}

/** Assert an expression node's kind and return it narrowed. */
export function asKind<K extends Expr["kind"]>(
  expr: Expr,
  kind: K,
): Extract<Expr, { kind: K }> {
  if (expr.kind !== kind) {
    throw new Error(`expected ${kind}, got ${expr.kind}: ${JSON.stringify(expr)}`);
  }
  return expr as Extract<Expr, { kind: K }>;
}
