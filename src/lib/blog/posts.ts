/**
 * Blog post model — pure, no filesystem, no React.
 *
 * Posts live at `content/blog/<YYYY-MM-DD>-<slug>.md`.
 *
 * The date comes from the FILENAME, not frontmatter — one source of truth, and
 * it makes the directory listing chronological for anyone browsing the repo.
 * The slug excludes the date, so `/blog/<slug>` stays stable even if a post is
 * re-dated before publishing. Posts sit in `content/` rather than `docs/`
 * because they're editorial, not documentation; the wiki stays in `docs/wiki`
 * where its GitHub-browsable form is part of the point.
 */

import {
  booleanField,
  listField,
  optionalField,
  parseFrontmatter,
  requireField,
} from "@/lib/content/frontmatter";

export interface PostMeta {
  /** URL slug: `/blog/<slug>`. Unique across the blog. */
  slug: string;
  title: string;
  /** Meta description AND the card blurb — write it for both. */
  description: string;
  /** Publication date, `YYYY-MM-DD`, from the filename. */
  date: string;
  /** Last substantive edit, `YYYY-MM-DD`. Absent when never revised. */
  updated: string | null;
  author: string;
  tags: string[];
  /** Site-relative share image. Absent → the generated one is used. */
  hero: string | null;
  /** Excluded from the index, sitemap, and feed; still builds at its URL. */
  draft: boolean;
  /** Estimated minutes to read, from the body's word count. */
  readingMinutes: number;
}

export interface Post extends PostMeta {
  /** Markdown body with the frontmatter block stripped. */
  body: string;
}

/** Where post markdown lives, repo-relative. */
export const BLOG_ROOT = "content/blog";

const FILENAME = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/;

/**
 * Split `2026-08-06-dicemancy-design-log.md` into its date and slug.
 * Returns null when the filename doesn't carry a date — the loader turns that
 * into a build error naming the file, rather than guessing a date.
 */
export function parsePostFileName(
  fileName: string,
): { date: string; slug: string } | null {
  const match = FILENAME.exec(fileName);
  if (match === null) return null;
  const [, date, slug] = match;
  return Number.isNaN(Date.parse(date)) ? null : { date, slug };
}

/** Average adult prose speed; good enough for a "5 min read" badge. */
const WORDS_PER_MINUTE = 220;

export function readingMinutes(body: string): number {
  const words = body
    .replace(/```[\s\S]*?```/g, " ") // code blocks aren't read at prose speed
    .split(/\s+/)
    .filter((word) => /\w/.test(word)).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Parse one post file. Throws (naming the file) on anything malformed. */
export function parsePost(raw: string, fileName: string): Post {
  const named = parsePostFileName(fileName);
  if (named === null) {
    throw new Error(
      `${BLOG_ROOT}/${fileName}: filename must be <YYYY-MM-DD>-<slug>.md`,
    );
  }

  const source = `${BLOG_ROOT}/${fileName}`;
  const { fields, body } = parseFrontmatter(raw, source);
  const updated = optionalField(fields, "updated");
  if (updated !== "" && Number.isNaN(Date.parse(updated))) {
    throw new Error(`${source}: "updated" is not a YYYY-MM-DD date — ${updated}`);
  }

  return {
    slug: named.slug,
    date: named.date,
    title: requireField(fields, "title", source),
    description: requireField(fields, "description", source),
    updated: updated === "" ? null : updated,
    author: optionalField(fields, "author", "Eduardo Aguilar"),
    tags: listField(fields, "tags"),
    hero: optionalField(fields, "hero") || null,
    draft: booleanField(fields, "draft"),
    readingMinutes: readingMinutes(body),
    body,
  };
}

/** Newest first — the blog's canonical order. Ties break by slug. */
export function sortPosts<T extends PostMeta>(posts: readonly T[]): T[] {
  return [...posts].sort(
    (a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug),
  );
}

/** Drop drafts. Applied to the index, the sitemap, and the feed. */
export function published<T extends PostMeta>(posts: readonly T[]): T[] {
  return posts.filter((post) => !post.draft);
}

/**
 * `2026-08-06` → `August 6, 2026`. Fixed to UTC and en-US so the server's
 * locale and timezone can't shift a published date by a day.
 */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** `2026-08-06` → `Aug 2026`, for the compact cards on the landing page. */
export function formatMonth(date: string): string {
  return new Date(`${date}T00:00:00Z`)
    .toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short" })
    .toUpperCase();
}

/** RFC-822 timestamp for RSS `pubDate`. */
export function toRfc822(date: string): string {
  return new Date(`${date}T00:00:00Z`).toUTCString();
}
