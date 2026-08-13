---
title: Expressions
status: stable
summary: Arithmetic, comparisons, logic, and if/then/else — anywhere a value goes.
---

# Expressions

Anywhere a value goes, an expression can go. `x: 4` and `x: 1.5 + [i] * 2` are the
same kind of thing.

| Kind | Examples |
|---|---|
| Arithmetic | `[cost] + 1`, `2 * [i]`, `[atk] % 3`, parentheses |
| Comparison | `==` `!=` on matching types; `<` `<=` `>` `>=` on numbers only |
| Logic | `and`, `or`, `not` |
| Conditional | `if [cost] > 3 then gold else grey` |
| Enum cases | `Suit.Rock` always; bare `Rock` when it's unambiguous |

## Conditionals

`if … then … else …` is an *expression*, not a statement — it produces a value, so
`else` is always required:

```goblin
color: if [current_suit] == Suit.Rock then grey
       else if [current_suit] == Suit.Paper then gold
       else mediumpurple
```

Chain as many `else if`s as you like. Both branches must produce the same type — you
can't return a color from one and a number from the other.

## Types

There are `Number`, `Text`, `Bool`, `Color`, and one type per Enum you declare.
Checking happens as you type, so mistakes squiggle rather than producing odd cards:

- arithmetic needs numbers,
- `==` and `!=` need both sides to be the *same* type,
- `<` `<=` `>` `>=` are **numbers only** — there's no meaningful ordering on text or
  enum cases,
- an `if` condition must be a Bool.

**Comparisons don't chain.** `a == b == c` is an error — write `a == b and b == c`.

The one automatic conversion: in a text position (`text:`, `code:`, or inside string
interpolation) numbers and enum cases become text. That's what makes `text: [cost]`
work.

## Bare names

A bare word resolves against whatever type is expected in that position:

- in a `color:` property → a [CSS color name](colors.md),
- compared against an enum-typed reference → that enum's cases,
- in a geometry position → `full`, `half`, `middle`, `auto`.

So an enum case named `gold` never collides with the color `gold` — position decides.
Where no expected type is available, a bare case resolves only if it's unique across
all your enums; otherwise qualify it as `Suit.Rock`.

## Precedence

Lowest to highest:

```
if/then/else  →  or  →  and  →  not  →  comparisons  →  + -  →  * / %  →  unary -
```

Parentheses work as you'd expect.
