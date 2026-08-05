/** The §3.9 demo project is the slice acceptance fixture: it must parse with zero diagnostics. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  CardDecl,
  ElementNode,
  EnumDecl,
  RepeatNode,
  SheetDecl,
  TemplateDecl,
} from "../ast";
import { DEMO_PROJECT_SOURCE } from "../demoProject";
import { parse } from "../parser";
import { asKind } from "./util";

const demoSource = readFileSync(
  fileURLToPath(new URL("./fixtures/demo.goblin", import.meta.url)),
  "utf8",
);

const result = parse(demoSource);
const program = result.program;

describe("demo fixture (§3.9)", () => {
  it("parses with zero diagnostics", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("is byte-identical to demoProject.ts — the store's seed (task 4) shares this text, never forks it", () => {
    expect(DEMO_PROJECT_SOURCE).toBe(demoSource);
  });

  it("has the five declarations in order", () => {
    expect(program.declarations.map((d) => d.kind)).toEqual([
      "EnumDecl",
      "SheetDecl",
      "TemplateDecl",
      "TemplateDecl",
      "CardDecl",
    ]);
    expect(program.declarations.map((d) => d.name.name)).toEqual([
      "Suit",
      "Monsters",
      "MonsterFront",
      "PlainBack",
      "Monster",
    ]);
  });

  it("parses the enum cases", () => {
    const suit = program.declarations[0] as EnumDecl;
    expect(suit.cases.map((c) => c.name.name)).toEqual(["Rock", "Paper", "Scissors"]);
  });

  it("parses the sheet columns — incl. `count`, a property word used as a column (◆30)", () => {
    const monsters = program.declarations[1] as SheetDecl;
    expect(monsters.columns.map((c) => [c.name.name, c.columnType.name])).toEqual([
      ["name", "Text"],
      ["cost", "Number"],
      ["health", "Number"],
      ["count", "Number"],
    ]);
  });

  it("parses MonsterFront's five nodes with labels", () => {
    const tpl = program.declarations[2] as TemplateDecl;
    expect(tpl.children.map((n) => n.kind)).toEqual([
      "Element",
      "Element",
      "Element",
      "Element",
      "Repeat",
    ]);
    const [banner, title, cost, attack] = tpl.children as [
      ElementNode,
      ElementNode,
      ElementNode,
      ElementNode,
      RepeatNode,
    ];
    expect(banner.element).toBe("Rectangle");
    expect(banner.label?.parts).toEqual([
      expect.objectContaining({ kind: "text", value: "Banner" }),
    ]);
    expect(title.element).toBe("Text");
    expect(cost.element).toBe("Text");
    expect(attack.element).toBe("Icon");
  });

  it("parses the multi-line if under `color:` as one expression (◆23†)", () => {
    const tpl = program.declarations[2] as TemplateDecl;
    const banner = tpl.children[0] as ElementNode;
    const color = banner.properties.find((p) => p.key.name === "color");
    expect(color).toBeDefined();
    const outer = asKind(color!.value, "If");
    const cond = asKind(outer.condition, "Binary");
    expect(cond.op).toBe("==");
    expect(asKind(cond.left, "Ref").name).toBe("current_suit");
    const qual = asKind(cond.right, "Qualified");
    expect(qual.qualifier.name).toBe("Suit");
    expect(qual.member.name).toBe("Rock");
    expect(asKind(outer.thenBranch, "Identifier").name).toBe("grey");
    const inner = asKind(outer.elseBranch, "If");
    expect(asKind(inner.thenBranch, "Identifier").name).toBe("gold");
    expect(asKind(inner.elseBranch, "Identifier").name).toBe("mediumpurple");
    // The property value's span covers the whole three-line expression (⚑8's
    // future squiggles need it): `color:` is on line 19, `else mediumpurple`
    // ends on line 21 (0-based).
    expect(color!.value.range.startLine).toBe(19);
    expect(color!.value.range.endLine).toBe(21);
    expect(color!.range.startLine).toBe(19);
    expect(color!.range.startCol).toBe(4);
  });

  it("parses geometry keywords and anchors as ordinary identifiers (◆30)", () => {
    const tpl = program.declarations[2] as TemplateDecl;
    const title = tpl.children[1] as ElementNode;
    const x = title.properties.find((p) => p.key.name === "x");
    expect(asKind(x!.value, "Identifier").name).toBe("middle");
    const cost = tpl.children[2] as ElementNode;
    const anchor = cost.properties.find((p) => p.key.name === "anchor");
    expect(asKind(anchor!.value, "Identifier").name).toBe("right");
    const back = program.declarations[3] as TemplateDecl;
    const rect = back.children[0] as ElementNode;
    const width = rect.properties.find((p) => p.key.name === "width");
    expect(asKind(width!.value, "Identifier").name).toBe("full");
  });

  it("parses the interpolated string `\"Cost: [cost]\"` into parts", () => {
    const tpl = program.declarations[2] as TemplateDecl;
    const cost = tpl.children[2] as ElementNode;
    const text = cost.properties.find((p) => p.key.name === "text");
    const lit = asKind(text!.value, "String");
    expect(lit.parts.map((p) => (p.kind === "text" ? ["text", p.value] : ["ref", p.name]))).toEqual([
      ["text", "Cost: "],
      ["ref", "cost"],
    ]);
  });

  it("parses the Repeat block: count ref, 0-based var, Icon child with arithmetic", () => {
    const tpl = program.declarations[2] as TemplateDecl;
    const repeat = tpl.children[4] as RepeatNode;
    expect(asKind(repeat.count, "Ref").name).toBe("health");
    expect(repeat.variable?.name).toBe("i");
    expect(repeat.children).toHaveLength(1);
    const icon = repeat.children[0] as ElementNode;
    expect(icon.element).toBe("Icon");
    expect(icon.label).toBeNull();
    const x = icon.properties.find((p) => p.key.name === "x");
    // 1.5 + [i] * 2 → + at the top, * below it
    const plus = asKind(x!.value, "Binary");
    expect(plus.op).toBe("+");
    expect(asKind(plus.left, "Number").value).toBe(1.5);
    const times = asKind(plus.right, "Binary");
    expect(times.op).toBe("*");
    expect(asKind(times.left, "Ref").name).toBe("i");
  });

  it("parses the Card block: properties in order, loop with `as`, inline faces", () => {
    const card = program.declarations[4] as CardDecl;
    expect(
      card.items.map((i) => (i.kind === "Property" ? i.key.name : i.face)),
    ).toEqual(["sheet", "size", "x_units", "y_units", "loop", "count", "Front", "Back"]);
    const loop = card.items[4];
    if (loop.kind !== "Property") throw new Error("expected property");
    expect(asKind(loop.value, "Identifier").name).toBe("Suit");
    expect(loop.asVar?.name).toBe("current_suit");
    const count = card.items[5];
    if (count.kind !== "Property") throw new Error("expected property");
    expect(asKind(count.value, "Ref").name).toBe("count");
    const front = card.items[6];
    if (front.kind !== "Face") throw new Error("expected face");
    expect(front.face).toBe("Front");
    expect(front.template?.name).toBe("MonsterFront");
    const back = card.items[7];
    if (back.kind !== "Face") throw new Error("expected face");
    expect(back.template?.name).toBe("PlainBack");
  });

  it("every AST node carries a well-formed source span", () => {
    let visited = 0;
    const isRange = (r: unknown): r is Record<string, number> =>
      typeof r === "object" &&
      r !== null &&
      ["startLine", "startCol", "endLine", "endCol"].every(
        (k) => typeof (r as Record<string, unknown>)[k] === "number",
      );
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const v of value) walk(v);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      const node = value as Record<string, unknown>;
      if (typeof node.kind === "string") {
        visited++;
        expect(isRange(node.range), `node ${String(node.kind)} missing range`).toBe(true);
        const r = node.range as { startLine: number; startCol: number; endLine: number; endCol: number };
        expect(r.startLine).toBeGreaterThanOrEqual(0);
        expect(
          r.endLine > r.startLine || (r.endLine === r.startLine && r.endCol >= r.startCol),
        ).toBe(true);
      }
      for (const v of Object.values(node)) walk(v);
    };
    walk(program);
    expect(visited).toBeGreaterThan(80); // the whole tree, not a stub
  });
});
