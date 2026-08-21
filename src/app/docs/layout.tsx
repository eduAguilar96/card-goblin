/**
 * Wiki chrome — header, sidebar, content column.
 *
 * The nav tree is loaded once here on the server (build time, since every
 * `/docs` route is static) and handed to the sidebar, so adding a page never
 * touches this file.
 */

import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import { loadDocNav } from "@/lib/docs/pages";
import DocsSidebar from "./_components/sidebar";

export const metadata: Metadata = {
  title: {
    default: "Documentation",
    template: "%s — Card Goblin docs",
  },
  description: "How to use CardGoblin: the editor, Goblin script, and PDF export.",
};

export default function DocsLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const nav = loadDocNav();

  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-900/90 backdrop-blur">
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
            <span className="hidden text-sm text-gray-500 sm:inline">Docs</span>
          </Link>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/" className="text-gray-400 hover:text-white">
              Home
            </Link>
            <Link
              href="/editor"
              className="rounded-lg bg-teal-500 px-3 py-1.5 font-semibold text-gray-900 hover:bg-teal-400"
            >
              Try the Editor
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 lg:flex-row lg:gap-12">
        <DocsSidebar nav={nav} />
        {/* max-w-3xl keeps the measure near 75 characters — long-form prose
            stays readable even though the viewport is much wider. */}
        <main className="min-w-0 max-w-3xl flex-1 pb-16">{children}</main>
      </div>
    </div>
  );
}
