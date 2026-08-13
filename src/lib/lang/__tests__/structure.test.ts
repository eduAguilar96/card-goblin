/** Block structure, contextual keywords (◆30†), and the continuation rule (◆23†). */
import { describe, expect, it } from "vitest";
import type {
  CardDecl,
  ElementNode,
  RepeatNode,
  SheetDecl,
  TemplateDecl,
} from "../ast";
import { parse } from "../parser";
import { asKind, diags, firstProperty, parseClean } from "./util";

describe("contextual keywords (◆30†)", () => {
  it("property words are legal column names: `column count: Number` etc.", () => {
    const p = parseClean(
      [
        "Sheet: S",
        "  column count: Number",
        "  column size: Number",
        "  column sheet: Text",
        "  column x: Number",
        "  column full: Text",
        "  column middle: Text",
        "  column left: Text",
        "  column right: Text",
        "  column poker: Text",
        "  column red: Text",
        "",
      ].join("\n"),
    );
    const sheet = p.declarations[0] as SheetDecl;
    expect(sheet.columns.map((c) => c.name.name)).toEqual([
      "count", "size", "sheet", "x", "full", "middle", "left", "right", "poker", "red",
    ]);
  });

  it("a column type can be any identifier, incl. an opener word like Text", () => {
    const p = parseClean("Sheet: S\n  column a: Text\n  column b: Suit\n");
    const sheet = p.declarations[0] as SheetDecl;
    expect(sheet.columns.map((c) => c.columnType.name)).toEqual(["Text", "Suit"]);
  });

  it("lowercase `text:` is a property while capital `Text:` is an element", () => {
    const p = parseClean("Template: T\n  Text:\n    text: [name]\n");
    const tpl = p.declarations[0] as TemplateDecl;
    const el = tpl.children[0] as ElementNode;
    expect(el.element).toBe("Text");
    expect(el.properties[0].key.name).toBe("text");
  });

  it("openers are only special in header position: `size: Card` is an identifier value", () => {
    const p = parseClean("Card: C\n  size: Card\n");
    expect(asKind(firstProperty(p).value, "Identifier").name).toBe("Card");
  });
});

describe("reserved words are illegal as declared names (§3.1)", () => {
  const reservedDiags = (source: string) => {
    const ds = diags(source);
    expect(ds).toHaveLength(1);
    expect(ds[0].code).toBe("E001");
    expect(ds[0].message).toContain("reserved word");
    return ds;
  };

  it("rejects opener words as declaration names", () => {
    reservedDiags("Enum: Text\n  case A\n");
    reservedDiags("Sheet: Repeat\n");
    reservedDiags("Template: Front\n");
    reservedDiags("Card: Icon\n");
    // Image joined the openers in M2 — the declared-name rejection must
    // cover it everywhere the other openers are rejected (§3.1).
    reservedDiags("Enum: Image\n  case A\n");
    reservedDiags("Sheet: S\n  column Image: Number\n");
    reservedDiags("Card: C\n  loop: Suit as Image\n");
    // TextBox joined in M3 — same everywhere-rejected guarantee, which
    // follows from BLOCK_OPENERS membership alone (no per-site code).
    reservedDiags("Enum: TextBox\n  case A\n");
    reservedDiags("Sheet: S\n  column TextBox: Number\n");
    reservedDiags("Template: TextBox\n");
    reservedDiags("Card: C\n  loop: Suit as TextBox\n");
    reservedDiags("Template: T\n  Repeat: 3 as TextBox\n    Icon:\n      x: 1\n");
    // Qr joined in M3 (§7.1a) — same everywhere-rejected guarantee.
    reservedDiags("Enum: Qr\n  case A\n");
    reservedDiags("Sheet: S\n  column Qr: Number\n");
    reservedDiags("Template: Qr\n");
    reservedDiags("Card: C\n  loop: Suit as Qr\n");
    reservedDiags("Template: T\n  Repeat: 3 as Qr\n    Icon:\n      x: 1\n");
  });

  it("rejects opener words as column names, keeping siblings", () => {
    const src = "Sheet: S\n  column Rectangle: Number\n  column b: Number\n";
    reservedDiags(src);
    const { program } = parse(src);
    const sheet = program.declarations[0] as SheetDecl;
    // Tolerant parse: the flagged column stays in the AST, siblings survive.
    expect(sheet.columns.map((c) => c.name.name)).toEqual(["Rectangle", "b"]);
  });

  it("rejects opener words as enum case names", () => {
    reservedDiags("Enum: E\n  case Text\n  case A\n");
  });

  it("rejects opener words as Repeat variables", () => {
    reservedDiags("Template: T\n  Repeat: 3 as Text\n    Icon:\n      x: 1\n");
  });

  it("rejects opener words as loop variables", () => {
    reservedDiags("Card: C\n  loop: Suit as Card\n");
  });

  it("keyword words were never identifiers: `case case` is E001 too", () => {
    const ds = diags("Enum: E\n  case case\n");
    expect(ds).toHaveLength(1);
    expect(ds[0].code).toBe("E001");
  });

  it("opener words remain legal in VALUE positions", () => {
    // Column *types*, property values, refs, and keys are value positions.
    const p = parseClean(
      [
        "Sheet: S",
        "  column name: Text",
        "  column count: Number",
        "Card: C",
        "  sheet: S",
        "  count: [count]",
        "  size: Card",
        "  x: Rectangle",
        "",
      ].join("\n"),
    );
    const sheet = p.declarations[0] as SheetDecl;
    expect(sheet.columns.map((c) => c.columnType.name)).toEqual(["Text", "Number"]);
  });
});

