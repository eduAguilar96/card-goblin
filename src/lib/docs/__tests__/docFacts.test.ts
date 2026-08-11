/**
 * The wiki's factual claims, checked against the code they describe.
 *
 * Prose can't be tested, but the *numbers and tables* in the wiki are copies
 * of constants that live in the compiler and the PDF layout. Those copies are
 * exactly what rots: someone adds a card preset or retunes a cap, the docs
 * quietly keep saying the old thing, and a reader believes them.
 *
 * Every check here is BIDIRECTIONAL, which is the point:
 *
 *   1. nothing the wiki states disagrees with the constant, AND
 *   2. nothing in the constant is missing from the wiki.
 *
 * (2) is the one that catches real drift — a test that only validates the
 * rows already written sails straight past a newly added sixth card size.
 *
 * WHEN THIS TEST FAILS, there are two honest fixes: update the wiki because
 * the code changed, or update the *pattern* here because the prose was
 * legitimately reworded. Never delete a check to make it pass — a claim with
 * no check is a claim that will be wrong eventually.
 */

import { describe, expect, it } from "vitest";
import { SIZE_PRESETS } from "@/lib/lang/check";
import { CSS_COLOR_NAMES } from "@/lib/lang/css-colors";
import { DICIER_CODES } from "@/lib/lang/dicier-codes";
import {
  ANCHOR_TOKENS,
  DEFAULT_ANCHOR,
  DEFAULT_ICON_STYLE,
  DEFAULT_IMAGE_FIT,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_TEXTBOX_OVERFLOW,
  ICON_STYLES,
  IMAGE_FITS,
  TEXTBOX_OVERFLOWS,
  parseAnchor,
} from "@/lib/lang/model";
import { SHRINK_FLOOR, SHRINK_STEP } from "@/lib/lang/wrap";
import { REPEAT_CAP } from "@/lib/lang/eval";
import { CARD_CAP } from "@/lib/lang/generate";
import { KEYWORDS } from "@/lib/lang/lexer";
import { BLOCK_OPENERS } from "@/lib/lang/parser";
import {
  DEFAULT_PDF_OPTIONS,
  GUIDE_STROKES,
  PAGE_SIZES,
  type PdfExportOptions,
} from "@/app/editor/_components/pdfLayout";
import { RASTER_DPI } from "@/app/editor/_components/pdfRaster";
import { PERSIST_DEBOUNCE_MS } from "@/app/editor/_store/persistence";
import { loadDocPages } from "@/lib/docs/pages";

const pages = loadDocPages();

/** One page's prose, including its summary (summaries make claims too). */
function pageText(slug: string): string {
  const page = pages.find((p) => p.slug === slug);
  if (page === undefined) throw new Error(`No wiki page "${slug}" — was it renamed?`);
  return `${page.summary}\n${page.body}`;
}

/** The whole wiki as one string — for claims repeated across pages. */
const ALL_TEXT = pages.map((p) => `${p.summary}\n${p.body}`).join("\n\n");

interface MarkdownTable {
  header: string[];
  rows: string[][];
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Every markdown table in `text`, kept SEPARATE.
 *
 * Separate matters: a page may hold two tables keyed by the same first
 * column (card-sizes.md lists presets by millimetres and again by unit
 * height), and flattening them would silently let one overwrite the other.
 */
function parseTables(text: string): MarkdownTable[] {
  const tables: MarkdownTable[] = [];
  let current: string[] = [];

  const flush = (): void => {
    if (current.length >= 2) {
      tables.push({
        header: splitRow(current[0]),
        rows: current
          .slice(1)
          .map(splitRow)
          .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell))),
      });
    }
    current = [];
  };

  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("|")) current.push(line);
    else flush();
  }
  flush();
  return tables;
}

/** The one table on the page whose header mentions `heading`. */
function tableWithHeader(text: string, heading: string): MarkdownTable {
  const found = parseTables(text).filter((t) =>
    t.header.some((cell) => plain(cell).toLowerCase().includes(heading.toLowerCase())),
  );
  if (found.length !== 1) {
    throw new Error(
      `Expected exactly one table with a "${heading}" column, found ${found.length} — ` +
        `the page was restructured; update this test.`,
    );
  }
  return found[0];
}

