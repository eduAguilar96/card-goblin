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
- a format version, so future versions of CardGoblin can keep reading old files.

It's the exact same format [autosave](autosave.md) writes to your browser, as
plain JSON — readable in any text editor, friendly to version control.

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
  project is untouched. Import is all-or-nothing: it never half-loads a file.
- **The file is valid** — the status bar asks
  **Replace your project with "\<file\>"?** first, because importing is
  destructive: there is one project slot, and the file *replaces* what's open.
  If the current project matters, export it first.

After you confirm, the imported project is live immediately — and about a
second later it becomes the autosaved project too, just as if you'd typed it.
Reloading brings back the import, not what you had before.

## More than one project

Files are the multi-project story for now: the editor still has a single slot
(see [Autosave](autosave.md)), so keeping several projects means keeping
several `.cardgoblin.json` files and importing the one you want to work on.
Accounts and cloud projects are on the [roadmap](roadmap.md).
