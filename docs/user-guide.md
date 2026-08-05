# CardGoblin User Guide

CardGoblin turns **a small script + a spreadsheet** into **print-ready cards**. You
describe what a card looks like once; your spreadsheet holds the data; CardGoblin
generates the whole deck and re-renders it live as you type.

This guide covers the editor, the language ("Goblin script"), and the reference
tables for card sizes, colors, and icons.

---

## 1. The editor at a glance

The editor (`/editor`) has three panels and a status bar:

- **Code** (top left) — your Goblin script. Errors appear as squiggles here, like a
  code editor.
- **Preview** (top right) — every generated card, live. Toggle **Front/Back**, zoom
  with the slider. While your code has errors, the preview freezes on the last good
  result (an amber note says so) instead of flickering.
- **Spreadsheet** (bottom) — one tab per `Sheet:` you declare in code. The *columns*
  come from your code; the *rows* are yours to fill. Invalid cells flag red; brand-new
  empty rows render dimmed and are excluded until you type into them.
- **Status bar** — total cards, code problems, flagged cells, excluded rows.

Everything recompiles about a third of a second after you stop typing.

## 2. Five-minute tour

The editor opens with a demo project. The pieces:

```goblin
Enum: Suit
  case Rock
  case Paper
  case Scissors
```

An **Enum** is a fixed set of options. Enums can type spreadsheet columns (cells
become dropdowns) or drive card generation via `loop:`.

```goblin
Sheet: Monsters
  column name: Text
  column cost: Number
  column health: Number
  column count: Number
```

A **Sheet** declares a spreadsheet tab and its columns. Column types are `Text`,
`Number`, or any Enum you declared. Add or rename a column here and the grid follows
(renaming a column keeps its data when the type and position stay the same).

```goblin
Template: MonsterFront
  Rectangle: "Banner"
    x: 0
    y: 0
    width: full
    height: 3
    color: if [current_suit] == Suit.Rock then grey
           else if [current_suit] == Suit.Paper then gold
           else mediumpurple
  Text: "Title"
    x: middle
    y: 0.7
    size: 1.6
    color: black
    text: [name]
  Repeat: [health] as i
    Icon:
      x: 1.5 + [i] * 2
      y: 25
      size: 1.8
      color: red
      code: "HEARTS"
```

A **Template** is a drawing: a list of shapes, drawn top to bottom in the order you
write them (later shapes draw on top). `[name]` and `[health]` pull values from the
spreadsheet row of whichever card is being drawn; `[current_suit]` comes from the
Card's loop (below). The `Repeat:` block is the star: it draws its children N times —
here, one heart icon per point of health, each positioned by index math.

(The version above is abridged — the editor's full demo adds a cost label and a suit
icon to this template.) A back is just another template:

```goblin
Template: PlainBack
  Rectangle:
    x: 0
    y: 0
    width: full
    height: full
    color: teal
```

```goblin
Card: Monster
  sheet: Monsters
  size: poker
  x_units: 20
  y_units: auto
  loop: Suit as current_suit
  count: [count]
  Front: MonsterFront
  Back: PlainBack
```

A **Card** ties it together: which sheet feeds it, the physical size, the coordinate
grid, and which templates draw the front and back. Cards are generated as
**rows × loop options × count**: with 2 rows, 3 suits, and counts of 2 and 1, you get
2×3 = 6 distinct faces and 9 physical cards. Omit `loop:` for one card per row; omit
`Back:` for a plain white back.

## 3. The language

### 3.1 Basics

- **Indentation is structure** (like the examples above). Use consistent spaces or
  tabs throughout the file.
- **Comments** start with `#` and run to the end of the line. (One quirk: `#` followed
  by exactly six hex digits is a *color*, e.g. `#ff0000` — so don't start a comment
  with something like `#ff0000`.)
- **Names** (`Suit`, `Monsters`, `MonsterFront`) are plain words: letters, then
  letters/digits/underscores. Keywords like `Card` or `Repeat` can't be used as names.
- The quoted labels on shapes (`Rectangle: "Banner"`) are optional and purely for your
  own readability.
- A property's value may continue onto following lines if they're indented deeper than
  the property (see the multi-line `color:` above).

### 3.2 Data references: `[column]`

Square brackets always mean "look this value up":

1. the nearest `Repeat` variable, then
2. the Card's `loop` variables, then
3. the bound sheet's columns.

Every reference is checked as you type — a typo like `[helth]` squiggles immediately.

Inside text strings, references interpolate: `text: "Cost: [cost]"` renders
"Cost: 5". Use `[[` to write a literal `[`.

### 3.3 Expressions

Anywhere a value goes, an expression can go:

| Kind | Examples |
|---|---|
| Arithmetic | `[cost] + 1`, `2 * [i]`, `[atk] % 3`, parentheses |
| Comparison | `==` `!=` on matching types; `<` `<=` `>` `>=` on numbers |
| Logic | `and`, `or`, `not` |
| Conditional | `if [cost] > 3 then gold else grey` — `else` is required; chain with `else if` |
| Enum cases | `Suit.Rock` always works; bare `Rock` works when it's unambiguous |

Comparisons don't chain (`a == b == c` is an error — use `and`).

### 3.4 Shapes

