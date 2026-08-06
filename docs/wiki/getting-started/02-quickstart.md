---
title: Quickstart
status: stable
summary: The five-minute tour — the demo project, block by block.
---

# Quickstart

The editor opens with a demo project already loaded, so there's nothing to set up.
This page walks through it block by block. Open [the editor](/editor) alongside and
edit as you read — everything recompiles about a third of a second after you stop
typing.

## 1. An Enum — a fixed set of options

```goblin
Enum: Suit
  case Rock
  case Paper
  case Scissors
```

Enums do two jobs: they can **type a spreadsheet column** (its cells become
dropdowns), and they can **drive card generation** via `loop:` — one card per case.

## 2. A Sheet — the spreadsheet's columns

```goblin
Sheet: Monsters
  column name: Text
  column cost: Number
  column health: Number
  column count: Number
```

A `Sheet` declares a tab in the spreadsheet panel and the columns on it. Column types
are `Text`, `Number`, or any Enum you declared. **The code owns the columns; you own
the rows.** Add a column here and it appears in the grid; rename one and the data
follows it.

More in [Sheets and data](sheets-and-data.md).

## 3. A Template — what a card looks like

```goblin
Template: MonsterFront
  Rectangle: "Banner"
    x: 0
    y: 0
    width: full
    height: 3
    color: if [current_suit] == Suit.Rock then grey
           else if [current_suit] == Suit.Paper then gold
           else mediumpurple
  Text: "Title"
    x: middle
    y: 0.7
    size: 1.6
    color: black
    text: [name]
  Repeat: [health] as i
    Icon:
      x: 1.5 + [i] * 2
      y: 25
      size: 1.8
      color: red
      code: "HEARTS"
```

A template is a drawing: shapes listed top to bottom, later ones drawn on top.

- `[name]` and `[health]` pull from the spreadsheet row of whichever card is being
  drawn.
- `[current_suit]` comes from the Card's `loop:` (below).
- **`Repeat:` is the one to notice.** It draws its children N times — here, one heart
  per point of health, each placed by index math (`[i]` counts 0, 1, 2…). One number
  in a cell becomes a row of hearts.

The demo's full template also has a cost label and a suit icon. A back is just another
template:

```goblin
Template: PlainBack
  Rectangle:
    x: 0
    y: 0
    width: full
    height: full
    color: teal
```

More in [Templates and shapes](templates-and-shapes.md).

## 4. A Card — tie it together

```goblin
Card: Monster
  sheet: Monsters
  size: poker
  x_units: 20
  y_units: auto
  loop: Suit as current_suit
  count: [count]
  Front: MonsterFront
  Back: PlainBack
```

A `Card` block says which sheet feeds it, the physical size, the coordinate grid, and
which templates draw the front and back.

Cards are generated as **rows × loop options × count**. With 2 rows, 3 suits, and
counts of 2 and 1, you get 2 × 3 = 6 distinct faces and 9 physical cards. Omit `loop:`
for one card per row; omit `Back:` for a plain white back.

More in [Cards and generation](cards-and-generation.md).

## 5. Try changing things

Each of these exercises a different part of the pipeline:

| Change | What should happen |
|---|---|
| Set Dragon's `health` to 7 | Every Dragon card grows to 7 hearts |
| Set a `cost` cell to `abc` | That cell flags red; only that row's cards become placeholders |
| Delete the `else mediumpurple` line | A squiggle appears; the preview freezes on the last good render |
| Change `then gold` to `then hotpink` | Paper banners recolor |
| Set Dragon's `count` to 5 | The deck grows from 9 to 18 cards |
| Change `"SWORDS"` to `"D6"` | The icon swaps glyph |

Then hit **Export PDF** in the preview toolbar to get it on paper —
see [PDF export](pdf-export.md).
