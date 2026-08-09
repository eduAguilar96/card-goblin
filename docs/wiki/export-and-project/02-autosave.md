---
title: Autosave
status: evolving
summary: Your project saves itself in this browser — what persists, when, and the limits.
---

# Autosave

Your project — the code and every spreadsheet row — saves itself to this browser as
you work, and comes back when you reopen [the editor](the-editor.md). There is no
save button and nothing to configure.

## What saves, and when

- **What:** your Goblin script and all sheet rows, including which rows you've
  touched — so dimmed pristine rows come back dimmed.
- **When:** about **1 second** after your last change, and immediately when you
  switch away from the tab or close the page.
- **Where:** this browser on this machine (local storage). Nothing leaves your
  computer.

What you had is what you get back. If you reload mid-edit with broken code, the
editor restores the broken code, squiggles and all — not some older working version.

## Reset to demo

**Reset to demo** in the status bar wipes the saved project and loads the demo deck.
It asks before doing it, because there is only one project slot: the demo *replaces*
your work.

## The limits

- **One project, one browser.** A single save slot, tied to this browser profile.
  Another browser, another device, or a private window starts from the demo. Project
  files you can export and import are on the [roadmap](roadmap.md).
- **Two tabs fight.** With the editor open in two tabs, the tab that changed last
  wins; the other tab's changes are gone on its next load.
- **It's browser storage, not a backup.** Clearing site data deletes the project.
  For anything you'd mind losing, copy the code out and keep a
  [PDF](pdf-export.md) of the deck.
- **Private mode may turn it off.** If the browser refuses storage, the status bar
  shows a quiet **autosave off** and the editor works normally for the session — but
  nothing survives a reload.