describe("declarations (§3.2)", () => {
  it("a zero-column Sheet is legal (⚑13†)", () => {
    const p = parseClean("Sheet: Empty\nCard: C\n  sheet: Empty\n");
    const sheet = p.declarations[0] as SheetDecl;
    expect(sheet.columns).toEqual([]);
    expect(p.declarations).toHaveLength(2);
  });

  it("declarations may come in any order; the parser does not resolve names", () => {
    expect(
      diags("Card: C\n  Front: T\nTemplate: T\nEnum: E\n  case A\nSheet: S\n"),
    ).toEqual([]);
  });

  it("multiple loop: lines are kept in order with their variables (◆25)", () => {
    const p = parseClean("Card: C\n  loop: Suit as s\n  loop: Rank as r\n");
    const card = p.declarations[0] as CardDecl;
    const loops = card.items.flatMap((i) => (i.kind === "Property" ? [i] : []));
    expect(loops.map((l) => l.asVar?.name)).toEqual(["s", "r"]);
  });

  it("the parser accepts any lowercase property with any value — validation is task 2 (E008)", () => {
    expect(diags('Card: C\n  frobnicate: 1 + 2\n  size: "not a preset"\n')).toEqual([]);
  });

  it("Front:/Back: take a template name inline", () => {
    const p = parseClean("Card: C\n  Front: A\n  Back: B\n");
    const card = p.declarations[0] as CardDecl;
    const faces = card.items.flatMap((i) => (i.kind === "Face" ? [i] : []));
    expect(faces.map((f) => [f.face, f.template?.name])).toEqual([
      ["Front", "A"],
      ["Back", "B"],
    ]);
  });

  it("indented content under Front: is E001 — block headers never continue (◆23†)", () => {
    const { program, diagnostics } = parse(
      "Card: C\n  Front: T\n    x: 1\n  Back: B\n",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("inline");
    const card = program.declarations[0] as CardDecl;
    expect(card.items.map((i) => (i.kind === "Face" ? i.face : "?"))).toEqual([
      "Front",
      "Back",
    ]);
  });
});

describe("elements and Repeat (§3.3)", () => {
  it("TextBox: parses as an element with label and properties (M3)", () => {
    const p = parseClean(
      [
        "Template: T",
        '  TextBox: "Rules"',
        "    x: 1",
        "    y: 1",
        "    width: 10",
        "    height: 6",
        '    text: "line one\\nline two"',
        "    size: 1",
        "    align: middle",
        "    line_height: 1.4",
        "    overflow: shrink",
        "",
      ].join("\n"),
    );
    const tpl = p.declarations[0] as TemplateDecl;
    const el = tpl.children[0] as ElementNode;
    expect(el.element).toBe("TextBox");
    expect(el.label).not.toBeNull();
    expect(el.properties.map((prop) => prop.key.name)).toEqual([
      "x", "y", "width", "height", "text", "size", "align", "line_height", "overflow",
    ]);
  });

  it("capital TextBox: is an element while lowercase text: stays a property", () => {
    const p = parseClean("Template: T\n  TextBox:\n    text: [name]\n");
    const el = (p.declarations[0] as TemplateDecl).children[0] as ElementNode;
    expect(el.element).toBe("TextBox");
    expect(el.properties[0].key.name).toBe("text");
  });

  it("the unknown-element hint lists TextBox among the openers", () => {
    const ds = diags("Template: T\n  Circle:\n    x: 1\n");
    expect(ds[0].message).toContain("TextBox:");
  });

  it("nested Repeats with children parse", () => {
    const p = parseClean(
      [
        "Template: T",
        "  Repeat: 3 as row",
        "    Repeat: 3 as col",
        "      Icon:",
        "        x: [col] * 2",
        "        y: [row] * 2",
        "",
      ].join("\n"),
    );
    const tpl = p.declarations[0] as TemplateDecl;
    const outer = tpl.children[0] as RepeatNode;
    expect(outer.variable?.name).toBe("row");
    const inner = outer.children[0] as RepeatNode;
    expect(inner.variable?.name).toBe("col");
    expect((inner.children[0] as ElementNode).element).toBe("Icon");
  });

  it("Repeat headers are single-line (◆23†): a continued header is E001", () => {
    const ds = diags("Template: T\n  Repeat: [health]\n    as i\n");
    expect(ds.length).toBeGreaterThanOrEqual(1);
    expect(ds[0].message).toContain("as <variable>");
  });

  it("Repeat without `as` is E001 but still yields a node with its children", () => {
    const { program, diagnostics } = parse(
      "Template: T\n  Repeat: 3\n    Icon:\n      x: 1\n",
    );
    expect(diagnostics).toHaveLength(1);
    const tpl = program.declarations[0] as TemplateDecl;
    const rep = tpl.children[0] as RepeatNode;
    expect(rep.variable).toBeNull();
    expect(rep.children).toHaveLength(1);
  });

  it("elements cannot nest inside elements", () => {
    const { program, diagnostics } = parse(
      "Template: T\n  Rectangle:\n    Icon:\n      x: 1\n    color: red\n",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("nested");
    const tpl = program.declarations[0] as TemplateDecl;
    const rect = tpl.children[0] as ElementNode;
    expect(rect.properties.map((p) => p.key.name)).toEqual(["color"]);
  });

  it("an element label is optional and purely descriptive", () => {
    const p = parseClean('Template: T\n  Rectangle: "Banner"\n    x: 1\n  Icon:\n    x: 2\n');
    const tpl = p.declarations[0] as TemplateDecl;
    expect((tpl.children[0] as ElementNode).label).not.toBeNull();
    expect((tpl.children[1] as ElementNode).label).toBeNull();
  });

  it("Image blocks parse like any element, label allowed (§3.3 M2)", () => {
    const p = parseClean(
      [
        "Template: T",
        '  Image: "Portrait"',
        "    x: 1",
        "    y: 2",
        "    width: 10",
        "    height: 8",
        '    src: "https://example.com/[name].png"',
        "    fit: cover",
        "  Image:",
        "    x: 0",
        "    y: 0",
        "    width: 1",
        "    height: 1",
        '    src: [art]',
        "",
      ].join("\n"),
    );
    const tpl = p.declarations[0] as TemplateDecl;
    const labelled = tpl.children[0] as ElementNode;
    expect(labelled.element).toBe("Image");
    expect(labelled.label).not.toBeNull();
    expect(labelled.properties.map((q) => q.key.name)).toEqual([
      "x", "y", "width", "height", "src", "fit",
    ]);
    const bare = tpl.children[1] as ElementNode;
    expect(bare.element).toBe("Image");
    expect(bare.label).toBeNull();
    expect(asKind(bare.properties[4].value, "Ref").name).toBe("art");
  });

  it("Image nests inside Repeat", () => {
    const p = parseClean(
      "Template: T\n  Repeat: 3 as i\n    Image:\n      x: [i]\n      y: 0\n      width: 1\n      height: 1\n      src: \"u\"\n",
    );
    const rep = (p.declarations[0] as TemplateDecl).children[0] as RepeatNode;
    expect((rep.children[0] as ElementNode).element).toBe("Image");
  });

  it("Qr blocks parse like any element, label allowed (§7.1a)", () => {
    const p = parseClean(
      [
        "Template: T",
        '  Qr: "Back scan code"',
        "    x: 1",
        "    y: 2",
        "    size: 10",
        '    data: "https://example.com/[code]"',
        "    color: black",
        "    background: white",
        "    level: h",
        "    pivot: bottom_right",
        "  Qr:",
        "    x: 0",
        "    y: 0",
        "    size: 1",
        "    data: [code]",
        "",
      ].join("\n"),
    );
    const tpl = p.declarations[0] as TemplateDecl;
    const labelled = tpl.children[0] as ElementNode;
    expect(labelled.element).toBe("Qr");
    expect(labelled.label).not.toBeNull();
    expect(labelled.properties.map((q) => q.key.name)).toEqual([
      "x", "y", "size", "data", "color", "background", "level", "pivot",
    ]);
    const bare = tpl.children[1] as ElementNode;
    expect(bare.element).toBe("Qr");
    expect(bare.label).toBeNull();
    expect(asKind(bare.properties[3].value, "Ref").name).toBe("code");
  });

  it("Qr nests inside Repeat", () => {
    const p = parseClean(
      "Template: T\n  Repeat: 3 as i\n    Qr:\n      x: [i]\n      y: 0\n      size: 1\n      data: \"u\"\n",
    );
    const rep = (p.declarations[0] as TemplateDecl).children[0] as RepeatNode;
    expect((rep.children[0] as ElementNode).element).toBe("Qr");
  });

  it("the unknown-element hint lists Qr among the openers", () => {
    const ds = diags("Template: T\n  Circle:\n    x: 1\n");
    expect(ds[0].message).toContain("Qr:");
  });
});

describe("property-line continuation (◆23†)", () => {
  it("a property expression continues across deeper-indented lines", () => {
    const p = parseClean("Card: C\n  p: 1 +\n     2\n  q: 3\n");
    const card = p.declarations[0] as CardDecl;
    const [pProp, qProp] = card.items;
    if (pProp.kind !== "Property" || qProp.kind !== "Property") throw new Error("props");
    expect(asKind(pProp.value, "Binary").op).toBe("+");
    expect(pProp.value.range.endLine).toBe(2); // spans onto the continuation line
    expect(asKind(qProp.value, "Number").value).toBe(3);
  });

  it("continuation lines may sit at varying depths, all strictly deeper than the key", () => {
    const p = parseClean("Card: C\n  p: 1 +\n       2 +\n      3\n");
    const value = firstProperty(p).value;
    const outer = asKind(value, "Binary");
    expect(outer.op).toBe("+");
    expect(asKind(outer.left, "Binary").op).toBe("+");
  });

  it("the demo's multi-line if shape parses standalone", () => {
    const p = parseClean(
      [
        "Template: T",
        "  Rectangle:",
        "    color: if [s] == Suit.Rock then grey",
        "           else if [s] == Suit.Paper then gold",
        "           else mediumpurple",
        "    x: 1",
        "",
      ].join("\n"),
    );
    const tpl = p.declarations[0] as TemplateDecl;
    const rect = tpl.children[0] as ElementNode;
    const colorIf = asKind(rect.properties[0].value, "If");
    expect(asKind(colorIf.elseBranch, "If").kind).toBe("If");
    expect(rect.properties[1].key.name).toBe("x");
  });

  it("an expression may even start on the continuation line", () => {
    const p = parseClean("Card: C\n  p:\n     1 + 2\n");
    expect(asKind(firstProperty(p).value, "Binary").op).toBe("+");
  });

  it("a same-indent line after a property is a sibling, never a continuation", () => {
    const ds = diags("Card: C\n  p: 1 +\n  q: 2\n");
    expect(ds).toHaveLength(1); // `1 +` is incomplete; q must still be its own property
    const { program } = parse("Card: C\n  p: 1 +\n  q: 2\n");
    const card = program.declarations[0] as CardDecl;
    expect(card.items).toHaveLength(2);
  });

  it("deeper lines that do not continue the expression are one E001, siblings survive", () => {
    const { program, diagnostics } = parse("Card: C\n  p: 1\n    junk\n  q: 2\n");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("continue");
    const card = program.declarations[0] as CardDecl;
    const keys = card.items.map((i) => (i.kind === "Property" ? i.key.name : "?"));
    expect(keys).toEqual(["p", "q"]);
  });

  it("comment lines at any indentation do not interrupt a block", () => {
    expect(diags("Card: C\n  p: 1\n# outdented comment\n  q: 2\n")).toEqual([]);
  });

  it("blank lines inside blocks are ignored", () => {
    expect(diags("Card: C\n  p: 1\n\n  q: 2\n")).toEqual([]);
  });
});

describe("one mistake, one diagnostic", () => {
  it("`Repeat: 1 as if` is a single E001", () => {
    const ds = diags("Template: T\n  Repeat: 1 as if\n");
    expect(ds).toHaveLength(1);
    expect(ds[0].message).toContain("variable name");
  });

  it("`Front:` with the name on the next line is a single E001", () => {
    const { program, diagnostics } = parse("Card: C\n  Front:\n    MonsterFront\n  Back: B\n");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("template name");
    const card = program.declarations[0] as CardDecl;
    const faces = card.items.flatMap((i) => (i.kind === "Face" ? [i] : []));
    expect(faces.map((f) => [f.face, f.template?.name ?? null])).toEqual([
      ["Front", null],
      ["Back", "B"],
    ]);
  });
});
