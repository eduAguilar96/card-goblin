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
import { ResetToDemoButton, StatusBarContent } from "@/app/editor/_components/statusBar";

function renderState(state: EditorState): string {
  return renderToStaticMarkup(
    <StatusBarContent
      compile={state.compile}
      lastGood={state.lastGoodModel}
      isStale={state.isStale}
      autosaveDisabled={state.autosaveDisabled}
      onReset={() => {}}
      onExportProject={() => {}}
      onImportProject={() => {}}
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
    expect(text).not.toContain("autosave off"); // storage healthy → no indicator
  });

  it("carries the §7.1 project-file pair in the right-hand group", () => {
    const text = stripTags(renderState(createEditorStore().getState()));
    expect(text).toContain("Export project");
    expect(text).toContain("Import project");
    expect(text).toContain("Reset to demo"); // beside reset, per the spec
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
        <StatusBarContent
          compile={null}
          lastGood={null}
          isStale={false}
          autosaveDisabled={false}
          onReset={() => {}}
          onExportProject={() => {}}
          onImportProject={() => {}}
        />,
      ),
    );
    expect(text).toContain("0 cards");
    expect(text).toContain("0 problems");
  });

  it("shows the quiet 'autosave off' indicator when storage failed this session (§6.2)", () => {
    const store = createEditorStore();
    store.setState({ autosaveDisabled: true }); // as persistence.ts does
    const markup = renderState(store.getState());
    expect(stripTags(markup)).toContain("autosave off");
    expect(markup).toContain("won&#x27;t survive a reload"); // the title explains it
  });
});

describe("StatusBarContent — never-clip action group (adversarial review item 2)", () => {
  // Regression: the whole bar used to be ONE `overflow-hidden whitespace-
  // nowrap` line, so at ~1000px with the stale + autosave-off indicators on,
  // Reset to demo / Export / Import — and an armed confirm's answer buttons
  // — got clipped out of view along with the counters. Real reflow is a
  // browser layout behavior renderToStaticMarkup can't exercise (no layout
  // engine); these pin the structural contract instead.
  it("the outer bar carries no overflow-hidden — that clipped everything, buttons included", () => {
    const markup = renderState(createEditorStore().getState());
    const barTag = markup.slice(0, markup.indexOf(">") + 1);
    expect(barTag).not.toContain("overflow-hidden");
    expect(barTag).toContain("flex-wrap");
  });

  it("only the low-priority counters are scoped to clip (min-w-0 + overflow-hidden)", () => {
    const markup = renderState(createEditorStore().getState());
    expect(markup).toContain(
      'class="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap"',
    );
  });

  it("the action group (Assets/Export/Import/Reset) wraps instead of clipping", () => {
    const markup = renderState(createEditorStore().getState());
    expect(markup).toContain('class="ml-auto flex flex-wrap items-center gap-3"');
  });

  it("an armed Reset confirm's answer buttons live in a wrapping group, not a rigid line", () => {
    const markup = renderToStaticMarkup(
      <ResetToDemoButton onReset={() => {}} initialConfirming />,
    );
    expect(markup).toContain('class="flex flex-wrap items-center gap-1.5"');
    // Still says what it says — the restructure didn't drop content.
    expect(stripTags(markup)).toContain("Replace your project (and your uploaded assets)");
  });
});

describe("ResetToDemoButton (§6.2 two-step confirm)", () => {
  it("rests as a single quiet button — no destructive control visible", () => {
    const markup = renderToStaticMarkup(<ResetToDemoButton onReset={() => {}} />);
    const text = stripTags(markup);
    expect(text).toContain("Reset to demo");
    expect(text).not.toContain("Replace your project");
    // The armed state's destructive styling is nowhere in the resting state.
    expect(markup).not.toContain("text-red-400");
  });

  it("armed (test seam): asks the question and offers Reset / Keep", () => {
    const markup = renderToStaticMarkup(
      <ResetToDemoButton onReset={() => {}} initialConfirming />,
    );
    const text = stripTags(markup);
    expect(text).toContain("Replace your project (and your uploaded assets) with the demo?");
    expect(text).toContain("Reset");
    expect(text).toContain("Keep");
    expect(markup).toContain("text-red-400"); // the destructive click is marked
  });
});
