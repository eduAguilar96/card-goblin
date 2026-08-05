/**
 * Preview panel smoke tests (task 5): the full PreviewContent tree renders to
 * static markup against the REAL demo model. With no measurement available
 * (renderToStaticMarkup never runs effects) the windowing uses the large
 * fallback viewport — so all 9 demo cards must be present, never a blank
 * panel (§4.2's never-blank rule).
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

const countSvgs = (markup: string): number => (markup.match(/<svg/g) ?? []).length;

describe("PreviewContent (demo model)", () => {
  it("renders all 9 demo card SVGs via the no-measurement fallback", () => {
    const markup = renderToStaticMarkup(
      <PreviewContent lastGood={demoLastGood()} isStale={false} />,
    );
    expect(countSvgs(markup)).toBe(9);
    // Deck section header with instance count. (The status line moved to the
    // editor-wide StatusBar in task 7 — statusBar.test.tsx covers it.)
    expect(markup).toContain("Monster");
    expect(markup).toContain("9 cards");
    // Toolbar controls exist.
    expect(markup).toContain("Front");
    expect(markup).toContain("Back");
    expect(markup).toContain('type="range"');
    // Not stale → no banner.
    expect(markup).not.toContain("showing last good result");
  });

  it("shows the stale banner while the current compile is broken", () => {
    const markup = renderToStaticMarkup(
      <PreviewContent lastGood={demoLastGood()} isStale={true} />,
    );
    expect(markup).toContain("showing last good result — fix errors to update");
    expect(countSvgs(markup)).toBe(9); // last good keeps rendering
  });

  it("empty state: no model yet (first compile bad)", () => {
    const markup = renderToStaticMarkup(<PreviewContent lastGood={null} isStale={true} />);
    expect(markup).toContain("No cards yet — waiting for the first good compile.");
    expect(countSvgs(markup)).toBe(0);
  });

  it("empty state: zero cards when every row is pristine", () => {
    const markup = renderToStaticMarkup(
      <PreviewContent lastGood={demoLastGood(true)} isStale={false} />,
    );
    expect(countSvgs(markup)).toBe(0);
    expect(markup).toContain("No cards to show");
  });
});
