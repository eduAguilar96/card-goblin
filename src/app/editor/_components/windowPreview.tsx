"use client";

/**
 * The preview window (DESIGN.md §4.2, task 5). Two view modes over the same
 * model, with a global front/back toggle and the stale banner:
 *
 * - **single** (DEFAULT) — one card, fitted to the panel, with `[<] n/X [>]`
 *   nav across every card of every deck. Designing a card means looking at
 *   ONE card; the grid is for surveying the deck, so the single view opens.
 * - **grid** — the virtualized grid of CardSVGs grouped by Card block, with
 *   the zoom slider.
 *
 * The zoom slider belongs to the grid and renders only there: single view
 * sizes the card to the panel (previewSingle.singleCardWidthPx), which is
 * what makes it worth switching to. The mode-specific control simply swaps.
 *
 * (The status line moved to the editor-wide StatusBar in task 7 —
 * statusBar.tsx / panelLayout.tsx.)
 *
 * Store contract: reads `lastGoodModel` + `isStale` ONLY (keep-last-good —
 * never `compile.model`, which may come from a broken compile). The model is
 * shared and immutable: derive, never mutate.
 *
 * Split: `WindowPreview` is the thin store subscription; `PreviewContent`
 * (exported for tests) is the whole real tree and takes the store surface as
 * props, so tests can drive it with a model compiled directly from the demo
 * seed — zustand's server snapshot is the store's pre-compile initial state,
 * so the store-connected component SSRs to the empty state and hydrates into
 * the seeded model on the client.
 *
 * Measurement: the scroll container's size comes from a ResizeObserver; until
 * it reports (SSR, first client paint, tests), FALLBACK_VIEWPORT stands in —
 * a large default so the windowing renders real content, never a blank panel
 * (§4.2's never-blank rule; documented on visibleRange too).
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  useEditorStore,
  type LastGoodModel,
} from "@/app/editor/_store/editorStore";
import { CardSVG } from "@/app/editor/_components/cardSvg";
import DeckSection, { type CardSide } from "@/app/editor/_components/deckSection";
import ExportPdfButton from "@/app/editor/_components/pdfExportModal";
import {
  clampIndex,
  locateCard,
  singleCardWidthPx,
  totalCardCount,
  SINGLE_CAPTION_PX,
  type LocatedCard,
  type PreviewMode,
} from "@/app/editor/_components/previewSingle";
import { layoutDecks } from "@/app/editor/_components/previewVirtual";

/** Zoom = card width in px (SVG scales freely via viewBox). */
const ZOOM_MIN_PX = 100;
const ZOOM_MAX_PX = 400;
const ZOOM_STEP_PX = 1;
const ZOOM_DEFAULT_PX = 220;

/** Scroll container content padding (matches `p-4`). The windowing math
 * ignores it; OVERSCAN_ROWS absorbs the ≤16 px row-boundary shift. */
const CONTENT_PADDING_PX = 16;

/** No-measurement fallback (SSR/tests/first paint): a generous viewport so
 * content renders immediately; the ResizeObserver corrects it on mount. */
const FALLBACK_VIEWPORT = { width: 960, height: 8000 } as const;

export default function WindowPreview(): ReactElement {
  const lastGood = useEditorStore((s) => s.lastGoodModel);
  const isStale = useEditorStore((s) => s.isStale);
  return <PreviewContent lastGood={lastGood} isStale={isStale} />;
}

export interface PreviewContentProps {
  lastGood: LastGoodModel | null;
  isStale: boolean;
  /** Seeds the (local) view mode. Exists because the mode is a click away
   * and there is no interaction driver in this project's tests — static-
   * markup tests pass "grid" to exercise the virtualized tree. Real usage
   * takes the default. */
  initialMode?: PreviewMode;
}

