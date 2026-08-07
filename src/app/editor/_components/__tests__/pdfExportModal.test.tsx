/**
 * The export modal's page preview (§6.1 †): the modal must show the pages the
 * CURRENT options produce, and say so honestly when there are none. The
 * options themselves are §6.1 spec text and are covered by pdfLayout's tests;
 * what is new here is the preview column and its page stepper.
 *
 * Static markup only — the modal's interactions (changing an option, paging)
 * have no driver in this project, so the pure parts they lean on are tested
 * directly instead: pdfLayout (geometry), pdfPagePreview (drawing), pager
 * (clamping and end states).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { compileProject, type RenderModel } from "@/lib/lang";
import { DEMO_PROJECT_ROWS, DEMO_PROJECT_SOURCE } from "@/lib/lang/demoProject";
import {
  PdfExportModal,
  resetSessionPdfOptions,
} from "@/app/editor/_components/pdfExportModal";

/** The demo model; `broken` puts garbage in every `cost` cell so every card
 * becomes an error placeholder (D001) — the nothing-to-print state. */
function demoModel(broken = false): RenderModel {
  const rows = {
    Monsters: DEMO_PROJECT_ROWS.map((row) => ({
      ...row,
      ...(broken ? { cost: "abc" } : {}),
    })),
  };
  const result = compileProject(DEMO_PROJECT_SOURCE, rows, {
    Monsters: rows.Monsters.map(() => true),
  });
  expect(result.diagnostics).toEqual([]);
  return result.model;
}

const render = (model: RenderModel): string =>
  renderToStaticMarkup(<PdfExportModal model={model} onClose={() => {}} />);

describe("PdfExportModal — page preview", () => {
  beforeEach(resetSessionPdfOptions);

  it("previews page 1 of the export with its deck, side, and card count", () => {
    const markup = render(demoModel());
    // 9 demo cards at 6 per Letter page, duplex → front, back, front, back.
    expect(markup).toContain("1 / 4");
    expect(markup).toContain("Monster");
    expect(markup).toContain("Front");
    expect(markup).toContain("6 cards");
    // The page itself is drawn (pdfPagePreview's labelled svg), with real
    // card content on it.
    expect(markup).toContain('aria-label="Page preview: Monster, front, 6 cards"');
    expect(markup).toContain("Dragon");
    // And it is pageable.
    expect(markup).toContain('aria-label="Next page"');
  });

  it("says there is nothing to lay out when every card is an error placeholder", () => {
    const markup = render(demoModel(true));
    expect(markup).toContain("No pages to lay out");
    expect(markup).toContain("Nothing to export — every card is an error placeholder.");
    // No empty page frame, and no stepper for zero pages.
    expect(markup).not.toContain("aria-label=\"Page preview");
    expect(markup).not.toContain('aria-label="Next page"');
  });
});
