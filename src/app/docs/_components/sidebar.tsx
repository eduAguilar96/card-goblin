"use client";

/**
 * The wiki sidebar.
 *
 * Client-side only for two reasons: it highlights the active page from the
 * pathname, and it collapses behind a toggle on narrow screens. The nav tree
 * itself is built on the server and passed in — no content crosses the wire
 * beyond titles and slugs.
 *
 * `planned` pages render dimmed rather than hidden: a visible placeholder is
 * honest about the shape of the wiki, and it's the whole point of shipping a
 * structure ahead of the prose.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactElement } from "react";
import type { DocSection } from "@/lib/docs/nav";

export default function DocsSidebar({ nav }: { nav: DocSection[] }): ReactElement {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const activeSlug = pathname.startsWith("/docs/") ? pathname.slice("/docs/".length) : "";

  return (
    <nav className="lg:w-64 lg:flex-shrink-0" aria-label="Documentation">
      {/* Narrow screens: a toggle, so the content isn't pushed below a wall of links. */}
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="mb-4 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 lg:hidden"
      >
        {open ? "▾" : "▸"} All pages
      </button>

      <div
        className={`${open ? "block" : "hidden"} lg:block lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pb-10`}
      >
        {nav.map((section) => (
          <div key={section.id} className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              {section.title}
            </h2>
            <ul className="space-y-0.5 border-l border-gray-800">
              {section.pages.map((page) => {
                const active = page.slug === activeSlug;
                return (
                  <li key={page.slug}>
                    <Link
                      href={`/docs/${page.slug}`}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      title={page.summary}
                      className={`-ml-px block border-l py-1 pl-3 text-sm transition-colors ${
                        active
                          ? "border-teal-400 font-medium text-teal-300"
                          : page.status === "planned"
                            ? "border-transparent text-gray-600 hover:border-gray-600 hover:text-gray-400"
                            : "border-transparent text-gray-400 hover:border-gray-600 hover:text-gray-200"
                      }`}
                    >
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
