---
title: "Dicemancy: the game that made me build CardGoblin"
description: "A design log for Dicemancy — and why making its deck by hand turned into building a tool that generates decks from a script and a spreadsheet."
tags: design log, dicemancy, origin
author: Eduardo Aguilar
draft: true
---

# Dicemancy: the game that made me build CardGoblin

> **DRAFT SKELETON.** The structure and the framing are in place; the prose is
> yours to write. Every `TODO` below marks something only you can fill in.
> Delete this callout before publishing.

[Dicemancy](https://boardgamegeek.com/boardgame/444226/dicemancy) is a game I
designed. It exists, it's on BoardGameGeek, and people play it.

It's also the reason CardGoblin exists.

TODO — one paragraph on what Dicemancy *is*: the hook, the core loop, what
makes it yours. Assume the reader has never heard of it. Keep it short; this
post is about the making, not the rules.

## The game

TODO — the design story. Useful beats to hit:

- Where the idea came from.
- The core mechanism and what it took to make it work.
- One thing you cut, and why. (Cuts are the most interesting part of any
  design log, and the part other designers actually learn from.)
- Where it landed: player count, length, how the final deck is structured.

## Making the cards was the worst part

This is the section that earns the rest of the post. TODO — the honest version
of what producing the deck was like:

- How many cards, and how many *variants* of essentially the same card.
- The tool you used, and where it fought you.
- The moment something changed late — a number rebalanced, a keyword renamed —
  and what that cost you across every card that mentioned it.
- How many times you re-exported a PDF before it printed correctly.

The pattern worth naming: **a deck is mostly data wearing a layout.** Sixty
cards that differ by a name, a number, and an icon are sixty chances to make a
copy-paste mistake — and one balance change means sixty edits.

## So I built the tool I wanted

CardGoblin came out of that. You describe what a card looks like *once*, in a
small script; your data lives in a spreadsheet; the whole deck generates from
the two, live.

```goblin
Sheet: Spells
  column name: Text
  column cost: Number
  column power: Number

Template: SpellFront
  Rectangle: "Banner"
    x: 0
    y: 0
    width: full
    height: 3
    color: if [cost] > 3 then mediumpurple else teal
  Text: "Title"
    x: middle
    y: 0.7
    size: 1.6
    text: [name]
  Repeat: [power] as i
    Icon:
      x: 1.5 + [i] * 2
      y: 25
      size: 1.8
      color: crimson
      code: "D6"
```

TODO — replace the snippet above with a real one from Dicemancy, and say what
it does. The `Repeat` block is the part worth explaining: one number in a
spreadsheet cell becomes N drawn icons on the card. That single feature is
what most of the manual work had been.

Rebalance a cost and every affected card redraws. Rename a column and the
references follow. A bad cell turns one card into a labelled placeholder
instead of breaking the deck.

## The expansion is being built with it

The original Dicemancy deck was made the hard way. **The expansion is being
built in CardGoblin** — which is the real test, because I'm now the user
finding out where my own tool is annoying.

TODO — the honest field report:

- What's genuinely faster now.
- What CardGoblin still can't do that you want (images, text wrapping, and
  saving are the current gaps — see [current limits](/docs/limits)).
- Anything the expansion forced you to add or change.

## Try it

CardGoblin is free and runs in your browser — nothing to install, no account.
If you're making a deck with any structure to it, it'll save you the worst
afternoon of your project.

- [Open the editor](/editor) — it loads with a working demo deck.
- [Read the quickstart](/docs/quickstart) — a full deck in about five minutes.
- [How generation works](/docs/cards-and-generation) — rows × loops × count.
