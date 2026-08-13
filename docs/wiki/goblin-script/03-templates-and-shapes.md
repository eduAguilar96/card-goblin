---
title: Templates & shapes
status: stable
summary: Templates, the coordinate grid, the shape index, anchors, and Repeat — the drawing model every shape shares.
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
on paper. That's what `width: full` in the template above means: the banner spans the
card, whatever size the card turns out to be.

## The shapes

| Shape | Required | Optional (default) | Notes |
|---|---|---|---|
| `Rectangle` | `x y width height color` | `anchor` (top_left) | a filled box |
| `Text` | `x y size text` | `color` (black), `anchor` (top_left) | one line; `size` is text height in units — see [Text & TextBox](text.md) |
| `TextBox` | `x y width height text size` | `color` (black), `align` (left), `line_height` (1.3), `overflow` (clip), `anchor` (top_left) | wrapped multi-line text in a box — see [Text & TextBox](text.md) |
| `Icon` | `x y size code` | `color` (black), `anchor` (top_left), `style` (flat_dark) | a game glyph — see [Icons](icons.md) |
| `Image` | `x y width height src` | `fit` (contain), `anchor` (top_left) | your own artwork, from a URL or an uploaded asset — see [Images](images.md) |
| `Qr` | `x y size data` | `color` (black), `background` (white), `level` (m), `anchor` (top_left) | a scannable QR code — see [QR codes](qr-codes.md) |
| `Repeat: N as i` | — | — | draws its children N times — see below |

## Anchors — which point `x`/`y` place

Every shape takes an optional `anchor:` naming **which point of the shape** its
`x`/`y` coordinates refer to. Nine points, spelled with underscores, vertical
word first:

| `anchor:` | The point `x`/`y` place |
|---|---|
| `top_left` | top-left corner — **the default** |
| `top_center` | middle of the top edge |
| `top_right` | top-right corner |
| `center_left` | middle of the left edge |
| `center_center` | dead center |
| `center_right` | middle of the right edge |
| `bottom_left` | bottom-left corner |
| `bottom_center` | middle of the bottom edge |
| `bottom_right` | bottom-right corner |

So `anchor: bottom_right` with `x: full` and `y: full` pins a shape to the
card's bottom-right corner, and `anchor: center` with `x: half`, `y: half`
centers it dead on — no more subtracting half the width by hand.

Spelling conveniences:

- **Either word order works** — `center_bottom` and `bottom_center` are the
  same point.
- Plain `center` is shorthand for `center_center`.
- The original Text/Icon values `left`, `middle`, and `right` still work as
  aliases for the top row (`top_left`, `top_center`, `top_right`), so existing
  cards mean exactly what they always meant.

What the anchor moves, per shape:

- On **Rectangle, Image, TextBox, and Qr** the anchor moves the whole box:
  `anchor: bottom_right` means `x`/`y` are the box's bottom-right corner.
  Inside a TextBox, `align:` still lays each line within the box's width —
  `align` places text *in* the box, `anchor` places the box *on the card*.
- On **Text and Icon** the anchor applies to the drawn line itself:
  horizontally it sets where the text starts, centers, or ends; vertically,
  `y` names the top, middle, or bottom of the text's height (`size:`). The
  default `top_left` is exactly the old behavior — `y` is the top of the line.
- On an **Image with an `auto` dimension**, the anchor offsets the box the art
  actually resolves to. Until the image loads, the placeholder is a square, so
  an anchored `auto` box can shift once the true ratio arrives — that's the
  same load-time rule `auto` itself follows.

`x: middle` is still shorthand for "horizontally centered" (Text and Icon only —
`y: middle` is an error, and so is `x: middle` on Rectangle, Image, TextBox, or Qr).
It always wins horizontally, and a written `anchor:` keeps its vertical say:
`x: middle` + `anchor: bottom_left` centers horizontally and anchors the
bottom of the line.

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
