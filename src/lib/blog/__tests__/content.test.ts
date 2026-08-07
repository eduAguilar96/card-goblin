/**
 * Integration test over the REAL posts in `content/blog/`.
 *
 * Same guard rail as the wiki's: broken frontmatter, a duplicate slug, or a
 * link to a page that no longer exists fails `npm test` instead of shipping.
 * Posts link into the wiki heavily (that's the SEO strategy), so a renamed
 * wiki page silently breaking every post is a real risk this closes.
 */

import { describe, expect, it } from "vitest";
import { loadAllPosts, loadPosts } from "@/lib/blog/load";
import { renderRssFeed, escapeXml } from "@/lib/blog/rss";
import { loadDocPages } from "@/lib/docs/pages";

const posts = loadAllPosts();
const docSlugs = new Set(loadDocPages().map((page) => page.slug));

/** Markdown inline links: `[text](target)`. */
function linkTargets(body: string): string[] {
  return [...body.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]);
}

describe("blog content", () => {
  it("loads every post without throwing", () => {
    expect(posts.length).toBeGreaterThan(0);
  });

  it("has a unique slug per post", () => {
    expect(new Set(posts.map((p) => p.slug)).size).toBe(posts.length);
  });

  it("starts every post with an h1 so the files read on GitHub", () => {
    for (const post of posts) {
      expect(post.body.startsWith("# "), `${post.slug} does not open with "# "`).toBe(true);
    }
  });

  it("keeps descriptions in the range search engines actually show", () => {
    for (const post of posts) {
      expect(
        post.description.length,
        `${post.slug}'s description is ${post.description.length} chars`,
      ).toBeGreaterThanOrEqual(50);
      expect(post.description.length).toBeLessThanOrEqual(200);
    }
  });

  it("links only to wiki pages that exist", () => {
    const broken: string[] = [];
    for (const post of posts) {
      for (const target of linkTargets(post.body)) {
        if (!target.startsWith("/docs/")) continue;
        const slug = target.slice("/docs/".length).split("#")[0];
        if (!docSlugs.has(slug)) broken.push(`${post.slug} → ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("links only app routes that exist", () => {
    const known = new Set(["/editor", "/docs", "/blog", "/"]);
    const bad: string[] = [];
    for (const post of posts) {
      for (const target of linkTargets(post.body)) {
        if (!target.startsWith("/")) continue;
        const path = target.split("#")[0];
        if (known.has(path) || path.startsWith("/docs/") || path.startsWith("/blog/")) {
          continue;
        }
        bad.push(`${post.slug} → ${target}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("rss feed", () => {
  it("escapes the XML predefined entities", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &apos; f",
    );
  });

  it("renders published posts as well-formed-looking RSS", () => {
    const feed = renderRssFeed(loadPosts(), {
      title: "Feed",
      description: "Desc",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/blog/rss.xml",
      postUrl: (post) => `https://example.com/blog/${post.slug}`,
    });

    expect(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(feed).toContain("<rss version=\"2.0\"");
    expect(feed.trimEnd().endsWith("</rss>")).toBe(true);
    // One <item> per published post, and no raw ampersands outside entities.
    expect([...feed.matchAll(/<item>/g)]).toHaveLength(loadPosts().length);
    expect(/&(?!(amp|lt|gt|quot|apos);)/.test(feed)).toBe(false);
  });

  it("excludes drafts from the feed", () => {
    const drafts = posts.filter((post) => post.draft);
    expect(drafts.length, "expected at least one draft to make this meaningful")
      .toBeGreaterThan(0);

    const feed = renderRssFeed(loadPosts(), {
      title: "Feed",
      description: "Desc",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/blog/rss.xml",
      postUrl: (post) => `https://example.com/blog/${post.slug}`,
    });
    for (const draft of drafts) {
      expect(feed).not.toContain(draft.title);
    }
  });
});
