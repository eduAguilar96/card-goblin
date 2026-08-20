import { describe, expect, it } from "vitest";
import { KEYWORDS, lex } from "../lexer";
import type { Token } from "../lexer";

const kinds = (source: string): string[] => lex(source).tokens.map((t) => t.kind);

const firstString = (source: string): Token & { kind: "string" } => {
  const t = lex(source).tokens.find((x) => x.kind === "string");
  if (!t || t.kind !== "string") throw new Error("no string token");
  return t;
};

describe("composition words stay contextual", () => {
  it("does not globally reserve let, If, or Else", () => {
    expect(KEYWORDS.has("let")).toBe(false);
    expect(KEYWORDS.has("If")).toBe(false);
    expect(KEYWORDS.has("Else")).toBe(false);
    expect(
      lex("let If Else").tokens
        .filter((token) => token.kind !== "newline" && token.kind !== "eof")
        .map((token) => token.kind),
    ).toEqual(["identifier", "identifier", "identifier"]);
  });

  it("keeps lowercase expression else reserved for targeted parser recovery", () => {
    const token = lex("else:").tokens[0];
    expect(token).toMatchObject({ kind: "keyword", word: "else" });
  });
});

describe("string literals and interpolation (§3.5 ◆)", () => {
  it('lexes "Cost: [cost]" into text + ref parts with sub-ranges', () => {
    const t = firstString('x: "Cost: [cost]"');
    expect(t.parts).toEqual([
      { kind: "text", value: "Cost: ", range: { startLine: 0, startCol: 4, endLine: 0, endCol: 10 } },
      { kind: "ref", name: "cost", range: { startLine: 0, startCol: 10, endLine: 0, endCol: 16 } },
    ]);
  });

  it("[[ escapes a literal [ and merges into surrounding text", () => {
    const t = firstString('x: "a[[b]c"');
    expect(t.parts.map((p) => (p.kind === "text" ? p.value : `<${p.name}>`))).toEqual(["a[b]c"]);
    expect(lex('x: "a[[b]c"').diagnostics).toEqual([]);
  });

  it("a [ not opening a valid [identifier] is E001 with a hint about [[", () => {
    const { diagnostics } = lex('x: "a [ b"');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("E001");
    expect(diagnostics[0].message).toContain("[[");
    expect(diagnostics[0].range).toEqual({ startLine: 0, startCol: 6, endLine: 0, endCol: 7 });
  });

  it("a [123] inside a string is E001 (not an identifier)", () => {
    const { diagnostics } = lex('x: "a [123] b"');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("[[");
  });

  it("an unterminated string is E001 and still yields a token", () => {
    const { tokens, diagnostics } = lex('x: "abc');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message.toLowerCase()).toContain("unterminated");
    expect(tokens.some((t) => t.kind === "string")).toBe(true);
  });

  it("an empty string lexes with zero parts", () => {
    expect(firstString('x: ""').parts).toEqual([]);
  });
});

