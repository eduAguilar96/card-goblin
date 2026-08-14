---
title: Sheets & data
status: stable
summary: Declaring columns and enums, and how [references] resolve.
---

# Sheets & data

Your code declares the **shape** of the data; the grid holds the **values**. That
split is what makes every `[reference]` checkable as you type.

## Declaring a sheet

```goblin
Sheet: Monsters
  column name: Text
  column cost: Number
  column health: Number
  column count: Number
```

Each `Sheet:` becomes one tab in the spreadsheet panel with exactly these columns.
Column types are:

| Type | Cells accept | Empty cell |
|---|---|---|
| `Text` | anything | treated as `""` |
| `Number` | numeric values | an error if referenced |
| *any Enum* | one of that enum's cases (dropdown) | an error if referenced |

A sheet may declare **zero columns** — the tab then just holds numbered rows. That's
the idiom for decks whose content comes entirely from a `loop:`.

### Editing the schema

- Add a `column` line → the column appears in the grid.
- Remove one → the column disappears, but **its data is kept for the session**, in
  case you were mid-typo.
- Rename one (same position, same type) → the data **migrates** with it. Rename the
  column and its `[references]` together and nothing is lost.

## Enums

```goblin
Enum: Suit
  case Rock
  case Paper
  case Scissors
```

An enum is a named, fixed set of cases. Two uses:

1. **As a column type** — `column suit: Suit` makes those cells dropdowns, so a cell
   can never hold a value the code doesn't know about.
2. **As a generator** — `loop: Suit as current_suit` on a Card produces one card per
   case. See [Cards and generation](cards-and-generation.md).

Refer to a case as `Suit.Rock`. Bare `Rock` also works wherever the expected type
makes it unambiguous — comparing against an enum-typed reference, for instance.

## How `[references]` resolve

Inside a template, `[name]` is looked up in this order, innermost first:

1. the nearest enclosing **`Repeat` variable**,
2. the Card's **`loop` variables**,
3. the bound **sheet's columns**,
4. the built-in **`[row]`** and **`[card]`** position bindings (below).

```goblin
Card: Monster
  sheet: Monsters              # 3. [name], [cost], [health], [count]
  loop: Suit as current_suit   # 2. [current_suit]
  ...

Template: MonsterFront
  Repeat: [health] as i        # 1. [i]
    Icon:
      x: 1.5 + [i] * 2
```

Templates are checked **per Card that uses them**, so a template referencing
`[health]` is valid when used by a Card whose sheet has a `health` column, and
squiggled when used by one that doesn't. A shadowed name (a `Repeat` variable with the
same name as a column) still works, innermost-first, but warns.

## `[row]` and `[card]`

Two built-in Number bindings, always available inside a template — no column to
declare:

- **`[row]`** — the row's 1-based position in its sheet. It's exactly the number
  shown (and edited — see [The editor](../getting-started/the-editor.md)) in the
  grid's row gutter, so every card generated from one row shares it.
- **`[card]`** — the card's 1-based position within its *generated deck*, counting
  every `loop:` combination and `count:` copy. It increments once per physical card.

They only differ once `loop:` or `count:` turns one row into several cards. Two rows
(Dragon, Imp) times the demo's three suits:

| Sheet row | Suit | `[row]` | `[card]` |
|---|---|---|---|
| Dragon | Rock | 1 | 1 |
| Dragon | Paper | 1 | 2 |
| Dragon | Scissors | 1 | 3 |
| Imp | Rock | 2 | 4 |
| Imp | Paper | 2 | 5 |
| Imp | Scissors | 2 | 6 |

`[row]` labels the *data* — every card from one row agrees on it. `[card]` labels the
*deck* — a running count across the whole Card block, useful for numbering a print run
(`text: "Card #[card]"`) or spot-checking which row produced a card while debugging.

Both are derived, not stored: nothing about them lives in your rows, your autosave, or
an exported [project file](../export-and-project/project-files.md) — moving a row in
the grid is what changes what `[row]` (and, downstream, `[card]`) resolve to for it.
If a sheet declares its own `row` or `card` column, that column **shadows** the
built-in of the same name for any Card bound to it (with the usual shadowing warning)
— existing projects that already used those names keep working unchanged.

## Interpolation

Inside a string, `[ref]` substitutes the value:

```goblin
text: "Cost: [cost]"      # → "Cost: 5"
```

Numbers and enum cases become text automatically here (trailing zeros are trimmed;
an enum prints its case name). Use `[[` for a literal `[`.

## Rows

Rows live in the grid, not in your code — editing a cell never rewrites your script.
Two rules worth knowing:

- **Pristine rows are excluded.** A row you just added and haven't typed in is dimmed
  and left out of the deck. It joins as soon as you type into it.
- **Bad cells are local.** A cell that doesn't fit its column flags red, and only the
  cards built from that row become placeholders. See
  [Errors and diagnostics](errors.md).
