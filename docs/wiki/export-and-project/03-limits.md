---
title: Current limits
status: evolving
summary: What CardGoblin can't do yet, so you find out here and not mid-project.
---

# Current limits

CardGoblin is young and moving. These are the walls you're most likely to hit — better
to read them now than to discover them three hours into a deck.

## Text

- **Single line, no wrapping.** A `Text` shape is one line; long text runs off the
  card rather than flowing. Break it into several `Text` shapes yourself.
- **One font.** Text renders in the app's built-in font. Custom fonts aren't
  supported yet ([icons](icons.md) are their own font and do work).

## Images

- **No `Image` element yet.** Icons cover a lot of ground — 888 glyphs — but you can't
  place your own artwork on a card. This is the most-requested gap and is next up.

## Persistence

- **One save slot, this browser only.** Your project [autosaves](autosave.md) and
  survives reloads, but there are no project files yet — nothing to export, import,
  or sync between browsers — and two open editor tabs overwrite each other (the last
  one to change wins).

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
