/**
 * Shared focus-trap helper for the editor's two dependency-free modal
 * dialogs (assetsDrawer.tsx, pdfExportModal.tsx — DESIGN.md §6.1/§7.1b):
 * both wrap Tab at the dialog's own ends by hand (no portal, no library),
 * and both computed their "focusable" set the same way — which shared the
 * same bug (adversarial review item 5).
 *
 * THE BUG: `FOCUSABLE_SELECTOR` matches by TAG/ATTRIBUTE only, so a
 * `display:none` (Tailwind `className="hidden"`) element — e.g. the assets
 * drawer's hidden file `<input>` — matches `input` and was included. Being
 * LAST in the DOM, it became the trap's wrap target:
 * - forward Tab from the true last VISIBLE control checked
 *   `active === last`, which was never true (browsers skip display:none
 *   elements in the real tab order), so the trap never caught the press and
 *   focus walked out of the dialog into the rest of the page;
 * - Shift+Tab from the first control tried `last.focus()` — focusing a
 *   display:none element is a silent no-op — so `preventDefault()` had
 *   already suppressed the native behavior and the replacement did nothing:
 *   a dead end (most visible with an empty library, where there are few
 *   enough real controls to hit this immediately).
 *
 * THE FIX: filter the selector's matches down to elements a user could
 * ACTUALLY tab to (`isFocusTrapCandidate`) before computing first/last.
 */

/** Elements the manual traps start from — the DOM shapes a real Tab press
 * can land on. Matching this alone is not sufficient (see module note
 * above, and `isFocusTrapCandidate`, which every caller must also apply). */
export const FOCUSABLE_SELECTOR =
  'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * True when an element `FOCUSABLE_SELECTOR` matched is ACTUALLY reachable by
 * Tab: not disabled (the CSS selector can't express that compound
 * condition) and not hidden. `display:none` (and any ancestor's) collapses
 * an element's layout box entirely — offsetWidth, offsetHeight, and
 * getClientRects() all go to nothing — which is what silently broke both
 * dialogs' traps (module note above). This is the same "is it actually
 * visible" test jQuery's `:visible` and most focus-trap libraries use, so it
 * also covers any FUTURE hidden control, not just today's file input.
 */
export function isFocusTrapCandidate(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return false;
  return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
}

/** The dialog's real Tab-reachable controls, in DOM order — what a manual
 * focus trap's first/last should be computed from instead of the raw
 * selector match. */
export function focusableElementsIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    isFocusTrapCandidate,
  );
}
