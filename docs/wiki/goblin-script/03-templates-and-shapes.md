---
title: Templates & shapes
status: stable
summary: Templates, the grid, the shape index, pivots, rotation, and Repeat — the drawing model shapes share.
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
| `Rectangle` | `x y width height color` | `pivot` (top_left), `rotate` (0) | a filled box |
| `Text` | `x y size text` | `color` (black), `pivot` (top_left), `rotate` (0) | one line; `size` is text height in units — see [Text & TextBox](text.md) |
| `TextBox` | `x y width height text size` | `color` (black), `align` (left), `line_height` (1.3), `overflow` (clip), `pivot` (top_left), `rotate` (0) | wrapped multi-line text in a box — see [Text & TextBox](text.md) |
| `Icon` | `x y size code` | `color` (black), `pivot` (top_left), `style` (flat_dark), `rotate` (0) | a game glyph — see [Icons](icons.md) |
| `Image` | `x y width height src` | `fit` (contain), `pivot` (top_left), `rotate` (0) | your own artwork, from a URL or an uploaded asset — see [Images](images.md) |
| `Qr` | `x y size data` | `color` (black), `background` (white), `level` (m), `pivot` (top_left), `rotate` (0) | a scannable QR code — see [QR codes](qr-codes.md) |
| `Repeat: N as i` | — | — | draws its children N times — see below |

## Pivots — which point of the shape `x`/`y` place

Every shape takes an optional `pivot:` naming **which point of the shape
itself** its `x`/`y` coordinates refer to — the shape's own handle, not a
point on the card. Nine points, spelled with underscores, vertical word
first:

| `pivot:` | The point `x`/`y` place |
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

**To center a shape on the card**, pair the halfway coordinate with the
halfway pivot — reach for this any time you want something centered:

```goblin
x: half
y: half
pivot: center_center
```

`half` puts `x`/`y` at the card's own midpoint; `pivot: center_center` says
that midpoint is the shape's OWN center too — so the shape's center lands
exactly on the card's center. (`pivot: center_center` with `x: 0, y: 0` does
something different, and it trips people up: it puts the shape's center on
the card's top-left CORNER — correct once you know `x`/`y` is always a point
on the card that the shape's own center gets placed at, but a common surprise
if you expected it to pin a corner of the CARD instead.)

So `pivot: bottom_right` with `x: full` and `y: full` pins a shape to the
card's bottom-right corner.

Spelling conveniences:

- **Either word order works** — `center_bottom` and `bottom_center` are the
  same point.
- Plain `center` is shorthand for `center_center`.
- The original Text/Icon values `left`, `middle`, and `right` still work as
  aliases for the top row (`top_left`, `top_center`, `top_right`), so existing
  cards mean exactly what they always meant.

What the pivot moves, per shape:

- On **Rectangle, Image, TextBox, and Qr** the pivot moves the whole box:
  `pivot: bottom_right` means `x`/`y` are the box's bottom-right corner.
  Inside a TextBox, `align:` still lays each line within the box's width —
  `align` places text *in* the box, `pivot` places the box *on the card*.
- On **Text and Icon** the pivot applies to the drawn line itself:
  horizontally it sets where the text starts, centers, or ends; vertically,
  `y` names the top, middle, or bottom of the text's height (`size:`). The
  default `top_left` is exactly the old behavior — `y` is the top of the line.
- On an **Image with an `auto` dimension**, the pivot offsets the box the art
  actually resolves to. Until the image loads, the placeholder is a square, so
  a pivoted `auto` box can shift once the true ratio arrives — that's the
  same load-time rule `auto` itself follows.

`x: middle` is still shorthand for "horizontally centered" (Text and Icon only —
`y: middle` is an error, and so is `x: middle` on Rectangle, Image, TextBox, or Qr).
It always wins horizontally, and a written `pivot:` keeps its vertical say:
`x: middle` + `pivot: bottom_left` centers horizontally and pivots the
bottom of the line.

## Rotation — turning a shape on its pivot

Every shape also takes an optional `rotate:` — an angle in **degrees,
clockwise**, and like any other number it can come from data or arithmetic.
The shape turns **around its pivot point**: `x`/`y` stay planted, and the
shape swings around them. That's why the two properties pair so naturally —
the pivot names the shape's handle, and `rotate:` turns it on that handle.

To spin a shape in place, pivot it on its own center:

```goblin
Icon: "Compass"
  x: half
  y: half
  size: 4
  code: "STARS"
  pivot: center_center
  rotate: 45
```

With the default `top_left` pivot, the shape swings around its top-left
corner instead — sometimes exactly what you want, often a surprise. If a
rotation lands somewhere unexpected, check the pivot first.

Because the angle is ordinary arithmetic, `Repeat` makes fans and dials for
free — each copy at its own angle, all sharing one pivot point:

```goblin
Repeat: 5 as i
  Rectangle: "Fan blade"
    x: half
    y: full
    width: 1
    height: 6
    color: teal
    pivot: bottom_center
    rotate: [i] * 15 - 30
```

Rotation changes how a shape is **painted, nothing more**: a rotated
`TextBox` still wraps against its unrotated width, and the
[exported PDF](pdf-export.md) shows exactly what the preview shows. Angles
outside 0–360 work the obvious way — `rotate: -90` is a quarter-turn
counter-clockwise, the same as `270`.

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