describe("string escapes (§3.1 M3 — \\n and \\\\ only)", () => {
  const partValues = (source: string): string[] =>
    firstString(source).parts.map((p) => (p.kind === "text" ? p.value : `<${p.name}>`));

  it("\\n lexes as a real newline character inside the text part", () => {
    expect(partValues('x: "a\\nb"')).toEqual(["a\nb"]);
    expect(lex('x: "a\\nb"').diagnostics).toEqual([]);
  });

  it("\\\\ lexes as one literal backslash", () => {
    expect(partValues('x: "a\\\\b"')).toEqual(["a\\b"]);
    expect(lex('x: "a\\\\b"').diagnostics).toEqual([]);
  });

  it("\\\\n is a literal backslash then the letter n — NOT a newline", () => {
    expect(partValues('x: "a\\\\nb"')).toEqual(["a\\nb"]);
    expect(lex('x: "a\\\\nb"').diagnostics).toEqual([]);
  });

  it("any other \\-sequence is E001 hinting the two valid escapes, kept literally", () => {
    const { tokens, diagnostics } = lex('x: "a\\tb"');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("E001");
    expect(diagnostics[0].message).toContain('"\\t"');
    expect(diagnostics[0].message).toContain("\\n");
    expect(diagnostics[0].message).toContain("\\\\");
    expect(diagnostics[0].range).toEqual({ startLine: 0, startCol: 5, endLine: 0, endCol: 7 });
    const t = tokens.find((x) => x.kind === "string");
    expect(t && t.kind === "string" && t.parts).toEqual([
      { kind: "text", value: "a\\tb", range: expect.anything() },
    ]);
  });

  it('\\" is E001 too — recovery keeps the backslash and the quote still closes', () => {
    const { tokens, diagnostics } = lex('x: "a\\"');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("only escapes");
    const t = tokens.find((x) => x.kind === "string");
    expect(t && t.kind === "string" && t.parts.map((p) => (p.kind === "text" ? p.value : ""))).toEqual(["a\\"]);
  });

  it("escapes interact with interpolation: text around a [ref] keeps its newline", () => {
    expect(partValues('x: "Cost:\\n[cost] gold"')).toEqual(["Cost:\n", "<cost>", " gold"]);
  });

  it("\\[ does NOT escape a bracket — E001 for the escape, then [[ still works", () => {
    // The only literal-[ escape is doubling (§3.5); a backslash before [ is
    // an unknown escape AND the [ goes on to open a ref as usual.
    const one = lex('x: "a\\[cost]"');
    expect(one.diagnostics).toHaveLength(1);
    expect(one.diagnostics[0].message).toContain("only escapes");
    const t = one.tokens.find((x) => x.kind === "string");
    expect(
      t && t.kind === "string" && t.parts.map((p) => (p.kind === "text" ? p.value : `<${p.name}>`)),
    ).toEqual(["a\\", "<cost>"]);
    expect(partValues('x: "a\\n[[b"')).toEqual(["a\n[b"]);
    expect(lex('x: "a\\n[[b"').diagnostics).toEqual([]);
  });

  it("consecutive escapes compose: \\n\\n is two newlines, \\\\\\n is backslash + newline", () => {
    expect(partValues('x: "a\\n\\nb"')).toEqual(["a\n\nb"]);
    expect(partValues('x: "a\\\\\\nb"')).toEqual(["a\\\nb"]);
  });

  it("a trailing backslash at end of line reports ONLY the unterminated string", () => {
    const { tokens, diagnostics } = lex('x: "abc\\');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message.toLowerCase()).toContain("unterminated");
    const t = tokens.find((x) => x.kind === "string");
    expect(t && t.kind === "string" && t.parts.map((p) => (p.kind === "text" ? p.value : ""))).toEqual(["abc\\"]);
  });

  it("backslashes outside strings are unchanged: still an unexpected character", () => {
    const { diagnostics } = lex("x: \\n");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Unexpected character");
  });
});

describe("data references outside strings", () => {
  it("[count] is a single ref token — brackets always mean data refs (◆30)", () => {
    const { tokens, diagnostics } = lex("x: [count]");
    expect(diagnostics).toEqual([]);
    const ref = tokens.find((t) => t.kind === "ref");
    expect(ref && ref.kind === "ref" && ref.name).toBe("count");
  });

  it("[123] is E001", () => {
    const { diagnostics } = lex("x: [123]");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("E001");
  });

  it("an unclosed [ is E001", () => {
    const { diagnostics } = lex("x: [health");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message.toLowerCase()).toContain("unclosed");
  });
});

describe("comments vs #hex colors (§3.1 ◆22)", () => {
  it("#RRGGBB is a color token", () => {
    const { tokens, diagnostics } = lex("color: #A1b2C3");
    expect(diagnostics).toEqual([]);
    const c = tokens.find((t) => t.kind === "color");
    expect(c && c.kind === "color" && c.value).toBe("#A1b2C3");
  });

  it("# followed by anything else is a comment to end of line", () => {
    const { tokens } = lex("x: 1 # a comment: with [stuff] \"and quotes");
    expect(tokens.map((t) => t.kind)).toEqual(["identifier", "op", "number", "newline", "eof"]);
  });

  it("#fff (3-digit form) is treated as a comment — only #RRGGBB is a literal", () => {
    const { tokens } = lex("x: #fff");
    expect(tokens.some((t) => t.kind === "color")).toBe(false);
  });

  it("#1234567 (7 hex-ish chars) is a comment, not a color", () => {
    const { tokens } = lex("x: #1234567");
    expect(tokens.some((t) => t.kind === "color")).toBe(false);
  });
});

