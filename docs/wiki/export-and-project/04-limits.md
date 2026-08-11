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
  [`TextBox`](templates-and-shapes.md) is for.
- **One look per box.** A `TextBox` wraps plain text in a single font, size, and
  color — no bold runs or inline icons inside the flow yet.
- **One font.** Text renders in the app's built-in font. Custom fonts aren't
  supported yet ([icons](icons.md) are their own font and do work).

## Images

- **URLs only.** The [`Image` element](templates-and-shapes.md) pulls artwork from the
  web; there's no way to upload a file into the project yet, so the art has to be
  hosted somewhere.
- **PDF embedding needs CORS.** An image displays in the preview from any URL, but
  embedding it into an exported PDF requires the host to allow cross-origin use —
  see [PDF export](pdf-export.md). Hosts that don't cooperate print as placeholder
  boxes.

## Persistence

- **One save slot per browser.** Your project [autosaves](autosave.md) and survives
  reloads, and [project files](project-files.md) cover backup and moving between
  browsers — but the autosave slot is singular, so two open editor tabs overwrite
  each other (the last one to change wins).

## Size caps

- **500 drawn shapes per card** from `Repeat`.
- **2,000 physical cards per `Card:` block.**

Both exist so a typo in a data cell can't hang the editor. Hitting either truncates
with a note rather than failing.

## Printing

- Colors are RGB; no CMYK conversion or color management.
- No bleed or safe-zone guides — cut lines and crop marks only.
- Card sizes are the [five presets](card-sizes.md); no custom dimensions yet.

## Editing

- No autocomplete for column names, enum cases, or icon codes yet — the checker tells
  you when a name is wrong, but won't offer it.
- No undo across the spreadsheet and code together; they undo independently.

Everything here is on the [roadmap](roadmap.md) in some form. If one of these is
blocking you, that's useful signal — say so.
