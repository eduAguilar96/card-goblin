import type { NextConfig } from "next";

/**
 * Serverless-function tracing.
 *
 * `src/lib/blog/load.ts` and `src/lib/docs/pages.ts` read content with
 * `readdirSync(join(process.cwd(), …))`. Those paths are only knowable at
 * runtime, so Vercel's tracer (@vercel/nft) cannot follow them and widens its
 * include for every function containing those modules — which is how
 * `/blog/rss.xml` (a Route Handler, hence a function even though it is
 * `force-static`) ballooned to 295 MB and blew the 250 MB limit.
 *
 * These excludes name things that provably cannot run inside a server
 * function. Each entry is justified, because a wrong one here fails at
 * request time in production rather than at build:
 *
 * - `monaco-editor` (98 MB) — imported ONLY as `import type` (goblinLanguage,
 *   windowCode), so it is erased at compile time; the editor itself is fetched
 *   from a CDN in the browser. It is not even a declared dependency, just a
 *   peer of @monaco-editor/react.
 * - `typescript`, `@typescript-eslint`, `eslint*`, `@rolldown`, `vitest` —
 *   build/lint/test toolchain, never imported by application code.
 * - `pdf-lib` (23 MB) — only reachable from `pdfAssemble.ts`, which runs in
 *   the browser behind the export modal. `/editor` is prerendered as static
 *   HTML, so no server function needs it.
 * - `docs/vendor/**` (8.7 MB) — the vendored Dicier package (OTFs + the PDF
 *   user guide). Read only by scripts/generate-dicier-codes.mjs at authoring
 *   time; the shipped woff2s live under src/app/fonts/dicier.
 *
 * Deliberately NOT excluded: `@img`/sharp, which next/og uses at build time to
 * render the blog's OpenGraph images, and src/app/fonts, which next/font reads.
 *
 * The structural fix — making the content reads statically traceable so nft
 * includes exactly the .md files and nothing else — is the better answer and
 * is tracked as follow-up work; this keeps deploys under the limit meanwhile.
 */
const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "**/*": [
      "node_modules/monaco-editor/**",
      "node_modules/typescript/**",
      "node_modules/@typescript-eslint/**",
      "node_modules/eslint/**",
      "node_modules/eslint-config-next/**",
      "node_modules/@rolldown/**",
      "node_modules/vitest/**",
      "node_modules/@vitest/**",
      "node_modules/pdf-lib/**",
      "docs/vendor/**",
    ],
  },
};

export default nextConfig;
