import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { compileProject } from "@/lib/lang";
import {
  buildDataExport,
  csvField,
  dataExportFileName,
  ExportDataButton,
} from "@/app/editor/_components/dataExport";

const src = (...lines: string[]): string => `${lines.join("\n")}\n`;

const PROJECT = src(
  "Enum: Suit",
  "  case Rock",
  "  case Paper",
  "Sheet: S",
  "  column name: Text",
  "  column count: Number",
  '  virtual column card_code: Text = "[name]|[card]|[suit]"',
  "Template: T",
  "  Text:",
  "    x: 0",
  "    y: 0",
  "    size: 1",
  '    text: "face"',
  "Card: Monster",
  "  sheet: S",
  "  size: poker",
  "  x_units: 20",
  "  y_units: auto",
  "  loop: Suit as suit",
  "  count: [count]",
  "  Front: T",
);

describe("CSV data export (◆48)", () => {
  it("quotes RFC 4180 special characters and leaves ordinary values alone", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("a\nb")).toBe('"a\nb"');
    expect(csvField("a\rb")).toBe('"a\rb"');
  });

  it("emits one row per generated instance with provenance, loop, physical, and virtual data", () => {
    const compiled = compileProject(PROJECT, {
      S: [{ name: 'Goblin, "King"', count: "2" }],
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error"))
      .toEqual([]);
    const output = buildDataExport(compiled.model);
    expect(output.filename).toBe("Monster.csv");
    const lines = output.csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "@card,@sheet,@row,@card_number,@project_card,@copy,@loop.suit,name,count,card_code",
    );
    expect(lines).toHaveLength(5); // header + 2 suits × count 2
    expect(lines[1]).toBe(
      'Monster,S,1,1,1,1,Rock,"Goblin, ""King""",2,"Goblin, ""King""|1|Rock"',
    );
    expect(lines[4]).toBe(
      'Monster,S,1,4,4,2,Paper,"Goblin, ""King""",2,"Goblin, ""King""|4|Paper"',
    );
  });

  it("uses a stable column union and blanks fields not present on another deck", () => {
    const code = `${PROJECT}${src(
      "Sheet: Other",
      "  column flavor: Text",
      "Template: U",
      "  Text:",
      "    x: 0",
      "    y: 0",
      "    size: 1",
      '    text: "other"',
      "Card: OtherCard",
      "  sheet: Other",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: U",
    )}`;
    const output = buildDataExport(
      compileProject(code, {
        S: [{ name: "Goblin", count: "1" }],
        Other: [{ flavor: "mint" }],
      }).model,
    );
    expect(output.filename).toBe("cardgoblin-data.csv");
    const lines = output.csv.trimEnd().split("\r\n");
    expect(lines[0]).toContain("name,count,card_code,flavor");
    expect(lines.at(-1)).toBe("OtherCard,Other,1,1,3,1,,,,,mint");
  });

  it("always emits a header and CRLF termination for an empty model", () => {
    const output = buildDataExport({ decks: [] });
    expect(output.csv).toBe("@card,@sheet,@row,@card_number,@project_card,@copy\r\n");
    expect(dataExportFileName({ decks: [] })).toBe("cardgoblin-data.csv");
  });
});

describe("ExportDataButton", () => {
  it("is explicit and disabled when there are no cards", () => {
    const markup = renderToStaticMarkup(
      <ExportDataButton disabled onExport={() => {}} />,
    );
    expect(markup).toContain("Export Data");
    expect(markup).toContain("disabled");
    expect(markup).toContain("one CSV row for every generated card instance");
  });
});
