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

A Template still gets sheet columns, Card loops, global lets, and generation built-ins
from whichever Card reaches it. It can also declare typed parameters when a caller must
choose a layout or style explicitly.

## Template parameters

Declare required parameters directly inside the Template with
`param name: Type`. The type may be `Text`, `Number`, `Bool`, `Color`, or an enum.
Declarations may appear anywhere among the Template's direct children and are hoisted
across its whole body. Parameters are immutable; they cannot be declared inside an
`If`, `Else`, or `Repeat`.

```goblin
Enum: CardEdition
  case Black
  case White

Template: MonsterFront
  param edition: CardEdition

  let background: if [edition] == CardEdition.Black
    then #000000
    else #FFFFFF

  Rectangle:
    x: 0
    y: 0
    width: full
    height: full
    color: [background]
```

Supply arguments beneath `Front:` or `Back:`. Each argument is an expression evaluated
in the Card caller's scope:

```goblin
Card: BlackCards
  # sheet, size, units, count...
  Front: MonsterFront
    edition: CardEdition.Black

Card: WhiteCards
  # same data and layout, different count/style choice
  Front: MonsterFront
    edition: CardEdition.White
```

Every declared parameter is required. Missing, extra, duplicate, or wrongly typed
arguments are compile errors.

## Reusing Templates

A Template can call another Template by writing its name as a node header:

```goblin
Template: Frame
  param edition: CardEdition
  # draw the edition-specific frame...

Template: MonsterFront
  param edition: CardEdition

  Frame:
    edition: [edition]
  If: [elite]
    EliteBadge:
```

The called shapes are inserted at that exact position, so source order still controls
which shapes draw on top. Calls may be nested and may sit inside `If`, `Else`, or
`Repeat`. Arguments use the same indented form as Card faces.

A called Template deliberately does not capture the caller's parameters, local `let`
values, or `Repeat` index. Argument expressions *do* run in caller scope, so forwarding
is explicit: `edition: [edition]` above passes the outer parameter to `Frame`. The
callee then sees its own parameters and locals plus global lets, Card loops, sheet
columns, and generation built-ins. This keeps a Template's inputs readable at the call
site instead of making nested composition depend on hidden caller state.

For compatibility, a Template may still literally be named `If` or `Else` and used
as `Front: If` or `Back: Else`. Those two names cannot use nested-call shorthand,
because `If:` and `Else:` are structural there.

## Drawing conditionally

```goblin
If: [equipment]
  EquipmentFrontRotated:
Else:
  EquipmentFront:
```

`If:` takes a one-line Bool expression. `Else:` is optional and must be the next
nonblank, non-comment sibling at the same indentation. Both branches are checked; only the
selected branch runs, so an unselected branch emits no shapes, reads no lets, and
produces no data errors. Branches have their own local scope. For else-if, nest an
`If:` inside `Else:`.

## Local values

Use `let name: expression` anywhere a Template node can appear, including inside
`If`, `Else`, and `Repeat`. A local let is immutable, visible throughout its lexical
block even before its declaration, and newly evaluated for each Template call,
selected branch, or Repeat iteration. A callee cannot see it unless the caller passes
it as an explicit argument.

## The coordinate grid

Cards use an abstract unit grid, so a layout survives a change of card size and still
prints at exact millimetres.

```goblin
Card: Monster
  size: poker      # 63.5 × 88.9 mm
  x_units: 20      # → 1 unit = 63.5/20 = 3.175 mm
  y_units: auto    # → 28 units tall, units stay square
```

- **`size:`** picks the physical card — see [Card sizes](../reference/01-card-sizes.md).
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
| `Text` | `x y size text` | `color` (black), `font` (geist), `pivot` (top_left), `rotate` (0) | one line; `size` is text height in units — see [Text & TextBox](04-text.md) |
| `TextBox` | `x y width height text size` | `color` (black), `font` (geist), `align` (left), `line_height` (1.3), `overflow` (clip), `pivot` (top_left), `rotate` (0) | wrapped multi-line text in a box — see [Text & TextBox](04-text.md) |
| `Icon` | `x y size code` | `color` (black), `pivot` (top_left), `style` (flat_dark), `rotate` (0) | a game glyph — see [Icons](../reference/03-icons.md) |
| `Image` | `x y width height src` | `fit` (contain), `color` (white/unchanged), `pivot` (top_left), `rotate` (0) | your own artwork with optional multiply tint — see [Images](05-images.md) |
| `Qr` | `x y size data` | `color` (black), `background` (white), `level` (m), `pivot` (top_left), `rotate` (0) | a scannable QR code — see [QR codes](06-qr-codes.md) |
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
[exported PDF](../export-and-project/01-pdf-export.md) shows exactly what the preview shows. Angles
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
- Cap: **500 Repeat expansions per card**. Every iteration of every `Repeat`
  counts once against the same budget, including outer and inner iterations in
  nested repeats — it is not a count of the shapes eventually drawn. Crossing
  the cap produces D004 and makes that affected card an error placeholder; it
  does not keep partially truncated artwork.
