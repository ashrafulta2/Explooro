/**
 * permissionSync.test.js — `npm run migrate` adds catalog permissions a database lacks, and can only add.
 *
 * WHY: platform.legal.view reached the seed but not the owner's database, so the super admin saw
 * Legal Documents locked. migrate now applies the permission seed every run, which is only safe
 * while that file never deletes, updates or overwrites a row.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PERMISSION_SEED_FILE, syncPermissions } from '../src/db/permissionSync.ts';

function fakePool(counts, { failOn } = {}) {
  const calls = [];
  let i = 0;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (failOn && sql === failOn) throw new Error('boom');
      if (sql.includes('count(*)')) return { rows: [counts[i++]] };
      return { rows: [] };
    },
    release() { calls.push('RELEASE'); },
  };
  return { calls, pool: { connect: async () => client } };
}

describe('permission seed is add-only', () => {
  test('every statement is an INSERT ... ON CONFLICT DO NOTHING', async () => {
    // Labels say "Delete accounts" etc., so drop comments and string literals before looking at SQL.
    const sql = (await readFile(PERMISSION_SEED_FILE, 'utf8'))
      .replace(/--.*$/gm, '')
      .replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(sql, /\b(DELETE|UPDATE|TRUNCATE|DROP|ALTER)\b/i);
    const inserts = sql.match(/\bINSERT INTO\b/gi) ?? [];
    const guarded = sql.match(/\bON CONFLICT\b[^;]*\bDO NOTHING\s*;/gi) ?? [];
    assert.ok(inserts.length > 0);
    assert.equal(guarded.length, inserts.length);
  });
});

describe('syncPermissions', () => {
  test('runs the seed in one transaction and reports what it added', async () => {
    const { pool, calls } = fakePool([
      { roles: 7, permissions: 217, grants: 427 },
      { roles: 7, permissions: 219, grants: 430 },
    ]);
    const added = await syncPermissions(pool, 'SEED');
    assert.deepEqual(added, { roles: 0, permissions: 2, grants: 3 });
    assert.equal(calls[0], 'BEGIN');
    assert.ok(calls.indexOf('SEED') > 0);
    assert.equal(calls.at(-2), 'COMMIT');
    assert.equal(calls.at(-1), 'RELEASE');
  });

  test('a failing seed rolls back and names itself', async () => {
    const { pool, calls } = fakePool([{ roles: 0, permissions: 0, grants: 0 }], { failOn: 'SEED' });
    await assert.rejects(syncPermissions(pool, 'SEED'), /Permission sync failed: boom/);
    assert.ok(calls.includes('ROLLBACK'));
    assert.ok(!calls.includes('COMMIT'));
    assert.equal(calls.at(-1), 'RELEASE');
  });
});
