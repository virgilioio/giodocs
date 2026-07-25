#!/usr/bin/env node
// Post-build guard: fails if any client bundle contains service-role markers.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const DIR = join(ROOT, "dist", "client");
const NEEDLES = ["SERVICE_ROLE", "service_role", "sb_secret_"];

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
        if (buf.includes(n)) hits.push(`${relative(ROOT, p)}  contains "${n}"`);
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
