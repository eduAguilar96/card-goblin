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
    edition: CardEdition.Black # required when MonsterFront declares this param
  Back: PlainBack              # optional — omitted means a plain white back
```

`sheet:`, `size:`, and `Front:` are required; everything else has a default.
Instead of a `size:` preset, a Card may declare an exact `width_mm:` +
`height_mm:` pair — see [custom sizes](card-sizes.md).
Indented lines below `Front:` and `Back:` pass explicit arguments to that Template;
see [Template parameters](templates-and-shapes.md).

## How many cards you get

For each Card block:

```
for each non-empty row of the bound sheet
  for each combination of loop cases
    emit `count` copies
```

Those copies are identical unless a face reads a per-instance generation binding such
as [`[copy]`, `[deck_card]`, or `[project_card]`](sheets-and-data.md). Then each copy
resolves on its own, since its number is genuinely different content.

So the deck is **rows × loop options × count**. With the demo's two rows, three suits,
and counts of 2 and 1:

- 2 rows × 3 suits = **6 distinct faces**
- 2+2+2 + 1+1+1 = **9 physical cards**

Multiple `loop:` lines nest in declaration order — rows × suits × elements × … Cases
come out in the order you declared them in the enum.

Every card generated this way can reference its row, copy, deck, deck-relative position,
and project-wide position; see [generation identity](sheets-and-data.md).

## `count:`

`count:` is an expression, so it can come from data (`count: [count]`) or be computed
(`count: if [rare] then 1 else 3`). It must evaluate to a whole number of at least 0 —
a `0` simply produces no cards for that row.

All generation built-ins are legal in `count:`. Because copies do not exist yet, count
uses the prospective first copy of that row × loop combination: `[copy]` is 1,
`[card]`/`[deck_card]` are the next deck position, and `[project_card]` is the next
project position. A legal `count: 0` consumes no deck or project position.

## Limits

A single Card block generates at most **2,000 physical cards**. A typo'd count of
`999999` triggers D007 and truncates that Card block with a note in the status bar
instead of freezing the editor.

Separately, each card instance has a budget of **500 Repeat expansions per card**.
Every iteration of every `Repeat` counts, including the outer and inner iterations
of nested repeats. Crossing that budget is D004: the affected card becomes an error
placeholder rather than keeping a partially truncated face. Other cards continue to
generate normally.

## Several Card blocks

A project can have as many `Card:` blocks as you like, and they can share sheets and
templates. Each becomes its own group in the preview, and in
[PDF export](pdf-export.md) each deck starts on its own page — decks never share a
sheet of paper.

`[card]` intentionally restarts for every Card block; `[deck_card]` is its more explicit
alias. Use `[project_card]` only when you want one running ordinal across every block,
and `[deck]` when the Card declaration name itself is meaningful.

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
