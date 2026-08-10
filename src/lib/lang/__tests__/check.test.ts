/**
 * Checker semantics (DESIGN.md §3.2–§3.8): binding, expected-type resolution,
 * typing, per-using-Card template checks, and the E002–E008 / W001–W004
 * diagnostics catalog. E001 (syntax) is covered by the parser suites.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DataRef, ElementNode, Program, RepeatNode, TemplateDecl } from "../ast";
import type { CheckResult } from "../check";
import { check } from "../check";
import { compileSource, ICON_STYLES, IMAGE_FITS } from "../index";
import type { Diagnostic } from "../diagnostics";
import { parse } from "../parser";

const demoSource = readFileSync(
  fileURLToPath(new URL("./fixtures/demo.goblin", import.meta.url)),
  "utf8",
);

// -- helpers ----------------------------------------------------------------

const src = (...lines: string[]): string => lines.join("\n") + "\n";

/** Parse (asserting E001-free) then check. */
function checkOf(source: string): CheckResult & { program: Program } {
  const { program, diagnostics } = parse(source);
  expect(diagnostics).toEqual([]);
  return { program, ...check(program) };
}

function diagsOf(source: string): Diagnostic[] {
  return checkOf(source).diagnostics;
}

/** Sorted diagnostic codes — order-independent assertion target. */
function codesOf(source: string): string[] {
  return diagsOf(source)
    .map((d) => d.code)
    .sort();
}

const PRELUDE = [
  "Enum: Suit",
  "  case Rock",
  "  case Paper",
  "Sheet: Monsters",
  "  column name: Text",
  "  column cost: Number",
  "  column suit: Suit",
];

const RECT_TEMPLATE = [
  "Template: T",
  "  Rectangle:",
  "    x: 0",
  "    y: 0",
  "    width: full",
  "    height: full",
  "    color: teal",
];

const CARD_ITEMS = ["sheet: Monsters", "size: poker", "x_units: 20", "y_units: auto", "Front: T"];

/** Prelude + one element in Template T + a valid Card using it. */
function withElement(header: string, props: string[]): string {
  return src(
    ...PRELUDE,
    "Template: T",
    `  ${header}`,
    ...props.map((p) => `    ${p}`),
    "Card: C",
    ...CARD_ITEMS.map((i) => `  ${i}`),
  );
}

/** Prelude + a refless template + a Card with the given items. */
function withCard(items: string[]): string {
  return src(...PRELUDE, ...RECT_TEMPLATE, "Card: C", ...items.map((i) => `  ${i}`));
}

const TEXT_BASE = ["x: 1", "y: 1", "size: 1"];

// -- the acceptance fixture -------------------------------------------------

describe("demo fixture (§3.9)", () => {
  it("parse + check produce ZERO diagnostics combined", () => {
    const { diagnostics } = compileSource(demoSource);
    expect(diagnostics).toEqual([]);
  });

  it("binds the Card completely for the evaluator", () => {
    const { bindings } = compileSource(demoSource);
    expect(bindings.cards).toHaveLength(1);
    const card = bindings.cards[0];
    expect(card.decl.name.name).toBe("Monster");
    expect(card.sheet?.decl.name.name).toBe("Monsters");
    expect(card.sheet?.columns.get("health")?.type).toEqual({ kind: "Number" });
    expect(card.sheet?.columns.get("name")?.type).toEqual({ kind: "Text" });
    expect(card.size).toEqual({ name: "poker", widthMm: 63.5, heightMm: 88.9 });
    expect(card.xUnits).toBe(20);
    expect(card.yUnits).toBe("auto");
    expect(card.loops).toHaveLength(1);
    expect(card.loops[0].variable).toBe("current_suit");
    expect(card.loops[0].enumDecl?.name.name).toBe("Suit");
    expect(card.countExpr?.kind).toBe("Ref");
    expect(card.front?.name.name).toBe("MonsterFront");
    expect(card.back?.name.name).toBe("PlainBack");
    const front = bindings.templates.get("MonsterFront");
    expect(front).toBeDefined();
    expect(bindings.templateUsage.get(front as TemplateDecl)).toEqual([card.decl]);
  });

  it("records resolutions + types for template expressions in the Card's context", () => {
    const { bindings } = compileSource(demoSource);
    const card = bindings.cards[0];
    const front = bindings.templates.get("MonsterFront") as TemplateDecl;
    const back = bindings.templates.get("PlainBack") as TemplateDecl;

    // `width: full` in PlainBack → geometry keyword, Number.
    const backRect = back.children[0] as ElementNode;
    const width = backRect.properties.find((p) => p.key.name === "width")!.value;
    expect(card.resolutions.get(width as never)).toEqual({ kind: "geometry", keyword: "full" });
    expect(card.exprTypes.get(width)).toEqual({ kind: "Number" });

    // Repeat icon: `color: red` → colorName; `[i]` → repeatVar; `[health]` → column.
    const repeat = front.children[4] as RepeatNode;
    expect(card.resolutions.get(repeat.count as DataRef)).toEqual({
      kind: "column",
      sheet: "Monsters",
      column: "health",
      type: { kind: "Number" },
    });
    const icon = repeat.children[0] as ElementNode;
    const color = icon.properties.find((p) => p.key.name === "color")!.value;
    expect(card.resolutions.get(color as never)).toEqual({ kind: "colorName", name: "red" });
    const x = icon.properties.find((p) => p.key.name === "x")!.value;
    expect(x.kind).toBe("Binary");
    if (x.kind !== "Binary" || x.right.kind !== "Binary") throw new Error("shape");
    expect(card.resolutions.get(x.right.left as DataRef)).toEqual({ kind: "repeatVar" });

    // `Suit.Rock` in the banner's if-condition → enumCase.
    const banner = front.children[0] as ElementNode;
    const bannerColor = banner.properties.find((p) => p.key.name === "color")!.value;
    if (bannerColor.kind !== "If" || bannerColor.condition.kind !== "Binary") {
      throw new Error("shape");
    }
    expect(card.resolutions.get(bannerColor.condition.right as never)).toEqual({
      kind: "enumCase",
      enumName: "Suit",
      caseName: "Rock",
    });
  });
});

