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
| `docs/DESIGN.md` | decisions and **why**; the decision log | future implementers |
| `docs/development.md` | how to build, test, navigate | contributors |
| code comments | why *this file* works the way it does | whoever opens it |

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

### Documented facts are tested

[src/lib/docs/\_\_tests\_\_/docFacts.test.ts](src/lib/docs/__tests__/docFacts.test.ts)
asserts the wiki's numbers and tables against the constants they describe —
**bidirectionally**: nothing stated disagrees with the code, and nothing in the code is
missing from the docs. Touching any of these will fail `npm test` until the wiki
matches:

`SIZE_PRESETS` · `CARD_CAP` · `REPEAT_CAP` · `DICIER_CODES` · `CSS_COLOR_NAMES` ·
`KEYWORDS` · `BLOCK_OPENERS` · `DEFAULT_PDF_OPTIONS` · `PAGE_SIZES`

When it fails there are two honest fixes: update the wiki because the code changed, or
update the *pattern* because the prose was legitimately reworded. **Never delete a
check to make it pass** — an unguarded claim is one that will be wrong eventually.

[content.test.ts](src/lib/docs/__tests__/content.test.ts) separately validates
frontmatter, unique slugs, and that every internal link resolves to a page that exists.

## Contracts to respect

Each is documented at its site and enforced by tests:

- `parse`, `check`, `generateModel`, `compileProject` **never throw** — they degrade to
  diagnostics. One bad cell must never blank the deck.
- The RenderModel is **immutable by contract**; `count:` copies share shape arrays —
  derive, never mutate.
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
