/**
 * One blog post.
 *
 * Statically generated, and carrying the full SEO payload: canonical URL,
 * OpenGraph/Twitter cards, and JSON-LD `BlogPosting` structured data. Drafts
 * build at their URL (so they can be previewed and shared) but are marked
 * `noindex` and never appear in the index, sitemap, or feed.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import ContentMarkdown from "@/app/_components/markdown";
import { stripLeadingHeading } from "@/lib/content/frontmatter";
import { loadAllPosts, loadPost, loadPosts } from "@/lib/blog/load";
import { formatDate, type Post } from "@/lib/blog/posts";
import { SITE_NAME, absoluteUrl } from "@/lib/site";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams(): { slug: string }[] {
  return loadAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = loadPost(slug);
  if (post === null) return {};

  const url = absoluteUrl(`/blog/${post.slug}`);
  return {
    title: post.title,
    description: post.description,
    authors: [{ name: post.author }],
    keywords: post.tags,
    alternates: { canonical: url },
    // A draft is reachable for preview but must never enter the index.
    ...(post.draft ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url,
      siteName: SITE_NAME,
      publishedTime: post.date,
      ...(post.updated ? { modifiedTime: post.updated } : {}),
      authors: [post.author],
      tags: post.tags,
      ...(post.hero ? { images: [absoluteUrl(post.hero)] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
    },
  };
}

/** schema.org BlogPosting — what gives search results their rich treatment. */
function structuredData(post: Post): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    author: { "@type": "Person", name: post.author },
    publisher: { "@type": "Organization", name: SITE_NAME },
    mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
    keywords: post.tags.join(", "),
    ...(post.hero ? { image: absoluteUrl(post.hero) } : {}),
  });
}

export default async function BlogPostPage({ params }: PageProps): Promise<ReactElement> {
  const { slug } = await params;
  const post = loadPost(slug);
  if (post === null) notFound();

  const others = loadPosts().filter((other) => other.slug !== post.slug);

  return (
    <article>
      <script
        type="application/ld+json"
        // Serialized JSON-LD, not user input — the standard Next pattern.
        dangerouslySetInnerHTML={{ __html: structuredData(post) }}
      />

      <nav className="mb-8 text-sm">
        <Link href="/blog" className="text-gray-500 hover:text-white">
          ← All posts
        </Link>
      </nav>

      <header className="mb-8 border-b border-gray-800 pb-6">
        {post.draft && (
          <p className="mb-3 inline-block rounded-full border border-amber-800 bg-amber-950 px-3 py-1 text-xs font-medium text-amber-300">
            Draft — not listed or indexed
          </p>
        )}
        <h1 className="text-4xl font-extrabold tracking-tight text-white">
          {post.title}
        </h1>
        <p className="mt-3 text-lg text-gray-400">{post.description}</p>
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
          <span>{post.author}</span>
          <span aria-hidden>·</span>
          <time dateTime={post.date}>{formatDate(post.date)}</time>
          <span aria-hidden>·</span>
          <span>{post.readingMinutes} min read</span>
          {post.updated !== null && (
            <>
              <span aria-hidden>·</span>
              <span>
                Updated <time dateTime={post.updated}>{formatDate(post.updated)}</time>
              </span>
            </>
          )}
        </div>
        {post.tags.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <li
                key={tag}
                className="rounded-full border border-gray-800 bg-gray-800/50 px-2.5 py-0.5 text-xs text-gray-400"
              >
                {tag}
              </li>
            ))}
          </ul>
        )}
      </header>

      <ContentMarkdown body={stripLeadingHeading(post.body)} />

      <aside className="mt-14 border-t border-gray-800 pt-8">
        <h2 className="text-lg font-bold text-white">Keep reading</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {others.slice(0, 2).map((other) => (
            <Link
              key={other.slug}
              href={`/blog/${other.slug}`}
              className="rounded-lg border border-gray-800 px-4 py-3 hover:border-gray-600 hover:bg-gray-800/40"
            >
              <span className="block text-xs uppercase tracking-wider text-gray-500">
                {formatDate(other.date)}
              </span>
              <span className="mt-1 block font-medium text-teal-400">{other.title}</span>
            </Link>
          ))}
          <Link
            href="/editor"
            className="rounded-lg border border-teal-800 bg-teal-950/40 px-4 py-3 hover:border-teal-600"
          >
            <span className="block text-xs uppercase tracking-wider text-teal-600">
              Try it
            </span>
            <span className="mt-1 block font-medium text-teal-300">
              Open the editor — free, no account
            </span>
          </Link>
        </div>
      </aside>
    </article>
  );
}