// -- E002: unknown references ----------------------------------------------

describe("E002 unknown reference", () => {
  it("unknown sheet name", () => {
    const source = withCard(["sheet: Nope", ...CARD_ITEMS.slice(1)]);
    const ds = diagsOf(source);
    // W002: Monsters is declared by the prelude but no longer bound.
    expect(ds.map((d) => d.code).sort()).toEqual(["E002", "W002"]);
    expect(ds.find((d) => d.code === "E002")?.message).toContain("Unknown sheet 'Nope'");
  });

  it("sheet: naming an Enum is a wrong-kind E002", () => {
    const source = withCard(["sheet: Suit", ...CARD_ITEMS.slice(1)]);
    const e = diagsOf(source).find((d) => d.code === "E002");
    expect(e?.message).toBe("'Suit' is an Enum, not a Sheet");
  });

  it("unknown template in Front:", () => {
    const source = withCard([...CARD_ITEMS.slice(0, 4), "Front: Nope"]);
    const ds = diagsOf(source);
    expect(ds.map((d) => d.code).sort()).toEqual(["E002", "W002"]); // T now unused
    expect(ds.find((d) => d.code === "E002")?.message).toContain("Unknown template 'Nope'");
  });

  it("unknown enum in loop:", () => {
    expect(codesOf(withCard([...CARD_ITEMS, "loop: Nope as v"]))).toEqual(["E002"]);
  });

  it("unknown column type", () => {
    const source = src(
      "Sheet: S",
      "  column a: Bogus",
      ...RECT_TEMPLATE,
      "Card: C",
      "  sheet: S",
      ...CARD_ITEMS.slice(1).map((i) => `  ${i}`),
    );
    const ds = diagsOf(source);
    expect(ds.map((d) => d.code)).toEqual(["E002"]);
    expect(ds[0].message).toContain("Unknown column type 'Bogus'");
  });

  it("unknown [ref] in a template checked in a Card's context", () => {
    const ds = diagsOf(withElement("Text:", [...TEXT_BASE, "text: [bogus]"]));
    expect(ds.map((d) => d.code)).toEqual(["E002"]);
    expect(ds[0].message).toBe("Unknown reference [bogus]");
  });

  it("qualified name: unknown enum and unknown case", () => {
    const unknownEnum = diagsOf(withElement("Text:", [...TEXT_BASE, "text: Bogus.Rock"]));
    expect(unknownEnum.map((d) => d.code)).toEqual(["E002"]);
    expect(unknownEnum[0].message).toContain("Unknown enum 'Bogus'");

    const unknownCase = diagsOf(withElement("Text:", [...TEXT_BASE, "text: Suit.Bogus"]));
    expect(unknownCase.map((d) => d.code)).toEqual(["E002"]);
    expect(unknownCase[0].message).toBe("'Bogus' is not a case of enum Suit");
  });

  it("unknown color name in a Color position", () => {
    const ds = diagsOf(
      withElement("Rectangle:", ["x: 0", "y: 0", "width: 1", "height: 1", "color: blurple"]),
    );
    expect(ds.map((d) => d.code)).toEqual(["E002"]);
    expect(ds[0].message).toBe("Unknown color name 'blurple'");
  });

  it("negative: known refs, colors, templates, sheets produce no E002", () => {
    expect(codesOf(withElement("Text:", [...TEXT_BASE, "color: red", "text: [name]"]))).toEqual([]);
  });
});

// -- E003: type mismatches --------------------------------------------------

describe("E003 type mismatch", () => {
  it("text: [cost] is legal — Number coerces to Text (◆†)", () => {
    expect(codesOf(withElement("Text:", [...TEXT_BASE, "text: [cost]"]))).toEqual([]);
  });

  it("a Bool-typed expression in a Text position does not coerce", () => {
    const ds = diagsOf(withElement("Text:", [...TEXT_BASE, "text: [cost] > 3"]));
    expect(ds.map((d) => d.code)).toEqual(["E003"]);
    expect(ds[0].message).toContain("Bool cannot be used as Text");
  });

  it("arithmetic requires Number operands", () => {
    const ds = diagsOf(withElement("Text:", ["x: 1 + [name]", ...TEXT_BASE.slice(1), 'text: "a"']));
    expect(ds.map((d) => d.code)).toEqual(["E003"]);
    expect(ds[0].message).toBe("Type mismatch: expected Number, got Text");
  });

  it("== requires both sides the same type", () => {
    const ds = diagsOf(
      withElement("Text:", [...TEXT_BASE, 'text: if [cost] == [name] then "a" else "b"']),
    );
    expect(ds.map((d) => d.code)).toEqual(["E003"]);
    expect(ds[0].message).toBe("Cannot compare Number with Text");
  });

  it("Bool and Color values cannot be compared", () => {
    const bool = diagsOf(
      withElement("Text:", [...TEXT_BASE, 'text: if ([cost] > 1) == ([cost] > 2) then "a" else "b"']),
    );
    expect(bool.map((d) => d.code)).toEqual(["E003"]);
    expect(bool[0].message).toContain("Bool values cannot be compared");

    const color = diagsOf(
      withElement("Text:", [...TEXT_BASE, 'text: if #112233 == #445566 then "a" else "b"']),
    );
    expect(color.map((d) => d.code)).toEqual(["E003"]);
    expect(color[0].message).toContain("Color values cannot be compared");
  });

  it("if branches must agree; result is the branch type", () => {
    const ds = diagsOf(withElement("Text:", ['x: if [cost] > 1 then 2 else "two"', ...TEXT_BASE.slice(1), 'text: "a"']));
    expect(ds.map((d) => d.code)).toEqual(["E003"]);
    expect(ds[0].message).toContain("Both branches");
  });

  it("if condition must be Bool", () => {
    const ds = diagsOf(withElement("Text:", ["x: if [cost] then 1 else 2", ...TEXT_BASE.slice(1), 'text: "a"']));
    expect(ds.map((d) => d.code)).toEqual(["E003"]);
    expect(ds[0].message).toBe("Type mismatch: expected Bool, got Number");
  });

  it("negative: comparisons, arithmetic, and coercions that fit are clean", () => {
    expect(
      codesOf(
        withElement("Text:", [
          "x: 1 + [cost] * 2",
          "y: half",
          "size: 1",
          'text: if [cost] >= 2 and not ([cost] == 3) then "big" else [name]',
        ]),
      ),
    ).toEqual([]);
  });
});

