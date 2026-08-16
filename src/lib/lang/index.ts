/**
 * Public entry point for the Goblin script compiler pipeline (DESIGN.md §4.1).
 *
 * `compileSource` is the one call the editor (and, in task 4, the store's
 * derived compile state) needs: parse + check in one step, diagnostics merged
 * in source order. It is fast enough to run on every debounced keystroke
 * (§4.2 — the parser alone does ~5k lines in ~12 ms).
 */

import type { Program } from "./ast";
import type { Diagnostic } from "./diagnostics";
import type { Bindings } from "./check";
import { check, compareDiagnostics } from "./check";
import type { EditedRows, SheetRows } from "./generate";
import { generateModel } from "./generate";
import type { DataDiagnostic, RenderModel } from "./model";
import { parse } from "./parser";

export type * from "./ast";
export type { Diagnostic, Range, Severity } from "./diagnostics";
export { parse } from "./parser";
export type { ParseResult } from "./parser";
export { check, compareDiagnostics, typeName, SIZE_PRESETS } from "./check";
export type {
  Bindings,
  CardBindings,
  CheckResult,
  ColumnInfo,
  LoopBinding,
  ResolvableNode,
  Resolution,
  SheetInfo,
  SizePreset,
  ValueType,
} from "./check";
export { CSS_COLOR_NAMES } from "./css-colors";
export { DICIER_CODES, DICIER_CODE_CATEGORIES } from "./dicier-codes";
export { generateModel } from "./generate";
export type { EditedRows, GenerateResult, SheetRows } from "./generate";
export {
  ASSET_SRC_SCHEME,
  DEFAULT_FONT,
  DEFAULT_ICON_STYLE,
  DEFAULT_IMAGE_FIT,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_PIVOT,
  DEFAULT_ROTATE,
  DEFAULT_QR_LEVEL,
  DEFAULT_TEXTBOX_OVERFLOW,
  FONT_FACES,
  ICON_STYLES,
  IMAGE_FITS,
  PIVOT_TOKENS,
  QR_LEVELS,
  TEXTBOX_OVERFLOWS,
  parseAssetSrc,
  parsePivot,
} from "./model";
export type {
  CardInstance,
  CardMeta,
  CardRef,
  CellRef,
  DataDiagnostic,
  DataDiagnosticCode,
  Deck,
  FontFace,
  IconShape,
  IconStyle,
  ImageFit,
  ImageShape,
  LoopCaseBinding,
  Pivot,
  PivotH,
  PivotToken,
  PivotV,
  QrLevel,
  QrShape,
  RectShape,
  RenderModel,
  Shape,
  TextAnchor,
  TextBoxOverflow,
  TextBoxShape,
  TextShape,
} from "./model";
export {
  GEIST_METRICS,
  SHRINK_FLOOR,
  SHRINK_STEP,
  WIDTH_SAFETY_MARGIN,
  layoutTextBox,
  measureText,
  metricsForFace,
  wrapText,
} from "./wrap";
export type { FontMetrics, TextBoxLayout, TextBoxLayoutInput } from "./wrap";
export { FONT_METRICS } from "./font-metrics";
export type { BundledFontFace, GeneratedFontMetrics } from "./font-metrics";

export interface CompileResult {
  program: Program;
  bindings: Bindings;
  /** Parse (E001) and check (E002–E008, W001–W004) diagnostics, source-ordered.
   * (Plus the synthetic E000 — internal checker error — which should never
   * occur in practice; see check().) */
  diagnostics: Diagnostic[];
}

/**
 * Parse + check a Goblin source. Never throws. `assetNames` is additive
 * (§7.1b): the current Assets-drawer library, so a literal `asset:` Image
 * `src:` whose name isn't in it gets W005 (check.ts). Omitted entirely (not
 * just empty), W005 never fires — callers with no notion of an asset library
 * (most compiler-level tests) see identical diagnostics to before §7.1b.
 */
export function compileSource(
  source: string,
  assetNames?: ReadonlySet<string>,
): CompileResult {
  const { program, diagnostics: parseDiagnostics } = parse(source);
  const { bindings, diagnostics: checkDiagnostics } = check(program, assetNames);
  const diagnostics = [...parseDiagnostics, ...checkDiagnostics].sort(compareDiagnostics);
  return { program, bindings, diagnostics };
}

export interface ProjectResult extends CompileResult {
  model: RenderModel;
  dataDiagnostics: DataDiagnostic[];
  excludedPristineRows: Record<string, number>;
}

/**
 * Compile + generate in one call (§4.1): the store's derived compile state
 * (task 4). Never throws. E-level errors do NOT block generation — check()
 * always returns usable (possibly partial) bindings, the generator skips
 * Cards with unresolved essentials, and the E000 path returns empty
 * bindings, which generates an empty model. Keep-last-good on broken
 * compiles is the store's job, not this function's.
 */
export function compileProject(
  code: string,
  sheets: SheetRows,
  editedRows?: EditedRows,
  assetNames?: ReadonlySet<string>,
): ProjectResult {
  const compiled = compileSource(code, assetNames);
  const generated = generateModel(compiled.program, compiled.bindings, sheets, editedRows);
  return {
    ...compiled,
    model: generated.model,
    dataDiagnostics: generated.dataDiagnostics,
    excludedPristineRows: generated.excludedPristineRows,
  };
}
