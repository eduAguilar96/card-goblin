/**
 * Wiki markdown — the shared renderer wired to the docs link resolver.
 *
 * Wiki pages link each other with relative `.md` paths so they stay browsable
 * on GitHub; `resolveDocHref` turns those into `/docs/<slug>` and sends
 * anything outside the wiki to GitHub. All the styling lives in the shared
 * component (`@/app/_components/markdown`), which the blog uses too.
 */

import type { ReactElement } from "react";
import ContentMarkdown from "@/app/_components/markdown";
import { resolveDocHref } from "@/lib/docs/nav";
import { REPO_URL } from "@/lib/site";

export default function DocMarkdown({
  body,
  section,
}: {
  /** Markdown source, frontmatter already stripped. */
  body: string;
  /** The page's section id — needed to resolve its relative links. */
  section: string;
}): ReactElement {
  return (
    <ContentMarkdown
      body={body}
      resolveHref={(href) => resolveDocHref(href, section, REPO_URL)}
    />
  );
}
