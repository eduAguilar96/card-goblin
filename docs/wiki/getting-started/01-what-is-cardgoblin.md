---
title: What is CardGoblin
status: stable
summary: A script plus a spreadsheet becomes a print-ready deck, live as you type.
---

# What is CardGoblin

CardGoblin turns **a small script + a spreadsheet** into **print-ready cards**.

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
- **Change one number, one card follows.** Editing a cell re-renders only the cards
  that use it.
- **Mistakes stay local.** A bad cell turns one card into a labelled placeholder — it
  never blanks the deck. This is a design rule, not an accident: see
  [Errors and diagnostics](errors.md).

## What you get

- A **language** ([Goblin script](basics.md)) that reads like an outline: indentation
  is structure, `[brackets]` mean "look this up in the data".
- A **spreadsheet** whose columns are declared by your code, so every reference is
  checked as you type — a typo like `[helth]` squiggles immediately.
- A **live preview** of every generated card, and **[PDF export](pdf-export.md)** with
  cut lines and duplex-mirrored backs.
- **Icons** — 888 game glyphs (dice, suits, dominoes, coins) via the
  [Dicier](https://speakthesky.itch.io/typeface-dicier) font.

Everything runs in the browser. Nothing uploads anywhere.

## Who it's for

Board game designers making print-and-play prototypes, especially decks with
structure — rank × suit, one icon per point of health, a cost that changes a banner's
color. If your deck is 60 cards of the same shape, this pays off fast. If it's 5 cards
of wildly different art, a drawing tool is probably still the better answer.

## Where to go next

- **[Quickstart](quickstart.md)** — build a real deck in five minutes.
- **[The editor](the-editor.md)** — what the three panels do.
- **[Goblin script basics](basics.md)** — the language from the ground up.
