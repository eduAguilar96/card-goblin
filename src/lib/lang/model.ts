/**
 * RenderModel — the fully resolved output of card generation (DESIGN.md §4.1).
 *
 * Deliberately dumb: concrete numbers, strings, and CSS color strings only —
 * the renderer (task 5) never sees an expression, a cell, or a binding. All
 * geometry is in card units (§3.4); colors are CSS strings (named colors
 * lower-cased, `#hex` literals passed through as written).
 *
 * Sharing/immutability contract: the model is read-only after generation.
 * Copies produced by `count:` share their Shape arrays and `loopBindings`
 * record (identical resolved faces, identical `contentHash`); consumers must
 * treat every part of the model as immutable.
 */

// ---------------------------------------------------------------------------
// Data-time diagnostics (§3.8, ⚑8)
// ---------------------------------------------------------------------------

/**
 * D001–D008 are the §3.8 catalog. D000 is OUTSIDE the catalog by design,
 * mirroring the checker's E000: it never marks a data-entry mistake. It is
 * used (a) per card, when a card cannot be evaluated because its code has
 * compile errors (the squiggles own the surface; the model just marks the
 * placeholder), and (b) as the never-throws degradation of an internal
 * generator failure (⚑8 — structural, like check()'s E000).
 */
export type DataDiagnosticCode =
  | "D000"
  | "D001"
  | "D002"
  | "D003"
  | "D004"
  | "D005"
  | "D006"
  | "D007"
  | "D008";

/** Cell provenance — the grid flags this cell red (§3.8 D001–D003). */
export interface CellRef {
  sheet: string;
  /** 0-based index into the sheet's row array (grid order). */
  rowIndex: number;
  column: string;
}

/** Card provenance for computed-value diagnostics with no single source cell. */
export interface CardRef {
  /** The Card declaration's name (`Deck.cardName`). */
  deck: string;
  /** Index into `RenderModel.decks` — the authoritative pointer: duplicate
   * Card names (E005) still generate one deck each, so the name alone is
   * ambiguous. Decks are in declaration order, making this stable. */
  deckIndex: number;
  /** Index into that deck's `cards`; for `count:` copies, the FIRST copy. */
  cardIndex: number;
}

export interface DataDiagnostic {
  code: DataDiagnosticCode;
  message: string;
  /**
   * Present exactly for D001–D003 (§3.8 †). Cell diagnostics are shared:
   * every card instance whose evaluation touches the cell carries the same
   * object, and it appears once in the global list — never duplicated.
   */
  cell?: CellRef;
  /**
   * Present for card-scoped diagnostics (D004–D006, D008, and per-card
   * D000). D007 and the model-level D000 carry neither `cell` nor `cardRef`
   * — they are deck/model-level (the message names the deck).
   */
  cardRef?: CardRef;
}

// ---------------------------------------------------------------------------
// Shapes (§3.3, §3.4)
// ---------------------------------------------------------------------------

/** Horizontal anchor of Text/Icon (§3.4); default `left`. */
export type TextAnchor = "left" | "middle" | "right";

/**
 * The ten Dicier faces selectable via Icon `style:` (§3.3, M2 — ◆28's
 * "Flat-Dark only" restriction lifted). Order is the docs/completion order:
 * flat → block → round (dark/light/heavy each), then pixel. This array is the
 * single source of truth — the checker's vocabulary, the renderer's
 * font-family map, and the wiki's style table (docFacts) all pin to it.
 */
export const ICON_STYLES = [
  "flat_dark",
  "flat_light",
  "flat_heavy",
  "block_dark",
  "block_light",
  "block_heavy",
  "round_dark",
  "round_light",
  "round_heavy",
  "pixel",
] as const;

export type IconStyle = (typeof ICON_STYLES)[number];

/** §3.3: `style:` is optional; the default face is Flat-Dark. */
export const DEFAULT_ICON_STYLE: IconStyle = "flat_dark";

/**
 * Image `fit:` vocabulary (§3.3, M2): how the raster art maps onto the shape's
 * box, realized as SVG `preserveAspectRatio` by the renderer. Closed set like
 * ICON_STYLES — the checker's vocabulary, the renderer's preserveAspectRatio
 * map, and the wiki's fit table (docFacts) all pin to this array.
 */
export const IMAGE_FITS = ["contain", "cover", "stretch"] as const;

export type ImageFit = (typeof IMAGE_FITS)[number];

/** §3.3: `fit:` is optional; the default keeps the whole image visible. */
export const DEFAULT_IMAGE_FIT: ImageFit = "contain";

/**
 * TextBox `overflow:` vocabulary (§3.3, M3): what happens when the wrapped
 * text is taller than the box. Closed set like IMAGE_FITS — the checker's
 * vocabulary, the completion values, and the wiki's overflow table (docFacts)
 * all pin to this array.
 */
export const TEXTBOX_OVERFLOWS = ["clip", "shrink"] as const;

export type TextBoxOverflow = (typeof TEXTBOX_OVERFLOWS)[number];

/** §3.3: `overflow:` is optional; the default keeps the declared size and
 * drops lines that don't fit. */
export const DEFAULT_TEXTBOX_OVERFLOW: TextBoxOverflow = "clip";

/** §3.3: `line_height:` is optional; baseline advance = line_height × size. */
export const DEFAULT_LINE_HEIGHT = 1.3;

