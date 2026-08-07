/**
 * RSS 2.0 feed generation — pure, so it's unit-testable without a route.
 *
 * Hand-built rather than pulling in a feed library: the format is a dozen
 * elements and the only real risk is XML escaping, which is handled here in
 * one place and tested.
 */

import { toRfc822, type PostMeta } from "./posts";

/** Escape the five XML predefined entities. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface FeedOptions {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl: string;
  /** Absolute-URL builder for a post's page. */
  postUrl: (post: PostMeta) => string;
}

/**
 * Render posts as an RSS 2.0 document.
 * Callers pass published posts already sorted newest-first.
 */
export function renderRssFeed(posts: readonly PostMeta[], options: FeedOptions): string {
  const items = posts
    .map((post) =>
      [
        "    <item>",
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(options.postUrl(post))}</link>`,
        `      <guid isPermaLink="true">${escapeXml(options.postUrl(post))}</guid>`,
        `      <description>${escapeXml(post.description)}</description>`,
        `      <pubDate>${toRfc822(post.date)}</pubDate>`,
        `      <author>${escapeXml(post.author)}</author>`,
        ...post.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
        "    </item>",
      ].join("\n"),
    )
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(options.title)}</title>`,
    `    <link>${escapeXml(options.siteUrl)}</link>`,
    `    <description>${escapeXml(options.description)}</description>`,
    "    <language>en-us</language>",
    `    <atom:link href="${escapeXml(options.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