export function PreviewContent({
  lastGood,
  isStale,
  initialMode = "single",
}: PreviewContentProps): ReactElement {
  const [side, setSide] = useState<CardSide>("front");
  const [mode, setMode] = useState<PreviewMode>(initialMode);
  const [cardW, setCardW] = useState(ZOOM_DEFAULT_PX);
  // The single view's position. Never clamped in state — clamping happens at
  // render (see `index` below), so a shrinking model doesn't erase where the
  // user was.
  const [cardIndex, setCardIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Measure the scroll container; keep measuring as the resizable panels
  // move. The container exists in every state (empty states render inside
  // it), so this effect never has to re-attach.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = (): void =>
      setViewport({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Identity-stable decks list — layoutDecks memoizes on it.
  const decks = useMemo(() => lastGood?.model.decks ?? [], [lastGood]);
  const totalCards = totalCardCount(decks);

  const viewportW = viewport?.width ?? FALLBACK_VIEWPORT.width;
  const viewportH = viewport?.height ?? FALLBACK_VIEWPORT.height;
  const contentW = Math.max(0, viewportW - 2 * CONTENT_PADDING_PX);
  const layouts = useMemo(
    () => layoutDecks(decks, contentW, cardW),
    [decks, contentW, cardW],
  );

  const single = mode === "single";
  // Clamped for THIS render only (previewSingle.clampIndex): the state keeps
  // the user's place if a recompile temporarily shrinks the model.
  const index = clampIndex(cardIndex, totalCards);
  const located = single ? locateCard(decks, index) : null;

  const goTo = (next: number): void => setCardIndex(clampIndex(next, totalCards));
  const switchMode = (next: PreviewMode): void => {
    if (next === mode) return;
    // The container stops scrolling in single view, so the browser clamps its
    // scrollTop to 0. Mirror that in state or the grid, on return, would
    // window rows for a scroll position the DOM no longer has — and render
    // its spacer where the cards should be.
    setScrollTop(0);
    setMode(next);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-900 text-sm text-gray-200">
      {/* Toolbar: front/back, view mode, then the mode's own control —
          nav in single view, zoom in grid view (§4.2). */}
      <div className="flex shrink-0 items-center gap-4 border-b border-gray-700 bg-gray-800 px-3 py-2">
        <div className="inline-flex overflow-hidden rounded border border-gray-600 text-xs">
          {(["front", "back"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              aria-pressed={side === s}
              className={
                side === s
                  ? "bg-gray-600 px-3 py-1 font-semibold text-white"
                  : "bg-gray-800 px-3 py-1 text-gray-300 hover:bg-gray-700"
              }
            >
              {s === "front" ? "Front" : "Back"}
            </button>
          ))}
        </div>
        {/* View mode — same segmented style as Front/Back, icon-only (the
            labels live in aria-label/title). */}
        <div className="inline-flex overflow-hidden rounded border border-gray-600 text-xs">
          <SegmentedIconButton
            label="Single card view"
            pressed={single}
            onClick={() => switchMode("single")}
          >
            <IconSingle />
          </SegmentedIconButton>
          <SegmentedIconButton
            label="Grid view"
            pressed={!single}
            onClick={() => switchMode("grid")}
          >
            <IconGrid />
          </SegmentedIconButton>
        </div>
        {single ? (
          totalCards > 0 && (
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <NavButton
                label="Previous card"
                disabled={index <= 0}
                onClick={() => goTo(index - 1)}
              >
                <IconChevron direction="left" />
              </NavButton>
              {/* Polite: the counter is the only feedback that prev/next
                  did anything for a screen-reader user. */}
              <span aria-live="polite" className="min-w-16 text-center tabular-nums">
                {index + 1} / {totalCards}
              </span>
              <NavButton
                label="Next card"
                disabled={index >= totalCards - 1}
                onClick={() => goTo(index + 1)}
              >
                <IconChevron direction="right" />
              </NavButton>
            </div>
          )
        ) : (
          <label className="flex items-center gap-2 text-xs text-gray-400">
            Zoom
            <input
              type="range"
              min={ZOOM_MIN_PX}
              max={ZOOM_MAX_PX}
              step={ZOOM_STEP_PX}
              value={cardW}
              onChange={(e) => setCardW(Number(e.currentTarget.value))}
              aria-label="Card width"
              className="w-32 accent-gray-400"
            />
          </label>
        )}
        {/* M2 §6.1: export lives in the preview toolbar — it prints what the
            preview shows (see pdfExportModal.tsx for the placement note). */}
        <div className="ml-auto">
          <ExportPdfButton />
        </div>
      </div>

      {isStale && (
        <div className="shrink-0 border-b border-amber-900 bg-amber-950 px-3 py-1 text-xs text-amber-300">
          showing last good result — fix errors to update
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        // Single view fits its card to this box, so it never scrolls; the
        // grid does. Same element either way — the ResizeObserver above
        // attaches once and keeps measuring across mode switches.
        className={`min-h-0 flex-1 p-4 ${single ? "overflow-hidden" : "overflow-y-auto"}`}
      >
        {lastGood === null ? (
          <div className="text-gray-400">
            No cards yet — waiting for the first good compile.
          </div>
        ) : totalCards === 0 ? (
          <div className="text-gray-400">
            No cards to show — every sheet row is pristine or the sheets are
            empty. Type into a row to generate cards.
          </div>
        ) : single ? (
          located !== null && (
            <SingleCard
              located={located}
              side={side}
              viewportW={viewportW}
              viewportH={viewportH}
            />
          )
        ) : (
          decks.map((deck, deckIndex) => (
            <DeckSection
              key={deckIndex}
              deck={deck}
              side={side}
              cardW={cardW}
              layout={layouts[deckIndex]}
              scrollTop={scrollTop}
              viewportH={viewportH}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single-card view
// ---------------------------------------------------------------------------

interface SingleCardProps {
  located: LocatedCard;
  side: CardSide;
  viewportW: number;
  viewportH: number;
}

/** The card, centered and fitted, under a caption naming where it comes from
 * (the flat `n / X` counter can't say which deck you're in — this can). */
function SingleCard({ located, side, viewportW, viewportH }: SingleCardProps): ReactElement {
  const { deck, card, cardIndex } = located;
  const width = singleCardWidthPx(viewportW, viewportH, deck.widthMm, deck.heightMm);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <div
        className="shrink-0 text-xs text-gray-400"
        style={{ height: SINGLE_CAPTION_PX, lineHeight: `${SINGLE_CAPTION_PX}px` }}
      >
        <span className="font-semibold text-gray-200">{deck.cardName}</span>
        {" · "}card {cardIndex + 1} of {deck.cards.length}
        {" · "}
        {deck.widthMm}×{deck.heightMm} mm
      </div>
      <div style={{ width }}>
        <CardSVG
          // Keyed on the side for the same reason deckSection.tsx is: the
          // memo comparator sees one contentHash covering BOTH faces, so a
          // front↔back switch has to remount.
          key={side}
          xUnits={deck.xUnits}
          yUnits={deck.yUnits}
          widthMm={deck.widthMm}
          heightMm={deck.heightMm}
          face={side === "front" ? card.front : card.back}
          contentHash={card.contentHash}
          error={card.error}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar bits
// ---------------------------------------------------------------------------

interface SegmentedIconButtonProps {
  /** Accessible name AND tooltip — these buttons are icon-only. */
  label: string;
  pressed: boolean;
  onClick(): void;
  children: ReactElement;
}

/** One segment of the view-mode toggle: the Front/Back button's styling with
 * an icon instead of a word. */
function SegmentedIconButton({
  label,
  pressed,
  onClick,
  children,
}: SegmentedIconButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={
        pressed
          ? "flex items-center bg-gray-600 px-3 py-1.5 text-white"
          : "flex items-center bg-gray-800 px-3 py-1.5 text-gray-300 hover:bg-gray-700"
      }
    >
      {children}
    </button>
  );
}

interface NavButtonProps {
  label: string;
  disabled: boolean;
  onClick(): void;
  children: ReactElement;
}

/** Prev/next. Disabled at the ends rather than wrapping: with `n / X` on
 * screen, a jump from 18/18 back to 1/18 reads as a glitch. */
function NavButton({ label, disabled, onClick, children }: NavButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex items-center rounded border border-gray-600 bg-gray-800 px-1.5 py-1 text-gray-300 hover:bg-gray-700 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-gray-800"
    >
      {children}
    </button>
  );
}

/** Icons are hand-drawn inline SVG — the project has no icon dependency, and
 * three 16-unit glyphs don't justify one. `currentColor` throughout, so they
 * inherit the pressed/hover text colors above. */
function IconSingle(): ReactElement {
  return (
    <IconBox>
      {/* A card, not a plain square: portrait with rounded corners. */}
      <rect x="4.75" y="2.75" width="6.5" height="10.5" rx="1.5" />
    </IconBox>
  );
}

function IconGrid(): ReactElement {
  return (
    <IconBox>
      {[2.75, 8.75].map((y) =>
        [2.75, 8.75].map((x) => (
          <rect key={`${x},${y}`} x={x} y={y} width="4.5" height="4.5" rx="1" />
        )),
      )}
    </IconBox>
  );
}

function IconChevron({ direction }: { direction: "left" | "right" }): ReactElement {
  return (
    <IconBox>
      <path
        d={direction === "left" ? "M10 3.5 L5.5 8 L10 12.5" : "M6 3.5 L10.5 8 L6 12.5"}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBox>
  );
}

/** Shared 16×16 icon frame: stroked, unfilled, decorative (the button owns
 * the accessible name). */
function IconBox({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {children}
    </svg>
  );
}
