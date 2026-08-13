/**
 * The §3.9 demo project — the slice acceptance fixture, shared VERBATIM
 * between the compiler test fixture (__tests__/fixtures/demo.goblin, kept
 * byte-identical — test-enforced in demo.test.ts) and the editor store's
 * seed (task 4). Edit DESIGN.md §3.9 first; then both copies together.
 */

/** DESIGN.md §3.9, byte-for-byte (trailing newline included). */
export const DEMO_PROJECT_SOURCE = `# CardGoblin demo — monster deck: suits via loop, health as hearts

Enum: Suit
  case Rock
  case Paper
  case Scissors

Sheet: Monsters
  column name: Text
  column cost: Number
  column health: Number
  column count: Number

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
  Text: "Cost"
    x: 19
    y: 0.9
    size: 1.2
    pivot: right
    text: "Cost: [cost]"
  Icon: "Attack"
    x: 1
    y: 0.7
    size: 1.6
    color: white
    code: "SWORDS"
  Repeat: [health] as i
    Icon:
      x: 1.5 + [i] * 2
      y: 25
      size: 1.8
      color: red
      code: "HEARTS"

Template: PlainBack
  Rectangle:
    x: 0
    y: 0
    width: full
    height: full
    color: teal

Card: Monster
  sheet: Monsters
  size: poker
  x_units: 20
  y_units: auto
  loop: Suit as current_suit
  count: [count]
  Front: MonsterFront
  Back: PlainBack
`;

/** The §3.9 acceptance rows: 2 rows × 3 suits → 6 distinct faces,
 * 2+2+2+1+1+1 = 9 physical cards. Frozen — copy before mutating. */
export const DEMO_PROJECT_ROWS: readonly Readonly<Record<string, string>>[] = [
  { name: "Dragon", cost: "5", health: "4", count: "2" },
  { name: "Imp", cost: "1", health: "2", count: "1" },
];