/** Strip markdown emphasis/code marks and thousands separators from a cell. */
function plain(cell: string): string {
  return cell.replace(/[`*]/g, "").replace(/(\d),(\d)/g, "$1$2").trim();
}

// ---------------------------------------------------------------------------
// Numeric claims repeated in prose
// ---------------------------------------------------------------------------

/**
 * Each entry: every match of every pattern (capture group 1 = the number)
 * must equal `expected`, and there must be at least one match overall. The
 * "at least one" half is deliberate — if the phrasing changes, this fails
 * loudly instead of passing vacuously and leaving the claim unguarded.
 *
 * Patterns must be anchored on the surrounding words, not just the number:
 * "9 physical cards" is a legitimate sentence about the demo deck, not a
 * claim about the 2,000 cap.
 */
const NUMERIC_CLAIMS: {
  label: string;
  patterns: RegExp[];
  expected: number;
}[] = [
  {
    label: "Dicier icon code count",
    patterns: [/(\d[\d,]*)\s+(?:usable codes|(?:Dicier )?game glyphs|glyphs)/g],
    expected: DICIER_CODES.size,
  },
  {
    label: "CSS color name count",
    patterns: [/all (\d[\d,]*) of them/g],
    expected: CSS_COLOR_NAMES.size,
  },
  {
    label: "Repeat expansion cap",
    patterns: [/(\d[\d,]*)\s+drawn (?:copies|shapes)/g],
    expected: REPEAT_CAP,
  },
  {
    label: "Per-Card instance cap",
    patterns: [
      /at most \*\*(\d[\d,]*) physical cards/g,
      /\*\*(\d[\d,]*) physical cards per/g,
    ],
    expected: CARD_CAP,
  },
  {
    label: "Autosave debounce (stated in seconds)",
    patterns: [/about \*\*(\d[\d,]*) second\*\* after your last change/g],
    expected: PERSIST_DEBOUNCE_MS / 1000,
  },
  {
    label: "PDF raster DPI",
    patterns: [/(\d[\d,]*)\s*DPI/g],
    expected: RASTER_DPI,
  },
  {
    label: "TextBox default line_height (× size)",
    patterns: [/default is \*\*([\d.]+)\*\* × size/g],
    expected: DEFAULT_LINE_HEIGHT,
  },
  {
    label: "TextBox shrink floor (percent of the declared size)",
    patterns: [/floor of \*\*(\d+)%\*\*/g],
    expected: Math.round(SHRINK_FLOOR * 100),
  },
  {
    label: "TextBox shrink step (percent)",
    patterns: [/in (\d+)% steps/g],
    expected: Math.round(SHRINK_STEP * 100),
  },
];

describe("numeric claims match their constants", () => {
  for (const claim of NUMERIC_CLAIMS) {
    it(`${claim.label} is stated as ${claim.expected}`, () => {
      const found = claim.patterns.flatMap((pattern) =>
        [...ALL_TEXT.matchAll(pattern)].map((m) => Number(m[1].replace(/,/g, ""))),
      );
      expect(
        found.length,
        `No wiki text matches ${claim.patterns.join(" or ")} — the phrasing changed, ` +
          `so this claim is no longer guarded. Update the pattern (or the docs).`,
      ).toBeGreaterThan(0);
      for (const value of found) {
        expect(value, `wiki says ${value}, code says ${claim.expected}`).toBe(
          claim.expected,
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Card sizes
// ---------------------------------------------------------------------------

describe("the card-sizes table matches SIZE_PRESETS", () => {
  const text = pageText("card-sizes");
  /** `poker` → `63.5 × 88.9 mm`, from the table with a "Physical" column. */
  const documented = new Map(
    tableWithHeader(text, "Physical").rows.map(
      (cells) => [plain(cells[0]), plain(cells[1] ?? "")] as const,
    ),
  );

  it("documents every preset — a new size can't ship undocumented", () => {
    expect([...documented.keys()].sort()).toEqual([...SIZE_PRESETS.keys()].sort());
  });

  for (const [name, preset] of SIZE_PRESETS) {
    it(`states ${name} as ${preset.widthMm} × ${preset.heightMm} mm`, () => {
      expect(documented.get(name)).toBe(`${preset.widthMm} × ${preset.heightMm} mm`);
    });
  }

  it("states unit heights that match the square-unit derivation", () => {
    // The other table claims `x_units: 20` → N units tall per preset. N is
    // 20 × height/width; a wrong ratio here misleads anyone laying out a
    // card. Values are printed truncated ("31.111…"), hence the tolerance.
    const rows = tableWithHeader(text, "height in units").rows;
    const checked: string[] = [];

    for (const cells of rows) {
      const name = plain(cells[0]);
      const preset = SIZE_PRESETS.get(name);
      expect(preset, `unknown preset "${name}" in the unit-height table`).toBeDefined();
      if (preset === undefined) continue;

      const stated = Number(/^[\d.]+/.exec(plain(cells[1] ?? ""))?.[0] ?? NaN);
      const derived = (20 * preset.heightMm) / preset.widthMm;
      expect(
        Math.abs(stated - derived),
        `${name}: wiki says ${stated}, 20 × ${preset.heightMm}/${preset.widthMm} = ${derived}`,
      ).toBeLessThan(0.01);
      checked.push(name);
    }

    expect(checked.sort()).toEqual([...SIZE_PRESETS.keys()].sort());
  });
});

// ---------------------------------------------------------------------------
// Icon styles
// ---------------------------------------------------------------------------

describe("the icon-styles table matches ICON_STYLES", () => {
  const text = pageText("icons");
  /** `flat_dark` → its Face-column prose, from the table with a "style" header. */
  const documented = new Map(
    tableWithHeader(text, "style").rows.map(
      (cells) => [plain(cells[0]), plain(cells[1] ?? "")] as const,
    ),
  );

  it("documents every style — a new face can't ship undocumented", () => {
    expect([...documented.keys()].sort()).toEqual([...ICON_STYLES].sort());
  });

  it("marks exactly the code's default style as the default", () => {
    for (const [style, face] of documented) {
      expect(
        /default/i.test(face),
        `"${style}" default marking must match DEFAULT_ICON_STYLE (${DEFAULT_ICON_STYLE})`,
      ).toBe(style === DEFAULT_ICON_STYLE);
    }
  });
});

// ---------------------------------------------------------------------------
// Image fits
// ---------------------------------------------------------------------------

describe("the image-fit table matches IMAGE_FITS", () => {
  const text = pageText("templates-and-shapes");
  /** `contain` → its What-it-does prose, from the table with a "fit" header. */
  const documented = new Map(
    tableWithHeader(text, "fit").rows.map(
      (cells) => [plain(cells[0]), plain(cells[1] ?? "")] as const,
    ),
  );

  it("documents every fit — a new mode can't ship undocumented", () => {
    expect([...documented.keys()].sort()).toEqual([...IMAGE_FITS].sort());
  });

  it("marks exactly the code's default fit as the default", () => {
    for (const [fit, what] of documented) {
      expect(
        /default/i.test(what),
        `"${fit}" default marking must match DEFAULT_IMAGE_FIT (${DEFAULT_IMAGE_FIT})`,
      ).toBe(fit === DEFAULT_IMAGE_FIT);
    }
  });
});

// ---------------------------------------------------------------------------
// Nine-point anchors
// ---------------------------------------------------------------------------

describe("the anchor table matches ANCHOR_TOKENS", () => {
  const text = pageText("templates-and-shapes");
  /** `top_left` → its point-description prose, from the anchor-header table. */
  const documented = new Map(
    tableWithHeader(text, "anchor").rows.map(
      (cells) => [plain(cells[0]), plain(cells[1] ?? "")] as const,
    ),
  );

  it("documents every canonical token — a new anchor can't ship undocumented", () => {
    expect([...documented.keys()].sort()).toEqual([...ANCHOR_TOKENS].sort());
  });

  it("marks exactly the code's default anchor as the default", () => {
    // The canonical spelling of the default is derived, not hard-coded, so a
    // changed DEFAULT_ANCHOR moves this check with it.
    const defaultToken = `${DEFAULT_ANCHOR.v}_${DEFAULT_ANCHOR.h}`;
    expect(parseAnchor(defaultToken)).toEqual(DEFAULT_ANCHOR);
    for (const [token, what] of documented) {
      expect(
        /default/i.test(what),
        `"${token}" default marking must match DEFAULT_ANCHOR (${defaultToken})`,
      ).toBe(token === defaultToken);
    }
  });

  it("every documented token normalizes, in both word orders (the reversibility the page claims)", () => {
    for (const token of documented.keys()) {
      const reversed = token.split("_").reverse().join("_");
      expect(parseAnchor(token), token).not.toBeNull();
      expect(parseAnchor(reversed), reversed).toEqual(parseAnchor(token));
    }
  });
});

// ---------------------------------------------------------------------------
// TextBox overflow modes
// ---------------------------------------------------------------------------

describe("the overflow table matches TEXTBOX_OVERFLOWS", () => {
  const text = pageText("templates-and-shapes");
  /** `clip` → its What-it-does prose, from the table with an "overflow" header. */
  const documented = new Map(
    tableWithHeader(text, "overflow").rows.map(
      (cells) => [plain(cells[0]), plain(cells[1] ?? "")] as const,
    ),
  );

  it("documents every mode — a new mode can't ship undocumented", () => {
    expect([...documented.keys()].sort()).toEqual([...TEXTBOX_OVERFLOWS].sort());
  });

  it("marks exactly the code's default mode as the default", () => {
    for (const [mode, what] of documented) {
      expect(
        /default/i.test(what),
        `"${mode}" default marking must match DEFAULT_TEXTBOX_OVERFLOW (${DEFAULT_TEXTBOX_OVERFLOW})`,
      ).toBe(mode === DEFAULT_TEXTBOX_OVERFLOW);
    }
  });
});

// ---------------------------------------------------------------------------
// Reserved words
// ---------------------------------------------------------------------------

describe("the reserved-word list matches the lexer and parser", () => {
  const reserved = new Set([...BLOCK_OPENERS, ...KEYWORDS]);

  it("lists exactly the words that can't be used as names", () => {
    // Basics states them as backticked runs inside the "reserved" paragraph.
    const text = pageText("basics");
    const paragraph = /reserved and can't be used as names([\s\S]*?)\n\n/.exec(text);
    expect(paragraph, "the reserved-words paragraph moved or was reworded").not.toBeNull();

    const documented = new Set(
      [...(paragraph?.[1] ?? "").matchAll(/`([A-Za-z]+)`/g)].map((m) => m[1]),
    );
    expect([...documented].sort()).toEqual([...reserved].sort());
  });
});

// ---------------------------------------------------------------------------
// PDF export defaults
// ---------------------------------------------------------------------------

describe("the PDF options table matches the export defaults", () => {
  const text = pageText("pdf-export");
  /** Option label → stated default, from the options table. */
  const documented = new Map(
    tableWithHeader(text, "Option").rows.map(
      (cells) => [plain(cells[0]), plain(cells[1] ?? "")] as const,
    ),
  );

  /** Wiki row label for each option KEY. The Record type makes this total:
   * adding an option to PdfExportOptions without labeling it here is a type
   * error, and the key-set check below then demands its wiki row — the same
   * "new one can't ship undocumented" shape as the SIZE_PRESETS section. */
  const OPTION_LABELS: Record<keyof PdfExportOptions, string> = {
    pageSize: "Page size",
    backs: "Backs",
    marginMm: "Outer margin (mm)",
    spacingMm: "Card spacing (mm)",
    cutLines: "Cut lines",
    crossMarks: "Cross marks",
  };

  const optionKeys = Object.keys(DEFAULT_PDF_OPTIONS) as (keyof PdfExportOptions)[];

  it("documents every option — a new option can't ship undocumented", () => {
    expect([...documented.keys()].sort()).toEqual(
      optionKeys.map((key) => OPTION_LABELS[key]).sort(),
    );
  });

  for (const key of optionKeys) {
    const label = OPTION_LABELS[key];
    const actual =
      key === "pageSize"
        ? PAGE_SIZES[DEFAULT_PDF_OPTIONS.pageSize].name
        : String(DEFAULT_PDF_OPTIONS[key]);
    it(`states the ${label} default as "${actual}"`, () => {
      const stated = documented.get(label);
      expect(stated, `no "${label}" row in the options table`).toBeDefined();
      // The table writes defaults for humans ("Letter (215.9 × 279.4 mm)",
      // "Duplex"), so compare case-insensitively on the leading token.
      expect(stated?.toLowerCase()).toContain(actual.toLowerCase());
    });
  }

  it("documents every page size the modal offers", () => {
    for (const size of Object.values(PAGE_SIZES)) {
      expect(text).toContain(`${size.widthMm} × ${size.heightMm} mm`);
      expect(text).toContain(size.name);
    }
  });

  it("states every guide style's stroke width, and no unknown styles", () => {
    // The wiki writes "**dotted** (0.2 mm dotted black)" etc.; scrape every
    // "**style** (N mm" claim on the page and compare the full set against
    // GUIDE_STROKES — both directions: no stated width may disagree, and no
    // style in the code may go unstated.
    const stated = new Map(
      [...text.matchAll(/\*\*(\w+)\*\* \(([\d.]+) mm/g)].map(
        (m) => [m[1], Number(m[2])] as const,
      ),
    );
    expect([...stated.keys()].sort()).toEqual(Object.keys(GUIDE_STROKES).sort());
    for (const [style, stroke] of Object.entries(GUIDE_STROKES)) {
      expect(
        stated.get(style),
        `wiki states the ${style} stroke as ${stated.get(style)} mm, code says ${stroke.widthMm} mm`,
      ).toBe(stroke.widthMm);
    }
  });
});
