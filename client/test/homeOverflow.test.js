/**
 * homeOverflow.test.js — Invariant Tests for Horizontal Overflow Prevention on Home Page.
 *
 * WHY every ancestor uses `overflow-x: clip` and never `hidden`: `hidden` (like `auto`/`scroll`) turns the
 * element into a scroll container, and `position: sticky` binds to its NEAREST scroll container. The topbar
 * (`.app-shell__topbar-slot`), the sidebar and every sticky table header/filter live inside html > body >
 * .app-shell > .app-shell__content. Once any of those is a scroll container that never scrolls itself (it
 * just grows with its content), sticky silently becomes a no-op and the topbar scrolls away with the page.
 * `clip` cuts off horizontal spill identically but creates no scroll container, so sticky keeps working.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const clientRoot = path.resolve(import.meta.dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(clientRoot, 'src', 'styles', ...parts), 'utf8');

/** Declaration block of the rule whose selector is exactly `selector` (start of a line). */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `rule not found: ${selector}`);
  return match[1];
}

describe('Horizontal Overflow Prevention Invariants', () => {
  test('1. reset.css clips horizontal overflow on html and body', () => {
    const resetCss = read('reset.css');
    assert.match(ruleBody(resetCss, 'html'), /overflow-x:\s*clip/);
    assert.match(ruleBody(resetCss, 'html body'), /overflow-x:\s*clip/);
  });

  test('2. shell.css prevents overflow-x leakage on .app-shell and .app-shell__content', () => {
    const shellCss = read('components', 'shell.css');
    assert.match(ruleBody(shellCss, '.app-shell'), /overflow-x:\s*clip/);
    assert.match(ruleBody(shellCss, '.app-shell__content'), /overflow-x:\s*clip/);
    assert.match(ruleBody(shellCss, '.app-shell__content'), /max-width:\s*100%/);
  });

  test('3. product.css enforces width constraints and overflow containment on home elements', () => {
    const productCss = read('components', 'product.css');
    assert.match(ruleBody(productCss, '.home-page'), /overflow-x:\s*clip/);
    assert.match(ruleBody(productCss, '.home-page'), /max-width:\s*100%/);
    assert.match(productCss, /\.feed-switcher\s*\{[^}]*max-width:\s*100%/);
    assert.match(productCss, /\.category-pills\s*\{[^}]*max-width:\s*100%/);
    assert.match(productCss, /\.flash-sale-widget\s*\{[^}]*max-width:\s*100%/);
    assert.match(productCss, /\.flash-sale-widget__scroll-wrapper\s*\{[^}]*overflow:\s*hidden/);
  });

  test('4. no ancestor of a sticky element is a scroll container (topbar / sidebar / sticky headers keep sticking)', () => {
    const ancestors = [
      ['reset.css', 'html'],
      ['reset.css', 'html body'],
      ['components/shell.css', '.app-shell'],
      ['components/shell.css', '.app-shell__content'],
      ['components/shell.css', '.app-shell__page'],
      ['components/product.css', '.home-page'],
    ];
    for (const [file, selector] of ancestors) {
      const body = ruleBody(read(...file.split('/')), selector);
      assert.doesNotMatch(
        body,
        /overflow(?:-[xy])?:\s*(?:hidden|auto|scroll|overlay)/,
        `${selector} (${file}) must use overflow: clip, not hidden/auto/scroll — it would break position: sticky for the topbar`,
      );
    }
  });

  test('5. the topbar slot is still sticky to the viewport', () => {
    assert.match(ruleBody(read('components', 'shell.css'), '.app-shell__topbar-slot'), /position:\s*sticky;\s*top:\s*0/);
  });
});
