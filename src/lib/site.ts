/**
 * Site-wide identity and URLs — one place, because SEO metadata repeats them
 * everywhere: canonical links, OpenGraph, JSON-LD, the sitemap, the RSS feed.
 *
 * The production fallback is the canonical public domain. Preview deployments
 * can override it with `NEXT_PUBLIC_SITE_URL`; otherwise canonical URLs remain
 * on production instead of fragmenting search signals across preview hosts.
 */

/** Absolute origin, no trailing slash. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.cardgoblin.com"
).replace(/\/$/, "");

export const SITE_NAME = "Card Goblin";

/** The default meta description — overridden per page where there's better. */
export const SITE_DESCRIPTION =
  "CardGoblin turns a small script plus a spreadsheet into print-at-home cards. " +
  "Design a card once, generate the whole deck, and export a true-to-size PDF — free, in your browser.";

/** Short form for OpenGraph/Twitter cards, which truncate aggressively. */
export const SITE_TAGLINE = "Script + spreadsheet → print-at-home cards";

export const REPO_URL = "https://github.com/eduAguilar96/card-goblin";

/** Default author for posts that don't name one. */
export const DEFAULT_AUTHOR = "Eduardo Aguilar";

/** Absolute URL for a site-relative path (`/blog/x` → `https://…/blog/x`). */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
