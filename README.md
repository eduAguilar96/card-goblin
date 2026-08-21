# CardGoblin

![CardGoblin logo](public/card_goblin_logo.svg)

CardGoblin is a browser-based tool for turning a small declarative script and a
spreadsheet into a deck of print-at-home cards. Describe the layout once, keep each
card's content in rows, preview the generated deck live, and export a true-to-size
PDF.

The public editor is local-first: code and rows autosave in this browser, uploaded
images live in IndexedDB, and project files are the supported backup and transfer
mechanism.

## Quick example

```goblin
Enum: Suit
  case Rock
  case Paper
  case Scissors

Sheet: Monsters
  column name: Text
  column cost: Number

Template: MonsterFront
  Rectangle:
    x: 0
    y: 0
    width: full
    height: full
    color: if [current_suit] == Suit.Rock then grey
           else if [current_suit] == Suit.Paper then gold
           else mediumpurple
  Text:
    x: 2
    y: 2
    size: 2
    text: "[name] — [cost]"

Card: MonstersBySuit
  sheet: Monsters
  size: poker
  x_units: 20
  y_units: auto
  loop: Suit as current_suit
  Front: MonsterFront
```

Each populated row generates one card for every `Suit` case. The editor checks
references and types as you write, isolates bad row data to its affected cards, and
keeps the last good preview visible while code is temporarily broken.

## Documentation

- [What is CardGoblin?](docs/wiki/getting-started/01-what-is-cardgoblin.md)
- [Five-minute quickstart](docs/wiki/getting-started/02-quickstart.md)
- [Goblin script reference](docs/wiki/goblin-script/01-basics.md)
- [Developer guide](docs/development.md)
- [Design and decision log](docs/DESIGN.md)

User-facing documentation lives under [`docs/wiki/`](docs/wiki) and is rendered at
`/docs`. Wiki links use their real numbered filenames so they work both on GitHub and
on the generated documentation site.

## Development

Requires Node.js 22+.

```bash
npm install
npm test
npm run dev
```

See [the developer guide](docs/development.md) for type checking, linting, builds,
architecture, and the manual smoke test.

## Credits

Game icons: [Dicier](https://speakthesky.itch.io/typeface-dicier) by Speak the Sky,
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
