/**
 * sitemap.xml — every indexable URL, generated from the content on disk.
 *
 * Derived, never hand-maintained: adding a wiki page or a post puts it in the
 * sitemap automatically. Drafts are excluded (they carry `noindex` too).
 */

import type { MetadataRoute } from "next";
import { loadPosts } from "@/lib/blog/load";
import { loadDocPages } from "@/lib/docs/pages";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = loadPosts();
  const newestPost = posts[0]?.date;

  return [
    { url: absoluteUrl("/"), changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/editor"), changeFrequency: "monthly", priority: 0.9 },
    { url: absoluteUrl("/docs"), changeFrequency: "weekly", priority: 0.8 },
    {
      url: absoluteUrl("/blog"),
      changeFrequency: "weekly",
      priority: 0.8,
      ...(newestPost ? { lastModified: new Date(`${newestPost}T00:00:00Z`) } : {}),
    },
    ...loadDocPages().map((page) => ({
      url: absoluteUrl(`/docs/${page.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...posts.map((post) => ({
      url: absoluteUrl(`/blog/${post.slug}`),
      lastModified: new Date(`${post.updated ?? post.date}T00:00:00Z`),
      changeFrequency: "yearly" as const,
      priority: 0.7,
    })),
  ];
}
