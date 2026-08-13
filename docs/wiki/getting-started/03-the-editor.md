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
│  your Goblin script,   │  one card, or all of   │
│  squiggles on errors   │  them — front/back     │
├────────────────────────┴────────────────────────┤
│  SPREADSHEET — one tab per Sheet:               │
│  columns from your code, rows from you          │
├─────────────────────────────────────────────────┤
│  9 cards · 0 problems · 0 excluded rows         │
└─────────────────────────────────────────────────┘
```

## Code (top left)

Your Goblin script, in a real code editor (Monaco) with syntax highlighting and
autocomplete. Suggestions appear as you type (or on **Ctrl+Space**) and fit where
your cursor is: your column names inside `[brackets]`, the properties a block
accepts, size presets, [color names](colors.md), enum cases after a `.`, and
[icon codes](icons.md) inside `code:` strings. They come from your latest compile,
so they keep working while the code is broken mid-edit — the moment a `Sheet:`
declares a column, that column is offered everywhere it's legal. Errors appear as
red squiggles where they happen, and the status bar counts how many.

## Preview (top right)

Your generated cards, live. Toggle **Front/Back** and **Export PDF** from the
toolbar, and pick one of two views with the pair of icon buttons next to them:

- **Single card** (the default) — one card, as large as the panel allows. The
  `‹ 3 / 18 ›` control steps through every card in the project, in the order the
  `Card:` blocks declare them, so the arrows carry you from the end of one deck
  into the start of the next. A line above the card says which deck you're in.
- **Grid** — every card at once, grouped by the `Card:` block that made them, with
  a **zoom** slider for card size. Long decks scroll.

The zoom slider only appears in grid view; in single view the card is already
sized to the panel, so making the panel bigger (drag the divider) is the zoom.

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
doesn't compile. To its right sit the editor's project-lifecycle controls:

- **Assets** — opens the drawer of images uploaded from your machine (see
  [Uploaded assets](assets.md)), with a count badge.
- **Export project** / **Import project** — download the whole project as a
  file, or load one back — see [Project files](project-files.md).
- **Reset to demo** — wipes your saved project and loads the demo back. It
  asks first (see [Autosave](autosave.md)).

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

The editor [autosaves](autosave.md) your code and rows to this browser and restores
them when you come back — one save slot, one browser. For anything precious, export
a [project file](project-files.md) too — it's a proper backup that travels.
