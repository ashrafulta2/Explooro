/**
 * Instruction text lives behind an (i) InfoTip, not inline under every title.
 *
 * There is no DOM in this test runner, so the invariants are asserted on source: the folding
 * selector must keep to instruction copy (never data captions), the InfoTip's own label must exist
 * in both languages, and the component must be in the gallery.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('pageInfo never folds data captions or content copy', () => {
  const src = read('../src/services/pageInfo.js');
  const list = src.split('INFO_CLASSES = [')[1].split('];')[0];
  for (const banned of ['kpi-card__sub', 'auth-subtitle', 'empty-state__description', 'modal__description', 'drawer__description', 'home-hero__sub']) {
    assert.ok(!list.includes(banned), `${banned} is data/content, not an instruction`);
  }
});

test('pageInfo opts out via data-info-keep and keeps the original element in the DOM', () => {
  const src = read('../src/services/pageInfo.js');
  assert.match(src, /:not\(\[data-info-keep\]\)/);
  assert.match(src, /data-info-folded/);
});

test('InfoTip fallback label exists in English and Bangla', () => {
  for (const file of ['../src/locales/en.json', '../src/locales/bn.json']) {
    const dict = JSON.parse(read(file));
    assert.ok(dict.common?.more_info, `${file} is missing common.more_info`);
  }
});

test('InfoTip is registered in the component gallery', () => {
  assert.match(read('../src/pages/dev/gallery-registry.js'), /id: 'info-tip'/);
});

test('every data-page-info marker sits on a <p> element', () => {
  const roots = ['../src/pages/', '../src/components/'];
  const files = [
    'AcademyPage.js', 'StoriesFeedPage.js', 'VaultPage.js', 'admin/SettingsPage.js', 'admin/BackupPage.js',
    'moderator/MyAccessPage.js', 'supplier/StoreStatusPage.js', 'saler/SalerDashboardPage.js',
  ];
  for (const f of files) {
    const src = read(roots[0] + f);
    for (const m of src.matchAll(/(<\w+)[^>]*data-page-info/g)) {
      assert.equal(m[1], '<p', `${f}: data-page-info must be on a <p>`);
    }
  }
});