// -- E004: ambiguous bare enum case ----------------------------------------

describe("E004 ambiguous bare case", () => {
  const twoEnums = [
    "Enum: A",
    "  case Rock",
    "Enum: B",
    "  case Rock",
    "Sheet: S",
    "  column a: A",
    "  column b: B",
  ];

  it("a bare case shared by two enums, with no expected type, is E004", () => {
    const source = src(
      ...twoEnums,
      "Template: T",
      "  Text:",
      ...TEXT_BASE.map((p) => `    ${p}`),
      "    text: Rock",
      "Card: C",
      "  sheet: S",
      ...CARD_ITEMS.slice(1).map((i) => `  ${i}`),
    );
    const ds = diagsOf(source);
    expect(ds.map((d) => d.code)).toEqual(["E004"]);
    expect(ds[0].message).toContain("A.Rock or B.Rock");
  });

  it("negative: a globally-unique bare case resolves (and marks the enum used)", () => {
    const source = src(
      "Enum: A",
      "  case Rock",
      "Sheet: S",
      "  column name: Text",
      "Template: T",
      "  Text:",
      ...TEXT_BASE.map((p) => `    ${p}`),
      "    text: Rock",
      "Card: C",
      "  sheet: S",
      ...CARD_ITEMS.slice(1).map((i) => `  ${i}`),
    );
    const result = checkOf(source);
    expect(result.diagnostics).toEqual([]); // incl. no W002 for A
    const tpl = result.bindings.templates.get("T") as TemplateDecl;
    const text = (tpl.children[0] as ElementNode).properties.find((p) => p.key.name === "text")!;
    expect(result.bindings.cards[0].resolutions.get(text.value as never)).toEqual({
      kind: "enumCase",
      enumName: "A",
      caseName: "Rock",
    });
  });

  it("expected type from a comparison disambiguates what E004 would reject", () => {
    const source = src(
      ...twoEnums,
      "Template: T",
      "  Text:",
      ...TEXT_BASE.map((p) => `    ${p}`),
      '    text: if [a] == Rock then "a" else "b"',
      "Card: C",
      "  sheet: S",
      ...CARD_ITEMS.slice(1).map((i) => `  ${i}`),
    );
    expect(diagsOf(source)).toEqual([]);
  });
});

// -- E005: duplicates -------------------------------------------------------

describe("E005 duplicate declaration", () => {
  it("all declared names share ONE global namespace", () => {
    const ds = diagsOf(src("Enum: X", "  case A", "Sheet: X"));
    expect(ds.map((d) => d.code).sort()).toEqual(["E005", "W002"]); // W002: enum X unused
    const e = ds.find((d) => d.code === "E005")!;
    expect(e.message).toContain("already declared as an Enum");
    expect(e.range.startLine).toBe(2); // at the second declaration's name
  });

  it("duplicate column in a Sheet", () => {
    const source = src(
      "Sheet: S",
      "  column a: Text",
      "  column a: Number",
      ...RECT_TEMPLATE,
      "Card: C",
      "  sheet: S",
      ...CARD_ITEMS.slice(1).map((i) => `  ${i}`),
    );
    expect(codesOf(source)).toEqual(["E005"]);
  });

  it("duplicate case in an Enum", () => {
    const source = src(
      "Enum: E",
      "  case A",
      "  case A",
      "Sheet: S",
      "  column e: E",
      ...RECT_TEMPLATE,
      "Card: C",
      "  sheet: S",
      ...CARD_ITEMS.slice(1).map((i) => `  ${i}`),
    );
    expect(codesOf(source)).toEqual(["E005"]);
  });

  it("duplicate loop variable in a Card", () => {
    expect(codesOf(withCard([...CARD_ITEMS, "loop: Suit as v", "loop: Suit as v"]))).toEqual([
      "E005",
    ]);
  });

  it("multiple loops with distinct variables are legal (◆25)", () => {
    expect(codesOf(withCard([...CARD_ITEMS, "loop: Suit as a", "loop: Suit as b"]))).toEqual([]);
  });

  it("duplicate property key on a Card and on an element", () => {
    expect(codesOf(withCard([...CARD_ITEMS, "size: tarot"]))).toEqual(["E005"]);
    expect(
      codesOf(
        withElement("Rectangle:", ["x: 0", "x: 1", "y: 0", "width: 1", "height: 1", "color: teal"]),
      ),
    ).toEqual(["E005"]);
  });

  it("duplicate Front: face", () => {
    expect(codesOf(withCard([...CARD_ITEMS, "Front: T"]))).toEqual(["E005"]);
  });
});

// -- E007: keyword in invalid position -------------------------------------

describe("E007 keyword misuse", () => {
  it("'as' is only allowed on loop:", () => {
    expect(codesOf(withCard([...CARD_ITEMS, "count: 1 as v"]))).toEqual(["E007"]);
    expect(
      codesOf(withElement("Text:", ["x: 1 as v", ...TEXT_BASE.slice(1), 'text: "a"'])),
    ).toEqual(["E007"]);
  });

  it("middle must be the ENTIRE x: value — middle + 1 is E007", () => {
    const ds = diagsOf(
      withElement("Text:", ["x: middle + 1", ...TEXT_BASE.slice(1), 'text: "a"']),
    );
    expect(ds.map((d) => d.code)).toEqual(["E007"]);
    expect(ds[0].message).toContain("entire x: value");
  });

  it("y: middle is E007 (m3 — middle is x-only)", () => {
    expect(
      codesOf(withElement("Text:", ["x: 1", "y: middle", "size: 1", 'text: "a"'])),
    ).toEqual(["E007"]);
  });

  it("x: middle on Text/Icon is legal and recorded as geometry", () => {
    const result = checkOf(withElement("Text:", ["x: middle", ...TEXT_BASE.slice(1), 'text: "a"']));
    expect(result.diagnostics).toEqual([]);
    const tpl = result.bindings.templates.get("T") as TemplateDecl;
    const x = (tpl.children[0] as ElementNode).properties.find((p) => p.key.name === "x")!;
    expect(result.bindings.cards[0].resolutions.get(x.value as never)).toEqual({
      kind: "geometry",
      keyword: "middle",
    });
  });

  it("x: middle on Rectangle is E007 (§3.4: Text/Icon only)", () => {
    expect(
      codesOf(withElement("Rectangle:", ["x: middle", "y: 0", "width: 1", "height: 1", "color: teal"])),
    ).toEqual(["E007"]);
  });

  it("full/half are only valid in element geometry positions", () => {
    expect(codesOf(withCard([...CARD_ITEMS, "count: full"]))).toEqual(["E007"]);
    expect(
      codesOf(withElement("Text:", [...TEXT_BASE, "text: full"])),
    ).toEqual(["E007"]);
  });

  it("negative: full/half as geometry subexpressions are legal", () => {
    expect(
      codesOf(withElement("Text:", ["x: half + 1", "y: full - 2", "size: half", 'text: "a"'])),
    ).toEqual([]);
  });
});

