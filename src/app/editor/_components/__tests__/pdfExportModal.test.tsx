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
  INVALID_MM_MESSAGE,
  PdfExportModal,
  imageEmbedWarning,
  resetSessionPdfOptions,
} from "@/app/editor/_components/pdfExportModal";

/** The demo model; `breakRows` puts garbage in `cost` cells so those rows'
 * cards become error placeholders (D001): "all" is the nothing-to-print
 * state, "first" the some-skipped state (row 0 = Dragon → 6 of 9 cards). */
function demoModel(breakRows: "none" | "first" | "all" = "none"): RenderModel {
  const rows = {
    Monsters: DEMO_PROJECT_ROWS.map((row, i) => ({
      ...row,
      ...(breakRows === "all" || (breakRows === "first" && i === 0)
        ? { cost: "abc" }
        : {}),
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

  it("warns how many cards are skipped while keeping Export enabled (§6.1)", () => {
    // Some-but-not-all skipped: the warning must show AND the export must
    // still be possible — 3 printable cards remain.
    const markup = render(demoModel("first"));
    expect(markup).toContain("6 cards with errors will be skipped.");
    // The rendered ATTRIBUTE is `disabled=""` — plain "disabled" would also
    // match the Tailwind `disabled:` variant classes.
    const exportButton = /<button[^>]*>Export<\/button>/.exec(markup)?.[0];
    expect(exportButton).toBeDefined();
    expect(exportButton).not.toContain('disabled=""');
    // Contrast (guards the regex above against vacuous passes): with EVERY
    // card skipped the same control is disabled.
    const blocked = /<button[^>]*>Export<\/button>/.exec(render(demoModel("all")))?.[0];
    expect(blocked).toContain('disabled=""');
  });

  it("is an accessible dialog: role, aria-modal, labelled title, focusable", () => {
    // Static half of the a11y contract; focus/Escape/Tab behavior runs in
    // effects and handlers that renderToStaticMarkup never executes (module
    // note in pdfExportModal.tsx — manual browser checklist).
    const markup = render(demoModel());
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="pdf-export-title"');
    expect(markup).toContain('id="pdf-export-title"');
    expect(markup).toContain('tabindex="-1"'); // dialog is focusable on open
  });

  it("says there is nothing to lay out when every card is an error placeholder", () => {
    const markup = render(demoModel("all"));
    expect(markup).toContain("No pages to lay out");
    expect(markup).toContain("Nothing to export — every card is an error placeholder.");
    // No empty page frame, and no stepper for zero pages.
    expect(markup).not.toContain("aria-label=\"Page preview");
    expect(markup).not.toContain('aria-label="Next page"');
  });
});

/** A one-card model whose face draws an Image (§3.3 M2) — the pre-flight case. */
function imageModel(): RenderModel {
  const result = compileProject(
    [
      "Sheet: S",
      "  column name: Text",
      "Template: T",
      "  Image:",
      "    x: 0",
      "    y: 0",
      "    width: 10",
      "    height: 10",
      '    src: "https://example.com/[name].png"',
      "Card: Art",
      "  sheet: S",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: T",
    ].join("\n") + "\n",
    { S: [{ name: "a" }] },
    { S: [true] },
  );
  expect(result.diagnostics).toEqual([]);
  return result.model;
}

/** A one-card model with BOTH a remote Image and an `asset:` Image (§7.1b) —
 * the M2 adversarial case for the pre-flight's "Checking…" count. */
function mixedImageModel(): RenderModel {
  const result = compileProject(
    [
      "Sheet: S",
      "  column name: Text",
      "Template: T",
      "  Image:",
      "    x: 0",
      "    y: 0",
      "    width: 10",
      "    height: 10",
      '    src: "https://example.com/[name].png"',
      "  Image:",
      "    x: 0",
      "    y: 10",
      "    width: 10",
      "    height: 10",
      '    src: "asset:dragon"',
      "Card: Art",
      "  sheet: S",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: T",
    ].join("\n") + "\n",
    { S: [{ name: "a" }] },
    { S: [true] },
  );
  expect(result.diagnostics).toEqual([]);
  return result.model;
}

describe("PdfExportModal — image pre-flight (§3.3 M2)", () => {
  beforeEach(resetSessionPdfOptions);

  it("holds Export and says so while the deck's image URLs are being checked", () => {
    // Static markup runs no effects, so this IS the modal's opening state:
    // the probe hasn't settled, the status notice shows, Export is held.
    // The probe's completion (warning counts, unblocking) has no driver here
    // — manual browser checklist; the pure pieces are imageUrlsUsed and
    // imageEmbedWarning.
    const markup = render(imageModel());
    expect(markup).toContain("Checking 1 image…");
    const exportButton = /<button[^>]*>Export<\/button>/.exec(markup)?.[0];
    expect(exportButton).toContain('disabled=""');
  });

  it("a model without images skips the pre-flight entirely", () => {
    const markup = render(demoModel());
    expect(markup).not.toContain("Checking");
    expect(markup).not.toContain("could not be embedded");
  });

  it("§7.1b M2: 'Checking…' counts only REMOTE sources — asset: never needs the CORS pre-flight", () => {
    // Two image shapes: one remote URL, one asset: reference. A modal that
    // reverted to counting the FULL imageUrlsUsed list (asset included)
    // would say "Checking 2 images…"; wired to remoteImageUrlsUsed it says
    // 1 — the asset resolves locally and was never part of this check.
    const markup = render(mixedImageModel());
    expect(markup).toContain("Checking 1 image…");
    expect(markup).not.toContain("Checking 2 images…");
  });

  it("imageEmbedWarning words the §3.3 warning with counts", () => {
    expect(imageEmbedWarning(1)).toBe(
      "1 image could not be embedded — it will print as a marked placeholder box.",
    );
    expect(imageEmbedWarning(3)).toBe(
      "3 images could not be embedded — they will print as marked placeholder boxes.",
    );
  });
});

describe("PdfExportModal — export failure is announced (item 6)", () => {
  beforeEach(resetSessionPdfOptions);

  it("the failure banner carries role=alert — progress already has role=status, failure had NEITHER", () => {
    const markup = renderToStaticMarkup(
      <PdfExportModal model={demoModel()} onClose={() => {}} initialFailure="disk full" />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Export failed: disk full");
  });

  it("no failure banner (and so no role=alert from it) when nothing has failed", () => {
    const markup = renderToStaticMarkup(<PdfExportModal model={demoModel()} onClose={() => {}} />);
    expect(markup).not.toContain("Export failed");
  });
});

describe("PdfExportModal — invalid margin/spacing is named, not signaled by color alone (item 7)", () => {
  beforeEach(resetSessionPdfOptions);

  it("an invalid margin gets aria-invalid, aria-describedby, and a role=alert message naming the problem", () => {
    const markup = renderToStaticMarkup(
      <PdfExportModal model={demoModel()} onClose={() => {}} initialMarginText="-5" />,
    );
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="pdf-margin-error"');
    expect(markup).toContain('id="pdf-margin-error"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(INVALID_MM_MESSAGE);
    // Pre-existing rule, still true: Export stays disabled while invalid.
    const exportButton = /<button[^>]*>Export<\/button>/.exec(markup)?.[0];
    expect(exportButton).toContain('disabled=""');
  });

  it("an invalid spacing gets the same treatment, keyed to its OWN field id", () => {
    const markup = renderToStaticMarkup(
      <PdfExportModal
        model={demoModel()}
        onClose={() => {}}
        initialSpacingText="not a number"
      />,
    );
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="pdf-spacing-error"');
    expect(markup).toContain('id="pdf-spacing-error"');
    expect(markup).toContain(INVALID_MM_MESSAGE);
  });

  it("valid margin/spacing: no error ids, no message, aria-invalid explicitly false", () => {
    const markup = renderToStaticMarkup(<PdfExportModal model={demoModel()} onClose={() => {}} />);
    expect(markup).not.toContain("pdf-margin-error");
    expect(markup).not.toContain("pdf-spacing-error");
    expect(markup).not.toContain(INVALID_MM_MESSAGE);
    expect(markup).toContain('aria-invalid="false"');
  });
});
