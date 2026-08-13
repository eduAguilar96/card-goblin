/**
 * dialogFocusTrap.ts (adversarial review item 5): assetsDrawer.tsx and
 * pdfExportModal.tsx each hand-roll a Tab-wrapping focus trap over
 * `FOCUSABLE_SELECTOR`'s matches. The bug was that the selector alone can't
 * tell a real, Tab-reachable control apart from a `display:none` one (the
 * assets drawer's hidden file input matched `input` and, being last in the
 * DOM, silently broke Tab wrapping — see the module header for the full
 * mechanism). `isFocusTrapCandidate` is the fix; it needs a real element
 * (offsetWidth/offsetHeight/getClientRects), which this project's node-only
 * test environment doesn't provide — so it's exercised here against a
 * minimal fake shaped exactly like the DOM contract it reads, the same
 * pattern assetsDrawer.test.tsx already uses for `takePickedFiles`'s fake
 * file input. `focusableElementsIn`'s querySelectorAll plumbing has no such
 * seam and stays on the manual browser checklist, like the rest of this
 * project's focus/keyboard behavior.
 */
import { describe, expect, it } from "vitest";
import { FOCUSABLE_SELECTOR, isFocusTrapCandidate } from "../dialogFocusTrap";

interface FakeElOpts {
  disabled?: boolean;
  offsetWidth?: number;
  offsetHeight?: number;
  rects?: number;
}

/** A minimal stand-in for the exact HTMLElement surface isFocusTrapCandidate
 * reads — not a real DOM element (this project's tests run with no DOM). */
function fakeEl(opts: FakeElOpts = {}): HTMLElement {
  return {
    hasAttribute: (name: string) => name === "disabled" && opts.disabled === true,
    offsetWidth: opts.offsetWidth ?? 0,
    offsetHeight: opts.offsetHeight ?? 0,
    getClientRects: () => Array.from({ length: opts.rects ?? 0 }),
  } as unknown as HTMLElement;
}

describe("FOCUSABLE_SELECTOR", () => {
  it("matches the tags/attributes a real Tab press can land on", () => {
    expect(FOCUSABLE_SELECTOR).toContain("button");
    expect(FOCUSABLE_SELECTOR).toContain("input");
    expect(FOCUSABLE_SELECTOR).toContain("select");
    expect(FOCUSABLE_SELECTOR).toContain("textarea");
    // tabindex="-1" is explicitly excluded — it's in the DOM but
    // intentionally out of the tab order (e.g. the dialog's own root).
    expect(FOCUSABLE_SELECTOR).toContain(':not([tabindex="-1"])');
  });
});

describe("isFocusTrapCandidate", () => {
  it("accepts a normal, laid-out element (a real button/input/select)", () => {
    expect(isFocusTrapCandidate(fakeEl({ offsetWidth: 60, offsetHeight: 20 }))).toBe(true);
  });

  it("rejects a display:none element — the exact bug (a hidden file input)", () => {
    // display:none collapses offsetWidth, offsetHeight, AND getClientRects()
    // all at once — the selector alone can't see this; only checking real
    // layout can.
    expect(isFocusTrapCandidate(fakeEl())).toBe(false);
  });

  it("rejects disabled even when it would otherwise be laid out and visible", () => {
    expect(isFocusTrapCandidate(fakeEl({ disabled: true, offsetWidth: 60 }))).toBe(false);
  });

  it("accepts a zero-offset element that still has a client rect (e.g. plain inline text)", () => {
    // Belt-and-suspenders: offsetWidth/Height can legitimately be 0 for some
    // visible inline content, so the check is an OR across all three signals
    // — only display:none (or an unmounted element) fails every one.
    expect(isFocusTrapCandidate(fakeEl({ rects: 1 }))).toBe(true);
  });
});
