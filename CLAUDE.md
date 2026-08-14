# CardGoblin

A browser tool that turns **Goblin script** (a small declarative language) plus a
**spreadsheet** into **print-ready cards**. Next.js App Router, React 18, Tailwind 3,
Zustand, vitest. No backend.

| Command | What it does |
|---|---|
| `npm run dev` | dev server → http://localhost:3000 (editor at `/editor`, docs at `/docs`) |
| `npm test` | full vitest suite (sub-second) |
| `npx tsc --noEmit` | strict type check |
| `npm run build` | production build — must stay green |

## Spec first

The language's behavior is specced in [docs/DESIGN.md](docs/DESIGN.md), including a
decision log with justifications. **Change the spec, then the code, then the tests** —
not the other way round. Diagnostic codes (E/W/D) are cataloged in §3.8.

## Documentation contract

There are four doc surfaces. Each owns one thing; a fact lives in exactly one of them.

| Surface | Owns | Audience |
|---|---|---|
| `docs/wiki/` → `/docs` | what a user does and sees | card designers |
| `content/blog/` → `/blog` | announcements, design logs, releases | prospective users, search |
| `docs/DESIGN.md` | decisions and **why**; the decision log | future implementers |
| `docs/development.md` | how to build, test, navigate | contributors |
| code comments | why *this file* works the way it does | whoever opens it |

Wiki vs blog: the wiki is **reference** — always current, edited in place. The
blog is **dated** — a post records what was true when it was written and is not
retro-edited (use `updated:` for substantive revisions). If a fact needs to stay
correct forever, it belongs in the wiki, and the post links to it.

**The rule: a user-visible behavior change updates its wiki page in the same commit.**

How to route a change:

- *Would a card designer notice or care?* → wiki.
- *Would a future implementer ask "why is it like this?"* → DESIGN.md.
- *Internal refactor, no behavior change?* → **neither**. This half matters: a rule
  that fires on every commit gets ignored.

### Wiki mechanics

Adding a page is one file — no code change:

```
docs/wiki/<section>/<NN>-<slug>.md
---
title: …
status: stable | evolving | planned
summary: one line
---
```

- The `NN-` prefix orders pages within a section; sections are declared in
  [src/lib/docs/nav.ts](src/lib/docs/nav.ts).
- **Slugs are flat and unique wiki-wide** — the URL is `/docs/<slug>`, so a page can
  move between sections without breaking links.
- Link between pages with **relative `.md` paths** (`../reference/colors.md`) so files
  stay readable on GitHub; they're rewritten to `/docs/<slug>` at render. Links that
  leave the wiki become GitHub URLs.
- `status:` describes how settled the **subject** is, not the prose. `evolving` pages
  are the re-read queue at each milestone boundary; `planned` pages are deliberate
  placeholders.

### Blog mechanics

Posts live at `content/blog/<YYYY-MM-DD>-<slug>.md`.

- **The date comes from the FILENAME**, not frontmatter — one source of truth,
  and the directory listing is chronological. The slug excludes the date, so
  `/blog/<slug>` stays stable if a post is re-dated before publishing.
- Frontmatter: `title`, `description` (required — it IS the meta description),
  plus optional `author`, `tags`, `updated`, `hero`, `draft`.
- `draft: true` keeps a post out of the index, sitemap, and RSS feed, and marks
  it `noindex` — but it still builds at its URL so it can be previewed.
- **Link posts into the wiki.** That internal linking is the actual SEO
  strategy: posts that reference `/docs/...` build a topical cluster. A test
  fails if a post links a wiki page that doesn't exist.

### SEO

`src/lib/site.ts` owns every URL and identity string. **`SITE_URL` is a
placeholder** (`https://cardgoblin.app`) until the real domain is set — override
with `NEXT_PUBLIC_SITE_URL`. Canonical links, OpenGraph, JSON-LD, the sitemap,
and the feed all derive from it, so a wrong value silently points search engines
at the wrong host.

Generated automatically, nothing to hand-maintain: `app/sitemap.ts`,
`app/robots.ts`, `/blog/rss.xml`, and per-post share images
(`blog/[slug]/opengraph-image.tsx`, rendered from the post title via `next/og`).

### The landing page shows real output

`src/app/_components/landing/` compiles a real Goblin script at build time and
renders the cards with `CardFaceSvg` — the same markup the editor preview and
PDF rasterizer use. **Don't replace those with screenshots**: compiled output
can't drift from what the product actually makes. `showcase.test.ts` fails if
the showcase stops compiling clean.

The editor screenshot (`public/editor-screenshot.png`) is the one image that
*can* go stale. Regenerate with the app running:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --window-size=1600,1000 --virtual-time-budget=8000 \
  --screenshot=public/editor-screenshot.png http://localhost:3000/editor
```

### Documented facts are tested

[src/lib/docs/\_\_tests\_\_/docFacts.test.ts](src/lib/docs/__tests__/docFacts.test.ts)
asserts the wiki's numbers and tables against the constants they describe —
**bidirectionally**: nothing stated disagrees with the code, and nothing in the code is
missing from the docs. Touching any of these will fail `npm test` until the wiki
matches — the file's import block is the current, authoritative list; the categories
are card-size and PDF page-size presets, generation/repeat caps, per-element defaults
and closed vocabularies (icon style, image fit, QR level, anchor, TextBox overflow),
the Dicier code count, CSS color names, reserved words, and timing/size constants
(autosave debounce, asset upload cap).

When it fails there are two honest fixes: update the wiki because the code changed, or
update the *pattern* because the prose was legitimately reworded. **Never delete a
check to make it pass** — an unguarded claim is one that will be wrong eventually.

[content.test.ts](src/lib/docs/__tests__/content.test.ts) separately validates
frontmatter, unique slugs, and that every internal link resolves to a page that exists.

## Contracts to respect

Each is documented at its site and enforced by tests:

- `parse`, `check`, `generateModel`, `compileProject` **never throw** — they degrade to
  diagnostics. One bad cell must never blank the deck.
- The RenderModel is **immutable by contract**; `count:` copies share one evaluation
  (one Shape array, one hash) unless a face reads `[card]` (§3.6, ◆42), which makes
  copies print different numbers and so forces each to resolve its own — derive,
  never mutate either way.
- The preview reads `lastGoodModel`; the grid's tabs read `lastGoodSchema`; red cell
  flags read the *current* compile. The status bar's stale indicator reconciles them.
- Row objects may carry orphaned `__orphan__*` keys (data preserved across schema
  edits) — the grid must never render keys absent from the schema.

## Code map

See [docs/development.md](docs/development.md) for the full map. In short:
`src/lib/lang/` is the compiler (pure, no React), `src/app/editor/` is the three-panel
editor, `src/lib/docs/` + `src/app/docs/` are the wiki.

## Environment notes

Node 22 via Homebrew. No `timeout` command. Browser checks are one-shot headless
Chrome screenshots — there is no interaction driver, so modal/click flows can't be
verified live; cover them with node tests using the injected seams instead.
