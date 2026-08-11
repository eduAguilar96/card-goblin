/**
 * Card-set generator (DESIGN.md §3.7, §3.8, §4.1): rows × loop cross-product
 * × count copies → fully resolved RenderModel, with data-time diagnostics
 * (D001–D008) and per-instance error isolation (⚑8).
 *
 * Decisions resolved here beyond the spec text (each also documented at its
 * code site):
 * - Cards with unresolved essentials (`sheet:`/`size:`/`Front:`/`x_units:`/
 *   `y_units:`, or a `loop:` whose enum did not resolve) emit NO deck at
 *   all: compile errors own that surface (E008/E002 squiggles), and an empty
 *   deck would add an empty preview group for a Card the code window
 *   already marks broken.
 * - A missing `sheets[name]` entry means zero rows → an empty deck.
 * - Pristine rows (◆29): a row is pristine iff it is NOT flagged edited
 *   (the optional `editedRows` parameter — the store's per-row user-edit
 *   flags, task 4) AND every declared column is empty or whitespace-only.
 *   With no flags supplied the emptiness derivation stands alone (the
 *   pre-store fallback). A row the user edited and then EMPTIED is not
 *   pristine — it D003s when referenced; deleting the row is the remedy
 *   (spec letter: "never-edited all-empty", ◆29†). Rows of a zero-column
 *   sheet are never pristine either way — their existence is the edit
 *   (⚑13† loop-only decks need exactly a row count). A consequence of the
 *   fallback: an UNFLAGGED row whose only content sits in orphaned/
 *   undeclared keys counts as pristine (the grid shows it all-empty, ◆26
 *   keeps the data); flagged, it is edited like any other row.
 * - D003 is deduped per cell: every combination (or Card) referencing the
 *   same empty cell shares ONE diagnostic, exactly like reused D001/D002.
 * - contentHash: FNV-1a 32-bit over deck geometry + a JSON serialization of
 *   the resolved faces (or of the error diagnostics for placeholders).
 *   Pure and deterministic — no Date/random; meta (rowIndex/copyIndex) is
 *   deliberately excluded so `count:` copies share the hash.
 * - Copies of one combination share their Shape arrays and loopBindings
 *   record: faces and `count:` are evaluated ONCE per combination (the
 *   model is immutable by contract — see model.ts).
 * - When face evaluation fails but `count:` was valid, ALL n copies become
 *   placeholders (the count is real data; the deck size must reflect it).
 * - generateModel NEVER throws (⚑8): a per-Card try/catch degrades one deck
 *   to a D000 diagnostic (keeping the instances generated so far), and a
 *   whole-run catch degrades to an empty model + D000, mirroring check()'s
 *   E000 — D000 marks a generator bug, never a user error.
 */

import type { Program } from "./ast";
import type { Bindings, CardBindings, LoopBinding, SheetInfo } from "./check";
import type { EvalContext } from "./eval";
import {
  compileErrorDiagnostic,
  DataError,
  evalExpr,
  evalFace,
  parseNumberCell,
  REPEAT_CAP,
} from "./eval";
import type {
  CardInstance,
  DataDiagnostic,
  Deck,
  LoopCaseBinding,
  RenderModel,
  Shape,
} from "./model";
import { DEFAULT_ANCHOR } from "./model";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Grid rows as the store holds them (§4.2 ⚑12): raw strings only; a missing
 * key is an empty cell. Tolerated garbage (never-throws ⚑8): a missing or
 * non-array sheet entry is zero rows, a non-object row is all-empty, and
 * non-string cell values are stringified. */
export type SheetRows = Record<string, Record<string, string>[]>;

/** Per-row user-edited flags, keyed by sheet name (◆29, task 4): `true` at
 * index i means the user has touched row i since it was created — the row is
 * then never pristine, even if every cell is empty. Optional and tolerant
 * like SheetRows: a missing/non-array entry or missing index means
 * "not flagged" (only an exact `true` flags), falling back to the pure
 * emptiness derivation. */
export type EditedRows = Record<string, boolean[]>;

export interface GenerateResult {
  model: RenderModel;
  /** Cell-validation diagnostics (sheet/row/column order) followed by
   * generation diagnostics in emission order. */
  dataDiagnostics: DataDiagnostic[];
  /** Bound-sheet name → number of pristine rows excluded (◆29). Sheets with
   * zero exclusions are omitted. */
  excludedPristineRows: Record<string, number>;
}

