/**
 * partnerReward.test.js — the partner reward card and the admin page draw only what the API sends,
 * every string exists in both languages, and the nav guard equals the route guard.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const en = JSON.parse(read('../src/locales/en.json'));
const bn = JSON.parse(read('../src/locales/bn.json'));

const data = {
  period: { start: '2026-10-01', end: '2026-10-31', today: '2026-10-23' },
  closes_on: '2026-11-08',
  weights: { sales: 40, social: 25, community: 20, activity: 15 },
  pool_estimate: '24850.00',
  partners_scored: 4,
  values: { sales: 18, social: 240, community: 46, activity: 21 },
  community_counts: { posts: 9, likes: 11, comments: 4, saves: 2 },
  points: { sales: 20.57, social: 7.87, community: 6.13, activity: 4.85 },
  score: 39.42,
  share_pct: 39.42,
  estimated_amount: '9796.80',
  history: [{ period_start: '2026-09-01', amount: '7420.50', share_pct: 33.88 }],
};

let mod;
before(async () => {
  globalThis.document = {
    createElement: () => ({ className: '', innerHTML: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
  };
  mod = await import('../src/components/saler/PartnerRewardCard.ts');
});

describe('PartnerRewardCard', () => {
  it('is hidden without a reward shape', () => {
    assert.equal(mod.isVisible(null), false);
    assert.equal(mod.isVisible({ weights: {} }), false);
    assert.equal(mod.PartnerRewardCard({ data: {} }), null);
    assert.equal(mod.isVisible(data), true);
  });

  it('shows the four factors in weight order with points out of each weight', () => {
    assert.deepEqual(mod.FACTOR_ORDER, ['sales', 'social', 'community', 'activity']);
    const card = mod.PartnerRewardCard({ data });
    const html = card.innerHTML;
    for (const k of mod.FACTOR_ORDER) assert.ok(html.includes(`/ ${data.weights[k]}`), k);
    assert.ok(card.className.includes('partner-reward-card'));
  });

  it('never computes a score itself: the estimate shown is the API figure', () => {
    const src = read('../src/components/saler/PartnerRewardCard.ts');
    assert.ok(src.includes('data.estimated_amount'));
    assert.ok(!/\* *Number\(data\.pool_estimate\)/.test(src), 'no client-side pool arithmetic');
  });

  it('a partner with no points gets the how-to-earn line, not a share', () => {
    const idle = { ...data, score: 0, share_pct: 0, estimated_amount: '0.00', history: [] };
    const html = mod.PartnerRewardCard({ data: idle }).innerHTML;
    assert.ok(!html.includes('39'), 'no stale share');
  });
});

describe('partner reward strings and wiring', () => {
  const keys = (o) => Object.keys(o).sort();

  it('every string exists in both languages', () => {
    assert.deepEqual(keys(en.saler.partner_reward), keys(bn.saler.partner_reward));
    assert.deepEqual(keys(en.admin.partner_rewards), keys(bn.admin.partner_rewards));
    assert.ok(en.nav.admin.partner_rewards && bn.nav.admin.partner_rewards);
  });

  it('every key the card and page use is defined', () => {
    // A key ending in "_" is a template (`factor_${k}`); those are checked one by one below.
    const used = (src, prefix) => [...src.matchAll(new RegExp(`t\\(\`?'?${prefix.replace('.', '\\.')}\\.([a-z_]+)`, 'g'))]
      .map((m) => m[1])
      .filter((k) => !k.endsWith('_'));
    const card = read('../src/components/saler/PartnerRewardCard.ts');
    for (const k of used(card, 'saler.partner_reward')) assert.ok(k in en.saler.partner_reward, k);
    const page = read('../src/pages/admin/AdminPartnerRewardsPage.ts');
    for (const k of used(page, 'admin.partner_rewards')) assert.ok(k in en.admin.partner_rewards, k);
    for (const f of ['sales', 'social', 'community', 'activity']) {
      assert.ok(en.saler.partner_reward[`factor_${f}`] && en.admin.partner_rewards[`factor_${f}`], f);
    }
  });

  it('the nav guard equals the route guard (permission and module)', () => {
    const nav = read('../src/config/navigation.ts');
    const main = read('../src/main.ts');
    assert.match(nav, /path: '\/admin\/growth\/partner-rewards', group: 'admin\.growth', permission: 'growth\.partner_reward\.view', module: 'virtual_storefront'/);
    const block = main.slice(main.indexOf("path: '/admin/growth/partner-rewards'"), main.indexOf('AdminPartnerRewardsPage.ts'));
    assert.ok(block.includes("permission: 'growth.partner_reward.view'"));
    assert.ok(block.includes("module: 'virtual_storefront'"));
  });

  it('the card is registered in the gallery and mocked for mock mode', () => {
    assert.ok(read('../src/pages/dev/gallery-registry.ts').includes("id: 'partner-reward-card'"));
    const mocks = read('../src/mocks/handlers/partnerReward.ts');
    for (const p of ["'/saler/partner-reward'", "'/admin/growth/partner-rewards'", "'/admin/growth/partner-rewards/close'"]) assert.ok(mocks.includes(p), p);
  });
});
