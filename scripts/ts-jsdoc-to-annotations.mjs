#!/usr/bin/env node
/**
 * ts-jsdoc-to-annotations.mjs — moves JSDoc types into TypeScript annotations in server .ts files.
 *
 *   node scripts/ts-jsdoc-to-annotations.mjs src/services/a.service.ts src/services/b.service.ts
 *
 * WHY: inside a .ts file TypeScript ignores JSDoc types, so a file renamed from .js silently loses
 * the checking its `@param` / `@returns` / `@type` tags gave it (docs/typescript-migration.md). This
 * runs TypeScript's own "Annotate with type from JSDoc" quick fix (suggestion 80004) over each file,
 * the same edit an editor makes, until no suggestion is left.
 *
 * Not covered, so fix by hand when tsc complains: `@typedef` (write an exported `type`/`interface`)
 * and inline casts `/** @type {X} *\/ (expr)` (write `expr as X`).
 * The JSDoc comments stay, so their descriptions are kept.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');
const files = process.argv.slice(2).map((p) => path.resolve(SERVER, p));
if (files.length === 0 || files.some((f) => !f.endsWith('.ts'))) {
  console.error('usage: node scripts/ts-jsdoc-to-annotations.mjs <server-relative .ts paths...>');
  process.exit(1);
}

const configPath = path.join(SERVER, 'tsconfig.json');
const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, SERVER);

const texts = new Map();
const versions = new Map();
const read = (f) => (texts.has(f) ? texts.get(f) : ts.sys.readFile(f));
const service = ts.createLanguageService(
  {
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: (f) => String(versions.get(f) ?? 0),
    getScriptSnapshot: (f) => {
      const text = read(f);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => SERVER,
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: read,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  },
  ts.createDocumentRegistry()
);

const JSDOC_TYPES_MAY_BE_MOVED = 80004;
const norm = (f) => f.replace(/\\/g, '/');

for (const file of files) {
  const key = norm(file);
  let applied = 0;
  // One fix per pass: each edit shifts positions, so diagnostics are re-read after every change.
  for (let guard = 0; guard < 2000; guard += 1) {
    const diag = service.getSuggestionDiagnostics(key).find((d) => d.code === JSDOC_TYPES_MAY_BE_MOVED);
    if (!diag) break;
    const fixes = service.getCodeFixesAtPosition(key, diag.start, diag.start + diag.length, [diag.code], {}, {});
    const fix = fixes.find((f) => f.fixName === 'annotateWithTypeFromJSDoc') ?? fixes[0];
    if (!fix) break;
    let text = read(key);
    for (const change of fix.changes) {
      if (norm(change.fileName) !== key) continue;
      for (const tc of [...change.textChanges].sort((a, b) => b.span.start - a.span.start)) {
        text = text.slice(0, tc.span.start) + tc.newText + text.slice(tc.span.start + tc.span.length);
      }
    }
    texts.set(key, text);
    versions.set(key, (versions.get(key) ?? 0) + 1);
    applied += 1;
  }
  if (applied) {
    // The quick fix writes \n; keep the file's own line endings.
    const original = readFileSync(file, 'utf8');
    let out = texts.get(key);
    if (original.includes('\r\n')) out = out.replace(/\r?\n/g, '\r\n');
    writeFileSync(file, out);
  }
  console.log(`${path.relative(SERVER, file)}: ${applied} annotation(s)`);
}
