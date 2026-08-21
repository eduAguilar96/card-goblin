import { describe, expect, it } from "vitest";
import { CSS_COLOR_NAMES } from "@/lib/lang";
import {
  GOBLIN_ALIAS_MARKER_RE,
  GOBLIN_COLOR_SCOPE_CLOSE_RE,
  GOBLIN_COLOR_SCOPE_OPEN_RE,
  GOBLIN_CONTEXTUAL_BRANCH_RE,
  GOBLIN_CONTEXTUAL_LET_RE,
  GOBLIN_CONTEXTUAL_PARAM_RE,
  GOBLIN_CONTEXTUAL_VIRTUAL_RE,
  GOBLIN_ZERO_PAD_INTERPOLATION_RE,
} from "../goblinLanguage";

describe("Goblin contextual highlighting", () => {
  it("highlights only the declaration form of let", () => {
    expect(GOBLIN_CONTEXTUAL_LET_RE.test("let color: #cc0000")).toBe(true);
    expect(GOBLIN_CONTEXTUAL_LET_RE.test("  let size: 3")).toBe(true);
    expect(GOBLIN_CONTEXTUAL_LET_RE.test("  column let: Text")).toBe(false);
    expect(GOBLIN_CONTEXTUAL_LET_RE.test("Template: let")).toBe(false);
  });

  it("highlights only the declaration form of a Template parameter", () => {
    expect(GOBLIN_CONTEXTUAL_PARAM_RE.test("  param edition: Edition")).toBe(true);
    expect(GOBLIN_CONTEXTUAL_PARAM_RE.test("  param tint: Color")).toBe(true);
    expect(GOBLIN_CONTEXTUAL_PARAM_RE.test("  column param: Text")).toBe(false);
    expect(GOBLIN_CONTEXTUAL_PARAM_RE.test("Template: param")).toBe(false);
  });

  it("highlights structural If:/Else: without reclassifying declaration values", () => {
    expect(GOBLIN_CONTEXTUAL_BRANCH_RE.test("  If: [rare]")).toBe(true);
    expect(GOBLIN_CONTEXTUAL_BRANCH_RE.test("  Else:")).toBe(true);
    expect(GOBLIN_CONTEXTUAL_BRANCH_RE.test("Template: If")).toBe(false);
    expect(GOBLIN_CONTEXTUAL_BRANCH_RE.test("  Front: If")).toBe(false);
    expect(GOBLIN_CONTEXTUAL_BRANCH_RE.test("  column Else: Text")).toBe(false);
  });

  it("highlights virtual only in a virtual-column declaration", () => {
    expect(GOBLIN_CONTEXTUAL_VIRTUAL_RE.test("  virtual column code: Text = [name]")).toBe(true);
    expect(GOBLIN_CONTEXTUAL_VIRTUAL_RE.test("  column virtual: Text")).toBe(false);
    expect(GOBLIN_CONTEXTUAL_VIRTUAL_RE.test("let virtual: 1")).toBe(false);
  });

  it("recognizes only canonical zero-pad interpolation widths 1..64", () => {
    for (const source of ["[card:01]", "[card:04]", "[project_card:064]"]) {
      expect(GOBLIN_ZERO_PAD_INTERPOLATION_RE.test(source), source).toBe(true);
    }
    for (const source of ["[card]", "[card:00]", "[card:001]", "[card:065]", "[card:0x]"]) {
      expect(GOBLIN_ZERO_PAD_INTERPOLATION_RE.test(source), source).toBe(false);
    }
  });

  it("recognizes only actual named/hex colors, case-insensitively", () => {
    for (const name of CSS_COLOR_NAMES) {
      expect(GOBLIN_COLOR_SCOPE_OPEN_RE.test(`{color:${name}}`), name).toBe(true);
    }
    expect(GOBLIN_COLOR_SCOPE_OPEN_RE.test("{color:RED}")).toBe(true);
    expect(GOBLIN_COLOR_SCOPE_OPEN_RE.test("{color:RebeccaPurple}")).toBe(true);
    expect(GOBLIN_COLOR_SCOPE_OPEN_RE.test("{color:#cC0011}")).toBe(true);
    expect(GOBLIN_COLOR_SCOPE_OPEN_RE.test("{color:blurple}")).toBe(false);
    expect(GOBLIN_COLOR_SCOPE_OPEN_RE.test("{color:}")).toBe(false);
    expect(GOBLIN_COLOR_SCOPE_OPEN_RE.test("{color:#fff}")).toBe(false);
  });

  it("recognizes close tags lexically without claiming pair-aware highlighting", () => {
    // Monarch is line-oriented: both regexes recognize their own token even
    // when the other half is absent. Semantic pairing belongs to markers.ts.
    expect(GOBLIN_COLOR_SCOPE_OPEN_RE.test("{color:red}")).toBe(true);
    expect(GOBLIN_COLOR_SCOPE_CLOSE_RE.test("{/color}")).toBe(true);
    expect(GOBLIN_COLOR_SCOPE_CLOSE_RE.test("{/colour}")).toBe(false);
  });

  it("recognizes resolved-text aliases with declaration-name syntax", () => {
    for (const source of ["{alias:badge}", "{alias:rules_line}", "{alias:A1}"]) {
      expect(GOBLIN_ALIAS_MARKER_RE.test(source), source).toBe(true);
    }
    for (const source of ["{alias:}", "{alias:1badge}", "{alias:local-name}"]) {
      expect(GOBLIN_ALIAS_MARKER_RE.test(source), source).toBe(false);
    }
  });
});
