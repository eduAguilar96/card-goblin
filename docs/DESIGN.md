# CardGoblin — Design Document

**Status:** A living design document, not a one-time agreement. §1–§5 record the
vertical slice (v1) as agreed and then revised once, after an adversarial review
(§10); §3 (the language) is kept current as the normative reference for what has
actually shipped, past the slice; §6 and §7 are the milestone 2 and milestone 3
specs, each amended in place as its pieces shipped.
Decisions marked ⚑ were made during the 2026-08-03 design session. Decisions marked
◆ — including every row added after the slice (◆31 on) — are working assumptions
chosen without an explicit question; veto freely. Entries marked † have been
**amended since they were first decided**: most were amended together, in the
Revision A adversarial review (change log in §10); later, one-off amendments carry
their own date inline next to the † and aren't in that change log.

---

## 1. Vision and slice scope

CardGoblin turns **code (a small declarative language) + data (a spreadsheet)** into
**print-ready cards**. The vertical slice proves the entire novel pipeline end to end:

> parse DSL → validate against sheet schema → generate the card set → render live SVG
> preview, with errors surfaced in the right window (squiggles in code, red cells in
> the grid, placeholder cards in the preview).

⚑ **PDF export is milestone 2, persistence is milestone 3.** Justification: both are
conventional technology with known solutions; everything inside the slice is the risky,
design-defining part. The slice is done when the demo project (§3.9) can be typed,
edited live, and broken on purpose with gracefully localized errors.

---

## 2. Decision log (summary)

Every decision, its choice, and the one-line justification. Sections below elaborate.

