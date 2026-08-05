/**
 * Unified status bar (task 7, grid MINOR-2): one compact line — cards /
 * compile problems / flagged cells / excluded pristine rows / the stale
 * indicator — rendered to static markup against REAL compiles through a
 * headless editor store (same approach as the other window tests).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEMO_PROJECT_SOURCE } from "@/lib/lang/demoProject";
import { createEditorStore, type EditorState } from "@/app/editor/_store/editorStore";
import { StatusBarContent } from "@/app/editor/_components/statusBar";

function renderState(state: EditorState): string {
  return renderToStaticMarkup(
    <StatusBarContent
      compile={state.compile}
      lastGood={state.lastGoodModel}
      isStale={state.isStale}
    />,
  );
}

const stripTags = (markup: string): string => markup.replace(/<[^>]+>/g, "");

describe("StatusBarContent", () => {
  it("clean seeded demo: 9 cards, zero problems/flags/exclusions, no stale indicator", () => {
    const text = stripTags(renderState(createEditorStore().getState()));
    expect(text).toContain("9 cards");
    expect(text).toContain("0 problems");
    expect(text).toContain("0 flagged cells");
    expect(text).toContain("0 pristine rows excluded");
    expect(text).not.toContain("stale");
  });

  it("broken compile: problems counted red, cards hold the LAST GOOD count, stale indicator on", () => {
    const store = createEditorStore();
    store.getState().setCode(DEMO_PROJECT_SOURCE + "\nCard: (((\n");
    store.getState().flushCompile();
    const markup = renderState(store.getState());
    const text = stripTags(markup);
    expect(text).toContain("9 cards"); // keep-last-good — what the preview shows
    const problems = store.getState().compile?.diagnostics.length ?? 0;
    expect(problems).toBeGreaterThan(0); // the LIVE compile's errors count…
    expect(text).toContain(`${problems} problem`); // …is what the bar shows
    expect(markup).toContain("text-red-400");
    expect(text).toContain("show last good state"); // the stale affordance
  });

  it("warnings alone count as problems (amber), without staleness", () => {
    const store = createEditorStore();
    store.getState().setCode(DEMO_PROJECT_SOURCE + "\nEnum: Unused\n  case Only\n"); // W002
    store.getState().flushCompile();
    const markup = renderState(store.getState());
    expect(stripTags(markup)).toContain("1 problem");
    expect(markup).toContain("text-amber-400");
    expect(stripTags(markup)).not.toContain("stale");
  });

  it("a garbage Number cell counts as ONE flagged cell (distinct cells, like the grid)", () => {
    const store = createEditorStore();
    store.getState().setCell("Monsters", 0, "health", "garbage");
    store.getState().flushCompile();
    const markup = renderState(store.getState());
    expect(stripTags(markup)).toContain("1 flagged cell");
    expect(markup).toContain("text-red-400");
  });

  it("an added pristine row shows in the exclusion count immediately (sync row ops)", () => {
    const store = createEditorStore();
    store.getState().addRow("Monsters");
    // No flush — row ops recompile synchronously (MAJOR-1).
    expect(stripTags(renderState(store.getState()))).toContain("1 pristine row excluded");
  });

  it("renders sanely before any compile (all-null store surface)", () => {
    const text = stripTags(
      renderToStaticMarkup(
        <StatusBarContent compile={null} lastGood={null} isStale={false} />,
      ),
    );
    expect(text).toContain("0 cards");
    expect(text).toContain("0 problems");
  });
});
