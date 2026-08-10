---
title: Basics & syntax
status: stable
summary: Indentation, comments, names, labels — the shape of every Goblin file.
---

# Basics & syntax

Goblin script is an outline language: what's indented under something belongs to it.
There are only four kinds of top-level block — `Enum`, `Sheet`, `Template`, and
`Card` — and they can appear in any order (a `Card` may refer to a `Template` declared
further down).

## Indentation is structure

```goblin
Template: MonsterFront
  Rectangle: "Banner"
    x: 0
    color: teal
```

The `Rectangle` belongs to the template; `x` and `color` belong to the rectangle. Use
spaces or tabs, but be consistent within a file.

## Comments

`#` starts a comment that runs to the end of the line.

```goblin
# the monster deck — suits come from the loop
Enum: Suit
  case Rock     # beats scissors
```

**One quirk:** `#` followed by exactly six hex digits is a *color*, not a comment
(`#ff0000`). Don't start a comment with something like `#ff0000`.

## Names

Declared names — `Suit`, `Monsters`, `MonsterFront` — are plain words: a letter,
then letters, digits, or underscores. No quotes.

A small set of words is reserved and can't be used as names: the block openers
(`Enum` `Sheet` `Template` `Card` `Rectangle` `Text` `Icon` `Image` `Repeat`
`Front` `Back`), the declaration words (`case` `column`), and the expression words
(`if` `then` `else` `and` `or` `not` `as`).

Everything else is fair game. Property words like `count`, `size`, `color`, and `full`
are ordinary identifiers — so `column count: Number` is perfectly legal, and `[count]`
reads that column. Meaning comes from position, and `[brackets]` always mean a data
reference.

## Labels

The quoted string after a shape is an optional **label**, purely for your own
readability. It's never referenced by anything:

```goblin
Rectangle: "Banner"      # labelled
Rectangle:               # unlabelled — identical behaviour
```

## Values can span lines

A property's value may continue onto following lines as long as they're indented
deeper than the property name:

```goblin
color: if [current_suit] == Suit.Rock then grey
       else if [current_suit] == Suit.Paper then gold
       else mediumpurple
```

This works for **property lines only** (a lowercase key followed by `:`). Block
headers like `Repeat:` never continue — their indented lines are their children, so a
`Repeat:` count has to fit on one line.

## Data references

Square brackets always mean *look this value up*:

```goblin
text: [name]
x: 1.5 + [i] * 2
text: "Cost: [cost]"     # interpolated inside a string
```

Where those values come from is [Sheets and data](sheets-and-data.md). To write a
literal `[` inside a string, double it: `[[`.
