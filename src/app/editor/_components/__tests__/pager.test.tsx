/**
 * The shared prev/next control (pager.tsx): the index clamp both callers rely
 * on, and the rendered control's end behaviour — disabled, never wrapping.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Pager, clampIndex } from "@/app/editor/_components/pager";

describe("clampIndex", () => {
  it("keeps an in-range index", () => {
    expect(clampIndex(3, 5)).toBe(3);
  });

  it("pins a too-large index to the last item (a shrunk list shows its end)", () => {
    expect(clampIndex(9, 5)).toBe(4);
  });

  it("floors negatives, fractions, and non-finite input to a usable index", () => {
    expect(clampIndex(-2, 5)).toBe(0);
    expect(clampIndex(2.7, 5)).toBe(2);
    expect(clampIndex(NaN, 5)).toBe(0);
    expect(clampIndex(Infinity, 5)).toBe(0);
  });

  it("is 0 when there is nothing to address", () => {
    expect(clampIndex(3, 0)).toBe(0);
    expect(clampIndex(3, -1)).toBe(0);
  });
});

/** Attributes of the `<button>` carrying this aria-label. Whole tags, because
 * attribute order follows the JSX and `disabled` precedes the label. */
function buttonAttributes(markup: string, label: string): string {
  const tag = markup.split("<button").find((s) => s.includes(`aria-label="${label}"`));
  expect(tag).toBeDefined();
  return (tag ?? "").slice(0, tag?.indexOf(">"));
}

describe("Pager", () => {
  const render = (index: number, count: number): string =>
    renderToStaticMarkup(
      <Pager
        index={index}
        count={count}
        onChange={() => {}}
        previousLabel="Previous page"
        nextLabel="Next page"
      />,
    );

  it("reads n / count, 1-based", () => {
    expect(render(2, 6)).toContain("3 / 6");
  });

  it("disables only Previous at the start", () => {
    const markup = render(0, 6);
    expect(buttonAttributes(markup, "Previous page")).toContain('disabled=""');
    expect(buttonAttributes(markup, "Next page")).not.toContain('disabled=""');
  });

  it("disables only Next at the end", () => {
    const markup = render(5, 6);
    expect(buttonAttributes(markup, "Previous page")).not.toContain('disabled=""');
    expect(buttonAttributes(markup, "Next page")).toContain('disabled=""');
  });

  it("disables both when there is a single item", () => {
    const markup = render(0, 1);
    expect(buttonAttributes(markup, "Previous page")).toContain('disabled=""');
    expect(buttonAttributes(markup, "Next page")).toContain('disabled=""');
  });
});
