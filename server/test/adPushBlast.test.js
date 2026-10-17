/**
 * adPushBlast.test.js — the money and fairness rules of the Push Notification Blast.
 *
 *   1. Unreached recipients are refunded in proportion to what was PAID, rounded down to the paisa.
 *   2. A campaign finishes when everyone paid for was reached, or when its end date passes.
 *   3. The two tunables fall back to their defaults when missing or out of range.
 *   4. The job is registered, and the ad cannot pass itself off as a platform message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  undeliveredRefund,
  isSettleDue,
  remainingToSend,
  loadPushSettings,
  PUSH_SETTING_LIMITS,
} from '../src/services/adPushBlast.service.ts';
import { DEFAULT_TEMPLATES, renderTemplateString } from '../src/services/notification.service.ts';

test('refund is the unreached share of the amount actually paid', () => {
  // 1,000 recipients at ৳0.35 = ৳350.00 prepaid; 400 reached → 600 unreached = ৳210.00
  assert.equal(undeliveredRefund('350.00', 1000, 400), '210.00');
  // a discounted purchase refunds the discounted rate, not the list rate: ৳315.00 for 1,000
  assert.equal(undeliveredRefund('315.00', 1000, 400), '189.00');
});

test('nothing is refunded when everyone was reached, and never more than was paid', () => {
  assert.equal(undeliveredRefund('350.00', 1000, 1000), '0.00');
  assert.equal(undeliveredRefund('350.00', 1000, 1500), '0.00'); // over-count cannot produce a negative refund
  assert.equal(undeliveredRefund('350.00', 1000, 0), '350.00'); // nobody reached → everything back
});

test('the refund rounds down to the paisa so the platform never refunds money it did not take', () => {
  // ৳1.00 across 3 recipients, 1 reached → 2/3 of 100 paisa = 66.67 → 66 paisa
  assert.equal(undeliveredRefund('1.00', 3, 1), '0.66');
  assert.equal(undeliveredRefund('0.00', 3, 1), '0.00');
  assert.equal(undeliveredRefund('350.00', 0, 0), '0.00');
});

test('a campaign is due for settlement when fully delivered or past its end date', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  assert.equal(isSettleDue({ quantity: 100, push_delivered_count: 100, end_date: null }, now), true);
  assert.equal(isSettleDue({ quantity: 100, push_delivered_count: 40, end_date: '2026-10-17T11:00:00Z' }, now), true);
  assert.equal(isSettleDue({ quantity: 100, push_delivered_count: 40, end_date: '2026-10-18T11:00:00Z' }, now), false);
  assert.equal(isSettleDue({ quantity: 100, push_delivered_count: 40, end_date: null }, now), false);
  assert.equal(remainingToSend({ quantity: 100, push_delivered_count: 40 }), 60);
  assert.equal(remainingToSend({ quantity: 100, push_delivered_count: 120 }), 0);
});

test('missing or out-of-range settings fall back to the defaults', async () => {
  const dbWith = (settings) => ({ query: async () => ({ rows: settings === undefined ? [] : [{ settings_json: settings }] }) });
  assert.deepEqual(await loadPushSettings(dbWith(undefined)), { frequencyDays: 3, batchSize: 500, interestDays: 60 });
  assert.deepEqual(await loadPushSettings(dbWith({ push_frequency_days: 7, push_batch_size: 1000, push_interest_days: 30 })), { frequencyDays: 7, batchSize: 1000, interestDays: 30 });
  assert.deepEqual(await loadPushSettings(dbWith({ push_frequency_days: 0, push_batch_size: 99999 })), { frequencyDays: 3, batchSize: 500, interestDays: 60 });
  assert.deepEqual(await loadPushSettings(dbWith({ push_frequency_days: 'x', push_batch_size: 2.5 })), { frequencyDays: 3, batchSize: 500, interestDays: 60 });
  assert.ok(PUSH_SETTING_LIMITS.push_frequency_days.default >= PUSH_SETTING_LIMITS.push_frequency_days.min);
});

test('the ad_push_blast job is registered every 5 minutes with no module gate', async () => {
  await import('../src/jobs/adPushBlast.job.ts');
  const { listRegisteredJobs } = await import('../src/jobs/scheduler.ts');
  const job = listRegisteredJobs().find((j) => j.name === 'ad_push_blast');
  // No gate on purpose: switching the module off must still let a finished blast refund its advertiser.
  assert.deepEqual(job, { name: 'ad_push_blast', interval_ms: 300000, module_key: null });
});

test('an ad push is always labelled Sponsored, in both languages', () => {
  const tpl = DEFAULT_TEMPLATES.AD_PUSH_BLAST;
  assert.equal(tpl.category, 'MARKETING');
  assert.equal(renderTemplateString(tpl.title_en, { headline: 'Eid sale' }), 'Sponsored: Eid sale');
  assert.equal(renderTemplateString(tpl.title_bn, { headline: 'ঈদ সেল' }), 'স্পন্সর্ড: ঈদ সেল');
});

test('the template is also seeded in the database (notifications.template_key is a foreign key to it)', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../src/db/migrations/078_ad_push_blast_template.sql', import.meta.url), 'utf8');
  const tpl = DEFAULT_TEMPLATES.AD_PUSH_BLAST;
  assert.ok(sql.includes(`'${tpl.template_key}'`));
  assert.ok(sql.includes(`'${tpl.title_en}'`), 'seeded English title must match the in-code default');
  assert.ok(sql.includes(`'${tpl.title_bn}'`), 'seeded Bangla title must match the in-code default');
});

test('refund ledger entries carry distinct idempotency keys (a group-level key collides with itself)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/services/adRefund.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('`${keyBase}:credit`'));
  assert.ok(src.includes('`${keyBase}:debit`'));
  const groupArgs = src.slice(src.indexOf('recordTransactionGroup('), src.indexOf('entries:'));
  assert.ok(!groupArgs.includes('idempotencyKey'), 'no group-level key');
  // both refund flows go through the shared helper with their own reason-specific base
  const push = readFileSync(new URL('../src/services/adPushBlast.service.ts', import.meta.url), 'utf8');
  const ads = readFileSync(new URL('../src/services/ads.service.ts', import.meta.url), 'utf8');
  assert.ok(push.includes('keyBase: `ad-push-refund:${campaign.id}`'));
  assert.ok(ads.includes('keyBase: `ad-reject-refund:${campaignId}`'));
});

test('the run length of a prepaid campaign never comes from its quantity', async () => {
  const { readFileSync } = await import('node:fs');
  const ads = readFileSync(new URL('../src/services/ads.service.ts', import.meta.url), 'utf8');
  assert.ok(!/duration_days\)\s*\|\|\s*Number\(campaignData\.quantity\)/.test(ads), 'quantity is slots/recipients, not days');
});

test('push targeting: empty means everyone, malformed values are dropped, spellings are folded', async () => {
  const { parsePushTargeting } = await import('../src/services/adPushBlast.service.ts');
  assert.deepEqual(parsePushTargeting(null), { districtKeys: [], categoryIds: [] });
  assert.deepEqual(parsePushTargeting({ districts: [], categories: [] }), { districtKeys: [], categoryIds: [] });
  const t = parsePushTargeting({ districts: ['Chattogram', ' Dhaka ', 7, null], categories: [3, '3', 'x', -1, 2.5, 9] });
  assert.deepEqual(t.categoryIds, [3, 9]);
  // Chattogram and its older spelling are both accepted, and Dhaka is kept
  assert.ok(t.districtKeys.includes('chattogram') && t.districtKeys.includes('chittagong'));
  assert.ok(t.districtKeys.includes('dhaka'));
});

test('district spellings that mean the same place compare equal', async () => {
  const { normalizeDistrict, districtMatchKeys } = await import('../src/lib/districtMatch.ts');
  assert.equal(normalizeDistrict("Cox's Bazar"), 'coxsbazar');
  assert.equal(normalizeDistrict(null), '');
  for (const [a, b] of [['Barishal', 'Barisal'], ['Bogura', 'Bogra'], ['Chattogram', 'Chittagong'], ['Cumilla', 'Comilla'], ['Jashore', 'Jessore']]) {
    assert.ok(districtMatchKeys([a]).includes(normalizeDistrict(b)), `${a} should match ${b}`);
    assert.ok(districtMatchKeys([b]).includes(normalizeDistrict(a)), `${b} should match ${a}`);
  }
  assert.ok(!districtMatchKeys(['Dhaka']).includes('gazipur'));
  assert.deepEqual(districtMatchKeys([]), []);
});

test('stored targeting is cut down to safe, bounded lists', async () => {
  const { normalizeTargeting } = await import('../src/services/ads.service.ts');
  assert.deepEqual(normalizeTargeting(undefined), { keywords: [], categories: [], districts: [] });
  const t = normalizeTargeting({
    keywords: ['saree', ' saree ', '', 5, 'x'.repeat(200)],
    categories: [1, '2', 'bad', 1, -4],
    districts: Array.from({ length: 100 }, (_, i) => `D${i}`),
  });
  assert.deepEqual(t.keywords, ['saree', 'x'.repeat(60)]);
  assert.deepEqual(t.categories, [1, 2]);
  assert.equal(t.districts.length, 64);
});
