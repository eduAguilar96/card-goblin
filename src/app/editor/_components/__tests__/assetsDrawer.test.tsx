/**
 * Assets drawer (DESIGN.md §7.1b): the pure helpers (`deriveAssetName`,
 * `assetReference`) and the store-free `AssetsDrawerContent`'s static markup
 * states — empty, populated, disabled, error, confirm-delete, and renaming —
 * rendered via the `initial*` test seams (no interaction driver in this
 * project, same pattern as ResetToDemoButton/ProjectFileButtons/
 * PdfExportModal). Actions are spies; nothing here talks to a real store.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AssetsDrawerContent,
  assetReference,
  deriveAssetName,
  takePickedFiles,
  type AssetsDrawerActions,
} from "../assetsDrawer";
import type { AssetMeta } from "@/app/editor/_store/assetStore";

const stripTags = (markup: string): string => markup.replace(/<[^>]+>/g, "");

const noopActions: AssetsDrawerActions = {
  upload: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  getBytes: vi.fn(async () => null),
};

const dragon: AssetMeta = { name: "dragon", mime: "image/png", size: 1024 };
const imp: AssetMeta = { name: "imp", mime: "image/jpeg", size: 2048 };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("deriveAssetName", () => {
  it("strips the extension and keeps a plain identifier as-is", () => {
    expect(deriveAssetName("dragon.png", new Set())).toBe("dragon");
  });

  it("folds spaces/punctuation to underscores", () => {
    expect(deriveAssetName("dragon art (final).png", new Set())).toBe("dragon_art_final_");
  });

  it("prefixes 'a' when the sanitized name would start with a digit", () => {
    expect(deriveAssetName("2024_card.png", new Set())).toBe("a2024_card");
  });

  it("falls back to 'asset' when nothing usable survives", () => {
    expect(deriveAssetName("....png", new Set())).toBe("asset");
    expect(deriveAssetName("___.png", new Set())).toBe("asset");
  });

  it("dodges a collision by suffixing _2, _3, …", () => {
    expect(deriveAssetName("dragon.png", new Set(["dragon"]))).toBe("dragon_2");
    expect(deriveAssetName("dragon.png", new Set(["dragon", "dragon_2"]))).toBe("dragon_3");
  });

  it("always returns a name the identifier rules accept", () => {
    for (const filename of ["a.png", "2.png", "  .png", "日本語.png", "x-y-z.jpeg"]) {
      const name = deriveAssetName(filename, new Set());
      expect(name).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
    }
  });
});

describe("assetReference", () => {
  it("is the asset: scheme + name, exactly what a src: line pastes in", () => {
    expect(assetReference("dragon")).toBe("asset:dragon");
  });
});

// ---------------------------------------------------------------------------
// AssetsDrawerContent — static markup states
// ---------------------------------------------------------------------------

describe("AssetsDrawerContent — dialog chrome", () => {
  it("is an accessible dialog: role, aria-modal, labelled title, focusable", () => {
    const markup = renderToStaticMarkup(
      <AssetsDrawerContent assets={[]} disabled={false} onClose={() => {}} {...noopActions} />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="assets-drawer-title"');
    expect(markup).toContain('id="assets-drawer-title"');
    expect(markup).toContain('tabindex="-1"');
  });
});

describe("AssetsDrawerContent — empty state", () => {
  it("shows an empty-library message with the asset: reference idiom, no assets grid", () => {
    const markup = renderToStaticMarkup(
      <AssetsDrawerContent assets={[]} disabled={false} onClose={() => {}} {...noopActions} />,
    );
    const text = stripTags(markup);
    expect(text).toContain("No assets yet");
    expect(text).toContain("asset:name");
    expect(markup).not.toContain("<li");
  });
});

describe("AssetsDrawerContent — populated state", () => {
  it("lists every asset with a rename trigger, copy-reference, and delete button", () => {
    const markup = renderToStaticMarkup(
      <AssetsDrawerContent
        assets={[dragon, imp]}
        disabled={false}
        onClose={() => {}}
        {...noopActions}
      />,
    );
    const text = stripTags(markup);
    expect(text).toContain("dragon");
    expect(text).toContain("imp");
    expect(text.match(/Copy ref/g)).toHaveLength(2);
    expect(text.match(/Delete/g)).toHaveLength(2);
    // No thumbnail has resolved yet (renderToStaticMarkup runs no effects) —
    // the loading placeholder shows for each, same posture as LiveImage's
    // SSR default (cardSvg.tsx).
    expect(text.match(/loading…/g)).toHaveLength(2);
  });
});

describe("AssetsDrawerContent — disabled (§7.1b: IDB unavailable, mirrors autosaveDisabled)", () => {
  it("shows the quiet off notice and disables the upload button", () => {
    const markup = renderToStaticMarkup(
      <AssetsDrawerContent assets={[]} disabled={true} onClose={() => {}} {...noopActions} />,
    );
    expect(stripTags(markup)).toContain("available in this browser");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>\s*Upload image/);
  });
});

describe("AssetsDrawerContent — upload error (test seam)", () => {
  it("shows an inline alert, not a browser alert, buttons stay usable", () => {
    const markup = renderToStaticMarkup(
      <AssetsDrawerContent
        assets={[]}
        disabled={false}
        onClose={() => {}}
        initialError="“weird.txt” isn't an image file."
        {...noopActions}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(stripTags(markup)).toContain("an image file");
    expect(stripTags(markup)).toContain("Upload image");
  });
});

describe("AssetsDrawerContent — delete confirm (test seam, two-step like ResetToDemoButton)", () => {
  it("arms the destructive confirm for exactly the targeted asset", () => {
    const markup = renderToStaticMarkup(
      <AssetsDrawerContent
        assets={[dragon, imp]}
        disabled={false}
        onClose={() => {}}
        initialConfirmDeleteName="dragon"
        {...noopActions}
      />,
    );
    const text = stripTags(markup);
    expect(text).toContain("Delete “dragon”?");
    expect(text).toContain("Keep");
    expect(markup).toContain("text-red-400"); // the destructive click is marked
  });
});

describe("AssetsDrawerContent — rename (test seam, identifier-validated)", () => {
  it("shows an editable field seeded with the current name", () => {
    const markup = renderToStaticMarkup(
      <AssetsDrawerContent
        assets={[dragon]}
        disabled={false}
        onClose={() => {}}
        initialRenamingName="dragon"
        {...noopActions}
      />,
    );
    expect(markup).toContain('value="dragon"');
    expect(stripTags(markup)).toContain("Save");
    expect(stripTags(markup)).toContain("Cancel");
  });

  it("shows the inline validation error beside the field", () => {
    const markup = renderToStaticMarkup(
      <AssetsDrawerContent
        assets={[dragon]}
        disabled={false}
        onClose={() => {}}
        initialRenamingName="dragon"
        initialRenameError="Use letters, numbers, and underscores, starting with a letter."
        {...noopActions}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(stripTags(markup)).toContain("starting with a letter");
  });
});

describe("takePickedFiles — the picker regression (file input's live FileList)", () => {
  /** A fake input with the browser's real semantics: clearing `value` empties
   * the selection, because `files` is live rather than a snapshot. */
  function fakeInput(names: string[]) {
    const input = {
      _files: names.map((n) => new File([new Uint8Array([1])], n, { type: "image/png" })),
      get files(): File[] {
        return this._files;
      },
      _value: "",
      get value(): string {
        return this._value;
      },
      set value(v: string) {
        this._value = v;
        if (v === "") this._files = []; // the browser behavior that caused the bug
      },
    };
    return input as unknown as { files: ArrayLike<File> | null; value: string } & {
      _files: File[];
    };
  }

  it("returns the picked files even though reading clears the input", () => {
    const input = fakeInput(["dragon.png", "imp.png"]);
    const files = takePickedFiles(input);
    expect(files.map((f) => f.name)).toEqual(["dragon.png", "imp.png"]);
  });

  it("still resets the input, so re-picking the SAME file fires change again", () => {
    const input = fakeInput(["dragon.png"]);
    takePickedFiles(input);
    expect(input.value).toBe("");
    expect(input._files).toHaveLength(0);
  });

  it("an empty or null selection yields no files and never throws", () => {
    expect(takePickedFiles(fakeInput([]))).toEqual([]);
    expect(takePickedFiles({ files: null, value: "x" })).toEqual([]);
  });
});
