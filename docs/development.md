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
| `npm test` | full vitest suite (~420 tests, sub-second) |
| `npx tsc --noEmit` | strict type check |
| `npm run lint` | ESLint (prints a `next lint` deprecation notice — needs migration before Next 16) |
| `npm run build` | production build — must stay green with `/editor` static |
| `npm run generate:dicier` | regenerate `src/lib/lang/dicier-codes.ts` from the vendored codes file |

## Code map

```
src/lib/lang/            the compiler (pure, no React)
  lexer.ts               indentation-aware tokenizer
  parser.ts              error-tolerant recursive descent + Pratt expressions → AST
  check.ts               binder + type checker → diagnostics + Bindings
  eval.ts, generate.ts   evaluator + card-set generator → RenderModel
  model.ts               RenderModel types (the renderer's entire input)
  index.ts               compileSource / compileProject entry points
  demoProject.ts         the seeded demo (kept byte-identical to DESIGN.md §3.9)
src/app/editor/
  _store/editorStore.ts  Zustand store: debounced compile, keep-last-good, rename migration
  _components/           Monaco window (windowCode), SVG preview (windowPreview,
                         cardSvg, deckSection, previewVirtual), bespoke grid
                         (windowSpreadsheet, gridModel), statusBar, panelLayout,
                         PDF export (pdfExportModal, pdfLayout, pdfRaster, pdfAssemble)
  _lib/goblinLanguage.ts Monaco language registration (Monarch)
src/lib/docs/            the wiki content layer (pure + one fs module)
  nav.ts                 sections, slug/order conventions, link resolution
  frontmatter.ts         page frontmatter parse
  pages.ts               reads docs/wiki/**.md (build time only)
src/app/docs/            the /docs route: layout, index, [slug], sidebar, markdown
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

`src/lib/docs/__tests__/content.test.ts` validates the real content: frontmatter,
unique slugs, and every internal link pointing at a page that exists. A broken
cross-link fails `npm test`.

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
9. **Front/back + zoom** — toolbar toggle (teal backs), zoom slider.
10. **Icons** — change `"SWORDS"` to `"D6"`: glyph swaps; a bogus code warns and
    renders as raw text (by design).

Headless browser screenshot (no driver installed; one-shot only):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --window-size=1600,1000 --screenshot=/tmp/editor.png http://localhost:3000/editor
```

## Making changes

- The language's behavior is specced in DESIGN.md — change the spec first, then the
  code, then the tests. Diagnostic codes (E/W/D) are cataloged in §3.8.
- New Dicier releases: drop the package under `docs/vendor/`, update the path in
  `scripts/generate-dicier-codes.mjs`, run `npm run generate:dicier`.
- Roadmap: DESIGN.md §6 (M2 — PDF export, Image element, autocomplete, autosave) and
  §7 (M3 — persistence, assets, sharing).
