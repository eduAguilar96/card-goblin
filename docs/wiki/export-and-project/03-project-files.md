---
title: Project files
status: stable
summary: Export your project as a file and import it back — backup, moving machines, and more than one project.
---

# Project files

**Export project** in the status bar downloads your whole project as a single
file; **Import project** loads one back. That's the entire feature — and it's
how you back a project up, move it to another browser or machine, hand it to a
friend, or keep more than one project at once.

## What's in the file

Everything the editor would need to pick up where you left off:

- your Goblin script,
- every sheet's rows — including which rows you've touched, so dimmed pristine
  rows come back dimmed, and including values from columns you've removed
  (they resurface if the column comes back),
- every [uploaded asset](templates-and-shapes.md) in your Assets drawer — the
  art itself, not a reference to it, so the file is self-contained,
- a format version, so future versions of CardGoblin can keep reading old files.

The code-and-sheets part is the exact same shape
[autosave](autosave.md) writes to your browser; assets are the one addition a
project *file* carries that the autosave slot doesn't (see
[Autosave](autosave.md) for why). Either way it's plain JSON — readable in any
text editor, friendly to version control (art included, as base64 text).

## Export

One click, no options. The file is named after your deck — a project whose code
declares exactly one `Card:` block downloads as `<deckname>.cardgoblin.json`;
anything else (several decks, or code too broken to tell) downloads as
`cardgoblin-project.cardgoblin.json`.

Export saves what's in the editor *right now*, broken code and all — like
autosave, it never swaps in some older working version behind your back.

## Import

**Import project** opens a file picker. Two things can happen:

- **The file isn't a readable CardGoblin project** — wrong file, damaged, or
  from an incompatible future version. The status bar says so, and your current
  project is untouched. Import is all-or-nothing: it never half-loads a file
  (a damaged asset entry invalidates the whole file, same as a damaged sheet
  row).
- **The file is valid** — the status bar asks
  **Replace your project (and your uploaded assets) with "\<file\>"?** first,
  because importing is destructive: there is one project slot and one asset
  library, and the file *replaces* both. If the current project or its
  uploads matter, export first.

After you confirm, the imported project is live immediately — and about a
second later it becomes the autosaved project too, just as if you'd typed it
(its assets, meanwhile, are already saved — see [Autosave](autosave.md)).
Reloading brings back the import, not what you had before.

### Older files still import

A file exported before uploaded assets existed has no art in it — importing
one is exactly like it always was, except your asset library is now cleared
too (there's nothing in the file to replace it with, and import always
replaces). Files this app has ever exported keep opening in every later
version.

## More than one project

Files are the multi-project story for now: the editor still has a single slot
(see [Autosave](autosave.md)), so keeping several projects means keeping
several `.cardgoblin.json` files and importing the one you want to work on.
Accounts and cloud projects are on the [roadmap](roadmap.md).
