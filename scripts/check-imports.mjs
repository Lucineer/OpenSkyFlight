#!/usr/bin/env node

// Verify every relative import in js/ resolves to a file on disk.
//
// Why this exists: js/ is served as native ES modules (see the importmap in
// index.html), so a relative specifier pointing at a file that does not exist
// is a runtime 404 in the browser — eslint parses fine and never notices.
// A real instance was js/ui/SplashScreen.js importing './Logger.js' when
// Logger.js lives in js/utils/. That module happened to be unimported, which
// is the only reason it never broke anything in the field.
//
// Bare specifiers ('three', 'three/tsl', 'three-tile', 'stats.js') are
// deliberately skipped: they are resolved by the browser importmap, not by
// this script. We only validate the local graph.
//
// Usage: node scripts/check-imports.mjs [rootDir]
// Exits non-zero and prints every unresolved specifier.

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';

const ROOT = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
// Check the main app AND every standalone mini-game. Games live one level
// deeper (games/<id>/js/), so their relative specifiers have a different depth
// and are exactly where a wrong-directory-level import hides.
const SRC_DIRS = [join(ROOT, 'js'), join(ROOT, 'games')].filter(existsSync);

if (SRC_DIRS.length === 0) {
  console.error(`check-imports: no js/ or games/ directory under ${ROOT}`);
  process.exit(2);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith('.js')) out.push(p);
  }
  return out;
}

// Match: import ... from 'x' | export ... from 'x' | import 'x'
const SPEC_RE = /(?:^|\s)(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

const files = SRC_DIRS.flatMap((d) => walk(d)).sort();
const failures = [];
let checked = 0;

for (const file of files) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
    // Strip block and line comments: JSDoc usage examples are not real imports.
    src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  SPEC_RE.lastIndex = 0;
  let m;
  while ((m = SPEC_RE.exec(src)) !== null) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue; // bare specifier -> importmap/browser
    checked++;
    const target = resolve(dirname(file), spec);
    if (!existsSync(target)) {
      failures.push({ file: relative(ROOT, file), spec, target: relative(ROOT, target) });
    }
  }
}

if (failures.length) {
  console.error(`\ncheck-imports: ${failures.length} unresolved relative import(s):\n`);
  for (const f of failures) {
    console.error(`  ${f.file}`);
    console.error(`    imports '${f.spec}'  ->  ${f.target} (not found)\n`);
  }
  console.error(`Check the path — a wrong directory level here is a browser 404, not a lint error.`);
  process.exit(1);
}

console.log(`check-imports: OK — ${checked} relative import(s) across ${files.length} file(s) all resolve.`);
