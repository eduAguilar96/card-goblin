/**
 * The site header — one nav across the landing page, wiki, and blog.
 *
 * A server component with no active-link state: the highlight isn't worth
 * making every page that renders a header into a client boundary. The wiki's
 * sidebar already shows where you are within the docs.
 */

import Image from "next/image";
import Link from "next/link";
import type { ReactElement } from "react";

export default function SiteHeader({
  /** Small label after the wordmark, e.g. "Docs" or "Blog". */
  section,
  /** Sticky on long scrolling pages; static on the landing page. */
  sticky = true,
}: {
  section?: string;
  sticky?: boolean;
}): ReactElement {
  return (
    <header
      className={`${
        sticky ? "sticky top-0 z-40 bg-gray-900/90 backdrop-blur" : "bg-transparent"
      } border-b border-gray-800`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/card_goblin_logo_simple_2.svg"
            alt=""
            width={36}
            height={36}
            aria-hidden
          />
          <span className="font-extrabold tracking-tight text-white">Card Goblin</span>
          {section !== undefined && (
            <span className="hidden text-sm text-gray-500 sm:inline">{section}</span>
          )}
        </Link>

        <nav className="flex items-center gap-5 text-sm" aria-label="Main">
          <Link href="/docs" className="text-gray-400 hover:text-white">
            Docs
          </Link>
          <Link href="/blog" className="text-gray-400 hover:text-white">
            Blog
          </Link>
          <Link
            href="/editor"
            className="rounded-lg bg-teal-500 px-3 py-1.5 font-semibold text-gray-900 hover:bg-teal-400"
          >
            Try the Editor
          </Link>
        </nav>
      </div>
    </header>
  );
}
