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
   case. See [Cards and generation](08-cards-and-generation.md).

Refer to a case as `Suit.Rock`. Bare `Rock` also works wherever the expected type
makes it unambiguous — comparing against an enum-typed reference, for instance.

## How `[references]` resolve

Inside a template, `[name]` is looked up in this order, innermost first:

1. the nearest enclosing **`Repeat` variable** and local **`let` values**,
   nearest scope first,
2. the current Template's **parameters**,
3. the Card's **`loop` variables**,
4. the bound **sheet's columns**,
5. global **`let` values**,
6. the built-in **generation bindings** (below).

```goblin
Card: Monster
  sheet: Monsters              # sheet columns: [name], [cost], [health], [count]
  loop: Suit as current_suit   # Card loop variable: [current_suit]
  ...

Template: MonsterFront
  Repeat: [health] as i        # nearest local binding: [i]
    Icon:
      x: 1.5 + [i] * 2
```

Templates are checked **per Card that reaches them**, including through Template
calls, so a template referencing
`[health]` is valid when used by a Card whose sheet has a `health` column, and
squiggled when used by one that doesn't. A shadowed name (a `Repeat` variable with the
same name as a column) still works, innermost-first, but warns.

## Generation identity: row, copy, deck, and project

These derived bindings are available anywhere a Card context exists, including
Templates, `count:`, program lets, and virtual columns — no sheet column to declare:

- **`[row]`** — the row's 1-based position in its sheet. It's exactly the number
  shown (and edited — see [The editor](../getting-started/03-the-editor.md)) in the
  grid's row gutter, so every card generated from one row shares it.
- **`[card]`** — the card's 1-based position within its *generated deck*, counting
  every `loop:` combination and `count:` copy. It increments once per physical card.
- **`[copy]`** — the 1-based copy within the current row × loop combination. It
  resets to 1 for the next combination.
- **`[deck]`** — Text containing the current `Card:` declaration name, such as
  `BlackCards` or `WhiteCards`.
- **`[deck_card]`** — a clearer alias for `[card]`; both always produce the same Number.
- **`[project_card]`** — the 1-based physical position across all generated `Card:`
  blocks in declaration order.

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

`[row]` labels the *data*. `[copy]` distinguishes duplicates of one row/loop result.
`[deck]` says which Card declaration emitted the instance. `[card]`/`[deck_card]`
number one deck, while `[project_card]` numbers the current generated project.

### Choosing a durable ID

Position numbers change when you reorder rows or Card declarations, add loop cases, or
change counts. That makes `[project_card]` useful for a particular print manifest, but
not a durable identity. Prefer a semantic code stored in your sheet and add the variant
and copy when duplicates must be distinct:

```goblin
text: "[edition]|[code]|[copy]"       # durable while those meanings stay stable
text: "[deck]|[deck_card]|[code]"     # explicit, but deck-position dependent
text: "[project_card]|[code]"         # unique in this generated project only
```

If you need an ID that survives sheet reordering, store it in a column such as `code`.
`[row]` is a visible position, not a hidden persistent row UUID.

All generation bindings are derived, not stored: nothing about them lives in your rows,
your autosave, or an exported [project file](../export-and-project/03-project-files.md) —
moving a row in the grid is what changes what `[row]` (and, downstream, `[card]`)
resolve to for it.
If a sheet declares a column with one of these names, that column **shadows** the
built-in of the same name for any Card bound to it (with the usual shadowing warning)
— existing projects that already used those names keep working unchanged.

## Interpolation

Inside a string, `[ref]` substitutes the value:

```goblin
text: "Cost: [cost]"      # → "Cost: 5"
```

Numbers and enum cases become text automatically here (trailing zeros are trimmed;
an enum prints its case name). Use `[[` to write a literal opening bracket.

### Reusable text inside a cell

Cell contents are values, not Goblin source, so a cell containing `[damage_icon]`
is not interpolated a second time. `Text` and `TextBox` have one purpose-built way
to place a shared marker-rich fragment anywhere inside cell text: put the fragment
in a top-level Text-valued let and write `{alias:damage_icon}` in the cell. Alias
expansion happens after `text: [column]` resolves and before inline asset, icon, and
color markers are parsed. See the complete
[damage-and-swords example](04-text.md#reusing-resolved-text-with-aliases), including
one-level expansion and D011 failure behavior.

### Zero-padding Number references

Inside a quoted string, write `[name:0N]` to pad a Number with zeroes to a minimum
width. `N` is a decimal width from 1 through 64, written without a leading zero:
`01`, `04`, and `064` are valid formats; `00`, `001`, and `065` are not.

```goblin
text: "[deck]-[deck_card:03]"  # BlackCards-007

let shifted_id: [project_card] + 100
text: "CG-[shifted_id:06]"     # CG-000107
```

The width includes a minus sign, and zeroes follow that sign: `-7` with `:04` becomes
`-007`. Width is only a minimum. A longer value is never truncated, and a fractional
value is never rounded (`1.25` with `:06` becomes `001.25`).

This format is Number-only and string-only. A Text or enum reference with `:0N` is a
type error, and `[name:04]` cannot be used as a standalone expression. Ordinary
`[name]` interpolation works exactly as before.

## Rows

Rows live in the grid, not in your code — editing a cell never rewrites your script.
Two rules worth knowing:

- **Pristine rows are excluded.** A row you just added and haven't typed in is dimmed
  and left out of the deck. It joins as soon as you type into it.
- **Bad cells are local.** A cell that doesn't fit its column flags red, and only the
  cards built from that row become placeholders. See
  [Errors and diagnostics](09-errors.md).

## Virtual columns

Use `virtual column name: Type = expression` inside a `Sheet:` when an exported
print manifest needs a computed value that users should not edit. Virtual columns
do not appear in the grid or row storage; they are evaluated for each generated card
and included by [Export Data](../export-and-project/08-data-export.md). Because they run
in the Card context, formulas can use ordinary columns, loop variables, every
generation binding (`[row]`, `[copy]`, `[deck]`, `[deck_card]`, `[card]`, and
`[project_card]`), and program `let` bindings.

```goblin
Sheet: Monsters
  column code: Text
  virtual column card_code: Text = "[card]|[code]"
```
