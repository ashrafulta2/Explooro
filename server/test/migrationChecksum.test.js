/**
 * migrationChecksum.test.js — a migration whose only change is CRLF ↔ LF is not "changed".
 *
 * WHY: a Windows checkout migrated before .gitattributes pinned *.sql to LF stored CRLF hashes,
 * and `npm run migrate` then refused to start although no SQL had changed.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checksumOf, compareApplied } from '../src/db/migrationChecksum.js';

const LF = 'CREATE TABLE a (id INT);\nCREATE INDEX a_i ON a (id);\n';
const CRLF = LF.replace(/\n/g, '\r\n');

describe('compareApplied', () => {
  test('identical bytes are the same', () => {
    assert.equal(compareApplied(checksumOf(LF), LF), 'same');
  });

  test('applied as CRLF, now LF on disk (and the reverse) differ only in line endings', () => {
    assert.equal(compareApplied(checksumOf(CRLF), LF), 'line-endings');
    assert.equal(compareApplied(checksumOf(LF), CRLF), 'line-endings');
  });

  test('any real edit is still refused', () => {
    assert.equal(compareApplied(checksumOf(CRLF), LF.replace('INT', 'BIGINT')), 'changed');
    assert.equal(compareApplied(checksumOf(LF), `${LF}-- note\n`), 'changed');
  });
});
