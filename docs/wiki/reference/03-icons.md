---
title: Icons
status: stable
summary: The 888 Dicier game glyphs — how to use them and what the categories are.
---

# Icons

Icons come from **[Dicier](https://speakthesky.itch.io/typeface-dicier)** by Speak the
Sky — a game-icon typeface with 888 usable codes: dice, card suits, dominoes, coins,
tarot suits and more. Because it's a font, icons are vector, colorable, and embed
cleanly in PDFs.

```goblin
Icon:
  x: 1
  y: 1
  size: 2
  color: crimson
  code: "HEARTS"
```

Codes are **UPPERCASE quoted strings**. A misspelled code gets a warning squiggle and
renders as raw text on the card, so you can spot it immediately.

## Codes can be computed

`code:` is an [expression](expressions.md), so an icon can depend on the card's data:

```goblin
code: if [hp] > 5 then "CROWN" else "COIN"
```

## Repeating icons

The most common use is one icon per point of something —
see [`Repeat`](templates-and-shapes.md):

```goblin
Repeat: [health] as i
  Icon:
    x: 1.5 + [i] * 2
    y: 25
    size: 1.8
    color: red
    code: "HEARTS"
```

## Categories

| Category | Sample codes |
|---|---|
| Card suits | `HEARTS` `DIAMONDS` `CLUBS` `SPADES` |
| Card values | `ACE` `TWO` … `TEN` `JACK` `QUEEN` `KING` |
| Value + suit | `ACE_HEARTS` `QUEEN_SPADES` … |
| Jokers | `JOKER` `RED_JOKER` `BLACK_JOKER` |
| Dice shapes | `D2` `D4` `D6` `D8` `D10` `D12` `D20` |
| Dice results | `3_ON_D6` `20_ON_D20` `ANY_ON_D8` … |
| Numbered dice | `0`–`9` |
| Fudge & special dice | fudge, yes/and/no/but, trigram, even/odd dice |
| Dominoes | generic, numbered, and wildcard dominoes |
| Coins | `COIN` `HEADS` `TAILS` `ANY_FLIP` `ON_EDGE` |
| Historic & tarot suits | season suits, minor arcana (`SWORDS` `CUPS` `COINS` `WANDS`), heckadeck |
| Misc | `CROWN` `ANCHOR`, zener cards (`Z_STAR` …), dreidel (`GIMEL` …) |

The complete list ships with the project at
[`docs/vendor/dicier-v1.5.4/Dicier codes v1_5_4.txt`](../../vendor/dicier-v1.5.4/Dicier%20codes%20v1_5_4.txt).
A browsable icon picker is on the [roadmap](roadmap.md).

## Why unknown codes only warn

The published code list is known to be incomplete — several families end in "etc." —
so a code CardGoblin doesn't recognise may still be a real glyph. That's why it's a
warning, not an error, and why the icon still renders: if the glyph exists you'll see
it, and if it doesn't you'll see the raw text.

## Credit

Dicier v1.5.4 by Speak the Sky, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Commercial use is fine with
visible credit, and embedding in PDFs is explicitly allowed. If you publish a deck made
with CardGoblin, carry the credit forward.
