/**
 * Expression evaluation semantics (DESIGN.md §3.5): Text coercions,
 * interpolation, arithmetic (JS float, `%` = JS remainder), strict
 * comparisons, short-circuit logic, and lazy `if` branches — observed
 * through the Text shapes of a minimal generated project.
 */
import { describe, expect, it } from "vitest";
import type { ProjectResult, SheetRows, TextShape } from "../index";
import { compileProject } from "../index";

const src = (...lines: string[]): string => lines.join("\n") + "\n";

interface EvalOpts {
  columns?: string[];
  rows?: Record<string, string>[];
  enums?: string[];
  cardExtra?: string[];
}

function run(expr: string, opts: EvalOpts = {}): ProjectResult {
  const code = src(
    ...(opts.enums ?? []),
    "Sheet: Sh",
    ...(opts.columns ?? ["n: Number", "t: Text"]).map((c) => `  column ${c}`),
    "Template: T",
    "  Text:",
    "    x: 0",
    "    y: 0",
    "    size: 1",
    `    text: ${expr}`,
    "Card: C",
    "  sheet: Sh",
    "  size: poker",
    "  x_units: 20",
    "  y_units: auto",
    ...(opts.cardExtra ?? []).map((l) => `  ${l}`),
    "  Front: T",
  );
  const sheets: SheetRows = { Sh: opts.rows ?? [{ n: "3", t: "abc" }] };
  const result = compileProject(code, sheets);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return result;
}

/** Rendered text of every generated card's single Text shape. */
function texts(expr: string, opts: EvalOpts = {}): string[] {
  const p = run(expr, opts);
  return p.model.decks[0].cards.map((c) => {
    expect(c.error).toBeUndefined();
    return (c.front[0] as TextShape).text;
  });
}

const text = (expr: string, opts: EvalOpts = {}): string => texts(expr, opts)[0];

describe("Text coercions (§3.5 ◆†)", () => {
  it("Number → Text trims trailing zeros", () => {
    expect(text("[n]", { rows: [{ n: "5.50", t: "x" }] })).toBe("5.5");
    expect(text("[n]", { rows: [{ n: "5.0", t: "x" }] })).toBe("5");
    expect(text("2.50")).toBe("2.5");
  });

  it("enum values print their case name", () => {
    expect(
      texts("[s]", {
        enums: ["Enum: S", "  case A", "  case B"],
        cardExtra: ["loop: S as s"],
      }),
    ).toEqual(["A", "B"]);
  });

  it("Text cells pass through verbatim — no trimming", () => {
    expect(text("[t]", { rows: [{ n: "1", t: "  padded  " }] })).toBe("  padded  ");
  });
});

describe("newlines in single-line Text (§3.3 M3 — hard breaks belong to TextBox)", () => {
  it("a \\n escape in a Text literal renders as a space", () => {
    expect(text('"a\\nb"')).toBe("a b");
  });

  it("newline characters in CELL data render as spaces too", () => {
    expect(text("[t]", { rows: [{ n: "1", t: "x\ny" }] })).toBe("x y");
  });

  it("consecutive newlines become one space EACH — replaced, not collapsed", () => {
    expect(text('"a\\n\\nb"')).toBe("a  b");
  });

  it("a literal backslash-n (\\\\n) is untouched — it never was a newline", () => {
    expect(text('"a\\\\nb"')).toBe("a\\nb");
  });
});

