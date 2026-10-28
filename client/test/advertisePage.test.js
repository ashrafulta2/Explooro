/**
 * advertisePage.test.js — the simple Boost wizard (/advertise): the request it builds, when each step
 * may move on, its strings in both languages, and the nav guard equal to the route guard.
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

let mod;
before(async () => {
  mod = await import('../src/pages/advertiseWizard.ts');
});

const base = () => ({
  kind: 'POST', postId: 41, productId: null, headline: '  Eid ideas  ', description: '',
  everyone: true, audience: { roles: [], gender: 'ALL', divisions: [], interests: [] }, budget: 500, days: 5,
});
const format = { min_budget: 200, min_days: 1, max_days: 30 };

describe('buildCampaignBody', () => {
  it('always buys Boost, spreads the budget evenly and trims the headline', () => {
    const b = mod.buildCampaignBody(base());
    assert.equal(b.ad_product_key, 'easy_boost');
    assert.equal(b.daily_budget, 100);
    assert.equal(b.duration_days, 5);
    assert.equal(b.creative.headline, 'Eid ideas');
    assert.equal(b.creative.community_post_id, 41);
    assert.deepEqual(b.targeting.audience, {});
  });

  it('a chosen audience is sent; "everyone" sends none', () => {
    const s = { ...base(), everyone: false, audience: { roles: ['customer'], gender: 'FEMALE', divisions: ['Dhaka'], interests: [12] } };
    assert.deepEqual(mod.buildCampaignBody(s).targeting.audience, s.audience);
  });

  it('a product or a store is sent as such', () => {
    assert.equal(mod.buildCampaignBody({ ...base(), kind: 'PRODUCT', productId: 101 }).creative.product_id, 101);
    const store = mod.buildCampaignBody({ ...base(), kind: 'STORE' }).creative;
    assert.equal(store.product_id, undefined);
    assert.equal(store.community_post_id, undefined);
  });
});

describe('stepComplete', () => {
  it('step 1 needs something picked and a headline', () => {
    assert.equal(mod.stepComplete('what', base()), true);
    assert.equal(mod.stepComplete('what', { ...base(), postId: null }), false);
    assert.equal(mod.stepComplete('what', { ...base(), headline: '  ' }), false);
    assert.equal(mod.stepComplete('what', { ...base(), kind: 'STORE', postId: null }), true);
  });

  it('step 2 refuses a too-small audience', () => {
    const chosen = { ...base(), everyone: false };
    assert.equal(mod.stepComplete('who', chosen, { estimate: { people: 5, too_small: true } }), false);
    assert.equal(mod.stepComplete('who', chosen, { estimate: { people: 900, too_small: false } }), true);
    assert.equal(mod.stepComplete('who', base(), {}), true);
  });

  it('step 3 keeps the format limits', () => {
    assert.equal(mod.stepComplete('budget', base(), { format }), true);
    assert.equal(mod.stepComplete('budget', { ...base(), budget: 100 }, { format }), false);
    assert.equal(mod.stepComplete('budget', { ...base(), days: 31 }, { format }), false);
  });
});

describe('advertise strings and wiring', () => {
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]));

  it('every string exists in both languages', () => {
    assert.deepEqual(flat(en.advertise).sort(), flat(bn.advertise).sort());
    assert.ok(en.nav.shared.advertise && bn.nav.shared.advertise);
  });

  it('every static key the page uses is defined', () => {
    const src = read('../src/pages/AdvertisePage.js');
    const keys = [...src.matchAll(/t\('advertise\.([a-z_.]+)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('.') && !k.endsWith('_'));
    const has = (k) => k.split('.').reduce((o, part) => (o == null ? undefined : o[part]), en.advertise) !== undefined;
    for (const k of keys) assert.ok(has(k), k);
    for (const d of ['barishal', 'chattogram', 'dhaka', 'khulna', 'mymensingh', 'rajshahi', 'rangpur', 'sylhet']) assert.ok(en.advertise.division[d], d);
  });

  it('the nav items equal the route guard, for every account type', () => {
    const nav = read('../src/config/navigation.js');
    for (const role of ['customer', 'saler', 'supplier']) {
      assert.match(nav, new RegExp(`path: '/advertise', group: '[a-z.]+', permission: 'growth\\.ad\\.manage_own', module: 'sponsored_ads', roles: \\['${role}'\\]`), role);
    }
    const main = read('../src/main.js');
    const block = main.slice(main.indexOf("path: '/advertise'"), main.indexOf('AdvertisePage.js'));
    assert.ok(block.includes("permission: 'growth.ad.manage_own'") && block.includes("module: 'sponsored_ads'"));
  });

  it('the page stylesheet ships in the route chunk, not the entry bundle', () => {
    assert.ok(read('../src/pages/AdvertisePage.js').includes("import '../styles/components/advertise.css';"));
    assert.ok(!read('../src/styles/main.css').includes('advertise.css'));
  });

  it('mock mode answers the wizard endpoints', () => {
    const mocks = read('../src/mocks/handlers/ads.js');
    for (const p of ["'/ads/easy/options'", "'/ads/audience-estimate'", "key: 'easy_boost'"]) assert.ok(mocks.includes(p), p);
  });
});
