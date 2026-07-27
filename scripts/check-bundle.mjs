#!/usr/bin/env node
// Post-build guard: fails if any client bundle contains a value-shaped
// service-role or secret literal. Bare library prefixes such as
// "sb_secret_" (used by @supabase/supabase-js for format checks) are
// intentionally NOT flagged; only value-shaped literals are.
//
// A legacy anon key and a legacy service-role key share the same wire
// format (JWT) and differ only in the `role` claim, so this guard decodes
// JWT-shaped matches rather than pattern-matching them. If this project
// later migrates to sb_publishable_ / sb_secret_ keys, this needle can be
// simplified.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const CANDIDATES = ["dist/client", ".output/public", "dist"];
let DIR = null;
for (const c of CANDIDATES) {
  const p = join(ROOT, ...c.split("/"));
  if (existsSync(p)) { DIR = p; break; }
}

const STRING_NEEDLES = [
  { name: "SERVICE_ROLE",             re: /SERVICE_ROLE/g },
  { name: "service_role",             re: /service_role/g },
  { name: "sb_secret_ value literal", re: /sb_secret_[A-Za-z0-9_-]{12,}/g },
];
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./g;

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

if (!existsSync(DIR)) {
  console.error(`check-bundle: ${relative(ROOT, DIR)} does not exist — did the build run?`);
  process.exit(1);
}

const hits = [];

function scan(file, buf) {
  const rel = relative(ROOT, file);
  for (const n of STRING_NEEDLES) {
    const m = buf.match(n.re);
    if (m) hits.push(`${rel}  matches ${n.name}`);
  }
  let jm;
  JWT_RE.lastIndex = 0;
  while ((jm = JWT_RE.exec(buf))) {
    const parts = jm[0].split(".");
    if (parts.length < 2) continue;
    let payload;
    try {
      payload = JSON.parse(b64urlDecode(parts[1]));
    } catch {
      continue; // ignore anything that doesn't decode/parse
    }
    if (payload && payload.role === "service_role") {
      hits.push(`${rel}  JWT with role="${payload.role}"`);
    }
    // role === "anon" | "authenticated" | anything else: ignored
  }
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else {
      let buf;
      try { buf = readFileSync(p, "utf8"); } catch { continue; }
      scan(p, buf);
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
