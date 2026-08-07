/**
 * Frontmatter parsing shared by the wiki and the blog — pure, no dependencies.
 *
 * Deliberately schema-free: it returns raw string fields and the body, and
 * each domain validates its own keys on top (`lib/docs` wants status/summary,
 * `lib/blog` wants date/tags/draft). Forcing one schema onto two things that
 * legitimately differ is how shared layers turn into knots.
 *
 * Hand-rolled rather than a YAML library because the format is flat
 * `key: value` lines and will stay that way. If nesting or lists are ever
 * needed, this module is the only seam that changes.
 */

export interface ParsedFrontmatter {
  /** Raw string values, in file order. */
  fields: Record<string, string>;
  /** The markdown after the frontmatter block, trimmed. */
  body: string;
}

/**
 * Split a markdown file into its frontmatter fields and body.
 *
 * Throws on a missing or malformed block. These files are authored in the
 * repo and rendered at build time, so a broken one should fail the build
 * rather than ship a page titled `undefined`.
 */
export function parseFrontmatter(raw: string, sourceName: string): ParsedFrontmatter {
  const normalized = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (match === null) {
    throw new Error(`${sourceName}: missing frontmatter block (--- ... ---)`);
  }

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator === -1) {
      throw new Error(`${sourceName}: frontmatter line is not "key: value" — ${line}`);
    }
    fields[line.slice(0, separator).trim()] = unquote(line.slice(separator + 1).trim());
  }

  return { fields, body: normalized.slice(match[0].length).trim() };
}

/** Strip one matching surrounding quote pair, so values may contain colons. */
function unquote(value: string): string {
  return value.replace(/^(["'])([\s\S]*)\1$/, "$2");
}

/**
 * Read a field that must be present and non-empty.
 * `where` names the file so build failures point at the culprit.
 */
export function requireField(
  fields: Record<string, string>,
  key: string,
  where: string,
): string {
  const value = fields[key] ?? "";
  if (value === "") throw new Error(`${where}: frontmatter is missing "${key}"`);
  return value;
}

/** Read an optional field, falling back to `fallback`. */
export function optionalField(
  fields: Record<string, string>,
  key: string,
  fallback = "",
): string {
  const value = fields[key] ?? "";
  return value === "" ? fallback : value;
}

/** Parse a `a, b, c` field into a trimmed list; empty string → no items. */
export function listField(fields: Record<string, string>, key: string): string[] {
  const raw = fields[key] ?? "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** Parse a `true`/`false` field; anything else (or absent) → `fallback`. */
export function booleanField(
  fields: Record<string, string>,
  key: string,
  fallback = false,
): boolean {
  const raw = (fields[key] ?? "").toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

/**
 * Drop a body's opening `# Heading`.
 *
 * Files keep their `# Title` so they read as complete documents on GitHub,
 * but every route renders the title from frontmatter (with its badge, date,
 * or byline), so leaving it in the body would print it twice.
 */
export function stripLeadingHeading(body: string): string {
  return body.replace(/^#\s+.*(\n+|$)/, "").trimStart();
}
