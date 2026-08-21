---
title: What is CardGoblin
status: stable
summary: A script plus a spreadsheet becomes a print-at-home deck, live as you type.
---

# What is CardGoblin

CardGoblin turns **a small script + a spreadsheet** into **print-at-home cards**.

You describe what a card looks like *once*. Your spreadsheet holds the data — one
row per monster, spell, or item. CardGoblin generates the whole deck from those two
things and re-renders it live as you type.

```
   your script            your spreadsheet
  (what a card is)        (what's on them)
         │                        │
         └────────┬───────────────┘
                  ▼
          the whole deck, live
                  │
                  ▼
             print PDF
```

## Why it works this way

Card design is mostly repetition. Sixty cards that differ only in a name, a number,
and an icon are sixty chances to make a copy-paste mistake in a drawing tool. Writing
the layout once and the *data* separately means:

- **Change the layout, every card follows.** Move the title, and it moves on all 60.
- **Change one number, only its cards follow.** Editing a cell re-renders only the
  cards generated from that row.
- **Mistakes stay local.** A bad cell turns only the cards generated from its row
  into labelled placeholders — it never blanks the deck. This is a design rule, not
  an accident: see
  [Errors and diagnostics](../goblin-script/09-errors.md).

## What you get

- A **language** ([Goblin script](../goblin-script/01-basics.md)) that reads like an outline: indentation
  is structure, `[brackets]` mean "look this up in the data".
- A **spreadsheet** whose columns are declared by your code, so every reference is
  checked as you type — a typo like `[helth]` squiggles immediately.
- A **live preview** of every generated card, and **[PDF export](../export-and-project/01-pdf-export.md)** with
  cut lines and duplex-mirrored backs.
- **Icons** — 888 game glyphs (dice, suits, dominoes, coins) via the
  [Dicier](https://speakthesky.itch.io/typeface-dicier) font.

## Where your work lives

The public editor does not upload your Goblin script, spreadsheet rows, or uploaded
images. Code and rows autosave to this browser's `localStorage`; images added through
the Assets drawer live in IndexedDB; the current compiled preview is held in memory.
See [Autosave](../export-and-project/02-autosave.md) and
[Uploaded assets](../export-and-project/04-assets.md) for the details and limits.

Like any web app, your browser may cache CardGoblin's own app code, fonts, and icons
so pages load efficiently. That ordinary browser cache is not a project backup or a
sync service. Clearing this site's data can erase your local project, so export a
[project file](../export-and-project/03-project-files.md) for anything important.

One exception is artwork you reference by an external `https://` URL: the browser
fetches that image from its host, which receives an ordinary web request. Upload an
image through Assets when you want the artwork itself stored only in this browser.

## Who it's for

Board game designers making print-and-play prototypes, especially decks with
structure — rank × suit, one icon per point of health, a cost that changes a banner's
color. If your deck is 60 cards of the same shape, this pays off fast. If it's 5 cards
of wildly different art, a drawing tool is probably still the better answer.

## Where to go next

- **[Quickstart](02-quickstart.md)** — build a real deck in five minutes.
- **[The editor](03-the-editor.md)** — what the three panels do.
- **[Goblin script basics](../goblin-script/01-basics.md)** — the language from the ground up.
