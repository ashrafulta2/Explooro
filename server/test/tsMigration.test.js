/**
 * tsMigration.test.js — the server is moving from .js to .ts file by file (docs/typescript-migration.md).
 *
 * WHY this test: Node runs .ts directly by stripping the types, but it never rewrites an import path.
 * When a file is renamed to .ts, every import of it that still ends in .js must be changed to end
 * in .ts. `tsc` does not catch a missed one, because NodeNext resolution quietly maps a .js path to
 * the .ts file, so the typecheck passes and the server fails at startup. This test fails instead.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'migrations', 'seeds']);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : sourceFiles(full);
    return /\.(js|ts)$/.test(e.name) ? [full] : [];
  });
}

// Static imports and re-exports, dynamic import(), and JSDoc import('...') types.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;

test('every relative import points at a file that exists', () => {
  const broken = [];
  for (const file of [...sourceFiles(path.join(SERVER_DIR, 'src')), ...sourceFiles(path.join(SERVER_DIR, 'test'))]) {
    const src = readFileSync(file, 'utf8');
    for (const [, spec] of src.matchAll(SPECIFIER)) {
      if (!existsSync(path.resolve(path.dirname(file), spec))) {
        broken.push(`${path.relative(SERVER_DIR, file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(broken, [], `imports that would fail at runtime:\n${broken.join('\n')}`);
});

test('.ts files use only syntax Node can strip', () => {
  const tsFiles = sourceFiles(path.join(SERVER_DIR, 'src')).filter((f) => f.endsWith('.ts'));
  assert.ok(tsFiles.length > 0, 'the migration has started, so at least one .ts file exists');
  const tsconfig = JSON.parse(readFileSync(path.join(SERVER_DIR, 'tsconfig.json'), 'utf8'));
  // erasableSyntaxOnly makes tsc refuse enum/namespace/parameter properties, which Node cannot run.
  assert.equal(tsconfig.compilerOptions.erasableSyntaxOnly, true);
  assert.equal(tsconfig.compilerOptions.verbatimModuleSyntax, true);
  assert.ok(tsconfig.include.includes('src/**/*.ts'), 'tsc checks the .ts files');
});
