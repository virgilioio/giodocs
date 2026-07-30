#!/usr/bin/env node
// Fails the build if any file under src/ contains:
//   - a raw hex colour (#abc / #abcdef / #abcdefff)
//   - a raw px font-size utility such as text-[15px]
//   - a Lato weight utility other than 400/700
//     (font-medium, font-semibold, font-light, font-extralight, font-black)
//
// Exempts src/styles.css because that file holds the @theme block and is raw
// hex by definition.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const CWD = process.cwd();
const ROOT = join(CWD, "src");
// export.ts is exempt: it generates SELF-CONTAINED files (HTML/PDF) that
// cannot reference Tailwind tokens. Its hex values ARE the design tokens,
// serialized for the outside world — they must match src/styles.css @theme
// exactly. If you change a token there, change it here.
//
// avatar.ts is exempt: it ships ten literal skin/hair hexes for the portrait
// system. These are not brand tokens — they render a human face and must stay
// byte-identical in light and dark themes (see the theming rule in avatar.ts).
// A worn portrait's disc is also fixed to a light pastel literal there, for
// the same reason: hair contrast on the disc must not collapse in dark mode.
// custom-emoji-composer.tsx is exempt: its preview panel shows the emoji on
// TWO literal grounds — white and near-black — at the same time, so the
// uploader can see whether a transparent PNG survives both themes. Themed
// tokens would make half that preview a lie.
const EXEMPT = new Set([
  "src/components/custom-emoji-composer.tsx",
  "src/styles.css",
  "src/lib/export.ts",
  "src/lib/avatar.ts",
  "src/lib/avatar.test.ts",
]);
const EXT = /\.(?:tsx?|jsx?|mjs|cjs|css)$/;

const CHECKS = [
  { name: "raw hex colour", re: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "raw px font-size utility", re: /\btext-\[\d+(?:\.\d+)?px\]/ },
  {
    name: "forbidden Lato weight utility",
    re: /\bfont-(?:medium|semibold|light|extralight|black)\b/,
  },
];

let failed = false;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      walk(p);
      continue;
    }
    if (!EXT.test(name)) continue;
    const rel = relative(CWD, p).split(sep).join("/");
    if (EXEMPT.has(rel)) continue;
    const src = readFileSync(p, "utf8");
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { name: label, re } of CHECKS) {
        if (re.test(line)) {
          console.error(`${rel}:${i + 1}: ${label}`);
          console.error(`  ${line.trim()}`);
          failed = true;
        }
      }
    }
  }
}

walk(ROOT);

if (failed) {
  console.error("\nToken check failed.");
  process.exit(1);
}
console.log("Token check passed.");
