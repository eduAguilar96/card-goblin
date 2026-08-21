import { describe, expect, it } from "vitest";
import type { RectShape, TextShape } from "../model";
import { compileProject } from "../index";

const source = (...lines: string[]): string => `${lines.join("\n")}\n`;

const card = (front = "Root", back?: string): string[] => [
  "Card: C",
  "  sheet: Sh",
  "  size: poker",
  "  x_units: 20",
  "  y_units: auto",
  `  Front: ${front}`,
  ...(back ? [`  Back: ${back}`] : []),
];

describe("bindings, structural conditionals, and template composition", () => {
  it("selects and flattens a nested template without off-card geometry", () => {
    const result = compileProject(
      source(
        "Enum: CardType",
        "  case Armor",
        "  case Spell",
        "Sheet: Sh",
        "  column type: CardType",
        "let accent: #E3D3BA",
        "let equipment: [type] == CardType.Armor",
        "Template: Equipment",
        "  Rectangle:",
        "    x: 1",
        "    y: 0",
        "    width: 2",
        "    height: 2",
        "    color: [accent]",
        "Template: SpellFace",
        "  Rectangle:",
        "    x: 9",
        "    y: 0",
        "    width: 2",
        "    height: 2",
        "    color: blue",
        "Template: Root",
        "  If: [equipment]",
        "    Equipment:",
        "  Else:",
        "    SpellFace:",
        ...card(),
      ),
      { Sh: [{ type: "Armor" }, { type: "Spell" }] },
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const cards = result.model.decks[0].cards;
    expect((cards[0].front[0] as RectShape).x).toBe(1);
    expect((cards[0].front[0] as RectShape).color).toBe("#E3D3BA");
    expect((cards[1].front[0] as RectShape).x).toBe(9);
  });

  it("checks both branches but evaluates data only in the selected branch", () => {
    const result = compileProject(
      source(
        "Sheet: Sh",
        "  column enabled: Number",
        "  column denominator: Number",
        "let dangerous: 10 / [denominator]",
        "Template: Dangerous",
        "  Rectangle:",
        "    x: [dangerous]",
        "    y: 0",
        "    width: 1",
        "    height: 1",
        "    color: red",
        "Template: Root",
        "  If: [enabled] > 0",
        "    Dangerous:",
        "  Else:",
        "    Rectangle:",
        "      x: 0",
        "      y: 0",
        "      width: 1",
        "      height: 1",
        "      color: green",
        ...card(),
      ),
      { Sh: [{ enabled: "0", denominator: "0" }] },
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.dataDiagnostics).toEqual([]);
    expect((result.model.decks[0].cards[0].front[0] as RectShape).color).toBe("green");
  });

  it("memoizes local lets per Repeat iteration activation", () => {
    const result = compileProject(
      source(
        "Sheet: Sh",
        "Template: Root",
        "  Repeat: 3 as i",
        "    let offset: [i] + 1",
        "    Rectangle:",
        "      x: [offset]",
        "      y: 0",
        "      width: 1",
        "      height: 1",
        "      color: black",
        ...card(),
      ),
      { Sh: [{}] },
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.model.decks[0].cards[0].front.map((shape) => (shape as RectShape).x)).toEqual([
      1, 2, 3,
    ]);
  });

  it("uses fresh global caches for Front and Back so [card] divergence is face-specific", () => {
    const result = compileProject(
      source(
        "Sheet: Sh",
        "  column copies: Number",
        "let serial: [card]",
        "Template: Face",
        "  Text:",
        "    x: 0",
        "    y: 0",
        "    size: 1",
        "    text: [serial]",
        ...card("Face", "Face"),
        "  count: [copies]",
      ),
      { Sh: [{ copies: "2" }] },
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const cards = result.model.decks[0].cards;
    expect((cards[0].front[0] as TextShape).text).toBe("1");
    expect((cards[1].front[0] as TextShape).text).toBe("2");
    expect((cards[0].back[0] as TextShape).text).toBe("1");
    expect((cards[1].back[0] as TextShape).text).toBe("2");
    expect(cards[0].front).not.toBe(cards[1].front);
    expect(cards[0].back).not.toBe(cards[1].back);
  });

  it("does not let a called template dynamically capture caller locals", () => {
    const result = compileProject(
      source(
        "Sheet: Sh",
        "Template: Child",
        "  Text:",
        "    x: 0",
        "    y: 0",
        "    size: 1",
        "    text: [private_value]",
        "Template: Root",
        '  let private_value: "caller"',
        "  Child:",
        ...card(),
      ),
      { Sh: [{}] },
    );

    expect(result.diagnostics.some((d) => d.code === "E002" && d.message.includes("private_value")))
      .toBe(true);
  });

  it("passes typed root arguments and explicitly forwards derived caller values", () => {
    const result = compileProject(
      source(
        "Enum: Edition",
        "  case Black",
        "  case White",
        "Sheet: Sh",
        "Template: Swatch",
        "  param fill: Color",
        "  Rectangle:",
        "    x: 0",
        "    y: 0",
        "    width: 1",
        "    height: 1",
        "    color: [fill]",
        "Template: Root",
        "  param edition: Edition",
        "  let derived: if [edition] == Edition.Black then #000000 else #FFFFFF",
        "  Swatch:",
        "    fill: [derived]",
        "Card: C",
        "  sheet: Sh",
        "  size: poker",
        "  x_units: 20",
        "  y_units: auto",
        "  Front: Root",
        "    edition: Edition.Black",
        "  Back: Root",
        "    edition: Edition.White",
      ),
      { Sh: [{}] },
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const instance = result.model.decks[0].cards[0];
    expect((instance.front[0] as RectShape).color).toBe("#000000");
    expect((instance.back[0] as RectShape).color).toBe("#FFFFFF");
  });

  it("reuses one parameterized face across two counted decks with distinct identities", () => {
    const result = compileProject(
      source(
        "Sheet: Sh",
        "  column black_count: Number",
        "  column white_count: Number",
        "Template: SharedFace",
        "  param background: Color",
        "  Rectangle:",
        "    x: 0",
        "    y: 0",
        "    width: full",
        "    height: full",
        "    color: [background]",
        "  Text:",
        "    x: 0",
        "    y: 0",
        "    size: 1",
        '    text: "[deck]|[copy]|[project_card]"',
        "Card: BlackCards",
        "  sheet: Sh",
        "  size: poker",
        "  x_units: 20",
        "  y_units: auto",
        "  count: [black_count]",
        "  Front: SharedFace",
        "    background: #000000",
        "Card: WhiteCards",
        "  sheet: Sh",
        "  size: poker",
        "  x_units: 20",
        "  y_units: auto",
        "  count: [white_count]",
        "  Front: SharedFace",
        "    background: #FFFFFF",
      ),
      { Sh: [{ black_count: "2", white_count: "3" }] },
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.model.decks.map((deck) => deck.cards.length)).toEqual([2, 3]);
    expect(result.model.decks.map((deck) => (deck.cards[0].front[0] as RectShape).color))
      .toEqual(["#000000", "#FFFFFF"]);
    expect(
      result.model.decks.flatMap((deck) =>
        deck.cards.map((instance) => (instance.front[1] as TextShape).text),
      ),
    ).toEqual([
      "BlackCards|1|1",
      "BlackCards|2|2",
      "WhiteCards|1|3",
      "WhiteCards|2|4",
      "WhiteCards|3|5",
    ]);
  });

  it("does not evaluate an unused argument", () => {
    const result = compileProject(
      source(
        "Sheet: Sh",
        "  column denominator: Number",
        "Template: Root",
        "  param unused: Number",
        "  Rectangle:",
        "    x: 0",
        "    y: 0",
        "    width: 1",
        "    height: 1",
        "    color: red",
        "Card: C",
        "  sheet: Sh",
        "  size: poker",
        "  x_units: 20",
        "  y_units: auto",
        "  Front: Root",
        "    unused: 10 / [denominator]",
      ),
      { Sh: [{ denominator: "0" }] },
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.dataDiagnostics).toEqual([]);
    expect(result.model.decks[0].cards[0].front).toHaveLength(1);
  });

  it("keeps lazy arguments bound to the caller Repeat when the callee reuses its name", () => {
    const run = (throughLet: boolean) => compileProject(
      source(
        "Sheet: Sh",
        "Template: Child",
        "  param value: Number",
        "  Repeat: 2 as i",
        "    Text:",
        "      x: 0",
        "      y: 0",
        "      size: 1",
        "      text: [value]",
        "Template: Root",
        "  Repeat: 2 as i",
        ...(throughLet ? ["    let lazy: [i]"] : []),
        "    Child:",
        `      value: ${throughLet ? "[lazy]" : "[i]"}`,
        ...card(),
      ),
      { Sh: [{}] },
    );

    for (const result of [run(false), run(true)]) {
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(result.model.decks[0].cards[0].front.map((shape) => (shape as TextShape).text))
        .toEqual(["0", "0", "1", "1"]);
    }
  });

  it("preserves each caller Repeat through multi-level lazy forwarding", () => {
    const result = compileProject(
      source(
        "Sheet: Sh",
        "Template: Leaf",
        "  param value: Number",
        "  Repeat: 2 as i",
        "    Text:",
        "      x: 0",
        "      y: 0",
        "      size: 1",
        "      text: [value]",
        "Template: Middle",
        "  param value: Number",
        "  Repeat: 2 as i",
        "    Leaf:",
        "      value: [value]",
        "Template: Root",
        "  Repeat: 2 as i",
        "    Middle:",
        "      value: [i]",
        ...card(),
      ),
      { Sh: [{}] },
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.model.decks[0].cards[0].front.map((shape) => (shape as TextShape).text))
      .toEqual(["0", "0", "0", "0", "1", "1", "1", "1"]);
  });

  it("reports a template cycle without throwing or recursing during generation", () => {
    const result = compileProject(
      source(
        "Sheet: Sh",
        "Template: A",
        "  B:",
        "Template: B",
        "  A:",
        ...card("A"),
      ),
      { Sh: [{}] },
    );

    expect(result.diagnostics.some((d) => d.code === "E009")).toBe(true);
    expect(result.model.decks[0].cards[0].error?.diagnostics[0].code).toBe("D000");
  });
});
