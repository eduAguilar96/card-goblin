---
title: Cards & generation
status: stable
summary: The Card block, and the rows × loops × count math that builds a deck.
---

# Cards & generation

A `Card:` block is a card *type*. It binds a sheet, a physical size, a coordinate
grid, and the templates that draw each face.

```goblin
Card: Monster
  sheet: Monsters              # required — which data feeds it
  size: poker                  # required — the physical card
  x_units: 20                  # the coordinate grid
  y_units: auto
  loop: Suit as current_suit   # optional — multiplies the deck
  count: [count]               # optional — copies per card (default 1)
  Front: MonsterFront          # required
  Back: PlainBack              # optional — omitted means a plain white back
```

`sheet:`, `size:`, and `Front:` are required; everything else has a default.
Instead of a `size:` preset, a Card may declare an exact `width_mm:` +
`height_mm:` pair — see [custom sizes](card-sizes.md).

## How many cards you get

For each Card block:

```
for each non-empty row of the bound sheet
  for each combination of loop cases
    emit `count` copies
```

So the deck is **rows × loop options × count**. With the demo's two rows, three suits,
and counts of 2 and 1:

- 2 rows × 3 suits = **6 distinct faces**
- 2+2+2 + 1+1+1 = **9 physical cards**

Multiple `loop:` lines nest in declaration order — rows × suits × elements × … Cases
come out in the order you declared them in the enum.

## `count:`

`count:` is an expression, so it can come from data (`count: [count]`) or be computed
(`count: if [rare] then 1 else 3`). It must evaluate to a whole number of at least 0 —
a `0` simply produces no cards for that row.

## Limits

A single Card block generates at most **2,000 physical cards**. A typo'd count of
`999999` truncates with a note in the status bar instead of freezing the editor. (The
matching per-card limit is 500 drawn shapes from `Repeat`.)

## Several Card blocks

A project can have as many `Card:` blocks as you like, and they can share sheets and
templates. Each becomes its own group in the preview, and in
[PDF export](pdf-export.md) each deck starts on its own page — decks never share a
sheet of paper.

```goblin
Card: Monster
  sheet: Monsters
  size: poker
  ...

Card: Token
  sheet: Tokens
  size: square
  ...
```
