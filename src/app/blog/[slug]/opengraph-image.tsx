/**
 * Per-post share image, generated at build time from the post's own title.
 *
 * This is what a link to a post looks like when pasted into Slack, Discord,
 * Bluesky, or a search result's rich card — the alternative is a bare URL with
 * no preview, which measurably costs clicks. Generating it from frontmatter
 * means every future post gets one for free, with no image assets to make.
 *
 * Satori (what powers ImageResponse) supports a SUBSET of CSS: flexbox only,
 * no grid, no external stylesheets. Keep the markup below plain and inline.
 */

import { ImageResponse } from "next/og";
import { loadAllPosts, loadPost } from "@/lib/blog/load";
import { formatDate } from "@/lib/blog/posts";
import { SITE_NAME } from "@/lib/site";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Card Goblin blog post";

export function generateStaticParams(): { slug: string }[] {
  return loadAllPosts().map((post) => ({ slug: post.slug }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<ImageResponse> {
  const { slug } = await params;
  const post = loadPost(slug);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #0f172a 0%, #134e4a 100%)",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              background: "#2dd4bf",
              display: "flex",
            }}
          />
          <div style={{ color: "#5eead4", fontSize: 28, fontWeight: 700 }}>
            {SITE_NAME}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              color: "white",
              fontSize: post && post.title.length > 60 ? 60 : 72,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: -1.5,
            }}
          >
            {post?.title ?? "Blog"}
          </div>
          {post && (
            <div style={{ color: "#94a3b8", fontSize: 28, marginTop: 24, display: "flex" }}>
              {formatDate(post.date)} · {post.readingMinutes} min read
            </div>
          )}
        </div>

        <div style={{ color: "#5eead4", fontSize: 26, display: "flex" }}>
          Script + spreadsheet → print-ready cards
        </div>
      </div>
    ),
    size,
  );
}
