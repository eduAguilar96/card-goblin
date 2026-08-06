/**
 * One wiki page.
 *
 * Statically generated: `generateStaticParams` enumerates the markdown files,
 * so the filesystem reads happen at build and the served pages are plain HTML.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { adjacentPages } from "@/lib/docs/nav";
import { stripLeadingHeading } from "@/lib/docs/frontmatter";
import { loadDocNav, loadDocPage, loadDocPages } from "@/lib/docs/pages";
import DocMarkdown from "../_components/docMarkdown";
import StatusBadge from "../_components/statusBadge";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams(): { slug: string }[] {
  return loadDocPages().map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = loadDocPage(slug);
  if (page === null) return {};
  return {
    title: `${page.title} — Card Goblin docs`,
    description: page.summary,
  };
}

export default async function DocPageRoute({ params }: PageProps): Promise<ReactElement> {
  const { slug } = await params;
  const page = loadDocPage(slug);
  if (page === null) notFound();

  const { previous, next } = adjacentPages(loadDocNav(), slug);

  return (
    <article>
      <header className="mb-8 border-b border-gray-800 pb-6">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            {page.title}
          </h1>
          <StatusBadge status={page.status} />
        </div>
        <p className="text-gray-400">{page.summary}</p>
      </header>

      <DocMarkdown body={stripLeadingHeading(page.body)} section={page.section} />

      <nav
        className="mt-14 grid gap-3 border-t border-gray-800 pt-6 sm:grid-cols-2"
        aria-label="Page navigation"
      >
        {previous !== null ? (
          <Link
            href={`/docs/${previous.slug}`}
            className="rounded-lg border border-gray-800 px-4 py-3 hover:border-gray-600 hover:bg-gray-800/40"
          >
            <span className="block text-xs uppercase tracking-wider text-gray-500">
              ← Previous
            </span>
            <span className="mt-1 block font-medium text-teal-400">{previous.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next !== null && (
          <Link
            href={`/docs/${next.slug}`}
            className="rounded-lg border border-gray-800 px-4 py-3 text-right hover:border-gray-600 hover:bg-gray-800/40 sm:col-start-2"
          >
            <span className="block text-xs uppercase tracking-wider text-gray-500">
              Next →
            </span>
            <span className="mt-1 block font-medium text-teal-400">{next.title}</span>
          </Link>
        )}
      </nav>
    </article>
  );
}
