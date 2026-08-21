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

To conditionally draw whole shapes, use capitalized structural `If:`/`Else:` instead:

```goblin
If: [is_rare]
  Text:
    text: "Rare"
Else:
  CommonBadge:
```

`Else:` is optional and must immediately follow its `If:` at the same indentation.
Both branches are checked, but only the selected branch runs; the other produces no
shapes or data errors. Put a nested `If:` inside `Else:` for else-if.

## Named values with `let`

```goblin
let accent: #cc0000

Template: CardFront
  let title_size: 3.5
  Text:
    x: 0
    y: 0
    color: [accent]
    size: [title_size]
    text: "Title"
```

A `let` is immutable and type-inferred. Global lets can use the current Card's data;
local lets can use their lexical parents. Same-block lets may refer forward. Values
are lazy, so an unused let and a let in an unselected branch do not read cells or
produce data errors. Use a self-typing color (`#RRGGBB`) or qualified enum case
(`Suit.Rock`) when no surrounding property supplies an expected type.

A top-level let that resolves to Text can also be inserted into `Text` or `TextBox`
resolved text with `{alias:name}`. This is a one-level reuse mechanism for fragments
that contain [inline icons, assets, or scoped colors](04-text.md#reusing-resolved-text-with-aliases),
not another expression lookup: local lets, parameters, non-Text lets, and unknown
or statically invalid/unpreparable targets are left as the raw marker with a
non-fatal D011 data diagnostic. Runtime data errors from an otherwise valid Text
alias propagate exactly as they do for an ordinary let reference; D003, for example,
still makes the affected card a placeholder. Because an alias name can arrive from
a spreadsheet cell, a top-level let that validly resolves to Text for at least one
Card (or without Card data), and
the globals it depends on, are externally addressable and do not receive W002
"never used". This compiler-level alias-export status makes the let available to
resolved text and affects unused-binding checks; it does not add the let to
spreadsheet or CSV data exports.

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

Quoted strings have one Number-specific formatting form: `[name:0N]` zero-pads to a
minimum total width `N` from 1 through 64. It includes a minus sign in that width and
never rounds or truncates. See [Interpolation](02-sheets-and-data.md) for examples and
the exact spelling rules. It does not change ordinary `[name]` coercion.

## Bare names

A bare word resolves against whatever type is expected in that position:

- in a `color:` property → a [CSS color name](../reference/02-colors.md),
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
