/**
 * Site-wide identity and URLs — one place, because SEO metadata repeats them
 * everywhere: canonical links, OpenGraph, JSON-LD, the sitemap, the RSS feed.
 *
 * ⚠ `SITE_URL` is a PLACEHOLDER until the real domain is decided. Canonical
 * URLs, share-card images, sitemap entries, and feed links are all built from
 * it, so a wrong value doesn't break the build — it quietly points search
 * engines and social previews at a domain that isn't yours. Set
 * `NEXT_PUBLIC_SITE_URL` in the deployment environment, or edit the fallback.
 */

/** Absolute origin, no trailing slash. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardgoblin.app"
).replace(/\/$/, "");

export const SITE_NAME = "Card Goblin";

/** The default meta description — overridden per page where there's better. */
export const SITE_DESCRIPTION =
  "CardGoblin turns a small script plus a spreadsheet into print-ready cards. " +
  "Design a card once, generate the whole deck, export a print-ready PDF — free, in your browser.";

/** Short form for OpenGraph/Twitter cards, which truncate aggressively. */
export const SITE_TAGLINE = "Script + spreadsheet → print-ready cards";

export const REPO_URL = "https://github.com/eduAguilar96/card-goblin";

/** Default author for posts that don't name one. */
export const DEFAULT_AUTHOR = "Eduardo Aguilar";

/** Absolute URL for a site-relative path (`/blog/x` → `https://…/blog/x`). */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
