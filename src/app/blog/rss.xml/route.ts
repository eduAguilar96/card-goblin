/**
 * /blog/rss.xml — the feed, generated at build time.
 *
 * `force-static` so it's emitted as a file during `next build` alongside the
 * rest of the site; nothing here needs a running server.
 */

import { loadPosts } from "@/lib/blog/load";
import { renderRssFeed } from "@/lib/blog/rss";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/site";

export const dynamic = "force-static";

export function GET(): Response {
  const body = renderRssFeed(loadPosts(), {
    title: `${SITE_NAME} — Blog`,
    description: SITE_DESCRIPTION,
    siteUrl: SITE_URL,
    feedUrl: absoluteUrl("/blog/rss.xml"),
    postUrl: (post) => absoluteUrl(`/blog/${post.slug}`),
  });

  return new Response(body, {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}
