/**
 * The landing page's showcase deck — a real Goblin script, compiled by the
 * real compiler at build time.
 *
 * This exists so the landing page can show actual output instead of
 * screenshots. Screenshots of a card tool go stale the moment the renderer
 * changes and quietly start lying; compiled output cannot. It's also the
 * cheapest possible end-to-end proof: if these cards render, the pipeline
 * works.
 *
 * Kept deliberately short — the same source string is DISPLAYED on the page
 * next to the cards it produces, so every line has to earn its place. The
 * white card stock comes from the preview's own wrapper, so there's no
 * background rectangle here.
 *
 * A test (`__tests__/showcase.test.ts`) asserts this compiles clean and
 * produces the expected cards, so a language change can't silently break the
 * front door.
 */

export const SHOWCASE_SOURCE = `Enum: Element
  case Fire
  case Water
  case Earth

Sheet: Spells
  column name: Text
  column element: Element
  column power: Number

Template: SpellFront
  Rectangle: "Banner"
    x: 0
    y: 0
    width: full
    height: 4.5
    color: if [element] == Element.Fire then crimson
           else if [element] == Element.Water then steelblue
           else darkolivegreen
  Text: "Name"
    x: middle
    y: 1.1
    size: 1.9
    color: white
    text: [name]
  Icon: "Sigil"
    x: middle
    y: 9.5
    size: 8
    color: gainsboro
    code: if [element] == Element.Fire then "D6"
          else if [element] == Element.Water then "D8"
          else "D20"
  Repeat: [power] as i
    Icon:
      x: 1.4 + [i] * 2.4
      y: 23.4
      size: 2.2
      color: goldenrod
      code: "COIN"

Card: Spell
  sheet: Spells
  size: poker
  x_units: 20
  y_units: auto
  Front: SpellFront
`;

/** Rows for the showcase sheet — the "spreadsheet" half of the pitch. */
export const SHOWCASE_ROWS: readonly Readonly<Record<string, string>>[] = [
  { name: "Ember Dart", element: "Fire", power: "2" },
  { name: "Tidal Surge", element: "Water", power: "4" },
  { name: "Stone Ward", element: "Earth", power: "3" },
];

/** The sheet name the rows belong to — must match the `Sheet:` above. */
export const SHOWCASE_SHEET = "Spells";
