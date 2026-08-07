/**
 * The landing page.
 *
 * Ordered as the questions a visitor actually asks: what is this → show me it
 * working → how would I use it → what can it do → what's new → let me try.
 * The old page never showed the product at all; the two sections that matter
 * most now are the script→deck showcase (the whole idea in one screen, using
 * REAL compiled cards) and the editor screenshot.
 *
 * Everything here is static: the only client JavaScript is what `CardFaceSvg`
 * brings along, and the cards themselves are prerendered SVG in the HTML.
 */

import Image from "next/image";
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import SiteFooter from "@/app/_components/siteFooter";
import SiteHeader from "@/app/_components/siteHeader";
import BlogStrip from "@/app/_components/landing/blogStrip";
import ShowcaseDeck from "@/app/_components/landing/showcaseDeck";
import { SHOWCASE_SOURCE } from "@/app/_components/landing/showcase";

export default function HomePage(): ReactElement {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      <SiteHeader />
      <Hero />
      <ScriptToDeck />
      <HowItWorks />
      <Features />
      <BlogStrip />
      <FinalCta />
      <SiteFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Hero(): ReactElement {
  return (
    <header className="relative overflow-hidden border-b border-gray-800">
      {/* Teal wash, kept behind the content and out of the accessibility tree. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(20,184,166,0.18),transparent_60%)]"
      />
      <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-teal-400">
            Free · Runs in your browser
          </p>
          <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-6xl">
            Design one card.
            <br />
            Get the whole deck.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-400">
            CardGoblin turns a small script plus a spreadsheet into print-ready cards.
            Describe a card once, let your data fill in the rest, and export a PDF that
            prints true to size.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/editor"
              className="rounded-xl bg-teal-500 px-6 py-3 text-lg font-semibold text-gray-900 shadow-lg shadow-teal-500/20 hover:bg-teal-400"
            >
              Start editing
            </Link>
            <Link
              href="/docs/quickstart"
              className="rounded-xl border border-gray-700 px-6 py-3 text-lg font-semibold text-gray-200 hover:bg-gray-800"
            >
              Read the quickstart
            </Link>
          </div>
          <p className="mt-4 text-sm text-gray-500">
            No account, no install. Your project never leaves the browser.
          </p>
        </div>

        {/* The product, immediately. `priority` because this is the LCP image. */}
        <figure className="mt-14 overflow-hidden rounded-xl border border-gray-700 shadow-2xl shadow-black/50">
          <Image
            src="/editor-screenshot.png"
            alt="The CardGoblin editor: Goblin script on the left, a live preview of nine generated monster cards on the right, and the spreadsheet of monster data below."
            width={1600}
            height={1000}
            priority
            className="w-full"
          />
        </figure>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------

function ScriptToDeck(): ReactElement {
  return (
    <section className="border-b border-gray-800 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="The idea"
          title="Your layout is code. Your content is a spreadsheet."
        >
          Write what a card looks like once. Every row of your sheet becomes a card,
          and a number in a cell can become the number of icons drawn on it.
        </SectionHeading>

        <div className="mt-12 grid items-start gap-8 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-500">
              The script
            </p>
            <pre className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-950 p-5 font-mono text-[12.5px] leading-6 text-gray-300">
              <code>{SHOWCASE_SOURCE.trimEnd()}</code>
            </pre>
          </div>

          <div>
            <p className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-500">
              The deck
            </p>
            <div className="rounded-xl border border-gray-800 bg-gray-950 p-5">
              <ShowcaseDeck className="overflow-x-auto pb-2" />
              <dl className="mt-5 space-y-2 text-sm text-gray-400">
                <Fact term="power: 2">two coins drawn</Fact>
                <Fact term="power: 4">four coins drawn</Fact>
                <Fact term="power: 3">three coins drawn</Fact>
              </dl>
              <p className="mt-4 border-t border-gray-800 pt-4 text-sm text-gray-500">
                Change a cell and only the cards using it redraw — about a third of a
                second after you stop typing.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="font-mono text-[13px] text-teal-300">{term}</dt>
      <dd className="text-gray-500">→ {children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

const STEPS = [
  {
    n: "1",
    title: "Declare your columns",
    body: "A Sheet block names the columns your cards need. The spreadsheet panel builds itself to match, and every reference is checked as you type.",
  },
  {
    n: "2",
    title: "Draw the card once",
    body: "A Template is a list of shapes — rectangles, text, icons — positioned on a unit grid. Pull values in with [brackets] and repeat shapes from data.",
  },
  {
    n: "3",
    title: "Fill rows, export the PDF",
    body: "Type your data, watch the deck build live, then export with cut lines and duplex-mirrored backs at exact millimetres.",
  },
];

function HowItWorks(): ReactElement {
  return (
    <section className="border-b border-gray-800 bg-gray-950 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading eyebrow="How it works" title="Three panels, one live loop">
          Code, preview, and spreadsheet stay in sync. Break your script mid-thought
          and the preview holds the last good render instead of going blank.
        </SectionHeading>

        <ol className="mt-12 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.n}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-teal-700 bg-teal-950 font-bold text-teal-300">
                {step.n}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

const FEATURES = [
  {
    title: "Data-driven repeats",
    body: "Repeat: [health] as i draws one shape per point — health bars, cost pips, damage tracks. One number in, N shapes out.",
    href: "/docs/templates-and-shapes",
  },
  {
    title: "888 game icons",
    body: "Dice, card suits, dominoes, coins, tarot suits and more from the Dicier typeface — vector, colorable, and computed from your data.",
    href: "/docs/icons",
  },
  {
    title: "Print-ready PDF",
    body: "Letter or A4, cut lines, crop marks, and duplex-mirrored backs at 300 DPI. Cards come out at exact millimetres, not “about right”.",
    href: "/docs/pdf-export",
  },
  {
    title: "Mistakes stay local",
    body: "A bad cell turns one card into a labelled placeholder — never a blank deck. Typos squiggle in the editor before they ever reach a card.",
    href: "/docs/errors",
  },
  {
    title: "Real expressions",
    body: "Arithmetic, comparisons, and if/then/else anywhere a value goes. Colors, text, icon codes, and positions can all depend on the row.",
    href: "/docs/expressions",
  },
  {
    title: "Decks that scale",
    body: "Rows × loops × copies. Rank-and-suit decks come from a handful of rows, and 500-card decks stay interactive.",
    href: "/docs/cards-and-generation",
  },
];

function Features(): ReactElement {
  return (
    <section className="border-b border-gray-800 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading eyebrow="What you get" title="Built for decks with structure">
          If your game has sixty cards that differ by a name, a number, and an icon,
          this is the part that pays off.
        </SectionHeading>

        <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <Link
                href={feature.href}
                className="group flex h-full flex-col rounded-xl border border-gray-800 bg-gray-900/60 p-6 transition-colors hover:border-teal-700 hover:bg-gray-800/60"
              >
                <h3 className="text-lg font-semibold text-white group-hover:text-teal-300">
                  {feature.title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-gray-400">
                  {feature.body}
                </p>
                <span className="mt-4 text-sm text-teal-500 opacity-0 transition-opacity group-hover:opacity-100">
                  Learn more →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function FinalCta(): ReactElement {
  return (
    <section className="border-b border-gray-800 py-20">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Your deck is mostly data wearing a layout
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-gray-400">
          Stop editing sixty cards by hand. The editor opens with a working demo deck —
          change a number and watch it ripple.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/editor"
            className="rounded-xl bg-teal-500 px-6 py-3 text-lg font-semibold text-gray-900 shadow-lg shadow-teal-500/20 hover:bg-teal-400"
          >
            Start editing — it&apos;s free
          </Link>
          <Link
            href="/docs"
            className="rounded-xl border border-gray-700 px-6 py-3 text-lg font-semibold text-gray-200 hover:bg-gray-800"
          >
            Browse the docs
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold uppercase tracking-wider text-teal-400">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-lg text-gray-400">{children}</p>
    </div>
  );
}
