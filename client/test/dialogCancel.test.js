/**
 * Dialog `cancel` handlers must ignore bubbled events.
 *
 * An <input type="file"> fires a bubbling `cancel` when its OS picker is dismissed. A <dialog>
 * that treats every `cancel` as its own Escape closes itself when the user merely backs out of a
 * file picker — which is how the Add Product modal lost the whole form. There is no DOM in this
 * test runner, so the guard is asserted on the source of every dialog cancel listener.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = [
  '../src/components/ui/Modal.js',
  '../src/components/shell/CommandPalette.js',
];

for (const rel of FILES) {
  test(`${rel.split('/').pop()} closes only on its own cancel, not a bubbled one`, () => {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    const match = src.match(/dialog\.addEventListener\('cancel',[\s\S]*?\n {2}\}\);/);
    assert.ok(match, 'cancel listener not found');
    assert.match(match[0], /if \(event\.target !== dialog\) return;/);
    assert.ok(
      match[0].indexOf('event.target !== dialog') < match[0].indexOf('close('),
      'target check must run before close()'
    );
  });
}
