---
title: PDF export
status: evolving
summary: Print options — page size, margins, cut lines, and duplex-mirrored backs.
---

# PDF export

**Export PDF** sits in the preview toolbar. It prints what the preview shows, so if
your code is mid-break the export uses the same last-good render you're looking at.

The button is disabled until there's at least one card to print.

## The options

| Option | Default | What it does |
|---|---|---|
| **Page size** | Letter (215.9 × 279.4 mm) | Or A4 (210 × 297 mm). |
| **Backs** | Duplex | How back faces are laid out — see below. |
| **Outer margin (mm)** | 10 | Blank border on every page. Most home printers can't print to the edge. |
| **Card spacing (mm)** | 0 | Gap between cards. `0` means neighbours share a cut line — less cutting, no margin for error. |
| **Cut lines** | Dotted | Lines running edge to edge across the page at every card boundary. Also: off, red, bold. |
| **Cross marks** | Off | Small crop crosses at card corners only. Also: dotted, red, bold. |

Guide styles are: **dotted** (0.2 mm dotted black), **red** (0.2 mm solid, easy to see
against dark art), **bold** (0.5 mm solid black).

## Backs

- **Duplex** — after each page of fronts comes the matching page of backs, with columns
  mirrored. That's what makes a double-sided print line up when your printer flips on
  the long edge.
- **Separate** — all front pages first, then all back pages. For manual re-feeding.
- **None** — fronts only.

Cut guides are drawn on back pages too, aligned to the mirrored grid.

## How it lays out

Decks never share a page: each `Card:` block starts fresh. Within a deck, as many cards
as fit inside the margins are placed row by row.

If a deck's cards can't fit even once inside the margins, the modal says so and blocks
the export — reduce the margin or spacing, or choose a larger page.

## Quality and errors

- Each **distinct** card face is rendered once at **300 DPI** through the browser's own
  renderer, so fonts and icon ligatures come out exactly as they look in the preview,
  then reused everywhere it appears. A `count: 10` card doesn't cost ten renders.
- **Error placeholder cards are skipped.** If any exist, the modal warns you how many
  before you export. If *every* card is a placeholder there's nothing to print and
  export is blocked.
- Copy counts are honoured — a `count: 2` card prints twice.
- The file downloads as `<deckname>.pdf` for a single-deck project, `cardgoblin.pdf`
  otherwise.

Your option choices are remembered until you reload the page.

## Not yet

Bleed, safe zones, CMYK, and per-deck page settings aren't there yet — see the
[roadmap](roadmap.md). For a professional print run, check the printer's requirements
before committing.
