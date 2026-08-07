/**
 * Wiki-page frontmatter — the docs schema on top of the shared parse.
 *
 *   ---
 *   title: Quickstart
 *   status: stable
 *   summary: Build a working deck end to end in about five minutes.
 *   ---
 *
 * The generic reader lives in `@/lib/content/frontmatter` (shared with the
 * blog); this module owns only what "a wiki page" means.
 */

import { parseFrontmatter, requireField } from "@/lib/content/frontmatter";
import { isDocStatus, type DocStatus } from "./nav";

export { stripLeadingHeading } from "@/lib/content/frontmatter";

export interface ParsedDocFile {
  title: string;
  status: DocStatus;
  summary: string;
  body: string;
}

/**
 * Split a wiki markdown file into its frontmatter and body.
 *
 * Throws on anything malformed or incomplete: pages are authored in the repo
 * and built ahead of time, so a broken page should break the build.
 */
export function parseDocFile(raw: string, sourceName: string): ParsedDocFile {
  const { fields, body } = parseFrontmatter(raw, sourceName);

  const title = requireField(fields, "title", sourceName);
  const summary = requireField(fields, "summary", sourceName);
  const status = requireField(fields, "status", sourceName);
  if (!isDocStatus(status)) {
    throw new Error(
      `${sourceName}: status "${status}" must be stable, evolving, or planned`,
    );
  }

  return { title, status, summary, body };
}
