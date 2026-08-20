# GoblinScript bindings, conditionals, and template composition

Status: implemented, with grammar, runtime, compatibility, and boundary-condition
reviews. `docs/DESIGN.md` remains the normative language specification; keep this
document as the concise execution and acceptance brief.

## Outcome

Replace off-card conditional hacks with three additive features that work together:

1. immutable global and local `let` bindings;
2. structural `If:` / `Else:` blocks;
3. templates invoking other templates as reusable visual components.

Existing scripts and the resolved `RenderModel` remain compatible. All new structure
is evaluated and flattened before rendering.

## Proposed syntax

```goblin
let text_color: #E3D3BA
let equipment: [type] == CardType.Armor
  or [type] == CardType.Charm
  or [type] == CardType.Summon

Template: EquipmentFrontRotated
  TextBox:
    color: [text_color]
    text: [desc]
    # ...

Template: EquipmentFront
  TextBox:
    color: [text_color]
    text: [desc]
    # ...

Template: MonsterFront
  let title_size: 3.7

  If: [equipment]
    EquipmentFrontRotated:
  Else:
    EquipmentFront:
```

Capitalized `If:`/`Else:` are structural nodes; lowercase `if … then … else …`
remains the expression form. Template calls keep the trailing colon like every other
node header. Identifiers remain `[A-Za-z][A-Za-z0-9_]*`; use `[text_color]`, not
`[text-color]`.

The new forms are contextual, not globally reserved. `let` is special only as
`let <name>:` at program or template-node indentation, and `If:`/`Else:` only in
template-node position. Existing declarations such as `column let: Text`,
`Template: If`, and `Front: If` remain legal.

## Semantics

### `let`

- `let name: expression` is immutable and type-inferred. It is legal at program
  scope and inside Template, If/Else, and Repeat bodies.
- A let initializer is the second and only continuation-capable line form besides a
  property: it may continue on deeper-indented lines using the same parser machinery.
  Geometry words such as `full`, `half`, and `middle` are invalid because a binding
  has no axis.
- Bindings in one lexical block are visible throughout that block and its descendants,
  independent of declaration order. Duplicate same-scope names are errors; dependency
  cycles are compile errors. Same-block lets are collected before any initializer is
  resolved, so forward references and duplicate diagnostics are deterministic.
- Values are lazy. Each evaluation root (`count`, Front, Back, and every divergent
  `[card]` copy) receives a fresh session. Globals cache once per session; local lets
  cache once per activation of their declaring frame—each template invocation,
  selected branch, and Repeat iteration gets fresh local slots. Slots track
  `uninitialized | evaluating | value`, providing a defensive runtime cycle guard.
  An unused binding reads no cells, emits no data diagnostics, and does not mark
  `[card]` as used.
- The binding session is layered over—not a replacement for—the existing per-instance
  `EvalContext`. Cell access, `[card]` state, Repeat stack/shared Repeat budget, and icon
  diagnostics retain their current lifetime across Front/Back; only binding caches and
  composition counters reset at the evaluation-root boundaries above.
- A program-scope binding may reference other globals plus the current Card's sheet
  columns, Card loop variables, and `[row]`/`[card]`. It does not capture caller-local
  lets or Repeat variables. Within a global initializer, another declared global wins
  over an ambient column of the same name, producing a stable dependency graph.
- A local binding may reference bindings in lexical parent scopes and enclosing Repeat
  variables within its own defining template. A callee's locals never leak back.
- Name lookup preserves existing scripts: nearest local let/Repeat binding, Card loop
  variable, sheet column, program-scope let, then built-in `[row]`/`[card]`. Shadowing
  uses W001. Program-scope names therefore cannot silently reinterpret existing columns.
- Initializers without an expected type must be self-typing: use `#RRGGBB` for Color
  values and qualified enum cases where a bare case is ambiguous. Type annotations are
  out of scope.
