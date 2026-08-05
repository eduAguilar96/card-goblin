/** Error tolerance (⚑8/§4.1): E001 with precise ranges, recovery at line/block boundaries, never throws. */
import { describe, expect, it } from "vitest";
import type { EnumDecl, SheetDecl, TemplateDecl, ElementNode } from "../ast";
import { parse } from "../parser";

describe("multi-error recovery", () => {
  it("two separate bad lines yield exactly two E001s and valid siblings still parse", () => {
    const { program, diagnostics } = parse(
      [
        "Enum: Suit",
        "  case Rock",
        "  junk here",
        "Sheet: S",
        "  column a Text",
        "  column b: Number",
        "",
      ].join("\n"),
    );
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((d) => d.code === "E001" && d.severity === "error")).toBe(true);
    // Precise ranges: first error on line 2 (`junk`), second on line 4 (`Text`).
    expect(diagnostics[0].range.startLine).toBe(2);
    expect(diagnostics[1].range.startLine).toBe(4);
    // Both declarations and their valid children survive.
    const suit = program.declarations[0] as EnumDecl;
    expect(suit.cases.map((c) => c.name.name)).toEqual(["Rock"]);
    const sheet = program.declarations[1] as SheetDecl;
    expect(sheet.columns.map((c) => c.name.name)).toEqual(["b"]);
  });

  it("a bad property value is one E001; later siblings and elements survive", () => {
    const { program, diagnostics } = parse(
      [
        "Template: T",
        "  Rectangle:",
        "    x: :",
        "    y: 2",
        "  Icon:",
        "    x: 1",
        "",
      ].join("\n"),
    );
    expect(diagnostics).toHaveLength(1);
    const tpl = program.declarations[0] as TemplateDecl;
    const rect = tpl.children[0] as ElementNode;
    expect(rect.properties.map((p) => [p.key.name, p.value.kind])).toEqual([
      ["x", "Error"],
      ["y", "Number"],
    ]);
    expect((tpl.children[1] as ElementNode).element).toBe("Icon");
  });

  it("a bad top-level line with an indented block skips the whole block", () => {
    const { program, diagnostics } = parse(
      "Widget: W\n  x: 1\n  y: 2\nEnum: E\n  case A\n",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("top-level");
    expect(program.declarations.map((d) => d.kind)).toEqual(["EnumDecl"]);
  });

  it("an unterminated string is a lexer E001 but the property still parses", () => {
    const { program, diagnostics } = parse('Card: C\n  name: "oops\n  size: poker\n');
    expect(diagnostics).toHaveLength(1);
    const card = program.declarations[0];
    if (card.kind !== "CardDecl") throw new Error("card");
    expect(card.items).toHaveLength(2);
  });

  it("an unexpected indent is reported and skipped", () => {
    const { program, diagnostics } = parse("  x: 1\nEnum: E\n  case A\n");
    expect(diagnostics).toHaveLength(1);
    expect(program.declarations).toHaveLength(1);
  });
});

describe("a parse never throws (⚑8)", () => {
  const nasty = [
    "",
    "\n\n\n",
    "   \n\t\n",
    ":::",
    "]",
    "[",
    "[[",
    '"',
    '"[',
    "if if if",
    "Enum:",
    "Card:\n",
    "Enum: E\n\tcase A\n  case B\n",
    "Card: C\n  p: " + "(".repeat(2000) + "1",
    "Card: C\n  p: " + "not ".repeat(500) + "1",
    "Card: C\n  p: 1 " + "+ 1 ".repeat(500),
    "Card: C\n  p: " + "if 1 then 2 else ".repeat(100) + "3",
    "🃏 emoji soup 🎲",
    "Repeat: as as as",
    "Front: Back:",
    "case case",
    "column: column",
    "Card: C\n  p: Suit..Rock\n",
    "Card: C\n  p: -\n",
    "Card: C\n  p: 1 +\n\t\tbroken tab continuation\n",
  ];

  for (const [i, source] of nasty.entries()) {
    it(`survives nasty input #${i}`, () => {
      expect(() => parse(source)).not.toThrow();
      const { diagnostics } = parse(source);
      for (const d of diagnostics) {
        expect(d.code).toBe("E001");
        expect(d.severity).toBe("error");
        expect(d.range.startLine).toBeGreaterThanOrEqual(0);
        expect(d.range.startCol).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it("deeply nested parens are capped with a diagnostic instead of a stack overflow", () => {
    const { diagnostics } = parse("Card: C\n  p: " + "(".repeat(5000) + "1\n");
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("10,000 `not`s degrade to one E001, not a stack overflow", () => {
    const { diagnostics } = parse("Card: C\n  p: " + "not ".repeat(10000) + "1\n");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("E001");
    expect(diagnostics[0].message).toContain("nested");
  });

  it("10,000 unary minuses degrade to one E001, not a stack overflow", () => {
    const { diagnostics } = parse("Card: C\n  p: " + "- ".repeat(10000) + "1\n");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("E001");
    expect(diagnostics[0].message).toContain("nested");
  });

  it("2,000 nested Repeat blocks degrade to one E001, not a stack overflow", () => {
    let src = "Template: T\n";
    for (let i = 0; i < 2000; i++) {
      src += "  ".repeat(i + 1) + `Repeat: 1 as v${i}\n`;
    }
    const { diagnostics } = parse(src);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("E001");
    expect(diagnostics[0].message).toContain("nested");
  });
});

describe("diagnostics ordering", () => {
  it("lexer and parser diagnostics come back sorted by source position", () => {
    // Line 1 produces a parser error (incomplete expression); line 2 produces
    // a lexer error (malformed interpolation). Unsorted, the lexer's would
    // come first.
    const { diagnostics } = parse('Card: C\n  p: 1 +\n  q: "bad [ str"\n');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].range.startLine).toBe(1);
    expect(diagnostics[1].range.startLine).toBe(2);
  });
});
