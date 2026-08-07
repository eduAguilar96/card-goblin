---
title: PDF export ships
description: "CardGoblin now exports print-ready PDFs: duplex-mirrored backs, cut lines, crop marks, and 300 DPI faces that match the preview exactly."
tags: release
author: Eduardo Aguilar
draft: true
---

# PDF export ships

> **DRAFT.** Accurate as written, but it's in my voice, not yours — edit the
> tone, then remove `draft: true` from the frontmatter to publish it.

Cards you can't print aren't much use. CardGoblin now turns a deck into a
print-ready PDF, straight from the browser.

Hit **Export PDF** in the preview toolbar and you get a modal with the options
that actually matter for a home printer:

| Option | Default |
|---|---|
| Page size | Letter, or A4 |
| Outer margin | 10 mm |
| Card spacing | 0 mm |
| Cut lines | Dotted — also off, red, or bold |
| Crop marks | Off — also dotted, red, or bold |
| Backs | Duplex, separate, or none |

## The parts worth calling out

**Duplex backs line up.** Choose duplex and every page of fronts is followed by
its backs with the columns mirrored, which is what makes double-sided printing
align when your printer flips on the long edge. Get this wrong and you discover
it after cutting.

**What you see is what prints.** Each distinct card face is rendered at 300 DPI
through the browser's own renderer, so fonts and icon ligatures come out exactly
as they look in the preview. Identical faces are rendered once and reused, so a
`count: 10` card doesn't cost ten renders.

**Cards are exact millimetres.** The unit grid maps to real physical sizes, so a
poker card comes out 63.5 × 88.9 mm — not "about right".

**Broken cards are skipped, and you're told first.** If any card is an error
placeholder, the modal warns you how many before you export rather than
silently printing a grey rectangle.

## What's next

Images on cards, autocomplete, and projects that survive a reload. The
[roadmap](/docs/roadmap) has the current thinking.

- [Export options in detail](/docs/pdf-export)
- [Open the editor](/editor)
