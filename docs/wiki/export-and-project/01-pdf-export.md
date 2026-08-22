---
title: PDF export
status: evolving
summary: Print options — page size, margins, cut lines, and duplex-mirrored backs.
---

# PDF export

**Export PDF** sits in the preview toolbar. It prints what the preview shows, so if
your code is mid-break the export uses the same last-good render you're looking at.

The button is disabled until there's at least one card to print.

## The preview

Next to the options is a picture of the actual page. It redraws as you change
anything, so margins, spacing, cut lines and the mirrored back pages are all
visible **before** you spend a render on a PDF. The arrows above it step through
every page the export will contain — with duplex backs, page 2 is page 1's mirrored
back.

It's drawn from the same layout the exporter uses, with the same card artwork, so it
can't drift from the file you get. The one thing it can't show you is the 300 DPI
rasterization: on paper the cards are images, here they're live vector art.

## The options

| Option | Default | What it does |
|---|---|---|
| **Page size** | Letter (215.9 × 279.4 mm) | Or A4 (210 × 297 mm). |
| **Backs** | Duplex | How back faces are laid out — see below. |
| **Outer margin (mm)** | 10 | Blank border on every page. Most home printers can't print to the edge. It's a minimum: the card grid is centred left-to-right (that centring is what keeps duplex backs aligned) and starts at the top margin, so the side margins are often a little wider than you asked for. |
| **Card spacing (mm)** | 0 | Gap between cards. `0` means neighbours share a cut line — less cutting, no margin for error. |
| **Cut lines** | Dotted | Lines running edge to edge across the page at every card boundary. Also: off, red, bold. |
| **Cross marks** | Off | Small crop crosses at card corners only. Also: dotted, red, bold. |
| **Print page numbers** | Off | Adds plain text such as `1/10 front` or `1/10 back` immediately below the lowest card row. It never covers a card. A matching front/back pair shares its number, even in Separate mode. |

Guide styles are: **dotted** (0.2 mm dotted black), **red** (0.2 mm solid, easy to see
against dark art), **bold** (0.5 mm solid black).

## Backs

- **Duplex** — after each page of fronts comes the matching page of backs, with columns
  mirrored. That's what makes a double-sided print line up when your printer flips on
  the long edge.
- **Separate** — all front pages first, then all back pages. For manual re-feeding.
- **None** — fronts only.

Cut guides are drawn on back pages too, aligned to the mirrored grid.

When **Print page numbers** is on, numbering counts physical card sheets rather than
PDF pages. That is why matching sides say `1/10 front` and `1/10 back`: the label is
meant to keep those two pages paired after printing. The live page preview shows the
same label before export. The label is placed below the final occupied card row and
is never pulled back over artwork. If the card grid reaches the bottom of the page,
the label can fall outside your printer's printable area or be clipped by the PDF
page; increase the outer margin if you need the label to print.

## How it lays out

Decks never share a page: each `Card:` block starts fresh. Within a deck, as many cards
as fit inside the margins are placed row by row.

If a deck's cards can't fit even once inside the margins, the modal says so and blocks
the export — reduce the margin or spacing, or choose a larger page.

## Quality and errors

- Each **distinct** card face is rendered once at **300 DPI** through the browser's own
  renderer, so fonts and icon ligatures come out exactly as they look in the preview,
  then reused everywhere it appears. A `count: 10` card doesn't cost ten renders.
- While exporting, a progress bar advances through card-face rendering, image
  embedding, page construction, and final PDF saving. Large decks can still take a
  while, but the current stage and percentage remain visible.
- **Error placeholder cards are skipped.** If any exist, the modal warns you how many
  before you export. If *every* card is a placeholder there's nothing to print and
  export is blocked.
- **Images are checked before you export.** When the deck uses
  [`Image`](../goblin-script/05-images.md) shapes, the modal probes their URLs as it opens.
  Embedding an image into the PDF needs the host's permission (the file is fetched
  with `crossorigin=anonymous`, so the server must allow cross-origin use — CORS). Any
  image that can't be embedded is warned about in the modal — "N images could not be
  embedded" — and prints as an amber crossed-out placeholder box. The export itself
  is never blocked by a broken image.
- Copy counts are honoured — a `count: 2` card prints twice.
- The file downloads as `<deckname>.pdf` for a single-deck project, `cardgoblin.pdf`
  otherwise.

Your option choices are remembered until you reload the page.

## Not yet

Bleed, safe zones, CMYK, and per-deck page settings aren't there yet — see the
[roadmap](06-roadmap.md). For a professional print run, check the printer's requirements
before committing.
