/**
 * returnsPage.test.js — Invariant & Logic Unit Tests for Customer Returns & Refunds Hub.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };

const ROOT = resolve(import.meta.dirname, '..');
function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

test('Customer Returns Hub — Invariants & Logic', async (t) => {
  await t.test('1. Locale integrity for customer_returns namespace', () => {
    const enReturns = enDict.customer_returns;
    const bnReturns = bnDict.customer_returns;

    assert.ok(enReturns, 'en.json must contain customer_returns');
    assert.ok(bnReturns, 'bn.json must contain customer_returns');

    for (const key of Object.keys(enReturns)) {
      assert.ok(key in bnReturns, `bn.json is missing customer_returns.${key}`);
    }
    for (const key of Object.keys(bnReturns)) {
      assert.ok(key in enReturns, `en.json is missing customer_returns.${key}`);
    }

    for (const statusKey of Object.keys(enReturns.status)) {
      assert.ok(statusKey in bnReturns.status, `bn.json is missing status.${statusKey}`);
    }
  });

  await t.test('2. ReturnsPage.js adheres to Vanilla CSS and Explooro account shell', () => {
    const pageSrc = read('src/pages/customer/ReturnsPage.js');

    // Must use account shell
    assert.match(pageSrc, /account-page returns-page/, 'Must use standard account-page returns-page container');
    assert.match(pageSrc, /account-page__header/, 'Must use standard account-page__header');
    assert.match(pageSrc, /account-page__back/, 'Must use standard account-page__back');
    assert.match(pageSrc, /account-page__title/, 'Must use standard account-page__title');

    // Must NOT contain leftover tailwind classes
    assert.doesNotMatch(pageSrc, /container mx-auto/, 'Must not contain Tailwind container mx-auto');
    assert.doesNotMatch(pageSrc, /w-16 h-16/, 'Must not contain unstyled w-16 h-16');
    assert.doesNotMatch(pageSrc, /space-y-6/, 'Must not contain Tailwind space-y-6');
    assert.doesNotMatch(pageSrc, /grid-cols-2/, 'Must not contain Tailwind grid-cols-2');

    // Must import returns.css
    assert.match(pageSrc, /import '[^']*returns\.css'/, 'Must import returns.css');
  });

  await t.test('3. returns.css defines structured card and evidence classes', () => {
    const css = read('src/styles/components/returns.css');

    const expectedClasses = [
      '.returns-page',
      '.customer-return-card',
      '.customer-return-card__top',
      '.customer-return-card__stepper',
      '.customer-return-card__grid',
      '.customer-return-card__evidence',
      '.customer-return-card__evidence-thumb',
      '.customer-return-card__evidence-img',
      '.return-evidence-preview',
    ];

    for (const cls of expectedClasses) {
      assert.ok(css.includes(cls), `returns.css must define ${cls}`);
    }
  });

  await t.test('4. Stepper progression stages', () => {
    function getStage(status) {
      const stageStatus = {
        REQUESTED: 1,
        RECEIVED: 2,
        INSPECTED: 3,
        APPROVED: 4,
        REFUNDED: 4,
        REJECTED: 4,
        DISPUTED: 3,
      };
      return stageStatus[status] || 1;
    }

    assert.equal(getStage('REQUESTED'), 1);
    assert.equal(getStage('RECEIVED'), 2);
    assert.equal(getStage('INSPECTED'), 3);
    assert.equal(getStage('APPROVED'), 4);
    assert.equal(getStage('REFUNDED'), 4);
    assert.equal(getStage('REJECTED'), 4);
  });
});
