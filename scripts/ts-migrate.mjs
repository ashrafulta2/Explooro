#!/usr/bin/env node
/**
 * ts-migrate.mjs — moves server files from .js to .ts, one batch at a time (docs/typescript-migration.md).
 *
 *   node scripts/ts-migrate.mjs src/services/a.service.js src/repositories/b.repository.js
 *
 * Paths are relative to server/. For each file it:
 *   1. renames it with `git mv`, so history follows the file;
 *   2. drops a leading `// @ts-check` (a .ts file is always checked) and renames the file in its own header;
 *   3. rewrites every relative string literal in server/src and server/test that resolves to a moved
 *      file, from `.js` to `.ts`. Imports, dynamic import(), JSDoc import('...') types and
 *      `new URL('../src/...', import.meta.url)` are all string literals, so all are covered.
 *
 * WHY it resolves each path instead of matching the file name: two directories can hold files with the
 * same name, and only the one that was moved may change.
 *
 * It does NOT move JSDoc types into annotations (TypeScript ignores JSDoc in a .ts file) and does not
 * touch prose. It prints the remaining mentions of the old names so they can be fixed by hand.
 * Line endings are preserved: files are read and written as raw strings.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server');
const SKIP = new Set(['node_modules', 'migrations', 'seeds']);

const targets = process.argv.slice(2).map((p) => path.resolve(SERVER, p));
if (targets.length === 0) {
  console.error('usage: node scripts/ts-migrate.mjs <server-relative .js paths...>');
  process.exit(1);
}
for (const file of targets) {
  if (!file.endsWith('.js') || !existsSync(file)) throw new Error(`not an existing .js file: ${file}`);
}
const moved = new Set(targets);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : sourceFiles(full);
    return /\.(js|ts|mjs)$/.test(e.name) ? [full] : [];
  });
}

// 1 + 2: rename and clean the header.
for (const file of targets) {
  const next = file.replace(/\.js$/, '.ts');
  execFileSync('git', ['mv', file, next], { cwd: SERVER });
  let src = readFileSync(next, 'utf8');
  src = src.replace(/^\/\/ @ts-check\r?\n/, '');
  const oldName = path.basename(file);
  const head = src.slice(0, 400).replace(` * ${oldName}`, ` * ${path.basename(next)}`);
  writeFileSync(next, head + src.slice(400));
}

// 3: rewrite relative specifiers that point at a moved file. Files are scanned after the renames.
const LITERAL = /(['"])(\.{1,2}\/[^'"\r\n]+?)\.js\1/g;
let rewrites = 0;
for (const file of [...sourceFiles(path.join(SERVER, 'src')), ...sourceFiles(path.join(SERVER, 'test'))]) {
  const src = readFileSync(file, 'utf8');
  const out = src.replace(LITERAL, (whole, quote, stem) => {
    if (!moved.has(path.resolve(path.dirname(file), `${stem}.js`))) return whole;
    rewrites += 1;
    return `${quote}${stem}.ts${quote}`;
  });
  if (out !== src) writeFileSync(file, out);
}

console.log(`moved ${targets.length} file(s), rewrote ${rewrites} specifier(s)`);

// Prose and docs are left to a human; list where the old names still appear.
const names = targets.map((f) => path.basename(f));
const pattern = new RegExp(`\\b(${names.map((n) => n.replace(/\./g, '\\.')).join('|')})\\b`);
const docs = readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => path.join(ROOT, 'docs', f));
for (const file of [...sourceFiles(path.join(SERVER, 'src')), ...sourceFiles(path.join(SERVER, 'test')), ...docs]) {
  if (file.endsWith('prompt.md')) continue; // historical record; old names there stay true for their date
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (pattern.test(line)) console.log(`  still mentions old name: ${path.relative(ROOT, file)}:${i + 1}`);
  });
}