/** Anchored top-left (§3.3). */
export interface RectShape {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  /** CSS color string (named color lower-cased, or `#hex` as written). */
  color: string;
}

export interface TextShape {
  kind: "text";
  x: number;
  /** Top of the em box (§3.4; the renderer realizes this via an ascent constant). */
  y: number;
  /** Em height in card units. */
  size: number;
  color: string;
  text: string;
  anchor: TextAnchor;
}

export interface IconShape {
  kind: "icon";
  x: number;
  y: number;
  size: number;
  color: string;
  /** Dicier ligature code (⚑10). Emitted even when unknown (D005 §3.8 †) —
   * the failed ligature is its own visible indicator. */
  code: string;
  anchor: TextAnchor;
  /** Which Dicier face draws the glyph (§3.3); `flat_dark` when omitted. */
  style: IconStyle;
}

/** Raster art from a URL (§3.3, M2). Anchored top-left like Rectangle. The
 * model carries only the resolved URL string — loading, failure, and
 * placeholder states are RENDERER-level (§3.3: not a D-code; the model stays
 * pure and per-card isolation is preserved). */
export interface ImageShape {
  kind: "image";
  x: number;
  y: number;
  /** Box width in units, or the keyword `"auto"` (§3.3): the dimension then
   * derives from the other × the art's intrinsic aspect ratio. Intrinsic
   * size is LOAD-time knowledge, so the pure model carries the keyword and
   * the renderer/exporter resolve it (square placeholder until the art
   * arrives). The checker guarantees at most ONE of width/height is "auto"
   * (both = E008), and "auto" vs a number changes the contentHash like any
   * other resolved content. */
  width: number | "auto";
  /** Box height in units, or `"auto"` — see `width`. */
  height: number | "auto";
  /** Resolved Text expression — usually a URL, possibly from a sheet column. */
  src: string;
  /** How the image maps onto the box (§3.3); `contain` when omitted. */
  fit: ImageFit;
}

/**
 * Wrapped multi-line text in a box (§3.3, M3 — §7.2). THE COMPILER IS THE
 * WRAPPING AUTHORITY: the evaluator wraps against the generated Geist
 * advance-widths table (wrap.ts / geist-metrics.ts) and the model carries the
 * RESOLVED lines — the renderer never re-wraps, so preview and PDF agree by
 * construction. `size` is the FINAL size after any `overflow: shrink` steps.
 */
export interface TextBoxShape {
  kind: "textbox";
  /** Top-left of the box, like Rectangle. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Em height in card units — the final size (≤ the declared size when
   * `shrunk`; the declared size is deliberately NOT carried, §7.2). */
  size: number;
  color: string;
  /** How each line aligns within the box's width (§3.3: a box has `align`,
   * never `anchor`); default `left`. */
  align: TextAnchor;
  /** Multiplier on `size` — baseline advance in units is lineHeight × size. */
  lineHeight: number;
  /** The resolved, wrapped lines, top to bottom. May contain empty strings
   * (blank lines from consecutive hard breaks). */
  lines: readonly string[];
  /** True when lines were dropped to fit the box's height (§3.3 clip — also
   * set after `shrink` exhausted its floor). Feeds the preview badge. */
  clipped: boolean;
  /** True when `overflow: shrink` reduced the size below the declared one.
   * Carried explicitly because the badge must fire for shrink-that-fits and
   * the shape does not carry the declared size to derive it from. */
  shrunk: boolean;
}

/** In declaration order — later shapes draw on top (◆15). */
export type Shape = RectShape | TextShape | TextBoxShape | IconShape | ImageShape;

// ---------------------------------------------------------------------------
// Cards and decks (§3.7, §4.1)
// ---------------------------------------------------------------------------

/** One loop variable's value in a card's generation context (⚑1, ◆25). */
export interface LoopCaseBinding {
  enum: string;
  case: string;
}

/** Which {row × loop-case × copy} produced this instance (§3.7). */
export interface CardMeta {
  /** 0-based index into the bound sheet's row array. */
  rowIndex: number;
  /** Loop variable → enum case, for every `loop:` of the Card. */
  loopBindings: Record<string, LoopCaseBinding>;
  /** 0-based among the `count:` copies of one row × case combination. */
  copyIndex: number;
}

export interface CardInstance {
  front: Shape[];
  back: Shape[];
  meta: CardMeta;
  /**
   * Deterministic content hash (FNV-1a) of the resolved faces + deck
   * geometry — the preview's memoization key (§4.2 †). Copies share it; any
   * resolved-value change changes it. Error placeholders hash their
   * diagnostics instead of their (empty) faces.
   */
  contentHash: string;
  /**
   * Present on error-placeholder instances (⚑8): the shape arrays are empty
   * and these diagnostics say why. Placeholder RENDERING is the renderer's
   * job (task 5) — the model only marks the card.
   */
  error?: { diagnostics: DataDiagnostic[] };
}

/** One Card declaration's generated set, in Card-declaration order. */
export interface Deck {
  cardName: string;
  widthMm: number;
  heightMm: number;
  xUnits: number;
  /** May be fractional (⚑7†: `y_units: auto` keeps units square). */
  yUnits: number;
  cards: CardInstance[];
}

export interface RenderModel {
  decks: Deck[];
}