| Shape | Required | Optional (default) | Notes |
|---|---|---|---|
| `Rectangle` | `x y width height color` | — | anchored at its top-left corner |
| `Text` | `x y size text` | `color` (black), `anchor` (left) | one line; `size` is the text height in units |
| `Icon` | `x y size code` | `color` (black), `anchor` (left) | draws a game icon — see §6 |
| `Repeat: N as i` | — | — | draws its children N times; `[i]` counts 0, 1, 2… |

- `y` is the **top** of a text/icon line; `x` is its left edge unless anchored.
- `anchor: left | middle | right` controls which point `x` refers to.
- `x: middle` is shorthand for "horizontally centered" (Text/Icon only).
- `Repeat` counts can come from data (`Repeat: [health] as i`) and nest freely, up to
  500 drawn copies per card.

### 3.5 The coordinate grid

Cards use an abstract unit grid so your layout survives size changes and prints
exactly:

- `size:` picks the physical card (see §4).
- `x_units: 20` slices the card's width into 20 units; **one unit = width ÷ 20**.
- `y_units: auto` keeps units square and derives the height count (a poker card at 20
  wide is exactly 28 tall). You can force an integer instead, which stretches the grid
  (you'll get a warning).
- `full` = the whole axis, `half` = half of it: `width: full` spans the card.

### 3.6 Card generation

For each Card block: every non-empty sheet row × every combination of `loop:` cases ×
`count:` copies, in that order. Multiple `loop:` lines nest (row × suits × elements ×
…). `count:` defaults to 1 and may be an expression. A Card generates at most 2,000
physical cards — a typo'd count of 999999 truncates with a note instead of freezing
the editor.

## 4. Card sizes

| `size:` | Physical | Good for |
|---|---|---|
| `poker` | 63.5 × 88.9 mm | standard playing cards |
| `bridge` | 57.15 × 88.9 mm | narrow hands, trick-takers |
| `tarot` | 70 × 120 mm | big art, oracle decks |
| `square` | 70 × 70 mm | tiles, tokens |
| `mini` | 44 × 63.5 mm | resource cards, dense layouts |

(Custom sizes are on the roadmap.)

## 5. Colors

`color:` accepts:

- **Any standard CSS color name** — `white`, `black`, `red`, `gold`, `teal`, `grey`,
  `mediumpurple`, `hotpink`, `darkslateblue`, … (148 names), and
- **Hex** — `#ff0000`, `#1a2b3c`.

Color names only mean colors in color positions, so an enum case named `gold` never
collides with the color.

## 6. Icons

Icons come from **[Dicier](https://speakthesky.itch.io/typeface-dicier)** (by Speak
the Sky, CC BY 4.0) — a game-icon font with 888 usable codes: dice, card suits,
dominoes, coins, and more. You use them by code:

```goblin
Icon:
  x: 1
  y: 1
  size: 2
  color: crimson
  code: "HEARTS"
```

Codes are UPPERCASE strings. Misspelled codes get a warning squiggle and render as raw
text on the card so you can spot them. Codes can even be computed:
`code: if [hp] > 5 then "CROWN" else "COIN"`.

**Categories with sample codes** (the full list lives in
[`docs/vendor/dicier-v1.5.4/Dicier codes v1_5_4.txt`](vendor/dicier-v1.5.4/Dicier%20codes%20v1_5_4.txt)):

| Category | Sample codes |
|---|---|
| Card suits | `HEARTS` `DIAMONDS` `CLUBS` `SPADES` |
| Card values | `ACE` `TWO` … `TEN` `JACK` `QUEEN` `KING` |
| Value + suit | `ACE_HEARTS` `QUEEN_SPADES` … |
| Jokers | `JOKER` `RED_JOKER` `BLACK_JOKER` |
| Dice shapes | `D2` `D4` `D6` `D8` `D10` `D12` `D20` |
| Dice results | `3_ON_D6` `20_ON_D20` `ANY_ON_D8` … |
| Numbered dice | `0`–`9` |
| Fudge / special dice | fudge, yes/and/no/but, trigram, even/odd dice |
| Dominoes | generic, numbered, and wildcard dominoes |
| Coins | `COIN` `HEADS` `TAILS` `ANY_FLIP` `ON_EDGE` |
| Historic & tarot suits | season suits, minor arcana (`SWORDS` `CUPS` `COINS` `WANDS`), heckadeck |
| Misc | `CROWN` `ANCHOR`, zener cards (`Z_STAR` …), dreidel (`GIMEL` …) |

## 7. When things go wrong (on purpose or not)

CardGoblin's rule is: **one mistake never blanks your deck.**

| You see | It means |
|---|---|
| Red squiggle in the code | A code problem (typo, type mismatch, missing property). The preview and grid hold the last good state; the status bar shows "stale". |
| Red cell in the grid | That cell's value doesn't fit its column (not a number, not a valid enum option, or empty but needed). Only the cards using that cell become error placeholders — the rest render. |
| A grey "placeholder" card | One card's data couldn't be evaluated (bad cell, divide-by-zero, runaway repeat). The error messages are shown on the card. |
| A dimmed spreadsheet row | A brand-new, never-edited empty row — excluded from the deck until you type into it. |
| An icon showing raw text like `HEARTZ` | Unknown icon code — fix the spelling. |

## 8. Current limits (v1)

- Text is single-line — no wrapping yet.
- No images yet (icons via Dicier cover a lot; an `Image` element is next on the
  roadmap, as is PDF export).
- 500 repeated shapes per card, 2,000 cards per Card block.
- Projects don't persist across reloads yet — copy your code out to keep it (save/load
  is on the roadmap).
