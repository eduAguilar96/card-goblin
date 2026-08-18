# CardGoblin Developer Guide

How to build, test, and navigate the codebase. The authoritative design — language
spec, architecture decisions, diagnostics catalog, roadmap — is
[docs/DESIGN.md](DESIGN.md); this document is the practical companion.

## Setup

Requires Node.js 22+ (`brew install node@22` on macOS).

```bash
npm install
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server → http://localhost:3000 (editor at `/editor`) |
| `npm test` | full vitest suite (sub-second) |
| `npx tsc --noEmit` | strict type check |
| `npm run lint` | ESLint (prints a `next lint` deprecation notice — needs migration before Next 16) |
| `npm run build` | production build — must stay green with `/editor` static. **Stop `npm run dev` first:** both write to `.next/`, and a production build removes the manifests the dev server is holding open, which makes every route 500 with `ENOENT … routes-manifest.json`. Recovery is `rm -rf .next` + restart dev. |
| `npm run generate:dicier` | regenerate `src/lib/lang/dicier-codes.ts` from the vendored codes file |
| `npm run generate:font-metrics` | regenerate `src/lib/lang/geist-metrics.ts` (from `src/app/fonts/GeistVF.woff`) and `src/lib/lang/font-metrics.ts` (the eight `font:` faces, ◆41) |

## Code map

```
src/lib/lang/            the compiler (pure, no React)
  lexer.ts               indentation-aware tokenizer
  parser.ts              error-tolerant recursive descent + Pratt expressions → AST
  check.ts               binder + type checker → diagnostics + Bindings
  eval.ts, generate.ts   evaluator + card-set generator → RenderModel
  wrap.ts                TextBox wrap engine (pure; measures against geist-metrics.ts/font-metrics.ts)
  geist-metrics.ts       GENERATED Geist advance widths (npm run generate:font-metrics)
  font-metrics.ts        GENERATED advances + ascent for the eight font: faces (◆41), same command
  model.ts               RenderModel types (the renderer's entire input)
  index.ts               compileSource / compileProject entry points
  demoProject.ts         the seeded demo (kept byte-identical to DESIGN.md §3.9)
src/app/editor/
  _store/editorStore.ts  Zustand store: debounced compile, keep-last-good, rename migration
  _store/persistence.ts  localStorage autosave: debounced save, quarantined restore, reset
  _store/sheetsPayload.ts the sheets-shape parse/validate shared by autosave, project
                         files, AND cloud sync (dependency-free — see its module note)
  _store/assetStore.ts   IndexedDB local-asset library: CRUD, 2 MB cap, disabled posture (§7.4)
  _store/cloudSync.ts    §7.6 client controller: injected transport, pull/push/
                         conflict state machine, browser-only singleton
  _components/           Monaco window (windowCode), SVG preview (windowPreview,
                         cardSvg, deckSection, previewSingle, previewVirtual),
                         bespoke grid
                         (windowSpreadsheet, gridModel), statusBar, panelLayout,
                         PDF export (pdfExportModal, pdfLayout, pdfPagePreview,
                         pdfRaster, pdfAssemble), project file export/import
                         (projectFile), the Assets drawer (assetsDrawer, §7.4),
                         the cloud sync status control + sign-in dialog
                         (cloudSyncControl, §7.6), shared prev/next control (pager)
  _lib/goblinLanguage.ts Monaco language registration (Monarch)
src/lib/cloud/            §7.6 server-only cloud sync internals (see docs/deployment.md)
  r2.ts                  storage port: R2 impl (aws4fetch) + in-memory fake
  session.ts             pure crypto: scrypt password hash, HMAC session cookie
  auth.ts                HTTP glue: env → requireSession guard, cookie attributes
  projectPayload.ts       project.json envelope validation (reuses sheetsPayload.ts)
src/app/api/cloud/        the routes: login, logout, project (GET/PUT), assets/presign,
                         assets/[name] (GET/DELETE) — each a thin layer over lib/cloud
src/lib/content/         frontmatter parsing shared by the wiki and the blog
src/lib/docs/            the wiki content layer (pure + one fs module)
  nav.ts                 sections, slug/order conventions, link resolution
  frontmatter.ts         page frontmatter parse
  pages.ts               reads docs/wiki/**.md (build time only)
src/lib/blog/            the blog content layer
  posts.ts               post model, filename/date convention, formatting
  load.ts                reads content/blog/*.md (build time only)
  rss.ts                 RSS 2.0 rendering (pure)
src/lib/site.ts          SITE_URL and identity — every canonical/OG/feed URL
src/app/docs/            the /docs route: layout, index, [slug], sidebar
src/app/blog/            the /blog route: index, [slug], rss.xml, OG images
src/app/_components/     shared chrome: siteHeader, siteFooter, markdown
  landing/               landing sections + the build-time compiled showcase
src/app/sitemap.ts       sitemap.xml, derived from wiki pages + posts
src/app/robots.ts        robots.txt
```

## The wiki

User-facing docs live as markdown in [`docs/wiki/`](wiki) and are rendered by the
`/docs` route — one source, two homes (GitHub and the site).

- **Add a page:** create `docs/wiki/<section>/<NN>-<slug>.md` with `title`, `status`
  (`stable` | `evolving` | `planned`), and `summary` frontmatter. Nothing else to
  edit — the sidebar, index, and prev/next all derive from the files.
- **Reorder:** change the `NN-` filename prefix. **Rename:** the slug is the URL, so
  renaming a file changes its link.
- **Add a section:** one entry in `SECTIONS` (`src/lib/docs/nav.ts`) plus the
  directory.
- **Link between pages** with relative `.md` paths (`../reference/colors.md`) so the
  files stay browsable on GitHub; the renderer rewrites them to `/docs/<slug>`. Links
  that leave the wiki become GitHub URLs.
- Pages are **statically generated** — the `fs` reads happen during `next build`.

Two test files keep the wiki honest, both run by `npm test`:

- `__tests__/content.test.ts` — frontmatter, unique slugs, and every internal link
  pointing at a page that exists. A broken cross-link fails the suite.
- `__tests__/docFacts.test.ts` — the wiki's numbers and tables checked against the
  constants they describe: card-size and PDF page-size presets, generation/repeat
  caps, per-element defaults and closed vocabularies, the Dicier code count, CSS
  color names, reserved words, and timing/size constants — see the file's import
  block for the exact, current list. The checks are **bidirectional**: nothing the
  wiki states may disagree with the code, *and* nothing in the code may be missing
  from the wiki — so adding a sixth card preset fails the suite until it's
  documented. When it fires, fix the docs or fix the pattern; don't delete the check.

The docs contract (which surface owns which fact) is in
[CLAUDE.md](../CLAUDE.md#documentation-contract).

The pipeline: `code + sheet rows → compileProject → {diagnostics, RenderModel}` — the
renderer only ever sees fully resolved shapes.

Contracts to respect (each documented at its site, enforced by tests):

- `parse`, `check`, `generateModel`, `compileProject` **never throw** — they degrade
  to diagnostics.
- The RenderModel is **immutable by contract**; `count:` copies share shape arrays —
  derive, never mutate.
- The preview reads `lastGoodModel`, the grid's tabs read `lastGoodSchema`; red cell
  flags read the *current* compile. The status bar's stale indicator reconciles them.
- Row objects may carry orphaned/`__orphan__*` keys (data preserved across schema
  edits) — the grid must never render keys that aren't in the schema.

## Testing approach

Everything is tested headlessly — no browser automation:

- Compiler stages: direct unit tests (`src/lib/lang/__tests__/`), with
  `fixtures/demo.goblin` as the golden fixture (byte-identical to DESIGN.md §3.9 —
  there's a test for that).
- Store: real `createEditorStore()` instances with `vi.useFakeTimers()` for the
  debounce.
- Components: `renderToStaticMarkup` against real compiled models; interaction logic
  lives in pure, unit-tested functions (`gridModel.ts`, `previewVirtual.ts`).

## Manual smoke test

Run `npm run dev`, open `/editor`, and walk through — each step exercises a specific
subsystem:

1. **Hearts** — change Dragon's `health` 4→7: all Dragon cards show 7 hearts ~300 ms
   later (data binding + Repeat + memoized re-render).
2. **Bad cell** — set a `cost` cell to `abc`: red cell + tooltip; only that row's
   cards become placeholders (per-card isolation).
3. **Broken code** — delete the `else mediumpurple` line: squiggle in Monaco, preview
   and tabs freeze on last good state, status bar shows stale. Undo → live again.
4. **Conditionals** — change `then gold` to `then hotpink`: Paper banners recolor.
5. **Generation math** — set Dragon's `count` to 5: deck 9 → 18 cards.
6. **Pristine rows** — add a row: dimmed + excluded, no error spray; type a name and
   its cards join the deck as placeholders (empty number cells flag red) — fill the
   number cells to render them.
7. **Schema from code** — add `column attack: Number`: column appears. Rename
   `health`→`hp` (column + refs): data migrates.
8. **Enum columns** — add `column suit: Suit`: cells become dropdowns.
9. **Views, front/back, zoom** — the preview opens on the single card; the
   `‹ n/X ›` arrows walk every card of every deck (and across the boundary in a
   multi-deck project). Switch to grid with the toolbar's icon pair: the zoom
   slider replaces the nav. Front/back toggles in both (teal backs).
10. **Icons** — change `"SWORDS"` to `"D6"`: glyph swaps; a bogus code warns and
    renders as raw text (by design).
11. **Export preview** — open Export PDF: the page preview redraws as options
    change (raise the margin → fewer cards per page; cut lines off → lines
    vanish), and paging to 2 shows the duplex back with mirrored columns. Set the
    margin to 100 → fit error, "No pages to lay out", Export disabled.

Headless browser screenshot (no driver installed; one-shot only):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --window-size=1600,1000 --screenshot=/tmp/editor.png http://localhost:3000/editor
```

## Deployment

The app builds and runs with zero configuration — signed-out, fully local editing is
the default and needs nothing set up. The one optional piece is **cloud sync**
(§7.6): turning it on needs six env vars, an R2 bucket, and its CORS policy — see
[`docs/deployment.md`](deployment.md) for the full runbook, and
[`src/lib/cloud/`](../src/lib/cloud) for the code (`r2.ts` the storage port,
`session.ts` the auth crypto, `auth.ts`/`projectPayload.ts` the HTTP glue) plus
`src/app/api/cloud/` for the routes and `src/app/editor/_store/cloudSync.ts` for the
client controller.

## Making changes

- The language's behavior is specced in DESIGN.md — change the spec first, then the
  code, then the tests. Diagnostic codes (E/W/D) are cataloged in §3.8.
- New Dicier releases: drop the package under `docs/vendor/`, update the path in
  `scripts/generate-dicier-codes.mjs`, run `npm run generate:dicier`.
- Roadmap: DESIGN.md §6 (M2 — PDF export, Image element, autocomplete, autosave) and
  §7 (M3 — persistence, assets, sharing).
