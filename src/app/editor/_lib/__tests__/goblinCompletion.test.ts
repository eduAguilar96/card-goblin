/**
 * Pure completion logic (DESIGN.md §6.3) — every context is exercised through
 * `computeCompletions(text, offset, snapshot)` with zero Monaco involvement.
 *
 * The property-key tables in goblinCompletion.ts MIRROR check.ts's private
 * CARD_PROPERTY_KEYS / ELEMENT_SPECS; the "compiler pins" suite at the bottom
 * keeps them honest by probing E008 behavior in both directions.
 */
import { describe, expect, it } from "vitest";
import {
  compileSource,
  DEFAULT_FONT,
  DEFAULT_ICON_STYLE,
  DEFAULT_IMAGE_FIT,
  DEFAULT_QR_LEVEL,
  DICIER_CODES,
  FONT_FACES,
  ICON_STYLES,
  IMAGE_FITS,
  PIVOT_TOKENS,
  QR_LEVELS,
  SIZE_PRESETS,
} from "@/lib/lang";
import type { SchemaSnapshot } from "@/app/editor/_store/editorStore";
import {
  buildCompletionSnapshot,
  computeCompletions,
  EMPTY_SNAPSHOT,
  type CompletionResult,
  type CompletionSnapshot,
} from "../goblinCompletion";

const src = (...lines: string[]): string => lines.join("\n") + "\n";

/** Two enums sharing a case name (Rock), two bound sheets, two used templates.
 * Compiles clean — asserted below — so the snapshot is the full-bindings one. */
const FIXTURE = src(
  "Enum: Suit",
  "  case Rock",
  "  case Paper",
  "Enum: Rarity",
  "  case Common",
  "  case Rock",
  "Sheet: Monsters",
  "  column name: Text",
  "  column cost: Number",
  "  column suit: Suit",
  "Sheet: Extras",
  "  column flavor: Text",
  "Template: MonsterFront",
  "  Rectangle:",
  "    x: 0",
  "    y: 0",
  "    width: full",
  "    height: full",
  "    color: white",
  "Template: ExtraFront",
  "  Text:",
  "    x: middle",
  "    y: 2",
  "    size: 1",
  "    text: [flavor]",
  "    pivot: middle",
  "Card: Monster",
  "  sheet: Monsters",
  "  size: poker",
  "  x_units: 20",
  "  y_units: auto",
  "  loop: Rarity as r",
  "  Front: MonsterFront",
  "Card: Extra",
  "  sheet: Extras",
  "  size: mini",
  "  x_units: 10",
  "  y_units: auto",
  "  Front: ExtraFront",
);

const SNAP: CompletionSnapshot = buildCompletionSnapshot(
  compileSource(FIXTURE).bindings,
  null,
);

/** Compute completions at the `¦` marker (removed before the call). */
function at(doc: string, snapshot: CompletionSnapshot = SNAP): CompletionResult {
  const offset = doc.indexOf("¦");
  expect(offset, "test doc must contain a ¦ cursor marker").toBeGreaterThanOrEqual(0);
  return computeCompletions(doc.slice(0, offset) + doc.slice(offset + 1), offset, snapshot);
}

const labels = (r: CompletionResult): string[] => r.suggestions.map((s) => s.label);
const byLabel = (r: CompletionResult, label: string) => {
  const found = r.suggestions.find((s) => s.label === label);
  expect(found, `expected a suggestion labeled '${label}'`).toBeDefined();
  return found!;
};

// ---------------------------------------------------------------------------
// buildCompletionSnapshot
// ---------------------------------------------------------------------------

describe("buildCompletionSnapshot", () => {
  it("fixture compiles clean (snapshot under test is the full-bindings one)", () => {
    expect(compileSource(FIXTURE).diagnostics).toEqual([]);
  });

  it("derives sheets, enums, and templates from bindings", () => {
    expect(SNAP.sheets.map((s) => s.name)).toEqual(["Monsters", "Extras"]);
    const monsters = SNAP.sheets[0];
    expect(monsters.columns.map((c) => c.name)).toEqual(["name", "cost", "suit"]);
    expect(monsters.columns.map((c) => c.type)).toEqual(["Text", "Number", "enum Suit"]);
    expect(monsters.columns[2].enumName).toBe("Suit");
    expect(monsters.columns[1].enumName).toBeNull();
    expect(SNAP.enums).toEqual([
      { name: "Suit", cases: ["Rock", "Paper"] },
      { name: "Rarity", cases: ["Common", "Rock"] },
    ]);
    expect(SNAP.templates).toEqual(["MonsterFront", "ExtraFront"]);
  });

  it("falls back to the schema snapshot when bindings are absent or empty", () => {
    const schema: SchemaSnapshot = [
      {
        name: "S1",
        columns: [
          { name: "a", type: { kind: "Number" } },
          { name: "b", type: { kind: "Enum", enumName: "E1", cases: ["X", "Y"] } },
        ],
      },
    ];
    for (const bindings of [null, compileSource("").bindings]) {
      const snap = buildCompletionSnapshot(bindings, schema);
      expect(snap.sheets.map((s) => s.name)).toEqual(["S1"]);
      expect(snap.sheets[0].columns[1]).toEqual({ name: "b", type: "enum E1", enumName: "E1" });
      expect(snap.enums).toEqual([{ name: "E1", cases: ["X", "Y"] }]);
      expect(snap.templates).toEqual([]);
    }
  });

  it("prefers bindings over the (older) schema when both exist", () => {
    const stale: SchemaSnapshot = [{ name: "Old", columns: [] }];
    const snap = buildCompletionSnapshot(compileSource(FIXTURE).bindings, stale);
    expect(snap.sheets.map((s) => s.name)).toEqual(["Monsters", "Extras"]);
  });

  it("null/null yields the empty universe", () => {
    expect(buildCompletionSnapshot(null, null)).toEqual(EMPTY_SNAPSHOT);
  });
});

