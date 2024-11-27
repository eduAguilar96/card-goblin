# CardGoblin

![logo](https://i.imgur.com/p2Fph5X.png)

---

CardGoblin is a powerful, browser-based tool for board game designers to create professional-quality cards for games. It combines an intuitive scripting language with a built-in spreadsheet-like cell manager to streamline card generation and customization. Key features include:

- A simple, human-readable scripting language with support for attributes, conditional logic, and loops.
- A built-in cell manager for organizing and referencing data rows, enabling dynamic card creation.
- Enum-based validation for consistent data references and error prevention.
- Real-time previews and PDF export for high-quality print-ready outputs.

Whether you're a seasoned designer or new to game creation, our tool simplifies the process so you can focus on bringing your ideas to life.

---

![ui-image](https://i.imgur.com/yB7G85e.png)

---

```
Enum: "Suit"
  case Rock
  case Paper
  case Scissors

Template: "UserDefinedCardFront
  Rectangle: "Banner"
    x: 0
    y: 0
    width: full
    height: 10
    color: if [current_suit] == Rock then grey
            else if [current_suit] == Paper then yellow
            else purple
  Text:
    x: middle
    y: 5
    text: [name]
  Text:
    x: 16
    y: 5
    text: [cost]

Template: "UserDefinedCardBack
  Rectangle: "Back"
    x: 0
    y: 0
    width: full
    height: full
    color: white

Card:
  size: square
  loop: Suit as current_suit
  cardCount: [card_count]
  x_units: 20
  y_units: auto
  Front:
    UserDefinedCardFront
  Back:
    UserDefinedCardBack

```
