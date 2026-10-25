/**
 * tsMigration.test.js — the client is moving from .js to .ts file by file (docs/typescript-migration.md).
 *
 * WHY this test: Vite would happily resolve a stale `./x.js` import to `x.ts` in the browser, but
 * `node --test` does not, and `tsc` (Bundler resolution) does not complain either. So a file renamed
 * to .ts whose importer still says `.js` passes the typecheck and the build, and only breaks the
 * tests that import it, or a later tool. This test fails on every such import, in one place.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(js|ts)$/.test(e.name) ? [full] : [];
  });
}

// Static imports and re-exports, dynamic import(), and JSDoc import('...') types. CSS and JSON
// imports are files too, so they are checked the same way.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;

test('every relative import points at a file that exists', () => {
  const broken = [];
  for (const file of [...sourceFiles(path.join(CLIENT_DIR, 'src')), ...sourceFiles(path.join(CLIENT_DIR, 'test'))]) {
    const src = readFileSync(file, 'utf8');
    for (const { 1: spec, index } of src.matchAll(SPECIFIER)) {
      // Usage examples in doc comments (` *   import { t } from './services/i18n.js'`) are not imports.
      const line = src.slice(src.lastIndexOf('\n', index) + 1, index);
      if (/^\s*(\*|\/\/)/.test(line)) continue;
      const clean = spec.replace(/\?.*$/, ''); // Vite query suffixes such as ?raw
      if (!existsSync(path.resolve(path.dirname(file), clean))) {
        broken.push(`${path.relative(CLIENT_DIR, file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(broken, [], `imports that would fail outside Vite:\n${broken.join('\n')}`);
});

test('.ts files use only syntax Node can strip, and tsc checks them', () => {
  const tsconfig = JSON.parse(readFileSync(path.join(CLIENT_DIR, 'tsconfig.json'), 'utf8'));
  // erasableSyntaxOnly makes tsc refuse enum/namespace/parameter properties, which `node --test` cannot run.
  assert.equal(tsconfig.compilerOptions.erasableSyntaxOnly, true);
  assert.equal(tsconfig.compilerOptions.verbatimModuleSyntax, true);
  assert.ok(tsconfig.include.includes('src/**/*.ts'), 'tsc checks the .ts files');
});
