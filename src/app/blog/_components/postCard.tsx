/**
 * A post card — used by the blog index and the landing page's strip.
 *
 * `variant` controls shape, not content: `list` is a wide row for the index,
 * `tile` is the fixed-width square for the horizontally scrolling strip. Both
 * lead with the date, because the blog reads as a timeline.
 */

import Link from "next/link";
import type { ReactElement } from "react";
import { formatDate, formatMonth, type PostMeta } from "@/lib/blog/posts";

export default function PostCard({
  post,
  variant = "list",
}: {
  post: PostMeta;
  variant?: "list" | "tile";
}): ReactElement {
  const tile = variant === "tile";

  return (
    <Link
      href={`/blog/${post.slug}`}
      className={`group flex flex-col rounded-xl border border-gray-800 bg-gray-900/60 p-5 transition-colors hover:border-teal-700 hover:bg-gray-800/60 ${
        tile ? "h-full w-72 shrink-0 snap-start sm:w-80" : ""
      }`}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-teal-500">
        <time dateTime={post.date}>{tile ? formatMonth(post.date) : formatDate(post.date)}</time>
        {post.draft && (
          <span className="rounded-full border border-amber-800 bg-amber-950 px-2 py-0.5 text-amber-300">
            Draft
          </span>
        )}
      </div>

      <h3
        className={`mt-2 font-bold text-white group-hover:text-teal-300 ${
          tile ? "text-lg" : "text-xl"
        }`}
      >
        {post.title}
      </h3>

      <p
        className={`mt-2 flex-1 text-sm text-gray-400 ${tile ? "line-clamp-4" : ""}`}
      >
        {post.description}
      </p>

      <div className="mt-4 flex items-center gap-3 text-xs text-gray-500">
        <span>{post.readingMinutes} min read</span>
        {post.tags.length > 0 && (
          <span className="truncate">{post.tags.slice(0, 2).join(" · ")}</span>
        )}
        <span className="ml-auto text-teal-500 opacity-0 transition-opacity group-hover:opacity-100">
          Read →
        </span>
      </div>
    </Link>
  );
}
