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
 * record (identical resolved faces, identical `contentHash`) — UNLESS a face
 * reads the built-in `[card]` binding (§3.6, ◆42), in which case that face
 * resolves independently per copy and earns its own `contentHash`. Front and
 * Back are tracked separately: a Back that never reads `[card]` keeps
 * sharing its array even when Front diverges on every copy (generate.ts).
 * Either way, consumers must treat every part of the model as immutable.
 */

// ---------------------------------------------------------------------------
// Data-time diagnostics (§3.8, ⚑8)
// ---------------------------------------------------------------------------

/**
 * D001–D011 are the §3.8 catalog. D000 is OUTSIDE the catalog by design,
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
  | "D008"
  | "D009"
  | "D010"
  /** A `{alias:name}` could not expand; the raw marker remains visible. */
  | "D011";

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
   * Present for card-scoped diagnostics (D004–D006, D008–D011, and per-card
   * D000). D007 and the model-level D000 carry neither `cell` nor `cardRef`
   * — they are deck/model-level (the message names the deck).
   */
  cardRef?: CardRef;
}

// ---------------------------------------------------------------------------
// Shapes (§3.3, §3.4)
// ---------------------------------------------------------------------------

/** The three horizontal words of TextBox `align:` (§3.3); default `left`.
 * Named for SVG's `text-anchor`, which these words realize (§3.4) — this
 * type is NOT the element `pivot:` property (renamed from `anchor:`,
 * 2026-08-13 — ◆36†), which merely borrowed the same three words pre-M3 as
 * its legacy top-row aliases. */
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
 * Text/TextBox `font:` vocabulary (§3.3, M3 — ◆41): a closed set of
 * repo-bundled faces, resolved by expected type exactly like Icon `style:`
 * (its closest stencil) — an unknown value or a non-identifier expression is
 * E008 naming this array. `geist` is the pre-existing default (unchanged
 * output when `font:` is omitted); the other eight map to two bundled
 * families — Cormorant Garamond and Courier Prime — at the four weight/style
 * combinations each ships as a static (non-variable) file:
 * `CormorantGaramond-{Regular,Bold,Italic,BoldItalic}.ttf` and
 * `CourierPrime-{Regular,Bold,Italic,BoldItalic}.ttf` under src/app/fonts/.
 *
 * PRAGMATIC UNBLOCK, NOT A FONT SYSTEM (◆41): the owner dropped these two
 * families into the repo to unblock real card designs now; a general
 * per-project uploaded-font system (the §7.1b asset-library shape, but for
 * fonts) is deliberately future work — wrapping needs a metrics table per
 * face (font-metrics.ts), and building that pipeline for arbitrary uploads
 * is a bigger project than this unblock. Closed set like ICON_STYLES/
 * IMAGE_FITS — the checker's vocabulary, the renderer's font-family map
 * (cardSvg.tsx), the wrap engine's per-face metrics (wrap.ts,
 * font-metrics.ts), and the wiki's font table (docFacts) all pin to this
 * array.
 *
 * ADDING A FACE: Cormorant Garamond ships six MORE weights in
 * src/app/fonts/CormorantGaramond/ (Light, Medium, SemiBold + their
 * italics) that are deliberately NOT exposed here — the vocabulary is
 * curated, not "every file in the folder". Exposing one is a table entry
 * here (plus the matching @font-face in globals.css and the
 * ICON_FONT_FAMILIES-style map in cardSvg.tsx) and a metrics regen
 * (`npm run generate:font-metrics`, which reads every file already listed
 * in scripts/generate-font-metrics.mjs's BUNDLED_FACES) — nothing else.
 */
export const FONT_FACES = [
  "geist",
  "garamond",
  "garamond_bold",
  "garamond_italic",
  "garamond_bold_italic",
  "courier",
  "courier_bold",
  "courier_italic",
  "courier_bold_italic",
] as const;

export type FontFace = (typeof FONT_FACES)[number];

/** §3.3: `font:` is optional; the default is `geist` — the language's
 * behavior before this property existed, so an omitted `font:` renders and
 * hashes identically to before (§3.3, ◆41). */
export const DEFAULT_FONT: FontFace = "geist";

/**
 * One inline icon reference parsed out of resolved text (§3.3, M4 — ◆44,
 * §7.5): `{HEARTS}` → dicier, `{asset:skull}` → asset. Markers are parsed at
 * EVAL time on the RESOLVED string (after interpolation), so a marker
 * arriving from a sheet cell works identically to a literal — the grammar
 * itself lives in markers.ts.
 */
export type InlineIcon =
  | { kind: "dicier"; code: string }
  | { kind: "asset"; name: string };

/**
 * One run of a laid-out text line (◆44): either a stretch of plain text or a
 * single inline icon. `x` is the run's offset in CARD UNITS from the line's
 * LEFT edge — the compiler is the layout authority (◆37 extended to mixed
 * content), so both renderers place runs absolutely and never re-measure.
 *
 * THE 1-EM SLOT (§7.5): an icon run occupies a square `size` × `size` box
 * sitting on the line's em box and advances by EXACTLY `size` — no safety
 * margin on the slot (the margin belongs to measured text, not to a width
 * that is true by construction). Wide asset art letterboxes inside the slot;
 * Dicier glyphs draw in the default `flat_dark` face. `color`, when present,
 * overrides the owning Text/TextBox color for this run; absence inherits and
 * keeps legacy models/hashes byte-identical.
 */
export type TextRun =
  | { kind: "text"; text: string; x: number; color?: string }
  | { kind: "icon"; x: number; icon: InlineIcon; color?: string };

/**
 * One resolved TextBox line (◆44): its runs plus the line's measured total
 * width in card units, carried so the renderer can realize `align:`
 * (middle/right offset the whole line) WITHOUT re-measuring — preview and
 * PDF agree by construction, exactly the `lines` contract before runs.
 */
export interface TextBoxLine {
  runs: readonly TextRun[];
  /** Measured width of the whole line in card units (text advances include
   * the wrap engine's safety margin; each icon contributes exactly `size`). */
  width: number;
}

/**
 * Local-asset scheme for Image `src:` (§7.1b, M3): `"asset:dragon"` refers to
 * an upload in the Assets drawer's IndexedDB library by name, rather than a
 * URL. Zero language change — `src:` stays a plain Text expression, so the
 * scheme is a string convention the checker (W005) and renderers (cardSvg.tsx,
 * pdfRaster.tsx) parse, not new grammar. Shared here (not in an editor/app
 * module) because both the pure checker and the renderers need it, and
 * src/lib/lang stays framework-free (CLAUDE.md code map).
 */
export const ASSET_SRC_SCHEME = "asset:";

/** The asset name in a `src:` value shaped `"asset:<name>"`, or null when the
 * value doesn't use the scheme. Pure string parsing — no validation of the
 * name itself (callers check that against their own asset library / the
 * identifier rules, §3.1). Exported for the checker and both renderers so
 * "starts with asset:" is spelled once. */
export function parseAssetSrc(src: string): string | null {
  return src.startsWith(ASSET_SRC_SCHEME) ? src.slice(ASSET_SRC_SCHEME.length) : null;
}

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

/**
 * Qr `level:` vocabulary (§7.1a): the four QR error-correction levels
 * (low → high redundancy), lowercase per the language's bare-identifier
 * convention. Closed set like IMAGE_FITS — the checker's vocabulary, the
 * qr.ts encoder's L/M/Q/H map, and the wiki's level table (docFacts) all
 * pin to this array.
 */
export const QR_LEVELS = ["l", "m", "q", "h"] as const;

export type QrLevel = (typeof QR_LEVELS)[number];

/** §7.1a: `level:` is optional; the default is medium (~15% redundancy). */
export const DEFAULT_QR_LEVEL: QrLevel = "m";

/**
 * The nine canonical `pivot:` tokens (§3.4, M3; property renamed from
 * `anchor:` 2026-08-13 — ◆36†), row-major top→bottom, vertical word first.
 * Closed set like ICON_STYLES — this array is the single source of truth:
 * the checker's E008 message, the autocomplete values, and the wiki's pivot
 * table (docFacts) all pin to it. The full ACCEPTED spelling space is wider
 * (reversed word orders, the `center` shorthand, the legacy aliases) and is
 * owned by `parsePivot` below.
 */
export const PIVOT_TOKENS = [
  "top_left",
  "top_center",
  "top_right",
  "center_left",
  "center_center",
  "center_right",
  "bottom_left",
  "bottom_center",
  "bottom_right",
] as const;

export type PivotToken = (typeof PIVOT_TOKENS)[number];

/** Horizontal component of a normalized pivot (§3.4). */
export type PivotH = "left" | "center" | "right";

/** Vertical component of a normalized pivot (§3.4). */
export type PivotV = "top" | "center" | "bottom";

/**
 * A NORMALIZED nine-point pivot (§3.4): which point of the ELEMENT ITSELF
 * the shape's x/y refer to — a sprite's pivot, not a Unity/Figma-style
 * anchor (a point on a PARENT the child aligns to; that is a distinct,
 * unbuilt, card-relative-positioning feature — §3.4/◆36†). Every spelling
 * variant (either word order, `center`, the legacy aliases) collapses to
 * this form at check time, so alias ≡ canonical everywhere downstream — the
 * contentHash included. Always construct as `{h, v}` in that key order: the
 * hash serializes with JSON.stringify, which follows construction order.
 */
export interface Pivot {
  h: PivotH;
  v: PivotV;
}

/** §3.4: `pivot:` is optional; the default is the top-left point — for
 * Text/Icon exactly the legacy `left`-alias behavior. Frozen because shapes
 * share the instance (the model is immutable by contract). */
export const DEFAULT_PIVOT: Pivot = Object.freeze({ h: "left", v: "top" });

/** `rotate:` when omitted (§3.4, ◆43) — unrotated. The wiki's shape table
 * states this default per element; docFacts pins the two together. */
export const DEFAULT_ROTATE = 0;

/**
 * Normalize one `pivot:` token (§3.4), or null when it is outside the
 * vocabulary — the checker then E008s naming PIVOT_TOKENS. Accepted, case-
 * sensitively like every bare-identifier vocabulary (`Top_Left` is E008):
 *
 * - the nine canonical tokens in EITHER word order (`center_bottom` ≡
 *   `bottom_center`): each `_`-joined word claims its axis, and a `center`
 *   word fills whichever axis the other word leaves open;
 * - `center` alone ≡ `center_center`;
 * - the legacy Text/Icon words `left | middle | right` as aliases for the
 *   top row — existing cards keep meaning exactly what they meant.
 */
export function parsePivot(token: string): Pivot | null {
  switch (token) {
    case "left":
      return { h: "left", v: "top" };
    case "middle":
      return { h: "center", v: "top" };
    case "right":
      return { h: "right", v: "top" };
    case "center":
      return { h: "center", v: "center" };
  }
  const words = token.split("_");
  if (words.length !== 2) return null;
  let h: PivotH | null = null;
  let v: PivotV | null = null;
  for (const word of words) {
    if (word === "left" || word === "right") {
      if (h !== null) return null; // two horizontal words (left_right)
      h = word;
    } else if (word === "top" || word === "bottom") {
      if (v !== null) return null; // two vertical words (top_bottom)
      v = word;
    } else if (word !== "center") {
      return null; // `middle` is only the standalone legacy alias
    }
  }
  // Any `center` word fills the axis its sibling left open; two centers
  // (center_center) fill both.
  return { h: h ?? "center", v: v ?? "center" };
}

/** §3.3; x/y name the box's `pivot` point (§3.4, default top-left). */
export interface RectShape {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  /** CSS color string (named color lower-cased, or `#hex` as written). */
  color: string;
  /** Which point of the box x/y name (§3.4); top-left when omitted. */
  pivot: Pivot;
  /** Degrees CLOCKWISE around the (x, y) pivot point (§3.4, M4 — ◆43);
   * 0 = unrotated. Paint-time only — resolved number, applied by the
   * renderer as an SVG transform; never part of layout. */
  rotate: number;
}

export interface TextShape {
  kind: "text";
  x: number;
  /** The `pivot.v` edge/center of the em box (§3.4): with `v: top` — the
   * default — the TOP, exactly as before M3. The renderer realizes the
   * baseline via an ascent constant. */
  y: number;
  /** Em height in card units. */
  size: number;
  color: string;
  /** The RESOLVED text, markers included verbatim — kept for the source
   * spelling and debugging (◆44: `runs` below is what renders). Hashing is
   * honest because `runs` is serialized into the content hash alongside
   * this — NOT because text determines runs (it doesn't: the same resolved
   * text yields different runs across literal vs computed sources, sizes,
   * and fonts). */
  text: string;
  /** The line as laid-out runs (◆44, §7.5): marker-parsed from `text` at
   * eval time, each run carrying its absolute x-offset from the line's left
   * edge. Single line, always (◆24) — no wrapping. Renderers draw THESE,
   * never re-parse `text`. */
  runs: readonly TextRun[];
  /** Nine-point (§3.4): `h` renders via SVG text-anchor, `v` via em-box
   * math. Default top-left ≡ the legacy `left` alias. */
  pivot: Pivot;
  /** Which face draws the text (§3.3, M3 — ◆41); `geist` when omitted, the
   * pre-existing default. Affects both the renderer's font-family AND (on
   * TextBox) the wrap engine's per-character advances — see wrap.ts. */
  font: FontFace;
  /** Degrees clockwise around the (x, y) pivot point (§3.4, M4 — ◆43);
   * 0 = unrotated. */
  rotate: number;
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
  /** Nine-point (§3.4), em-box semantics like TextShape's. */
  pivot: Pivot;
  /** Which Dicier face draws the glyph (§3.3); `flat_dark` when omitted. */
  style: IconStyle;
  /** Degrees clockwise around the (x, y) pivot point (§3.4, M4 — ◆43);
   * 0 = unrotated. */
  rotate: number;
}

/** Raster art from a URL (§3.3, M2). The model carries only the resolved URL
 * string — loading, failure, and placeholder states are RENDERER-level
 * (§3.3: not a D-code; the model stays pure and per-card isolation is
 * preserved). */
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
  /** Optional tint color. Omitted for the default/explicit white so legacy
   * Image models and content hashes stay byte-identical. */
  color?: string;
  /** How the image maps onto the box (§3.3); `contain` when omitted. */
  fit: ImageFit;
  /** Which point of the box x/y name (§3.4). With an `auto` dimension the
   * offset applies to the box the renderer RESOLVES at load time — the
   * square fallback box pivots on this point until the art's ratio is
   * known. */
  pivot: Pivot;
  /** Degrees clockwise around the (x, y) pivot point (§3.4, M4 — ◆43);
   * 0 = unrotated. The rotation center is (x, y) itself, so it needs no
   * load-time knowledge — an `auto` box rotates around the same point
   * before and after the art's ratio arrives. */
  rotate: number;
}

