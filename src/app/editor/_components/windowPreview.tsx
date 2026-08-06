"use client";

/**
 * The preview window (DESIGN.md §4.2, task 5): a virtualized grid of CardSVGs
 * grouped by Card block, with a global front/back toggle, a zoom control, and
 * the stale banner. (The status line moved to the editor-wide StatusBar in
 * task 7 — statusBar.tsx / panelLayout.tsx.)
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

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  useEditorStore,
  type LastGoodModel,
} from "@/app/editor/_store/editorStore";
import DeckSection, { type CardSide } from "@/app/editor/_components/deckSection";
import ExportPdfButton from "@/app/editor/_components/pdfExportModal";
import { layoutDecks } from "@/app/editor/_components/previewVirtual";

/** Zoom = card width in px (SVG scales freely via viewBox). */
const ZOOM_MIN_PX = 100;
const ZOOM_MAX_PX = 400;
const ZOOM_STEP_PX = 20;
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
}

export function PreviewContent({ lastGood, isStale }: PreviewContentProps): ReactElement {
  const [side, setSide] = useState<CardSide>("front");
  const [cardW, setCardW] = useState(ZOOM_DEFAULT_PX);
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
  const totalCards = decks.reduce((n, deck) => n + deck.cards.length, 0);

  const viewportW = viewport?.width ?? FALLBACK_VIEWPORT.width;
  const viewportH = viewport?.height ?? FALLBACK_VIEWPORT.height;
  const contentW = Math.max(0, viewportW - 2 * CONTENT_PADDING_PX);
  const layouts = useMemo(
    () => layoutDecks(decks, contentW, cardW),
    [decks, contentW, cardW],
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-900 text-sm text-gray-200">
      {/* Toolbar: global front/back toggle + zoom (§4.2). */}
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
        className="min-h-0 flex-1 overflow-y-auto p-4"
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
