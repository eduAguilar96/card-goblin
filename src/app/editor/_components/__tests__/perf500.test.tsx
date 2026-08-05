/**
 * 500-card performance validation (DESIGN.md §5 task 7 / acceptance
 * criterion "a 500-card deck stays interactive"): the full pipeline —
 * compileProject over a 500-card-scale project PLUS a static render of the
 * real preview tree — must land comfortably inside one debounce-ish budget.
 *
 * The time assertion is deliberately generous (< 2 s total) so CI noise
 * can't flake it; on a dev machine the pair runs in well under 200 ms. The
 * structural assertions document HOW the budget is met: the model really
 * contains 500+ distinct cards, while the virtualized preview mounts only a
 * windowed subset of them (§4.2 M6 — DOM size, not raw compute, is what
 * keeps the panel interactive).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { compileProject } from "@/lib/lang";
import { DEMO_PROJECT_SOURCE } from "@/lib/lang/demoProject";
import { PreviewContent } from "@/app/editor/_components/windowPreview";

/** 168 distinct edited rows × 3 suits = 504 cards, every combination with
 * its own health (1–9 hearts) and cost so faces stay DISTINCT — copies of
 * one combination would share evaluation and undersell the workload. */
const ROWS = Array.from({ length: 168 }, (_, i) => ({
  name: `Monster ${i}`,
  cost: String(i % 12),
  health: String(1 + (i % 9)),
  count: "1",
}));

describe("500-card scale (§5 acceptance)", () => {
  it("compiles and renders the preview at 504 cards in under 2 s, windowing the DOM", () => {
    const startedAt = performance.now();

    const result = compileProject(
      DEMO_PROJECT_SOURCE,
      { Monsters: ROWS },
      { Monsters: ROWS.map(() => true) },
    );
    const markup = renderToStaticMarkup(
      <PreviewContent
        lastGood={{
          model: result.model,
          dataDiagnostics: result.dataDiagnostics,
          excludedPristineRows: result.excludedPristineRows,
        }}
        isStale={false}
      />,
    );

    const elapsedMs = performance.now() - startedAt;

    // The workload is real: a clean compile with 504 distinct instances.
    expect(result.diagnostics).toEqual([]);
    expect(result.dataDiagnostics).toEqual([]);
    const cards = result.model.decks[0].cards;
    expect(cards).toHaveLength(504);
    expect(new Set(cards.map((c) => c.contentHash)).size).toBeGreaterThan(100);

    // The preview virtualizes: some cards render, far fewer than all 504
    // (the fallback viewport windows the rows; spacers carry the rest).
    const svgCount = (markup.match(/<svg/g) ?? []).length;
    expect(svgCount).toBeGreaterThan(0);
    expect(svgCount).toBeLessThan(504);
    expect(markup).toContain("504 cards");

    // The §5 budget, CI-generous.
    expect(elapsedMs).toBeLessThan(2000);
  });
});
