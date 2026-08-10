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
[five presets](card-sizes.md).

**Icon styles.** All ten Dicier faces (flat/block/round × dark/light/heavy,
plus pixel) via `style:` — see [Icons](icons.md).

**The `Image` element.** Your own artwork on a card, from a URL — with `fit:`
control and PDF embedding. See
[Templates & shapes](templates-and-shapes.md).

**Project files.** Export the project as a file and import it back — backup,
moving between browsers, and keeping more than one project. See
[Project files](project-files.md).

## Further out

- **Accounts and sharing** — projects that live in the cloud and decks you can
  share by link, past today's [file-based story](project-files.md).
- **Uploaded assets** — your own images and fonts, stored with the project.
- **Text wrapping** — multi-line text boxes, which need a real layout engine.

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