| # | Decision | Choice | Why (short) |
|---|----------|--------|-------------|
| ⚑1 | Card generation | **rows × loop cross-product**, `count:` multiplies copies | Expresses rank×suit decks without duplicated rows; degrades cleanly when loop absent |
| ⚑2 | Sheets | **multiple named sheets; Card binds explicitly** (`sheet: Monsters`) | Real games have several card types with different columns; sheets shareable between Cards |
| ⚑3 | Schema owner | **DSL declares columns + types; grid conforms** | Single source of truth → static checking of every `[ref]`; project = code + cell values |
| ⚑4 | Slice scope | **code+sheet → live preview** (no PDF/persistence) | Slice covers all novel joints; export/storage are additive later |
| ⚑5 | Template data | **ambient bindings**, statically checked per using Card | Zero ceremony for non-programmers; schema-in-DSL keeps it checkable anyway |
| ⚑6 | Expressions | **full engine v1**: arithmetic, comparisons, `and/or/not`, `if` chains, interpolation | User's heart-bar use case (one number → N drawn icons) needs real math; one Pratt parser covers it all |
| ⚑7† | Geometry | **abstract unit grid** from physical size preset; `y_units: auto` keeps units square (row count may be fractional, §3.4) | Resolution-independent, small friendly numbers, exact mm mapping for later PDF |
| ⚑8 | Run model | **live compile (~300 ms debounce), per-card error isolation** | Live preview is the product's magic; one bad cell must never blank the deck |
| ⚑9 | Element repetition | **`Repeat: <expr> as <var>` + index arithmetic** (no layout engine) | Fully general (rows/arcs/grids are math); auto-layout containers can be sugar later, reverse is a redesign |
| ⚑10† | Icons | **Dicier ligature font via a dedicated `Icon` element**; literal codes checked against a curated list (~888 unique codes, known non-exhaustive → warning, not error) | Vector, colorable, PDF-embeddable, zero asset pipeline |
| ⚑11 | Names | **bare identifiers** for declared names; quoted strings only for display labels | Names are referenced elsewhere; kills the unclosed-quote error class (README's own typo) |
| ⚑12 | Data home | **rows live in app store, not in code text** | Grid edits must not rewrite the Monaco buffer; project file later serializes both |
| ⚑13† | Sheet binding | **`sheet:` required on every Card**; zero-column sheets are legal (loop-only decks) | One uniform resolution model; relaxing later is additive |
| ◆14† | Enum case refs | `Suit.Rock` always; bare `Rock` resolves by **expected type**, falling back to globally-unique | Expected-type resolution avoids retroactive breakage when a new enum adds a colliding case |
| ◆15 | z-order | declaration order (later = on top) | Matches every drawing tool's mental model; no extra syntax |
| ◆16 | `Back:` | optional; absent → plain white back | Prototypes often don't care; zero-config default |
| ◆17 | Copies property | named `count:` (README's `cardCount` renamed) | Shorter; reads naturally as "count: [count]" |
| ◆18 | Repeat index | 0-based | `x: start + [i] * spacing` works without off-by-one |
| ◆19† | Empty cells | Number/Enum cell empty **and referenced** → per-card data error; empty Text → `""`; **pristine rows exempt (◆29)** | Silent defaults hide data-entry mistakes; error is local and visible |
| ◆20 | Icon codes | quoted strings (`code: "HEARTS"`), literal codes checked at compile time | Codes are data, not identifiers (some digit-leading like `3_ON_D6`, one contains a space) |
| ◆21† | Colors | CSS named colors + `#hex`; **names resolve only in Color-typed positions** | Familiar and printable, without turning ~148 CSS names into soft-reserved words |
| ◆22 | Comments | `#` to end of line | Standard for indentation languages; real projects need them |
| ◆23† | Multi-line expressions | continuation only on **property lines** (lowercase key), deeper-indented; `Repeat:` headers are single-line | The original "any deeper line continues" rule was undecidable against block structure |
| ◆24 | Text in v1 | single line, no wrapping | Text layout/wrapping is a real subsystem; deferred deliberately (§8) |
| ◆25 | Multiple loops | allowed; nested cross-product in declaration order | Trivial in the generator; avoids arbitrary limitation |
| ◆26† | Sheet data lifecycle | compile never deletes data; orphaned columns kept for the session; **same-position/same-type column rename migrates data** | Data must survive typos *and* committed renames |
| ◆27† | Expansion caps | 500 `Repeat` expansions per card **and 2,000 generated instances per Card** | A bad cell must not hang the preview — at either the repeat or the generator level |
| ◆28 | Dicier style | slice loads **Flat-Dark** only; `style:` property deferred — **superseded**: M2 shipped all ten faces via `style:` (§3.3) | One good default at slice time; style switching is additive |
| ◆29† | Pristine rows | never-edited all-empty rows are **dimmed in the grid and excluded from generation** (status bar reports exclusions) | Adding a row shouldn't spray D003 errors ×(loop cases) before the user can type |
| ◆30† | Keyword policy | **contextual keywords**: only block-opening words + expression-structure words are reserved; property names are ordinary identifiers; `[brackets]` always mean data refs | Without this, `column count:` and `[count]` in our own demo are illegal |

Decisions made after the slice, milestone by milestone — same format, each pointing at
the section that elaborates it:

| # | Decision | Choice | Why (short) |
|---|----------|--------|-------------|
| ◆31 | Autosave (§6.2) | localStorage, debounced **1 s**, `{version, code, sheets}`; an unreadable saved payload falls back to the demo but is copied to a **quarantine key** first | A corrupt project must stay recoverable by hand — quarantining is what stops the very next autosave from overwriting the only copy |
| ◆32 | Autocomplete (§6.3) | **Pure `computeCompletions()`** outside Monaco; its property/value tables **pinned to `check.ts`'s own specs** by E008-probe tests | Suggestions and the checker must never disagree about what's legal — pinning them with tests is what keeps that true as the language grows |
| ◆33 | Custom card sizes (§3.4) | `width_mm:` + `height_mm:` as **two ordinary Number properties**, required together, exact to 0.01 mm | Zero new grammar — parser, checker, autocomplete, and docs all extend mechanically |
| ◆34 | Icon style (§3.3) | `style:` bare identifier selecting one of **Dicier's ten faces** (default `flat_dark`), resolved by expected type like `pivot:`; each face its own `@font-face` | Supersedes ◆28's single-face slice default; per-face loading keeps unused faces out of the download |
| ◆35 | Image element (§3.3) | Sixth drawable element; `fit: contain\|cover\|stretch` via SVG `preserveAspectRatio`; exactly one dimension may be **`auto`** (derives from the art's ratio) | Reuses the existing element/geometry machinery rather than a special-cased image system; `auto` answers "size the box from the art" without new syntax |
| ◆36† | Pivots (§3.4) | **Nine-point `pivot:`** vocabulary on every drawable element, either word order accepted, `center` = `center_center`; legacy `left\|middle\|right` kept as aliases for the top row — **renamed from `anchor:`** (M3, 2026-08-13): it names which point of the SHAPE ITSELF `x`/`y` place (a sprite's *pivot*), not a point on a PARENT the shape aligns to (the Unity/Figma sense of *anchor*); freeing the name, instead of aliasing it, reserves `anchor:` for that card-relative-positioning feature, a separate planned future addition | One placement vocabulary for every shape, a direct user requirement; aliasing (not replacing) the legacy VALUES means existing cards render unchanged. The PROPERTY NAME was renamed outright, with no alias, because the confusion is real: `pivot: center_center` + `x: 0, y: 0` correctly centers the shape on ITSELF at the card's top-left corner, not "centered on the card" (that recipe is `x: half, y: half, pivot: center_center`) — keeping `anchor:` as a synonym would have permanently blocked it from ever getting its correct, different, future meaning |
| ◆37 | Text wrapping (§7.2) | New `TextBox` element; **the compiler is the wrapping authority**, measuring against a generated Geist metrics table — the model carries resolved `lines`; `overflow: clip\|shrink` (60% floor) | Preview and PDF must agree by construction — compiler-side wrapping is the only way two different renderers show identical line breaks |
| ◆38 | String escapes (§3.1) | `\n` (newline) and `\\` (literal backslash) are the lexer's **only** escapes besides `[[`; any other `\`-sequence is E001 | TextBox hard breaks need a way to write a newline inside a string literal; a minimal, closed escape set keeps errors loud on typos |
| ◆39 | QR codes (§7.3) | A drawable **`Qr:` element**, not the sketched `QR(...)` call form; encoded at eval time so the shape carries the resolved module matrix, never the source data | The language has no call grammar, and custom sizes already rejected inventing one; an element reuses the practiced element pipeline (checker, evaluator, autocomplete) end to end |
| ◆40 | Local image assets (§7.4) | **IndexedDB** (not localStorage) + an **`asset:` scheme** inside Image `src:` + a **project-file v2** that bundles asset bytes as base64 | localStorage is string-only with a small quota; IDB stores Blobs natively, and v2 keeps art traveling with the file without inventing a second file format |
| ◆41 | Text/TextBox fonts (§3.3) | **Repo-bundled closed vocabulary**: `geist` (default, unchanged) + eight faces — Cormorant Garamond and Courier Prime, four weights/styles each — resolved like Icon `style:`, each with its own generated metrics table | A deliberate PRAGMATIC unblock, not a font system: the owner needed these two families now; per-project **uploaded** fonts are real future work, deferred because wrapping needs a metrics table per face and building that pipeline for arbitrary uploads is a bigger project than unblocking two known families |
| ◆42 | Row/card position bindings (§3.6) | **`[row]` and `[card]` as built-in, derived bindings** resolving after sheet columns; the grid's row gutter becomes the editable index, and typing a position **moves the row and shifts the rest** (out-of-range clamps, garbage reverts) | Position IS row order, so storing a number would create a second source of truth that can disagree with it — deriving costs nothing and keeps the sheet payload, autosave slot, and project file unchanged. Two bindings because `loop:`/`count:` make one row into several cards: `[row]` labels the data, `[card]` serialises the deck. Resolving last means a sheet declaring its own `row`/`card` column shadows the built-in, so no existing project's COLUMN can be silently reinterpreted. (Narrow exception, not a column: a template that put an unresolvable `row`/`card` name where only Number/Text/Enum ever coerced — e.g. `color: [row]` — used to poison silently to Unknown with no sheet in scope; it now resolves and can genuinely E003, which is more correct, not less.) Editing the gutter rather than adding a column keeps ⚑3 (columns come from code) intact |
| ◆43 | Rotation (§3.4) | **`rotate:` as an optional Number property on every drawable element** — degrees, clockwise, any expression (data-driven allowed), default 0 — rotating the element **around its `pivot:` point**, which is exactly the card-space point `x`/`y` name | The pivot is the element's own handle (◆36†), so it is the one rotation center that needs no new vocabulary — `pivot: center_center` + `rotate:` spins a shape in place, the default `top_left` swings it around its corner, and `Repeat` + `rotate: [i] * step` makes fans and dials from index math (⚑9). Paint-time only: wrap, generation, caps, and PDF layout are geometry-in-card-units and never see the transform (the rasterizer serializes the same SVG markup, so PDF inherits rotation for free). An ordinary Number property needs zero new grammar — the ◆33 argument — and a non-numeric value is the usual E003, non-finite the usual D008 |
| ◆44 | Inline icons (§7.5) | **Brace markers in resolved text**: `{CODE}` (Dicier) and `{asset:name}` (uploaded art) inside any `text:`, parsed at EVAL time AFTER interpolation; lines become **runs** with compiler-computed x-offsets; every icon occupies a square **1-em slot** (`size` × `size`); `{{` escapes a literal `{` | Braces because ◆30's "`[brackets]` always mean data refs" stays absolute — no new bracket grammar, no lexer change. Post-resolution parsing because a sheet CELL containing a marker must work (data-driven icons come free, the product's whole point). Runs because the compiler is the layout authority (◆37) and it cannot know Dicier ligature advances or an SVG's aspect ratio — absolute run placement plus a fixed slot makes the compiler's width assumption TRUE BY CONSTRUCTION for both renderers, instead of approximately right in one. True aspect ratios and non-default Dicier faces are explicitly deferred (§8) |
| ◆45 | Cross-device sync (§7.6) | **Object storage + one password, no database and no accounts**: Cloudflare R2 holds a per-project folder (small JSON + one object per asset), a single admin password mints an HMAC-signed cookie, asset bytes move browser↔R2 via short-lived presigned URLs, and a `revision` guard rejects stale writes | The project already serialises to one small JSON payload with discrete asset files (§7.1/§7.4), so a database would add a schema to maintain for data that is fundamentally two blobs. R2 over Vercel Blob for 10 GB and zero egress; over Supabase because free projects pause after 7 idle days, which is exactly wrong for bursty personal use. Presigning is not an optimisation but a requirement — Vercel caps request bodies at ~4.5 MB, below one asset. Local-first is preserved: the cloud mirrors localStorage/IndexedDB, so signed-out and offline sessions are unchanged |
| ◆46 | Bindings, structural conditionals, composition (§3.1–§3.8) | Contextual `let`, `If:`/`Else:`, and no-argument `TemplateName:` calls; immutable lexical bindings, lazy selected branches, noncapturing calls, cycle errors, and composition-only caps | The three forms replace off-card conditional hacks while preserving the flat RenderModel and existing scripts; contextual recognition keeps `column let: Text`, `Template: If`, and `Front: If` legal |
| ◆47 | Additive color styling (§3.3.2–§3.3.5) | Optional Image `color:` is an RGB **multiply** tint (white/default = identity); resolved text gains nested `{color:red}…{/color}` scopes for text, Dicier markers, and inline asset markers | Multiplication recolors white artwork while preserving black detail and source alpha, and makes white an exact compatibility default. Scoped tags extend ◆44's post-interpolation marker pass without changing wrap widths: color is paint-only run data, not content geometry. Malformed or unbalanced scopes remain raw text with no diagnostic, preserving the marker grammar's gentle failure posture |
| ◆48 | Printable data export and virtual columns (§3.2, §7.7) | `virtual column name: Type = expression` adds a typed, read-only, export-only value to a Sheet; **Export Data** emits one RFC 4180 CSV row per generated card instance, with provenance, loop values, physical cells, and virtual values | Generated instances—not source rows—are the print manifest: loops and `count:` can multiply one row, while `[card]` can make each copy distinct. Keeping virtuals out of the grid preserves code-owned formulas and avoids a second stored value that can drift from its expression |
| ◆49 | Parameterized composition and generated identity (§3.2–§3.7) | Direct, typed `param name: Type` declarations on Templates; explicit indented arguments on `Front:`/`Back:` and Template calls; new `[copy]`, `[deck]`, `[deck_card]`, and `[project_card]` built-ins while `[card]` remains deck-relative | Parameters let one layout accept semantic variants without ambient caller capture: arguments evaluate in caller scope and forwarding stays explicit. Separate row/copy/deck/project identities describe the actual generation hierarchy without changing `[card]` under existing scripts; semantic IDs remain stable while project ordinals are deliberately positional |
| ◆50 | Numeric interpolation padding (§3.5) | Quoted strings accept Number-only `[name:0N]`, where canonical decimal width `N` is 1..64; zero padding is sign-aware and sets a total **minimum** width without rounding or truncation | Fixed-width generated IDs are common enough to justify one small format, while a general formatting language would add grammar and policy far beyond the requirement. Keeping the form inside string interpolation preserves ordinary `[name]` and every non-string expression unchanged |
| ◆51 | Preview row provenance and print pairing (§4.2, §6.1) | Single-card and grid views share an optional red one-based source-row overlay outside card SVGs; PDF export has an off-by-default native page label where matching fronts/backs share a project-wide logical sheet number | Row provenance makes generated cards traceable without contaminating artwork/export, while paired sheet numbers solve physical front/back sorting in both duplex and separate page orders |
| ◆52 | Resolved-text aliases (§3.3.2, §7.5) | `{alias:name}` in resolved `Text`/`TextBox` content expands a top-level Text-valued `let name:` **exactly one level**, before existing color/icon/asset markers parse; unknown, non-Text, and non-global targets remain raw with non-fatal D011 | Shared marker-rich fragments need reuse even when the alias marker comes from sheet data. One level avoids a second recursive language, alias cycles, and surprising local-scope capture; raw fallback plus a data-time notice preserves the gentle marker behavior of ◆44/◆47 without hiding a misspelling |

---

## 3. The language

Working name: **Goblin script**, file extension `.goblin` (cosmetic, revisit freely).

### 3.1 Lexical structure

- **Indentation-significant** (like Python/YAML). One block = deeper indent. Spaces or
  tabs, consistent within a file; the lexer emits INDENT/DEDENT tokens.
- **Continuation rule (◆23†, ◆46, ◆48):** only a **property line** (a lowercase key + `:`),
  `let name:`, or a `virtual column name: Type =` initializer may
  continue: its expression extends across subsequent lines while they are indented
  deeper than the key. Block headers (`Enum:`, `Sheet:`, `Template:`, `Card:`,
  `Rectangle:`, `Text:`, `TextBox:`, `Icon:`, `Image:`, `Qr:`, `Repeat:`, `Front:`,
  `Back:`, `If:`, `Else:`, and Template-call headers) never continue — their
  deeper-indented lines are children. A call argument itself is an ordinary property-like
  expression and may continue. Consequently `Repeat:` and `If:` expressions
  must fit on one line. Continuation is a parser-level
  rule; the lexer only reports indent levels.
- **Comments (◆22):** `#` to end of line.
- **Identifiers:** `[A-Za-z][A-Za-z0-9_]*` — used for all declared names (⚑11).
- **Literals:** numbers (`3`, `1.5`), strings (`"Cost: [cost]"` — see interpolation
  §3.5), colors (`#RRGGBB` anywhere; CSS names only in Color-typed positions, ◆21†).
  **String escapes (M3 2026-08-10, §7.2):** `\n` is a newline and `\\` a literal
  backslash — the lexer's only escapes besides `[[`; any other `\`-sequence is E001
  with a hint listing the valid ones. Hard breaks are honored by `TextBox` and
  render as spaces in single-line `Text` (§3.3).
- **Reserved words (◆30†):** block openers (`Enum Sheet Template Card Rectangle Text
  TextBox Icon Image Qr Repeat Front Back` — `Image` added M2 2026-08-09, `TextBox`
  added M3 2026-08-10, `Qr` added M3 2026-08-11), declaration words (`case column`),
  and expression structure (`if then else and or not as`). Everything else — including `count`,
  `size`, `sheet`, `loop`, `x`, `color`, `pivot`, `left`, `right`, `full`, `half`,
  `middle`, `auto`, size presets, and CSS color names — is an ordinary identifier
  whose meaning comes from position and expected type. `[brackets]` always denote a
  data reference, so a column named `full` is `[full]`, never confused with the
  keyword `full` in a geometry position. Reserved words cannot be used as
  **declared names** (declaration names, column names, enum cases, loop/repeat
  variables) — E001; block-opener words remain usable in value positions (that is
  how `column name: Text` names the `Text` type).
  `let`, `param`, `If`, `Else`, and `virtual` are deliberately **contextual**, not additions
  to this reserved list: only `let <name>:` at program/template-node indentation,
  `param <name>: <Type>` directly inside a Template,
  `If:`/`Else:` in template-node position, and `virtual column` inside a Sheet are
  structural. Thus `column let: Text`, `column virtual: Text`, `Template: If`,
  `Template: Else`, and `Front: If` retain their old meanings. A single `=` is only
  the separator in a virtual-column declaration; equality remains `==`.

### 3.2 Top-level declarations

A program is a sequence of the four named declaration kinds plus program-scope
`let` bindings, in any order (forward references allowed — the checker resolves
after parsing):

```goblin
Enum: Suit
  case Rock
  case Paper
  case Scissors

Sheet: Monsters
  column name: Text
  column cost: Number
  column health: Number
  column count: Number
  virtual column card_code: Text = "[card]|[name]"

Template: MonsterFront
  ...elements...

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

- **Enum** — named set of cases. Case names unique within the enum.
- **Sheet** — declares the schema of one spreadsheet tab (⚑3). Column types: `Text`,
  `Number`, or any declared enum name. The grid window renders exactly these columns;
  enum columns become dropdowns; rows are data and live outside the code (⚑12).
  A Sheet may declare **zero columns** (⚑13†): its tab shows numbered rows with
  add/remove only — the idiom for loop-only decks that just need a row count.
  A Sheet may also declare `virtual column <name>: <Type> = <expression>` (◆48).
  Virtual columns are type-checked once per Card bound to the Sheet and evaluate in
  that Card's row/loop/generated-identity context. They are absent from the grid and
  project row payload, cannot be edited or referenced as sheet bindings, and exist
  only in Export Data. Their names must be unique across the Sheet's physical and
  virtual columns. `Text`, `Number`, and enum types use the ordinary expression type
  and Text-coercion rules. The initializer follows the same indented continuation
  rule as a property or `let` initializer.
- **Template** — a named list of drawable nodes. It may declare any number of required,
  immutable `param <name>: <Type>` values directly in its body, in any position; they
  are hoisted across the whole Template activation. Types are `Text`, `Number`, `Bool`,
  `Color`, or an enum name. Parameters are not legal inside `If`/`Else`/`Repeat`.
- **Card** — a card *type*: binds a sheet (⚑13), physical size, unit grid, optional
  loops, copy count, and front/back templates. `Front:`/`Back:` take a template name
  inline; deeper-indented `name: expression` lines supply that Template's parameters.
  `Back:` optional → plain white (◆16). Missing `sheet:`, `size:`, or
  `Front:`, or an unknown size preset, is E008.
- **`let name: expression`** — an immutable, type-inferred value. Program lets may
  read other globals, the current Card's columns/loops, and generation built-ins.
  Initializers are lazy and checked only for Cards that reach them from `count:` or a
  face; forward references work, same-scope duplicates are E005, and dependency
  cycles are E009. Without an expected type, write self-typing values such as
  `#cc0000` and qualified `Suit.Rock`.

### 3.3 Template nodes, conditionals, composition, and elements

A Template body, an `If`/`Else` branch, or a `Repeat` body may contain drawable
elements, local `let` bindings, nested `If`/`Repeat`, and Template calls. Only the
direct Template body may additionally contain `param` declarations.

- **Structural conditionals:** `If: <Bool expression>` has an optional `Else:` as
  its next nonblank sibling at the same indentation. Both branches are parsed and
  statically checked in their own lexical scopes; only the selected branch evaluates,
  so the other emits no shapes or data diagnostics and does not read `[card]`.
  Conditions are single-line; else-if is a nested `If:` inside `Else:`.
- **Template calls:** any otherwise-unclaimed `<identifier>:` in template-node
  position calls that Template. Deeper-indented `name: expression` lines are explicit
  arguments; they evaluate in caller scope, are checked against the declared parameter
  type, and are lazy/cached once per call activation. Forwarding therefore requires
  `callee_name: [caller_name]`. Calls flatten at that source position, preserving
  z-order. A callee does **not** otherwise capture caller local lets, parameters, or
  caller `Repeat` variables; it sees its own parameters/locals, program globals,
  Card loops, columns, and generation built-ins. Missing, duplicate, extra, or
  wrongly typed arguments are compile errors. Templates named `If` or `Else` remain
  valid direct `Front:`/`Back:` targets, but cannot use nested-call shorthand.
- **Safety:** direct/indirect let and Template cycles are E009 with the dependency
  path. Per Card face, checking and evaluation independently allow at most **64 active
  Template calls** and **10,000 template-node visits reached through call edges**;
  E010/D010 occurs at the crossing call. These are composition-only budgets: the
  directly selected face and call-free descendants are not charged, and `Repeat`'s
  separate 500-expansion limit is unchanged.

Elements render in declaration order; later elements draw on top (◆15). All elements
accept an optional quoted display label (`Rectangle: "Banner"`) — purely descriptive,
never referenced (⚑11). This is an index; each element's full semantics are in its
own subsection below.

| Element | Properties | Summary |
|---|---|---|
| `Rectangle` | `x y width height color pivot rotate` | A filled box — §3.3.1. |
| `Text` | `x y size color text pivot font rotate` | One line of text — §3.3.2. |
| `TextBox` | `x y width height text size color align line_height overflow pivot font rotate` | Wrapped, multi-line text in a box — §3.3.3. |
| `Icon` | `x y size color code pivot style rotate` | A Dicier glyph, one of ten style faces — §3.3.4. |
| `Image` | `x y width height src fit color pivot rotate` | Raster art from a URL or uploaded asset, optionally color-multiplied — §3.3.5. |
| `Qr` | `x y size data color background level pivot rotate` | A scannable QR code — §3.3.6. |
| `Repeat` | `Repeat: <Number expr> as <var>` (single line) | Draws its children N times — §3.3.7. |

#### 3.3.1 Rectangle

`x y width height color` required; `pivot` optional (default `top_left`,
nine-point — §3.4, M3 2026-08-10). A filled box.

#### 3.3.2 Text

`x y size text` required; `color` (default `black`) and `pivot` (default
`top_left`) optional. Single line, always (◆24) — `size` is the em height in units.
`pivot` is nine-point (§3.4); the legacy `left | middle | right` values alias the
top row. Newline characters in the resolved text render as spaces (M3 2026-08-10)
— hard breaks belong to `TextBox`.

`font:` (M3 2026-08-13, ◆41) is an optional bare identifier — `geist` (default,
unchanged), `garamond`, `garamond_bold`, `garamond_italic`, `garamond_bold_italic`,
`courier`, `courier_bold`, `courier_italic`, `courier_bold_italic` — resolved by
expected type like Icon `style:` (§3.3.4); an unknown value or a non-identifier
expression is E008 naming the vocabulary. A closed, repo-bundled set (◆41): the two
families ship as static TTFs under `src/app/fonts/`, each face's advance widths and
ascent generated into `font-metrics.ts` by `scripts/generate-font-metrics.mjs`.
`TextBox` (§3.3.3) shares this same property and vocabulary.

**Inline icons (M4, 2026-08-16 — ◆44, §7.5):** the resolved text may carry
brace markers — `{HEARTS}` draws the Dicier glyph, `{asset:skull}` draws an
uploaded asset (§7.4 scheme) — inline with the text. Markers are parsed
AFTER interpolation, so a marker arriving from a sheet cell works
identically to a literal. `{{` is a literal `{`; a lone `}` is literal; a
`{...}` that parses as neither form renders as its raw text. Each icon
occupies a square **1-em slot** (`size` wide × `size` tall, advancing
exactly `size`): Dicier glyphs draw at the text's `color` in the default
`flat_dark` face, asset art draws letterboxed in the slot with its own
colors. Diagnostics reuse the icon/asset codes: unknown LITERAL Dicier
marker → W004, unknown literal asset name → W005, computed unknown code →
D005 at data time (renders as the raw marker text — its own indicator).

**Resolved-text aliases (◆52):** after the `text:` expression resolves (including
sheet-cell content), `{alias:name}` looks up only the program-scope `let name:` for
the current Card. If that binding evaluates to Text, the marker is replaced with
its resolved value. Alias expansion is one pass only: an alias marker introduced
by the replacement remains raw. The existing scoped-color, Dicier, and asset-marker
pass then parses the expanded string, so a reusable let may contain any of those
markers. A missing name, local let/parameter, or non-Text global emits non-fatal
D011, leaves the original `{alias:name}` visible, and continues rendering. Top-level
Text lets are externally addressable even when
no source literal names them (a marker may arrive from a cell), so they and their
global-let dependencies are exempt from W002 unused-binding warnings.

**Scoped color (◆47):** `{color:red}attack{/color}` changes the paint color of
only the enclosed resolved text. A six-digit hex color works too; scopes nest,
and the closing tag restores the enclosing color (ultimately the element's
`color:`). Dicier markers use the scoped color as their fill; inline asset
markers use it as the same RGB multiply tint as Image. Tags are parsed after
interpolation, occupy no width, and never create a wrap boundary. A malformed,
unknown-color, unmatched, or unclosed scope is ordinary raw text with no
diagnostic, consistent with the existing marker grammar.

#### 3.3.3 TextBox

(M3, agreed 2026-08-10 — §7.2) Wrapped, multi-line text in a box; ◆24 stays intact
for `Text`. `x y width height text size` required; `color` (default `black`),
`align: left | middle | right` (default `left`), `line_height` (positive number
LITERAL, default 1.3), `overflow: clip | shrink` (default `clip`), and `font:`
(M3 2026-08-13, ◆41 — the same nine-value vocabulary as Text, §3.3.2, default
`geist`) are optional.

`align` lays lines within the box's width; the nine-point `pivot:` of §3.4 moves
the box itself, and `x: middle` stays Text/Icon-only (E007 on `TextBox`).
`line_height` means × `size` — baseline advance in units is `line_height × size`.

**The compiler is the wrapping authority**: the evaluator wraps deterministically
against a generated advance-widths table **of the chosen `font:`** (`geist-metrics.ts`
for the default, `font-metrics.ts` for the other eight, ◆41 — both the
dicier-codes pattern) with a 2% measurement safety margin, and the model carries
the resolved `lines` — preview and PDF agree by construction. A box's `font:`
changes which table it wraps against — Courier text wraps against Courier's own
advances, not Geist's, so line breaks stay correct per font.

Wrap semantics: split on hard breaks (real `\n` in the resolved text — from the
§3.1 escapes or from cell data) first; within a segment, greedy word-wrap on
spaces (runs of spaces collapse at break points only; interior spacing is
preserved); a single word wider than the box breaks mid-word rather than overflow
horizontally.

Vertical fit is `lines × line_height × size ≤ height`: `clip` keeps the last
fully-fitting line and marks the box clipped; `shrink` retries at 5%-of-`size`
steps down to a 60% floor, then clips at the floor — the shape carries the FINAL
size. Clipped/shrunk boxes get a subtle per-card preview badge, never an error
placeholder (⚑8).

**Inline icons (◆44, §7.5):** `TextBox` honors the same `{...}` markers as
`Text` (§3.3.2); a marker is one **unbreakable token** that wraps like a
word, occupying its square 1-em slot within the line.
Nested `{color:…}…{/color}` scopes work identically and do not alter line
measurement, wrapping, alignment, line height, or overflow decisions.

#### 3.3.4 Icon

`x y size code` required; `color` (default `black`), `pivot` (default
`top_left`), and `style` optional. A Dicier glyph; `code` is a Text expression —
literal codes are checked against the curated list, and an unknown literal is a
**W004 warning**, since the list is non-exhaustive (⚑10†).

`style:` (M2, agreed 2026-08-09) is an optional bare identifier — `flat_dark`
(default), `flat_light`, `flat_heavy`, `block_dark`, `block_light`, `block_heavy`,
`round_dark`, `round_light`, `round_heavy`, `pixel` — resolved by expected type
like `pivot:`; an unknown value is E008. All ten faces are declared as
`@font-face`; browsers fetch only the ones actually used.

#### 3.3.5 Image

(M2, agreed 2026-08-09) `x y width height src` required; `fit`, `color`, and `pivot`
optional. Raster art from a URL. `src:` is a Text expression (URLs may come from
a sheet column); `fit:` is an optional bare identifier — `contain` (default) |
`cover` | `stretch` — realized via SVG `preserveAspectRatio`.

`color:` (◆47) is an optional Color expression whose default is `white`. It
multiplies the loaded image's RGB channels: white is an exact identity, a white
source pixel becomes the chosen color, black remains black, and intermediate
source tones retain their shading. The source pixel's alpha is preserved; this
does not add alpha-bearing Color syntax (`#RRGGBB` and the existing CSS names
remain the Color surface). Omission keeps the legacy Image model/render/hash
path free of a tint field; loading and failed placeholders are never tinted.

**`auto` dimension (2026-08-10):** exactly one of `width:`/`height:` may be the
bare keyword `auto` — that dimension derives from the other × the art's
intrinsic aspect ratio (`width: full` + `height: auto` is the canonical "banner
art" idiom). Both `auto` = E008. `auto` is resolved by the renderer/exporter at
load time (intrinsic size is load-time knowledge — the pure model carries the
keyword); pre-load placeholders use a square box, and `fit:` is inert alongside
`auto` (the box matches the ratio by construction — allowed, documented, no
diagnostic).

Loading → subtle placeholder box; failed load → placeholder with warning styling
(renderer-level state, **not** a D-code — the model stays pure, per-card
isolation preserved). At PDF export, images load with `crossorigin=anonymous`; a
load failure or canvas taint exports that image as a marked placeholder box and
the modal warns "N images could not be embedded" before export — the deck always
exports (⚑8 philosophy).

#### 3.3.6 Qr

(M3, agreed 2026-08-10, shipped 2026-08-11 — §7.3) `x y size data` required —
`size` is the square box's side in units, `data:` a Text expression (usual §3.5
coercions: `[column]`, interpolation, conditionals). Optional `color` (default
`black`), `background` (default `white`), `level:` — error-correction, bare
identifier `l | m | q | h` (default `m`) — resolved by expected type like
`fit:`/`style:`; an unknown value is E008.

**Encoded at EVAL time** (pure, deterministic, the wrap.ts precedent — via
`qrcode-generator`, the second sanctioned runtime dependency): the shape carries
the resolved module matrix (row-major `"1"`/`"0"`, quiet zone NOT included),
never the source data, so the renderer only draws one vector `<path>`. The
spec's 4-module quiet zone is drawn INSIDE the declared box (so adjacent art can
never break scanning) — total grid = `moduleCount + 8`, module unit = `size /
grid`.

`x: middle` is E007 (no pivot sugar — same as Rectangle/Image); `x/y/size`
geometry keywords behave as on `Icon`'s `size` (full/half legal, X-axis). `data:`
too long for the level's capacity (even at QR version 40) → **D009**, a
placeholder card (§3.8) — empty-string `data:` encodes normally, no special
case.

#### 3.3.7 Repeat

`Repeat: <Number expr> as <var>` (single line, ◆23†). Children emitted N times;
`[var]` is the 0-based index (◆18), usable in any child expression; nests; cap
500/card (◆27).

**The showcase** — one number in the sheet becomes a row of hearts (⚑6, ⚑9, ⚑10):

```goblin
Repeat: [health] as i
  Icon:
    x: 1.5 + [i] * 2
    y: 25
    size: 1.8
    color: red
    code: "HEARTS"
```

### 3.4 Geometry (⚑7†)

- `size:` picks a physical preset: `poker` 63.5×88.9 mm, `bridge` 57.15×88.9,
  `american` 56×87, `tarot` 70×120, `square` 70×70, `mini` 44×63.5,
  `domino` 44.45×88.9. **`american` + `domino` (M3, added 2026-08-11):** the two
  stock sizes the sleeve market treats as standard that the original five missed.
  Both are named in inches in the wild (2.2″×3.43″ and 1.75″×3.5″), but the
  preset table stays **millimetre-authoritative**: `domino` converts exactly
  (1.75″ = 44.45, 3.5″ = 88.9), while `american` takes the round 56×87 the
  industry actually cuts and sleeves to rather than the 55.88×87.12 a literal
  conversion gives — a 0.12 mm difference no printer resolves, against a number
  no one would recognize. Every preset must stay exact in hundredths of a
  millimetre for the same reason custom sizes must (below). **Custom sizes (M2, agreed
  2026-08-09):** a Card may *instead* declare `width_mm:` + `height_mm:` (positive
  number literals, both required together; combining them with `size:`, or giving
  only one, is E008). Values must be **exact in hundredths of a millimetre with a
  0.01 mm floor** (E008 otherwise) — the unit math works in integer mm-hundredths,
  and this constraint is what keeps `y_units: auto` exactly square and the model
  free of non-finite numbers for every accepted size. Chosen over dedicated
  dimension syntax (`40mm x 40mm`)
  because two ordinary Number properties need zero new grammar — parser, pins,
  autocomplete, and docs all extend mechanically.
- `x_units: N` divides the card width into N units → **1 unit = width/N mm**, exact
  for PDF later. `y_units: auto` = the exact fractional value `N × height/width` —
  **units are always square; the vertical unit count may be fractional** (poker@20
  → 28 exactly; bridge@20 → 31.111…; tarot@20 → 34.285…). `full` on the y axis is
  that fractional value. Explicit integer `y_units` is allowed but stretches units
  (non-square, warning W003).
- All coordinates/sizes are unit-valued expressions. Keywords: `full` = the axis's
  unit count, `half` = half of it, `middle` (**x-position of Text/Icon only**, ◆ —
  `y: middle` is E007) = horizontally centered (sugar for `x: half` +
  `pivot: middle`).
- **Nine-point pivots (M3, 2026-08-10; renamed from `anchor:` M3 2026-08-13 —
  ◆36†):** every drawable element accepts `pivot:`, naming which point OF THE
  ELEMENT ITSELF `x`/`y` refer to — the element's own handle, the way a
  sprite's *pivot* names a point on the sprite, NOT the way a Unity/Figma
  *anchor* names a point on the PARENT a child aligns to (that is a distinct,
  unbuilt, card-relative-positioning feature — ◆36† — which is why `anchor:`
  was freed up rather than kept as an alias). **To center a shape on the
  card:** pair the halfway coordinate with the halfway pivot —
  `x: half, y: half, pivot: center_center` — so the card's own midpoint (from
  `half`) and the shape's own center (from `center_center`) are the same
  point. (The differently-useful `x: 0, y: 0, pivot: center_center` puts the
  shape's center on the card's top-left CORNER — correct, but a common
  surprise if "pivot" is misread as "anchor to this corner of the card".)
  Canonical values: `top_left` (default), `top_center`, `top_right`,
  `center_left`, `center_center`, `center_right`, `bottom_left`,
  `bottom_center`, `bottom_right` — **either word order** is accepted
  (`center_bottom` ≡ `bottom_center`), `center` alone ≡ `center_center`, and
  the legacy Text/Icon values `left | middle | right` remain as aliases for
  the top row (existing cards unchanged). Underscores, not hyphens — `-` is
  the minus operator. Unknown value → E008 naming the vocabulary.
  Semantics: box elements (Rectangle, Image, TextBox, Qr) offset by
  `(width·fx, height·fy)`, fx/fy ∈ {0, ½, 1}; Text/Icon pivot horizontally
  via SVG `text-anchor` on the intrinsic line and vertically by the em box
  (top = today's behavior; `y` names the pivoted edge/center of the em).
  An Image with an `auto` dimension applies its offset at render time once
  the natural size is known (same load-time rule as `auto` itself).
  `x: middle` sugar is unchanged: it forces the horizontal component to
  center; the vertical component still comes from `pivot:`. (Renderer keeps
  the per-font ascent realization — `dy = ascent/em × size`, not
  `dominant-baseline`; §4.2.)
- **Rotation (M4, 2026-08-16 — ◆43):** every drawable element accepts an
  optional `rotate:` — a Number expression in **degrees, clockwise**,
  default 0 — rotating the element **around its `pivot:` point**, i.e.
  around the exact card-space point `x`/`y` place. The pivot is the shape's
  handle, and rotation turns the shape on that handle: `pivot:
  center_center` + `rotate: 45` spins it in place; the default `top_left`
  swings it around its top-left corner. Values outside 0–360 wrap the
  obvious way (`-90` ≡ `270`; the renderer passes the number through — SVG
  rotation is periodic). Rotation is **paint-time only**: it never changes
  wrap (a rotated TextBox wraps against its unrotated width), generation,
  `full`/`half` resolution, or PDF card placement — the rasterizer
  serializes the same markup, so the PDF inherits it. Non-numeric value →
  E003; non-finite at data time → D008, like any other numeric property.

### 3.5 Expressions and types (⚑6)

Precedence, low→high: `if/then/else` chains → `or` → `and` → `not` →
comparisons (`== != < <= > >=`) → `+ -` → `* / %` → unary `-` → primary
(literal, `[ref]`, enum case, keyword, parenthesized). Comparisons are
**non-associative**: `a == b == c` is E001 with a hint to use `and` or
parentheses — chained comparisons read as math but don't mean it.
Equality (`==`/`!=`) requires both sides to share a type (Number, Text, or the
same Enum); **ordering comparisons (`< <= > >=`) are Number-only** — there is no
useful total order on Text or enum cases a game designer should rely on.

- **Types:** `Number`, `Text`, `Bool`, `Color`, each `Enum`, plus contextual geometry
  keywords. Checked statically wherever the schema allows (⚑3): arithmetic needs
  Numbers, comparisons need matching types, `if` conditions need Bool, both branches
  of an `if` must agree, `else` is mandatory (an expression must produce a value).
- **Coercion (◆†):** in Text-typed positions (`text:`, `code:`, interpolation),
  Number and Enum values coerce to Text (trailing zeros trimmed; enum prints its
  case name). No other implicit coercions; Bool/Color in a Text position is E003.
  This keeps the README's flagship `text: [cost]` legal.
- **Bare names resolve by expected type (◆14†, ◆21†, ◆30†):** in a position whose
  expected type is known — a Color property, a comparison against an enum-typed ref,
  an enum-typed `if` branch — a bare identifier resolves against that type's
  vocabulary (CSS color names, that enum's cases, geometry keywords). `Enum.Case`
  qualification always works. Where no expected type is derivable, a bare enum case
  resolves only if globally unique across enums; otherwise E004 tells you to qualify.
- **String interpolation:** `[ref]` inside a string literal substitutes the value
  (`"Cost: [cost]"`), with the Text coercions above. `[[` escapes a literal `[`
  (◆†); a `[` not opening a valid plain or formatted interpolation is E001 with a
  hint about `[[`.
  A Number reference may instead use `[ref:0N]` (◆50), where `N` is a canonical
  decimal width from 1 through 64 (`01` … `064`, no leading zero in `N`). The result
  is left-padded with zeroes to that minimum **total** width; a minus sign counts
  toward the width and padding follows it (`-7` at width 4 → `-007`). Values already
  at least that wide are unchanged, including their fractional text: the format never
  truncates or rounds. It is legal only inside a quoted string and only for Number;
  Enum/Text/Bool/Color references are E003. Plain `[ref]` behavior is unchanged.

### 3.6 Binding and scoping (⚑5)

`[name]` resolves, innermost first:

1. local `let` and enclosing `Repeat` bindings, nearest lexical scope first,
2. the current Template's parameters,
3. the Card's `loop` variables,
4. the bound sheet's columns,
5. program-scope `let` bindings,
6. the **built-in generation bindings** (◆42, ◆49):
   - `[row]` — the row's **1-based position in its sheet**, i.e. exactly the
     number shown (and edited) in the grid's row gutter. Every card generated
     from one row shares it.
   - `[card]` — the card's **1-based position within its generated deck**,
     counting loop combinations and `count:` copies. With 2 rows × 3 suits,
     `[row]` runs 1,1,1,2,2,2 while `[card]` runs 1…6.
   - `[copy]` — the **1-based `count:` copy** within the current row × loop-case
     combination; it resets to 1 for the next combination.
   - `[deck]` — Text containing the current **Card declaration name**.
   - `[deck_card]` — a clearer alias for `[card]`, with exactly the same Number.
   - `[project_card]` — the card's **1-based position across all emitted Card
     declarations** in project generation order.

   Except for Text-valued `[deck]`, these are Numbers. All are **derived, never
   stored**: nothing enters the sheet payload, autosave slot, or project file.
   They resolve LAST, so a sheet that declares a same-named column shadows the
   built-in (with the usual shadowing warning) — an
   existing project's COLUMN can never be silently reinterpreted. (The one
   narrow exception, not a column: a template that put an unresolvable
   `row`/`card` name in a position only Number ever satisfies — e.g.
   `color: [row]` — used to poison silently to Unknown with no sheet in
   scope; it now resolves and can genuinely E003, which is more correct, not
   less.) Note the deliberate 1-based/0-based split with `Repeat`'s index
   (◆18): the repeat index is for arithmetic, these are for humans and for
   serialising a deck. `[row]` counts **pristine rows too** (◆29) — it is the
   sheet position, exactly the grid gutter's number, not a count of generated
   rows; a card's `[row]` is always the number its designer would point at in
   the grid.

   A face that reads `[card]`, `[deck_card]`, `[copy]`, or `[project_card]` can't
   share one evaluation across its `count:`
   copies the way every other face still does (§3.7) — each copy resolves on
   its own and earns its own `contentHash` (two copies differing only in a
   printed `[card]` number ARE different cards). Front and Back are tracked
   INDEPENDENTLY: a Back that never reads `[card]` keeps sharing one
   evaluation across every copy even when Front diverges on all of them. A
   data error on any one of those copies still fails the WHOLE group
   together, though — ⚑8's per-card isolation stops at the row × loop-case
   boundary `count:` multiplies, same as every other data error here, not at
   the individual copy — but the shared placeholder message names WHICH copy
   actually failed ("… (copy 3 of 3)"), since the group's other inputs would
   otherwise read as if copy 1 had caused it.

   `count:` and other Card-context roots may read every built-in. During
   `count:`, the context is the prospective first copy of that row × loop
   combination: `[copy]` is 1, `[card]`/`[deck_card]` are the next deck
   position, and `[project_card]` is the next project position. Those positions are fixed
   BEFORE its own `count:` runs,
   so `count: [card]` is legal and self-referential — four rows request
   counts 1, 2, 4, 8 (each group's size equals the position it started at),
   still bounded by the same 2,000-instance cap as any other `count:` (◆27†).
   A legal `count: 0` emits nothing and consumes neither a deck nor project position.

Shadowing produces a warning. Because templates are checked **per using Card**, every
`[ref]` in a template is statically known-good or squiggled — the README's "error
prevention" promise, delivered by ⚑3 + ⚑5.

Bindings in one lexical block are hoisted and visible throughout that block and its
descendants. Direct Template parameters are likewise hoisted, immutable, and cached
once per activation; their arguments evaluate in the caller's scope. Local lets are cached once per activation of their Template call,
selected branch, or `Repeat` iteration; globals are cached once per evaluation root
(`count:`, each face, and each `[card]`-divergent copy). Values are lazy: unused lets
read no cells and an untaken branch evaluates nothing. References in either branch
still count for static use checks. A called Template starts its own lexical frame and
does not capture caller parameters, locals, or caller Repeat indices; only declared,
explicitly passed arguments cross that boundary.

Same-scope duplicate lets are E005. A narrower local let, Repeat variable, or Card
loop hiding an outer binding is W001; when an existing sheet column hides a new global,
the warning is anchored once at the global declaration so untouched sheet code does
not gain a new warning range. W002 applies to lets with no syntactic reference in
their permitted scope; global use and Template use are followed transitively through
calls. ◆52 adds one data-addressable exception: top-level globals inferred as Text
for a Card, plus their transitive global-let dependencies, are alias exports and do
not receive W002 even when source code contains no marker — `{alias:name}` may arrive
only from that Card's sheet cells.

### 3.7 Card generation (⚑1)

For each `Card` block, in declaration order:

```
for each edited row of the bound sheet (grid order; pristine rows excluded, ◆29)
  for each combination of loop cases (loops nested in declaration order, cases in enum order)
    n = evaluate count (default 1; must be integer ≥ 0 — else D006, one placeholder card)
    emit n card instances with context {row, loop bindings, copy, deck, deck_card/card, project_card}
```

The `n` instances are identical in content UNLESS a face reads a per-instance built-in
(`[card]`, `[deck_card]`, `[copy]`, or `[project_card]`) — a printed run number is
resolved data like any other, so a face that reads it resolves independently per
instance instead of sharing one evaluation. `[deck]` alone is invariant within a Card
declaration and does not force per-copy evaluation.

Generation for a Card stops at **2,000 instances** (◆27†) with a D007 entry — a bad
`count` cell must not freeze the tab any more than a bad `Repeat` may.

Front and back element trees evaluate in that context; `Repeat` expands; the output is
a fully resolved **RenderModel** (concrete numbers/strings/colors only — the renderer
never sees an expression). Each instance also carries an immutable export-data record:
the bound Sheet's declared physical cell text plus its virtual-column results evaluated
for that exact instance. This record is metadata, not rendered content, and therefore
does not affect `contentHash`.

### 3.8 Diagnostics catalog (⚑8)

**Compile-time** (Monaco squiggles + problems strip; preview keeps last good render,
grid keeps last good schema — §4.2):

| Code | Meaning |
|---|---|
| E001 | syntax error (incl. malformed interpolation) |
| E002 | unknown reference (sheet, template, enum, column, variable) |
| E003 | type mismatch (incl. non-coercible interpolation) |
| E004 | bare enum case unresolvable (no expected type, not globally unique) |
| E005 | duplicate declaration (or duplicate column/case) |
| E007 | keyword in invalid position (e.g. `middle` as a width or as `y`) |
| E008 | missing or invalid required property (`sheet:`, `size:`, `Front:`, unknown preset) † |
| E009 | cyclic `let` dependency or Template-call dependency (full path, one primary error per cycle) |
| E010 | Template composition exceeds 64 active calls or 10,000 call-reached node visits per Card face |
| W001 | shadowed binding |
| W002 | unused declaration (except top-level Text alias exports and their global-let dependencies, ◆52) |
| W003 | explicit `y_units` makes units non-square (suppressed when the value exactly equals the square `auto` value) |
| W004 | unknown icon code literal (Icon `code:` or an inline `{marker}`, ◆44) — may still be a valid glyph; the curated list is non-exhaustive † |
| W005 | unknown asset — a literal `asset:` Image `src:` or inline `{asset:name}` marker (◆44) whose name isn't in the current Assets-drawer library (§7.4); never an error, since the asset may be about to be uploaded |

*(E006 existed in the original revision as "unknown icon code (error)"; downgraded to
W004 in Revision A because the code list is provably incomplete.)*

**Data-time** (⚑8, ◆19). D001–D003 flag the offending cell red **and** render the
affected card(s) as error placeholders; D004–D011 arise from computed values with no
single source cell (◆†), so they appear in the card/problems surfaces. D005 and D011
are diagnostic-only and keep the affected card rendered; the others use placeholders
or truncation as stated:

| Code | Meaning |
|---|---|
| D001 | cell value not a case of the column's enum |
| D002 | cell not numeric in a Number column |
| D003 | empty Number/Enum cell referenced by a template (edited rows only, ◆29) |
| D004 | repeat count negative/non-integer, or cumulative Repeat expansion budget > 500 → affected card placeholder (every nested iteration counts; never partial truncation) |
| D005 | computed icon code not in the known list (Icon `code:` or an inline marker, ◆44) — the icon/marker still renders (the failed ligature or raw marker text is its own visible indicator); diagnostic only, not a placeholder |
| D006 | `count:` non-integer, negative, or unevaluable → one placeholder per row×case combination † |
| D007 | per-Card instance cap (2,000) exceeded — generation truncated † |
| D008 | non-finite numeric result during evaluation (division by zero) → placeholder card |
| D009 | QR data is too long for one code (exceeds the `level:`'s capacity, even at the largest QR version) → placeholder card (§7.3) |
| D010 | Template composition exceeds 64 active calls or 10,000 call-reached node visits while evaluating one face/copy → placeholder card |
| D011 | `{alias:name}` in resolved Text/TextBox content names no top-level binding or a binding that does not resolve to Text for this Card → raw marker stays visible; diagnostic only, not a placeholder (◆52) |

### 3.9 The demo project (slice acceptance fixture)

```goblin
# CardGoblin demo — monster deck: suits via loop, health as hearts

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
```

With rows `(Dragon, 5, 4, 2)` and `(Imp, 1, 2, 1)`: 2 rows × 3 suits = 6 distinct
faces, 2+2+2+1+1+1 = 9 physical cards. Note the fixture leans on ◆30: `count` and
`name` are property-word identifiers used as columns, legal because only block
openers and expression words are reserved.

---

## 4. Architecture

### 4.1 Compiler pipeline (pure functions, `src/lib/lang/`)

```
source text ──lexer──► tokens ──parser──► AST ──binder/checker──► {AST´, E/W diagnostics}
                                                        │
sheet rows (from store) ──────────► generator/evaluator ┴─► {RenderModel, D diagnostics}
```

- `lexer.ts` — indentation-aware tokenizer (INDENT/DEDENT only; continuation is the
  parser's job, ◆23†).
- `parser.ts` — recursive descent for blocks, Pratt for expressions; implements the
  property-line continuation rule and contextual keywords (◆30†). **Error-tolerant
  by design** (⚑8): recovers at line/block boundaries so one bad line doesn't destroy
  all diagnostics.
- `check.ts` — resolves names, types every expression (expected-type resolution for
  bare names, ◆14†/◆21†), checks templates per using Card (§3.6), checks literal icon
  codes against the curated Dicier list (W004).
- `generate.ts` + `eval.ts` — §3.7; per-card try/catch converts data errors into
  error-placeholder cards, never exceptions upward; enforces both caps (◆27†).
- `dicier-codes.ts` — generated from `Dicier codes v1_5_4.txt` by a specced parse
  (§9): skip `:`-suffixed category headers, blank lines, and literal `etc.` lines;
  deduplicate across sections; keep codes containing spaces. ~888 unique codes.
  (An exhaustive GSUB-derived list was considered instead; not pursued — §9.)

RenderModel is deliberately dumb: `Deck[] → CardInstance{front: Shape[], back:
Shape[]}` where `Shape` is `{kind, x, y, …, resolved values}` in card units. Each
CardInstance carries a **content hash** so the preview can memoize (§4.2).

### 4.2 State and window wiring

One Zustand store (introduced in slice task 4† — the panels currently share nothing):

```
{ code: string,
  sheets: Record<sheetName, Record<columnName, string>[]>,   // rows, ⚑12
  compile: { ast, diagnostics, model, dataDiagnostics },     // derived, debounced 300ms
  lastGoodSchema: SheetSchema[],                             // survives broken compiles †
  lastGoodModel: { model, dataDiagnostics, excludedPristineRows } | null,
                                                              // what the preview renders †
  isStale: boolean,                                          // true while `compile` is bad †
  autosaveDisabled: boolean }                                // storage unusable this session (§6.2)
```

Uploaded assets are deliberately **not** in this store: the asset library is its own
small store (`assetStore.ts`, IndexedDB-backed, §7.4), because art is binary and can
be large — keeping it out of this synchronous, JSON-shaped state (and out of
localStorage entirely) means a big upload never touches the compile/persist path it
doesn't belong to. `editorStore` only reacts to it (an asset change is a compile
input, §7.4) rather than owning it.

- **Code window:** Monaco with a Monarch tokenizer for `.goblin` highlighting;
  compile diagnostics → `setModelMarkers` (squiggles + problems strip).
- **Grid window:** tabs and columns bind to **`lastGoodSchema`** — the schema from
  the most recent successful check — never to a broken AST, so mid-keystroke syntax
  errors don't make tabs flicker (†, symmetric with the preview's last-good-render
  rule). Enum columns get a dropdown cell editor; add/delete row; D001–D003 flag
  cells red; pristine rows render dimmed (◆29). Data survives schema edits (◆26);
  a compile diff showing exactly one column removed and one added **at the same
  index with the same type** is treated as a rename and migrates the data (◆26†).
  A sheet tab can be renamed from its explicit **Rename** control or by
  double-clicking the tab. Rename is an inline draft (Enter/blur commits, Escape
  cancels); commit atomically rewrites the `Sheet:` declaration and every Card
  `sheet:` reference, moves the row state to the new sheet key, and recompiles.
  It is disabled while code is broken and rejects invalid/colliding names or a
  destination with session-preserved orphan data, so a rename never overwrites
  rows. The code window updates because both windows edit one project source,
  but no code changes occur for each character typed into the rename draft.
  Columns start at 144 px and expose a drag/keyboard resize handle in each header
  (96–720 px); widths are local editor-view state, not project data. A **Wrap text**
  toggle is off by default. When enabled, Text-column editors wrap at the current
  column width and grow their row to their content; Number and Enum editors remain
  single-line. This keeps compact sheets compact while making long description
  fields readable without changing the stored cell value.
  Library risk: `react-spreadsheet` may resist custom editors/tabs — fallback is a
  small bespoke grid; decision deferred until task 6 (§5).
- **Preview window:** two views over the same model, chosen by a segmented toggle
  next to front/back. **Single card (default)** shows one card fitted to the panel
  with `[<] n/X [>]` nav over every card of every deck, flat in declaration order
  (M2, 2026-08-06: designing a card means looking at one card; the flat counter
  keeps the nav to a single control, and a caption names the deck you are in).
  **Grid** is the **virtualized** grid (†) of `CardSVG` components (SVG `viewBox`
  in card units — free scaling), grouped by Card block, with the zoom slider —
  which renders only in grid view, single view sizing the card to the panel
  instead. Both views share the front/back toggle, the stale banner, the optional
  preview-only red source-row badge, and the error-placeholder card for D-errors.
  The badge is rendered outside `CardSVG`, so it never enters PDF output.
  `CardSVG` is memoized on the
  RenderModel's per-card content hash (†) so an edit re-renders only affected cards
  — this, not raw compute, is what makes 500-card decks interactive. Text `y` is
  realized via per-font ascent constants (§3.4). Dicier loaded as a webfont — all ten
  `style:` faces declared as `@font-face`, browsers fetch only the ones a card
  actually uses (◆28 superseded, §3.3) — with `font-feature-settings: "liga" 1,
  "calt" 1, "dlig" 1, "kern" 1` († — `dlig` is required for double-digit codes like
  `"13_ON_D20"`).
- Compile runs on the main thread in the slice; moved to a web worker in M2 only if
  profiling demands (500-card decks are the sanity target).

### 4.3 Testing

Vitest unit tests per compiler stage (golden-file tests for parser/checker; semantic
tests for generation: cross-product counts, `count:` copies and caps, repeat
expansion, if chains, shadowing warnings, contextual-keyword and continuation edge
cases from §10). The demo project (§3.9) is the integration fixture. **Browser E2E is
a deliberate non-goal**, not a deferred one: this environment has no interaction
driver, so coverage stays headless top to bottom — components render real compiled
models via `renderToStaticMarkup`, interaction logic lives in pure unit-tested
functions (e.g. `gridModel.ts`, `previewVirtual.ts`), and a manual smoke-test
checklist (`docs/development.md`) is the human verification pass; one-shot
headless-Chrome screenshots cover visual regressions only, never click flows.

---

## 5. Vertical slice plan (milestone 1)

Ordered so every task lands on something testable; each has a "why this order".

0. **Environment & hygiene.** Install Node LTS (none found on this machine!); remove
   unused deps (`react-data-grid`, `scheduler`); **add `zustand` and vitest** (†);
   bump Next to latest 15.x patch (security); reorganize Dicier → keep `woff2/` +
   license + codes files under `src/app/fonts/dicier/` (no spaces in path), move
   guide/OTFs out of `src/`; generate `dicier-codes.ts` with the specced parse
   (§4.1); add Dicier attribution (footer + README, exact line in §9).
   *Why first: nothing runs today; licensing and path hygiene are cheapest now.*
1. **Lexer + parser + AST**, with tests; demo project parses. Contextual keywords
   (◆30) and the property-line continuation rule (◆23†) are implemented here — they
   are specced, not improvised (§10 exists precisely so task 1 has no open grammar
   questions).
   *Why: everything downstream consumes the AST; error-tolerance is designed in here.*
2. **Checker + Monaco wiring** (Monarch highlighting, markers).
   *Why: diagnostics early → every later feature is developed with live feedback.*
3. **Evaluator + generator → RenderModel**, with tests (both caps included).
   *Why: pure logic, fully unit-testable before any pixels exist.*
4. **Store + seeded demo project** (†): introduce the Zustand store, wire all three
   panels to it, preload the §3.9 code **and its rows** so compile output exists
   in-app.
   *Why here: the renderer task needs rows to show anything (⚑13 means empty sheets
   → zero cards); seeding before rendering makes task 5's output visible on arrival.*
5. **SVG renderer + preview panel** (virtualized grid, per-card memo, zoom,
   front/back, error placeholder, Dicier with `liga/calt/dlig/kern`, ascent-based y).
   *Why: first visible cards; validates geometry + font ligatures in one step.*
6. **Schema-driven grid** (tabs from `lastGoodSchema`, enum dropdowns, validation
   flags, row ops, pristine-row dimming, same-position rename migration; the
   react-spreadsheet vs bespoke decision lands here).
   *Why after preview: benefits from visible cards to verify binding end to end.*
7. **Integration polish.** Debounce tuning, status bar (N cards / M errors /
   excluded pristine rows), landing-page dead links fixed, 500-card perf validation
   against the virtualized preview.

**Acceptance criteria:** type the demo from scratch with live preview throughout
(grid tabs must not flicker while editing Sheet blocks — M5†); edit `health` in a
cell → hearts change on the affected cards only (per-card memoization observable);
introduce a parse error → squiggle appears, preview keeps last good render; set an
enum cell to garbage → that cell flags red and only that card becomes an error
placeholder; a committed column rename (same position + type) preserves its data;
a 500-card deck stays interactive.

## 6. Milestone 2 (next after slice)

PDF export (the reason geometry is mm-exact: duplex-mirrored back pages, cut lines,
bleed), `Image` element (URL-sourced), Monaco autocomplete (columns, enum cases,
icon codes), localStorage autosave, Dicier `style:` property, custom card sizes,
compile in a worker if needed. (An exhaustive GSUB-derived code list was floated
here too; shipped instead: the curated list stayed, and the M7-downgraded W004
warning has been enough in practice — §9.)

### 6.1 PDF export — agreed spec (2026-08-05)

- **Trigger:** "Export PDF" button in the editor → modal with options; produces a
  downloaded .pdf (pdf-lib, client-side — the one sanctioned new dependency).
- **Live page preview** († 2026-08-06): the modal draws the pages beside the
  options, from the same `layoutPdf` result the exporter consumes and with the same
  `CardFaceSvg` markup the rasterizer serializes — no second layout implementation
  that could drift, and every option (margins, spacing, guides, duplex mirroring)
  is inspectable before a PDF is rendered. Guides draw at true mm width; the one
  thing the preview cannot show is the 300 DPI rasterization step. A page stepper
  pages through the whole export; its index is clamped at render, since changing
  options changes the page count underneath it.
- **Modal options (defaults bold):** page size **Letter** (215.9×279.4 mm) / A4
  (210×297 mm); outer margin mm (**10**); card spacing mm (**0**); cut lines
  **dotted**/off/red/bold; cross marks **off**/dotted/red/bold; backs
  **duplex**/none/separate; print page numbers off by default.
- **Optional print pairing label (◆51):** a native PDF page label reads
  `k/N front` or `k/N back`. `N` counts logical front sheets across the project,
  and a matching front/back pair shares `k` even when Separate mode reorders all
  backs after all fronts. The live page preview draws the same label. It is plain
  page text, never part of a card raster, positioned immediately below the lowest
  occupied card row and right-aligned to that row. It is deliberately never moved
  back over artwork to stay printable: when a card grid consumes the full page,
  the printer/PDF page may clip the label instead.
- **Engine:** each *distinct* card face (by contentHash) is rasterized at 300 DPI
  through the browser's own SVG renderer (canvas → PNG) so fonts/ligatures match the
  preview exactly; each distinct image is embedded once and reused. Page frame,
  margins, and guides are native PDF vectors.
- **Progress:** export shows a determinate progress bar across distinct-face
  rasterization, PNG embedding, page construction, and final PDF serialization.
  Assembly yields periodically to the browser so large exports repaint the bar
  instead of batching every update behind one long main-thread task.
- **Layout:** decks never share pages. cols = ⌊(pageW − 2·margin + spacing) /
  (cardW + spacing)⌋, rows analog; row-major fill; a deck whose card can't fit 1×1
  inside the margins is a modal-surfaced error. **Duplex:** after each front page,
  a back page with columns mirrored (col′ = cols−1−col, rows unchanged — long-edge
  double-sided alignment). **Separate:** all back pages appended after all front
  pages, same mirroring. **None:** fronts only.
- **Grid anchoring** († 2026-08-09): the grid is horizontally **centered** between
  the margins — col-index mirroring aligns duplex backs under a long-edge flip only
  when the column x-positions are symmetric about the page's vertical center line;
  margin-anchoring would leave the backs offset by the leftover width. Vertically
  the grid is top-anchored at the margin (a long-edge flip leaves rows unchanged,
  so alignment never depends on the vertical anchor). The margin option is
  therefore the *minimum* outer margin; the fit formula still uses it exactly.
- **Guides:** cut lines run edge-to-edge across the page at every card boundary
  (spacing 0 → one shared line; spacing > 0 → a line along each edge of the gap).
  Cross marks are ~3 mm crop crosses at card corners only. Styles: dotted = 0.2 mm
  dotted black; red = 0.2 mm solid #cc0000; bold = 0.5 mm solid black. Guides render
  on back pages too (mirrored grid keeps them aligned).
- **Error/placeholder cards are skipped**; the modal warns "N cards with errors will
  be skipped" before export. Copy counts are honored (a count-2 card prints twice).
- Layout math and guide-segment computation live as pure, unit-tested functions;
  the canvas/pdf-lib assembly is a thin injected layer (pdf assembly itself is
  node-testable with stub images).

### 6.2 localStorage autosave — agreed spec (2026-08-08)

- **What persists:** `{ version, code, sheets }` — per sheet, `rows` AND
  `editedRows` (the ◆29 flags are project data: dropping them would un-dim
  pristine rows and change D003 behavior on restore). Compile state is derived
  and never stored. One slot, key `cardgoblin.project.v1`; the version is in the
  key and repeated in the payload — either mismatching means "not restorable",
  never "migrate silently".
- **When:** debounced **1 s** after any code/sheet change — deliberately separate
  from the 300 ms compile debounce (saving needs no compile result, and a save
  per keystroke burst is wasted I/O) — plus a flush on `pagehide` and on
  `visibilitychange → hidden`, the only signals mobile browsers fire reliably.
- **Restore:** on editor mount, a stored payload that parses, version-matches,
  and is shape-valid (string `code`; per sheet: `rows` an array of string-valued
  records, `editedRows` an array — misalignment normalized by the seed contract)
  replaces the demo via `replaceProject`, equivalent to seeding a fresh store
  (last-goods cleared, eager recompile; broken saved code restores as broken —
  what you had is what you get back). Anything else falls back to the demo seed
  WITHOUT touching the stored payload; the unreadable string is additionally
  copied to `cardgoblin.project.quarantine` (best-effort) so not even the next
  autosave can destroy it — a corrupt project stays recoverable by hand.
- **SSR mechanism:** the store singleton stays SSR-pure, so the static prerender
  and the hydration pass both show the demo; restore + the persist subscription
  attach in a post-hydration effect (`initEditorPersistence`, idempotent for
  StrictMode's double-mount). Accepted cost: returning users see a demo-frame
  flash before their project appears. Restoring any earlier would make the
  first client render mismatch the prerendered demo HTML.
- **Reset to demo:** a status-bar affordance with an inline two-step confirm
  (destructive — there is one slot). It removes both keys and reseeds via
  `replaceProject`; the reset itself is not re-persisted, so storage stays
  empty until the next user edit.
- **Failure posture:** storage access or writes throwing (private mode, quota)
  disables autosave for the session — `autosaveDisabled` in the store, a quiet
  "autosave off" in the status bar, the editor otherwise untouched. Multi-tab
  is last-writer-wins (no `storage`-event merging in v1; the losing tab's work
  is gone on its next load) — accepted until real project files (§7).

### 6.3 Monaco autocomplete — agreed spec (2026-08-09)

- **Architecture:** context derivation and suggestion computation are pure —
  `computeCompletions(documentText, offset, snapshot) → suggestions + replace range`
  in `goblinCompletion.ts`, unit-tested without Monaco; the registered provider is a
  thin offset↔position adapter (triggers `[` `.` `"` `:`, plus in-string quick
  suggestions so `code:` completion runs while typing). The name snapshot is rebuilt
  per invocation from the LATEST compile's bindings — partial bindings from a broken
  compile included, since `check()` never throws — falling back per category to
  `lastGoodSchema`, so suggestions track every keystroke without re-registration.
- **No clean compile required:** the cursor's *context* comes from a cheap textual
  scan of the document — indentation + nearest block headers walking upward,
  hoisted Template parameters/global/local lets, explicit call-argument blocks,
  `If`/`Else`, `Repeat`/`loop` `as`-variables, and a
  transitive whole-document Template-call→using-Card scan
  (completions follow §3.6's per-using-Card rule). Unrecognizable ancestors are
  stepped over; when the scan cannot place the cursor at all, bracket completions
  degrade to the union of all sheets' columns rather than to silence.
- **What completes where:** `[` → Template parameters/local lets/Repeat variables, the enclosing Card's
  (or the using Cards' union) loops and sheet columns, globals, then built-ins, inside
  string interpolation too
  (◆30); property-key positions → the block kind's key set with type-hint details
  (the tables mirror check.ts's private CARD_PROPERTY_KEYS/ELEMENT_SPECS — the test
  suite pins them to the checker with E008 probes); value positions by expected
  type — size presets, sheet names, template names on `Front:`/`Back:`, enum names
  on `loop:`, CSS color names (◆21), the nine canonical tokens + `center` on
  `pivot:` (M3 — aliases stay accepted, one spelling per point offered), full/half
  (+ middle for x on Text/Icon) on geometry; `code:` strings → the full Dicier list
  with each code's source-list section header as detail (`DICIER_CODE_CATEGORIES`,
  generated alongside `DICIER_CODES`); `Enum.` → that enum's cases; bare cases where
  ◆14 makes them legal (expected type first, otherwise globally-unique only);
  expression keywords at low priority. Direct Template indentation additionally offers
  `param` and its built-in/enum types; call-argument blocks offer the callee's declared
  names and use their types for value suggestions. After a completed string
  interpolation or its format colon, one focused snippet offers `[name:0N]` zero
  padding (default width 3); this is not a general format vocabulary.
  Template-node indentation offers `let`,
  `If:`, a pairing `Else:`, built-in nodes, and lowercase-or-uppercase Template calls;
  call suggestions omit the compatibility-only names `If` and `Else`. Comments
  complete nothing.
- **Ranking and ranges:** four sort tiers — context-primary, secondary (enum names,
  unique bare cases), keywords, hints — so context-relevant names surface first.
  Replace ranges span the word under the cursor (or the whole `code:` string
  content, since Dicier codes contain spaces), so mid-word acceptance overtypes
  cleanly instead of splicing.

## 7. Milestone 3

Projects & persistence (file export/import of `{code, sheets}`, then accounts/backend),
uploaded assets, sharing, docs site.

### 7.1 Project files — agreed spec (2026-08-10)

- **Export** downloads the current project as JSON — the same versioned payload
  autosave persists (`serializeProject`: version, code, sheets with rows +
  editedRows), so one format serves both and the validation machinery is shared.
  Filename: the single deck's name when there is exactly one Card block, else
  `cardgoblin-project`, plus `.cardgoblin.json`.
- **Import** opens a file picker, validates with the same `parsePersisted` rules
  (unparseable/wrong-version/shape-invalid → error message, current project
  untouched), then replaces the project via `replaceProject` with a two-step
  confirm (it is destructive to the current project — same pattern as reset).
  The imported project becomes the autosave slot's content through the normal
  save debounce (~1 s after the confirm, no edit needed): unlike reset, the
  import's `replaceProject` is deliberately NOT muted, so the attached autosave
  subscription persists it like any other change.
- **UI:** Export / Import join the status bar's right-hand group beside Reset.
- Multi-project management stays file-based in v1 (the autosave slot remains
  singular); accounts/cloud are later M3.

### 7.2 Text wrapping (TextBox) — agreed direction (2026-08-10; shipped M3 2026-08-10 — normative spec in the §3.3 row and §3.1 escapes)

- New **`TextBox`** element (Text stays single-line, ◆24 intact): x, y, width,
  height, text, size, color, `align: left|middle|right`, `line_height`
  (default ≈1.3×size), `overflow: clip|shrink` (default clip; shrink steps the
  font size down to a 60% floor until the text fits).
- **The compiler is the wrapping authority**: a Geist glyph-advance metrics
  table generated at build time (the dicier-codes pattern) lets the evaluator
  wrap deterministically in the pure layer with a small safety margin — the
  model carries resolved lines, preview/PDF agree by construction, and overflow
  is detected at generate time (preview badge on affected cards; NOT an error
  placeholder).
- Interpolation substitutes before wrapping and breaks occur on spaces. The
  run model now carries inline icons (◆44) and nested scoped colors (◆47);
  neither changes wrap measurement. Bold/italic spans remain a later design
  round.
- **Float boundary note (review):** the vertical-fit formula
  `lines × line_height × size ≤ height` is evaluated in IEEE floats exactly as
  written, so a box authored to the exact product (e.g. `height: 3.9` for
  3 × 1.3 × 1) may clip on the last line's ulp — author a hair of slack.
- **Explicit line breaks (2026-08-10, user requirement):** hard breaks are
  honored wherever a real newline character appears in the resolved text —
  from cell data (paste/import can carry newlines; multi-line cell *editing*
  in the grid is deferred) or from the new string-literal escapes: `\n` is a
  newline, `\\` a literal backslash (the lexer's only escapes besides `[[`;
  any other `\`-sequence is E001 with a hint). Hard breaks apply regardless
  of wrapping; in single-line `Text`, newline characters render as spaces.
- **Shipped detail (2026-08-10):** the shape carries an explicit `shrunk`
  flag beside `clipped`. The badge must fire for a shrink that then FITS
  (`clipped` false), and the shape deliberately drops the declared size
  (it carries only the final one), so shrunk-ness is not derivable — it has
  to travel. Rendering: one `<text>` per box with absolutely positioned
  `<tspan>`s (x/y per line, no `dy` chaining), same `TEXT_ASCENT` realization
  as `Text` (§3.4 m10); badge on the SHOWN face only, rendered by the preview
  wrapper so PDF/landing markup stays badge-free.

### 7.3 QR codes — scoped, HIGH PRIORITY (2026-08-10, shipped M3 2026-08-11 — normative spec in the §3.3 row, §3.1 opener/reserved-word lists, and §3.8's D009 row)

**Requirement (edu):** cards carry scannable codes from sheet data, enabling
cross-media games (an app scans the card and acts). The app is out of scope;
CardGoblin owns encoding + rendering. Canonical use: a Text column of codes,
a QR on every card's back — which needs zero extra machinery: Back templates
already evaluate per card (ambient bindings ⚑5), so `data: [code]` in a back
template gives every card its own QR.

- **Surface: a sixth drawable element, `Qr:`** — NOT the sketched `QR(...)`
  call syntax (the language has no call grammar; deliberately rejected before
  at custom sizes). Properties: `x y size data` required (`size` = the
  square's side in units — QRs are square), optional `color` (default black),
  `background` (default white), `level` (error correction `l|m|q|h`, default
  `m`), `pivot` (nine-point, standard). `data:` is a Text expression with
  standard coercions — `[column]`, interpolation, and conditionals all work.
- **Encoding at EVAL time in the compiler** (pure, deterministic — the wrap
  precedent): the shape carries the resolved module matrix; the renderer
  draws one vector path (crisp at print scale; PDF inherits it). Encoder:
  `qrcode-generator` (zero-dependency, MIT) as the SECOND sanctioned runtime
  dependency — Reed-Solomon + mask scoring is too intricate to hand-roll
  responsibly — isolated behind a typed wrapper (`src/lib/lang/qr.ts`), the
  only file that imports it. Structural tests (finder + timing pattern
  geometry) cross-validate encodings against the real QR spec, not just
  round-tripping.
- **Semantics:** UTF-8 byte mode — via `TextEncoder` rather than the
  library's own `stringToBytesFuncs['UTF-8']`, which its packaged CJS and ESM
  builds disagree on shipping. `data:` is written as raw UTF-8 bytes with no
  ECI (Extended Channel Interpretation) designator — the industry-standard
  assumption for byte-mode QR content when no ECI is present (zxing does the
  same), so general-purpose decoders auto-detect it correctly without one.
  The spec's 4-module quiet zone is drawn INSIDE
  the declared box (background-color border; modules shrink accordingly) so
  adjacent art can never break scanning. Empty referenced cell → D003 as
  usual; empty-string `data:` itself encodes normally (a valid tiny QR, no
  special case). Data exceeding the level's capacity (even at the largest QR
  version, 40) → **D009** "QR data is too long for one code", wired exactly
  like D008 (card-scoped placeholder, no `cell` — a decision reached during
  implementation: no new provenance machinery, since "the character that
  overflowed" has no single source cell any more precisely than "the number
  that divided by zero" does). Same data + level → same matrix, always
  (`qr.test.ts` asserts this directly).
- Shipped through the practiced element pipeline (lexer/parser openers,
  checker `ELEMENT_SPECS`, evaluator, `Shape` union, renderer, Monaco
  autocomplete + E008 pins, wiki, docFacts guard) — the same shape as the
  Image-element batch, plus the encoder wrapper and its structural tests.

### 7.4 Local image assets — agreed spec, P0 (2026-08-11)

**Requirement (edu):** use images local to the user's machine — no hosting —
to unblock prototyping.

- **Storage: IndexedDB** (not localStorage — string-only, ~5–10 MB quota;
  IDB stores Blobs natively with large quotas). Asset = {name (identifier
  rules, §3.1), mime, bytes}. Uploads capped at **2 MB per asset**
  (pre-encoding) with a clear message; quota/unavailable degrades exactly
  like autosave's pattern (disabled + quiet indicator). The IDB adapter is
  injectable for headless tests (hand-rolled thin wrapper, no new deps).
- **Reference: the `asset:` scheme inside Image `src:`** — zero language
  change: `src: "asset:dragon"`, per-row via a column holding asset
  references, interpolation (`"asset:[art]"`). Renderer resolves names to
  object URLs (cached, revoked on replace/delete); missing asset → the
  existing broken-image placeholder. Compile-time nicety: `compileProject`
  gains an optional additive `assetNames` set; a LITERAL `asset:` src whose
  name isn't in the library → new **W005 "unknown asset"** warning (never an
  error — the asset may be about to be uploaded).
- **UI: an Assets drawer off the status bar** (button beside Export/Import;
  count badge): upload via picker + drag-drop, thumbnail list, rename (
  identifier-validated), delete (confirm), copy-reference. No fourth panel.
- **PDF export:** asset images resolve from IDB bytes to data URIs — always
  embeddable, never part of the remote-URL CORS pre-flight count.
- **Project file v2:** `{version: 2, code, sheets, assets: {name: {mime,
  bytes: base64}}}` — self-contained and shareable, art included. v1 files
  import forever (assets absent). Import REPLACES the whole project
  including the asset library (v1 import → empty library) — consistent with
  replace semantics; the destructive confirm says so. Reset-to-demo clears
  the library too. The autosave slot is UNCHANGED (code+sheets in
  localStorage); assets persist in IDB at upload time — upload IS the save.
- **Export is complete-or-fails, never silently partial (amended
  2026-08-15):** any listed asset whose bytes can't be read at export time
  (an IDB failure disables the store) aborts the export with an inline
  error — a v2 file downloaded with `assets: {}` reads as a backup but
  imports as `replaceAll([])`, deleting the library.

### 7.5 Inline icons — agreed spec (2026-08-16)

**Requirement (edu):** icons inline WITHIN text — both Dicier glyphs and
new SVG art uploaded to the assets library — in `Text` and `TextBox`.
This is the "rich text runs" roadmap item, deliberately scoped to icons
only: bold/italic runs remain §8.

- **Syntax:** `{CODE}` / `{asset:name}` in any `text:`; `{{` literal
  brace; a lone `}` is literal. Parsed at eval time on the RESOLVED
  string (after interpolation) — the only design under which cell-borne
  markers work, and it needs no lexer or parser change at all (braces
  are ordinary string characters to §3.1).
- **Aliases (◆52):** before those markers parse, scan the resolved string once
  for `{alias:name}`. A target is eligible only when it is the top-level
  `let name:` and its value in the current Card is Text; replace it with that
  resolved Text. Do not scan replacements for more aliases. Unknown names,
  local lets/parameters, and non-Text globals retain their complete raw marker
  and produce non-fatal D011 once per affected alias/card; the card still renders.
  Because this pass follows expression/interpolation
  resolution, alias markers originating in sheet cells behave identically to
  literal ones; because ordinary marker parsing follows it, expanded fragments
  may contain color scopes, Dicier codes, and asset markers.
- **Run model:** the evaluator splits each line into runs and computes
  every run's x-offset in card units; `TextShape` gains `runs`,
  `TextBoxShape.lines` becomes lines-of-runs (each line also carries its
  measured width so the renderer can `align` without re-measuring). Both
  renderers place runs absolutely — preview/PDF agreement by
  construction, the ◆37 argument extended to mixed content.
- **The 1-em slot:** icon advance = `size`, drawn in a `size`×`size` box
  sitting on the line's em box. The pure compiler cannot measure Dicier
  ligature advances (no GSUB table in the metrics pipeline) or asset
  aspect ratios (assets are IndexedDB blobs, invisible to compile); a
  FIXED slot is the one width the compiler can assert and both renderers
  can honor exactly. Wide art letterboxes; true aspect is a future
  additive (an `assetDimensions` compile input + a Dicier advance table,
  §8).
- **Wrapping:** a marker is one atomic token (never breaks mid-slot);
  spaces around it collapse at break points exactly like word wrap
  (§3.3.3 semantics otherwise unchanged). Hard breaks unchanged.
- **Rendering:** text runs as `<tspan>` at absolute x; Dicier runs as a
  `<tspan>` in the Dicier `flat_dark` face at font-size `size`,
  inheriting the text `color`; asset runs as an `<image>` in the slot,
  resolved through the SAME machinery as the Image element (preview: the
  cardSvg status/object-URL layer incl. its epoch fences; PDF:
  `resolveImageSources` must also collect text-run asset names so the
  export pre-flight counts them).
- **Single-line `Text`:** identical markers and slot; no wrapping.
- **Diagnostics:** reuse W004 (unknown literal Dicier marker), W005
  (unknown literal asset marker — the checker scans STRING LITERALS
  only, as it already does for Icon `code:`), D005 (computed unknown
  code at data time; the raw marker text renders — same "the failure is
  its own indicator" stance). No new codes.
- **Out of scope (assumptions, veto-able):** per-marker style/face or
  color, bold/italic runs, true aspect ratios, vertical alignment
  options. Autocomplete inside `{` only if it drops out of the existing
  string-completion path cheaply; otherwise deferred.

### 7.6 Cross-device sync — agreed spec (2026-08-17)

**Requirement (edu):** sign in on any computer and find the project — code,
sheet data, and images. Explicitly NOT an accounts product: one admin login,
optimised for cost. Everyone else keeps the local-only editor unchanged.

**The shape.** No database. The project is already one small JSON payload
(§7.1's project file: code + sheets + editedRows — kilobytes) and assets are
already discrete files, so this is **object storage + a password**. The cloud
is a MIRROR of the existing local stores (localStorage + IndexedDB), never a
replacement: editing stays local-first, so an offline or signed-out session
behaves exactly as it does today.

- **Storage: Cloudflare R2**, private bucket, chosen over Vercel Blob (10 GB
  vs ~256 MB–1 GB and zero egress) and over Supabase (whose free projects
  pause after 7 idle days — disqualifying for bursty personal use). Layout,
  shaped so a project LIST is a later addition rather than a migration:

  ```
  projects/default/project.json      { revision, code, sheets, assets[] }
  projects/default/assets/<name>     raw bytes, original mime
  ```

- **Auth: a username and password, no user table** († 2026-08-18 — was
  password-only). `ADMIN_USERNAME` (default `admin`, overridable so the login
  form doesn't announce the account), `ADMIN_PASSWORD_HASH`, and
  `SESSION_SECRET` as server-only env vars; a login route compares both with
  timing-safe checks — **always computing both, never short-circuiting**, so a
  wrong username costs the same scrypt work as a wrong password — and sets an
  HMAC-signed `__Host-` session cookie (30 days). A wrong username, a wrong
  password, and both wrong return the same status, body, and delay. Serverless
  has no shared memory, so brute-force defence is a long random password plus a
  fixed delay on failure, NOT an in-process rate limiter that resets every cold
  start — and that delay throttles one connection, not an attacker firing
  requests in parallel.
- **Hash encoding** († 2026-08-18): the stored hash is dot-separated
  (`scrypt.N.r.p.salt.hash`). The original `$`-separated form was silently
  destroyed by Next's dotenv expansion in `.env.local` — `$131072` reads as a
  variable — and neither single nor double quotes prevent it, only backslashes.
  Dots need no escaping anywhere; base64url contains no dot, so parsing stays
  unambiguous. The legacy `$` form still verifies, so code and config can be
  updated in either order.
- **Diagnostics** († 2026-08-18): `GET /api/cloud/diagnose` reports booleans
  about configuration (never values, lengths, the username, or which separator
  a hash uses — the last two are oracles), and every login attempt logs a
  reason code. Added after a misconfigured deployment presented as "incorrect
  password" with nothing else to go on.

- **The 4.5 MB wall.** Vercel caps serverless request bodies, so asset bytes
  must never traverse a route handler. Every asset transfer uses a
  **short-lived presigned R2 URL** minted by an authenticated route; the
  browser then PUTs/GETs R2 directly. Bytes skip the function entirely, which
  is also what keeps this inside the free tier.

- **Staleness guard (the one real multi-device hazard).** `project.json`
  carries a `revision` integer. A write sends the revision it was based on;
  the server rejects a stale write with 409 + the current revision, and the
  editor offers *Reload* or *Overwrite* rather than silently clobbering the
  other machine's work. Where R2's conditional PUT (`If-Match` on the ETag) is
  available it backs this at the storage layer, closing the read-then-write
  race properly.

- **Sync cadence and cost.** Cloud pushes are debounced far longer than the
  1 s local autosave (~10 s idle, flushed on `pagehide`) — R2's free tier
  allows 1 M writes/month, and a per-keystroke push would be the only way to
  threaten that. Assets upload on add and delete on remove; a pull fetches
  the manifest, then downloads only assets whose content hash is missing
  locally, writing them into IndexedDB so every existing render path works
  untouched. Sign-in performs ONE exception to that debounce: when the cloud
  has nothing stored yet, it pushes immediately — code, sheets, and every
  local asset — rather than waiting for the next edit (dated addendum below).

- **First sign-in against an empty cloud actually pushes, and never claims
  "Synced" before it does** († 2026-08-18 — production bug, found by listing
  the owner's real R2 bucket after sign-in and getting zero objects back).
  The original not-found branch recorded revision 0 and showed "Synced"
  without ever writing to R2 — indistinguishable, in the UI, from a real
  sync, so two machines each kept their own local project and the owner
  correctly concluded sync was broken. Fixed on three fronts:
  - A not-found GET (first sign-in, or a returning visit's mount-restore
    check against a still-empty bucket) immediately PUSHES the current local
    project as the cloud's starting copy, through the same conditional-CREATE
    path (`baseRevision` 0 → `If-None-Match: *`) a 409 there already
    protects — another device winning the race surfaces the ordinary
    Reload/Overwrite prompt, not a clobber. Local assets ride along too: the
    manifest alone moves no bytes (asset transfer is normally event-driven,
    the bullet above), so this walks every local asset through the same
    upload path a live add already uses.
  - `lastSyncedAt` (and the status dot going green) is set ONLY at the exact
    moment a push or a project-bearing pull actually succeeds — never for a
    bare not-found GET on its own. The status control also says what just
    happened ("Loaded your cloud project" / "No cloud project yet —
    uploading this one") so the sign-in dialog closing silently no longer
    reads as "nothing happened."
  - A found project that's genuinely DIFFERENT from local — where local also
    isn't just the untouched demo seed — is now a COLLISION, not an
    unconditional `replaceProject`: signing in on a machine with a
    half-finished deck no longer silently overwrites it with whatever the
    cloud happens to hold. The blocking synchronization checkpoint presents
    **Use cloud project** / **Use this device's project**; the latter is the
    same adopt-and-push the empty-cloud case uses, just based at the revision
    this device saw instead of 0. Ordinary mid-session 409 conflicts retain
    the compact status-bar Reload/Overwrite prompt.

- **A manifest must never claim an asset that isn't actually on R2**
  († 2026-08-19 — independent review, HIGH, same class of bug as the addendum
  above: a green "Synced" over a cloud that doesn't hold what the manifest
  says it does). The first fix's adopt correctly ABORTED its push when an
  asset upload failed, but nothing recorded that the asset stayed
  un-uploaded — the next ORDINARY edit pushed the same manifest anyway and
  went green. Three more paths reached the identical state: "Keep this
  device's work" cleared its pending choice even when the underlying push
  never happened; a clean pull never uploads a LOCAL-ONLY asset the server
  doesn't have, so it just sits unaccounted for until "the next manifest"
  names it; and the asset store's own async IndexedDB restore schedules a
  push without uploading anything. Fixed with one mechanism rather than four
  patches: the client now tracks, per asset name, the hash it has actually
  CONFIRMED is on R2 (a successful upload, or a just-fetched server
  manifest — cleared the instant local content changes). Every push checks
  every manifest entry against that record FIRST, uploads whatever isn't
  confirmed, and holds the whole push at "offline" — never sending the
  manifest — if that upload fails. "Keep this device's work" now only
  clears its pending choice on an actual success, not unconditionally.
- **An unresolved sign-in collision suppresses live asset mutations, not
  just pushes** († 2026-08-19 — independent review, MEDIUM). A conflict
  prompt already blocks a stale-revision PUSH (bullet above), but an asset
  DELETE fired while the prompt is still showing was reaching R2 anyway —
  destroying the cloud copy before the user had chosen to keep it, so
  picking "Keep cloud copy" afterward could name bytes that were already
  gone. Asset add/delete/rename now checks unresolved choice state as well as
  the visible status, including a retained conflict after a failed upload and
  a 409/behind prompt. Editing itself is still available after an ordinary
  mid-session conflict; only the REMOTE asset write that would undercut a
  choice nobody's made yet is suppressed.
- **A partial image pull no longer claims a clean, green sync**
  († 2026-08-19 — independent review, MEDIUM). Downloading the images a
  pull's manifest lists used to swallow a per-asset failure (a presign
  failure, a 404'd GET, a rejected local write) entirely — the caller had
  nothing to check and unconditionally reported "Loaded your cloud project"
  with a fresh `lastSyncedAt`. Code and sheets loading is still unconditional
  (that part IS true), but a nonzero failure count now holds status at
  "offline" with a message naming how many images didn't come down, rather
  than claiming completeness FIX 2 specifically promises not to fake.
- **Initial collision detection includes local asset work**
  († 2026-08-19 — strengthened for the blocking sync checkpoint). Comparing
  code+sheets alone is not enough to promise that the visible project is the
  saved one: a local-only image or different bytes under a shared name could
  otherwise be silently replaced, or be pushed into the cloud on the next
  edit after a supposedly clean pull. Initial reconciliation therefore waits
  for the asset cache, hashes each local asset, and treats a local-only or
  locally-different asset as a collision. Cloud-only assets are not a
  collision because downloading them discards no local work. Choosing the
  cloud copy removes local-only assets and downloads missing/different ones;
  **Synced** is reached only when the resulting local library matches the
  cloud manifest. Choosing the device copy uploads its complete manifest as
  before.
- **The mount-restore adopt now waits for the local asset list to actually
  be current** († 2026-08-19 — independent review, LOW). `initAssetStore`'s
  own IndexedDB restore is itself async and usually — but not provably —
  finishes before the mount-restore path's network GET does (the GET
  involves a real round trip; the restore is often just a local read) —
  close enough to page load that nothing enforced the ordering. The adopt
  path now explicitly awaits the asset store's own refresh first (a no-op
  once the real restore has already landed), so it can never read the
  empty placeholder list that exists before IndexedDB answers.

- **SVG is a first-class cloud asset, with the trust boundary kept explicit**
  († 2026-08-19 — production bug). The local asset library has always accepted
  `image/svg+xml`, and existing projects use SVG frames, but the cloud-specific
  MIME allowlist admitted raster formats only. First sign-in therefore reached
  the presign route, received `400 Invalid mime type` for every SVG, correctly
  refused to publish a manifest whose bytes were missing, and stayed Offline —
  making the integrity fix above look like broken sync. The shared manifest +
  presign allowlist now admits the exact `image/svg+xml` string; it is still an
  exact reviewed list, not `image/*` (`image/html`, parameters, and unknown
  subtypes remain rejected). CardGoblin consumes stored SVG bytes only as image
  resources (`<img>` / SVG `<image>` and the existing image-based export path),
  never parses or injects their XML into the application DOM. Presign failures
  now also carry the route's safe error text into the controller and name the
  affected asset, so the next incompatible format is diagnosable from the UI
  rather than only from DevTools.

- **Server-to-R2 writes declare their byte length, and storage failures stay
  diagnosable** († 2026-08-19 — production bug). Direct browser asset uploads
  already sign an exact `Content-Length`, but the server-side `project.json`
  PUT relied on the fetch runtime to synthesize that required S3 header. That
  happened locally but is not a contract the Vercel runtime owes us. The R2
  adapter now sends `Content-Length` from the exact `Uint8Array.byteLength` it
  writes. It also parses only R2's safe XML error code/status (never request
  IDs, credentials, response bodies, or object contents) and carries that
  through authenticated cloud routes and the status control. A future R2
  rejection therefore reads like `R2 PUT 400 MissingContentLength`, while
  unexpected/network failures remain safely classified without leaking
  secrets, instead of every cause becoming `Cloud storage error.`

- **Project reads must preserve R2's strong object ETag across transfer
  encoding** († 2026-08-19 — production bug). The revision pre-check can say
  `baseRevision === currentRevision` and still lose a real concurrent race,
  so updates correctly reuse the just-read object's ETag in a storage-level
  `If-Match`. A sufficiently large `project.json`, however, was compressed on
  the server-to-R2 GET path and exposed as `W/"..."`; HTTP `If-Match` uses
  strong comparison, so that weak validator can never satisfy the following
  conditional PUT. The route consequently reported a false 409 at the same
  revision, making larger Goblin scripts look like conflicts. Server-side R2
  object reads now bypass fetch caches and explicitly request
  `Accept-Encoding: identity`, preserving the current stored strong ETag used
  by the conditional write. This does NOT strip a weak prefix, retry
  unconditionally, or otherwise relax conflict safety: a missing/weak ETag
  fails closed as a diagnosable storage error, while a stale strong ETag still
  fails at R2 and follows the existing 409 path.

- **Sign-in and remembered-session restore are a blocking synchronization
  checkpoint** († 2026-08-19 — production data-safety bug). A valid session
  must never make a browser look synchronized merely because it learned the
  cloud revision. The old mount-restore path fetched `project.json`, recorded
  its current revision, and left the browser's local project visible without
  comparing or applying the cloud payload. A later local push could therefore
  present that freshly learned revision and overwrite a different cloud
  project without the 409 guard firing. Both explicit sign-in and automatic
  restoration now use the SAME collision-safe reconciliation path: compare
  code, sheets, and local asset work; apply the cloud copy when local is
  disposable/equal, adopt local only when the cloud is empty, and otherwise
  require an explicit choice. The
  remembered-session path never records a found revision without also applying
  or comparing its project. Initial reconciliation also awaits the asset
  store's cold-start refresh. Concurrent refresh callers share one in-flight
  adapter read, preventing an older IndexedDB list from landing after cloud
  downloads and making a false **Synced** claim.
  - Once credentials are accepted (or a remembered session is detected), a
    modal blocks editor interaction and says **Syncing** for the entire
    reconciliation. It cannot be dismissed with Escape or the backdrop.
  - A confirmed pull or push changes the modal to **Synced** and states that
    the project now visible in the editor matches the saved cloud project. The
    user explicitly chooses **Continue** before editing resumes.
  - A network, auth, storage, or image-transfer failure changes it to **Could
    not sync** and states that local work is safe but NOT confirmed saved in
    the cloud. The user may acknowledge **Continue locally**. A divergent-copy
    conflict is not dismissible: the modal offers cloud/local choices, returns
    to **Syncing**, and reaches **Synced** only after that choice completes.
    A failed GET or partial pull leaves its revision non-authoritative; the
    next local edit retries `pull(true)` and can surface a choice, never a
    blind PUT using a project that was not fully applied. Immediate asset
    upload/delete/rename calls are suppressed across that same boundary so
    they cannot mutate objects still named by an unknown cloud manifest. Any
    local mutation made while authority is unknown forces a choice on that
    retry; this distinguishes an intentional local deletion from a merely
    not-yet-downloaded cloud-only asset.
  Ordinary background autosaves retain the compact status-bar behavior; the
  blocking gate is specifically for establishing which project is authoritative
  at session entry.

- **Failure posture (⚑8's spirit).** Any cloud failure — offline, expired
  session, R2 error — preserves the local project. During initial reconciliation
  it first blocks behind the explicit **Could not sync** checkpoint above; after
  the user acknowledges local-only mode, editing resumes with the quiet Offline
  indicator. Ordinary mid-session failures never block the editor. Sign-out
  clears the session cookie and leaves local data intact.

- **Known gap (M3 implementation, independent security review M6, not yet
  fixed): a CORRUPTED stored `project.json` bricks sync with no in-app
  escape.** If the object at `projects/default/project.json` ever fails its
  own read-back validation (hand-edited in the bucket, a future bug, bit
  rot) every GET and PUT starts answering "unreadable," and — unlike a
  revision conflict — there is no *Reload*/*Overwrite* affordance for
  "the stored copy itself is broken," because that would mean letting
  *Overwrite* succeed against a base state the server can't even parse,
  which is a small extension to the revision guard's semantics that
  deserves its own design pass rather than a rushed fix. The only present
  recovery is an operator deleting or replacing the object directly in R2.
  Local editing is unaffected either way (the failure posture above still
  holds) — this is a "cloud sync itself stays stuck" gap, not a data-loss
  one.

### 7.7 Generated data CSV — agreed spec (2026-08-20)

- **Unit of export:** one record per emitted `CardInstance`, in Card/row/loop/copy
  generation order. Legal error-placeholder instances are records too because they
  still occupy a printable position; `count: 0` emits none and the 2,000-card cap
  limits the CSV exactly as it limits preview/PDF.
- **Provenance columns:** `@card`, `@sheet`, `@row`, `@card_number`, `@project_card`,
  `@copy`, then one `@loop.<variable>` per encountered Card loop. `@row`,
  `@card_number`, `@project_card`, and `@copy` are 1-based. `@card_number` equals
  `[card]`/`[deck_card]`; `@project_card` equals `[project_card]`. `@` is outside
  Goblin's identifier alphabet, guaranteeing
  these cannot collide with declared columns.
- **Data columns:** declared physical cells, verbatim, then virtual-column results.
  A multi-Card/multi-Sheet project takes their stable first-seen union; fields absent
  from an instance are empty. Orphaned row keys are not declarations and stay out.
- **Virtual evaluation:** each virtual initializer is evaluated independently for
  each emitted instance. A data-time failure blanks that virtual field and reports
  the ordinary D-code, but does not replace an otherwise printable card: an export
  formula is metadata, not a face. Virtual results and physical export metadata are
  deliberately excluded from `contentHash`.
- **Encoding/UI:** RFC 4180 comma-separated fields, CRLF records, UTF-8
  `text/csv;charset=utf-8`. Exactly one Card block names `<Card>.csv`; otherwise
  `cardgoblin-data.csv`. **Export Data** lives in the status bar, is disabled with
  zero last-good instances, flushes pending compilation, and exports the same
  last-good model owned by preview/PDF.

## 8. Open questions (explicitly deferred, not blocking the slice)

Items are removed from this list once they ship — §10 and the milestone specs in
§6/§7 are the record of what was decided, when, and why (text wrapping, for
instance, left this list for §7.2).

- Auto-layout containers (`Row`/`Stack`) as sugar over `Repeat` (⚑9).
- Inline templates under `Front:` (named Template composition shipped in ◆46).
- Per-project UPLOADED fonts for `Text`/`TextBox` (◆41 shipped a closed,
  repo-bundled nine-face set instead — real future work, deferred because it
  needs a generated metrics table per uploaded face, §7.1b's asset library
  shape but bigger).
- Rich-text RUNS beyond icons and scoped color — bold/italic spans inside
  `Text`/`TextBox` (◆44 shipped the run model/icons and ◆47 shipped color;
  emphasis is the remaining half of the original "rich text" item).
- TRUE ASPECT RATIOS for inline icons (◆44 ships the square 1-em slot): an
  `assetDimensions` compile input (decoded at upload, the `assetNames`
  precedent) plus a Dicier ligature-advance table (GSUB extraction, §9's
  open thread) would let markers measure true-to-width.
- Per-marker Dicier FACES for inline icons (◆44 is `flat_dark` only —
  a style selector inside the marker, or a per-element `icon_style:`).
- Print specifics: bleed, safe zones, DPI for raster images.
- Whether `sheet:` becomes optional for loop-only Cards (⚑13 relaxation — the
  zero-column-sheet idiom is the v1 answer).
- Whether to extract an exhaustive Dicier code list from the font's GSUB table
  (§9) — floated for M2, never picked up; the curated ~888-code list plus W004's
  non-fatal warning haven't been a real problem, so this stays optional.

## 9. Dicier notes

Dicier v1.5.4 by Speak the Sky, **CC BY 4.0** — commercial use fine with visible
credit; embedding in PDFs explicitly allowed. Required credit (footer + README, †
— the license requires a link to the license text itself):
*"Dicier (https://speakthesky.itch.io/typeface-dicier) by Speak the Sky, licensed
under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)."*
Keep the license file adjacent to the shipped font files. Codes ligate from
uppercase text (e.g. `HEARTS`, `3_ON_D6`) with `liga` + `calt` + `dlig` (+ `kern`)
enabled — `dlig` is required for double-digit codes. The codes txt is a human
reference: ~888 unique codes once headers/`etc.`/duplicates are stripped, and
demonstrably non-exhaustive (translated families end in "etc."), hence W004 is a
warning. Extracting the true inventory from the font's GSUB table was the M2 plan
(§10 M7) for closing that gap exhaustively; it was never picked up, since the
curated list plus the non-fatal warning haven't been a real problem — an optional,
unscheduled improvement (§8), not a commitment.

## 10. Revision A change log (2026-08-03, post adversarial review)

| Finding | Change |
|---|---|
| C1 (demo illegal: `count` reserved) | ◆30 contextual keywords: only block openers + `case column` + expression words reserved; property words are identifiers; brackets always mean refs (§3.1) |
| C2 (continuation undecidable) | ◆23 rewritten: property-lines-only continuation, parser-level; `Repeat:` headers single-line (§3.1, §3.3) |
| M1 (color/identifier ambiguity) | ◆21 rewritten: CSS names resolve only in Color-typed positions; expected-type resolution unified in §3.5 |
| M2 (`y_units: auto` non-integer) | ⚑7 amended: fractional vertical unit count, units always square (§3.4) |
| M3 (`count:` uncapped/undiagnosed) | D006 + D007 added; 2,000-instance per-Card cap (◆27, §3.7, §3.8) |
| M4 (task 4 renders nothing; no store/zustand task) | New task 4 "store + seeded demo"; `zustand` added to task 0 (§5) |
| M5 (grid flicker on broken compiles) | `lastGoodSchema` in the store; grid binds to it (§4.2); acceptance criterion added |
| M6 (500-card perf unsupported) | Virtualized preview + per-card content-hash memoization (§4.1, §4.2, task 5) |
| M7 (code list: 1,181 wrong, parse unspecced) | ~888 unique codes; generator parse specced; W004 downgrade; GSUB extraction in M2 (§4.1, §9) |
| m1 (`dlig`/`kern` missing) | Font features now `liga calt dlig kern` (§4.2, §9) |
| m2 (`right`/presets not keywords) | Subsumed by ◆30 |
| m3 (`y: middle` contradiction) | `middle` is x-only; `y: middle` = E007 (§3.4) |
| m4 (no interpolation escape) | `[[` escape + E001 for malformed interpolation (§3.5) |
| m5 (`text: [cost]` illegal) | Number/Enum → Text coercion in Text positions (§3.5) |
| m6 (no code for missing required props) | E008 added (§3.2, §3.8) |
| m7 (D004/D005 have no cell) | Specced: computed-value diagnostics mark the placeholder card only (§3.8) |
| m8 (loop-only workaround unspecced; fresh rows error-spray) | Zero-column sheets legal (§3.2); ◆29 pristine rows dimmed + excluded |
| m9 (bets against ◆14/◆26) | ◆14 → expected-type resolution with unique-fallback; ◆26 → same-position/same-type rename migration (§3.5, §4.2) |
| m10 (em-box y unrealizable) | Ascent-constant realization specced (§3.4, §4.2) |
| m11 (credit line incomplete) | License-text URL added to the required credit (§9) |
