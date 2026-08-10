---
title: Card sizes
status: stable
summary: The five physical card presets — and custom millimetre sizes — in exact millimetres.
---

# Card sizes

`size:` on a [Card block](cards-and-generation.md) picks the physical card. Sizes are
exact millimetres, which is what makes PDF export print true to size.

| `size:` | Physical | Good for |
|---|---|---|
| `poker` | 63.5 × 88.9 mm | standard playing cards |
| `bridge` | 57.15 × 88.9 mm | narrow hands, trick-takers |
| `tarot` | 70 × 120 mm | big art, oracle decks |
| `square` | 70 × 70 mm | tiles, tokens |
| `mini` | 44 × 63.5 mm | resource cards, dense layouts |

## Units and size

The size preset and `x_units:` together fix the scale of everything you draw:

```goblin
size: poker
x_units: 20      # 1 unit = 63.5 ÷ 20 = 3.175 mm
y_units: auto    # 28 units tall — square units
```

With `y_units: auto` the units stay square and the vertical count follows from the
card's aspect ratio. It isn't always a whole number:

| Size | `x_units: 20` → height in units |
|---|---|
| `poker` | 28 exactly |
| `bridge` | 31.111… |
| `tarot` | 34.285… |
| `square` | 20 |
| `mini` | 28.863… |

`full` on the vertical axis means that value, whatever it is — so `height: full`
always spans the card.

## Custom sizes

When no preset fits, give the card's exact dimensions *instead of* `size:`:

```goblin
Card: Token
  sheet: Tokens
  width_mm: 40
  height_mm: 40
  x_units: 10      # 1 unit = 40 ÷ 10 = 4 mm
  y_units: auto
  Front: TokenFront
```

`width_mm:` and `height_mm:` are positive numbers in millimetres (decimals are
fine — `poker` itself is 63.5 wide), precise to two decimal places with a
0.01&nbsp;mm minimum, and they always travel as a pair: giving only one, or
combining either with `size:`, is an error.

Everything else works exactly as with a preset — `x_units:` divides the custom
width, `y_units: auto` keeps units square, and [PDF export](pdf-export.md)
prints true to size. A card too large for the selected paper is reported when
you export.