/**
 * Wrapped multi-line text in a box (§3.3, M3 — §7.2). THE COMPILER IS THE
 * WRAPPING AUTHORITY: the evaluator wraps against the generated advance-
 * widths table OF THE CHOSEN FONT (wrap.ts's metricsForFace — geist-metrics.ts
 * for the default, font-metrics.ts for the eight ◆41 faces) and the model
 * carries the RESOLVED lines — the renderer never re-wraps, so preview and
 * PDF agree by construction. `size` is the FINAL size after any
 * `overflow: shrink` steps.
 */
export interface TextBoxShape {
  kind: "textbox";
  /** The box's `pivot` point (§3.4), like Rectangle. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Em height in card units — the final size (≤ the declared size when
   * `shrunk`; the declared size is deliberately NOT carried, §7.2). */
  size: number;
  color: string;
  /** How each line aligns within the box's WIDTH (§3.3); default `left`.
   * Orthogonal to `pivot`: align places lines in the box, pivot places
   * the box on the card. */
  align: TextAnchor;
  /** Which point of the box x/y name (§3.4): the whole box moves; the
   * interior line layout is unchanged. */
  pivot: Pivot;
  /** Multiplier on `size` — baseline advance in units is lineHeight × size. */
  lineHeight: number;
  /** The resolved, wrapped lines, top to bottom — each a list of runs plus
   * its measured width (◆44: was `readonly string[]` pre-M4). May contain
   * empty lines (`runs: []`, blank lines from consecutive hard breaks). The
   * renderer aligns each line from its carried `width` and never re-wraps
   * OR re-measures. */
  lines: readonly TextBoxLine[];
  /** True when lines were dropped to fit the box's height (§3.3 clip — also
   * set after `shrink` exhausted its floor). Feeds the preview badge. */
  clipped: boolean;
  /** True when `overflow: shrink` reduced the size below the declared one.
   * Carried explicitly because the badge must fire for shrink-that-fits and
   * the shape does not carry the declared size to derive it from. */
  shrunk: boolean;
  /** Which face both wrapping (this box's own `lines`, already resolved
   * against this font's advances) and rendering use (§3.3, M3 — ◆41);
   * `geist` when omitted, the pre-existing default. */
  font: FontFace;
  /** Degrees clockwise around the (x, y) pivot point (§3.4, M4 — ◆43);
   * 0 = unrotated. Paint-time only — the box WRAPS against its unrotated
   * width (`lines` never change with the angle). */
  rotate: number;
}

