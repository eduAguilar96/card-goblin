---
title: Roadmap
status: evolving
summary: What's shipped, what's being built, and what's still an open question.
---

# Roadmap

CardGoblin is a living project. This page says where it actually is — expect it to
change.

## Shipped

**The editor and the language.** Code, live SVG preview, and a schema-driven
spreadsheet, wired together with a ~300 ms live compile. Enums, sheets, templates,
shapes, `Repeat`, the full expression engine, and per-card error isolation — the whole
pipeline from script to rendered deck.

**PDF export.** Page size, margins, spacing, cut lines, crop marks, and
duplex-mirrored backs, rendered at 300 DPI. See [PDF export](01-pdf-export.md).

**Autosave.** Your project — code and rows — survives a reload, saved in your
browser, with a **Reset to demo** escape hatch. See [Autosave](02-autosave.md).

**Autocomplete.** The code editor suggests what fits where your cursor is — column
names, property names, enum cases, color names, icon codes. See
[The editor](../getting-started/03-the-editor.md).

**Custom card sizes.** `width_mm:` + `height_mm:` on a Card, beyond the
[built-in presets](../reference/01-card-sizes.md).

**Icon styles.** All ten Dicier faces (flat/block/round × dark/light/heavy,
plus pixel) via `style:` — see [Icons](../reference/03-icons.md).

**The `Image` element.** Your own artwork on a card, from a URL — with `fit:`
control and PDF embedding. See [Images](../goblin-script/05-images.md).

**Uploaded assets.** An Assets drawer for images local to your machine — upload,
rename, delete, and reference them with `asset:<name>` in any `src:`, no hosting
required. Bundled into [project files](03-project-files.md) so art travels with the
project. See [Uploaded assets](04-assets.md).

**Project files.** Export the project as a file and import it back — backup,
moving between browsers, and keeping more than one project. See
[Project files](03-project-files.md).

**Template composition and parameters.** Templates can declare typed `param`
inputs and call other Templates in source order, including inside `If`, `Else`, and
`Repeat`. Arguments are explicit, so nested layouts stay reusable without hidden
caller state. See [Templates & shapes](../goblin-script/03-templates-and-shapes.md).

**Text wrapping.** The `TextBox` element: multi-line text that wraps in the
compiler itself, so the preview and the PDF always agree — with hard breaks
(`\n` and newlines in cells), alignment, and clip/shrink overflow control. See
[Text & TextBox](../goblin-script/04-text.md).

**Fonts.** Nine bundled faces on `Text` and `TextBox` — Geist (the default)
plus eight more from Cormorant Garamond and Courier Prime — via `font:`, with
wrapping measured against each font's own letterforms. See
[Text & TextBox](../goblin-script/04-text.md).

**QR codes.** The `Qr` element: scannable codes generated straight from sheet
data, with error-correction levels and a scan-safe quiet zone — the idiom for
giving every card in a deck its own code on the back. See
[QR codes](../goblin-script/06-qr-codes.md).

**Inline icons.** `{HEARTS}` and `{asset:skull}` markers draw Dicier glyphs and
uploaded art right inside `Text` and `TextBox` text — including markers that
arrive from cell data — each in a one-em slot that wraps like a word. See
[Inline icons](../goblin-script/04-text.md#inline-icons).

**Reusable resolved text.** `{alias:name}` expands a top-level Text-valued
`let name:` once before inline icon, asset, and color markers are parsed — also
when the alias marker comes from cell data. See
[Text aliases](../goblin-script/04-text.md#reusing-resolved-text-with-aliases).

**Additive color styling.** Image `color:` multiply-tints artwork (white is the
unchanged default), while nested `{color:red}…{/color}` scopes recolor words,
Dicier glyphs, and inline asset art without changing TextBox wrapping. See
[Images](../goblin-script/05-images.md#recolor-white-artwork) and
[Scoped colors](../goblin-script/04-text.md#scoped-colors).

## Further out

- **Sharing by link** — a read-only view of a deck anyone can open. The security,
  hosting cost, expiry, and deletion model still need design before this is a
  promise.
- **Uploaded fonts** — `font:` currently picks from a small bundled set (see
  [Text & TextBox](../goblin-script/04-text.md)); bringing your OWN font file, the way uploaded
  assets already work for images, is a separate, later piece.
- **Rich text in boxes** — inline icons and scoped colors shipped (see
  [Text & TextBox](../goblin-script/04-text.md)); **bold and italic runs** are
  the remaining piece, still a later design round.
- **A browsable icon picker** — search and preview the [888 Dicier
  codes](../reference/03-icons.md) visually instead of typing them from memory.

## Open questions

Things that are genuinely undecided, not just unbuilt:

- **Auto-layout containers** (`Row`, `Stack`) as sugar over `Repeat` — worth the
  language surface, or is index math enough?
- **Inline face templates** — anonymous Template bodies directly beneath `Front:`
  or `Back:`; named Template composition is already shipped.
- **Print fidelity** — bleed, safe zones, and what "print-ready" should mean for a
  professional run rather than a home printer.

## Following along

The design document — including every decision made so far and why — lives in the
repository at [`docs/DESIGN.md`](../../DESIGN.md). If you want to build on
CardGoblin, [`docs/development.md`](../../development.md) is the developer guide.
