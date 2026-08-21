---
title: Data export
status: stable
summary: Export one CSV row for every generated card, including computed virtual columns.
---

# Data export

**Export Data** in the status bar downloads a CSV print manifest. It contains one row
for every generated card instance—not merely one row for every spreadsheet row—so
`loop:` combinations and `count:` copies appear separately and in the same order as
the preview and PDF.

The first columns identify each instance:

| CSV column | Meaning |
|---|---|
| `@card` | `Card:` declaration name |
| `@sheet` | Bound `Sheet:` name |
| `@row` | 1-based source row number |
| `@card_number` | 1-based position inside that generated deck; the same value as `[card]` / `[deck_card]` |
| `@project_card` | 1-based physical position across every generated deck; the same value as `[project_card]` |
| `@copy` | 1-based position among the current `count:` copies |
| `@loop.<name>` | Selected enum case for each Card loop variable |

Those `@` names cannot collide with Goblin identifiers. The remaining columns are
the physical sheet cells followed by any virtual columns. Projects with several Card
blocks or sheets use the union of their columns; cells that do not apply to an
instance are empty. CSV quoting follows the standard comma/newline/double-quote
rules, and the file is UTF-8.

## Virtual columns

A virtual column is a formula declared inside a Sheet:

```goblin
Sheet: Monsters
  column name: Text
  column code: Text
  column count: Number
  virtual column card_code: Text = "[card]|[code]"
```

It is type-checked like other Goblin expressions and evaluates once for the exact
generated card instance, so `[card]` can produce a different value for each copy.
Columns, Card loop variables, all generation built-ins, and program `let` bindings are
all available. For example, the formula can be shared through a global:

```goblin
let card_code: "[card]|[code]"

Sheet: Monsters
  column code: Text
  virtual column card_code: Text = [card_code]
```

Virtual columns never appear in the spreadsheet, are never stored in row data, and
cannot be edited. Change their expressions in the code editor. Their names must not
duplicate a physical or another virtual column in the same Sheet.

For a single Card block the download is named after that Card, such as
`Monster.csv`; projects with several Card blocks download `cardgoblin-data.csv`.
