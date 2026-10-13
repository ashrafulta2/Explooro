/**
 * commissionTierCard.test.js — the shop partner's commission tier card draws only what the server sent.
 *
 * Invariants:
 *   - tiers switched off (or no data / an unknown tier) => no card at all, never an empty ladder;
 *   - progress is measured from the CURRENT tier's floor, not from zero;
 *   - the top tier has a full bar;
 *   - anything the server sends is escaped;
 *   - the mock endpoint has the shape the card needs, and both languages have every string.
 *
 * The card's decisions live in pure functions (isVisible, progressPct, esc) so they are tested without a DOM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { isVisible, progressPct, esc, CommissionTierCard } from '../src/components/saler/CommissionTierCard.js';
import salerHandlers from '../src/mocks/handlers/saler.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ladder = [
  { tier: 'BRONZE', min_volume: 0, bonus_pct: 0 },
  { tier: 'SILVER', min_volume: 50000, bonus_pct: 1 },
  { tier: 'GOLD', min_volume: 150000, bonus_pct: 2 },
  { tier: 'PLATINUM', min_volume: 400000, bonus_pct: 5 },
];
const base = { enabled: true, window_days: 30, ladder };

describe('CommissionTierCard decisions', () => {
  it('is hidden while tiers are off, with no data, or for an unknown tier', () => {
    assert.equal(isVisible({ ...base, tier: 'GOLD' }), true);
    assert.equal(isVisible({ ...base, enabled: false, tier: 'GOLD' }), false);
    assert.equal(isVisible({ ...base, enabled: 'true', tier: 'GOLD' }), false);
    assert.equal(isVisible(undefined), false);
    assert.equal(isVisible({ ...base, tier: 'DIAMOND' }), false);
  });

  it('the component returns null (no DOM needed) whenever it is hidden', () => {
    assert.equal(CommissionTierCard({ data: { ...base, enabled: false, tier: 'GOLD' } }), null);
    assert.equal(CommissionTierCard({}), null);
    assert.equal(CommissionTierCard(), null);
  });

  it('measures progress from the current tier floor, not from zero', () => {
    const silver = { ...base, tier: 'SILVER', next: { tier: 'GOLD', min_volume: 150000, remaining: 50000, bonus_pct: 2 } };
    // Floor 50,000, target 150,000: 100,000 sold is exactly half way (from zero it would read 67%).
    assert.equal(progressPct({ ...silver, volume: '100000.00' }), 50);
    assert.equal(progressPct({ ...silver, volume: '50000.00' }), 0);
  });

  it('is clamped to 0..100 and survives junk volume', () => {
    const silver = { ...base, tier: 'SILVER', next: { tier: 'GOLD', min_volume: 150000 } };
    assert.equal(progressPct({ ...silver, volume: '999999' }), 100);
    assert.equal(progressPct({ ...silver, volume: '-5' }), 0);
    assert.equal(progressPct({ ...silver, volume: 'abc' }), 0);
  });

  it('the top tier (no next) is a full bar', () => {
    assert.equal(progressPct({ ...base, tier: 'PLATINUM', volume: '520000', next: null }), 100);
  });

  it('escapes markup in anything the server sends', () => {
    const out = esc('<img src=x onerror="alert(1)">&\'');
    assert.ok(!out.includes('<'));
    assert.ok(!out.includes('"'));
    assert.equal(esc('Gold'), 'Gold');
  });
});

describe('commission tier endpoint mock and strings', () => {
  it('GET /saler/commission-tier returns the shape the card reads', () => {
    const route = salerHandlers.find((h) => h.method === 'GET' && h.path === '/saler/commission-tier');
    assert.ok(route, 'mock route exists');
    const { status, body } = route.handler();
    assert.equal(status, 200);
    const d = body.data;
    assert.equal(isVisible(d), true);
    assert.equal(d.ladder.length, 4);
    assert.ok(d.next.remaining > 0);
    // The mock's own numbers agree: remaining is the next threshold minus what was sold.
    assert.equal(d.next.remaining, d.next.min_volume - Number(d.volume));
  });

  it('every card string exists in both languages with the same placeholders', () => {
    const en = JSON.parse(readFileSync(join(root, 'src/locales/en.json'), 'utf8'));
    const bn = JSON.parse(readFileSync(join(root, 'src/locales/bn.json'), 'utf8'));
    const keys = ['title', 'name_bronze', 'name_silver', 'name_gold', 'name_platinum', 'bonus', 'no_bonus', 'to_next', 'top', 'start', 'window'];
    for (const k of keys) {
      assert.ok(en.saler.commission_tier[k]?.trim(), `en.saler.commission_tier.${k}`);
      assert.ok(bn.saler.commission_tier[k]?.trim(), `bn.saler.commission_tier.${k}`);
    }
    const slots = (s) => (s.match(/\{\{[a-z]+\}\}/g) || []).sort().join();
    for (const k of ['bonus', 'to_next', 'window']) {
      // The i18n engine only fills {{name}}; a single-brace slot would reach the shop partner as raw text.
      assert.ok(slots(en.saler.commission_tier[k]).length > 0, `en ${k} has a {{slot}}`);
      assert.ok(!/(^|[^{])\{[a-z]+\}([^}]|$)/.test(en.saler.commission_tier[k] + bn.saler.commission_tier[k]), `${k} uses single braces`);
      assert.equal(slots(bn.saler.commission_tier[k]), slots(en.saler.commission_tier[k]), k);
    }
  });
});
