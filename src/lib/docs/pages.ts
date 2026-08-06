/**
 * Loading wiki pages off disk — the one impure module in `src/lib/docs`.
 *
 * Server-only, and in practice build-only: `/docs/[slug]` is statically
 * generated, so these reads happen during `next build` and never at request
 * time. Keeping `fs` isolated here is what lets `nav.ts`/`frontmatter.ts` stay
 * unit-testable without a fixture directory.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDocFile } from "./frontmatter";
import {
  SECTIONS,
  WIKI_ROOT,
  buildNav,
  parseFileName,
  type DocPage,
  type DocSection,
} from "./nav";

/** Absolute path to the wiki content directory. */
function wikiDir(): string {
  return join(process.cwd(), WIKI_ROOT);
}

/**
 * Every page in the wiki, unordered.
 *
 * Only directories named in `SECTIONS` are read — a stray or typo'd directory
 * under `docs/wiki/` is ignored rather than inventing an unnamed section.
 * Duplicate slugs throw: slugs are the URL space, and a silent collision would
 * make one page unreachable.
 */
export function loadDocPages(): DocPage[] {
  const pages: DocPage[] = [];
  const seen = new Map<string, string>();

  for (const section of SECTIONS) {
    const dir = join(wikiDir(), section.id);
    let fileNames: string[];
    try {
      fileNames = readdirSync(dir).filter((name) => name.endsWith(".md"));
    } catch {
      continue; // a declared section with no pages yet is legal
    }

    for (const fileName of fileNames) {
      const source = `${WIKI_ROOT}/${section.id}/${fileName}`;
      const { order, slug } = parseFileName(fileName);
      const previous = seen.get(slug);
      if (previous !== undefined) {
        throw new Error(`Duplicate wiki slug "${slug}": ${previous} and ${source}`);
      }
      seen.set(slug, source);

      const parsed = parseDocFile(readFileSync(join(dir, fileName), "utf8"), source);
      pages.push({ slug, section: section.id, order, ...parsed });
    }
  }

  return pages;
}

/** The full sidebar tree, sections in declared order, pages in file order. */
export function loadDocNav(): DocSection[] {
  return buildNav(loadDocPages());
}

/** One page by slug, or null when the slug isn't a page. */
export function loadDocPage(slug: string): DocPage | null {
  return loadDocPages().find((page) => page.slug === slug) ?? null;
}