// ---------------------------------------------------------------------------
// Comments and strings
// ---------------------------------------------------------------------------

describe("comments", () => {
  it("no completions inside a full-line comment", () => {
    expect(at("# Enu¦").suggestions).toEqual([]);
  });

  it("no completions after a trailing comment", () => {
    expect(at(src("Card: M", "  sheet: Monsters # not co¦")).suggestions).toEqual([]);
  });

  it("a complete #RRGGBB literal is NOT a comment (◆22 disambiguation)", () => {
    const r = at(src("Template: T", "  Rectangle:", "    color: #cc0000 or ¦"));
    expect(labels(r).length).toBeGreaterThan(0); // still a color value position
  });

  it("a partial hex (#cc00) reads as a comment, matching the lexer", () => {
    expect(at(src("Template: T", "  Rectangle:", "    color: #cc00¦")).suggestions).toEqual([]);
  });

  it("an identifier char AFTER the cursor makes the hex a comment (full-line lookahead)", () => {
    expect(
      at(src("Template: T", "  Rectangle:", "    color: #cc0000¦xx")).suggestions,
    ).toEqual([]);
  });
});

describe("plain strings", () => {
  it("no completions inside a text: string", () => {
    expect(at(src("Template: T", "  Text:", '    text: "Hel¦')).suggestions).toEqual([]);
  });

  it("[[ escape does not open a data-ref context", () => {
    expect(at(src("Template: T", "  Text:", '    text: "a [[¦')).suggestions).toEqual([]);
    expect(at(src("Template: T", "  Text:", '    text: "a [[[[¦')).suggestions).toEqual([]);
  });

  it("an odd run of [ beyond the escape opens a real ref ('a [[[cost')", () => {
    const r = at(
      src(
        "Template: MonsterFront",
        "  Text:",
        '    text: "a [[[co¦"',
        "Card: M",
        "  sheet: Monsters",
        "  Front: MonsterFront",
      ),
    );
    expect(labels(r)).toContain("cost");
  });

  it("no expression noise right after a closing quote (the \" trigger)", () => {
    expect(at(src("Template: T", "  Text:", '    text: "done"¦')).suggestions).toEqual([]);
    expect(at(src("Template: T", "  Icon:", '    code: "HEARTS"¦')).suggestions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// [bracket] data refs
// ---------------------------------------------------------------------------

describe("bracket refs", () => {
  it("inside a Card: bound sheet's columns + loop vars, not other sheets", () => {
    const r = at(
      src("Card: Monster", "  sheet: Monsters", "  loop: Rarity as r", "  count: [¦"),
    );
    expect(labels(r)).toEqual(["r", "name", "cost", "suit"]);
    expect(byLabel(r, "r").detail).toBe("loop — enum Rarity");
    expect(byLabel(r, "cost").detail).toBe("Number — Monsters");
    expect(byLabel(r, "suit").detail).toBe("enum Suit — Monsters");
    expect(labels(r)).not.toContain("flavor");
  });

  it("inside a Template: columns come from the using Card's sheet", () => {
    const r = at(
      src(
        "Template: MonsterFront",
        "  Text:",
        "    x: 1",
        "    y: [¦",
        "Card: M",
        "  sheet: Monsters",
        "  Front: MonsterFront",
      ),
    );
    expect(labels(r)).toEqual(["name", "cost", "suit"]);
  });

  it("two Cards using one Template union their sheets' columns", () => {
    const r = at(
      src(
        "Template: T",
        "  Text:",
        "    y: [¦",
        "Card: A",
        "  sheet: Monsters",
        "  Front: T",
        "Card: B",
        "  sheet: Extras",
        "  Back: T",
      ),
    );
    expect(labels(r)).toEqual(["name", "cost", "suit", "flavor"]);
  });

  it("string interpolation offers the same refs (◆30: brackets always mean data)", () => {
    const r = at(
      src(
        "Template: MonsterFront",
        "  Text:",
        '    text: "Cost: [¦"',
        "Card: M",
        "  sheet: Monsters",
        "  Front: MonsterFront",
      ),
    );
    expect(labels(r)).toContain("cost");
  });

  it("enclosing Repeat variables rank first", () => {
    const r = at(
      src(
        "Template: T",
        "  Repeat: 3 as i",
        "    Icon:",
        "      x: [¦",
        "Card: M",
        "  sheet: Monsters",
        "  Front: T",
      ),
    );
    expect(labels(r)[0]).toBe("i");
    expect(byLabel(r, "i").detail).toBe("repeat index (0-based)");
    expect(labels(r)).toContain("cost");
  });

  it("unplaceable context degrades to the union of all sheets' columns", () => {
    expect(labels(at("count: [¦"))).toEqual(["name", "cost", "suit", "flavor"]);
  });

  it("a Card naming an unknown sheet degrades to the union too", () => {
    const r = at(src("Card: M", "  sheet: Nonexistent", "  count: [¦"));
    expect(labels(r)).toEqual(["name", "cost", "suit", "flavor"]);
  });

  it("a Template no Card uses degrades to the union", () => {
    const r = at(src("Template: Orphan", "  Text:", "    y: [¦"));
    expect(labels(r)).toEqual(["name", "cost", "suit", "flavor"]);
  });

  it("a Card bound to a zero-column sheet resolves and stays column-less", () => {
    const zeroSnap = buildCompletionSnapshot(
      compileSource(src("Sheet: Blanks", "Sheet: Full", "  column a: Text")).bindings,
      null,
    );
    const r = at(src("Card: B", "  sheet: Blanks", "  count: [¦"), zeroSnap);
    expect(labels(r)).toEqual([]);
  });

  it("nested Repeats reusing a variable name suggest it once (innermost wins)", () => {
    const r = at(
      src(
        "Template: T",
        "  Repeat: 3 as i",
        "    Repeat: 2 as i",
        "      Icon:",
        "        x: [¦",
      ),
    );
    expect(labels(r).filter((l) => l === "i")).toHaveLength(1);
  });

  it("a loop variable shadowing a same-named column wins the label (§3.6)", () => {
    const r = at(
      src("Card: M", "  sheet: Monsters", "  loop: Rarity as suit", "  count: [¦"),
    );
    expect(labels(r).filter((l) => l === "suit")).toHaveLength(1);
    expect(byLabel(r, "suit").detail).toBe("loop — enum Rarity");
  });

  it("mid-word: the replace range spans the whole identifier", () => {
    const doc = src("Card: M", "  sheet: Monsters", "  count: [co¦st]");
    const r = at(doc);
    const clean = doc.replace("¦", "");
    expect(r.replaceStart).toBe(clean.indexOf("cost]"));
    expect(r.replaceEnd).toBe(clean.indexOf("cost]") + 4);
    expect(labels(r)).toContain("cost");
  });
});

// ---------------------------------------------------------------------------
// Property-key positions
// ---------------------------------------------------------------------------

describe("property keys", () => {
  it("Rectangle keys with type-hint details (pivot included, §3.4 M3)", () => {
    const r = at(src("Template: T", "  Rectangle:", "    ¦"));
    expect(labels(r)).toEqual(["x", "y", "width", "height", "color", "pivot"]);
    expect(byLabel(r, "color").detail).toBe("Color");
    expect(byLabel(r, "pivot").detail).toContain("top_left");
    expect(byLabel(r, "x").insertText).toBe("x: ");
  });

  it("Text keys include text/pivot/font; Icon keys include code and style", () => {
    expect(labels(at(src("Template: T", "  Text:", "    ¦")))).toEqual([
      "x", "y", "size", "text", "color", "pivot", "font",
    ]);
    expect(labels(at(src("Template: T", "  Icon:", "    ¦")))).toEqual([
      "x", "y", "size", "code", "color", "pivot", "style",
    ]);
  });

  it("Image keys include src and fit (§3.3 M2)", () => {
    const r = at(src("Template: T", "  Image:", "    ¦"));
    expect(labels(r)).toEqual(["x", "y", "width", "height", "src", "fit", "pivot"]);
    expect(byLabel(r, "src").detail).toBe("Text — image URL");
    expect(byLabel(r, "fit").detail).toContain("contain | cover | stretch");
  });

  it("Qr keys include data/level/background (§7.1a)", () => {
    const r = at(src("Template: T", "  Qr:", "    ¦"));
    expect(labels(r)).toEqual([
      "x", "y", "size", "data", "color", "background", "level", "pivot",
    ]);
    expect(byLabel(r, "data").detail).toBe("Text — the encoded content");
    expect(byLabel(r, "background").detail).toBe("Color (optional, default white)");
    expect(byLabel(r, "level").detail).toContain("l | m | q | h");
  });

  it("TextBox keys include text/align/line_height/overflow/font (§3.3 M3, ◆41)", () => {
    const r = at(src("Template: T", "  TextBox:", "    ¦"));
    expect(labels(r)).toEqual([
      "x", "y", "width", "height", "text", "size", "color", "align", "line_height", "overflow",
      "pivot", "font",
    ]);
    expect(byLabel(r, "text").detail).toContain("hard break");
    expect(byLabel(r, "line_height").detail).toContain("1.3");
    expect(byLabel(r, "overflow").detail).toContain("clip | shrink");
    expect(byLabel(r, "font").detail).toContain("geist");
  });

  it("Card keys include properties (custom-size pair too) and Front/Back face lines", () => {
    const r = at(src("Card: M", "  ¦"));
    expect(labels(r)).toEqual([
      "sheet", "size", "width_mm", "height_mm", "x_units", "y_units", "loop", "count",
      "Front", "Back",
    ]);
    expect(byLabel(r, "size").detail).toBe([...SIZE_PRESETS.keys()].join(" | "));
  });

  it("Template and Repeat bodies offer element openers", () => {
    for (const doc of [
      src("Template: T", "  ¦"),
      src("Template: T", "  Repeat: 3 as i", "    ¦"),
    ]) {
      const r = at(doc);
      expect(labels(r)).toEqual([
        "Rectangle", "Text", "TextBox", "Icon", "Image", "Qr", "Repeat",
      ]);
      expect(byLabel(r, "Rectangle").insertText).toBe("Rectangle: ");
    }
  });

  it("Sheet body offers `column`, Enum body offers `case`", () => {
    expect(byLabel(at(src("Sheet: S", "  ¦")), "column").insertText).toBe("column ");
    expect(byLabel(at(src("Enum: E", "  ¦")), "case").insertText).toBe("case ");
  });

  it("top level offers the four block openers (empty doc included)", () => {
    expect(labels(at("¦"))).toEqual(["Enum", "Sheet", "Template", "Card"]);
    expect(computeCompletions("", 0, SNAP).suggestions.map((s) => s.label)).toEqual([
      "Enum", "Sheet", "Template", "Card",
    ]);
  });

  it("an existing colon suppresses the `: ` suffix (mid-word overtype)", () => {
    const doc = src("Template: T", "  Rectangle:", "    wi¦dth: 1");
    const r = at(doc);
    expect(byLabel(r, "width").insertText).toBe("width");
    const clean = doc.replace("¦", "");
    expect(r.replaceStart).toBe(clean.indexOf("width:"));
    expect(r.replaceEnd).toBe(clean.indexOf("width:") + 5);
  });

  it("an indented but unplaceable position stays silent", () => {
    expect(at(src("  ¦")).suggestions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Value positions by expected type
// ---------------------------------------------------------------------------

describe("value positions", () => {
  it("sheet: offers sheet names with column counts", () => {
    const r = at(src("Card: M", "  sheet: ¦"));
    expect(labels(r)).toEqual(["Monsters", "Extras"]);
    expect(byLabel(r, "Monsters").detail).toBe("Sheet — 3 columns");
    expect(byLabel(r, "Extras").detail).toBe("Sheet — 1 column");
  });

  it("size: in a Card offers the presets with mm details", () => {
    const r = at(src("Card: M", "  size: ¦"));
    expect(labels(r)).toEqual([...SIZE_PRESETS.keys()]);
    expect(byLabel(r, "poker").detail).toBe("63.5 × 88.9 mm");
    expect(labels(r)).not.toContain("full");
  });

  it("size: in a Text/Icon element is geometry, not presets", () => {
    const r = at(src("Template: T", "  Text:", "    size: ¦"));
    expect(labels(r)).toContain("full");
    expect(labels(r)).toContain("half");
    expect(labels(r)).not.toContain("middle");
    expect(labels(r)).not.toContain("poker");
  });

  it("size: in an unplaceable block offers both readings", () => {
    const l = labels(at("size: ¦"));
    expect(l).toContain("poker");
    expect(l).toContain("full");
  });

  it("Front:/Back: offer template names", () => {
    expect(labels(at(src("Card: M", "  Front: ¦")))).toEqual(["MonsterFront", "ExtraFront"]);
    expect(labels(at(src("Card: M", "  Back: ¦")))).toEqual(["MonsterFront", "ExtraFront"]);
  });

  it("loop: walks enum → as → variable-naming silence", () => {
    const enums = at(src("Card: M", "  loop: ¦"));
    expect(labels(enums)).toEqual(["Suit", "Rarity"]);
    expect(byLabel(enums, "Suit").detail).toBe("enum — 2 cases");
    expect(labels(at(src("Card: M", "  loop: Suit ¦")))).toEqual(["as"]);
    expect(at(src("Card: M", "  loop: Suit as ¦")).suggestions).toEqual([]);
    expect(at(src("Card: M", "  loop: Suit as curr¦")).suggestions).toEqual([]);
  });

  it("loop: mid-enum-word still offers enums", () => {
    expect(labels(at(src("Card: M", "  loop: Ra¦")))).toEqual(["Suit", "Rarity"]);
  });

  it("color: offers CSS names, a hex hint, and expression extras", () => {
    const r = at(src("Template: T", "  Rectangle:", "    color: ¦"));
    expect(labels(r)).toContain("red");
    expect(byLabel(r, "red").kind).toBe("color");
    const hint = byLabel(r, "#RRGGBB");
    expect(hint.group).toBe(3);
    expect(hint.insertText).toBe("#");
    expect(labels(r)).toContain("if"); // expression still legal here
  });

  it("pivot: offers the nine canonical tokens + center, default marked (§3.4 M3)", () => {
    const r = at(src("Template: T", "  Text:", "    pivot: ¦"));
    expect(labels(r)).toEqual([...PIVOT_TOKENS, "center"]);
    expect(byLabel(r, "top_left").detail).toBe("pivot point (the default)");
    expect(byLabel(r, "bottom_right").detail).toContain("either word order");
    expect(byLabel(r, "center").detail).toBe("shorthand for center_center");
    // The legacy aliases and reversed spellings stay ACCEPTED by the
    // checker but are deliberately not offered — one spelling per point.
    expect(labels(r)).not.toContain("left");
    expect(labels(r)).not.toContain("middle");
    expect(labels(r)).not.toContain("center_bottom");
    // Offered on the box elements too — pivot: is legal everywhere (§3.4).
    expect(labels(at(src("Template: T", "  Rectangle:", "    pivot: ¦")))).toEqual([
      ...PIVOT_TOKENS, "center",
    ]);
    expect(labels(at(src("Template: T", "  Image:", "    pivot: ¦")))).toEqual([
      ...PIVOT_TOKENS, "center",
    ]);
    expect(labels(at(src("Template: T", "  TextBox:", "    pivot: ¦")))).toEqual([
      ...PIVOT_TOKENS, "center",
    ]);
    expect(labels(at(src("Template: T", "  Qr:", "    pivot: ¦")))).toEqual([
      ...PIVOT_TOKENS, "center",
    ]);
  });

  it("style: offers exactly the ten Dicier faces, default marked", () => {
    const r = at(src("Template: T", "  Icon:", "    style: ¦"));
    expect(labels(r)).toEqual([...ICON_STYLES]);
    expect(byLabel(r, DEFAULT_ICON_STYLE).detail).toContain("default");
  });

  it("font: offers exactly the nine faces, default marked, on Text AND TextBox (§3.3 M3, ◆41)", () => {
    const onText = at(src("Template: T", "  Text:", "    font: ¦"));
    expect(labels(onText)).toEqual([...FONT_FACES]);
    expect(byLabel(onText, DEFAULT_FONT).detail).toBe("font face (the default)");
    expect(byLabel(onText, "courier_bold_italic").detail).toBe("font face");

    const onBox = at(src("Template: T", "  TextBox:", "    font: ¦"));
    expect(labels(onBox)).toEqual([...FONT_FACES]);
    expect(byLabel(onBox, DEFAULT_FONT).detail).toBe("font face (the default)");
  });

  it("fit: offers exactly the three image fits, default marked (§3.3 M2)", () => {
    const r = at(src("Template: T", "  Image:", "    fit: ¦"));
    expect(labels(r)).toEqual([...IMAGE_FITS]);
    expect(byLabel(r, DEFAULT_IMAGE_FIT).detail).toBe("image fit (the default)");
    expect(byLabel(r, "cover").detail).toBe("image fit");
  });

  it("level: offers exactly l/m/q/h, default marked (§7.1a)", () => {
    const r = at(src("Template: T", "  Qr:", "    level: ¦"));
    expect(labels(r)).toEqual([...QR_LEVELS]);
    expect(byLabel(r, DEFAULT_QR_LEVEL).detail).toBe("QR error correction (the default)");
    expect(byLabel(r, "h").detail).toBe("QR error correction");
  });

  it("background: offers colors like color:, on Qr (§7.1a)", () => {
    const r = at(src("Template: T", "  Qr:", "    background: ¦"));
    expect(labels(r)).toContain("white");
    expect(byLabel(r, "white").kind).toBe("color");
  });

  it("data: is an expression position outside its string (§7.1a)", () => {
    const r = at(src("Template: T", "  Qr:", "    data: ¦"));
    expect(labels(r)).toContain("if");
  });

  it("align: offers exactly left/middle/right, default marked (§3.3 M3)", () => {
    const r = at(src("Template: T", "  TextBox:", "    align: ¦"));
    expect(labels(r)).toEqual(["left", "middle", "right"]);
    expect(byLabel(r, "left").detail).toBe("align (the default)");
    expect(byLabel(r, "middle").detail).toBe("align");
  });

  it("overflow: offers exactly clip/shrink, default marked (§3.3 M3)", () => {
    const r = at(src("Template: T", "  TextBox:", "    overflow: ¦"));
    expect(labels(r)).toEqual(["clip", "shrink"]);
    expect(byLabel(r, "clip").detail).toContain("default");
    expect(byLabel(r, "shrink").detail).toContain("60% floor");
  });

  it("line_height: stays silent — a positive number literal position", () => {
    expect(at(src("Template: T", "  TextBox:", "    line_height: ¦")).suggestions).toEqual([]);
  });

  it("src: is an expression position outside its string, silent inside (URLs)", () => {
    const outside = at(src("Template: T", "  Image:", "    src: ¦"));
    expect(labels(outside)).toContain("if");
    expect(at(src("Template: T", "  Image:", '    src: "https://¦"')).suggestions).toEqual([]);
  });

  it("x: includes middle on Text/Icon but not on Rectangle, Image, or Qr", () => {
    expect(labels(at(src("Template: T", "  Icon:", "    x: ¦")))).toContain("middle");
    expect(labels(at(src("Template: T", "  Rectangle:", "    x: ¦")))).not.toContain("middle");
    expect(labels(at(src("Template: T", "  Image:", "    x: ¦")))).not.toContain("middle");
    // TextBox has align:, never the x: middle sugar (§3.3 M3 — E007).
    expect(labels(at(src("Template: T", "  TextBox:", "    x: ¦")))).not.toContain("middle");
    // Qr has no pivot sugar either (§7.1a — mirrors Rectangle/Image).
    expect(labels(at(src("Template: T", "  Qr:", "    x: ¦")))).not.toContain("middle");
  });

  it("middle is whole-value only (E007): dropped mid-expression, kept mid-word", () => {
    const mid = labels(at(src("Template: T", "  Icon:", "    x: 1 + ¦")));
    expect(mid).not.toContain("middle");
    expect(mid).toContain("full"); // full/half are Numbers — still legal
    expect(labels(at(src("Template: T", "  Icon:", "    x: mid¦")))).toContain("middle");
  });

  it("a CSS color shadows an enum named like one in color: position", () => {
    const redSnap = buildCompletionSnapshot(
      compileSource(src("Enum: red", "  case A")).bindings,
      null,
    );
    const r = at(src("Template: T", "  Rectangle:", "    color: ¦"), redSnap);
    expect(labels(r).filter((l) => l === "red")).toHaveLength(1);
    expect(byLabel(r, "red").kind).toBe("color");
  });

  it("y/width/height offer full/half only", () => {
    for (const key of ["y", "width", "height"]) {
      const l = labels(at(src("Template: T", "  Rectangle:", `    ${key}: ¦`)));
      expect(l).toContain("full");
      expect(l).toContain("half");
      expect(l).not.toContain("middle");
    }
  });

  it("Image width/height offer auto (§3.3 auto dimension); y does not", () => {
    for (const key of ["width", "height"]) {
      const l = labels(at(src("Template: T", "  Image:", `    ${key}: ¦`)));
      expect(l, key).toContain("auto");
      expect(l, key).toContain("full");
      expect(l, key).toContain("half");
    }
    expect(labels(at(src("Template: T", "  Image:", "    y: ¦")))).not.toContain("auto");
  });

  it("auto stays Image-only: Rectangle/TextBox width and Icon size never offer it", () => {
    expect(
      labels(at(src("Template: T", "  Rectangle:", "    width: ¦"))),
    ).not.toContain("auto");
    expect(labels(at(src("Template: T", "  Icon:", "    size: ¦")))).not.toContain("auto");
    expect(
      labels(at(src("Template: T", "  TextBox:", "    width: ¦"))),
    ).not.toContain("auto");
  });

  it("auto must be the whole value — not offered mid-expression", () => {
    expect(
      labels(at(src("Template: T", "  Image:", "    width: 1 + ¦"))),
    ).not.toContain("auto");
  });

  it("y_units: offers auto; x_units: offers nothing", () => {
    expect(labels(at(src("Card: M", "  y_units: ¦")))).toEqual(["auto"]);
    expect(at(src("Card: M", "  x_units: ¦")).suggestions).toEqual([]);
  });

  it("width_mm:/height_mm: are literal positions — nothing offered", () => {
    expect(at(src("Card: M", "  width_mm: ¦")).suggestions).toEqual([]);
    expect(at(src("Card: M", "  height_mm: ¦")).suggestions).toEqual([]);
  });

  it("Repeat: header is an expression until `as`, then naming silence", () => {
    const r = at(src("Template: T", "  Repeat: ¦"));
    expect(labels(r)).toContain("if");
    expect(at(src("Template: T", "  Repeat: [cost] as ¦")).suggestions).toEqual([]);
  });

  it("block-header name positions are silent", () => {
    for (const opener of ["Enum", "Sheet", "Template", "Card"]) {
      expect(at(`${opener}: ¦`).suggestions).toEqual([]);
    }
    expect(at(src("Template: T", "  Rectangle: ¦")).suggestions).toEqual([]); // label
  });

  it("column type position offers Text/Number and enum names", () => {
    expect(labels(at(src("Sheet: S", "  column power: ¦")))).toEqual([
      "Text", "Number", "Suit", "Rarity",
    ]);
  });

  it("value continuation lines inherit the property's expected type (◆23†)", () => {
    const r = at(src("Template: T", "  Rectangle:", "    color:", "      ¦"));
    expect(labels(r)).toContain("red");
    // A same-indent sibling line is a KEY position, not a continuation.
    const sibling = at(src("Template: T", "  Rectangle:", "    color: red", "    ¦"));
    expect(labels(sibling)).toEqual(["x", "y", "width", "height", "color", "pivot"]);
  });
});

// ---------------------------------------------------------------------------
// Icon codes
// ---------------------------------------------------------------------------

describe("icon code strings", () => {
  it("offers every Dicier code with its category as detail", () => {
    const r = at(src("Template: T", "  Icon:", '    code: "¦"'));
    expect(r.suggestions).toHaveLength(DICIER_CODES.size);
    expect(byLabel(r, "HEARTS").detail).toBe("card suits");
    for (const s of r.suggestions) expect(s.detail).toBeTruthy();
  });

  it("replaces the entire string content (codes may contain spaces)", () => {
    const doc = src("Template: T", "  Icon:", '    code: "HEA¦RTS"');
    const r = at(doc);
    const clean = doc.replace("¦", "");
    expect(r.replaceStart).toBe(clean.indexOf('"HEARTS"') + 1);
    expect(r.replaceEnd).toBe(clean.indexOf('"HEARTS"') + 1 + "HEARTS".length);
  });

  it("an unclosed string replaces to end of line", () => {
    const doc = src("Template: T", "  Icon:", '    code: "HEA¦');
    const r = at(doc);
    const clean = doc.replace("¦", "");
    expect(r.replaceStart).toBe(clean.indexOf('"HEA') + 1);
    expect(r.replaceEnd).toBe(clean.length - 1); // end of the line, before \n
    expect(labels(r)).toContain("HEARTS");
  });

  it("CRLF: an unclosed string's replace range excludes the \\r", () => {
    const raw = ["Template: T", "  Icon:", '    code: "HEA¦', ""].join("\r\n");
    const offset = raw.indexOf("¦");
    const clean = raw.slice(0, offset) + raw.slice(offset + 1);
    const r = computeCompletions(clean, offset, SNAP);
    expect(r.replaceStart).toBe(clean.indexOf('"HEA') + 1);
    expect(r.replaceEnd).toBe(clean.indexOf('"HEA') + 4); // stops before \r\n
    expect(labels(r)).toContain("HEARTS");
  });

  it("works on a ◆23† continuation line under code:", () => {
    const r = at(src("Template: T", "  Icon:", "    code:", '      "¦"'));
    expect(labels(r)).toContain("HEARTS");
  });

  it("outside the string, code: is an ordinary expression position", () => {
    const r = at(src("Template: T", "  Icon:", "    code: ¦"));
    expect(labels(r)).not.toContain("HEARTS");
    expect(labels(r)).toContain("if");
  });
});

// ---------------------------------------------------------------------------
// Enums in expressions
// ---------------------------------------------------------------------------

describe("enum completion", () => {
  it("Enum.| offers that enum's cases", () => {
    const r = at(src("Card: M", "  count: Suit.¦"));
    expect(labels(r)).toEqual(["Rock", "Paper"]);
    expect(byLabel(r, "Rock").detail).toBe("Suit case");
  });

  it("Enum.partial replaces the case segment only", () => {
    const doc = src("Card: M", "  count: Suit.Ro¦");
    const r = at(doc);
    const clean = doc.replace("¦", "");
    expect(r.replaceStart).toBe(clean.indexOf("Ro¦".slice(0, 2)));
    expect(r.replaceEnd).toBe(r.replaceStart + 2);
    expect(labels(r)).toEqual(["Rock", "Paper"]);
  });

  it("an unknown qualifier offers nothing", () => {
    expect(at(src("Card: M", "  count: Nope.¦")).suggestions).toEqual([]);
  });

  it("== against an enum-typed column offers its cases at top priority (◆14)", () => {
    const r = at(src("Card: M", "  sheet: Monsters", "  count: [suit] == ¦"));
    expect(byLabel(r, "Rock").group).toBe(0);
    expect(byLabel(r, "Paper").group).toBe(0);
    // Rock is duplicated across enums — offered ONCE, via the expected type.
    expect(labels(r).filter((l) => l === "Rock")).toHaveLength(1);
  });

  it("== against a qualified Enum.Case derives the expected enum (◆14)", () => {
    const r = at(src("Card: M", "  count: Suit.Rock == ¦"));
    expect(byLabel(r, "Rock").group).toBe(0);
    expect(byLabel(r, "Paper").group).toBe(0);
    expect(labels(at(src("Card: M", "  count: Rarity.Common != ¦"))).slice(0, 2)).toEqual([
      "Common",
      "Rock",
    ]);
  });

  it("an unknown qualifier before == derives no expected type", () => {
    const r = at(src("Card: M", "  count: Nope.X == ¦"));
    expect(r.suggestions.every((s) => s.group !== 0)).toBe(true);
  });

  it("!= against a loop variable offers the loop enum's cases", () => {
    const r = at(src("Card: M", "  sheet: Monsters", "  loop: Rarity as r", "  count: [r] != ¦"));
    expect(byLabel(r, "Common").group).toBe(0);
    expect(byLabel(r, "Common").detail).toBe("Rarity case");
  });

  it("without an expected type: enum names + globally-unique bare cases only", () => {
    const r = at(src("Card: M", "  count: ¦"));
    expect(byLabel(r, "Suit").group).toBe(1);
    expect(byLabel(r, "Paper").group).toBe(1); // unique across enums
    expect(byLabel(r, "Common").group).toBe(1);
    expect(labels(r)).not.toContain("Rock"); // ambiguous bare — must qualify (E004)
    expect(labels(r)).not.toContain("cost"); // columns need [brackets] (◆30)
  });

  it("expression keywords ride along at low priority", () => {
    const r = at(src("Card: M", "  count: ¦"));
    for (const kw of ["if", "then", "else", "and", "or", "not"]) {
      expect(byLabel(r, kw).group).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

describe("robustness", () => {
  it("never throws on out-of-range offsets or an empty snapshot", () => {
    expect(() => computeCompletions("", 0, EMPTY_SNAPSHOT)).not.toThrow();
    expect(() => computeCompletions("abc", 999, EMPTY_SNAPSHOT)).not.toThrow();
    expect(() => computeCompletions("abc", -5, EMPTY_SNAPSHOT)).not.toThrow();
    expect(() => computeCompletions(FIXTURE, FIXTURE.length, SNAP)).not.toThrow();
  });

  it("broken surrounding code still completes (no parse required)", () => {
    const r = at(
      src(
        "Card: ((((",
        "  sheet Monsters",   // missing colon above and here — thoroughly broken
        "  size: ¦",
      ),
    );
    expect(labels(r)).toContain("poker"); // Card context still recognized textually
  });
});

// ---------------------------------------------------------------------------
// Compiler pins — keep the mirrored key tables honest against check.ts
// ---------------------------------------------------------------------------

describe("compiler pins (E008 probes)", () => {
  /** Uses EVERY key the completion tables suggest; must compile clean. */
  const PIN = src(
    "Enum: Suit",
    "  case Rock",
    "  case Paper",
    "Sheet: Monsters",
    "  column name: Text",
    "  column cost: Number",
    "  column suit: Suit",
    "Template: AllKeys",
    "  Rectangle:",
    "    x: 0",
    "    y: 0",
    "    width: full",
    "    height: half",
    "    color: navy",
    "    pivot: bottom_right",
    "  Repeat: [cost] as i",
    "    Text:",
    "      x: middle",
    "      y: 1 + [i]",
    "      size: 1",
    '      text: "Cost: [cost]"',
    "      color: black",
    "      pivot: middle",
    "      font: garamond",
    "  Icon:",
    "    x: middle",
    "    y: 2",
    "    size: 1",
    '    code: "HEARTS"',
    "    color: red",
    "    pivot: right",
    "    style: round_heavy",
    "  Image:",
    "    x: 2",
    "    y: 4",
    "    width: 16",
    "    height: 12",
    '    src: "https://example.com/[name].png"',
    "    fit: cover",
    "    pivot: center",
    "  TextBox:",
    "    x: 2",
    "    y: 17",
    "    width: 16",
    "    height: 8",
    '    text: "Rules: [name]\\nDiscard after use."',
    "    size: 1.1",
    "    color: black",
    "    align: middle",
    "    line_height: 1.3",
    "    overflow: shrink",
    "    pivot: center_right",
    "    font: courier_bold_italic",
    "  Qr:",
    "    x: 2",
    "    y: 26",
    "    size: 2",
    '    data: "https://example.com/[name]"',
    "    color: black",
    "    background: white",
    "    level: h",
    "    pivot: bottom_left",
    "Template: BackT",
    "  Rectangle:",
    "    x: 0",
    "    y: 0",
    "    width: full",
    "    height: full",
    "    color: white",
    "Card: Monster",
    "  sheet: Monsters",
    "  size: poker",
    "  x_units: 20",
    "  y_units: auto",
    "  loop: Suit as s",
    "  count: [cost]",
    "  Front: AllKeys",
    "  Back: BackT",
    // Custom size (§3.4 M2): width_mm/height_mm REPLACE size:, so the pair
    // needs its own Card — mixing them with a preset is E008 by design.
    "Card: Token",
    "  sheet: Monsters",
    "  width_mm: 40",
    "  height_mm: 40",
    "  x_units: 10",
    "  y_units: auto",
    "  Front: BackT",
  );

  it("every suggested key, used together, checks clean (no E008)", () => {
    expect(compileSource(PIN).diagnostics).toEqual([]);
  });

  it("the pin program actually uses every suggested key", () => {
    const cardKeys = labels(at(src("Card: M", "  ¦")));
    const rectKeys = labels(at(src("Template: T", "  Rectangle:", "    ¦")));
    const textKeys = labels(at(src("Template: T", "  Text:", "    ¦")));
    const textBoxKeys = labels(at(src("Template: T", "  TextBox:", "    ¦")));
    const iconKeys = labels(at(src("Template: T", "  Icon:", "    ¦")));
    const imageKeys = labels(at(src("Template: T", "  Image:", "    ¦")));
    const qrKeys = labels(at(src("Template: T", "  Qr:", "    ¦")));
    for (const key of new Set([
      ...cardKeys, ...rectKeys, ...textKeys, ...textBoxKeys, ...iconKeys, ...imageKeys, ...qrKeys,
    ])) {
      expect(PIN, `pin program must use suggested key '${key}:'`).toMatch(
        new RegExp(`^\\s+${key}: `, "m"),
      );
    }
  });

  /** E008 "missing required property 'k:'" names → they must all be offered. */
  function missingKeys(source: string): string[] {
    return compileSource(source)
      .diagnostics.filter(
        (d) => d.code === "E008" && d.message.includes("missing required property"),
      )
      .map((d) => /'([A-Za-z_]+):'/.exec(d.message)![1]);
  }

  it("every key the checker REQUIRES is among the suggestions", () => {
    const cardMissing = missingKeys(src("Card: M", "  count: 1"));
    expect(cardMissing.length).toBeGreaterThan(0);
    const cardKeys = labels(at(src("Card: M", "  ¦")));
    for (const key of cardMissing) expect(cardKeys).toContain(key);

    for (const element of ["Rectangle", "Text", "TextBox", "Icon", "Image", "Qr"] as const) {
      const missing = missingKeys(src("Template: T", `  ${element}:`, "    x: 1"));
      expect(missing.length).toBeGreaterThan(0);
      const offered = labels(at(src("Template: T", `  ${element}:`, "    ¦")));
      for (const key of missing) expect(offered).toContain(key);
    }
  });

  it("offered key sets EQUAL the checker-accepted sets (optionals included)", () => {
    const offered = {
      Card: labels(at(src("Card: M", "  ¦"))),
      Rectangle: labels(at(src("Template: T", "  Rectangle:", "    ¦"))),
      Text: labels(at(src("Template: T", "  Text:", "    ¦"))),
      TextBox: labels(at(src("Template: T", "  TextBox:", "    ¦"))),
      Icon: labels(at(src("Template: T", "  Icon:", "    ¦"))),
      Image: labels(at(src("Template: T", "  Image:", "    ¦"))),
      Qr: labels(at(src("Template: T", "  Qr:", "    ¦"))),
    };
    // Candidate universe: every lowercase key offered on ANY block, plus a
    // decoy that must never be accepted. Front:/Back: are face lines, not
    // E008-probed properties — the clean PIN program pins those. Probing each
    // candidate on each block makes the pin bidirectional for OPTIONAL keys
    // too: an accepted-but-unoffered key (pivot, color, loop, count…) fails
    // the set equality, not just a missing REQUIRED one.
    const candidates = [
      ...new Set(Object.values(offered).flat().filter((k) => /^[a-z]/.test(k))),
      "bogus",
    ];
    const unknownOn = (source: string, key: string, block: string): boolean =>
      compileSource(source).diagnostics.some(
        (d) =>
          d.code === "E008" && d.message.includes(`Unknown property '${key}:' on ${block}`),
      );
    for (const el of ["Rectangle", "Text", "TextBox", "Icon", "Image", "Qr"] as const) {
      const accepted = candidates.filter(
        (k) => !unknownOn(src("Template: T", `  ${el}:`, `    ${k}: 1`), k, el),
      );
      expect([...offered[el]].sort()).toEqual(accepted.sort());
    }
    const acceptedCard = candidates.filter(
      (k) => !unknownOn(src("Card: M", `  ${k}: 1`), k, "Card"),
    );
    expect(
      offered.Card.filter((k) => /^[a-z]/.test(k)).sort(),
    ).toEqual(acceptedCard.sort());
  });

  it("a key the tables don't offer is E008-unknown to the checker too", () => {
    const { diagnostics } = compileSource(
      src("Template: T", "  Rectangle:", "    bogus: 1"),
    );
    expect(diagnostics.some((d) => d.code === "E008" && d.message.includes("'bogus:'"))).toBe(
      true,
    );
    expect(labels(at(src("Template: T", "  Rectangle:", "    ¦")))).not.toContain("bogus");
  });
});