// -- E008: missing/invalid required properties ------------------------------

describe("E008 required properties", () => {
  it("a Card missing sheet/size/x_units/y_units reports one E008 each", () => {
    const source = src(...RECT_TEMPLATE, "Card: C", "  Front: T");
    const ds = checkOf(source).diagnostics;
    expect(ds.map((d) => d.code)).toEqual(["E008", "E008", "E008", "E008"]);
    const missing = ds.map((d) => d.message);
    for (const key of ["sheet:", "size:", "x_units:", "y_units:"]) {
      expect(missing.some((m) => m.includes(`'${key}'`))).toBe(true);
    }
  });

  it("a Card missing Front:", () => {
    const ds = diagsOf(withCard(CARD_ITEMS.slice(0, 4)));
    expect(ds.map((d) => d.code).sort()).toEqual(["E008", "W002"]); // T unused too
    expect(ds.find((d) => d.code === "E008")?.message).toContain("'Front:'");
  });

  it("size must be one of the five presets", () => {
    const ds = diagsOf(withCard(["sheet: Monsters", "size: jumbo", ...CARD_ITEMS.slice(2)]));
    expect(ds.map((d) => d.code)).toEqual(["E008"]);
    expect(ds[0].message).toContain("Unknown size preset 'jumbo'");
    expect(codesOf(withCard(["sheet: Monsters", "size: 5", ...CARD_ITEMS.slice(2)]))).toEqual([
      "E008",
    ]);
  });

  it("x_units must be a positive integer literal", () => {
    for (const bad of ["x_units: 20.5", "x_units: 0", "x_units: [cost]", "x_units: 10 + 10"]) {
      expect(
        codesOf(withCard(["sheet: Monsters", "size: poker", bad, ...CARD_ITEMS.slice(3)])),
        bad,
      ).toEqual(["E008"]);
    }
  });

  it("y_units must be auto or a positive integer literal", () => {
    for (const bad of ["y_units: 2.5", "y_units: fullish", "y_units: 0"]) {
      expect(
        codesOf(withCard([...CARD_ITEMS.slice(0, 3), bad, "Front: T"])),
        bad,
      ).toEqual(["E008"]);
    }
  });

  it("count: accepts any Number expression (not just literals)", () => {
    expect(codesOf(withCard([...CARD_ITEMS, "count: [cost] * 2 + 1"]))).toEqual([]);
  });

  it("unknown property keys on Card and elements", () => {
    const card = diagsOf(withCard([...CARD_ITEMS, "foo: 1"]));
    expect(card.map((d) => d.code)).toEqual(["E008"]);
    expect(card[0].message).toBe("Unknown property 'foo:' on Card");

    // anchor exists on Text/Icon but NOT on Rectangle (§3.3).
    expect(
      codesOf(
        withElement("Rectangle:", ["x: 0", "y: 0", "width: 1", "height: 1", "color: teal", "anchor: left"]),
      ),
    ).toEqual(["E008"]);
  });

  it("elements report their missing required properties", () => {
    const noText = diagsOf(withElement("Text:", TEXT_BASE));
    expect(noText.map((d) => d.code)).toEqual(["E008"]);
    expect(noText[0].message).toBe("Text is missing required property 'text:'");

    const noColor = diagsOf(withElement("Rectangle:", ["x: 0", "y: 0", "width: 1", "height: 1"]));
    expect(noColor.map((d) => d.code)).toEqual(["E008"]);
    expect(noColor[0].message).toContain("'color:'");
  });

  it("anchor must be left, middle, or right", () => {
    expect(codesOf(withElement("Text:", [...TEXT_BASE, 'text: "a"', "anchor: up"]))).toEqual([
      "E008",
    ]);
    expect(codesOf(withElement("Text:", [...TEXT_BASE, 'text: "a"', 'anchor: "left"']))).toEqual([
      "E008",
    ]);
    expect(codesOf(withElement("Text:", [...TEXT_BASE, 'text: "a"', "anchor: right"]))).toEqual([]);
  });

  it("loop: requires an 'as <variable>' clause", () => {
    const ds = diagsOf(withCard([...CARD_ITEMS, "loop: Suit"]));
    expect(ds.map((d) => d.code)).toEqual(["E008"]);
    expect(ds[0].message).toContain("as <variable>");
  });
});

// -- Icon style: (§3.3, M2) --------------------------------------------------

