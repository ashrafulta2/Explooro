/**
 * teamCheckoutForm.test.js — invariants for the team-purchase form and its admin settings page.
 *
 * 1. The form asks for a recipient name and an address only (no phone, district or division field),
 *    and offers exactly Cash on Delivery and Wallet.
 * 2. Neither the start modal nor the join modal sends a price: the server computes it.
 * 3. The admin page saves the shipping charge through the settings endpoint and handles a deferred
 *    (sent-for-approval) reply.
 * 4. Every new string exists in both locales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { teamPurchaseHandlers } from '../src/mocks/handlers/teamPurchase.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const en = JSON.parse(read('src/locales/en.json'));
const bn = JSON.parse(read('src/locales/bn.json'));

const formSrc = read('src/components/product/TeamCheckoutForm.js');
const modalSrc = read('src/components/product/TeamPurchaseModal.js');
const pageSrc = read('src/pages/TeamPurchasePage.js');
const adminSrc = read('src/pages/admin/AdminGroupBuyPage.js');

describe('Team purchase checkout form', () => {
  it('asks for recipient name and address only', () => {
    const names = [...formSrc.matchAll(/name="([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(names)].sort(), ['address_line', 'payment_method', 'recipient_name']);
    for (const absent of ['recipient_phone', 'division', 'district', 'upazila']) {
      assert.ok(!names.includes(absent), `the form must not ask for ${absent}`);
    }
  });

  it('offers exactly Cash on Delivery and Wallet', () => {
    const methods = [...formSrc.matchAll(/paymentOption\('([A-Z]+)'/g)].map((m) => m[1]);
    assert.deepEqual(methods, ['COD', 'WALLET']);
    assert.ok(!/BKASH|NAGAD/.test(formSrc + modalSrc + pageSrc.slice(pageSrc.indexOf('_openJoinModal'))));
  });

  it('never sends a price to the server', () => {
    const createCall = modalSrc.slice(modalSrc.indexOf("api.post('/team-purchases'"), modalSrc.indexOf("api.post('/team-purchases'") + 200);
    assert.ok(!createCall.includes('group_price'), 'start modal must not send group_price');
    assert.ok(modalSrc.includes('/team-purchases/quote'), 'start modal reads prices from the quote');
    assert.ok(pageSrc.includes('TeamCheckoutForm'), 'join modal uses the same form');
  });

  it('the quote mock is listed before /team-purchases/:id', () => {
    const paths = teamPurchaseHandlers.filter((h) => h.method === 'GET').map((h) => h.path);
    assert.ok(paths.indexOf('/team-purchases/quote') < paths.indexOf('/team-purchases/:id'));
    const res = teamPurchaseHandlers.find((h) => h.path === '/team-purchases/quote').handler({ query: { product_id: 1 } });
    assert.deepEqual(res.body.payment_methods, ['COD', 'WALLET']);
    assert.ok(Number(res.body.shipping_charge) >= 0);
  });
});

describe('Admin team purchase settings', () => {
  it('saves the shipping charge through the settings endpoint and handles approval', () => {
    assert.ok(adminSrc.includes("api.put('/admin/growth/group-buy/settings'"));
    assert.ok(adminSrc.includes('shipping_charge'));
    assert.ok(adminSrc.includes('res?.deferred'), 'a non-super-admin save is sent for approval, not shown as saved');
    assert.ok(!/stats = \{\s*total_teams: 142/.test(adminSrc), 'no hard-coded demo numbers');
  });
});

describe('Locale parity', () => {
  it('every new string is in both en.json and bn.json', () => {
    for (const group of [['team_purchases', 'checkout'], ['admin', 'group_buy']]) {
      const enKeys = Object.keys(en[group[0]][group[1]]).sort();
      const bnKeys = Object.keys(bn[group[0]][group[1]]).sort();
      assert.deepEqual(bnKeys, enKeys, `${group.join('.')} keys differ`);
    }
    const used = [...(formSrc + modalSrc + adminSrc).matchAll(/t\('((?:team_purchases\.checkout|admin\.group_buy)\.[a-z0-9_]+)'/g)].map((m) => m[1]);
    for (const key of used) {
      const [a, b, c] = key.split('.');
      assert.ok(en[a][b][c], `missing en ${key}`);
      assert.ok(bn[a][b][c], `missing bn ${key}`);
    }
  });
});
