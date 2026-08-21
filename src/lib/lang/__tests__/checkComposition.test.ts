import { describe, expect, it } from "vitest";
import type { LetNode, Program, TemplateDecl } from "../ast";
import { check } from "../check";
import { parse } from "../parser";

const lines = (...source: string[]): string => `${source.join("\n")}\n`;

function checked(source: string): ReturnType<typeof check> & { program: Program } {
  const parsed = parse(source);
  expect(parsed.diagnostics).toEqual([]);
  return { program: parsed.program, ...check(parsed.program) };
}

const CARD = [
  "Card: C",
  "  sheet: S",
  "  size: poker",
  "  x_units: 20",
  "  y_units: auto",
  "  Front: Root",
  "Sheet: S",
];

describe("checker composition and lexical bindings", () => {
  it("hoists lets, checks both structural branches, and records transitive usage", () => {
    const result = checked(lines(
      "let global_size: [later] + 1",
      "let later: 2",
      "Template: Leaf",
      "  let local_size: [global_size]",
      "  If: 1 == 1",
      "    Text:",
      "      x: 0",
      "      y: 0",
      "      size: [local_size]",
      "      text: \"yes\"",
      "  Else:",
      "    Text:",
      "      x: 0",
      "      y: 0",
      "      size: [local_size]",
      "      text: \"no\"",
      "Template: Root",
      "  Leaf:",
      ...CARD,
    ));

    expect(result.diagnostics).toEqual([]);
    const card = result.bindings.cards[0];
    const lets = result.program.declarations.filter((d): d is LetNode => d.kind === "Let");
    expect(card.letTypes.get(lets[0])?.kind).toBe("Number");
    expect(card.letTypes.get(lets[1])?.kind).toBe("Number");
    expect([...result.bindings.templateUsage].map(([tpl]) => tpl.name.name)).toEqual(["Root", "Leaf"]);
    expect([...card.templateCalls.values()].map((tpl) => tpl.name.name)).toEqual(["Leaf"]);
  });

  it("checks the statically untaken branch", () => {
    const result = checked(lines(
      "Template: Root",
      "  If: 1 == 1",
      "    Rectangle:",
      "      x: 0",
      "      y: 0",
      "      width: 1",
      "      height: 1",
      "      color: red",
      "  Else:",
      "    Rectangle:",
      "      x: [missing]",
      "      y: 0",
      "      width: 1",
      "      height: 1",
      "      color: red",
      ...CARD,
    ));
    expect(result.diagnostics.map((d) => d.code)).toEqual(["E002"]);
  });

  it("does not let a callee capture caller locals", () => {
    const result = checked(lines(
      "Template: Callee",
      "  Text:",
      "    x: 0",
      "    y: 0",
      "    size: [caller_size]",
      "    text: \"x\"",
      "Template: Root",
      "  let caller_size: 2",
      "  Callee:",
      ...CARD,
    ));
    expect(result.diagnostics.map((d) => d.code).sort()).toEqual(["E002", "W002"]);
    expect(result.bindings.templateUsage.has(
      result.program.declarations.find((d): d is TemplateDecl =>
        d.kind === "TemplateDecl" && d.name.name === "Callee")!,
    )).toBe(true);
  });

  it("checks typed arguments, forwarding, and invocation arity", () => {
    const result = checked(lines(
      "Enum: Edition",
      "  case Black",
      "  case White",
      "Template: Leaf",
      "  param edition: Edition",
      "  param ink: Color",
      "  Rectangle:",
      "    x: 0",
      "    y: 0",
      "    width: 1",
      "    height: 1",
      "    color: [ink]",
      "Template: Root",
      "  param edition: Edition",
      "  Leaf:",
      "    edition: [edition]",
      "    ink: red",
      "Template: Bad",
      "  Leaf:",
      "    edition: 1",
      "    extra: 2",
      "    extra: 3",
      "Card: C",
      "  sheet: S",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: Root",
      "    edition: Edition.Black",
      "Sheet: S",
    ));
    expect(result.diagnostics.map((d) => `${d.code}:${d.message}`)).toEqual(expect.arrayContaining([
      expect.stringContaining("E003:Argument 'edition' expects enum Edition, got Number"),
      expect.stringContaining("E008:Unknown argument 'extra'"),
      expect.stringContaining("E005:Duplicate argument 'extra'"),
      expect.stringContaining("E008:Missing argument 'ink'"),
    ]));
    const paramRefs = [...result.bindings.cards[0].resolutions.values()]
      .filter((resolution) => resolution.kind === "param");
    expect(paramRefs.length).toBeGreaterThanOrEqual(2);
  });

  it("reports duplicate params and a root let collision", () => {
    const result = checked(lines(
      "Template: Root",
      "  param value: Number",
      "  param value: Text",
      "  let value: 2",
      "  Text:",
      "    x: 0",
      "    y: 0",
      "    size: 1",
      "    text: [value]",
      "Card: C",
      "  sheet: S",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: Root",
      "    value: 1",
      "Sheet: S",
    ));
    expect(result.diagnostics.filter((d) => d.code === "E005").map((d) => d.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Duplicate parameter 'value'"),
        expect.stringContaining("Root binding 'value' conflicts"),
      ]),
    );
  });

  it("leaves an unreachable invalid global lazy and warns only that it is unused", () => {
    const result = checked(lines(
      "let unused: [missing]",
      "Template: Root",
      "  Rectangle:",
      "    x: 0",
      "    y: 0",
      "    width: 1",
      "    height: 1",
      "    color: red",
      ...CARD,
    ));
    expect(result.diagnostics.map((d) => d.code)).toEqual(["W002"]);
  });

  it("warns at a narrower shadow and counts references in unused local initializers", () => {
    const result = checked(lines(
      "let value: 1",
      "Template: Root",
      "  let value: 2",
      "  let unused: [dependency]",
      "  let dependency: 3",
      "  Rectangle:",
      "    x: [value]",
      "    y: 0",
      "    width: 1",
      "    height: 1",
      "    color: red",
      ...CARD,
    ));
    expect(result.diagnostics.map((d) => `${d.code}:${d.message}`)).toEqual(expect.arrayContaining([
      expect.stringContaining("W001:Binding 'value' shadows a global binding"),
      expect.stringContaining("W002:Binding 'value' is never used"),
      expect.stringContaining("W002:Binding 'unused' is never used"),
    ]));
    expect(result.diagnostics.some((d) => d.code === "W002" && d.message.includes("dependency")))
      .toBe(false);
  });

  it("infers a reachable global independently for each Card context", () => {
    const result = checked(lines(
      "let contextual: [value]",
      "Template: Root",
      "  Text:",
      "    x: 0",
      "    y: 0",
      "    size: 1",
      "    text: [contextual]",
      "Sheet: Numbers",
      "  column value: Number",
      "Sheet: Words",
      "  column value: Text",
      "Card: A",
      "  sheet: Numbers",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: Root",
      "Card: B",
      "  sheet: Words",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: Root",
    ));
    expect(result.diagnostics).toEqual([]);
    const global = result.bindings.globals.get("contextual")!;
    expect(result.bindings.cards.map((card) => card.letTypes.get(global)?.kind)).toEqual([
      "Number",
      "Text",
    ]);
  });

  it("reports one E009 for a let SCC and one for a template SCC", () => {
    const result = checked(lines(
      "let a: [b]",
      "let b: [a]",
      "Template: A",
      "  B:",
      "Template: B",
      "  A:",
      "Template: Root",
      "  Text:",
      "    x: 0",
      "    y: 0",
      "    size: [a]",
      "    text: \"x\"",
      "  A:",
      ...CARD,
    ));
    const cycles = result.diagnostics.filter((d) => d.code === "E009");
    expect(cycles).toHaveLength(2);
    expect(cycles.map((d) => d.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("a -> b -> a"),
      expect.stringContaining("A -> B -> A"),
    ]));
  });

  it("does not let silent equality inference swallow a binding-cycle E009", () => {
    const result = checked(lines(
      "let a: [b]",
      "let b: [a]",
      "Template: Root",
      "  If: [a] == 1",
      "    Rectangle:",
      "      x: 0",
      "      y: 0",
      "      width: 1",
      "      height: 1",
      "      color: red",
      ...CARD,
    ));
    const cycles = result.diagnostics.filter((d) => d.code === "E009");
    expect(cycles).toHaveLength(1);
    expect(cycles[0].message).toContain("a -> b -> a");
  });

  it("reports long binding and Template cycles before safety caps", () => {
    const globals = Array.from(
      { length: 500 },
      (_, i) => `let a${i}: [a${(i + 1) % 500}]`,
    );
    const templates: string[] = [];
    for (let i = 0; i < 65; i++) {
      templates.push(`Template: T${i}`, `  T${(i + 1) % 65}:`);
    }
    const result = checked(lines(
      ...globals,
      ...templates,
      "Template: Root",
      "  If: [a0] == 1",
      "    T0:",
      ...CARD,
    ));
    const cycles = result.diagnostics.filter((d) => d.code === "E009");
    expect(cycles).toHaveLength(2);
    expect(cycles.some((d) => d.message.startsWith("Binding dependency cycle: a0 -> a1"))).toBe(true);
    expect(cycles.some((d) => d.message.startsWith("Template call cycle: T0 -> T1"))).toBe(true);
  });

  it("accepts exactly 64 active composition calls", () => {
    const templates: string[] = [];
    for (let i = 0; i < 64; i++) {
      templates.push(`Template: Exact${i}`);
      if (i < 63) templates.push(`  Exact${i + 1}:`);
    }
    const result = checked(lines(
      ...templates,
      "Template: Root",
      "  Exact0:",
      ...CARD,
    ));
    expect(result.diagnostics.filter((d) => d.code === "E010")).toEqual([]);
  });

  it("caps active composition calls at 64", () => {
    const templates: string[] = [];
    for (let i = 0; i <= 65; i++) {
      templates.push(`Template: T${i}`);
      if (i < 65) templates.push(`  T${i + 1}:`);
    }
    const result = checked(lines(
      ...templates,
      "Template: Root",
      "  T0:",
      ...CARD,
    ));
    expect(result.diagnostics.filter((d) => d.code === "E010")).toHaveLength(1);
  });

  it("caps composition-only expanded node visits", () => {
    const calls = Array.from({ length: 10_001 }, () => "  Empty:");
    const result = checked(lines(
      "Template: Empty",
      "Template: Root",
      ...calls,
      ...CARD,
    ));
    expect(result.diagnostics.filter((d) => d.code === "E010")).toHaveLength(1);
  });

  it("accepts exactly 10,000 composition-only expanded node visits", () => {
    const calls = Array.from({ length: 10_000 }, () => "  Empty:");
    const result = checked(lines(
      "Template: Empty",
      "Template: Root",
      ...calls,
      ...CARD,
    ));
    expect(result.diagnostics.filter((d) => d.code === "E010")).toEqual([]);
  });
});
