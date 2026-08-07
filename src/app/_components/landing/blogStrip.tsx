/**
 * "From the blog" — recent posts as a horizontally scrolling strip.
 *
 * Scroll-snap rather than a carousel, deliberately: every post stays in the
 * DOM (so crawlers and screen readers get all of them), it needs no
 * JavaScript, it swipes natively on touch, and it simply becomes a row on a
 * wide screen. A carousel would hide most of the content behind interaction —
 * the opposite of what a section built for SEO should do.
 *
 * Renders nothing when there are no published posts, so the landing page has
 * no empty hole before the first post ships.
 */

import Link from "next/link";
import type { ReactElement } from "react";
import PostCard from "@/app/blog/_components/postCard";
import { loadRecentPosts } from "@/lib/blog/load";

export default function BlogStrip(): ReactElement | null {
  const posts = loadRecentPosts(6);
  if (posts.length === 0) return null;

  return (
    <section className="border-t border-gray-800 bg-gray-950 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white">
              From the blog
            </h2>
            <p className="mt-2 text-gray-400">
              Release notes, design logs, and what I&apos;m learning building this.
            </p>
          </div>
          <Link
            href="/blog"
            className="shrink-0 text-sm font-medium text-teal-400 hover:text-teal-300"
          >
            All posts →
          </Link>
        </div>

        {/* -mx/px pair lets cards bleed to the screen edge while scrolling,
            so the last one doesn't look clipped by the container. */}
        <ul className="-mx-4 mt-8 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
          {posts.map((post) => (
            <li key={post.slug} className="flex">
              <PostCard post={post} variant="tile" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
