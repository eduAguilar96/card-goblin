/**
 * Integration test over the REAL wiki content in `docs/wiki/`.
 *
 * The unit tests above prove the machinery; this one proves the pages. It is
 * the guard rail that makes the wiki safe to edit casually: a typo'd
 * frontmatter key, a duplicate slug, or a cross-link to a page that no longer
 * exists fails `npm test` instead of shipping.
 */

import { describe, expect, it } from "vitest";
import { loadDocNav, loadDocPages } from "@/lib/docs/pages";
import { SECTIONS, flattenNav, resolveDocHref } from "@/lib/docs/nav";

const pages = loadDocPages();
const slugs = new Set(pages.map((page) => page.slug));

/** Markdown inline links: `[text](target)`. Reference-style links aren't used. */
function linkTargets(body: string): string[] {
  return [...body.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]);
}

describe("wiki content", () => {
  it("loads every page without throwing", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it("gives every declared section at least one page", () => {
    const nav = loadDocNav();
    for (const section of SECTIONS) {
      const found = nav.find((s) => s.id === section.id);
      expect(found?.pages.length, `section "${section.id}" has no pages`).toBeGreaterThan(0);
    }
  });

  it("has a unique slug per page", () => {
    expect(slugs.size).toBe(pages.length);
  });

  it("starts every page with an h1 (so the files read as documents on GitHub)", () => {
    for (const page of pages) {
      expect(page.body.startsWith("# "), `${page.slug} does not open with "# "`).toBe(true);
    }
  });

  it("keeps summaries short enough for the sidebar and index cards", () => {
    for (const page of pages) {
      expect(page.summary.length, `${page.slug}'s summary is long`).toBeLessThanOrEqual(110);
    }
  });

  it("resolves every internal wiki link to a page that exists", () => {
    const broken: string[] = [];
    for (const page of pages) {
      for (const target of linkTargets(page.body)) {
        const resolved = resolveDocHref(target, page.section, "https://repo");
        if (!resolved.startsWith("/docs/")) continue;
        const slug = resolved.slice("/docs/".length).split("#")[0];
        if (!slugs.has(slug)) broken.push(`${page.slug} → ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("only links app routes that exist", () => {
    const known = new Set(["/editor", "/docs"]);
    const bad: string[] = [];
    for (const page of pages) {
      for (const target of linkTargets(page.body)) {
        if (!target.startsWith("/")) continue;
        if (!known.has(target.split("#")[0])) bad.push(`${page.slug} → ${target}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("puts the reading order in a sensible place", () => {
    // Reading order drives prev/next; the first page should be the overview.
    const ordered = flattenNav(loadDocNav());
    expect(ordered[0].slug).toBe("what-is-cardgoblin");
  });
});
