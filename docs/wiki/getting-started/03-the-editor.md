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
accepts, size presets, [color names](../reference/02-colors.md), enum cases after a `.`, and
[icon codes](../reference/03-icons.md) inside `code:` strings. Inside a `Text` or
`TextBox` string, typing `{` offers color-scope and
[resolved-text alias](../goblin-script/04-text.md#reusing-resolved-text-with-aliases)
helpers; after `{alias:`, the editor offers top-level lets that the compiler knows
can resolve to Text. Suggestions come from your latest compile,
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
  a **zoom** slider for card size. Long decks scroll. Turn on **Row numbers** to
  place a high-contrast red badge over each card showing the one-based sheet row
  that generated it. These badges are preview aids only and never enter PDF output.

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
- **Sheets can be renamed from the tab bar.** Select a tab and use **Rename**, or
  double-click the tab. CardGoblin updates the `Sheet:` declaration and every
  `Card`'s `sheet:` reference as one edit while preserving the rows. Renaming is
  disabled while the code is broken, and invalid names or collisions are rejected
  without changing the project.
- **Columns are resizable.** Drag the right edge of a column header, or focus its
  resize handle and use the left/right arrow keys. Turn on **Wrap text** in the tab
  bar when you want long Text cells (such as card descriptions) to wrap and grow
  their rows vertically. Number and enum cells stay single-line, and turning wrapping
  off returns Text cells to the compact single-line view without changing their data.
- **The row number is editable.** Click it and type a new position — the row moves
  there and every row between shifts to make room (typing `2` on row 10 of A..J
  yields A J B C D E F G H I; a number ≤ 0 or past the end clamps to the first or last
  row). Typing something that isn't a number, or the row's own current position,
  leaves the grid untouched. This number is exactly what
  [`[row]`](../goblin-script/02-sheets-and-data.md) resolves to inside your templates —
  reordering rows in the grid is how you reorder what your cards print.

## Status bar

Total cards, code problems, flagged cells, and excluded rows — plus a **stale**
indicator when the preview is showing an older render because the current code
doesn't compile. To its right sit the editor's project-lifecycle controls:

- **Assets** — opens the drawer of images uploaded from your machine (see
  [Uploaded assets](../export-and-project/04-assets.md)), with a count badge.
- **Export project** / **Import project** — download the whole project as a
  file, or load one back — see [Project files](../export-and-project/03-project-files.md).
- **Export Data** — download one CSV row per generated card, including virtual
  columns — see [Data export](../export-and-project/08-data-export.md).
- **Reset to demo** — wipes your saved project and loads the demo back. It
  asks first (see [Autosave](../export-and-project/02-autosave.md)).

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

The editor [autosaves](../export-and-project/02-autosave.md) your code and rows to this browser and restores
them when you come back — one save slot, one browser. For anything precious, export
a [project file](../export-and-project/03-project-files.md) too — it's a proper backup that travels.
