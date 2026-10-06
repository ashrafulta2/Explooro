/**
 * subscriptionBilling.test.js — the renewal state machine and the merchant-facing wiring.
 *
 * Invariants:
 *   - a cancelled subscription is never renewed, and one that is still inside its paid period is untouched;
 *   - a failed renewal gets a grace window and is retried quietly, then expires when grace is over;
 *   - a waiver only lifts when it has an end date that has passed (PERMANENT stays);
 *   - a reminder fires once per period, only for a paid, auto-renewing plan;
 *   - every merchant route is behind the module switch AND the own-subscription permission.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideRenewalAction } from '../src/services/subscriptionBilling.service.js';

const NOW = new Date('2026-10-10T12:00:00Z');
const settings = { renewal_reminder_days: 3 };
const day = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();
const sub = (over = {}) => ({
  status: 'ACTIVE', current_period_end: day(10), auto_renew: true, cancel_at_period_end: false,
  grace_ends_at: null, waiver_ends_at: null, renewal_reminded_for: null, monthly_fee: 999, ...over,
});
const decide = (over) => decideRenewalAction(sub(over), NOW, settings);

describe('ACTIVE', () => {
  test('inside the paid period and outside the reminder window: nothing', () => {
    assert.equal(decide({}), 'NONE');
  });
  test('period over + auto-renew => RENEW', () => {
    assert.equal(decide({ current_period_end: day(-0.01) }), 'RENEW');
  });
  test('period over + cancelled => CANCEL, never RENEW', () => {
    assert.equal(decide({ current_period_end: day(-1), cancel_at_period_end: true }), 'CANCEL');
  });
  test('period over + auto-renew off => EXPIRE', () => {
    assert.equal(decide({ current_period_end: day(-1), auto_renew: false }), 'EXPIRE');
  });
  test('a cancelled plan still inside its period is left alone (benefits run to period end)', () => {
    assert.equal(decide({ current_period_end: day(1), cancel_at_period_end: true, auto_renew: false }), 'NONE');
  });
});

describe('reminders', () => {
  test('inside the window and not yet reminded => REMIND', () => {
    assert.equal(decide({ current_period_end: day(2) }), 'REMIND');
  });
  test('already reminded for this period end => NONE', () => {
    const end = day(2);
    assert.equal(decide({ current_period_end: end, renewal_reminded_for: end }), 'NONE');
  });
  test('a reminder for an OLD period end does not suppress the new one', () => {
    assert.equal(decide({ current_period_end: day(2), renewal_reminded_for: day(-28) }), 'REMIND');
  });
  test('no reminder for a free plan, a non-renewing plan, or the window set to 0 days', () => {
    assert.equal(decide({ current_period_end: day(2), monthly_fee: 0 }), 'NONE');
    assert.equal(decide({ current_period_end: day(2), auto_renew: false }), 'NONE');
    assert.equal(decideRenewalAction(sub({ current_period_end: day(2) }), NOW, { renewal_reminder_days: 0 }), 'NONE');
  });
});

describe('PAST_DUE', () => {
  test('inside grace => RETRY', () => {
    assert.equal(decide({ status: 'PAST_DUE', current_period_end: day(-2), grace_ends_at: day(3) }), 'RETRY');
  });
  test('grace over => EXPIRE_GRACE', () => {
    assert.equal(decide({ status: 'PAST_DUE', current_period_end: day(-9), grace_ends_at: day(-1) }), 'EXPIRE_GRACE');
  });
});

describe('WAIVED', () => {
  test('a permanent waiver (no end date) is never lifted', () => {
    assert.equal(decide({ status: 'WAIVED', waiver_ends_at: null, current_period_end: day(-90) }), 'NONE');
  });
  test('a timed waiver that has ended is lifted; one still running is not', () => {
    assert.equal(decide({ status: 'WAIVED', waiver_ends_at: day(-1) }), 'LIFT_WAIVER');
    assert.equal(decide({ status: 'WAIVED', waiver_ends_at: day(5) }), 'NONE');
  });
});

describe('terminal states', () => {
  test('CANCELLED and EXPIRED are never touched', () => {
    assert.equal(decide({ status: 'CANCELLED', current_period_end: day(-5) }), 'NONE');
    assert.equal(decide({ status: 'EXPIRED', current_period_end: day(-5) }), 'NONE');
  });
});

describe('merchant routes', () => {
  const src = readFileSync(new URL('../src/routes/subscription.routes.js', import.meta.url), 'utf8');

  test('all four are guarded by the module switch and finance.subscription.subscribe_own', () => {
    const own = src.slice(src.indexOf('const ownSubscription'));
    assert.match(own, /app\.requireModule\('subscription_fees'\)/);
    assert.match(own, /requirePermission\('finance\.subscription\.subscribe_own'\)/);
    for (const path of ['/subscriptions/me', '/subscriptions/subscribe', '/subscriptions/cancel', '/subscriptions/resume']) {
      const at = own.indexOf(`'${path}'`);
      assert.ok(at > -1, `${path} is missing`);
      assert.match(own.slice(at, at + 200), /preHandler: ownSubscription/);
    }
  });

  test('subscribe validates its body (integer plan_id, no extra keys)', () => {
    assert.match(src, /required: \['plan_id'\][\s\S]*additionalProperties: false/);
  });

  test('the renewal job is registered against the module, so OFF means nothing is billed', () => {
    const job = readFileSync(new URL('../src/jobs/subscriptionRenewal.job.js', import.meta.url), 'utf8');
    assert.match(job, /moduleKey: 'subscription_fees'/);
    const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    assert.match(app, /jobs\/subscriptionRenewal\.job\.js/);
    assert.match(app, /register\(subscriptionRoutes/);
  });
});
