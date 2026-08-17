/**
 * The inline-icon marker grammar (DESIGN.md §3.3.2/§3.3.3, M4 — ◆44, §7.5):
 * `{CODE}` / `{asset:name}` on a RESOLVED string, `{{` escape, lone `}`
 * literal — and every non-matching `{...}` staying raw text with NO
 * diagnostic (the grammar is total; nothing here can fail a card).
 */
import { describe, expect, it } from "vitest";
import { DICIER_CODES } from "../dicier-codes";
import { mergeTextSegments, parseInlineMarkers, rawMarkerText } from "../markers";

describe("parseInlineMarkers: the two marker forms", () => {
  it("a dicier marker splits out of surrounding text", () => {
    expect(parseInlineMarkers("pay {HEARTS} now")).toEqual([
      { kind: "text", text: "pay " },
      { kind: "icon", icon: { kind: "dicier", code: "HEARTS" } },
      { kind: "text", text: " now" },
    ]);
  });

  it("an asset marker parses the name after the scheme", () => {
    expect(parseInlineMarkers("{asset:skull}")).toEqual([
      { kind: "icon", icon: { kind: "asset", name: "skull" } },
    ]);
  });

  it("markers back to back parse individually, no text between", () => {
    expect(parseInlineMarkers("{HEARTS}{asset:skull}")).toEqual([
      { kind: "icon", icon: { kind: "dicier", code: "HEARTS" } },
      { kind: "icon", icon: { kind: "asset", name: "skull" } },
    ]);
  });

  it("digit-leading codes parse (the curated list has them — ◆20)", () => {
    expect(DICIER_CODES.has("3_ON_D6")).toBe(true);
    expect(parseInlineMarkers("{3_ON_D6}")).toEqual([
      { kind: "icon", icon: { kind: "dicier", code: "3_ON_D6" } },
    ]);
  });

  it("the one space-containing code parses (OUI ET)", () => {
    expect(DICIER_CODES.has("OUI ET")).toBe(true);
    expect(parseInlineMarkers("{OUI ET}")).toEqual([
      { kind: "icon", icon: { kind: "dicier", code: "OUI ET" } },
    ]);
  });

  it("an UNKNOWN code still parses as a marker — the grammar is the SHAPE, not the list", () => {
    expect(DICIER_CODES.has("HEARTZ")).toBe(false);
    expect(parseInlineMarkers("{HEARTZ}")).toEqual([
      { kind: "icon", icon: { kind: "dicier", code: "HEARTZ" } },
    ]);
  });
});

describe("parseInlineMarkers: escapes and literals", () => {
  it("{{ is a literal { merged into the surrounding text", () => {
    expect(parseInlineMarkers("a {{HEARTS} b")).toEqual([
      { kind: "text", text: "a {HEARTS} b" },
    ]);
  });

  it("a lone } is literal", () => {
    expect(parseInlineMarkers("a } b")).toEqual([{ kind: "text", text: "a } b" }]);
  });

  it("lowercase stays raw text, no marker", () => {
    expect(parseInlineMarkers("{hearts}")).toEqual([{ kind: "text", text: "{hearts}" }]);
  });

  it("empty braces stay raw text", () => {
    expect(parseInlineMarkers("{}")).toEqual([{ kind: "text", text: "{}" }]);
  });

  it("an unclosed brace stays raw text to the end", () => {
    expect(parseInlineMarkers("open {HEARTS")).toEqual([
      { kind: "text", text: "open {HEARTS" },
    ]);
  });

  it("an invalid asset name (digit-leading) stays raw text", () => {
    expect(parseInlineMarkers("{asset:9lives}")).toEqual([
      { kind: "text", text: "{asset:9lives}" },
    ]);
  });

  it("a non-marker brace does NOT swallow a valid marker after it", () => {
    expect(parseInlineMarkers("{bad {HEARTS}")).toEqual([
      { kind: "text", text: "{bad " },
      { kind: "icon", icon: { kind: "dicier", code: "HEARTS" } },
    ]);
  });

  it("empty input parses to no segments; text without braces is one segment", () => {
    expect(parseInlineMarkers("")).toEqual([]);
    expect(parseInlineMarkers("plain")).toEqual([{ kind: "text", text: "plain" }]);
  });

  it("never emits two adjacent text segments (contract for the wrap tokenizer)", () => {
    const segments = parseInlineMarkers("a {{ b {no} c {HEARTS} d");
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i - 1].kind === "text" && segments[i].kind === "text").toBe(false);
    }
  });
});

describe("rawMarkerText / mergeTextSegments (the D005 downgrade helpers)", () => {
  it("rawMarkerText restores the source spelling of both forms", () => {
    expect(rawMarkerText({ kind: "dicier", code: "HEARTZ" })).toBe("{HEARTZ}");
    expect(rawMarkerText({ kind: "asset", name: "skull" })).toBe("{asset:skull}");
  });

  it("mergeTextSegments fuses neighbors so x{BAD}y is ONE word again", () => {
    expect(
      mergeTextSegments([
        { kind: "text", text: "x" },
        { kind: "text", text: "{BAD}" },
        { kind: "text", text: "y" },
      ]),
    ).toEqual([{ kind: "text", text: "x{BAD}y" }]);
  });
});
