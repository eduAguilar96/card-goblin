/**
 * The wiki landing page — a map of the whole thing.
 *
 * Everything on it is derived from the pages on disk, so a new markdown file
 * shows up here and in the sidebar without a code change.
 */

import Link from "next/link";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { loadDocNav } from "@/lib/docs/pages";
import { flattenNav } from "@/lib/docs/nav";
import { absoluteUrl } from "@/lib/site";
import StatusBadge from "./_components/statusBadge";

const DESCRIPTION =
  "How to use CardGoblin: the editor, Goblin script, project storage, and PDF export.";

export const metadata: Metadata = {
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/docs") },
  openGraph: {
    type: "website",
    url: absoluteUrl("/docs"),
    title: "Documentation — Card Goblin",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Documentation — Card Goblin",
    description: DESCRIPTION,
  },
};

export default function DocsIndexPage(): ReactElement {
  const nav = loadDocNav();
  const first = flattenNav(nav)[0];

  return (
    <div>
      <header className="mb-10 border-b border-gray-800 pb-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-white">
          Documentation
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-gray-400">
          CardGoblin turns a small script plus a spreadsheet into print-at-home cards.
          These pages cover the editor, the language, and getting a deck onto paper.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {first !== undefined && (
            <Link
              href={`/docs/${first.slug}`}
              className="rounded-lg bg-teal-500 px-4 py-2 font-semibold text-gray-900 hover:bg-teal-400"
            >
              Start reading
            </Link>
          )}
          <Link
            href="/docs/quickstart"
            className="rounded-lg border border-gray-700 px-4 py-2 font-semibold text-gray-300 hover:bg-gray-800"
          >
            Jump to the quickstart
          </Link>
        </div>
        <p className="mt-6 text-sm text-gray-500">
          CardGoblin is actively being built, so each page carries a badge saying how
          settled its subject is — <StatusBadge status="stable" className="mx-0.5" />{" "}
          <StatusBadge status="evolving" className="mx-0.5" />{" "}
          <StatusBadge status="planned" className="mx-0.5" />.
        </p>
      </header>

      {/* Multi-column rather than a grid: sections have very different
          heights, and grid rows would leave a hole under the short ones. */}
      <div className="sm:columns-2 sm:gap-10">
        {nav.map((section) => (
          <section key={section.id} className="mb-8 break-inside-avoid">
            <h2 className="text-lg font-bold text-white">{section.title}</h2>
            <p className="mt-1 text-sm text-gray-500">{section.blurb}</p>
            <ul className="mt-4 space-y-3">
              {section.pages.map((page) => (
                <li key={page.slug}>
                  <Link href={`/docs/${page.slug}`} className="group block">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-teal-400 group-hover:text-teal-300">
                        {page.title}
                      </span>
                      {page.status !== "stable" && <StatusBadge status={page.status} />}
                    </span>
                    <span className="mt-0.5 block text-sm text-gray-500">
                      {page.summary}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
