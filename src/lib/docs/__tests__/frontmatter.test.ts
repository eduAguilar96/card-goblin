import { describe, expect, it } from "vitest";
import { parseDocFile, stripLeadingHeading } from "@/lib/docs/frontmatter";

const GOOD = `---
title: Quickstart
status: stable
summary: The five-minute tour.
---

# Quickstart

Body text.
`;

describe("parseDocFile", () => {
  it("reads the fields and returns the body without the frontmatter", () => {
    expect(parseDocFile(GOOD, "test.md")).toEqual({
      title: "Quickstart",
      status: "stable",
      summary: "The five-minute tour.",
      body: "# Quickstart\n\nBody text.",
    });
  });

  it("tolerates CRLF line endings and a BOM", () => {
    const raw = "﻿" + GOOD.replace(/\n/g, "\r\n");
    expect(parseDocFile(raw, "test.md").title).toBe("Quickstart");
  });

  it("keeps colons in a value", () => {
    const raw = GOOD.replace("summary: The five-minute tour.", "summary: A: then B");
    expect(parseDocFile(raw, "test.md").summary).toBe("A: then B");
  });

  it("strips a surrounding quote pair", () => {
    const raw = GOOD.replace("summary: The five-minute tour.", 'summary: "Quoted."');
    expect(parseDocFile(raw, "test.md").summary).toBe("Quoted.");
  });

  it("throws when the frontmatter block is missing", () => {
    expect(() => parseDocFile("# Just a heading", "test.md")).toThrow(/missing frontmatter/);
  });

  it("throws when a required field is missing", () => {
    const raw = GOOD.replace("summary: The five-minute tour.\n", "");
    expect(() => parseDocFile(raw, "test.md")).toThrow(/missing "summary"/);
  });

  it("throws when a required field is present but empty", () => {
    const raw = GOOD.replace("title: Quickstart", "title:");
    expect(() => parseDocFile(raw, "test.md")).toThrow(/missing "title"/);
  });

  it("throws on an unknown status", () => {
    const raw = GOOD.replace("status: stable", "status: wip");
    expect(() => parseDocFile(raw, "test.md")).toThrow(/must be stable, evolving, or planned/);
  });

  it("names the offending file in every message", () => {
    expect(() => parseDocFile("nope", "reference/03-icons.md")).toThrow(
      /reference\/03-icons\.md/,
    );
  });
});

describe("stripLeadingHeading", () => {
  it("removes the opening h1 so the title isn't printed twice", () => {
    expect(stripLeadingHeading("# Quickstart\n\nBody.")).toBe("Body.");
  });

  it("leaves later headings alone", () => {
    expect(stripLeadingHeading("# A\n\n## B\n\ntext")).toBe("## B\n\ntext");
  });

  it("leaves a body that doesn't start with a heading alone", () => {
    expect(stripLeadingHeading("Body.\n\n# Later")).toBe("Body.\n\n# Later");
  });
});
