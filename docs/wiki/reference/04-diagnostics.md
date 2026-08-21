---
title: Diagnostics catalog
status: stable
summary: Every E, W, and D code, what it means, and whether the affected card still renders.
---

# Diagnostics catalog

Every problem CardGoblin reports carries a code. The prefix tells you when it was
found and what happens next:

| Prefix | When it is raised | What you see |
|---|---|---|
| `E` | Compiling code, before row data is evaluated | Red squiggle; preview and grid keep their last good result |
| `W` | Compiling code; suspicious but not fatal | Warning squiggle; rendering continues |
| `D` | Generating actual cards from rows | Red cell, diagnostic, placeholder, or truncation as listed below |

Internal fallback codes `E000` and `D000` may appear if CardGoblin itself cannot
classify an unexpected compiler or generation failure. They are not mistakes users
are expected to target directly; preserve the project and report the message.

## Compile errors

| Code | Meaning | Usual fix |
|---|---|---|
| `E001` | Syntax error, including malformed interpolation | Fix the highlighted spelling, delimiter, indentation, or expression |
| `E002` | Unknown sheet, Template, enum, column, variable, or other reference | Correct the name or declare it in the reachable scope |
| `E003` | Type mismatch, including a value that cannot be interpolated | Supply the type required by that property or expression |
| `E004` | Bare enum case cannot be resolved from context | Qualify it, for example `Suit.Rock` |
| `E005` | Duplicate declaration, column, enum case, argument, or property | Keep one unique declaration/value |
| `E007` | Contextual keyword used where it is not legal | Use the keyword only in its supported property or axis |
| `E008` | Required property is missing or invalid, or a preset is unknown | Add/fix the named `Card` or shape property |
| `E009` | Cyclic `let` dependency or Template-call dependency | Break the dependency path printed in the message |
| `E010` | Template composition exceeds 64 active calls or 10,000 call-reached nodes per Card face | Remove recursion or flatten/reduce the composition graph |

`E006` is intentionally retired. Unknown literal icon codes were downgraded to
`W004` because Dicier's curated code list is not exhaustive.

## Compile warnings

| Code | Meaning | Usual fix |
|---|---|---|
| `W001` | A binding shadows another binding | Rename one when the overlap is accidental |
| `W002` | A declaration is unused | Remove it or reference it; top-level lets that validly resolve to Text as alias targets, and their global dependencies, are exempt |
| `W003` | Explicit `y_units` makes units non-square | Prefer `y_units: auto` unless stretching is deliberate |
| `W004` | Literal `Icon` code or inline Dicier marker is not in the known list | Check the spelling; it may still be a valid uncatalogued glyph |
| `W005` | Literal `asset:` image or inline asset marker is not in the current Assets library | Upload it or correct the asset name |

Warnings never replace a card with a placeholder.

## Data diagnostics

`D001`–`D003` identify a source cell, flag it red, and replace every affected card
with a labelled placeholder. The other codes have no single source cell and use the
posture stated in the table.

| Code | Meaning | Result |
|---|---|---|
| `D001` | Cell value is not a case of its enum column | Affected cards become placeholders |
| `D002` | Cell is not numeric in a Number column | Affected cards become placeholders |
| `D003` | An edited row has an empty Number or enum cell that generated content needs | Affected cards become placeholders |
| `D004` | `Repeat` count is negative/non-integer, or the cumulative budget exceeds 500 expansions | Affected card becomes a placeholder; no partial face is kept |
| `D005` | A computed `Icon` code or inline marker is unknown | Diagnostic only; the failed ligature/raw marker remains visible |
| `D006` | `count:` is negative, non-integer, or cannot be evaluated | One placeholder for that row × loop-case combination |
| `D007` | One `Card:` block exceeds 2,000 physical instances | That block is truncated and generation continues |
| `D008` | Numeric evaluation is non-finite, such as division by zero | Affected card becomes a placeholder |
| `D009` | QR data exceeds the selected error-correction level's maximum capacity | Affected card becomes a placeholder |
| `D010` | Runtime Template composition exceeds 64 active calls or 10,000 call-reached nodes for one face/copy | Affected card becomes a placeholder |
| `D011` | A [resolved-text alias](../goblin-script/04-text.md#reusing-resolved-text-with-aliases) has no top-level target, has a statically non-Text target, or could not be prepared as a valid target | Diagnostic only; the raw `{alias:name}` marker stays visible and the card renders |

See [Errors & diagnostics](../goblin-script/09-errors.md) for how these states look
in the editor and how last-good preview behavior protects the rest of the deck. Data
errors raised while evaluating an otherwise valid Text alias keep their own code and
result (for example, D003 still makes a placeholder); they are not remapped to D011.