describe("Icon style: (§3.3 M2)", () => {
  const ICON_BASE = ["x: 1", "y: 1", "size: 1", 'code: "HEARTS"'];

  it("accepts every one of the ten faces and records an iconStyle resolution", () => {
    for (const style of ICON_STYLES) {
      const result = checkOf(withElement("Icon:", [...ICON_BASE, `style: ${style}`]));
      expect(result.diagnostics, style).toEqual([]);
      const tpl = result.bindings.templates.get("T") as TemplateDecl;
      const prop = (tpl.children[0] as ElementNode).properties.find(
        (p) => p.key.name === "style",
      )!;
      expect(result.bindings.cards[0].resolutions.get(prop.value as never)).toEqual({
        kind: "iconStyle",
        style,
      });
    }
  });

  it("omitting style: is legal — the default is the evaluator's business", () => {
    expect(codesOf(withElement("Icon:", ICON_BASE))).toEqual([]);
  });

  it("an unknown style is E008 naming the closed vocabulary", () => {
    const ds = diagsOf(withElement("Icon:", [...ICON_BASE, "style: shiny"]));
    expect(ds.map((d) => d.code)).toEqual(["E008"]);
    expect(ds[0].message).toContain("style: must be one of flat_dark");
  });

  it("style must be a bare identifier — strings and expressions are E008", () => {
    for (const bad of ['style: "flat_dark"', "style: 1", "style: 1 + 1"]) {
      expect(codesOf(withElement("Icon:", [...ICON_BASE, bad])), bad).toEqual(["E008"]);
    }
  });

  it("style on Text or Rectangle is an unknown property (Icon only, §3.3)", () => {
    const ds = diagsOf(withElement("Text:", [...TEXT_BASE, 'text: "a"', "style: pixel"]));
    expect(ds.map((d) => d.code)).toEqual(["E008"]);
    expect(ds[0].message).toBe("Unknown property 'style:' on Text");
  });
});

// -- Image (§3.3, M2) --------------------------------------------------------

describe("Image (§3.3 M2)", () => {
  const IMAGE_BASE = [
    "x: 1",
    "y: 1",
    "width: 5",
    "height: 5",
    'src: "https://example.com/a.png"',
  ];

  it("accepts the full property set and records an imageFit resolution per fit", () => {
    for (const fit of IMAGE_FITS) {
      const result = checkOf(withElement("Image:", [...IMAGE_BASE, `fit: ${fit}`]));
      expect(result.diagnostics, fit).toEqual([]);
      const tpl = result.bindings.templates.get("T") as TemplateDecl;
      const prop = (tpl.children[0] as ElementNode).properties.find(
        (p) => p.key.name === "fit",
      )!;
      expect(result.bindings.cards[0].resolutions.get(prop.value as never)).toEqual({
        kind: "imageFit",
        fit,
      });
    }
  });

  it("omitting fit: is legal — the default is the evaluator's business", () => {
    expect(codesOf(withElement("Image:", IMAGE_BASE))).toEqual([]);
  });

  it("required-property matrix: dropping any one of x/y/width/height/src is E008", () => {
    for (let i = 0; i < IMAGE_BASE.length; i++) {
      const key = IMAGE_BASE[i].split(":")[0];
      const ds = diagsOf(withElement("Image:", IMAGE_BASE.filter((_, j) => j !== i)));
      expect(ds.map((d) => d.code), key).toEqual(["E008"]);
      expect(ds[0].message).toBe(`Image is missing required property '${key}:'`);
    }
  });

  it("an unknown fit is E008 naming the closed vocabulary", () => {
    const ds = diagsOf(withElement("Image:", [...IMAGE_BASE, "fit: zoom"]));
    expect(ds.map((d) => d.code)).toEqual(["E008"]);
    expect(ds[0].message).toBe("fit: must be one of contain, cover, stretch");
  });

  it("fit must be a bare identifier — strings and expressions are E008", () => {
    for (const bad of ['fit: "contain"', "fit: 1", "fit: 1 + 1"]) {
      expect(codesOf(withElement("Image:", [...IMAGE_BASE, bad])), bad).toEqual(["E008"]);
    }
  });

  it("fit on Text or Rectangle is an unknown property (Image only, §3.3)", () => {
    const ds = diagsOf(withElement("Text:", [...TEXT_BASE, 'text: "a"', "fit: cover"]));
    expect(ds.map((d) => d.code)).toEqual(["E008"]);
    expect(ds[0].message).toBe("Unknown property 'fit:' on Text");
  });

  it("src is Text-typed with the §3.5 coercions: columns, Numbers, enums, interpolation", () => {
    const head = IMAGE_BASE.slice(0, 4);
    expect(codesOf(withElement("Image:", [...head, "src: [name]"]))).toEqual([]);
    expect(codesOf(withElement("Image:", [...head, "src: [cost]"]))).toEqual([]);
    expect(codesOf(withElement("Image:", [...head, "src: [suit]"]))).toEqual([]);
    expect(
      codesOf(withElement("Image:", [...head, 'src: "img/[name]-[cost].png"'])),
    ).toEqual([]);
  });

  it("a Color or Bool src is E003 (the non-coercing kinds)", () => {
    const head = IMAGE_BASE.slice(0, 4);
    expect(codesOf(withElement("Image:", [...head, "src: #ff0000"]))).toEqual(["E003"]);
    expect(codesOf(withElement("Image:", [...head, "src: 1 == 2"]))).toEqual(["E003"]);
  });

  it("geometry keywords resolve in Image geometry positions", () => {
    expect(
      codesOf(
        withElement("Image:", ["x: 0", "y: 0", "width: full", "height: half", 'src: "u"']),
      ),
    ).toEqual([]);
  });

  it("x: middle is E007 on Image — the §3.4 sugar is Text/Icon only", () => {
    const ds = diagsOf(
      withElement("Image:", ["x: middle", "y: 1", "width: 5", "height: 5", 'src: "u"']),
    );
    expect(ds.map((d) => d.code)).toEqual(["E007"]);
    expect(ds[0].message).toContain("Text or Icon");
  });

  it("Image inside Repeat sees the repeat variable", () => {
    const source = src(
      ...PRELUDE,
      "Template: T",
      "  Repeat: [cost] as i",
      "    Image:",
      "      x: [i] * 2",
      "      y: 0",
      "      width: 1",
      "      height: 1",
      '      src: "img/[i].png"',
      "Card: C",
      ...CARD_ITEMS.map((i) => `  ${i}`),
    );
    expect(diagsOf(source)).toEqual([]);
  });

  it("templates with an Image are checked per using Card (§3.6): a src ref must resolve in each context", () => {
    const source = src(
      "Sheet: A",
      "  column art: Text",
      "Sheet: B",
      "  column other: Text",
      "Template: T",
      "  Image:",
      "    x: 0",
      "    y: 0",
      "    width: 5",
      "    height: 5",
      "    src: [art]",
      "Card: CA",
      "  sheet: A",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: T",
      "Card: CB",
      "  sheet: B",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: T",
    );
    // CA's context resolves [art]; CB's does not — one E002 (context-free
    // message, deduped across using Cards at the template's range).
    const ds = diagsOf(source);
    expect(ds.map((d) => d.code)).toEqual(["E002"]);
    expect(ds[0].message).toBe("Unknown reference [art]");
  });
});

