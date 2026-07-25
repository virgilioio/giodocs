#!/usr/bin/env node
// Fails if client-reachable source (any src/** file NOT named *.server.ts)
// imports server-only Supabase modules, or references the service-role key.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const FORBIDDEN_IMPORT_PATTERNS = [
  /@\/integrations\/supabase\/(client\.server|auth-middleware|auth-attacher)\b/,
  /(?:^|['"`\s(])(?:\.{1,2}\/[^'"`\s]*?)(client\.server|auth-middleware|auth-attacher)(?:['"`\s)]|$)/,
];
const SECRET_PATTERNS = [/SUPABASE_SERVICE_ROLE_KEY/, /SERVICE_ROLE/];

// These are TanStack Start server entrypoints. They are not named *.server.ts,
// so the naming heuristic cannot classify them; exempt them explicitly. The
// real guarantee that the service-role key never ships lives in
// scripts/check-bundle.mjs, which inspects dist/client. Do NOT extend this
// allowlist — every other file under src/ keeps the rule.
const ENTRYPOINT_ALLOWLIST = new Set(["src/start.ts", "src/server.ts"]);

const IMPORT_RE =
  /(?:^|\s)(?:import\s[^'"`]*from\s*|import\s*|require\s*\(\s*|import\s*\(\s*)['"`]([^'"`]+)['"`]/g;

const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) check(p);
  }
}

function check(file) {
  const rel = relative(ROOT, file);
  const isServer = /\.server\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file);
  if (isServer) return;

  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");

  // (a) forbidden imports
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text))) {
    const spec = m[1];
    const hit =
      /@\/integrations\/supabase\/(client\.server|auth-middleware|auth-attacher)$/.test(spec) ||
      /(?:^|\/)(client\.server|auth-middleware|auth-attacher)$/.test(spec);
    if (hit) {
      const line = text.slice(0, m.index).split("\n").length;
      violations.push(`${rel}:${line}  forbidden import "${spec}"`);
    }
  }

  // (b) secret references
  lines.forEach((ln, i) => {
    for (const re of SECRET_PATTERNS) {
      if (re.test(ln)) {
        violations.push(`${rel}:${i + 1}  forbidden token "${re.source}"`);
        break;
      }
    }
  });
}

walk(SRC);

if (violations.length) {
  console.error("check-server-only: violations found");
  for (const v of violations) console.error("  " + v);
  process.exit(1);
} else {
  console.log("check-server-only: OK");
}
