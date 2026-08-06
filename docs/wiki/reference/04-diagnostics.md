---
title: Diagnostics catalog
status: planned
summary: A code-by-code table of every E, W, and D diagnostic — not written yet.
---

# Diagnostics catalog

**This page is a placeholder.** Every problem CardGoblin reports carries a code —
`E001` for a syntax error, `D003` for an empty cell a template needs, `W004` for an
unrecognised icon code — and this page will eventually list all of them with an
example and a fix.

For now:

- **[Errors and diagnostics](errors.md)** covers what each *kind* of problem looks
  like and how to recover, which is what you need in practice — the editor already
  shows you the message next to the mistake.
- The authoritative code list lives in the project's design document, under
  "Diagnostics catalog":
  [`docs/DESIGN.md`](../../DESIGN.md).

## The shape of it

| Prefix | When it's raised | Where it shows |
|---|---|---|
| `E` | Compiling your code, before any data is touched | Squiggle in the editor |
| `W` | Compiling — suspicious, not fatal | Warning squiggle |
| `D` | Building actual cards from your rows | Red cell and/or placeholder card |

If you hit a code you can't decipher, that's worth reporting — the message should
stand on its own.
