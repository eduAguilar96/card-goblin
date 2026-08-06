/**
 * Frontmatter for wiki pages — pure, no dependencies.
 *
 * A hand-rolled reader rather than a YAML library, because the schema is four
 * flat string keys and will stay that way; the parse is ~20 lines and cannot
 * surprise us. If frontmatter ever needs nesting or lists, swap this for
 * `gray-matter` — `parseDocFile` is the only seam that would change.
 *
 *   ---
 *   title: Quickstart
 *   status: stable
 *   summary: Build a working deck end to end in about five minutes.
 *   ---
 */

import { isDocStatus, type DocStatus } from "./nav";

export interface ParsedDocFile {
  title: string;
  status: DocStatus;
  summary: string;
  body: string;
}

/** Everything a page must declare, so a missing key fails loudly at build. */
const REQUIRED_KEYS = ["title", "status", "summary"] as const;

/**
 * Split a wiki markdown file into its frontmatter and body.
 *
 * Throws on malformed or incomplete frontmatter: these files are authored in
 * the repo and built ahead of time, so a broken page should break the build
 * rather than ship a page titled `undefined`.
 */
export function parseDocFile(raw: string, sourceName: string): ParsedDocFile {
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
    const key = line.slice(0, separator).trim();
    // Quotes are optional; strip a matching surrounding pair so a summary
    // containing a colon can be written quoted.
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^(["'])([\s\S]*)\1$/, "$2");
    fields[key] = value;
  }

  for (const key of REQUIRED_KEYS) {
    if ((fields[key] ?? "") === "") {
      throw new Error(`${sourceName}: frontmatter is missing "${key}"`);
    }
  }
  if (!isDocStatus(fields.status)) {
    throw new Error(
      `${sourceName}: status "${fields.status}" must be stable, evolving, or planned`,
    );
  }

  return {
    title: fields.title,
    status: fields.status,
    summary: fields.summary,
    body: normalized.slice(match[0].length).trim(),
  };
}

/**
 * Drop a body's opening `# Heading`.
 *
 * Pages keep their `# Title` so they read as complete documents on GitHub, but
 * the site renders the title from frontmatter (alongside the status badge and
 * summary), so leaving it in the body would print it twice.
 */
export function stripLeadingHeading(body: string): string {
  return body.replace(/^#\s+.*(\n+|$)/, "").trimStart();
}