describe("indentation (§3.1)", () => {
  it("emits INDENT/DEDENT around nested lines", () => {
    expect(kinds("A: a\n  b: 1\nC: c")).toEqual([
      "identifier", "op", "identifier", "newline",
      "indent", "identifier", "op", "number", "newline",
      "dedent", "identifier", "op", "identifier", "newline",
      "eof",
    ]);
  });

  it("blank lines and comment-only lines are ignored for indentation", () => {
    expect(kinds("A: a\n\n      # deep comment\n  b: 1\n\nC: c")).toEqual([
      "identifier", "op", "identifier", "newline",
      "indent", "identifier", "op", "number", "newline",
      "dedent", "identifier", "op", "identifier", "newline",
      "eof",
    ]);
  });

  it("dedent to a level between stack levels emits DEDENT then INDENT", () => {
    // 0 → 8 → 4: pops 8, then re-indents to 4 (needed for free-form
    // continuation columns, ◆23†; the parser judges legality).
    expect(kinds("a: 1\n        b: 2\n    c: 3")).toEqual([
      "identifier", "op", "number", "newline",
      "indent", "identifier", "op", "number", "newline",
      "dedent", "indent", "identifier", "op", "number", "newline",
      "dedent", "eof",
    ]);
  });

  it("tabs-only indentation is fine", () => {
    expect(lex("A: a\n\tb: 1\n\t\tc: 2\n").diagnostics).toEqual([]);
  });

  it("mixing tabs and spaces across lines is E001 exactly once", () => {
    const { diagnostics } = lex("A: a\n  b: 1\n\tc: 2\n\td: 3\n  e: 4\n");
    const mixed = diagnostics.filter((d) => d.message.includes("tabs and spaces"));
    expect(mixed).toHaveLength(1);
    expect(mixed[0].code).toBe("E001");
  });

  it("a single line mixing tabs and spaces in its indent is E001 once", () => {
    const { diagnostics } = lex("A: a\n \tb: 1\n \tc: 2\n");
    expect(diagnostics.filter((d) => d.message.includes("tabs and spaces"))).toHaveLength(1);
  });
});

describe("misc tokens", () => {
  it("keywords vs identifiers: block openers lex as plain identifiers (◆30)", () => {
    const { tokens } = lex("Enum case column if then else and or not as Rectangle count");
    const tags = tokens
      .filter((t) => t.kind === "identifier" || t.kind === "keyword")
      .map((t) => (t.kind === "keyword" ? `kw:${t.word}` : `id:${t.text}`));
    expect(tags).toEqual([
      "id:Enum", "kw:case", "kw:column", "kw:if", "kw:then", "kw:else",
      "kw:and", "kw:or", "kw:not", "kw:as", "id:Rectangle", "id:count",
    ]);
  });

  it("numbers: integers and decimals; `1.` stays number + dot", () => {
    const { tokens } = lex("x: 3 1.5 1.");
    const nums = tokens.filter((t) => t.kind === "number").map((t) => t.kind === "number" && t.text);
    expect(nums).toEqual(["3", "1.5", "1"]);
    expect(tokens.some((t) => t.kind === "op" && t.op === ".")).toBe(true);
  });

  it("two-char operators lex greedily", () => {
    const ops = lex("a == b != c <= d >= e < f > g")
      .tokens.filter((t) => t.kind === "op")
      .map((t) => t.kind === "op" && t.op);
    expect(ops).toEqual(["==", "!=", "<=", ">=", "<", ">"]);
  });

  it("a lone = is E001 with a == hint", () => {
    const { diagnostics } = lex("x = 1");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("==");
  });

  it("an unexpected character is E001 and lexing continues", () => {
    const { tokens, diagnostics } = lex("x: 1 @ 2");
    expect(diagnostics).toHaveLength(1);
    expect(tokens.filter((t) => t.kind === "number")).toHaveLength(2);
  });
});
