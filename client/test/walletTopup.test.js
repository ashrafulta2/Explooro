/**
 * walletTopup.test.js — the vault top-up page (/wallet/top-up): the amount check, both languages,
 * the nav guard equal to the route guard, the link from the Boost wizard, and mock mode.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { amountProblem } from '../src/services/walletTopup.api.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const en = JSON.parse(read('../src/locales/en.json'));
const bn = JSON.parse(read('../src/locales/bn.json'));
const rules = { min_amount: 50, max_amount: 25000 };

describe('amountProblem', () => {
  it('accepts whole taka and two decimals inside the range', () => {
    assert.equal(amountProblem('500', rules), null);
    assert.equal(amountProblem('60.10', rules), null);
    assert.equal(amountProblem(60.1, rules), null);
  });
  it('names the problem otherwise', () => {
    assert.equal(amountProblem('10.123', rules), 'topup.err_format');
    assert.equal(amountProblem('abc', rules), 'topup.err_format');
    assert.equal(amountProblem('0', rules), 'topup.err_format');
    assert.equal(amountProblem('49', rules), 'topup.err_range');
    assert.equal(amountProblem('25001', rules), 'topup.err_range');
  });
});

describe('top-up strings and wiring', () => {
  it('every string exists in both languages, and every key the page uses is defined', () => {
    assert.deepEqual(Object.keys(en.topup).sort(), Object.keys(bn.topup).sort());
    assert.ok(en.nav.shared.topup && bn.nav.shared.topup);
    assert.ok(en.advertise.budget.add_money && bn.advertise.budget.add_money);
    const src = read('../src/pages/WalletTopUpPage.ts') + read('../src/services/walletTopup.api.ts');
    for (const [, k] of src.matchAll(/'topup\.([a-z_]+)'/g)) assert.ok(k in en.topup, k);
    for (const m of ['bkash', 'nagad', 'card']) assert.ok(en.topup[`method_${m}`], m);
    for (const s of ['initiated', 'pending', 'success', 'failed', 'timeout', 'reversed']) assert.ok(en.topup[`status_${s}`], s);
  });

  it('the nav items equal the route guard, for every account type', () => {
    const nav = read('../src/config/navigation.ts');
    for (const role of ['customer', 'saler', 'supplier']) {
      assert.match(nav, new RegExp(`path: '/wallet/top-up', group: '[a-z.]+', permission: 'finance\\.wallet\\.topup', module: 'core', roles: \\['${role}'\\]`), role);
    }
    const main = read('../src/main.ts');
    const block = main.slice(main.indexOf("path: '/wallet/top-up'"), main.indexOf('WalletTopUpPage.ts'));
    assert.ok(block.includes("permission: 'finance.wallet.topup'") && block.includes("module: 'core'"));
  });

  it('the Boost wizard links here with the shortfall and a way back, and keeps its draft', () => {
    const src = read('../src/pages/AdvertisePage.ts');
    assert.ok(src.includes('/wallet/top-up?amount='));
    assert.ok(src.includes("encodeURIComponent('/advertise')"));
    assert.ok(src.includes('sessionStorage.setItem(DRAFT_KEY'));
  });

  it('only a path on this site can be the "go back" target', () => {
    const src = read('../src/pages/WalletTopUpPage.ts');
    assert.ok(src.includes("!p.startsWith('//')"));
  });

  it('mock mode opens, pays and lists top-ups', () => {
    const mocks = read('../src/mocks/handlers/walletTopup.ts');
    assert.ok(mocks.includes("path: '/wallet/topups'") && mocks.includes('export function executeMockTopUp'));
    assert.ok(read('../src/mocks/handlers/orders.ts').includes('executeMockTopUp(body?.transactionRef)'));
    assert.ok(read('../src/mocks/index.ts').includes('...walletTopupHandlers'));
  });
});
