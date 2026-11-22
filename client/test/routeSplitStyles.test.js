/**
 * routeSplitStyles.test.js — every page that uses a route-split stylesheet actually loads it.
 *
 * WHY: to stay under the 70KB entry CSS budget, page stylesheets are not in main.css. They load
 * beside their page in main.ts's route `load()` (supplier.css, saler.css, editor.css, ...). The
 * failure mode is silent: a new page, or an old page that starts rendering a shared card, uses
 * `supplier-*` / `saler-*` classes but its route never loads the sheet. Opened from another page
 * that did load it, it looks fine; opened cold, it renders unstyled. Nothing else catches it.
 *
 * Folders do not tell you who needs a sheet (editor pages borrow supplier.css, the supplier social
 * kit borrows saler.css through FlyerStudio), so this walks the import graph the way the bundler
 * does: from each route's page module through every static and dynamic import.
 *
 * For each sheet that some route load()s:
 *   1. A "consumer" is a source file naming a class that only this sheet defines.
 *   2. The entry bundle (main.ts and its static imports) must reach no consumer, unless main.css
 *      still imports the sheet — the entry cannot wait for a route chunk.
 *   3. Every route whose page reaches a consumer must load the sheet: in its own load(), or from a
 *      file it reaches (a static `import '…css'` or a styles/load*Styles.ts loader).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const rel = (f) => path.relative(SRC, f).split(path.sep).join('/');

// Files that name these classes as data, not markup: page descriptions, API path strings, the
// scroll helper's selector list, theme preset ids. Matching them would invent consumers.
const NOT_MARKUP = new Set([
  'services/pageInfo.ts',
  'services/saler.api.ts',
  'services/ads.api.ts',
  'services/floatingScroll.ts',
  'services/colorRamp.ts',
  'services/themePalette.ts',
  'config/master-themes.ts',
  'config/theme-presets.ts',
]);

function walk(dir, keep, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const classesOf = (css) => new Set([...stripComments(css).matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

// Every hand-written sheet's classes (the generated macOS twins repeat them all, so skip those).
const sheets = Object.fromEntries(
  walk(path.join(SRC, 'styles'), (p) => p.endsWith('.css') && !/ui-macos/.test(p)).map((p) => [rel(p), fs.readFileSync(p, 'utf8')])
);
const owners = new Map();
for (const [file, css] of Object.entries(sheets)) {
  for (const c of classesOf(css)) {
    if (!owners.has(c)) owners.set(c, new Set());
    owners.get(c).add(file);
  }
}

const code = new Map(
  walk(SRC, (p) => /\.(ts|js)$/.test(p) && !p.includes(`${path.sep}mocks${path.sep}`)).map((p) => [path.resolve(p), fs.readFileSync(p, 'utf8')])
);

function importsOf(file, dynamic) {
  const src = code.get(file);
  const re = dynamic
    ? /import\(\s*['"](\.[^'"]+)['"]\s*\)/g
    : /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s+['"](\.[^'"]+\.(?:ts|js))['"]/g;
  const out = [];
  for (const m of src.matchAll(re)) {
    const target = path.resolve(path.dirname(file), m[1] || m[2]);
    if (code.has(target)) out.push(target);
  }
  return out;
}

function reach(start, withDynamic) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...importsOf(f, false));
    if (withDynamic) stack.push(...importsOf(f, true));
  }
  return seen;
}

const mainTs = path.resolve(SRC, 'main.ts');
const mainSrc = code.get(mainTs);
const mainCss = sheets['styles/main.css'] ?? fs.readFileSync(path.join(SRC, 'styles', 'main.css'), 'utf8');
const entry = reach(mainTs, false);

// Route table: each `path: '…'` with the load() line that follows it.
const routes = [...mainSrc.matchAll(/path:\s*'([^']+)'[^{}]*?load:\s*\(\)\s*=>\s*([^\n]+)/g)].map((m) => ({
  path: m[1],
  load: m[2],
  pages: [...m[2].matchAll(/import\('(\.\/pages\/[^']+)'\)/g)].map((x) => path.resolve(SRC, x[1])),
}));

const splitSheets = [...new Set([...mainSrc.matchAll(/import\('\.\/styles\/components\/([\w-]+\.css)'\)/g)].map((m) => m[1]))].sort();

test('route-split stylesheets reach every page that uses them', async (t) => {
  assert.ok(routes.length > 100, `expected the full route table, parsed ${routes.length}`);
  assert.ok(splitSheets.includes('supplier.css') && splitSheets.includes('saler.css'), 'supplier.css and saler.css are route-split');

  for (const sheet of splitSheets) {
    await t.test(sheet, () => {
      const key = `styles/components/${sheet}`;
      // Built by concatenation: written as one literal, the import-path checker in another test
      // reads it as a real relative import of a file named `${sheet}`.
      const routeImport = 'import(' + "'./" + key + "')";
      // Hyphenated names only: a bare word such as `.scorecard` also appears as a nav id or icon
      // key, which would invent consumers. Every page sheet's own classes are hyphenated anyway.
      const own = [...classesOf(sheets[key])].filter((c) => owners.get(c).size === 1 && c.includes('-'));
      const consumers = new Set(
        [...code.keys()].filter((f) => {
          if (NOT_MARKUP.has(rel(f)) || rel(f).startsWith('styles/')) return false;
          // Drop stylesheet specifiers first: `import('./styles/components/theme-studio.css')`
          // names the sheet, not a `.theme-studio` element.
          const src = code.get(f).replace(/['"][^'"\n]*\.css['"]/g, "''");
          return own.some((c) => new RegExp(`(^|[^\\w-])${c.replace(/-/g, '\\-')}($|[^\\w-])`).test(src));
        })
      );

      if (!mainCss.includes(`@import './components/${sheet}';`)) {
        const inEntry = [...consumers].filter((f) => entry.has(f)).map(rel);
        assert.deepEqual(inEntry, [], `${sheet} is not in main.css, yet the entry bundle renders its classes`);
      }

      const loadsSheet = (closure) => [...closure].some((f) => code.get(f).includes(`components/${sheet}'`));
      const missing = [];
      for (const route of routes) {
        for (const page of route.pages) {
          const closure = reach(page, true);
          const used = [...consumers].filter((f) => closure.has(f));
          if (!used.length) continue;
          if (route.load.includes(routeImport) || loadsSheet(closure)) continue;
          missing.push(`${route.path} (${rel(page)} reaches ${used.map(rel).join(', ')})`);
        }
      }
      assert.deepEqual(missing, [], `these routes render ${sheet} classes but never load it — add ${routeImport} to their load()`);
    });
  }
});
