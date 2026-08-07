/**
 * The blog index — every published post, newest first.
 */

import type { Metadata } from "next";
import type { ReactElement } from "react";
import { loadPosts } from "@/lib/blog/load";
import { SITE_NAME, absoluteUrl } from "@/lib/site";
import PostCard from "./_components/postCard";

const TITLE = "Blog";
const DESCRIPTION =
  "Release notes, design logs, and notes on building CardGoblin — a tool that turns a script and a spreadsheet into print-ready cards.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: absoluteUrl("/blog"),
    types: { "application/rss+xml": absoluteUrl("/blog/rss.xml") },
  },
  openGraph: {
    type: "website",
    title: `${TITLE} — ${SITE_NAME}`,
    description: DESCRIPTION,
    url: absoluteUrl("/blog"),
  },
};

export default function BlogIndexPage(): ReactElement {
  const posts = loadPosts();

  return (
    <div>
      <header className="mb-10 border-b border-gray-800 pb-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-white">Blog</h1>
        <p className="mt-3 max-w-2xl text-lg text-gray-400">{DESCRIPTION}</p>
        <a
          href="/blog/rss.xml"
          className="mt-4 inline-block text-sm text-teal-400 hover:text-teal-300"
        >
          Subscribe via RSS
        </a>
      </header>

      {posts.length === 0 ? (
        <p className="text-gray-500">No posts yet — the first one is being written.</p>
      ) : (
        <div className="space-y-5">
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
