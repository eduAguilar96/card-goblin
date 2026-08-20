---
title: Errors & diagnostics
status: stable
summary: What each kind of error looks like, and why one mistake never blanks a deck.
---

# Errors & diagnostics

CardGoblin's rule is: **one mistake never blanks your deck.**

Every error is reported in the panel where you can act on it, and the blast radius is
kept as small as the mistake.

| You see | It means |
|---|---|
| **Red squiggle in the code** | A code problem — typo, type mismatch, missing property. The preview and grid hold their last good state; the status bar shows "stale". |
| **Red cell in the grid** | That cell's value doesn't fit its column: not a number, not a valid enum option, or empty but needed. Only the cards built from that cell's row become placeholders — and if that row makes several copies (`count:`), the whole group goes together, since they're built from one evaluation. |
| **A grey placeholder card** | One card's data couldn't be evaluated — a bad cell, a divide by zero, a runaway repeat. The error messages are printed on the card. |
| **An amber dot on a card** | A [`TextBox`](text.md) on that card had its text clipped or shrunk to fit the box — not an error, just worth a look. |
| **A dimmed spreadsheet row** | A brand-new, never-edited empty row. It's excluded from the deck until you type into it. |
| **An icon showing raw text** like `HEARTZ` | An unknown [icon code](icons.md) — on an `Icon`, or an [inline marker](text.md#inline-icons) that rendered as its raw `{HEARTZ}` text. Fix the spelling. |

## Two kinds of problem

**Code problems** are found before any data is touched — a syntax error, an unknown
reference, a type mismatch. They squiggle in the editor. While they're unresolved, the
preview keeps showing the last render that worked, and the grid keeps the last set of
columns that compiled, so nothing flickers while you're mid-edit.

**Data problems** are found while building actual cards — a cell that isn't a number,
an empty cell that a template needs, a `count:` that isn't a whole number, a
computed value that breaks (division by zero, a runaway repeat). These flag the
offending cell red where there is one, and turn the affected cards into
placeholders — a row's `count:` copies always fail as ONE group, never
individually, even when only one of them actually triggered the problem (the
placeholder message says which one). The rest of the deck renders normally.

## Warnings

Some things are suspicious rather than wrong, and warn instead of erroring:

- a `Repeat` variable shadowing a column name,
- a declaration nothing uses,
- an explicit `y_units` that makes units non-square,
- an icon code that isn't in the known list — on an `Icon` or in an inline
  `{marker}` in text — it may still be a real glyph, since the published list
  isn't exhaustive,
- an `asset:` reference to an upload that isn't in your library — in an `Image`
  `src:` or an inline `{asset:name}` marker — you might be about to add it.

## Composition problems

Cyclic `let` references and recursive Template calls are E009 errors; the message
shows the dependency path. Template composition is also bounded per Card face: at
most **64 active Template calls** and **10,000 Template-node visits reached through
calls**. Crossing either limit is E010 while checking or D010 while building a card.
These limits charge composition only: a large call-free legacy Template cannot hit
them, and `Repeat` keeps its separate 500-expansion limit.

## Recovering

- **Broken code?** Undo. The preview comes back live the moment the code parses again.
- **Placeholder cards?** Read the message printed on the card — it names the problem.
- **Errors after adding a column?** New `Number` and enum cells start empty; empty
  cells that a template references are an error by design, so that missing data is
  visible rather than silently defaulting to zero.

A full code-by-code catalog (E001, D003, W004…) is coming — see
[Diagnostics catalog](diagnostics.md).
