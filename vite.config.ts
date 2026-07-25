// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// SPA mode forces a shell prerender that the nitro-cloudflare worker output
// doesn't cooperate with (preview server can't find dist/server/server.js).
// Instead, keep nitro on (so React is bundled into the deployed worker) and
// let TanStack handle "/" as a normal SSR-rendered route at request time.
export default defineConfig({});
