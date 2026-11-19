/**
 * uiStyle.test.js — invariants of the component style layer (services/uiStyle.ts).
 *
 *   1. The client and the server agree on which styles exist. The server refuses an unknown
 *      `ui_style` on save; the client quietly reads one as 'standard'. If the lists drift, an admin
 *      can preview a style the API will not save, or save one no browser draws.
 *   2. Every preset that names a style names a real one.
 *   3. ui-macos.css is inert until the attribute is set, names no colour of its own (the master
 *      palette owns colour), carries no gradient or glass, and stays out of the entry bundle.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { UI_STYLES, normaliseUiStyle, DEFAULT_UI_STYLE } from '../src/services/uiStyle.ts';
import { MASTER_PRESETS } from '../src/config/master-themes.ts';

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(CLIENT, ...p), 'utf8');

const macosCss = read('src', 'styles', 'ui-macos.css');
/** The CSS with comments removed, so the header's prose cannot trip the checks. */
const css = macosCss.replace(/\/\*[\s\S]*?\*\//g, '');

test('server UI_STYLES equals the client list', () => {
  // Read as text: importing theme.service.ts would pull the repository and database layer.
  const src = read('..', 'server', 'src', 'services', 'theme.service.ts');
  const m = src.match(/export const UI_STYLES = (\[[^\]]*\])/);
  assert.ok(m, 'theme.service.ts no longer exports UI_STYLES as an array literal');
  const serverList = JSON.parse(m[1].replace(/'/g, '"'));
  assert.deepEqual(serverList, [...UI_STYLES]);
});

test('unknown or missing styles read as the default', () => {
  assert.equal(DEFAULT_UI_STYLE, 'standard');
  assert.equal(normaliseUiStyle(undefined), 'standard');
  assert.equal(normaliseUiStyle('aqua'), 'standard');
  assert.equal(normaliseUiStyle('macos'), 'macos');
});

test('every preset style is a known style, and the macOS preset uses the macos style', () => {
  for (const [key, preset] of Object.entries(MASTER_PRESETS)) {
    if (preset.uiStyle !== undefined) assert.ok(UI_STYLES.includes(preset.uiStyle), `${key}: ${preset.uiStyle}`);
  }
  assert.equal(MASTER_PRESETS.macos_native?.uiStyle, 'macos');
});

test('every rule in ui-macos.css is scoped to the macos attribute', () => {
  // Split on rule bodies; whatever precedes a `{` that is not an at-rule is a selector list.
  const selectors = [];
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const head = m[1].trim();
    if (!head || head.startsWith('@')) continue;
    selectors.push(...head.split(',').map((s) => s.trim()).filter(Boolean));
  }
  assert.ok(selectors.length > 40, 'parsed suspiciously few selectors');
  const loose = selectors.filter((s) => !s.startsWith(":root[data-ui-style='macos']"));
  assert.deepEqual(loose, [], 'unscoped selectors would restyle the standard look');
});

test('ui-macos.css names no colour of its own, no gradient and no glass', () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'raw hex — use a token');
  assert.doesNotMatch(css, /gradient/i);
  assert.doesNotMatch(css, /backdrop-filter/i);
});

test('controls a user types in or picks from keep their 3:1 border', () => {
  // WCAG 1.4.11: input-affordance.css gives every field, select, checkbox and radio the
  // --border-interactive edge. A soft Mac hairline (a transparent border, or --border-strong at
  // ~1.5:1) would make them read as plain text again. Buttons may use the bezel; these may not.
  const control = /(\.field__control|\.form-(input|select|textarea)|\.(input|select|textarea)\b|\bselect\b|\.checkbox__box|\.radio__box)/;
  const offenders = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = m[1].trim();
    if (head.startsWith('@')) continue;
    for (const sel of head.split(',').map((s) => s.trim())) {
      if (!control.test(sel)) continue;
      if (/:checked|:indeterminate|\.toggle__input|chevron|option/.test(sel)) continue;
      if (/border(-color)?:[^;]*(transparent|--border-strong)/.test(m[2])) offenders.push(sel);
    }
  }
  assert.deepEqual(offenders, []);
});

test('ui-macos.css stays out of the entry bundle', () => {
  assert.doesNotMatch(read('src', 'styles', 'main.css'), /ui-macos\.css/);
  assert.match(read('src', 'services', 'uiStyle.ts'), /import\('\.\.\/styles\/ui-macos\.css'\)/);
});
