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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SIZE_PRESETS } from "@/lib/lang/check";
import { CSS_COLOR_NAMES } from "@/lib/lang/css-colors";
import { DICIER_CODES } from "@/lib/lang/dicier-codes";
import {
  DEFAULT_FONT,
  DEFAULT_ICON_STYLE,
  DEFAULT_IMAGE_FIT,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_PIVOT,
  DEFAULT_ROTATE,
  DEFAULT_QR_LEVEL,
  DEFAULT_TEXTBOX_OVERFLOW,
  FONT_FACES,
  ICON_STYLES,
  IMAGE_FITS,
  PIVOT_TOKENS,
  QR_LEVELS,
  TEXTBOX_OVERFLOWS,
  parsePivot,
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
import { ASSET_MAX_BYTES } from "@/app/editor/_store/assetStore";
import { PUSH_DEBOUNCE_MS, type CloudSyncSnapshot } from "@/app/editor/_store/cloudSync";
import { cloudStatusLabel } from "@/app/editor/_components/cloudSyncControl";
import { SESSION_DURATION_MS } from "@/lib/cloud/session";
import { loadDocPages } from "@/lib/docs/pages";

const pages = loadDocPages();

/** Cloud sync is an admin-only capability, so its guarded facts live in an
 * operator document that is deliberately outside the public wiki. */
const CLOUD_SYNC_TEXT = readFileSync(join(process.cwd(), "docs/cloud-sync.md"), "utf8");

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
  /** Defaults to the whole wiki (ALL_TEXT). Scope narrower when a claim only
   * makes sense on specific pages (adversarial m9) — a wiki-global scan can
   * accidentally match an unrelated "**N MB**" sentence some other page adds
   * later, silently guarding the WRONG claim under this test's name. */
  text?: () => string;
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
    patterns: [/(\d[\d,]*)\s+Repeat (?:expansions|iterations) per card/g],
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
    label: "Admin cloud push debounce (stated in seconds, §7.6)",
    patterns: [/about \*\*(\d[\d,]*) seconds\*\* after your last change/g],
    expected: PUSH_DEBOUNCE_MS / 1000,
    text: () => CLOUD_SYNC_TEXT,
  },
  {
    label: "Admin cloud session length (stated in days, §7.6)",
    patterns: [/session lasts \*\*(\d[\d,]*) days\*\*/g],
    expected: SESSION_DURATION_MS / (24 * 60 * 60 * 1000),
    text: () => CLOUD_SYNC_TEXT,
  },
  {
    label: "PDF raster DPI",
    patterns: [/(\d[\d,]*)\s*DPI/g],
    expected: RASTER_DPI,
  },
  {
    label: "Uploaded asset cap (stated in MB)",
    patterns: [/\*\*(\d[\d,]*) MB\*\*/g],
    expected: ASSET_MAX_BYTES / (1024 * 1024),
    // Scoped to the two pages that actually state the cap (adversarial m9)
    // — the uploaded-assets page and the limits page — rather than the whole
    // wiki, so this test only ever guards THIS claim.
    text: () => `${pageText("assets")}\n${pageText("limits")}`,
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
      const text = claim.text ? claim.text() : ALL_TEXT;
      const found = claim.patterns.flatMap((pattern) =>
        [...text.matchAll(pattern)].map((m) => Number(m[1].replace(/,/g, ""))),
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

describe("generation-limit prose distinguishes placeholder from truncation", () => {
  const repeatPages = [
    pageText("templates-and-shapes"),
    pageText("cards-and-generation"),
    pageText("limits"),
  ];

  it("describes a Repeat-cap breach as D004 plus an affected-card placeholder", () => {
    for (const text of repeatPages) {
      expect(text).toMatch(/D004/);
      expect(text).toMatch(/affected card[^.]*placeholder|affected card becomes an error\s+placeholder/i);
    }
  });

  it("reserves truncation for the 2,000-card D007 cap", () => {
    for (const slug of ["cards-and-generation", "limits"]) {
      const text = pageText(slug);
      expect(text).toMatch(/D007[^.]*truncat/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Admin-only cloud sync: the sign-in collision prompt's copy (§7.6 FIX 4).
// Guard added after an independent review caught the operator documentation
// saying "Your DEVICE has work that isn't in the cloud"
// while the code actually renders "Your EDITOR has work..." — exactly the
// silent-paraphrase drift this whole file exists to catch, just for a
// literal STRING rather than a number.
// ---------------------------------------------------------------------------

describe("the collision-prompt operator text matches cloudStatusLabel's 'conflict' copy", () => {
  const CONFLICT_SNAPSHOT: CloudSyncSnapshot = {
    status: "conflict",
    lastSyncedAt: null,
    pullProgress: null,
    errorMessage: null,
    behindRevision: null,
    conflictProject: null,
    notice: null,
    syncGate: null,
  };
  const label = cloudStatusLabel(CONFLICT_SNAPSHOT, 0);
  const text = CLOUD_SYNC_TEXT;

  it("has a section heading naming the EXACT label, quoted", () => {
    expect(text, `no heading for "${label}" — it moved, was reworded, or drifted`).toContain(
      `## "${label}"`,
    );
  });

  it("every BOLD mention of the collision prompt uses the exact label, not a paraphrase", () => {
    // Distinctive tail ("isn't in the cloud") rather than the whole label,
    // so this fails LOUDLY (wrong text captured) instead of vacuously
    // (zero matches) if the wording drifts further.
    const bolded = [...text.matchAll(/\*\*([^*]*isn't in the cloud)\*\*/g)].map((m) => m[1]);
    expect(bolded.length, "no bold mention of the collision prompt found — the phrasing changed").toBeGreaterThan(
      0,
    );
    for (const mention of bolded) {
      expect(mention, `wiki bolds "${mention}", code renders "${label}"`).toBe(label);
    }
  });
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

  it("states inches that are the millimetres converted", () => {
    // The inch column is a convenience restatement (a reader comparing a
    // sleeve pack), rounded to 2 dp — so it drifts silently unless derived.
    const table = tableWithHeader(text, "Physical");
    const col = table.header.findIndex((cell) => plain(cell).toLowerCase() === "inches");
    expect(col, "the card-sizes table lost its Inches column").toBeGreaterThan(0);

    for (const cells of table.rows) {
      const preset = SIZE_PRESETS.get(plain(cells[0]));
      expect(preset, `unknown preset "${plain(cells[0])}"`).toBeDefined();
      if (preset === undefined) continue;

      const stated = /^([\d.]+) × ([\d.]+) in$/.exec(plain(cells[col] ?? ""));
      expect(stated, `${preset.name}: inches must read "W × H in"`).not.toBeNull();
      if (stated === null) continue;

      for (const [i, mm] of [preset.widthMm, preset.heightMm].entries()) {
        expect(
          Math.abs(Number(stated[i + 1]) - mm / 25.4),
          `${preset.name}: wiki says ${stated[i + 1]} in, ${mm} mm ÷ 25.4 = ${mm / 25.4}`,
        ).toBeLessThan(0.006); // 2-dp rounding, nothing looser
      }
    }
  });

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
  const text = pageText("images");
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
// Qr error-correction levels
// ---------------------------------------------------------------------------

describe("the Qr level table matches QR_LEVELS", () => {
  const text = pageText("qr-codes");
  /** `m` → its What-it-does prose, from the table with a "level" header. */
  const documented = new Map(
    tableWithHeader(text, "level").rows.map(
      (cells) => [plain(cells[0]), plain(cells[1] ?? "")] as const,
    ),
  );

  it("documents every level — a new level can't ship undocumented", () => {
    expect([...documented.keys()].sort()).toEqual([...QR_LEVELS].sort());
  });

  it("marks exactly the code's default level as the default", () => {
    for (const [level, what] of documented) {
      expect(
        /default/i.test(what),
        `"${level}" default marking must match DEFAULT_QR_LEVEL (${DEFAULT_QR_LEVEL})`,
      ).toBe(level === DEFAULT_QR_LEVEL);
    }
  });
});

// ---------------------------------------------------------------------------
// Nine-point pivots
// ---------------------------------------------------------------------------

describe("the shape table's rotate default matches DEFAULT_ROTATE (\u25c643)", () => {
  const text = pageText("templates-and-shapes");

  it("every drawable row lists rotate with the code's default", () => {
    const { rows } = tableWithHeader(text, "optional (default)");
    const drawables = rows.filter((cells) => !plain(cells[0]).startsWith("Repeat"));
    expect(drawables).toHaveLength(6);
    for (const cells of drawables) {
      expect(plain(cells[2] ?? ""), `${plain(cells[0])} must document rotate's default`).toContain(
        `rotate (${DEFAULT_ROTATE})`,
      );
    }
  });
});

describe("the pivot table matches PIVOT_TOKENS", () => {
  const text = pageText("templates-and-shapes");
  /** `top_left` → its point-description prose, from the pivot-header table. */
  const documented = new Map(
    tableWithHeader(text, "pivot").rows.map(
      (cells) => [plain(cells[0]), plain(cells[1] ?? "")] as const,
    ),
  );

  it("documents every canonical token — a new pivot can't ship undocumented", () => {
    expect([...documented.keys()].sort()).toEqual([...PIVOT_TOKENS].sort());
  });

  it("marks exactly the code's default pivot as the default", () => {
    // The canonical spelling of the default is derived, not hard-coded, so a
    // changed DEFAULT_PIVOT moves this check with it.
    const defaultToken = `${DEFAULT_PIVOT.v}_${DEFAULT_PIVOT.h}`;
    expect(parsePivot(defaultToken)).toEqual(DEFAULT_PIVOT);
    for (const [token, what] of documented) {
      expect(
        /default/i.test(what),
        `"${token}" default marking must match DEFAULT_PIVOT (${defaultToken})`,
      ).toBe(token === defaultToken);
    }
  });

  it("every documented token normalizes, in both word orders (the reversibility the page claims)", () => {
    for (const token of documented.keys()) {
      const reversed = token.split("_").reverse().join("_");
      expect(parsePivot(token), token).not.toBeNull();
      expect(parsePivot(reversed), reversed).toEqual(parsePivot(token));
    }
  });
});

// ---------------------------------------------------------------------------
// TextBox overflow modes
// ---------------------------------------------------------------------------

describe("the overflow table matches TEXTBOX_OVERFLOWS", () => {
  const text = pageText("text");
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
// Text/TextBox fonts (◆41)
// ---------------------------------------------------------------------------

describe("the font table matches FONT_FACES (◆41)", () => {
  const text = pageText("text");
  /** `geist` → its Face-column prose, from the table with a "font" header. */
  const documented = new Map(
    tableWithHeader(text, "font").rows.map(
      (cells) => [plain(cells[0]), plain(cells[1] ?? "")] as const,
    ),
  );

  it("documents every face — a new face can't ship undocumented", () => {
    expect([...documented.keys()].sort()).toEqual([...FONT_FACES].sort());
  });

  it("marks exactly the code's default face as the default", () => {
    for (const [face, what] of documented) {
      expect(
        /default/i.test(what),
        `"${face}" default marking must match DEFAULT_FONT (${DEFAULT_FONT})`,
      ).toBe(face === DEFAULT_FONT);
    }
  });
});

// ---------------------------------------------------------------------------
// Inline icons (◆44)
// ---------------------------------------------------------------------------

describe("the inline-icons section (◆44) states the code's fixed Dicier face", () => {
  const text = pageText("text");

  it("has the section, and names exactly DEFAULT_ICON_STYLE as the face markers draw with", () => {
    const section = /## Inline icons([\s\S]*?)\n## /.exec(text);
    expect(section, "the Inline icons section moved or was retitled").not.toBeNull();
    // The wiki's "always the default face for now" claim is a copy of the
    // renderer's hardcoded ICON_FONT_FAMILIES[DEFAULT_ICON_STYLE] choice —
    // if inline markers ever gain a style choice, this prose must change.
    expect(section![1]).toContain(`\`${DEFAULT_ICON_STYLE}\``);
  });
});

// ---------------------------------------------------------------------------
// Resolved-text aliases (◆52)
// ---------------------------------------------------------------------------

describe("the resolved-text alias guide pins ◆52's safety boundaries", () => {
  const text = pageText("text");
  const section = /## Reusing resolved text with aliases([\s\S]*?)\n## /.exec(text);

  it("documents cell-borne aliases, one-level expansion, and marker ordering", () => {
    expect(section, "the resolved-text alias section moved or was retitled").not.toBeNull();
    expect(section![1]).toMatch(/spreadsheet cell/i);
    expect(section![1]).toMatch(/exactly one level/i);
    expect(section![1]).toMatch(/then the ordinary scoped-color,[\s\S]*Dicier,[\s\S]*asset markers are parsed/i);
    expect(section![1]).toContain('let damage_icon: "{color:#cc2222}{asset:swords}{/color}"');
    expect(section![1]).toContain("Deal 2 {alias:damage_icon}.");
    expect(section![1]).toContain("text: [desc]");
    expect(section![1]).toMatch(/ordinary[\s\S]*interpolation cannot do this arbitrary placement/i);
    expect(section![1]).toMatch(/program-level[\s\S]*successfully resolves to Text/i);
    expect(section![1]).toContain("`{{alias:name}`");
  });

  it("keeps unknown and non-Text targets raw and non-fatal", () => {
    expect(section![1]).toMatch(/unknown name[\s\S]*not Text[\s\S]*original\s+`\{alias:name\}` visible/i);
    expect(section![1]).toMatch(/non-fatal data\s+diagnostic[\s\S]*D011/i);
    expect(section![1]).toMatch(/still renders rather than becoming\s+a placeholder/i);
  });

  it("does not mislabel runtime data errors from valid Text aliases as D011", () => {
    expect(section![1]).toMatch(/D011 is only about finding and preparing the target/i);
    expect(section![1]).toMatch(
      /empty required Number cell[\s\S]*D003[\s\S]*placeholder[\s\S]*does not[\s\S]*D011/i,
    );
  });

  it("documents the W002 exception for data-addressable Text globals", () => {
    expect(section![1]).toMatch(/externally addressable/i);
    expect(section![1]).toMatch(/does not receive[\s\S]*W002/i);
    expect(section![1]).toMatch(/does not rewrite the cell or add anything to[\s\S]*Export Data/i);
  });
});

describe("resolved-text aliases are discoverable from adjacent user workflows", () => {
  for (const slug of ["sheets-and-data", "assets", "the-editor", "roadmap"]) {
    it(`${slug} links users to the alias syntax or motivating use case`, () => {
      const text = pageText(slug);
      expect(text).toMatch(/alias/i);
      expect(text).toContain("04-text.md#reusing-resolved-text-with-aliases");
    });
  }
});

describe("the error reference documents non-fatal alias diagnostic D011", () => {
  it("says the raw marker and rendered card survive", () => {
    const text = `${pageText("errors")}\n${pageText("diagnostics")}`;
    expect(text).toContain("D011");
    expect(text).toMatch(/raw[\s\S]*marker stays visible/i);
    expect(text).toMatch(/card still renders/i);
    expect(text).toMatch(/D003[\s\S]*placeholder[\s\S]*(?:not remapped|instead of being converted) to D011/i);
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
    pageNumbers: "Print page numbers",
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
        : key === "pageNumbers"
          ? DEFAULT_PDF_OPTIONS.pageNumbers
            ? "On"
            : "Off"
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
