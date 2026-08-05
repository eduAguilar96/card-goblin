/** Expression grammar and exact precedence (§3.5). */
import { describe, expect, it } from "vitest";
import type { BinaryOp } from "../ast";
import { asKind, exprDiags, parseExprClean } from "./util";

describe("precedence (§3.5: if → or → and → not → comparisons → + - → * / % → unary - → primary)", () => {
  it("* binds tighter than +", () => {
    const e = asKind(parseExprClean("1 + 2 * 3"), "Binary");
    expect(e.op).toBe("+");
    expect(asKind(e.right, "Binary").op).toBe("*");
  });

  it("parentheses override precedence and widen the node's span to include them", () => {
    const e = asKind(parseExprClean("(1 + 2) * 3"), "Binary");
    expect(e.op).toBe("*");
    const left = asKind(e.left, "Binary");
    expect(left.op).toBe("+");
    expect(left.range.startCol).toBe(5); // the '(' — "Card: C\n  p: (1 + 2) * 3"
  });

  it("and binds tighter than or", () => {
    const e = asKind(parseExprClean("[a] or [b] and [c]"), "Binary");
    expect(e.op).toBe("or");
    expect(asKind(e.right, "Binary").op).toBe("and");
  });

  it("not binds looser than comparisons: not a == b is not (a == b)", () => {
    const e = asKind(parseExprClean("not [a] == 1"), "Unary");
    expect(e.op).toBe("not");
    expect(asKind(e.operand, "Binary").op).toBe("==");
  });

  it("not nests", () => {
    const e = asKind(parseExprClean("not not [a]"), "Unary");
    expect(asKind(e.operand, "Unary").op).toBe("not");
  });

  it("unary minus binds tighter than *", () => {
    const e = asKind(parseExprClean("-2 * 3"), "Binary");
    expect(e.op).toBe("*");
    expect(asKind(e.left, "Unary").op).toBe("-");
  });

  it("binary minus still works", () => {
    const e = asKind(parseExprClean("5 - 2 - 1"), "Binary");
    expect(e.op).toBe("-");
    expect(asKind(e.left, "Binary").op).toBe("-"); // left-associative
  });

  it("% is multiplicative", () => {
    const e = asKind(parseExprClean("[a] + [b] % 2"), "Binary");
    expect(e.op).toBe("+");
    expect(asKind(e.right, "Binary").op).toBe("%");
  });

  const comparisons: BinaryOp[] = ["==", "!=", "<", "<=", ">", ">="];
  for (const op of comparisons) {
    it(`comparison ${op} parses`, () => {
      expect(asKind(parseExprClean(`[a] ${op} 1`), "Binary").op).toBe(op);
    });
  }
});

// §3.5 (amended) mandates this: comparisons are non-associative, and a chain
// is E001 with a hint to use `and` or parentheses.
describe("comparisons are non-associative — chaining is E001 (§3.5)", () => {
  it("1 < 2 < 3 is E001 with an and/parentheses hint", () => {
    const ds = exprDiags("1 < 2 < 3");
    expect(ds).toHaveLength(1);
    expect(ds[0].code).toBe("E001");
    expect(ds[0].message.toLowerCase()).toContain("chain");
    expect(ds[0].message).toContain("and");
    expect(ds[0].message.toLowerCase()).toContain("parenthe");
  });

  it("a parenthesized comparison as an operand is NOT a chain", () => {
    expect(exprDiags("(1 < 2) == (2 < 3)")).toEqual([]);
  });

  it("comparisons combined with and are fine", () => {
    expect(exprDiags("1 < 2 and 2 < 3")).toEqual([]);
  });
});

describe("if / then / else (§3.5)", () => {
  it("parses a simple if", () => {
    const e = asKind(parseExprClean("if [a] then 1 else 2"), "If");
    expect(asKind(e.condition, "Ref").name).toBe("a");
    expect(asKind(e.thenBranch, "Number").value).toBe(1);
    expect(asKind(e.elseBranch, "Number").value).toBe(2);
  });

  it("chains: else if nests into the else branch", () => {
    const e = asKind(parseExprClean("if [a] then 1 else if [b] then 2 else 3"), "If");
    const inner = asKind(e.elseBranch, "If");
    expect(asKind(inner.elseBranch, "Number").value).toBe(3);
  });

  it("else is mandatory: a missing else is E001", () => {
    const ds = exprDiags("if [a] then 1");
    expect(ds).toHaveLength(1);
    expect(ds[0].message).toContain("else");
  });

  it("a missing then is E001", () => {
    const ds = exprDiags("if [a] 1");
    expect(ds).toHaveLength(1);
    expect(ds[0].message).toContain("then");
  });

  it("the else branch extends as far as possible (if has lowest precedence)", () => {
    const e = asKind(parseExprClean("if [a] then 1 else 2 + 3"), "If");
    expect(asKind(e.elseBranch, "Binary").op).toBe("+");
  });
});

describe("primaries", () => {
  it("bare identifiers parse as Identifier nodes — resolution is task 2", () => {
    expect(asKind(parseExprClean("poker"), "Identifier").name).toBe("poker");
    expect(asKind(parseExprClean("mediumpurple"), "Identifier").name).toBe("mediumpurple");
    expect(asKind(parseExprClean("auto"), "Identifier").name).toBe("auto");
  });

  it("block openers are ordinary identifiers outside header position (◆30)", () => {
    expect(asKind(parseExprClean("Card"), "Identifier").name).toBe("Card");
    expect(asKind(parseExprClean("Text"), "Identifier").name).toBe("Text");
  });

  it("[full] is always a data ref, never the keyword (◆30)", () => {
    expect(asKind(parseExprClean("[full]"), "Ref").name).toBe("full");
  });

  it("Suit.Rock parses as a qualified reference node", () => {
    const e = asKind(parseExprClean("Suit.Rock"), "Qualified");
    expect(e.qualifier.name).toBe("Suit");
    expect(e.member.name).toBe("Rock");
  });

  it("A.B.C is E001 (one level of qualification only)", () => {
    const ds = exprDiags("A.B.C");
    expect(ds).toHaveLength(1);
    expect(ds[0].message).toContain("Enum.Case");
  });

  it("string, number, and #hex color literals", () => {
    expect(asKind(parseExprClean('"hi"'), "String").parts).toHaveLength(1);
    expect(asKind(parseExprClean("1.5"), "Number").value).toBe(1.5);
    expect(asKind(parseExprClean("#ff0000"), "Color").value).toBe("#ff0000");
  });

  it("a missing operand is a single E001 and an Error node, not a throw", () => {
    const ds = exprDiags("1 +");
    expect(ds).toHaveLength(1);
    expect(ds[0].code).toBe("E001");
  });

  it("a stray operator where an operand belongs is one E001", () => {
    expect(exprDiags("* 2")).toHaveLength(1);
  });
});
