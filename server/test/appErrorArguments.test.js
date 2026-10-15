/**
 * appErrorArguments.test.js — AppError(code, messageEn, messageBn?, details?).
 *
 * WHY: the third argument is the Bangla message, and the HTTP status comes from the error code
 * (ERROR_STATUS in plugins/errorHandler.ts). Seven files passed the status there instead
 * (`new AppError('VALIDATION_FAILED', '...', 400)`), so the API answered `message_bn: 400`. TypeScript
 * now refuses this in .ts files; this test also covers the files that are still .js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'migrations' ? [] : sourceFiles(full);
    return /\.(js|ts)$/.test(e.name) ? [full] : [];
  });
}

// A call whose last argument is a bare three-digit number, with at most one level of nested parens.
const STATUS_AS_MESSAGE = /new AppError\((?:[^()]|\([^()]*\))*?,\s*\d{3}\s*\)/g;

test('no AppError call passes an HTTP status where the Bangla message goes', () => {
  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    for (const m of readFileSync(file, 'utf8').matchAll(STATUS_AS_MESSAGE)) {
      offenders.push(`${path.relative(SRC, file)}: ${m[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// WHY: saler.controller threw `new AppError(401, 'UNAUTHORIZED', ...)`, so the code was the number 401
// (unmapped, answered 500) and the English message was the word UNAUTHORIZED.
test('no AppError call passes an HTTP status as the code', () => {
  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/new AppError\(\s*\d/g)) {
      offenders.push(`${path.relative(SRC, file)}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the codes those calls threw now answer the status they meant, not 500', async () => {
  const { AppError } = await import('../src/plugins/errorHandler.ts');
  assert.equal(new AppError('UNAUTHORIZED', 'Invalid or inactive API key.').statusCode, 401);
  assert.equal(new AppError('BACKUP_NOT_FOUND', 'The requested backup snapshot does not exist.').statusCode, 404);
});
