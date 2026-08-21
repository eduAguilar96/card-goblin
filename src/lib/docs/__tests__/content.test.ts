/**
 * Integration test over the REAL wiki content in `docs/wiki/`.
 *
 * The unit tests above prove the machinery; this one proves the pages. It is
 * the guard rail that makes the wiki safe to edit casually: a typo'd
 * frontmatter key, a duplicate slug, or a cross-link to a page that no longer
 * exists fails `npm test` instead of shipping.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { headingId } from "@/app/_components/markdown";
import { loadDocNav, loadDocPages } from "@/lib/docs/pages";
import { SECTIONS, WIKI_ROOT, flattenNav, parseFileName, resolveDocHref } from "@/lib/docs/nav";

const pages = loadDocPages();
const slugs = new Set(pages.map((page) => page.slug));
const repoRoot = process.cwd();
const wikiRoot = resolve(repoRoot, WIKI_ROOT);
const sourceBySlug = new Map<string, string>();

for (const section of SECTIONS) {
  const dir = join(wikiRoot, section.id);
  if (!existsSync(dir)) continue;
  for (const fileName of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
    sourceBySlug.set(parseFileName(fileName).slug, join(dir, fileName));
  }
}

/** Markdown inline links: `[text](target)`. Reference-style links aren't used. */
function linkTargets(body: string): string[] {
  // Match from the label's closing bracket so labels containing inline code
  // such as [`[row]`](...) are covered too.
  return [...body.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]);
}

/** IDs created by the shared markdown renderer (h2-h4 only). */
function renderedHeadingIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(/^#{2,4}\s+(.+)$/gm)) {
    const text = match[1]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .trim();
    ids.add(headingId(text));
  }
  return ids;
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

  it("keeps admin-only cloud sync out of the public wiki", () => {
    expect(slugs.has("cloud-sync")).toBe(false);
    for (const page of pages) {
      expect(`${page.summary}\n${page.body}`, `${page.slug} advertises cloud sync`).not.toMatch(
        /cloud[ -]sync/i,
      );
    }
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

  it("uses relative paths that really exist when read on GitHub", () => {
    const broken: string[] = [];
    for (const page of pages) {
      const source = sourceBySlug.get(page.slug);
      if (source === undefined) throw new Error(`No source file for ${page.slug}`);
      for (const target of linkTargets(page.body)) {
        if (/^[a-z]+:/i.test(target) || target.startsWith("/") || target.startsWith("#")) {
          continue;
        }
        const rawPath = decodeURIComponent(target.split("#", 1)[0]);
        const destination = resolve(dirname(source), rawPath);
        if (!existsSync(destination)) {
          broken.push(`${relative(repoRoot, source)} → ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("points wiki anchors at headings the site actually renders", () => {
    const broken: string[] = [];
    for (const page of pages) {
      const source = sourceBySlug.get(page.slug);
      if (source === undefined) throw new Error(`No source file for ${page.slug}`);
      for (const target of linkTargets(page.body)) {
        const hashAt = target.indexOf("#");
        if (hashAt === -1) continue;
        const hash = target.slice(hashAt + 1);
        if (hash === "") continue;
        const rawPath = target.slice(0, hashAt);
        const destination = rawPath === "" ? source : resolve(dirname(source), rawPath);
        if (!destination.startsWith(`${wikiRoot}/`) || !destination.endsWith(".md")) continue;
        if (!existsSync(destination)) continue; // reported by the path test above
        const headings = renderedHeadingIds(readFileSync(destination, "utf8"));
        if (!headings.has(hash)) broken.push(`${page.slug} → ${target}`);
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
