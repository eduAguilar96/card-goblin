/**
 * Shared R2 key layout + presigned-URL TTLs (DESIGN.md §7.6).
 *
 * WHY THIS FILE EXISTS (fixed after an independent build-verification pass
 * caught it — C1): Next.js App Router route handlers (`route.ts` under
 * `src/app/api/**`) may ONLY export the recognized HTTP-method functions
 * (`GET`/`POST`/`PUT`/`DELETE`/...) plus a small set of route-config names
 * (`dynamic`, `revalidate`, `runtime`, ...). Next's generated route-shape
 * check (`.next/types/app/api/**`, built during `next build`) rejects any
 * OTHER export with a type error (`TS2344: ... not a valid Route export
 * field`). That check does not exist under a plain `tsc --noEmit` against
 * this project's own tsconfig (no `.next/types` yet), so exporting
 * `PROJECT_KEY`/`assetKey`/`PRESIGN_PUT_TTL_SECONDS` directly from
 * project/route.ts, assets/presign/route.ts, etc. compiled clean and passed
 * every test while silently failing the actual build — invisible until
 * someone ran `next build`. Every value routes need to SHARE with each
 * other (or with tests) now lives here instead.
 */

/** `projects/default/project.json` — the one project slot (§7.6). */
export const PROJECT_KEY = "projects/default/project.json";

export function assetKey(name: string): string {
  return `projects/default/assets/${name}`;
}

/** 5 minutes — long enough for a slow connection to finish one upload or
 * download, short enough that a leaked/logged URL doesn't stay live long. */
export const PRESIGN_PUT_TTL_SECONDS = 5 * 60;
export const PRESIGN_GET_TTL_SECONDS = 5 * 60;
