---
title: Templates & shapes
status: stable
summary: Rectangle, Text, Icon, Repeat — and the unit grid they're placed on.
---

# Templates & shapes

A `Template:` is a named drawing — a list of shapes rendered in the order you write
them, so **later shapes draw on top**.

```goblin
Template: MonsterFront
  Rectangle: "Banner"
    x: 0
    y: 0
    width: full
    height: 3
    color: teal
  Text: "Title"
    x: middle
    y: 0.7
    size: 1.6
    text: [name]
```

A template gets its data from whichever Card is using it — there are no parameters to
pass. The same template can be used by several Cards, and it's checked against each of
them.

## The shapes

| Shape | Required | Optional (default) | Notes |
|---|---|---|---|
| `Rectangle` | `x y width height color` | — | anchored at its top-left corner |
| `Text` | `x y size text` | `color` (black), `anchor` (left) | one line; `size` is text height in units |
| `Icon` | `x y size code` | `color` (black), `anchor` (left), `style` (flat_dark) | a game glyph — see [Icons](icons.md) |
| `Repeat: N as i` | — | — | draws its children N times |

Positioning rules:

- `y` is the **top** of a text or icon line; `x` is its left edge unless anchored.
- `anchor: left | middle | right` chooses which point of the shape `x` refers to.
- `x: middle` is shorthand for "horizontally centered" (Text and Icon only —
  `y: middle` is an error).

## `Repeat` — the interesting one

```goblin
Repeat: [health] as i
  Icon:
    x: 1.5 + [i] * 2
    y: 25
    size: 1.8
    color: red
    code: "HEARTS"
```

`Repeat` draws its children N times, with `[i]` counting **0, 1, 2…**. There's no
layout engine — you position copies with arithmetic, which means rows, columns, grids,
and arcs are all just math on `[i]`.

- The count can come from data (`Repeat: [health] as i`) or be computed.
- Repeats nest freely — a grid is a repeat inside a repeat.
- The count expression must fit on **one line**.
- Cap: **500 drawn copies per card**, so a bad cell can't hang the preview.

## The coordinate grid

Cards use an abstract unit grid, so a layout survives a change of card size and still
prints at exact millimetres.

```goblin
Card: Monster
  size: poker      # 63.5 × 88.9 mm
  x_units: 20      # → 1 unit = 63.5/20 = 3.175 mm
  y_units: auto    # → 28 units tall, units stay square
```

- **`size:`** picks the physical card — see [Card sizes](card-sizes.md).
- **`x_units: N`** slices the card's *width* into N units. One unit = width ÷ N.
- **`y_units: auto`** keeps units square and derives the vertical count. A poker card
  at 20 wide is exactly 28 tall. You *can* force an integer instead, which stretches
  units out of square — you'll get a warning.
- **`full`** means the whole axis and **`half`** means half of it, so `width: full`
  spans the card.

Because units are square under `auto`, a shape that's 2 × 2 units is actually square
on paper.
