/**
 * permMatrixScrollHeight.test.js — the Roles matrix must not stretch the page.
 *
 * WHY: each matrix cell holds an absolutely positioned `.sr-only` span. With no positioned ancestor its
 * containing block is the page, so the table's scroller does not clip it and its static position (down
 * all 187 rows) grew the document to ~25,000px: a tiny page scrollbar thumb and a huge blank gap under
 * the panel. Measured in a real browser: 24,853px without a positioned wrapper vs 1,049px with one.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'styles', 'components', 'admin-access.css'), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `rule not found: ${selector}`);
  return match[1];
}

describe('Permission matrix does not extend the document', () => {
  test('scroll wrapper is a containing block for the sr-only cell text', () => {
    assert.match(ruleBody('.perm-matrix__table-wrap'), /position:\s*relative/);
  });

  test('each mark is a containing block for its own sr-only span', () => {
    assert.match(ruleBody('.perm-matrix__mark'), /position:\s*relative/);
  });
});