- Bindings are context-typed per reachable Card, matching ambient Templates: a global
  that reads `[data]` may be Number for one Card and Text for another. Both If branches
  are statically reachable; runtime branch selection affects evaluation only. A global
  unused by a Card's `count` or transitive face/call graph is not checked in that Card.

### Structural `If:` / `Else:`

- `If:` takes a single-line Bool expression. Complex conditions should be named with
  `let`. `Else:` is optional and must be the next nonblank/non-comment sibling at the
  same indentation. The parser consumes it as part of the If node; orphan, duplicate,
  misindented, and lowercase `else:` forms receive one targeted recovery diagnostic.
  Empty branches are legal.
- Both branches are always parsed and statically name/type checked. Only the selected
  branch evaluates at data time.
- Only the selected branch evaluates. The untaken branch emits no shapes, evaluates no
  lets, produces no data diagnostics, and does not mark `[card]` as used.
- Branches introduce lexical scopes. Nested If and Repeat nodes are legal. Else-if is
  expressed with a nested `If:` inside `Else:` in the first release.
- Emitted shape order is source order, preserving z-order.

### Template composition

- In template-node position, a built-in/control opener resolves as today; any other
  `<identifier>:`—including lowercase names—parses as a Template call and resolves in
  the checker. Missing names are E002. Calls have no inline label, child block, or
  arguments in this release; accidental children produce one E001 and are consumed
  without swallowing the next valid sibling. For compatibility, existing templates
  named `If` or `Else` remain legal direct Front/Back targets, but those two names
  cannot use the shorthand nested-call form; an attempted call gets a targeted
  diagnostic and completion omits it.
- A call expands the callee at that exact z-order position and may appear inside If,
  Else, Repeat, or another called template.
- To preserve the current one-resolution-per-AST-node-per-Card contract, a callee does
  **not** capture caller-local lets or caller Repeat variables in this release. It sees
  its own lexical lets, program globals, Card loops, sheet columns, and `[row]`/`[card]`.
  Explicit arguments are the future mechanism for passing caller values. A call may
  still sit inside Repeat and execute each iteration; its internals simply cannot read
  that caller's index yet.
- Templates are checked per Card context. `Bindings.templateUsage` becomes the
  transitive, Card-declaration-order set for every reachable template; this drives both
  contextual checking/completions and W002.
- Direct and indirect recursion are compile errors with the full call path. Add a
  maximum of 64 active template calls and 10,000 expanded template-node visits reached
  through call edges per Card face during checking (E010 at the crossing call).
  Evaluation independently enforces the same call depth and composition-only visit
  budget per face/copy (D010 placeholder). The directly selected Front/Back root and
  its call-free descendants are not charged, so a legacy face with no TemplateCall
  cannot hit the new cap. Cyclic let or template dependencies use E009, anchored at
  the closing reference/call with the full path; do not reuse retired E006. These
  budgets are separate from Repeat's existing shared 500-expansion budget and Card's
  2,000-instance cap.
- Checker and evaluator template-node walks also enforce the parser's existing
  500-block structural-depth ceiling across If/Repeat/call descent, independently of
  the 64 active-call limit. Prefer an iterative walk where practical; otherwise guard
  before recursion so pathological nesting remains never-throw.
- The evaluator flattens calls into the existing `Shape[]`; content hashing, preview,
  and PDF rendering require no new node or renderer behavior.

### Binding diagnostics

- Program-scope lets occupy a separate value namespace from Enum/Sheet/Template/Card;
  duplicate globals and duplicate same-block locals use E005.
- W001 is normally emitted at the narrower binding when a local let, Repeat variable,
  or Card loop shadows an outer binding. Compatibility exception: a global hidden by
  an existing sheet column emits one deduped W001 per global/sheet pair at the global
  declaration, avoiding a new warning range on otherwise untouched sheet code.
- W002 applies to globals and locals with no syntactic reference in their permitted
  scope. References in either If branch count; global and Template use is transitive.
