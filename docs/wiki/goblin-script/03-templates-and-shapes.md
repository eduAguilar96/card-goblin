---
title: Templates & shapes
status: stable
summary: Rectangle, Text, TextBox, Icon, Image, Repeat — and the unit grid they're placed on.
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
| `Rectangle` | `x y width height color` | `anchor` (top_left) | a filled box |
| `Text` | `x y size text` | `color` (black), `anchor` (top_left) | one line; `size` is text height in units |
| `TextBox` | `x y width height text size` | `color` (black), `align` (left), `line_height` (1.3), `overflow` (clip), `anchor` (top_left) | wrapped multi-line text in a box — see below |
| `Icon` | `x y size code` | `color` (black), `anchor` (top_left), `style` (flat_dark) | a game glyph — see [Icons](icons.md) |
| `Image` | `x y width height src` | `fit` (contain), `anchor` (top_left) | your own artwork, from a URL — see below |
| `Repeat: N as i` | — | — | draws its children N times |

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

- On **Rectangle, Image, and TextBox** the anchor moves the whole box:
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
`y: middle` is an error, and so is `x: middle` on Rectangle, Image, or TextBox).
It always wins horizontally, and a written `anchor:` keeps its vertical say:
`x: middle` + `anchor: bottom_left` centers horizontally and anchors the
bottom of the line.

## `TextBox` — wrapped, multi-line text

`Text` draws one line, always. When a description, a rules paragraph, or flavor
text needs to *fill an area*, that's `TextBox`:

```goblin
TextBox: "Rules"
  x: 2
  y: 14
  width: 16
  height: 8
  size: 1.1
  text: [rules]
```

`width:` and `height:` declare a box; the text wraps to fit the width, breaking at
spaces. A single word wider than the box breaks mid-word rather than poke out the
side. The wrapping happens **at generation time, in the compiler** — the preview
and the [exported PDF](pdf-export.md) show the exact same line breaks, always.

- `align: left | middle | right` places each line within the box's width
  (default `left`). It's independent of `anchor:`, which moves the box itself —
  and `x: middle` is an error on TextBox, same as on Rectangle.
- `line_height:` is a multiplier on `size` for the distance between baselines.
  The default is **1.3** × size; it must be a plain positive number, not an
  expression.

### Line breaks you write yourself

Wrapping is automatic, but you can also break lines exactly where you want —
a **hard break** happens wherever a real newline character appears in the text:

- In a string literal, write `\n`:

  ```goblin
  text: "Costs [cost].\n\nDiscard after use."
  ```

  `\n` and `\\` (a literal backslash) are the **only** backslash escapes — any
  other `\`-sequence is an error that names the two valid ones.

- Straight from a cell: if a spreadsheet cell contains newline characters
  (pasted or [imported](project-files.md) multi-line content), those break lines
  too. No escaping involved — the newline is data.

Hard breaks always win: they apply before wrapping, and two in a row make an
empty line. In single-line `Text`, newline characters render as **spaces** —
hard breaks belong to `TextBox`.

### When the text doesn't fit

Wrapping handles width. If the wrapped text is too **tall** for the box,
`overflow:` decides what happens:

| `overflow` | What it does |
|---|---|
| `clip` | keep the declared size, drop the lines that don't fit — **the default** |
| `shrink` | reduce the text size in 5% steps until everything fits, down to a floor of **60%** of the declared size — then clip at the floor |

Neither is an error — a long description is data, not a mistake. But the preview
tells you: a card whose text was clipped or shrunk gets a small **amber dot** in
its top-right corner, so an overflowing box can't slip through to print
unnoticed. Fixing it is a design choice: a bigger box, a smaller `size:`, a
tighter `line_height:`, `overflow: shrink`, or shorter text.

One box is one look: a single font, size, and color for the whole box.
Interpolation (`text: "[name]: [rules]"`) substitutes before wrapping, so mixed
cell data wraps as one paragraph. Bold runs and inline icons are a
[roadmap](roadmap.md) topic.

## `Image` — your own artwork

```goblin
Image: "Portrait"
  x: 2
  y: 4
  width: 16
  height: 12
  src: "https://example.com/art/[name].png"
  fit: cover
```

`src:` is a text [expression](expressions.md), so the URL can come straight from a
sheet column (`src: [art_url]`) or be built with interpolation, and different rows get
different art.

### The box and the art are two different shapes

`width:` and `height:` declare a **box** on the card — not the drawn size of the
art. The art has its own proportions, and `fit:` says how the two are reconciled
when they don't match:

| `fit:` | What it does |
|---|---|
| `contain` | whole image visible, letterboxed inside the box — **the default** |
| `cover` | box fully covered, overflow cropped |
| `stretch` | image distorted to exactly fill the box |

> **Why didn't my image stretch?** With the default `fit: contain`, `height: 12`
> promises a 12-unit box, **not** 12 units of drawn art. The art keeps its own
> ratio and letterboxes inside the box — a wide image draws shorter than 12,
> centered, with empty space above and below. If you want the art deformed to fill
> the box exactly, that's `fit: stretch`; if you want the box itself to follow the
> art, give one dimension as `auto`.

### `auto` — size the box from the art

Write `auto` for exactly one of `width:`/`height:` and that dimension follows the
art: the other dimension × the image's own ratio. It's the way to say "exactly as
tall as the ratio demands" — no letterboxing, no cropping, no distortion:

```goblin
Image: "Banner"
  x: 0
  y: 0
  width: full
  height: auto     # exactly as tall as the art's ratio makes it
  src: [banner_url]
```

`width: full` + `height: auto` is the idiom for full-bleed banner art at its
natural proportions. A few things to know:

- Exactly **one** of the pair can be `auto` — both is an error, since nothing
  would be left to derive the ratio from.
- The ratio is only known once the image loads, so until then (and if the load
  fails) the box shows as a **square** placeholder.
- `fit:` does nothing next to `auto` — the box already matches the art's ratio,
  so all three modes draw the same picture. Writing it isn't an error; it's just
  inert.

While an image downloads, its box shows a subtle gray placeholder; if the URL fails to
load, the box turns into an amber crossed-out placeholder instead. **Neither is a
code or data error** — the rest of the card renders normally, and fixing the URL fixes
the box. Images come from the web by URL (uploading files into the project isn't a
thing yet), and PDF export has one extra requirement for them — see
[PDF export](pdf-export.md).

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