// -- custom card sizes (§3.4, M2) --------------------------------------------

describe("custom card sizes (§3.4 M2)", () => {
  const REST = ["x_units: 20", "y_units: auto", "Front: T"];

  it("a width_mm/height_mm pair replaces size: and binds a 'custom' size", () => {
    const result = checkOf(
      withCard(["sheet: Monsters", "width_mm: 40", "height_mm: 61.5", ...REST]),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.cards[0].size).toEqual({
      name: "custom",
      widthMm: 40,
      heightMm: 61.5,
    });
  });

  it("values below 0.01mm or finer than hundredths are E008 (never-NaN guard)", () => {
    // Sub-hundredth sizes would make generate.ts's integer mm-hundredths math
    // produce NaN/Infinity or silently non-square auto units (§3.4).
    for (const pair of [
      ["width_mm: 0.001", "height_mm: 40"],
      ["width_mm: 40", "height_mm: 0.004"],
      ["width_mm: 0.154", "height_mm: 40"],
    ]) {
      const codes = codesOf(withCard(["sheet: Monsters", ...pair, ...REST]));
      expect(codes).toContain("E008");
    }
    // The floor itself is legal, as are ordinary two-decimal values.
    expect(
      diagsOf(withCard(["sheet: Monsters", "width_mm: 0.01", "height_mm: 0.01", ...REST])),
    ).toEqual([]);
    expect(
      diagsOf(withCard(["sheet: Monsters", "width_mm: 57.15", "height_mm: 88.9", ...REST])),
    ).toEqual([]);
  });

  it("giving only one of the pair is E008 naming the missing half", () => {
    const noHeight = diagsOf(withCard(["sheet: Monsters", "width_mm: 40", ...REST]));
    expect(noHeight.map((d) => d.code)).toEqual(["E008"]);
    expect(noHeight[0].message).toContain("'height_mm:' is missing");

    const noWidth = diagsOf(withCard(["sheet: Monsters", "height_mm: 40", ...REST]));
    expect(noWidth.map((d) => d.code)).toEqual(["E008"]);
    expect(noWidth[0].message).toContain("'width_mm:' is missing");
  });

  it("combining the pair (or half of it) with size: is E008, and poisons size", () => {
    const source = withCard([
      "sheet: Monsters",
      "size: poker",
      "width_mm: 40",
      "height_mm: 40",
      ...REST,
    ]);
    const result = checkOf(source);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["E008"]);
    expect(result.diagnostics[0].message).toContain("not both");
    // No deterministic winner exists — the card binds NO size (no deck).
    expect(result.bindings.cards[0].size).toBeNull();

    expect(
      codesOf(withCard(["sheet: Monsters", "size: poker", "width_mm: 40", ...REST])),
    ).toEqual(["E008"]);
  });

  it("values must be positive number literals", () => {
    for (const bad of [
      "width_mm: 0",
      "width_mm: -40",
      "width_mm: [cost]",
      "width_mm: 40 + 1",
      'width_mm: "40"',
    ]) {
      expect(
        codesOf(withCard(["sheet: Monsters", bad, "height_mm: 40", ...REST])),
        bad,
      ).toEqual(["E008"]);
    }
  });

  it("decimals are legal — the pair is exact millimetres like the presets", () => {
    expect(
      codesOf(withCard(["sheet: Monsters", "width_mm: 57.15", "height_mm: 88.9", ...REST])),
    ).toEqual([]);
  });

  it("neither size: nor the pair → the plain missing-size E008", () => {
    const ds = diagsOf(withCard(["sheet: Monsters", ...REST]));
    expect(ds.map((d) => d.code)).toEqual(["E008"]);
    expect(ds[0].message).toContain("'size:'");
  });

  it("W003 squareness math runs against the custom pair too", () => {
    // 40×60 @ x_units 20 → the exact square value is 30; 31 stretches.
    expect(
      codesOf(
        withCard(["sheet: Monsters", "width_mm: 40", "height_mm: 60", "x_units: 20", "y_units: 30", "Front: T"]),
      ),
    ).toEqual([]);
    expect(
      codesOf(
        withCard(["sheet: Monsters", "width_mm: 40", "height_mm: 60", "x_units: 20", "y_units: 31", "Front: T"]),
      ),
    ).toEqual(["W003"]);
  });
});

// -- W001: shadowing --------------------------------------------------------

describe("W001 shadowed binding", () => {
  it("a loop variable shadowing a sheet column warns at the declaration site", () => {
    const ds = diagsOf(withCard([...CARD_ITEMS, "loop: Suit as suit"]));
    expect(ds.map((d) => d.code)).toEqual(["W001"]);
    expect(ds[0].message).toContain("shadows column 'suit'");
  });

  it("a Repeat variable shadowing a column / loop var / outer Repeat var", () => {
    const column = diagsOf(
      src(
        ...PRELUDE,
        "Template: T",
        "  Repeat: 3 as name",
        "    Icon:",
        "      x: 1",
        "      y: 1",
        "      size: 1",
        '      code: "HEARTS"',
        "Card: C",
        ...CARD_ITEMS.map((i) => `  ${i}`),
      ),
    );
    expect(column.map((d) => d.code)).toEqual(["W001"]);
    expect(column[0].message).toContain("shadows column 'name'");

    const loopVar = diagsOf(
      src(
        ...PRELUDE,
        "Template: T",
        "  Repeat: 3 as s",
        "    Icon:",
        "      x: 1",
        "      y: 1",
        "      size: 1",
        '      code: "HEARTS"',
        "Card: C",
        ...CARD_ITEMS.map((i) => `  ${i}`),
        "  loop: Suit as s",
      ),
    );
    expect(loopVar.map((d) => d.code)).toEqual(["W001"]);
    expect(loopVar[0].message).toContain("a loop variable");

    const nested = diagsOf(
      src(
        ...PRELUDE,
        "Template: T",
        "  Repeat: 2 as i",
        "    Repeat: 2 as i",
        "      Icon:",
        "        x: [i]",
        "        y: 1",
        "        size: 1",
        '        code: "HEARTS"',
        "Card: C",
        ...CARD_ITEMS.map((i) => `  ${i}`),
      ),
    );
    expect(nested.map((d) => d.code)).toEqual(["W001"]);
    expect(nested[0].message).toContain("an enclosing Repeat variable");
  });

  it("negative: distinct variable names do not warn", () => {
    expect(codesOf(withCard([...CARD_ITEMS, "loop: Suit as current_suit"]))).toEqual([]);
  });
});

