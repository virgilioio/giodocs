#!/usr/bin/env node
// Post-build guard: fails if any client bundle contains value-shaped
// service-role or JWT secret markers. Bare library prefixes like
// "sb_secret_" (used by @supabase/supabase-js for format checks) are
// intentionally NOT flagged; only value-shaped literals are.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const DIR = join(ROOT, "dist", "client");

const NEEDLES = [
  { name: "SERVICE_ROLE",              re: /SERVICE_ROLE/ },
  { name: "service_role",              re: /service_role/ },
  { name: "sb_secret_ value literal",  re: /sb_secret_[A-Za-z0-9_-]{12,}/ },
  { name: "JWT-shaped literal",        re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./ },
];

if (!existsSync(DIR)) {
  console.error(`check-bundle: ${relative(ROOT, DIR)} does not exist — did the build run?`);
  process.exit(1);
}

const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else {
      let buf;
      try {
        buf = readFileSync(p, "utf8");
      } catch {
        continue;
      }
      for (const n of NEEDLES) {
        const m = buf.match(n.re);
        if (m) hits.push(`${relative(ROOT, p)}  matches ${n.name}: "${m[0].slice(0, 80)}"`);
      }
    }
  }
}

walk(DIR);

if (hits.length) {
  console.error("check-bundle: forbidden strings in client bundle");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
} else {
  console.log("check-bundle: OK");
}
