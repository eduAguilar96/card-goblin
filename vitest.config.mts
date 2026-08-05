import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's `@/*` → `./src/*` so store/app modules are testable.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // tsconfig says `jsx: "preserve"` (Next transforms JSX itself); vitest gets
  // no such pass, so transform .tsx to the automatic runtime here (component
  // tests render with react-dom/server — no extra deps).
  oxc: { jsx: { runtime: "automatic" } },
});
