/**
 * Reading posts off disk — the one impure module in `src/lib/blog`.
 *
 * Server-only, and in practice build-only: `/blog` and `/blog/[slug]` are
 * statically generated, so these reads happen during `next build`. Keeping
 * `fs` isolated here is what lets `posts.ts` stay unit-testable.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BLOG_ROOT,
  parsePost,
  parsePostFileName,
  published,
  sortPosts,
  type Post,
} from "./posts";

/**
 * Every post, newest first, INCLUDING drafts.
 *
 * Duplicate slugs throw: slugs are the URL space, and a silent collision
 * would make one post unreachable.
 */
export function loadAllPosts(): Post[] {
  const dir = join(process.cwd(), BLOG_ROOT);

  let fileNames: string[];
  try {
    fileNames = readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch {
    return []; // no posts yet is a legal state, not a build failure
  }

  const posts: Post[] = [];
  const seen = new Map<string, string>();

  for (const fileName of fileNames) {
    const named = parsePostFileName(fileName);
    if (named === null) {
      throw new Error(`${BLOG_ROOT}/${fileName}: filename must be <YYYY-MM-DD>-<slug>.md`);
    }
    const previous = seen.get(named.slug);
    if (previous !== undefined) {
      throw new Error(`Duplicate post slug "${named.slug}": ${previous} and ${fileName}`);
    }
    seen.set(named.slug, fileName);
    posts.push(parsePost(readFileSync(join(dir, fileName), "utf8"), fileName));
  }

  return sortPosts(posts);
}

/** Published posts only, newest first — the index, sitemap, and feed view. */
export function loadPosts(): Post[] {
  return published(loadAllPosts());
}

/**
 * One post by slug, drafts included.
 *
 * Drafts stay reachable at their URL so you can preview and share one before
 * publishing; they're simply absent from the index, sitemap, and feed, and
 * carry `noindex` (see the route).
 */
export function loadPost(slug: string): Post | null {
  return loadAllPosts().find((post) => post.slug === slug) ?? null;
}

/** The N most recent published posts — the landing page's strip. */
export function loadRecentPosts(limit: number): Post[] {
  return loadPosts().slice(0, limit);
}
