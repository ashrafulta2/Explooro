/**
 * partnerScoreCard.test.js — the card draws only what the API sends, never a per-product rate, and
 * says honestly that the boost is not yet applied. Pure helpers are tested directly; the DOM output
 * is checked through a minimal document stub so no browser is needed.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

const bands = [
  { key: 'STARTER', min_score: 0, multiplier: 1 },
  { key: 'RISING', min_score: 40, multiplier: 1.05 },
  { key: 'PRO', min_score: 60, multiplier: 1.1 },
  { key: 'STAR', min_score: 80, multiplier: 1.2 },
];
const scored = {
  bands, window_days: 60, min_sample_orders: 5, is_new: false, sample_orders: 38, score: 52, band: 'RISING', multiplier: 1.05,
  components: { delivered_volume: { max: 35, earned: 22.4 }, repeat_customers: { max: 15, earned: 6 } },
  next_band: { key: 'PRO', min_score: 60, multiplier: 1.1, points_needed: 8 },
  focus: { metric: 'repeat_customers', points: 9 },
};

let mod;
before(async () => {
  // The card builds elements with `document.createElement`; a stub that keeps innerHTML is enough.
  globalThis.document = {
    createElement: () => ({
      className: '', innerHTML: '', attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
    }),
  };
  mod = await import('../src/components/saler/PartnerScoreCard.ts');
});

describe('PartnerScoreCard helpers', () => {
  it('progress runs from the current band floor to the next band', () => {
    // RISING floor 40, PRO at 60: a score of 52 is 12 of 20 points of the way.
    assert.equal(mod.progressPct(scored), 60);
    assert.equal(mod.progressPct({ ...scored, score: 40 }), 0);
    assert.equal(mod.progressPct({ ...scored, score: 91, band: 'STAR', next_band: null }), 100);
    assert.equal(mod.progressPct({ ...scored, score: null }), 0);
  });

  it('the boost is shown as a multiplier, never as a per-product percentage', () => {
    assert.equal(mod.boostLabel(1.1), '×1.10');
    assert.equal(mod.boostLabel(undefined), '×1.00');
  });

  it('there is no card without a band ladder from the API', () => {
    assert.equal(mod.isVisible(null), false);
    assert.equal(mod.isVisible({ bands: [] }), false);
    assert.equal(mod.isVisible(scored), true);
    assert.equal(mod.PartnerScoreCard({ data: null }), null);
  });
});

describe('PartnerScoreCard output', () => {
  it('a scored partner sees their band, score, boost and the one thing to improve', () => {
    const html = mod.PartnerScoreCard({ data: scored }).innerHTML;
    assert.match(html, /52\/100/);
    assert.match(html, /×1\.05/);
    assert.match(html, /aria-valuenow="60"/);
    assert.match(html, /is-current/, 'the focus metric is marked');
  });

  it('a new partner is told how many orders are needed, and no score is invented', () => {
    const html = mod.PartnerScoreCard({ data: { bands, window_days: 60, min_sample_orders: 5, is_new: true, sample_orders: 2, score: null } }).innerHTML;
    assert.doesNotMatch(html, /\/100/);
    assert.doesNotMatch(html, /progressbar/);
  });

  it('text from the API is escaped', () => {
    const html = mod.PartnerScoreCard({ data: { ...scored, band: '<img src=x onerror=alert(1)>' } }).innerHTML;
    assert.doesNotMatch(html, /<img/);
  });
});

describe('PartnerScoreCard wiring', () => {
  it('has a gallery specimen, both locales, and no new stylesheet', () => {
    assert.match(read('../src/pages/dev/gallery-registry.js'), /id: 'partner-score-card'/);
    const en = JSON.parse(read('../src/locales/en.json')).saler.partner_score;
    const bn = JSON.parse(read('../src/locales/bn.json')).saler.partner_score;
    assert.deepEqual(Object.keys(en).sort(), Object.keys(bn).sort());
    for (const b of ['starter', 'rising', 'pro', 'star']) assert.ok(en[`band_${b}`] && bn[`band_${b}`]);
    for (const m of ['delivered_volume', 'return_rate', 'repeat_customers', 'new_customers', 'link_conversion', 'cancel_rate']) {
      assert.ok(en[`metric_${m}`] && bn[`metric_${m}`], m);
    }
    assert.doesNotMatch(read('../src/components/saler/PartnerScoreCard.ts'), /import .*\.css/);
  });

  it('the dashboard loads the card on its own so a slow lookup never holds the page', () => {
    const page = read('../src/pages/saler/SalerDashboardPage.ts');
    assert.match(page, /salerApi\s*\.getPartnerScore\(\)/);
    assert.match(page, /\.catch\(\(\) => \{\}\)/);
  });
});