describe("string interpolation (§3.5)", () => {
  it("substitutes refs with Text coercions", () => {
    expect(text('"Cost: [n]"', { rows: [{ n: "5", t: "x" }] })).toBe("Cost: 5");
    expect(text('"[t]-[n]"', { rows: [{ n: "2", t: "ab" }] })).toBe("ab-2");
  });

  it("[[ escapes a literal bracket", () => {
    expect(text('"a [[b]"')).toBe("a [b]");
  });

  it("zero-pads Numbers to a sign-aware total minimum width", () => {
    expect(text('"[n:03]"', { rows: [{ n: "7", t: "x" }] })).toBe("007");
    expect(text('"[n:03]"', { rows: [{ n: "-7", t: "x" }] })).toBe("-07");
    expect(text('"[n:03]"', { rows: [{ n: "-0", t: "x" }] })).toBe("000");
    expect(text('"[n:03]"', { rows: [{ n: "1234", t: "x" }] })).toBe("1234");
    expect(text('"[n:01]"', { rows: [{ n: "7", t: "x" }] })).toBe("7");
  });

  it("preserves decimal/scientific Number text and pads only after a sign", () => {
    expect(text('"[n:06]"', { rows: [{ n: "5.50", t: "x" }] })).toBe("0005.5");
    expect(text('"[n:06]"', { rows: [{ n: "-5.5", t: "x" }] })).toBe("-005.5");
    expect(text('"[n:08]"', { rows: [{ n: "1e21", t: "x" }] })).toBe("0001e+21");
    expect(text('"[n:064]"', { rows: [{ n: "2", t: "x" }] })).toHaveLength(64);
  });

  it("requires formatted interpolation references to be Number-typed", () => {
    const result = compileProject(
      src(
        "Sheet: Sh",
        "  column label: Text",
        "Template: T",
        "  Text:",
        "    x: 0",
        "    y: 0",
        "    size: 1",
        '    text: "[label:03]"',
        "Card: C",
        "  sheet: Sh",
        "  size: poker",
        "  x_units: 20",
        "  y_units: auto",
        "  Front: T",
      ),
      { Sh: [{ label: "seven" }] },
    );
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "E003",
        message: expect.stringContaining("requires Number, got Text"),
      }),
    ]));
  });

  it.each([
    { type: "Edition", display: "enum Edition", extra: ["Enum: Edition", "  case First"] },
    { type: "Bool", display: "Bool", extra: [] },
    { type: "Color", display: "Color", extra: [] },
  ])("rejects a formatted $type reference with one E003", ({ type, display, extra }) => {
    const result = compileProject(
      src(
        ...extra,
        "Template: T",
        `  param value: ${type}`,
        "  Text:",
        "    x: 0",
        "    y: 0",
        "    size: 1",
        '    text: "[value:03]"',
      ),
      {},
    );
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "E003",
      message: expect.stringContaining(`requires Number, got ${display}`),
    });
  });

  it("reports an unknown formatted reference once without a format-type cascade", () => {
    const result = compileProject(
      src(
        "Sheet: Sh",
        "Template: T",
        "  Text:",
        "    x: 0",
        "    y: 0",
        "    size: 1",
        '    text: "[missing:03]"',
        "Card: C",
        "  sheet: Sh",
        "  size: poker",
        "  x_units: 20",
        "  y_units: auto",
        "  Front: T",
      ),
      { Sh: [{}] },
    );
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "E002",
      message: expect.stringContaining("missing"),
    });
  });
});

describe("arithmetic (§3.5 — JS float semantics)", () => {
  it("respects precedence and parentheses", () => {
    expect(text("1 + 2 * 3")).toBe("7");
    expect(text("(1 + 2) * 3")).toBe("9");
  });

  it("unary minus", () => {
    expect(text("-[n]", { rows: [{ n: "3", t: "x" }] })).toBe("-3");
  });

  it("division produces fractions; % is the JS remainder (sign of the dividend)", () => {
    expect(text("7 / 2")).toBe("3.5");
    expect(text("7 % 2")).toBe("1");
    expect(text("-7 % 2")).toBe("-1");
  });
});

describe("comparisons and logic (§3.5 — strict)", () => {
  it("number ordering and text equality", () => {
    expect(text('if 2 <= 2 then "y" else "n"')).toBe("y");
    expect(text('if [t] == "abc" then "eq" else "ne"')).toBe("eq");
    expect(text('if [n] != 3 then "ne" else "eq"')).toBe("eq");
  });

  it("enum equality via qualified case", () => {
    expect(
      texts('if [s] == S.B then "b" else "other"', {
        enums: ["Enum: S", "  case A", "  case B"],
        cardExtra: ["loop: S as s"],
      }),
    ).toEqual(["other", "b"]);
  });

  it("not", () => {
    expect(text('if not ([n] == 0) then "nz" else "z"', { rows: [{ n: "0", t: "x" }] })).toBe("z");
  });
});

describe("laziness (documented decisions — guards must prevent D008)", () => {
  it("if evaluates only the taken branch", () => {
    const p = run("if [n] == 0 then 0 else 100 / [n]", { rows: [{ n: "0", t: "x" }] });
    expect(p.dataDiagnostics).toEqual([]);
    expect((p.model.decks[0].cards[0].front[0] as TextShape).text).toBe("0");
  });

  it("or short-circuits", () => {
    expect(
      text('if [n] == 0 or 100 / [n] > 10 then "small" else "big"', {
        rows: [{ n: "0", t: "x" }],
      }),
    ).toBe("small");
  });

  it("and short-circuits", () => {
    expect(
      text('if [n] > 0 and 100 / [n] > 10 then "yes" else "no"', { rows: [{ n: "0", t: "x" }] }),
    ).toBe("no");
  });
});
