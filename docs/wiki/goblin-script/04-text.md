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

`x y size text` are required; `color` (default `black`), `pivot` (default
`top_left`), and `rotate` (default `0`) are optional. `Text` always draws a single line — `size` is the text's
height in units, not a font-size number. However long the resolved text is, it
keeps going in one line rather than wrapping; when it needs to fill an area
instead, that's `TextBox`, below. A newline character in the resolved text (from
cell data, say) renders as a space in `Text` — hard breaks are a `TextBox`
feature.

`pivot:` follows the same nine-point vocabulary every shape uses, and
`rotate:` turns the line around that pivot point, in degrees clockwise — see
[Pivots](03-templates-and-shapes.md) on Templates & shapes.

`font:` picks the typeface — `geist` (the default) or one of eight bundled serif
and monospace faces. See [Fonts](#fonts) below for the full list.

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
and the [exported PDF](../export-and-project/01-pdf-export.md) show the exact same line breaks, always.

- `align: left | middle | right` places each line within the box's width
  (default `left`). It's independent of `pivot:`, which moves the box itself —
  and `x: middle` is an error on TextBox, same as on Rectangle.
- `line_height:` is a multiplier on `size` for the distance between baselines.
  The default is **1.3** × size; it must be a plain positive number, not an
  expression.
- `font:` picks the typeface — see [Fonts](#fonts) below. Because wrapping
  measures actual letterforms, the SAME text in the SAME box can wrap onto a
  different number of lines depending on `font:`.
- `rotate:` (default `0`) turns the whole box around its pivot point, in
  degrees clockwise — see [Rotation](03-templates-and-shapes.md) on Templates &
  shapes. It's paint-only: the text wraps against the box's unrotated width,
  exactly as if the box weren't rotated.

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
  (pasted or [imported](../export-and-project/03-project-files.md) multi-line content), those break lines
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

The element's `color:` sets the whole box at once. For differently colored words
inside it, use a scoped color below. Interpolation (`text: "[name]: [rules]"`)
substitutes before wrapping, so mixed cell data wraps as one paragraph. Icons can
sit inline in the text too; bold and italic runs are still a
[roadmap](../export-and-project/06-roadmap.md) topic.

## Reusing resolved text with aliases

When the same marker-rich fragment belongs in several sheet cells, put it in a
top-level Text-valued `let` and insert it with `{alias:name}`:

```goblin
let damage_icon: "{color:#cc2222}{asset:swords}{/color}"

Sheet: Attacks
  column desc: Text

# In one desc cell: Deal 2 {alias:damage_icon}.

Template: Front
  TextBox: "Rules"
    x: 2
    y: 14
    width: 16
    height: 4
    size: 1.1
    text: [desc]
```

Aliases are part of **resolved text**, not string interpolation. After the
`text:` expression has resolved, each alias can expand a program-level
`let name:` whose value for that card is Text. The same syntax therefore works
when `{alias:damage_icon}` comes from a spreadsheet cell. Ordinary
`[damage_icon]` interpolation cannot do this arbitrary placement: interpolation
is parsed in source strings, not by rescanning the contents of a cell.

Expansion happens **exactly one level**, and then the ordinary scoped-color,
Dicier, and asset markers are parsed. Those markers can live inside the let's
value, but another `{alias:other}` produced by that value is not expanded and
stays visible as raw text. Local lets and Template parameters are not alias
targets. An unknown name or a top-level let whose value is not Text also leaves
the original `{alias:name}` visible. It reports the non-fatal data diagnostic
[D011](09-errors.md), but the card still renders rather than becoming a placeholder.

Top-level Text lets are externally addressable even when no literal alias marker
appears in code, because one may arrive from cell data. They — and the global lets
they depend on — therefore do not receive the ordinary W002 "never used" warning.

## Scoped colors

Both `Text` and `TextBox` can recolor part of their resolved text:

```goblin
TextBox: "Rules"
  x: 2
  y: 14
  width: 16
  height: 8
  size: 1.1
  color: black
  text: "Gain {color:gold}2 treasure{/color}, then take {color:crimson}1 damage{/color}."
```

`{color:red}` starts a scope and `{/color}` ends it. Use any CSS color name or a
six-digit hex value such as `{color:#cc0000}`. Scopes nest; closing an inner scope
restores the outer color, and closing the outermost restores the element's own
`color:`. The tags are paint-only: they occupy no width, do not cause a wrap boundary,
and do not change alignment, `line_height:`, or overflow calculations.

Scopes apply after interpolation, including when the tags arrive from a spreadsheet
cell. They also color Dicier markers and multiply-tint inline asset markers:

```goblin
text: "Pay {color:teal}{HEARTS} {asset:energy}{/color} to activate."
```

Outside a scope, Dicier markers inherit the element's whole-text color and asset art
keeps its original colors. Inside one, a white asset becomes the scoped color while
its transparency and dark detail are preserved. Malformed, unknown-color,
unbalanced, or unclosed tags stay visible as raw text and produce no diagnostic — the
same gentle behavior as other unrecognized brace markers.

## Inline icons

Both `Text` and `TextBox` can draw icons *inside* the text, with brace markers:

```goblin
Text: "Cost"
  x: 1
  y: 1
  size: 1.2
  text: "Pay {HEARTS} or discard {asset:skull}"
```

- `{HEARTS}` draws the [Dicier icon](../reference/03-icons.md) with that code — uppercase
  letters, digits, underscores (and the one code with a space) between braces.
- `{asset:skull}` draws an [uploaded asset](../export-and-project/04-assets.md) by name, exactly the
  names the Assets drawer holds.
- `{{` is a literal `{`. A lone `}` is just a `}`. Anything else in braces —
  lowercase, empty, unclosed — isn't a marker and stays ordinary text, no
  warning.

**Every icon occupies a square one-em slot**: as wide and tall as the text's
`size`, sitting on the line. Dicier icons draw in the current element/scoped
color; asset art keeps its own colors unless enclosed by a color scope, and
letterboxes into the slot if it isn't square. For now inline Dicier icons always use the default `flat_dark` face —
the `style:` choice that [`Icon`](../reference/03-icons.md) has doesn't reach inline markers
yet.

Markers are read from the **resolved** text — after `[column]` interpolation
and one-level [alias expansion](#reusing-resolved-text-with-aliases) — so a
marker can come straight from a spreadsheet cell (`text: [effect]` where the
cell says `Take {1_ON_D6} damage`), and data-driven icons work with no extra
syntax.

In a `TextBox`, a marker wraps like a word: it moves to the next line whole,
never splitting its slot, and the spaces around it collapse at a line break
exactly like word wrap.

Mistakes stay gentle, the same way icon codes and asset names already work:
an unknown Dicier code written literally in the code warns
([W004](09-errors.md)), an unknown asset name warns (W005), and an unknown code
arriving from cell data is noted at generation time (D005) while the marker
renders as its raw text — the failure is its own indicator, and one bad
marker never blanks a card.

## Fonts

Both `Text` and `TextBox` take an optional `font:` — nine bundled faces, picked
by name:

```goblin
Text: "Title"
  x: middle
  y: 0.7
  size: 1.6
  font: garamond_bold
  text: [name]
```

| `font:` | Face |
|---|---|
| `geist` | the app's clean sans-serif — **the default** |
| `garamond` | Cormorant Garamond, an elegant serif — regular |
| `garamond_bold` | Cormorant Garamond — bold |
| `garamond_italic` | Cormorant Garamond — italic |
| `garamond_bold_italic` | Cormorant Garamond — bold italic |
| `courier` | Courier Prime, a typewriter monospace — regular |
| `courier_bold` | Courier Prime — bold |
| `courier_italic` | Courier Prime — italic |
| `courier_bold_italic` | Courier Prime — bold italic |

Like `style:` on [`Icon`](../reference/03-icons.md), this is a **closed list**: an unrecognized
value is an error, not a warning. It's a deliberately small, fixed set for
now — two typefaces bundled with the app, not a general font-upload system —
chosen to cover a serif and a monospace need without opening a whole asset
pipeline. If you need a font that isn't here, that's currently out of reach.

**Wrapping is measured per font.** `TextBox` wraps by measuring each font's own
letterforms, so the SAME text in the SAME box can break onto different lines
depending on `font:` — Courier's fixed-width letters and Cormorant Garamond's
narrower serif shapes don't take up the same room per character. There's
nothing to configure for this; it's why the wrapping stays correct — and the
preview matches the exported PDF exactly — no matter which face a box uses.