// -- W002: unused declarations ---------------------------------------------

describe("W002 unused declaration", () => {
  it("an unreferenced Enum and an unbound Sheet warn", () => {
    expect(codesOf(src("Enum: X", "  case A"))).toEqual(["W002"]);
    expect(codesOf(src("Sheet: S"))).toEqual(["W002"]); // zero-column sheets are legal (⚑13†)
  });

  it("an unused Template still gets structural checks, but no context checks", () => {
    const ds = diagsOf(
      src(
        "Template: U",
        "  Rectangle:",
        "    x: [mystery] + 1", // no Card context → NO E002
        "    y: middle", // position rule is context-free → E007
        "    width: full",
        "    color: teal", // height missing → E008
      ),
    );
    expect(ds.map((d) => d.code).sort()).toEqual(["E007", "E008", "W002"]);
    expect(ds.find((d) => d.code === "E008")?.message).toContain("'height:'");
  });

  it("negative: the demo uses everything — zero W002 (covered by the fixture test)", () => {
    expect(codesOf(withCard(CARD_ITEMS))).toEqual([]);
  });
});

// -- W003: non-square units -------------------------------------------------

describe("W003 explicit y_units", () => {
  it("an explicit non-square integer y_units warns; auto does not", () => {
    const ds = diagsOf(withCard([...CARD_ITEMS.slice(0, 3), "y_units: 30", "Front: T"]));
    expect(ds.map((d) => d.code)).toEqual(["W003"]);
    expect(codesOf(withCard(CARD_ITEMS))).toEqual([]);
  });

  it("suppressed when the value IS the exact square value (§3.8 amendment; poker@20 → 28)", () => {
    expect(codesOf(withCard([...CARD_ITEMS.slice(0, 3), "y_units: 28", "Front: T"]))).toEqual([]);
    // square preset: the square value is x_units itself.
    expect(
      codesOf(
        withCard(["sheet: Monsters", "size: square", "x_units: 20", "y_units: 20", "Front: T"]),
      ),
    ).toEqual([]);
  });

  it("still fires when size is unresolved", () => {
    const ds = diagsOf(
      withCard(["sheet: Monsters", "size: jumbo", "x_units: 20", "y_units: 28", "Front: T"]),
    );
    expect(ds.map((d) => d.code).sort()).toEqual(["E008", "W003"]);
  });
});

// -- W004: unknown icon code literal ---------------------------------------

describe("W004 icon codes", () => {
  const icon = (code: string): string =>
    withElement("Icon:", ["x: 1", "y: 1", "size: 1", `code: ${code}`]);

  it("a literal code missing from the curated list warns", () => {
    const ds = diagsOf(icon('"NOT_A_REAL_CODE"'));
    expect(ds.map((d) => d.code)).toEqual(["W004"]);
    expect(ds[0].message).toContain('"NOT_A_REAL_CODE"');
  });

  it("known codes pass, including double-digit ligatures", () => {
    for (const code of ['"HEARTS"', '"SWORDS"', '"13_ON_D20"']) {
      expect(codesOf(icon(code)), code).toEqual([]);
    }
  });

  it("computed/interpolated codes are not checked at compile time (runtime D005)", () => {
    expect(codesOf(icon('"X[cost]"'))).toEqual([]);
    expect(codesOf(icon("[name]"))).toEqual([]);
  });
});

// -- per-using-Card template checking (§3.6) --------------------------------