- One dependency strongly-connected component produces one primary E009 to avoid
  cascades. Runtime `evaluating` slots and call budgets still defend never-throw if an
  invalid binding reaches evaluation.

## Execution sequence

Keep every slice green and independently tested.

1. **Specify:** record syntax, scope, lookup, laziness, cycles, caps, and diagnostics in
   `docs/DESIGN.md`; update the relevant GoblinScript wiki pages in the shipping slice.
2. **Bindings:** add global/local Let AST nodes, parser recovery, checker scopes and
   dependency resolution, evaluation sessions/activation frames, completions, and tests.
3. **Conditionals:** add If/Else AST and parser pairing, Bool checking, scoped/lazy
   evaluation, completions, and branch-sharing tests.
4. **Composition:** add TemplateCall AST, transitive per-Card contextual checking,
   usage and cycle detection, bounded expansion, completions, and flattening tests.
5. **Integration:** update the demo/acceptance fixture to exercise the features, run
   `npm test`, `npx tsc --noEmit`, and `npm run build`, then complete the editor smoke
   test for diagnostics, stale preview behavior, front/back, and PDF parity.

Primary code surfaces: `src/lib/lang/{ast,lexer,parser,check,eval,generate,model,index}.ts`,
compiler tests under `src/lib/lang/__tests__/`, Monaco language/completions under
`src/app/editor/_lib/`, `docs/DESIGN.md`, and `docs/wiki/goblin-script/`.

Editor work explicitly includes contextual highlighting, If/Else ancestor/pairing
suggestions, let continuation and hoisted-scope scanning, bracket completions for
local/global lets with lookup precedence, template-call suggestions at node indentation,
transitive Template→Card scope discovery, lowercase template calls, malformed-code
fallback, and completion/checker pin tests.

## Acceptance criteria

- The Monster example selects upright versus rotated content without `x: 9999`.
- Global constants and row-derived globals resolve across templates. A global absent
  from a Card's static count/face/call reference graph does not break that Card; a bad
  reference in an untaken If branch still fails static checking.
- Forward binding references work; duplicate names, shadowing, unknown refs, binding
  cycles, orphan Else, template cycles, and expansion limits produce precise,
  non-cascading diagnostics while parse/check/generate remain never-throw.
- Lazy branch/binding behavior prevents data diagnostics and `[card]` divergence from
  runtime-untaken expressions. Fresh count/Front/Back/copy sessions and per-activation
  Repeat caches prevent value leakage. Front/back shape-array sharing remains unchanged
  when a face does not actually read `[card]`.
- Nested calls preserve z-order; multiple calls, diamond graphs, direct-plus-transitive
  usage, calls inside Repeat, and zero-count Repeat all behave deterministically.
- A large call-free legacy face cannot hit E010/D010; an equivalent workload reached
  through composition does hit the documented cap at the crossing call.
- Representative existing fixtures retain their diagnostics, serialized RenderModels,
  content hashes, and shape-array identity sharing. No renderer/PDF code changes are
  necessary, so preview/export parity follows from identical flattened shapes.
- Autocomplete, reserved-word facts, wiki facts, and diagnostics documentation agree
  with the checker and parser.
- Parser recovery covers malformed lets, lowercase/orphan/misindented Else, unknown
  lowercase calls, accidental call children, and deep/cyclic graphs without throwing.
- Dedicated parser/checker/Monarch/completion regressions prove `column let: Text`,
  declarations named `If`/`Else`, and `Front: If` retain their previous meanings and
  are not accidentally added to the global reserved-word set.

## Non-goals

Mutable variables, assignment, general functions, template parameters/arguments,
recursive templates, nested Template declarations, hyphenated identifiers, geometry
keywords in lets, caller-local/Repeat capture by called templates, relaxing literal-only
properties such as `line_height:`, rich-text styling, image tinting, and automatic layout
are separate increments. The custom `TemplateName:` call syntax deliberately leaves
room for a future property block of typed arguments without defining it now.
