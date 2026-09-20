/**
 * accessGovernanceI18n.test.js — the four access-governance pages speak both languages through t().
 *
 * Grants, Restrictions, Approval Inbox and KYC Verification used to pick a language with inline
 * `isBn() ? 'বাংলা' : 'English'` ternaries — and, for most strings, no ternary at all, so a Bangla
 * operator saw English. The strings now live in the locale files; these tests keep it that way.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const en = JSON.parse(read('locales/en.json'));
const bn = JSON.parse(read('locales/bn.json'));

const PAGES = ['AccessGrantsPage', 'RestrictionsPage', 'ApprovalInboxPage', 'VerificationCenterPage'];
const NAMESPACES = ['grants', 'restrictions', 'approvals', 'kyc'];

const resolve = (dict, key) => key.split('.').reduce((node, part) => (node == null ? node : node[part]), dict);
const placeholders = (text) => [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

function flatten(node, prefix = '') {
  return Object.entries(node).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]
  );
}

describe('access-governance pages — translation keys', () => {
  for (const page of PAGES) {
    it(`${page}: every literal t() key exists in English and Bangla`, () => {
      const source = read(`pages/admin/${page}.js`);
      const keys = [...source.matchAll(/\bt\(\s*'([a-z_]+(?:\.[A-Za-z_]+)+)'/g)].map((m) => m[1]);
      assert.ok(keys.length > 5, `${page} should be translating through t()`);
      for (const key of new Set(keys)) {
        assert.equal(typeof resolve(en, key), 'string', `${key} missing from en.json`);
        assert.equal(typeof resolve(bn, key), 'string', `${key} missing from bn.json`);
      }
    });
  }

  it('covers the dynamic keys (status, mode, risk, capability, title, check) in both languages', () => {
    const dynamic = [
      ...['PENDING', 'UNDER_REVIEW', 'APPEALED', 'VERIFIED', 'REJECTED'].map((s) => `kyc.status.${s}`),
      ...['SUPPLIER', 'SALER'].map((s) => `kyc.type.${s}`),
      ...['nid_match', 'face_match', 'license_verified'].map((s) => `kyc.check_${s}`),
      ...['HARD_BLOCK', 'SOFT_LIMIT', 'BLOCK', 'LIMIT', 'THROTTLE', 'SHADOW_BAN'].map((s) => `restrictions.mode_label.${s}`),
      ...['can_sell', 'can_withdraw', 'can_buy', 'can_chat', 'can_cod', 'max_daily_order_count', 'max_cod_order_value', 'max_payout_per_day'].map((s) => `restrictions.cap.${s}`),
      ...['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => `approvals.risk.${s}`),
      ...[
        'users_restriction_manage', 'catalog_product_delete', 'finance_payout_approve', 'platform_module_toggle',
        'finance_payout_batch', 'platform_theme_publish', 'system_backup_restore', 'users_kyc_approve',
        'orders_cod_reconcile',
      ].map((s) => `approvals.human.${s}`),
    ];
    for (const key of dynamic) {
      assert.equal(typeof resolve(en, key), 'string', `${key} missing from en.json`);
      assert.equal(typeof resolve(bn, key), 'string', `${key} missing from bn.json`);
    }
  });

  it('every approval title key names a permission that exists in the catalog', () => {
    const catalog = JSON.parse(readFileSync(join(root, '..', '..', 'docs', 'permission-catalog.json'), 'utf8'));
    const known = new Set((catalog.permissions ?? catalog).map((p) => p.key));
    for (const [key] of flatten(en.approvals.human)) {
      // Slugs replace dots with underscores, so match on that form.
      const hit = [...known].some((permission) => permission.replace(/\./g, '_') === key);
      assert.ok(hit, `approvals.human.${key} does not correspond to any catalog permission`);
    }
  });

  it('keeps {{placeholders}} identical between English and Bangla in these namespaces', () => {
    for (const ns of NAMESPACES) {
      for (const [key, value] of flatten(en[ns], `${ns}.`)) {
        const other = resolve(bn, key);
        assert.equal(typeof other, 'string', `${key} missing from bn.json`);
        assert.deepEqual(placeholders(other), placeholders(value), `${key}: placeholders differ between en and bn`);
      }
    }
  });
});

describe('access-governance pages — no hard-coded language', () => {
  for (const page of PAGES) {
    const source = read(`pages/admin/${page}.js`);

    it(`${page}: does not pick wording with an inline Bangla ternary`, () => {
      // Choosing a date locale (isBn ? 'bn' : 'en') is fine; choosing wording is not.
      const inlineBangla = /(?:isLangBn|isBn\(\))\s*\?[^:\n]*[ঀ-৿]/;
      assert.ok(!inlineBangla.test(source), 'use t() and a locale key instead of an inline Bangla ternary');
    });

    it(`${page}: uses SVG icons, not emoji`, () => {
      const offending = source.split(/\r?\n/).filter((line) => /\p{Extended_Pictographic}/u.test(line));
      assert.ok(
        offending.length === 0,
        `emoji render differently per OS and cannot follow the theme — use components/ui/icons.js:\n${offending.join('\n')}`
      );
    });
  }
});