describe("templates are checked per using Card", () => {
  const source = src(
    "Sheet: A",
    "  column power: Number",
    "Sheet: B",
    "  column other: Number",
    "Template: T",
    "  Text:",
    "    x: 1",
    "    y: 1",
    "    size: 1",
    "    text: [power]",
    "Card: CA",
    "  sheet: A",
    ...CARD_ITEMS.slice(1).map((i) => `  ${i}`),
    "Card: CB",
    "  sheet: B",
    ...CARD_ITEMS.slice(1).map((i) => `  ${i}`),
    "Card: CC",
    "  sheet: B",
    ...CARD_ITEMS.slice(1).map((i) => `  ${i}`),
  );

  it("a template valid for one Card and invalid for two others yields ONE deduped E002 at the template's range", () => {
    const { program, diagnostics } = checkOf(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("E002");
    expect(diagnostics[0].message).toBe("Unknown reference [power]");
    // Attributed to the template's own source range (line 9, `text: [power]`).
    const tpl = program.declarations.find((d) => d.kind === "TemplateDecl")!;
    expect(diagnostics[0].range.startLine).toBeGreaterThanOrEqual(tpl.range.startLine);
    expect(diagnostics[0].range.endLine).toBeLessThanOrEqual(tpl.range.endLine);
    expect(diagnostics[0].range.startLine).toBe(9);
  });

  it("bindings prove the double check: [power] resolves under CA, poisons under CB", () => {
    const { bindings } = checkOf(source);
    const tpl = bindings.templates.get("T") as TemplateDecl;
    const ref = (tpl.children[0] as ElementNode).properties.find((p) => p.key.name === "text")!
      .value as DataRef;
    const [ca, cb] = bindings.cards;
    expect(ca.resolutions.get(ref)).toEqual({
      kind: "column",
      sheet: "A",
      column: "power",
      type: { kind: "Number" },
    });
    expect(ca.exprTypes.get(ref)).toEqual({ kind: "Number" });
    expect(cb.resolutions.has(ref)).toBe(false);
    expect(cb.exprTypes.get(ref)).toEqual({ kind: "Unknown" });
    expect(bindings.templateUsage.get(tpl)).toEqual([ca.decl, cb.decl, bindings.cards[2].decl]);
  });

  it("a template shared by Cards whose sheets both satisfy it is clean", () => {
    const shared = src(
      "Sheet: A",
      "  column power: Number",
      "Sheet: B",
      "  column power: Number",
      "Template: T",
      "  Text:",
      "    x: 1",
      "    y: 1",
      "    size: 1",
      "    text: [power]",
      "Card: CA",
      "  sheet: A",
      ...CARD_ITEMS.slice(1).map((i) => `  ${i}`),
      "Card: CB",
      "  sheet: B",
      ...CARD_ITEMS.slice(1).map((i) => `  ${i}`),
    );
    expect(codesOf(shared)).toEqual([]);
  });
});

// -- expected-type resolution (◆14†, ◆21†) ----------------------------------

describe("expected-type-driven bare names", () => {
  it("[suit] == Rock resolves Rock from the enum-typed left side", () => {
    expect(
      codesOf(withElement("Text:", [...TEXT_BASE, 'text: if [suit] == Rock then "a" else "b"'])),
    ).toEqual([]);
  });

  it("Rock == [suit] resolves from the right side too", () => {
    expect(
      codesOf(withElement("Text:", [...TEXT_BASE, 'text: if Rock == [suit] then "a" else "b"'])),
    ).toEqual([]);
  });

  it("an if with an enum-typed branch lends its type to a bare branch (both directions)", () => {
    expect(
      codesOf(
        withElement("Text:", [...TEXT_BASE, "text: if [cost] > 1 then [suit] else Rock"]),
      ),
    ).toEqual([]);
    expect(
      codesOf(
        withElement("Text:", [...TEXT_BASE, "text: if [cost] > 1 then Rock else [suit]"]),
      ),
    ).toEqual([]);
  });

  it("a color name resolves in a Color position but is E002 elsewhere", () => {
    expect(
      codesOf(withElement("Text:", [...TEXT_BASE, 'text: "a"', "color: red"])),
    ).toEqual([]);
    const ds = diagsOf(withElement("Text:", ["x: red", ...TEXT_BASE.slice(1), 'text: "a"']));
    expect(ds.map((d) => d.code)).toEqual(["E002"]);
    expect(ds[0].message).toBe("Unknown name 'red'");
  });

  it("hex color literals work anywhere a Color is expected, case-insensitively named colors too", () => {
    expect(
      codesOf(withElement("Rectangle:", ["x: 0", "y: 0", "width: 1", "height: 1", "color: #A1B2C3"])),
    ).toEqual([]);
    expect(
      codesOf(withElement("Rectangle:", ["x: 0", "y: 0", "width: 1", "height: 1", "color: RebeccaPurple"])),
    ).toEqual([]);
  });
});

// -- sibling inference across coercing positions (◆14† regression class) -----

describe("if-branch and comparison inference in coercing positions", () => {
  // Rock and Scissors are cases of BOTH enums — only a sibling with a
  // derivable type can pin them; without one, E004 is correct.
  const wrap = (textExpr: string): string =>
    src(
      "Enum: Suit",
      "  case Rock",
      "  case Paper",
      "  case Scissors",
      "Enum: Other",
      "  case Rock",
      "  case Scissors",
      "Sheet: S",
      "  column cost: Number",
      "  column suit: Suit",
      "  column other: Other",
      "Template: T",
      "  Text:",
      ...TEXT_BASE.map((p) => `    ${p}`),
      `    text: ${textExpr}`,
      "Card: C",
      "  sheet: S",
      ...CARD_ITEMS.slice(1).map((i) => `  ${i}`),
    );

  it("a sibling enum-typed branch pins a shared bare case in a Text position (no false E004)", () => {
    expect(codesOf(wrap("if [cost] > 1 then [suit] else Rock"))).toEqual([]);
    expect(codesOf(wrap("if [cost] > 1 then Rock else [suit]"))).toEqual([]);
  });

  it("==/!= infers from the typed side regardless of node shape", () => {
    expect(
      codesOf(wrap('if (if [cost] > 1 then Rock else Scissors) == [suit] then "a" else "b"')),
    ).toEqual([]);
    expect(
      codesOf(wrap('if [suit] == (if [cost] > 1 then Rock else Scissors) then "a" else "b"')),
    ).toEqual([]);
  });

  it("still E004 when no sibling pins a type", () => {
    expect(codesOf(wrap("if [cost] > 1 then Rock else Scissors"))).toEqual(["E004", "E004"]);
  });
});

// -- cascade suppression -----------------------------------------------------

describe("one mistake, one diagnostic (poison propagation)", () => {
  it("color: red + 1 reports only the E002 (no E003 cascade)", () => {
    expect(
      codesOf(
        withElement("Rectangle:", ["x: 0", "y: 0", "width: 1", "height: 1", "color: red + 1"]),
      ),
    ).toEqual(["E002"]);
  });

  it('"a" + "b" reports one E003, not one per operand', () => {
    expect(
      codesOf(withElement("Text:", ['x: "a" + "b"', ...TEXT_BASE.slice(1), 'text: "t"'])),
    ).toEqual(["E003"]);
  });

  it("an unknown ref inside a comparison poisons the whole condition", () => {
    expect(
      codesOf(
        withElement("Text:", ["x: if [bogus] < 1 then 1 else 2", ...TEXT_BASE.slice(1), 'text: "t"']),
      ),
    ).toEqual(["E002"]);
  });
});

// -- robustness (⚑8: check never throws) -------------------------------------

describe("checker robustness", () => {
  it("10,000-term +, *, and 'and' chains poison to Unknown instead of overflowing the stack", () => {
    for (const op of [" + ", " * ", " and "]) {
      const chain = new Array(10001).fill("1").join(op);
      const source = `Template: T\n  Text:\n    x: ${chain}\n    y: 1\n    size: 1\n    text: "a"\n`;
      const { diagnostics } = compileSource(source); // must not throw
      const deep = diagnostics.filter((d) => d.message.includes("too deeply nested to check"));
      expect(deep, op).toHaveLength(1);
      expect(deep[0].code).toBe("E003");
      expect(deep[0].severity).toBe("error");
    }
  });
});
