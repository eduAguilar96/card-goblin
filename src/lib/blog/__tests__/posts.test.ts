import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatMonth,
  parsePost,
  parsePostFileName,
  published,
  readingMinutes,
  sortPosts,
  toRfc822,
  type PostMeta,
} from "@/lib/blog/posts";

const FILE = "2026-08-06-dicemancy.md";
const GOOD = `---
title: "Dicemancy: a design log"
description: How a dice game got its deck.
tags: design log, dicemancy
---

# Dicemancy: a design log

Body text.
`;

function meta(overrides: Partial<PostMeta> & Pick<PostMeta, "slug" | "date">): PostMeta {
  return {
    title: overrides.slug,
    description: "…",
    updated: null,
    author: "Someone",
    tags: [],
    hero: null,
    draft: false,
    readingMinutes: 1,
    ...overrides,
  };
}

describe("parsePostFileName", () => {
  it("splits the date prefix from the slug", () => {
    expect(parsePostFileName("2026-08-06-dicemancy-design-log.md")).toEqual({
      date: "2026-08-06",
      slug: "dicemancy-design-log",
    });
  });

  it("rejects a filename with no date prefix", () => {
    expect(parsePostFileName("dicemancy.md")).toBeNull();
  });

  it("rejects an impossible date", () => {
    expect(parsePostFileName("2026-13-45-nope.md")).toBeNull();
  });
});

describe("parsePost", () => {
  it("takes the date from the filename and the rest from frontmatter", () => {
    const post = parsePost(GOOD, FILE);
    expect(post.slug).toBe("dicemancy");
    expect(post.date).toBe("2026-08-06");
    expect(post.title).toBe("Dicemancy: a design log");
    expect(post.tags).toEqual(["design log", "dicemancy"]);
    expect(post.draft).toBe(false);
    expect(post.updated).toBeNull();
  });

  it("defaults the author and reports reading time", () => {
    const post = parsePost(GOOD, FILE);
    expect(post.author).not.toBe("");
    expect(post.readingMinutes).toBeGreaterThanOrEqual(1);
  });

  it("reads draft: true", () => {
    expect(parsePost(GOOD.replace("tags:", "draft: true\ntags:"), FILE).draft).toBe(true);
  });

  it("throws on a missing required field", () => {
    const raw = GOOD.replace("description: How a dice game got its deck.\n", "");
    expect(() => parsePost(raw, FILE)).toThrow(/missing "description"/);
  });

  it("throws on a non-date `updated`", () => {
    const raw = GOOD.replace("tags:", "updated: soon\ntags:");
    expect(() => parsePost(raw, FILE)).toThrow(/not a YYYY-MM-DD date/);
  });

  it("throws on a filename with no date, naming the file", () => {
    expect(() => parsePost(GOOD, "dicemancy.md")).toThrow(/dicemancy\.md/);
  });
});

describe("readingMinutes", () => {
  it("is at least one minute for anything", () => {
    expect(readingMinutes("hi")).toBe(1);
  });

  it("does not count code blocks at prose speed", () => {
    const prose = "word ".repeat(220);
    const withCode = `${prose}\n\n\`\`\`\n${"code ".repeat(2000)}\n\`\`\`\n`;
    expect(readingMinutes(withCode)).toBe(readingMinutes(prose));
  });
});

describe("sortPosts / published", () => {
  const posts = [
    meta({ slug: "old", date: "2026-01-01" }),
    meta({ slug: "new", date: "2026-08-06" }),
    meta({ slug: "hidden", date: "2026-09-01", draft: true }),
  ];

  it("orders newest first", () => {
    expect(sortPosts(posts).map((p) => p.slug)).toEqual(["hidden", "new", "old"]);
  });

  it("does not mutate its input", () => {
    const before = posts.map((p) => p.slug);
    sortPosts(posts);
    expect(posts.map((p) => p.slug)).toEqual(before);
  });

  it("drops drafts", () => {
    expect(published(posts).map((p) => p.slug)).toEqual(["old", "new"]);
  });
});

describe("date formatting", () => {
  it("formats in UTC so a published date can't shift a day", () => {
    expect(formatDate("2026-08-06")).toBe("August 6, 2026");
    expect(formatMonth("2026-08-06")).toBe("AUG 2026");
  });

  it("emits RFC-822 for RSS", () => {
    expect(toRfc822("2026-08-06")).toBe("Thu, 06 Aug 2026 00:00:00 GMT");
  });
});
