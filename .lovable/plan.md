## Problem

The Supabase integration files (`client.ts`, `client.server.ts`, `auth-middleware.ts`) were generated when Supabase was connected, but the `@supabase/supabase-js` npm package is not listed in `package.json`. TypeScript and the production build both fail with `Cannot find module '@supabase/supabase-js'`.

## Fix

1. Install `@supabase/supabase-js` as a dependency.
2. Re-run the build to confirm both the typecheck and `build:dev` pass.

No code changes needed — the integration files are correct, they just need their dependency.

## Note on GitHub

GitHub repo `virgilioio/giodocs` is indeed connected (git sync). Earlier check looked at the internal remote and missed it. Nothing to do there.