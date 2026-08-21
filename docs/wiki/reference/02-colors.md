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

`color:` is an [expression](../goblin-script/07-expressions.md) like any other, so it can depend on the
card:

```goblin
color: if [cost] > 3 then gold else grey
```

```goblin
color: if [current_suit] == Suit.Rock then grey
       else if [current_suit] == Suit.Paper then gold
       else mediumpurple
```

## Images and part of a text

On an [`Image`](../goblin-script/05-images.md), `color:` is a multiply tint rather than a flat fill:
`white` (the default) leaves the art unchanged, white source pixels become the chosen
color, and darker source detail stays darker. Source transparency is preserved.

Inside `Text` or `TextBox`, nested `{color:red}…{/color}` tags can override the
element's whole-text `color:` for selected words and inline icons without affecting
wrapping. See [Scoped colors](../goblin-script/04-text.md#scoped-colors) for the syntax and its raw-text
failure behavior.

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
[roadmap](../export-and-project/06-roadmap.md).