/** Per-Card generated-instance cap (◆27†): a bad `count:` cell must not
 * freeze the tab any more than a bad Repeat may. Exported so the wiki's
 * stated limit can be tested against it
 * (`src/lib/docs/__tests__/docFacts.test.ts`). */
export const CARD_CAP = 2000;

/**
 * Generate the RenderModel for a checked program (§3.7). Consumes the
 * checker's Bindings — no name resolution or typing is re-implemented here.
 * Never throws. `_program` is accepted for the §4.1 pipeline signature;
 * Bindings already carries every declaration the generator needs.
 */
export function generateModel(
  _program: Program,
  bindings: Bindings,
  sheets: SheetRows,
  editedRows?: EditedRows,
): GenerateResult {
  try {
    return new Generator(bindings, sheets, editedRows).run();
  } catch (err) {
    // Last resort — never-throws is structural, not best-effort (⚑8).
    const message = err instanceof Error ? err.message : String(err);
    return {
      model: { decks: [] },
      dataDiagnostics: [{ code: "D000", message: `Internal generator error: ${message}` }],
      excludedPristineRows: {},
    };
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Validation results for one bound sheet, computed once even when several
 * Cards bind it. */
interface SheetData {
  info: SheetInfo;
  rows: Record<string, string>[];
  pristine: boolean[];
  /** `${rowIndex}|${column}` → D001/D002 (shared, never duplicated). */
  invalid: Map<string, DataDiagnostic>;
  /** `${rowIndex}|${column}` → D003, created on first reference. */
  empty: Map<string, DataDiagnostic>;
  excluded: number;
}

const cellKey = (rowIndex: number, column: string): string => `${rowIndex}|${column}`;

/** Raw cell text: missing key → "", non-string garbage → stringified.
 * OWN properties only — a column named `constructor`/`toString`/`valueOf`
 * must read as empty on an empty row, not walk the prototype chain into
 * `Object.prototype` (which would break pristine derivation and render
 * function sources as cell text). This is the single cell-access point. */
function rawCellOf(row: Record<string, string>, column: string): string {
  if (!Object.hasOwn(row, column)) return "";
  const v: unknown = row[column];
  return v == null ? "" : typeof v === "string" ? v : String(v);
}

class Generator {
  private readonly diagnostics: DataDiagnostic[] = [];
  private readonly sheetData = new Map<string, SheetData>();

  constructor(
    private readonly bindings: Bindings,
    private readonly sheets: SheetRows,
    private readonly editedRows?: EditedRows,
  ) {}

  run(): GenerateResult {
    // CELL VALIDATION first (§3.8): every cell of every BOUND sheet, once.
    for (const card of this.bindings.cards) {
      if (card.sheet && !this.sheetData.has(card.sheet.decl.name.name)) {
        this.validateSheet(card.sheet);
      }
    }

    // GENERATION (§3.7): per Card in declaration order (bindings.cards is
    // already source-ordered, duplicates included).
    const decks: Deck[] = [];
    for (const card of this.bindings.cards) {
      // decks.length is the deck's final index when it IS emitted — skipped
      // cards return null without generating any cardRef-bearing diagnostic.
      const deck = this.generateDeck(card, decks.length);
      if (deck) decks.push(deck);
    }

    const excludedPristineRows: Record<string, number> = {};
    for (const [name, data] of this.sheetData) {
      if (data.excluded > 0) excludedPristineRows[name] = data.excluded;
    }
    return { model: { decks }, dataDiagnostics: this.diagnostics, excludedPristineRows };
  }

  // -- cell validation (§3.8 D001/D002, ◆29) --------------------------------

  private validateSheet(info: SheetInfo): void {
    const sheetName = info.decl.name.name;
    const rawRows: unknown = this.sheets[sheetName];
    const rows: Record<string, string>[] = Array.isArray(rawRows)
      ? rawRows.map((r: unknown) =>
          r !== null && typeof r === "object" && !Array.isArray(r)
            ? (r as Record<string, string>)
            : {},
        )
      : []; // missing/garbage entry → zero rows (documented above)
    const data: SheetData = {
      info,
      rows,
      pristine: [],
      invalid: new Map(),
      empty: new Map(),
      excluded: 0,
    };
    this.sheetData.set(sheetName, data);

    const columns = [...info.columns.entries()];
    // Edited flags share SheetRows' garbage tolerance: non-array → no flags.
    const rawEdited: unknown = this.editedRows?.[sheetName];
    const edited: readonly unknown[] = Array.isArray(rawEdited) ? rawEdited : [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      // PRISTINE (◆29): not flagged edited AND all declared cells empty/
      // whitespace-only → excluded from validation AND generation.
      // Zero-column rows are never pristine (⚑13† — see the header comment).
      const pristine =
        columns.length > 0 &&
        edited[rowIndex] !== true &&
        columns.every(([col]) => rawCellOf(row, col).trim() === "");
      data.pristine.push(pristine);
      if (pristine) {
        data.excluded++;
        continue;
      }
      for (const [colName, colInfo] of columns) {
        const value = rawCellOf(row, colName).trim();
        if (value === "") continue; // emptiness errors only on reference (D003, ◆19)
        if (colInfo.type.kind === "Number") {
          if (parseNumberCell(value) === null) {
            const d: DataDiagnostic = {
              code: "D002",
              message: `"${value}" is not a number (column '${colName}', row ${rowIndex + 1})`,
              cell: { sheet: sheetName, rowIndex, column: colName },
            };
            data.invalid.set(cellKey(rowIndex, colName), d);
            this.diagnostics.push(d);
          }
        } else if (colInfo.type.kind === "Enum") {
          const enumName = colInfo.type.enumName;
          const enumDecl = this.bindings.enums.get(enumName);
          // Exact, case-sensitive case match (§3.8 D001). An unresolvable
          // enum type is Unknown, never Enum, so enumDecl is always found —
          // the guard only protects the never-throws contract.
          if (enumDecl && !enumDecl.cases.some((c) => c.name.name === value)) {
            const d: DataDiagnostic = {
              code: "D001",
              message: `"${value}" is not a case of enum ${enumName} (column '${colName}', row ${rowIndex + 1})`,
              cell: { sheet: sheetName, rowIndex, column: colName },
            };
            data.invalid.set(cellKey(rowIndex, colName), d);
            this.diagnostics.push(d);
          }
        }
        // Text and Unknown-typed columns: nothing to validate.
      }
    }
  }

  // -- deck generation (§3.7) -----------------------------------------------

  private generateDeck(card: CardBindings, deckIndex: number): Deck | null {
    const { sheet, size, front } = card;
    // Unresolved essentials → no deck (documented in the header comment).
    if (!sheet || !size || !front || card.xUnits === null || card.yUnits === null) return null;
    // An unresolvable loop enum makes the cross-product itself unresolvable
    // — same class as a missing essential (E002 owns it).
    if (card.loops.some((l) => l.enumDecl === null)) return null;

    const xUnits = card.xUnits;
    // ⚑7†: `auto` = x_units × height/width, units square, row count may be
    // fractional. Computed in integer hundredths of a millimetre (the same
    // exactness trick as check.ts's W003) so poker@20 is EXACTLY 28 and
    // tarot@20 exactly 240/7.
    const yUnits =
      card.yUnits === "auto"
        ? (xUnits * Math.round(size.heightMm * 100)) / Math.round(size.widthMm * 100)
        : card.yUnits;

    const deck: Deck = {
      cardName: card.decl.name.name,
      widthMm: size.widthMm,
      heightMm: size.heightMm,
      xUnits,
      yUnits,
      cards: [],
    };
    try {
      this.fillDeck(deck, deckIndex, card, xUnits, yUnits);
    } catch (err) {
      // Never-throws (⚑8): an internal failure degrades this ONE deck to a
      // D000, keeping the instances generated so far and every other deck.
      const message = err instanceof Error ? err.message : String(err);
      this.diagnostics.push({
        code: "D000",
        message: `Internal generator error in Card '${deck.cardName}': ${message}`,
      });
    }
    return deck;
  }

  private fillDeck(
    deck: Deck,
    deckIndex: number,
    card: CardBindings,
    xUnits: number,
    yUnits: number,
  ): void {
    const front = card.front;
    const sheet = card.sheet;
    if (!front || !sheet) return; // narrowed by generateDeck — defensive only
    const data = this.sheetData.get(sheet.decl.name.name);
    if (!data) return;

    // §3.7: rows in sheet order (pristine excluded) × loop-case combinations
    // (loops nested in declaration order, cases in enum order, last loop
    // varying fastest — row-major overall).
    rows: for (let rowIndex = 0; rowIndex < data.rows.length; rowIndex++) {
      if (data.pristine[rowIndex]) continue;
      for (const loopValues of loopCombinations(card.loops)) {
        const ctx = this.makeContext(card, data, rowIndex, loopValues, xUnits, yUnits);
        const loopRecord = toLoopRecord(loopValues);

        // count: default 1; integer ≥ 0 required — else D006 + exactly ONE
        // placeholder for this combination (§3.7 †). An unevaluable count
        // (bad/empty cell, D008…) carries its cause plus the D006.
        let count = 1;
        let countFailure: DataDiagnostic[] | null = null;
        if (card.countExpr) {
          try {
            const v = evalExpr(card.countExpr, ctx, null);
            if (v.kind !== "number") {
              // A statically mistyped count: was already E003-squiggled —
              // compile-poisoned path (D000), NOT D006: compile errors own
              // that surface, data diagnostics must not double-flag it.
              countFailure = [compileErrorDiagnostic()];
            } else if (!Number.isInteger(v.value) || v.value < 0) {
              countFailure = [
                { code: "D006", message: `count: must be a whole number ≥ 0, got ${v.value}` },
              ];
            } else {
              count = v.value;
            }
          } catch (err) {
            if (!(err instanceof DataError)) throw err;
            countFailure = [
              ...err.diagnostics,
              { code: "D006", message: "count: could not be evaluated for this row" },
            ];
          }
        }

        let emitted: boolean;
        if (countFailure) {
          emitted = this.emit(deck, deckIndex, rowIndex, loopRecord, 1, [], [], countFailure, []);
        } else if (count === 0) {
          emitted = true; // a legal zero — nothing to emit, no diagnostic
        } else {
          // EVALUATION happens once per combination; the n copies share the
          // resulting shapes and hash (§3.7 "n identical card instances").
          let frontShapes: Shape[] = [];
          let backShapes: Shape[] = [];
          let error: DataDiagnostic[] | null = null;
          try {
            frontShapes = evalFace(front, ctx);
            // Back absent (◆16) → a single full-card white rect, generated
            // HERE so the renderer stays dumb.
            backShapes = card.back
              ? evalFace(card.back, ctx)
              : [
                  {
                    kind: "rect",
                    x: 0,
                    y: 0,
                    width: xUnits,
                    height: yUnits,
                    color: "white",
                    anchor: DEFAULT_ANCHOR,
                  },
                ];
          } catch (err) {
            if (!(err instanceof DataError)) throw err;
            error = err.diagnostics; // ⚑8: this combination only — siblings unaffected
          }
          emitted = error
            ? this.emit(deck, deckIndex, rowIndex, loopRecord, count, [], [], error, [])
            : this.emit(
                deck,
                deckIndex,
                rowIndex,
                loopRecord,
                count,
                frontShapes,
                backShapes,
                null,
                ctx.iconIssues.values(),
              );
        }
        if (!emitted) break rows; // D007 — the Card is truncated (◆27†)
      }
    }
  }

  /**
   * Emit up to `n` copies of one evaluated combination (placeholder when
   * `error` is set), registering its diagnostics once against the FIRST
   * copy. Returns false when the 2,000-instance cap fired (D007) — the Card
   * must stop generating.
   */
  private emit(
    deck: Deck,
    deckIndex: number,
    rowIndex: number,
    loopBindings: Record<string, LoopCaseBinding>,
    n: number,
    front: Shape[],
    back: Shape[],
    error: DataDiagnostic[] | null,
    iconIssues: Iterable<DataDiagnostic>,
  ): boolean {
    const firstIndex = deck.cards.length;
    const allowed = Math.min(n, CARD_CAP - firstIndex);
    if (allowed > 0) {
      const cardRef = { deck: deck.cardName, deckIndex, cardIndex: firstIndex };
      if (error) {
        for (const d of error) {
          // Cell diagnostics (D001–D003) are already in the global list —
          // shared objects, never duplicated (§3.8). Card-scoped ones are
          // fresh per combination: stamp provenance and register them.
          if (d.cell) continue;
          if (!d.cardRef) d.cardRef = cardRef;
          this.diagnostics.push(d);
        }
      }
      for (const d of iconIssues) {
        d.cardRef = cardRef; // D005 — diagnostic only, the icon rendered (§3.8 †)
        this.diagnostics.push(d);
      }
      const contentHash = hashInstance(deck, front, back, error);
      for (let copyIndex = 0; copyIndex < allowed; copyIndex++) {
        const instance: CardInstance = {
          front,
          back,
          meta: { rowIndex, loopBindings, copyIndex },
          contentHash,
        };
        if (error) instance.error = { diagnostics: error };
        deck.cards.push(instance);
      }
    }
    if (allowed < n) {
      this.diagnostics.push({
        code: "D007",
        message: `Card '${deck.cardName}' hit the ${CARD_CAP.toLocaleString("en-US")}-instance cap — generation truncated (check the count: values)`,
      });
      return false;
    }
    return true;
  }

  private makeContext(
    card: CardBindings,
    data: SheetData,
    rowIndex: number,
    loopValues: ReadonlyMap<string, LoopCaseBinding>,
    xUnits: number,
    yUnits: number,
  ): EvalContext {
    const row = data.rows[rowIndex];
    const sheetName = data.info.decl.name.name;
    return {
      card,
      xUnits,
      yUnits,
      rawCell: (column) => rawCellOf(row, column),
      cellIssue: (column) => data.invalid.get(cellKey(rowIndex, column)),
      emptyCellIssue: (column, typeLabel) => {
        // D003 (◆19), deduped per cell: the first referencing combination
        // creates and registers it; later ones (and other Cards) reuse it.
        const key = cellKey(rowIndex, column);
        let d = data.empty.get(key);
        if (!d) {
          d = {
            code: "D003",
            message: `Referenced ${typeLabel} cell is empty (column '${column}', row ${rowIndex + 1})`,
            cell: { sheet: sheetName, rowIndex, column },
          };
          data.empty.set(key, d);
          this.diagnostics.push(d);
        }
        return d;
      },
      loopValues,
      repeatStack: [],
      budget: { remaining: REPEAT_CAP },
      iconIssues: new Map(),
    };
  }
}

// -- loop cross-product (⚑1, ◆25) -------------------------------------------

/** Yields every loop-case combination: loops nested in declaration order,
 * cases in enum order, LAST loop varying fastest. Zero loops → one empty
 * combination; an empty enum → an empty cross-product. Callers only see
 * cards whose loops all resolved (generateDeck skips the rest). */
function* loopCombinations(
  loops: readonly LoopBinding[],
): IterableIterator<ReadonlyMap<string, LoopCaseBinding>> {
  const dims = loops.map((l) => ({
    variable: l.variable,
    enumName: l.enumDecl?.name.name ?? "",
    cases: l.enumDecl?.cases.map((c) => c.name.name) ?? [],
  }));
  if (dims.some((d) => d.cases.length === 0)) return;
  const idx = dims.map(() => 0);
  for (;;) {
    const combo = new Map<string, LoopCaseBinding>();
    for (let i = 0; i < dims.length; i++) {
      combo.set(dims[i].variable, { enum: dims[i].enumName, case: dims[i].cases[idx[i]] });
    }
    yield combo;
    let k = dims.length - 1;
    while (k >= 0 && ++idx[k] === dims[k].cases.length) {
      idx[k] = 0;
      k--;
    }
    if (k < 0) return;
  }
}

function toLoopRecord(
  loopValues: ReadonlyMap<string, LoopCaseBinding>,
): Record<string, LoopCaseBinding> {
  const record: Record<string, LoopCaseBinding> = {};
  for (const [variable, value] of loopValues) record[variable] = value;
  return record;
}

// -- content hash (§4.1 †) --------------------------------------------------

/** Canonical serialization of one instance's resolved content: deck geometry
 * + faces (or error diagnostics for placeholders). JSON.stringify is
 * deterministic here because every object is built with a fixed literal key
 * order. Meta is excluded so copies share the hash. */
function hashInstance(
  deck: Deck,
  front: Shape[],
  back: Shape[],
  error: DataDiagnostic[] | null,
): string {
  const geometry = `${deck.widthMm}|${deck.heightMm}|${deck.xUnits}|${deck.yUnits}`;
  const payload = error
    ? `E:${JSON.stringify(error.map((d) => [d.code, d.message, d.cell ?? null]))}`
    : `F:${JSON.stringify(front)};B:${JSON.stringify(back)}`;
  return fnv1a(`${geometry};${payload}`);
}

/** FNV-1a 32-bit over UTF-16 code units, as 8 hex chars. Pure and
 * deterministic — the per-card memoization key must never involve
 * Date.now/Math.random (§4.2). */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