/**
 * A scannable QR code from resolved Text data (§7.1a). Square and pivoted
 * like Rectangle/Image (`size` is the box's side length in units). Encoding
 * happens at EVAL time (pure, deterministic — the wrap.ts precedent): the
 * shape carries the RESOLVED module matrix, never the source data or the
 * encoding parameters, so the renderer only draws.
 */
export interface QrShape {
  kind: "qr";
  /** The box's `pivot` point (§3.4), like Rectangle. */
  x: number;
  y: number;
  /** Side length of the square box, in units. */
  size: number;
  /** Module (dark pixel) color — CSS color string; default black. */
  color: string;
  /** Fill behind the modules and the quiet zone — CSS color string; default
   * white. Contrast with `color` is what makes a code scannable, but that's
   * the card designer's job, not a diagnostic. */
  background: string;
  /** Which point of the box x/y name (§3.4); top-left when omitted. */
  pivot: Pivot;
  /** Degrees clockwise around the (x, y) pivot point (§3.4, M4 — ◆43);
   * 0 = unrotated. QR codes scan at any angle, but keeping the quiet zone
   * clear is still the designer's job. */
  rotate: number;
  /** Modules per side — one of the legal QR sizes, 21 + 4k. */
  moduleCount: number;
  /** Row-major "1" (dark) / "0" (light) string, length moduleCount². The
   * quiet zone is NOT included in this matrix — the renderer draws the
   * spec's 4-module quiet zone itself, INSIDE the declared box (§7.1a), so
   * adjacent art can never crowd a code's scan margin. */
  modules: string;
}

