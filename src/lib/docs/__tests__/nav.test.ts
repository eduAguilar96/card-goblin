import { describe, expect, it } from "vitest";
import {
  SECTIONS,
  adjacentPages,
  buildNav,
  flattenNav,
  isDocStatus,
  parseFileName,
  resolveDocHref,
  type DocMeta,
} from "@/lib/docs/nav";

const REPO = "https://github.com/eduAguilar96/card-goblin";

function meta(overrides: Partial<DocMeta> & Pick<DocMeta, "slug" | "section">): DocMeta {
  return {
    order: 1,
    title: overrides.slug,
    status: "stable",
    summary: "…",
    ...overrides,
  };
}

describe("parseFileName", () => {
  it("splits the numeric prefix from the slug", () => {
    expect(parseFileName("03-templates-and-shapes.md")).toEqual({
      order: 3,
      slug: "templates-and-shapes",
    });
  });

  it("keeps leading zeros out of the slug and reads them as numbers", () => {
    expect(parseFileName("07-icons.md")).toEqual({ order: 7, slug: "icons" });
  });

  it("sorts an unprefixed file last rather than failing", () => {
    // A dropped-in draft should appear at the end, not break the wiki.
    expect(parseFileName("draft.md")).toEqual({
      order: Number.POSITIVE_INFINITY,
      slug: "draft",
    });
  });
});

describe("isDocStatus", () => {
  it("accepts the three statuses and nothing else", () => {
    expect(isDocStatus("stable")).toBe(true);
    expect(isDocStatus("evolving")).toBe(true);
    expect(isDocStatus("planned")).toBe(true);
    expect(isDocStatus("draft")).toBe(false);
    expect(isDocStatus("")).toBe(false);
  });
});

describe("buildNav", () => {
  it("groups pages under the declared sections, in declared order", () => {
    const nav = buildNav([
      meta({ slug: "colors", section: "reference", order: 2 }),
      meta({ slug: "quickstart", section: "getting-started", order: 1 }),
    ]);
    expect(nav.map((s) => s.id)).toEqual(SECTIONS.map((s) => s.id));
    expect(nav.find((s) => s.id === "reference")?.pages.map((p) => p.slug)).toEqual([
      "colors",
    ]);
  });

  it("orders pages within a section by their numeric prefix", () => {
    const nav = buildNav([
      meta({ slug: "third", section: "goblin-script", order: 3 }),
      meta({ slug: "first", section: "goblin-script", order: 1 }),
      meta({ slug: "second", section: "goblin-script", order: 2 }),
    ]);
    expect(nav.find((s) => s.id === "goblin-script")?.pages.map((p) => p.slug)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("breaks an order tie by slug so the sidebar is deterministic", () => {
    const nav = buildNav([
      meta({ slug: "beta", section: "reference", order: 1 }),
      meta({ slug: "alpha", section: "reference", order: 1 }),
    ]);
    expect(nav.find((s) => s.id === "reference")?.pages.map((p) => p.slug)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("drops pages in an unknown section instead of inventing one", () => {
    const nav = buildNav([meta({ slug: "stray", section: "typo-section" })]);
    expect(flattenNav(nav)).toHaveLength(0);
    expect(nav).toHaveLength(SECTIONS.length);
  });

  it("keeps a declared section with no pages", () => {
    const nav = buildNav([]);
    expect(nav.map((s) => s.pages)).toEqual(SECTIONS.map(() => []));
  });
});

describe("adjacentPages", () => {
  const nav = buildNav([
    meta({ slug: "a", section: "getting-started", order: 1 }),
    meta({ slug: "b", section: "getting-started", order: 2 }),
    meta({ slug: "c", section: "goblin-script", order: 1 }),
  ]);

  it("walks reading order across section boundaries", () => {
    // b is the last of getting-started; next is the first of goblin-script.
    expect(adjacentPages(nav, "b")).toEqual({
      previous: expect.objectContaining({ slug: "a" }),
      next: expect.objectContaining({ slug: "c" }),
    });
  });

  it("has no previous at the start and no next at the end", () => {
    expect(adjacentPages(nav, "a").previous).toBeNull();
    expect(adjacentPages(nav, "c").next).toBeNull();
  });

  it("returns nothing for an unknown slug", () => {
    expect(adjacentPages(nav, "nope")).toEqual({ previous: null, next: null });
  });
});

describe("resolveDocHref", () => {
  it("maps a same-section relative link to its /docs slug", () => {
    expect(resolveDocHref("09-errors.md", "goblin-script", REPO)).toBe("/docs/errors");
  });

  it("maps a cross-section relative link to its /docs slug", () => {
    expect(resolveDocHref("../reference/02-colors.md", "goblin-script", REPO)).toBe(
      "/docs/colors",
    );
  });

  it("strips the numeric prefix when the link includes it", () => {
    expect(resolveDocHref("../reference/01-card-sizes.md", "goblin-script", REPO)).toBe(
      "/docs/card-sizes",
    );
  });

  it("keeps an anchor on a rewritten link", () => {
    expect(resolveDocHref("expressions.md#types", "goblin-script", REPO)).toBe(
      "/docs/expressions#types",
    );
  });

  it("sends a link that escapes the wiki to GitHub, with the path resolved", () => {
    // ../../DESIGN.md from docs/wiki/<section>/ is docs/DESIGN.md — not
    // DESIGN.md, which is what naive `../` stripping would produce.
    expect(resolveDocHref("../../DESIGN.md", "export-and-project", REPO)).toBe(
      `${REPO}/blob/main/docs/DESIGN.md`,
    );
  });

  it("sends a non-markdown vendored file to GitHub too", () => {
    // The site serves no such file; a passed-through relative path would 404.
    expect(
      resolveDocHref("../../vendor/dicier-v1.5.4/codes.txt", "reference", REPO),
    ).toBe(`${REPO}/blob/main/docs/vendor/dicier-v1.5.4/codes.txt`);
  });

  it("passes through absolute URLs, anchors, and site paths", () => {
    expect(resolveDocHref("https://example.com/x.md", "reference", REPO)).toBe(
      "https://example.com/x.md",
    );
    expect(resolveDocHref("#types", "reference", REPO)).toBe("#types");
    expect(resolveDocHref("/editor", "reference", REPO)).toBe("/editor");
  });
});
