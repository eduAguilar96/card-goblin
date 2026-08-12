---
title: Templates & shapes
status: stable
summary: Rectangle, Text, TextBox, Icon, Image, Qr, Repeat — and the unit grid they're placed on.
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
| `Image` | `x y width height src` | `fit` (contain), `anchor` (top_left) | your own artwork, from a URL or an uploaded asset — see below |
| `Qr` | `x y size data` | `color` (black), `background` (white), `level` (m), `anchor` (top_left) | a scannable QR code — see below |
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

While an image downloads, its box shows a subtle gray placeholder; if the source fails
to load, the box turns into an amber crossed-out placeholder instead. **Neither is a
code or data error** — the rest of the card renders normally, and fixing the source
fixes the box. PDF export has one extra requirement for URL art — see
[PDF export](pdf-export.md).

### Uploaded assets — art with no hosting required

`src:` doesn't have to be a URL. The **Assets** button in the status bar opens a
drawer where you upload images straight from your machine — drag and drop, or the
file picker — and each one gets a name (derived from the filename, renameable
anytime). Reference an upload with the `asset:` scheme instead of a URL:

```goblin
Image: "Portrait"
  x: 2
  y: 4
  width: 16
  height: 12
  src: "asset:dragon_art"
```

Everything about `src:` being a Text expression still applies — an asset reference
works from a sheet column (`src: [art]`) or built with interpolation
(`src: "asset:[art]"`), so different rows can point at different uploads exactly
like different URLs. Each row of the drawer has a **Copy ref** button that copies
`asset:<name>` ready to paste into a `src:` line.

A few things specific to uploads:

- **2 MB** per image. Enough for card-sized art at print resolution; the drawer
  says so if a file is over the limit.
- **Renaming updates the library only.** It doesn't rewrite `src:` lines for
  you — rename `dragon_art` to `dragon` and every `src: "asset:dragon_art"`
  still says the old name, now pointing at nothing. Update those references
  yourself; the compiler's unknown-asset warning squiggles exactly the
  `src:` lines that need it, so you won't miss one. Referencing a name that
  doesn't exist yet (or anymore) isn't an error, just that warning — you
  might be about to upload it.
- **Stored in this browser.** Uploads live in this browser's storage, separately
  from [autosave](autosave.md) — see there for exactly what that means.
- **Shareable.** [Exporting a project file](project-files.md) bundles your
  uploads into the file itself, so handing someone a `.cardgoblin.json` hands
  them the art too — no broken links, no separate zip of images.

## `Qr` — scannable codes

```goblin
Qr:
  x: 2
  y: 2
  size: 6
  data: [code]
```

`data:` is a text [expression](expressions.md), so the code can come straight from a
sheet column (`data: [code]`), be interpolated (`data: "https://example.com/[code]"`),
or be computed with a conditional — the usual coercions apply.

### The idiom: one QR per card, on the back

The point of a card's QR is usually to let a companion app scan it and act — a
cross-media game where the app is out of scope for CardGoblin, but the code on the
card is exactly what it needs. Because `Back:` templates evaluate per card just like
`Front:` templates (every card sees its own row's data), a `Back:` template needs
nothing extra to give every card in the deck a different code:

```goblin
Qr:
  x: 2
  y: 2
  size: 16
  data: [code]
```

Those four lines — `x y size data` — are the whole idiom: a Text column of codes in
your sheet, one `Qr:` block in a `Back:` template, and every card's back carries its
own scannable code.

### `level:` — error correction

QR codes carry redundant data on purpose, so a code still scans even partly
obscured, scratched, or printed small. `level:` picks how much:

| `level:` | What it does |
|---|---|
| `l` | roughly 7% of the code can be damaged and it still scans |
| `m` | roughly 15% — **the default** |
| `q` | roughly 25% |
| `h` | roughly 30% — the most damage-tolerant, at the densest code for the same data |

A higher level may need a bigger code for larger payloads (more of the code's
capacity goes to redundancy instead of your content, so less room is left for
`data:` at a given size) — a short code (a plain URL, a short id) is often the same
size at every level, but the difference shows up once the content pushes against a
level's capacity. Worth raising for a code that'll be printed small or handled
roughly, and safe to leave at the default otherwise.

### The quiet zone lives inside the box

Every QR code needs a plain border — the **quiet zone** — around the modules for a
scanner to find it. `size:` is the side of the box you declare, and the quiet zone is
drawn **inside** it, in `background:`, so an adjacent shape can never crowd a code's
scan margin just by sitting close on the card. The box you draw is exactly the box a
scanner sees.

### When the data doesn't fit

Every QR code has a capacity ceiling, set by `level:` (higher levels hold less
content at a given size) — a code has a limit past which no code can be built at all,
no matter how large. `data:` that exceeds it is a **QR data is too long for one
code** error, and the card renders as a placeholder, the same "this one card's data
was the problem" isolation every other data-time error gets — the rest of the deck is
unaffected. An empty `data:` is not this case: it encodes as a normal, valid, tiny
code — there's nothing special about zero-length data.

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
