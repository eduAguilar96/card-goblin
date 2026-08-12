---
title: Card sizes
status: stable
summary: The built-in physical card presets — and custom millimetre sizes — in exact millimetres.
---

# Card sizes

`size:` on a [Card block](cards-and-generation.md) picks the physical card. Sizes are
exact millimetres, which is what makes PDF export print true to size.

| `size:` | Physical | Inches | Good for |
|---|---|---|---|
| `poker` | 63.5 × 88.9 mm | 2.5 × 3.5 in | standard playing cards |
| `bridge` | 57.15 × 88.9 mm | 2.25 × 3.5 in | narrow hands, trick-takers |
| `american` | 56 × 87 mm | 2.2 × 3.43 in | board-game decks, the common sleeve size |
| `tarot` | 70 × 120 mm | 2.76 × 4.72 in | big art, oracle decks |
| `square` | 70 × 70 mm | 2.76 × 2.76 in | tiles, tokens |
| `mini` | 44 × 63.5 mm | 1.73 × 2.5 in | resource cards, dense layouts |
| `domino` | 44.45 × 88.9 mm | 1.75 × 3.5 in | tall narrow cards, tarot-style minis |

The millimetres are the real definition; the inches are those values rounded, so
they're what to compare against a sleeve pack, not what to print from.

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
| `american` | 31.071… |
| `tarot` | 34.285… |
| `square` | 20 |
| `mini` | 28.863… |
| `domino` | 40 exactly |

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
