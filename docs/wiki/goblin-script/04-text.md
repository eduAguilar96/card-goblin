---
title: Text & TextBox
status: stable
summary: One line of text, or a wrapped multi-line box — and how wrapping is decided.
---

# Text & TextBox

Two elements put words on a card: `Text` for one line, `TextBox` when it needs to
wrap inside a box.

## `Text` — one line

```goblin
Text: "Title"
  x: middle
  y: 0.7
  size: 1.6
  text: [name]
```

`x y size text` are required; `color` (default `black`) and `anchor` (default
`top_left`) are optional. `Text` always draws a single line — `size` is the text's
height in units, not a font-size number. However long the resolved text is, it
keeps going in one line rather than wrapping; when it needs to fill an area
instead, that's `TextBox`, below. A newline character in the resolved text (from
cell data, say) renders as a space in `Text` — hard breaks are a `TextBox`
feature.

`anchor:` follows the same nine-point vocabulary every shape uses — see
[Anchors](templates-and-shapes.md) on Templates & shapes.

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
