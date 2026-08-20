---
title: Images
status: stable
summary: The Image element — your own artwork from a URL or an uploaded asset, fit modes, and auto sizing.
---

# Images

```goblin
Image: "Portrait"
  x: 2
  y: 4
  width: 16
  height: 12
  src: "https://example.com/art/[name].png"
  fit: cover
  color: teal
```

`src:` is a text [expression](expressions.md), so the URL can come straight from a
sheet column (`src: [art_url]`) or be built with interpolation, and different rows get
different art.

## Recolor white artwork

Add an optional `color:` to multiply the artwork by a color:

```goblin
Image: "Faction mark"
  x: 2
  y: 2
  width: 4
  height: 4
  src: "asset:faction_mark"
  color: if [faction] == Faction.Sea then teal else crimson
```

The default is `white`, which leaves every pixel unchanged. Multiplication is
especially useful for white PNG/SVG-style artwork: white pixels become the chosen
color, black pixels stay black, and gray pixels keep their shading. Transparent and
partly transparent edges keep their original alpha. This uses the same Color values
as every other `color:` — CSS names or six-digit `#RRGGBB`, including expressions —
and does not add `rgba()` or eight-digit hex.

Tinting happens only after the art loads. Loading and failed-image placeholders keep
their normal gray/amber appearance. Both URL art and uploaded `asset:` art behave the
same way, and the exported PDF uses the exact same multiplied rendering as the
preview.

## The box and the art are two different shapes

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

## Art with no hosting — uploaded assets

`src:` doesn't have to be a URL. Reference an image you've uploaded through the
**Assets** drawer with the `asset:` scheme instead:

```goblin
Image: "Portrait"
  x: 2
  y: 4
  width: 16
  height: 12
  src: "asset:dragon_art"
```

See [Uploaded assets](assets.md) for the drawer itself, the 2 MB cap, and how
uploads are stored — everything about `src:` being a Text expression still
applies, so `src: [art]` and `src: "asset:[art]"` work exactly like they do with a
URL.
