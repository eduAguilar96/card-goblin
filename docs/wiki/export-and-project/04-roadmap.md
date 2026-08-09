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

## Being built next

- **`Image` element** — place your own artwork on a card. The biggest gap today.
- **Autocomplete** — column names, enum cases, and icon codes offered as you type.
- **Custom card sizes** — beyond the [five presets](card-sizes.md).
- **Icon styles** — Dicier ships several (flat, block, round, pixel); only one is
  wired up.

## Further out

- **Projects and sharing** — export and import a project file, then accounts and
  shared decks.
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
