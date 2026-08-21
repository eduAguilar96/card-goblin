---
title: Current limits
status: evolving
summary: What CardGoblin can't do yet, so you find out here and not mid-project.
---

# Current limits

CardGoblin is young and moving. These are the walls you're most likely to hit — better
to read them now than to discover them three hours into a deck.

## Text

- **`Text` is one line by design** — long text runs off the card rather than
  flowing. Wrapped, multi-line text is what
  [`TextBox`](../goblin-script/04-text.md) is for.
- **No bold/italic spans yet.** A `TextBox` can mix scoped colors and inline
  Dicier/uploaded-asset icons, but font face and size still apply to the whole
  element.
- **Bundled fonts only.** `Text` and `TextBox` offer nine bundled faces through
  `font:`. Uploading an arbitrary font file is not supported yet.

## Images

- **2 MB** per uploaded asset. The [Assets drawer](04-assets.md) caps
  each upload — plenty for print-resolution card art, not a place for
  full-resolution photography.
- **PDF embedding needs CORS for URL art.** An image displays in the preview from
  any URL, but embedding a URL image into an exported PDF requires the host to
  allow cross-origin use — see [PDF export](01-pdf-export.md). Hosts that don't
  cooperate print as placeholder boxes. Uploaded assets don't have this
  limitation — they always embed, since the art never leaves your browser.

## Persistence

- **One save slot per browser.** Your project [autosaves](02-autosave.md) and survives
  reloads, and [project files](03-project-files.md) cover backup and moving between
  browsers — but the autosave slot is singular, so two open editor tabs overwrite
  each other (the last one to change wins).

## Size caps

- **500 Repeat expansions per card.** Every iteration of every `Repeat` counts,
  including nested outer and inner iterations.
- **2,000 physical cards per `Card:` block.**

Both exist so a typo in a data cell can't hang the editor, but their failure posture
differs. Crossing the Repeat budget is D004 and makes the affected card an error
placeholder — no partially truncated face is kept. Crossing the physical-card cap is
D007 and truncates that Card block with a note.

## Printing

- Colors are RGB; no CMYK conversion or color management.
- No bleed or safe-zone guides — cut lines and crop marks only.
- A card bigger than the page can't be split across sheets — [export](01-pdf-export.md)
  reports it instead of tiling it.

## Editing

- **No shared undo.** The code editor and the spreadsheet keep separate undo
  histories — Ctrl+Z in one never rewinds the other.

Most of these are on the [roadmap](06-roadmap.md) in some form. If one of these is
blocking you, that's useful signal — say so.
