/**
 * Preview panel smoke tests (task 5): the full PreviewContent tree renders to
 * static markup against the REAL demo model. With no measurement available
 * (renderToStaticMarkup never runs effects) the grid's windowing uses the
 * large fallback viewport — so all 9 demo cards must be present, never a
 * blank panel (§4.2's never-blank rule).
 *
 * Both view modes are covered here. The mode is local state seeded by
 * `initialMode` (windowPreview.tsx) because this project has no interaction
 * driver: "grid" is a click in the app and a prop in these tests.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { compileProject } from "@/lib/lang";
import { DEMO_PROJECT_ROWS, DEMO_PROJECT_SOURCE } from "@/lib/lang/demoProject";
import type { LastGoodModel } from "@/app/editor/_store/editorStore";
import { PreviewContent } from "@/app/editor/_components/windowPreview";

/** The demo compiled for real; `pristine` swaps the seeded rows for two
 * never-edited empty rows (◆29: pristine = untouched AND empty) so the model
 * has decks but zero cards and a nonzero exclusion count. */
function demoLastGood(pristine = false): LastGoodModel {
  const rows = {
    Monsters: pristine ? [{}, {}] : DEMO_PROJECT_ROWS.map((row) => ({ ...row })),
  };
  const result = compileProject(DEMO_PROJECT_SOURCE, rows, {
    Monsters: rows.Monsters.map(() => !pristine),
  });
  expect(result.diagnostics).toEqual([]);
  return {
    model: result.model,
    dataDiagnostics: result.dataDiagnostics,
    excludedPristineRows: result.excludedPristineRows,
  };
}

/** CARD faces only: CardFaceSvg marks every card `role="img"`, while the
 * toolbar's icons are aria-hidden — so this can't be fooled by chrome. */
const countCards = (markup: string): number => (markup.match(/role="img"/g) ?? []).length;

describe("PreviewContent — single view (default)", () => {
  it("shows one card with the nav counter, and no zoom slider", () => {
    const markup = renderToStaticMarkup(
      <PreviewContent lastGood={demoLastGood()} isStale={false} />,
    );
    expect(countCards(markup)).toBe(1);
    // The flat counter over every card of every deck.
    expect(markup).toContain("1 / 9");
    // Caption: which deck, where in it, physical size.
    expect(markup).toContain("Monster");
    expect(markup).toContain("card 1 of 9");
    expect(markup).toContain("63.5×88.9 mm");
    // Zoom belongs to the grid view.
    expect(markup).not.toContain('type="range"');
    // Mode toggle present, single pressed.
    expect(markup).toContain('aria-label="Single card view"');
    expect(markup).toContain('aria-label="Grid view"');
    // Front/back survives the toolbar rework.
    expect(markup).toContain("Front");
    expect(markup).toContain("Back");
    // Not stale → no banner.
    expect(markup).not.toContain("showing last good result");
  });

  it("disables Previous on the first card (the ends don't wrap)", () => {
    const markup = renderToStaticMarkup(
      <PreviewContent lastGood={demoLastGood()} isStale={false} />,
    );
    // The `disabled=""` ATTRIBUTE, not the string — the buttons also carry
    // Tailwind `disabled:` classes, which would match a naive search. Slice
    // whole `<button …>` tags: attribute order follows the JSX, so starting
    // at the aria-label would cut `disabled` off.
    const attributesOf = (label: string): string => {
      const tag = markup
        .split("<button")
        .find((segment) => segment.includes(`aria-label="${label}"`));
      expect(tag).toBeDefined();
      return (tag ?? "").slice(0, tag?.indexOf(">"));
    };
    expect(attributesOf("Previous card")).toContain('disabled=""');
    expect(attributesOf("Next card")).not.toContain('disabled=""');
  });

  it("shows the stale banner while the current compile is broken", () => {
    const markup = renderToStaticMarkup(
      <PreviewContent lastGood={demoLastGood()} isStale={true} />,
    );
    expect(markup).toContain("showing last good result — fix errors to update");
    expect(countCards(markup)).toBe(1); // last good keeps rendering
  });

  it("the toolbar wraps instead of clipping at narrow panel widths — Export PDF always renders (item 1)", () => {
    // Regression: the toolbar used to be a single non-wrapping flex line
    // inside the panel's overflow-hidden, so narrow panels (dragging the
    // divider on any monitor) cut off Back / the grid-view toggle / Export
    // PDF with no way to reach them. `flex-wrap` lets every control reflow
    // instead. Real reflow is a browser layout behavior renderToStaticMarkup
    // can't exercise (no layout engine) — this pins the structural
    // contract (the toolbar CAN wrap) and that Export PDF is unconditionally
    // in the markup, not something that can vanish behind a clip.
    const markup = renderToStaticMarkup(
      <PreviewContent lastGood={demoLastGood()} isStale={false} />,
    );
    expect(markup).toContain(
      'class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-700 bg-gray-800 px-3 py-2"',
    );
    expect(markup).toContain("Export PDF");
  });
});

describe("PreviewContent — grid view", () => {
  it("renders all 9 demo card SVGs via the no-measurement fallback", () => {
    const markup = renderToStaticMarkup(
      <PreviewContent lastGood={demoLastGood()} isStale={false} initialMode="grid" />,
    );
    expect(countCards(markup)).toBe(9);
    // Deck section header with instance count. (The status line moved to the
    // editor-wide StatusBar in task 7 — statusBar.test.tsx covers it.)
    expect(markup).toContain("Monster");
    expect(markup).toContain("9 cards");
    // Zoom is the grid's control; the single view's nav is absent.
    expect(markup).toContain('type="range"');
    expect(markup).not.toContain("1 / 9");
    expect(markup).not.toContain('aria-label="Next card"');
  });
});

describe("PreviewContent — empty states", () => {
  it("no model yet (first compile bad)", () => {
    const markup = renderToStaticMarkup(<PreviewContent lastGood={null} isStale={true} />);
    expect(markup).toContain("No cards yet — waiting for the first good compile.");
    expect(countCards(markup)).toBe(0);
    // Nothing to navigate: no counter, no dead prev/next buttons.
    expect(markup).not.toContain('aria-label="Next card"');
    expect(markup).not.toContain("0 / 0");
  });

  it("zero cards when every row is pristine", () => {
    const markup = renderToStaticMarkup(
      <PreviewContent lastGood={demoLastGood(true)} isStale={false} />,
    );
    expect(countCards(markup)).toBe(0);
    expect(markup).toContain("No cards to show");
    expect(markup).not.toContain('aria-label="Next card"');
  });
});
