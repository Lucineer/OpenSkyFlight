// Guard the dependencies the renderer actually loads.
//
// WHY
//
// The two libraries this app cannot run without are not in package.json and
// not in package-lock.json:
//
//   three       -> a jsDelivr URL in the <script type="importmap"> of every
//                  HTML page
//   three-tile  -> a local fork, vendor/three-tile/.../three-tile-osf.js
//
// package-lock.json is real and pins 87 packages, and it contains neither.
// So `npm ci` gives a reproducible toolchain for a renderer whose actual
// versions are governed by a string in an HTML file.
//
// That makes one specific failure likely and expensive: the sim pins one
// three version and a game page pins another. The pages still load — an
// importmap resolves per-document — and then three and three-tile disagree
// about a shared internal, and the symptom is a null-dereference in terrain
// code that points nowhere near the cause. This check makes that impossible
// to merge rather than impossible to diagnose.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not query npm. A network call in a gate is a gate that fails for
// reasons unrelated to the code, and this check has to work on an air-gapped
// runner. Version currency is a human decision with a browser matrix attached;
// version CONSISTENCY is a mechanical fact and that is what this asserts.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
let failures = 0;
const ok = (m) => console.log(`  ok  ${m}`);
const fail = (m) => {
  failures++;
  console.log(`  FAIL ${m}`);
};

// --- collect every HTML page that declares an importmap ---------------------
function htmlFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'vendor' || e.name === 'cache' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const pages = htmlFiles(ROOT);
if (!pages.length) fail('no HTML pages found — the glob is wrong, not the repo');

// EVERY specifier, not a hand-picked list.
//
// An earlier version of this file checked only `three` and `three/webgpu`, and
// reported the repo as consistent while two game pages still pointed
// `three/addons/` and `stats.js` at a /cdn/ path that does not exist. Checking
// a chosen subset is the same mistake as checking a chosen subset of tests: it
// produces a green badge over an unchecked claim. So the specifier list is
// derived from the pages themselves, and an unresolvable local path is a
// hard failure in its own right.
const ROOT_REL = /^\/(?![/])/; // "/foo" but not "//host" (protocol-relative)
const DOC_REL = /^\.{1,2}\//; // "./vendor/..." or "../../vendor/..."
const pins = new Map(); // spec -> Map<page, value>
for (const page of pages) {
  const src = readFileSync(page, 'utf8');
  if (!src.includes('importmap')) continue;
  const rel = relative(ROOT, page);
  for (const [spec, v] of importmapEntries(src)) {
    if (!pins.has(spec)) pins.set(spec, new Map());
    pins.get(spec).set(rel, v);
  }
}

/** Every "spec": "value" pair inside the page's importmap. */
function importmapEntries(src) {
  const block = src.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!block) return [];
  let obj;
  try {
    obj = JSON.parse(block[1]);
  } catch {
    return [];
  }
  return Object.entries(obj?.imports ?? {});
}

if (!pins.size) {
  fail('no importmap pins found — expected a "three" entry in at least one page');
} else {
  for (const [spec, byPage] of pins) {
    // Split by kind. A document-relative path is CORRECTLY different between
    // index.html and games/<x>/index.html -- they sit at different depths -- so
    // demanding they match would be demanding a bug. The rule is: every
    // document-relative value must resolve to a real file *from its own page*,
    // and every absolute or URL value must be byte-identical everywhere.
    const docRel = new Map([...byPage].filter(([, v]) => DOC_REL.test(v)));
    const absolute = new Map([...byPage].filter(([, v]) => !DOC_REL.test(v)));

    for (const [page, v] of docRel) {
      const target = resolve(dirname(join(ROOT, page)), v);
      if (existsSync(target)) ok(`"${spec}" in ${page} -> ${v} (resolves)`);
      else fail(`"${spec}" in ${page} -> ${v} DOES NOT RESOLVE on disk`);
    }
    if (docRel.size === byPage.size) continue;

    const values = new Set(absolute.values());
    if (values.size > 1) {
      fail(
        `"${spec}" is pinned to ${values.size} DIFFERENT values: ` +
          [...absolute.entries()].map(([p, v]) => `${p} -> ${v}`).join(' | '),
      );
      continue;
    }
    const [value] = values;
    const shown = value.length > 58 ? value.slice(0, 55) + '...' : value;

    // A root-relative path means a file in THIS repo. If it is not on disk the
    // page 404s at runtime and renders a blank canvas behind a loading screen.
    // This is the check that would have caught the /cdn/ bug.
    if (ROOT_REL.test(value)) {
      const onDisk = existsSync(join(ROOT, value));
      if (onDisk) ok(`"${spec}" -> ${shown} (exists)`);
      else fail(`"${spec}" -> ${shown} IS NOT IN THE REPO — this 404s at runtime`);
      continue;
    }
    if (/^https?:\/\/cdn\.jsdelivr\.net\/npm\/three@/.test(value)) {
      const m = value.match(/three@([\w.]+)/);
      ok(`"${spec}" -> three@${m ? m[1] : '?'} across ${byPage.size} page(s)`);
    } else {
      ok(`"${spec}" -> ${shown} across ${byPage.size} page(s)`);
    }
  }
}

// --- the vendored terrain library must actually be there -------------------
const vendored = join(ROOT, 'vendor/three-tile/packages/lib/dist/three-tile-osf.js');
if (!existsSync(vendored)) {
  fail('vendor/three-tile/.../three-tile-osf.js is missing — terrain will 404 at runtime');
} else {
  const bytes = statSync(vendored).size;
  if (bytes < 20000) fail(`vendored three-tile is only ${bytes}B — that looks truncated`);
  else ok(`vendored three-tile fork present (${(bytes / 1024).toFixed(0)}KB)`);
}

// --- and the pages that use it must resolve the same file ------------------
let importers = 0;
for (const page of pages) {
  const src = readFileSync(page, 'utf8');
  if (src.includes('three-tile')) {
    importers++;
    if (!src.includes('three-tile-osf.js')) {
      fail(`${relative(ROOT, page)} references three-tile but not the vendored fork path`);
    }
  }
}
if (importers) ok(`${importers} page(s) reference the vendored three-tile fork`);

if (failures) {
  console.error(`\ncheck-runtime-deps: ${failures} problem(s).`);
  process.exit(1);
}
console.log(`\ncheck-runtime-deps: OK — renderer dependencies are consistent across ${pages.length} page(s).`);