/** In declaration order — later shapes draw on top (◆15). */
export type Shape = RectShape | TextShape | TextBoxShape | IconShape | ImageShape | QrShape;

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
  /** 0-based physical position within the owning Card declaration/deck. */
  deckCardIndex: number;
  /** 0-based physical position across every emitted Card declaration. */
  projectCardIndex: number;
}

export interface CardInstance {
  /** `readonly` (adversarial review): count: copies SHARE this array
   * whenever this face never reads the built-in `[card]` binding (§3.6,
   * ◆42) — a stray push/splice on one instance would corrupt every sibling
   * copy in that case. When a face DOES read `[card]`, each copy gets its
   * OWN array instead (a printed run number makes them genuinely different
   * content) — Front and Back are tracked independently, so one face can
   * share while the other diverges on the same instance. Either way, the
   * immutability contract above is TypeScript-enforced, not prose-only:
   * generate.ts builds each face array once — per combination, or per copy
   * when `[card]` forces it — before any instance is constructed, and never
   * mutates one after. */
  readonly front: readonly Shape[];
  readonly back: readonly Shape[];
  /** ◆48: declared physical cells plus virtual-column results for this exact
   * generated instance. Metadata/provenance stays in `meta`/the owning Deck;
   * this record contains only user-declared CSV columns. */
  readonly exportData: Readonly<Record<string, string>>;
  meta: CardMeta;
  /**
   * Deterministic content hash (FNV-1a) of the resolved faces + deck
   * geometry — the preview's memoization key (§4.2 †) and the PDF
   * rasterizer's dedup key (pdfLayout.ts). Copies share it UNLESS a face
   * reads `[card]` (§3.6, ◆42): a copy's own printed number is genuinely
   * different resolved content, so it earns its own hash — a numbered print
   * run rasterizes N times, correctly, not once. Any other resolved-value
   * change changes the hash too. Error placeholders always share one hash
   * per failed group: they hash their diagnostics instead of their (empty)
   * faces, and a group's diagnostics are one shared array regardless of
   * which copy actually triggered them (generate.ts, MAJOR-2).
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
  /** Bound Sheet name (◆48 CSV provenance). */
  sheetName: string;
  widthMm: number;
  heightMm: number;
  xUnits: number;
  /** May be fractional (⚑7†: `y_units: auto` keeps units square). */
  yUnits: number;
  /** `readonly` (adversarial review — see CardInstance): generate.ts builds
   * each deck's cards in a local mutable array and assigns it in once. */
  readonly cards: readonly CardInstance[];
}

export interface RenderModel {
  readonly decks: readonly Deck[];
}
