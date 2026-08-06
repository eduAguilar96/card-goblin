---
title: The editor
status: stable
summary: The three panels, the status bar, and how live compiling behaves.
---

# The editor

The editor lives at [`/editor`](/editor). Three panels and a status bar:

```
┌────────────────────────┬────────────────────────┐
│  CODE                  │  PREVIEW               │
│  your Goblin script,   │  every generated card, │
│  squiggles on errors   │  front/back + zoom     │
├────────────────────────┴────────────────────────┤
│  SPREADSHEET — one tab per Sheet:               │
│  columns from your code, rows from you          │
├─────────────────────────────────────────────────┤
│  12 cards · 0 problems · 1 excluded row         │
└─────────────────────────────────────────────────┘
```

## Code (top left)

Your Goblin script, in a real code editor (Monaco) with syntax highlighting. Errors
appear as red squiggles where they happen, and in the problems strip.

## Preview (top right)

Every generated card, live. Toggle **Front/Back**, zoom with the slider, and
**Export PDF** from the toolbar. Cards are grouped by the `Card:` block that made
them.

While your code has errors, the preview **freezes on the last good result** and shows
an amber note saying so, instead of flickering or emptying. This is the single most
important behaviour in the editor: you can break your code mid-thought and still see
what you were working on.

## Spreadsheet (bottom)

One tab per `Sheet:` you declare in code. The **columns come from your code**; the
**rows are yours to fill**.

- Enum-typed columns become dropdowns.
- A cell whose value doesn't fit its column flags **red**.
- A brand-new, never-edited empty row renders **dimmed** and is excluded from the deck
  until you type into it — so adding a row doesn't spray errors before you can fill it
  in.
- Your data survives schema edits. Rename a column in code (same position, same type)
  and its data comes with it.

## Status bar

Total cards, code problems, flagged cells, and excluded rows — plus a **stale**
indicator when the preview is showing an older render because the current code
doesn't compile.

## The compile loop

Everything recompiles about **300 ms** after you stop typing. One pass does the whole
pipeline:

```
your code ──► parse ──► check ──► generate ──► preview
your rows ──────────────────────────┘
```

Two rules make it feel stable rather than twitchy:

- **Keep last good.** The preview shows the last render that succeeded; the grid's
  tabs and columns come from the last schema that compiled. Neither flickers while
  you're halfway through typing a block.
- **Per-card isolation.** A data problem affects only the cards that touch it. The
  rest of the deck renders normally.

## Saving your work

Projects don't persist across reloads yet — **copy your code out to keep it**. Autosave
and project files are on the [roadmap](roadmap.md).
