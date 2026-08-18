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
duplex-mirrored backs, rendered at 300 DPI. See [PDF export](pdf-export.md).

**Autosave.** Your project — code and rows — survives a reload, saved in your
browser, with a **Reset to demo** escape hatch. See [Autosave](autosave.md).

**Autocomplete.** The code editor suggests what fits where your cursor is — column
names, property names, enum cases, color names, icon codes. See
[The editor](the-editor.md).

**Custom card sizes.** `width_mm:` + `height_mm:` on a Card, beyond the
[built-in presets](card-sizes.md).

**Icon styles.** All ten Dicier faces (flat/block/round × dark/light/heavy,
plus pixel) via `style:` — see [Icons](icons.md).

**The `Image` element.** Your own artwork on a card, from a URL — with `fit:`
control and PDF embedding. See [Images](images.md).

**Uploaded assets.** An Assets drawer for images local to your machine — upload,
rename, delete, and reference them with `asset:<name>` in any `src:`, no hosting
required. Bundled into [project files](project-files.md) so art travels with the
project. See [Uploaded assets](assets.md).

**Project files.** Export the project as a file and import it back — backup,
moving between browsers, and keeping more than one project. See
[Project files](project-files.md).

**Text wrapping.** The `TextBox` element: multi-line text that wraps in the
compiler itself, so the preview and the PDF always agree — with hard breaks
(`\n` and newlines in cells), alignment, and clip/shrink overflow control. See
[Text & TextBox](text.md).

**Fonts.** Nine bundled faces on `Text` and `TextBox` — Geist (the default)
plus eight more from Cormorant Garamond and Courier Prime — via `font:`, with
wrapping measured against each font's own letterforms. See
[Text & TextBox](text.md).

**QR codes.** The `Qr` element: scannable codes generated straight from sheet
data, with error-correction levels and a scan-safe quiet zone — the idiom for
giving every card in a deck its own code on the back. See
[QR codes](qr-codes.md).

**Inline icons.** `{HEARTS}` and `{asset:skull}` markers draw Dicier glyphs and
uploaded art right inside `Text` and `TextBox` text — including markers that
arrive from cell data — each in a one-em slot that wraps like a word. See
[Inline icons](../goblin-script/04-text.md#inline-icons).

**Cloud sync.** An optional, site-operator-configured "Sign in" that mirrors your
project — code, sheet rows, and uploaded images — to a server, so any other
computer signed in with the same password picks up where you left off. One
password, one project, guarded last-write-wins (never a silent overwrite). See
[Cloud sync](cloud-sync.md).

## Further out

- **Sharing by link** — a read-only view of a deck anyone can open, no password,
  separate from cloud sync's one-login mirror.
- **Multiple cloud projects** — [cloud sync](cloud-sync.md) mirrors today's single
  local save slot; keeping several projects in the cloud, the way
  [project files](project-files.md) already let you keep several locally, is a
  later piece.
- **Uploaded fonts** — `font:` currently picks from a small bundled set (see
  [Text & TextBox](text.md)); bringing your OWN font file, the way uploaded
  assets already work for images, is a separate, later piece.
- **Rich text in boxes** — inline icons shipped (see
  [Inline icons](../goblin-script/04-text.md#inline-icons)); **bold and italic
  runs** are the remaining piece, still a later design round.
- **A browsable icon picker** — search and preview the [888 Dicier
  codes](../reference/icons.md) visually instead of typing them from memory.

## Open questions

Things that are genuinely undecided, not just unbuilt:

- **Auto-layout containers** (`Row`, `Stack`) as sugar over `Repeat` — worth the
  language surface, or is index math enough?
- **Template composition** — templates using other templates, and inline templates
  under `Front:`.
- **Print fidelity** — bleed, safe zones, and what "print-ready" should mean for a
  professional run rather than a home printer.

## Following along

The design document — including every decision made so far and why — lives in the
repository at [`docs/DESIGN.md`](../../DESIGN.md). If you want to build on
CardGoblin, [`docs/development.md`](../../development.md) is the developer guide.
