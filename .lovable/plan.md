## Diagnosis

The dev server on localhost returns 200 — the 500 is only on the deployed preview worker (`id-preview--*.lovable.app`). Preview worker logs show the real cause:

```
Error: No such module "assets/react".
  imported from "assets/server-BYr2oNt3.js"
```

The deployed worker was built with React (and likely other deps) **externalized** instead of bundled. Cloudflare Workers have no runtime module resolution, so any externalized import crashes on first request. This is exactly the failure mode the `server-runtime` knowledge card warns about.

Root cause: `nitro: false` in `vite.config.ts`. The Lovable Vite preset uses the `nitro` plugin (with Cloudflare target) to bundle the SSR/Worker entry. Disabling it leaves an unbundled server chunk with bare `assets/react` imports — fine locally (Vite dev resolves everything), fatal in the deployed Worker.

`nitro: false` was added earlier to work around a prerender failure, but the real fix for that was SPA mode (`tanstackStart.spa.enabled = true`), which is already in place. The nitro override is now both unnecessary and actively breaking the preview.

## Fix

Edit `vite.config.ts` — remove the `nitro: false` line so the preset's default (nitro on, Cloudflare target) bundles the Worker properly:

```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    spa: { enabled: true },
  },
});
```

That is the only code change. Then let the preview rebuild and confirm `/` returns 200 with the app HTML (no `assets/react` error in worker logs).

## If the prerender error returns

If removing `nitro: false` brings back the original prerender failure that motivated it, the correct fix is not to re-disable nitro. Options in order of preference:
1. Confirm SPA mode is actually taking effect (it should skip prerendering all routes).
2. Add `tanstackStart.prerender = { enabled: false }` explicitly.
3. Investigate the specific route that fails prerender.

I'll only pursue these if step 1 (removing `nitro: false`) reintroduces the earlier error.

## Files changed
- `vite.config.ts`