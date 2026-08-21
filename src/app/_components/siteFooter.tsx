/**
 * The site footer.
 *
 * The Dicier credit is NOT optional decoration — CC BY 4.0 requires visible
 * attribution with a link to the license text (DESIGN.md §9). Keep both links
 * whatever else changes here.
 */

import Link from "next/link";
import type { ReactElement } from "react";
import { REPO_URL } from "@/lib/site";

export default function SiteFooter(): ReactElement {
  return (
    <footer className="border-t border-gray-800 bg-gray-950">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <p className="font-extrabold tracking-tight text-white">Card Goblin</p>
            <p className="mt-2 text-sm text-gray-500">
              A script plus a spreadsheet becomes a print-at-home deck. Free, in your
              browser.
            </p>
          </div>

          <nav className="flex gap-12 text-sm" aria-label="Footer">
            <div>
              <p className="font-semibold text-gray-300">Product</p>
              <ul className="mt-3 space-y-2 text-gray-500">
                <li>
                  <Link href="/editor" className="hover:text-white">
                    Editor
                  </Link>
                </li>
                <li>
                  <Link href="/docs/quickstart" className="hover:text-white">
                    Quickstart
                  </Link>
                </li>
                <li>
                  <Link href="/docs/roadmap" className="hover:text-white">
                    Roadmap
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-gray-300">More</p>
              <ul className="mt-3 space-y-2 text-gray-500">
                <li>
                  <Link href="/docs" className="hover:text-white">
                    Documentation
                  </Link>
                </li>
                <li>
                  <Link href="/blog" className="hover:text-white">
                    Blog
                  </Link>
                </li>
                <li>
                  <a href={REPO_URL} className="hover:text-white">
                    GitHub
                  </a>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <p className="mt-10 border-t border-gray-800 pt-6 text-xs text-gray-600">
          Game icons:{" "}
          <a
            href="https://speakthesky.itch.io/typeface-dicier"
            className="underline hover:text-gray-400"
          >
            Dicier
          </a>{" "}
          by Speak the Sky, licensed under{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            className="underline hover:text-gray-400"
          >
            CC BY 4.0
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
