---
title: Colors
status: stable
summary: CSS color names and hex, and why a case named "gold" never collides.
---

# Colors

Any `color:` property accepts:

- **A standard CSS color name** — `white`, `black`, `red`, `gold`, `teal`, `grey`,
  `mediumpurple`, `hotpink`, `darkslateblue`, … all 148 of them.
- **Hex** — `#ff0000`, `#1a2b3c`. Six digits, always.

```goblin
Rectangle:
  x: 0
  y: 0
  width: full
  height: 3
  color: mediumpurple
```

## Colors from data

`color:` is an [expression](expressions.md) like any other, so it can depend on the
card:

```goblin
color: if [cost] > 3 then gold else grey
```

```goblin
color: if [current_suit] == Suit.Rock then grey
       else if [current_suit] == Suit.Paper then gold
       else mediumpurple
```

## Names only mean colors in color positions

A bare word is read against the type expected in that position. In a `color:` property
that's the CSS palette; elsewhere it isn't. So an enum case named `gold` and the color
`gold` can coexist without ambiguity:

```goblin
Enum: Metal
  case gold      # perfectly legal
  case silver

# ...compared as an enum case here:
color: if [metal] == Metal.gold then gold else silver
#                                    ^^^^ the color   ^^^^^^ the color
```

## Watch out for `#`

`#` starts a comment — *except* when it's followed by exactly six hex digits, where
it's a color literal. Don't open a comment with something like `#ff0000`.

## Printing

Colors are emitted to PDF as-is in RGB. There's no CMYK conversion, no color
management, and no bleed handling yet — for home printing and prototypes that's fine;
for a print shop, check with them first. Print specifics are on the
[roadmap](roadmap.md).
