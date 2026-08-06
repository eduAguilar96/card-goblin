/**
 * Wiki navigation model — pure, no filesystem, no React.
 *
 * The wiki's structure is *convention over configuration* so that adding a
 * page is a one-file change:
 *
 *   docs/wiki/<section-id>/<NN>-<slug>.md
 *
 * - the DIRECTORY names the section; section order and display titles live in
 *   `SECTIONS` below (sections are rare and deserve a deliberate edit),
 * - the `NN-` filename prefix orders pages *within* a section (renaming a file
 *   is the whole reorder — no second list to keep in sync),
 * - everything else (title, status, summary) is frontmatter on the file.
 *
 * Slugs are FLAT and unique across sections: the page URL is `/docs/<slug>`,
 * never `/docs/<section>/<slug>`. That is deliberate — the wiki will be
 * reorganized as the product moves, and a flat slug means moving a page
 * between sections doesn't break its links.
 */

/** How settled a page's subject matter is. Rendered as a badge (§ statuses
 * are about the *product surface* the page documents, not about the prose). */
export type DocStatus = "stable" | "evolving" | "planned";

export interface DocMeta {
  /** URL slug, unique wiki-wide: `/docs/<slug>`. */
  slug: string;
  /** Section id — the containing directory name. */
  section: string;
  /** Sort key within the section, from the `NN-` filename prefix. */
  order: number;
  title: string;
  status: DocStatus;
  /** One-liner for the index cards and sidebar tooltips. */
  summary: string;
}

export interface DocPage extends DocMeta {
  /** Markdown body with the frontmatter block stripped. */
  body: string;
}

export interface DocSection {
  id: string;
  title: string;
  blurb: string;
  pages: DocMeta[];
}

/**
 * The wiki's top-level shape. Order here is the order in the sidebar.
 *
 * Task-shaped rather than concept-shaped: it follows the order somebody
 * actually learns the tool (what it is → write a script → look things up →
 * print it), which is also the order the material was originally written in.
 */
export const SECTIONS: readonly { id: string; title: string; blurb: string }[] = [
  {
    id: "getting-started",
    title: "Getting started",
    blurb: "What CardGoblin is, and a first deck in five minutes.",
  },
  {
    id: "goblin-script",
    title: "Goblin script",
    blurb: "The language: sheets, templates, shapes, expressions, generation.",
  },
  {
    id: "reference",
    title: "Reference",
    blurb: "Lookup tables — card sizes, colors, icon codes, error codes.",
  },
  {
    id: "export-and-project",
    title: "Export & project",
    blurb: "Getting cards onto paper, and where the project is heading.",
  },
];

const VALID_STATUSES: readonly string[] = ["stable", "evolving", "planned"];

/** True for a status string we know how to render. */
export function isDocStatus(value: string): value is DocStatus {
  return VALID_STATUSES.includes(value);
}

/**
 * Split `03-templates-and-shapes.md` into its sort key and slug.
 * A file without the `NN-` prefix sorts last (order `Infinity`) rather than
 * failing the build — a dropped-in draft should appear, not break the wiki.
 */
export function parseFileName(fileName: string): { order: number; slug: string } {
  const base = fileName.replace(/\.md$/, "");
  const match = /^(\d+)-(.+)$/.exec(base);
  if (match === null) return { order: Number.POSITIVE_INFINITY, slug: base };
  return { order: Number(match[1]), slug: match[2] };
}

/**
 * Group pages into the declared sections, ordered.
 *
 * Pages in an unknown section directory are dropped (with the caller free to
 * warn): a typo'd directory silently creating a fifth unnamed section would
 * be worse than the page not appearing.
 */
export function buildNav(pages: readonly DocMeta[]): DocSection[] {
  return SECTIONS.map((section) => ({
    ...section,
    pages: pages
      .filter((page) => page.section === section.id)
      .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug)),
  }));
}

/** Every page, in sidebar order — the reading order used for prev/next. */
export function flattenNav(nav: readonly DocSection[]): DocMeta[] {
  return nav.flatMap((section) => section.pages);
}

/**
 * The pages either side of `slug` in reading order, crossing section
 * boundaries (the sidebar reads as one document top to bottom).
 */
export function adjacentPages(
  nav: readonly DocSection[],
  slug: string,
): { previous: DocMeta | null; next: DocMeta | null } {
  const ordered = flattenNav(nav);
  const index = ordered.findIndex((page) => page.slug === slug);
  if (index === -1) return { previous: null, next: null };
  return {
    previous: ordered[index - 1] ?? null,
    next: ordered[index + 1] ?? null,
  };
}

/** Where wiki markdown lives, repo-relative — the base for link resolution. */
export const WIKI_ROOT = "docs/wiki";

/** Resolve `to` against directory `base`, collapsing `.` and `..`. */
function resolveRepoPath(base: string, to: string): string {
  const segments = base.split("/").filter((s) => s !== "");
  for (const part of to.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

/**
 * Rewrite a markdown link so the same file reads correctly in both homes.
 *
 * Wiki pages link each other with relative `.md` paths so they stay browsable
 * on GitHub; on the site those must become `/docs/<slug>`. Any OTHER relative
 * link — a sibling `.md` outside the wiki (`../../DESIGN.md`), or a vendored
 * file (`../../vendor/…/codes.txt`) — points at something the site doesn't
 * serve, so it becomes a GitHub URL rather than a 404. Absolute URLs, bare
 * anchors, and site-absolute paths are passed through untouched.
 *
 * `section` is the containing section id of the page holding the link, which
 * is what makes a relative path resolvable at all.
 */
export function resolveDocHref(href: string, section: string, repoUrl: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#") || href.startsWith("/") || href === "")
    return href;

  const [path, hash = ""] = href.split("#", 2);
  const suffix = hash === "" ? "" : `#${hash}`;

  const repoPath = resolveRepoPath(`${WIKI_ROOT}/${section}`, path);
  if (repoPath.startsWith(`${WIKI_ROOT}/`) && repoPath.endsWith(".md")) {
    const fileName = repoPath.slice(repoPath.lastIndexOf("/") + 1);
    return `/docs/${parseFileName(fileName).slug}${suffix}`;
  }
  return `${repoUrl}/blob/main/${repoPath}${suffix}`;
}
