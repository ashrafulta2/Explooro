/**
 * subscriptionBilling.service.js — Saler Pro from the merchant's side, and the renewal engine.
 *
 * Self-serve: subscribe, cancel, resume. Background: the hourly renewal sweep (jobs/
 * subscriptionRenewal.job.js) that bills renewals, runs the grace period, lifts expired waivers and
 * sends reminders. Admin-side plan / settings CRUD lives in subscription.service.js.
 *
 * Invariants:
 *   - a fee moves Vault -> platform treasury as ONE balanced double-entry group (SUBSCRIPTION_FEE),
 *     inside the same transaction as the invoice row, with the saler's wallet locked FOR UPDATE;
 *   - one PAID invoice per subscription per period (unique index + idempotency key), so a retried
 *     request or a double-fired sweep cannot charge the same month twice;
 *   - cancelling never cuts benefits early: the plan runs to period end;
 *   - every number (price, grace days, period length, reminder window) is read from a plan row or
 *     the module settings — none is a constant here.
 *
 * WHY a renewal starts its new period at `now` (not at the old period end): if the module was OFF
 * when a period lapsed, billing from the old end date would charge for time the admin had switched
 * the feature off. Starting at `now` can only ever favour the saler by under one sweep interval.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { writeAudit } from '../lib/audit.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';
import * as notificationService from './notification.service.js';
import { getEngineSettings, listPlans } from './subscription.service.js';
import { isEnabled } from './module.service.js';

const MODULE_KEY = 'subscription_fees';
const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE = ['ACTIVE', 'PAST_DUE', 'WAIVED'];

const toPaisa = (v) => Math.round(Number(v) * 100);
const addDays = (date, days) => new Date(new Date(date).getTime() + days * DAY_MS);

/**
 * The renewal state machine as a pure function, so every transition is testable without a DB.
 * Returns what the sweep should do with one subscription right now:
 *   LIFT_WAIVER  a timed waiver ran out -> back to ACTIVE
 *   RENEW        period over, auto-renew on -> charge the next period
 *   CANCEL       period over and the saler cancelled -> CANCELLED
 *   EXPIRE       period over and auto-renew is off -> EXPIRED
 *   RETRY        PAST_DUE inside grace -> try the charge again
 *   EXPIRE_GRACE PAST_DUE and grace is over -> EXPIRED
 *   REMIND       renewal is near and the saler has not been told yet
 *   NONE
 */
export function decideRenewalAction(sub, now, { renewal_reminder_days: reminderDays }) {
  const t = new Date(now).getTime();
  const end = new Date(sub.current_period_end).getTime();

  if (sub.status === 'WAIVED') {
    return sub.waiver_ends_at && new Date(sub.waiver_ends_at).getTime() <= t ? 'LIFT_WAIVER' : 'NONE';
  }
  if (sub.status === 'PAST_DUE') {
    return sub.grace_ends_at && new Date(sub.grace_ends_at).getTime() <= t ? 'EXPIRE_GRACE' : 'RETRY';
  }
  if (sub.status !== 'ACTIVE') return 'NONE';

  if (end <= t) {
    if (sub.cancel_at_period_end) return 'CANCEL';
    return sub.auto_renew ? 'RENEW' : 'EXPIRE';
  }
  const alreadyReminded = sub.renewal_reminded_for && new Date(sub.renewal_reminded_for).getTime() === end;
  const renewsWithin = end - t <= reminderDays * DAY_MS;
  if (sub.auto_renew && !sub.cancel_at_period_end && Number(sub.monthly_fee) > 0 && renewsWithin && !alreadyReminded) {
    return 'REMIND';
  }
  return 'NONE';
}

async function platformTreasuryUserId(client) {
  const { rows } = await client.query(
    `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.key = 'super_admin'
      ORDER BY u.id ASC LIMIT 1`
  );
  return rows[0]?.id ?? 1;
}

/**
 * Charges one period. Must run inside the caller's transaction. Never throws for a short balance —
 * it returns { ok: false } so the caller decides (subscribe refuses; renewal starts the grace period).
 */
async function chargePeriod(client, { sub, plan, periodStart, periodEnd }) {
  const amountPaisa = toPaisa(plan.monthly_fee);
  if (amountPaisa <= 0) return { ok: true, charged: 0 };

  const wallet = await walletRepo.getOrCreateWallet(client, sub.user_id, { client });
  const [locked] = await walletRepo.getWalletsByIdsForUpdate(client, [wallet.id]);
  if (toPaisa(locked.available_balance) < amountPaisa) {
    return { ok: false, reason: 'INSUFFICIENT_VAULT_BALANCE' };
  }

  const amount = (amountPaisa / 100).toFixed(2);
  const txnGroupId = randomUUID();
  const key = `sub:${sub.id}:${periodStart.toISOString()}`;
  const { rows } = await client.query(
    `INSERT INTO subscription_invoices
       (subscription_id, user_id, plan_id, amount, period_start, period_end, status, ledger_txn_group_id, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, 'PAID', $7, $8)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [sub.id, sub.user_id, plan.id, amount, periodStart, periodEnd, txnGroupId, key]
  );
  // WHY: the key already exists => this period was billed by an earlier attempt. Not charging again
  // IS the correct outcome, so report success without touching the ledger.
  if (!rows.length) return { ok: true, charged: 0, duplicate: true };

  const treasury = await walletRepo.getOrCreateWallet(client, await platformTreasuryUserId(client), { client });
  await ledgerService.recordTransactionGroup(client, {
    txnGroupId,
    defaultCategory: 'SUBSCRIPTION_FEE',
    defaultReferenceType: 'subscription_invoices',
    defaultReferenceId: rows[0].id,
    memo: `${plan.name_en} subscription ${periodStart.toISOString().slice(0, 10)} – ${periodEnd.toISOString().slice(0, 10)}`,
    entries: [
      { walletId: wallet.id, entryType: 'DEBIT', amount, balanceBucket: 'AVAILABLE' },
      { walletId: treasury.id, entryType: 'CREDIT', amount, balanceBucket: 'AVAILABLE' },
    ],
  });
  return { ok: true, charged: Number(amount), invoiceId: rows[0].id };
}

async function recordFailedInvoice(client, { sub, plan, periodStart, periodEnd, reason }) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM subscription_invoices WHERE subscription_id = $1 AND status = 'FAILED'`,
    [sub.id]
  );
  await client.query(
    `INSERT INTO subscription_invoices
       (subscription_id, user_id, plan_id, amount, period_start, period_end, status, idempotency_key, failure_reason)
     VALUES ($1, $2, $3, $4, $5, $6, 'FAILED', $7, $8)`,
    [sub.id, sub.user_id, plan.id, plan.monthly_fee, periodStart, periodEnd,
      `sub:${sub.id}:${periodStart.toISOString()}:fail:${rows[0].n + 1}`, reason]
  );
}

const SUB_WITH_PLAN = `
  SELECT s.*, p.code AS plan_code, p.name_en AS plan_name_en, p.name_bn AS plan_name_bn,
         p.monthly_fee::float8 AS monthly_fee, p.free_listings, p.commission_rebate_pct::float8 AS commission_rebate_pct,
         p.role AS plan_role, p.is_active AS plan_is_active
    FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id`;

/** The saler's own view: plans they may pick, their live subscription and recent invoices. */
export async function getMySubscription(db, userId, { roles = [] } = {}) {
  const [plans, settings, current, invoices] = await Promise.all([
    listPlans(db, { onlyActive: true }),
    getEngineSettings(db),
    db.query(`${SUB_WITH_PLAN} WHERE s.user_id = $1 AND s.status = ANY($2) LIMIT 1`, [userId, LIVE]),
    db.query(
      `SELECT id, amount::float8 AS amount, period_start, period_end, status, failure_reason, created_at
         FROM subscription_invoices WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 12`,
      [userId]
    ),
  ]);
  return {
    plans: plans
      .filter((p) => p.role === 'ALL' || roles.includes(p.role))
      .map(({ active_subscribers, ...plan }) => plan),
    subscription: current.rows[0] ?? null,
    invoices: invoices.rows,
    billing_period_days: Number(settings.billing_period_days),
    grace_period_days: Number(settings.grace_period_days),
  };
}

/**
 * Subscribes the caller to a plan. A paid plan is charged for its first period up front; if the
 * Vault cannot cover it the whole request fails and nothing is created.
 */
export async function subscribe(db, user, { planId, autoRenew } = {}) {
  const settings = await getEngineSettings(db);
  return withTransaction(db, async (client) => {
    // WHY lock the user row: serialises two concurrent subscribe calls so the partial unique index
    // is a backstop, not the thing the user sees as a 500.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);

    const { rows: live } = await client.query(
      `SELECT id FROM subscriptions WHERE user_id = $1 AND status = ANY($2)`, [user.id, LIVE]
    );
    if (live.length) {
      throw new AppError('CONFLICT', 'You already have a plan. Cancel it before choosing another.',
        'আপনার ইতিমধ্যে একটি প্ল্যান আছে। নতুন প্ল্যান নেওয়ার আগে সেটি বাতিল করুন।');
    }

    const { rows: planRows } = await client.query(
      `SELECT id, code, name_en, role, monthly_fee::float8 AS monthly_fee, is_active FROM subscription_plans WHERE id = $1`, [planId]
    );
    const plan = planRows[0];
    if (!plan || !plan.is_active || !(plan.role === 'ALL' || (user.roles || []).includes(plan.role))) {
      throw new AppError('NOT_FOUND', 'That plan is not available.', 'এই প্ল্যানটি পাওয়া যাচ্ছে না।');
    }

    const now = new Date();
    const periodEnd = addDays(now, Number(settings.billing_period_days));
    const { rows } = await client.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end, auto_renew)
       VALUES ($1, $2, 'ACTIVE', $3, $4, $5) RETURNING id, user_id`,
      [user.id, plan.id, now, periodEnd, typeof autoRenew === 'boolean' ? autoRenew : Boolean(settings.auto_renew_default)]
    );
    const sub = rows[0];

    const charge = await chargePeriod(client, { sub, plan, periodStart: now, periodEnd });
    if (!charge.ok) {
      throw new AppError(
        'INSUFFICIENT_VAULT_BALANCE',
        `${plan.name_en} costs ৳${plan.monthly_fee.toFixed(2)} for the first period. Top up your vault and try again.`,
        `${plan.name_en}-এর প্রথম মাসের ফি ৳${plan.monthly_fee.toFixed(2)}। ভল্টে টাকা জমা দিয়ে আবার চেষ্টা করুন।`
      );
    }

    await writeAudit(client, {
      actor_id: user.id, actor_role: user.role ?? null, action: 'SUBSCRIBE_PLAN',
      target_type: 'SUBSCRIPTION', target_ref: `SUBSCRIBER:${sub.id}`,
      after_json: { plan: plan.code, charged: charge.charged, period_end: periodEnd },
    });
    return (await client.query(`${SUB_WITH_PLAN} WHERE s.id = $1`, [sub.id])).rows[0];
  });
}

/**
 * Cancel. A healthy ACTIVE plan keeps its benefits to the end of the paid period and then stops
 * (cancel_at_period_end). A PAST_DUE or WAIVED one has nothing paid to run out, so it ends now.
 */
export async function cancel(db, user) {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status = ANY($2) FOR UPDATE`, [user.id, LIVE]
    );
    const before = rows[0];
    if (!before) throw new AppError('NOT_FOUND', 'You have no active plan.', 'আপনার কোনো সক্রিয় প্ল্যান নেই।');

    const immediate = before.status !== 'ACTIVE';
    await client.query(
      immediate
        ? `UPDATE subscriptions SET status = 'CANCELLED', auto_renew = false, cancelled_at = now(), grace_ends_at = NULL, updated_at = now() WHERE id = $1`
        : `UPDATE subscriptions SET cancel_at_period_end = true, auto_renew = false, updated_at = now() WHERE id = $1`,
      [before.id]
    );
    const after = (await client.query(`${SUB_WITH_PLAN} WHERE s.id = $1`, [before.id])).rows[0];
    await writeAudit(client, {
      actor_id: user.id, actor_role: user.role ?? null, action: 'CANCEL_SUBSCRIPTION',
      target_type: 'SUBSCRIPTION', target_ref: `SUBSCRIBER:${before.id}`,
      before_json: { status: before.status, cancel_at_period_end: before.cancel_at_period_end },
      after_json: { status: after.status, cancel_at_period_end: after.cancel_at_period_end },
    });
    return after;
  });
}

/** Undo a pending cancellation while the paid period is still running. */
export async function resume(db, user) {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'ACTIVE' AND cancel_at_period_end FOR UPDATE`, [user.id]
    );
    if (!rows.length) {
      throw new AppError('CONFLICT', 'There is no pending cancellation to undo.', 'বাতিলের কোনো অনুরোধ নেই যা ফেরানো যায়।');
    }
    await client.query(
      `UPDATE subscriptions SET cancel_at_period_end = false, auto_renew = true, updated_at = now() WHERE id = $1`, [rows[0].id]
    );
    await writeAudit(client, {
      actor_id: user.id, actor_role: user.role ?? null, action: 'RESUME_SUBSCRIPTION',
      target_type: 'SUBSCRIPTION', target_ref: `SUBSCRIBER:${rows[0].id}`,
      before_json: { cancel_at_period_end: true }, after_json: { cancel_at_period_end: false },
    });
    return (await client.query(`${SUB_WITH_PLAN} WHERE s.id = $1`, [rows[0].id])).rows[0];
  });
}

/** Applies one decided action to one subscription, in its own transaction. Returns the action taken. */
async function applyAction(db, subId, settings, now) {
  const notices = [];
  const action = await withTransaction(db, async (client) => {
    // Re-read under lock: the row may have changed since the sweep listed it (saler cancelled, admin waived).
    const { rows } = await client.query(`${SUB_WITH_PLAN} WHERE s.id = $1 FOR UPDATE OF s`, [subId]);
    const sub = rows[0];
    if (!sub) return 'NONE';
    const action = decideRenewalAction(sub, now, settings);
    const plan = { id: sub.plan_id, name_en: sub.plan_name_en, monthly_fee: sub.monthly_fee };

    switch (action) {
      case 'LIFT_WAIVER':
        await client.query(
          `UPDATE subscriptions SET status = 'ACTIVE', waiver_reason = NULL, waiver_ends_at = NULL, waived_by = NULL, updated_at = now() WHERE id = $1`,
          [sub.id]
        );
        break;
      case 'CANCEL':
        await client.query(
          `UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = now(), updated_at = now() WHERE id = $1`, [sub.id]
        );
        break;
      case 'EXPIRE':
      case 'EXPIRE_GRACE':
        await client.query(
          `UPDATE subscriptions SET status = 'EXPIRED', grace_ends_at = NULL, updated_at = now() WHERE id = $1`, [sub.id]
        );
        break;
      case 'REMIND':
        await client.query(`UPDATE subscriptions SET renewal_reminded_for = current_period_end WHERE id = $1`, [sub.id]);
        notices.push({
          userId: sub.user_id, templateKey: 'SUBSCRIPTION_RENEWAL_REMINDER',
          data: { planName: sub.plan_name_en, renewalDate: new Date(sub.current_period_end).toISOString().slice(0, 10), amount: sub.monthly_fee.toFixed(2) },
        });
        break;
      case 'RENEW':
      case 'RETRY': {
        const periodEnd = addDays(now, Number(settings.billing_period_days));
        const charge = await chargePeriod(client, { sub, plan, periodStart: now, periodEnd });
        if (charge.ok) {
          await client.query(
            `UPDATE subscriptions SET status = 'ACTIVE', current_period_start = $2, current_period_end = $3,
                    grace_ends_at = NULL, updated_at = now() WHERE id = $1`,
            [sub.id, now, periodEnd]
          );
        } else if (action === 'RENEW') {
          // First failure: open the grace window and tell the saler once. Retries stay quiet.
          const graceEnds = addDays(now, Number(settings.grace_period_days));
          await recordFailedInvoice(client, { sub, plan, periodStart: now, periodEnd, reason: charge.reason });
          await client.query(
            `UPDATE subscriptions SET status = 'PAST_DUE', grace_ends_at = $2, updated_at = now() WHERE id = $1`, [sub.id, graceEnds]
          );
          notices.push({
            userId: sub.user_id, templateKey: 'SUBSCRIPTION_PAYMENT_FAILED',
            data: { planName: sub.plan_name_en, amount: sub.monthly_fee.toFixed(2), graceEndsAt: graceEnds.toISOString().slice(0, 10) },
          });
        }
        break;
      }
      default:
        return 'NONE';
    }

    if (action !== 'REMIND' && action !== 'RETRY') {
      await writeAudit(client, {
        actor_id: null, actor_role: 'system', action: `SUBSCRIPTION_${action}`,
        target_type: 'SUBSCRIPTION', target_ref: `SUBSCRIBER:${sub.id}`,
        before_json: { status: sub.status, current_period_end: sub.current_period_end },
      });
    }
    return action;
  });

  // WHY after commit: a notification failure must never undo a charge that already happened.
  for (const n of notices) await notificationService.notify(db, n).catch(() => {});
  return action;
}

/**
 * One pass over every subscription that might need action. Idempotent: running it twice in a row
 * does nothing the second time. A failure on one subscription is recorded and does not stop the rest.
 */
export async function runRenewalSweep(db, cache, now = new Date()) {
  if (!(await isEnabled(db, cache, MODULE_KEY))) return { processedCount: 0, successCount: 0, errorCount: 0, errors: [], metadata: { skipped: 'MODULE_DISABLED' } };

  const settings = await getEngineSettings(db);
  const horizon = addDays(now, Number(settings.renewal_reminder_days));
  const { rows } = await db.query(
    `SELECT id FROM subscriptions
      WHERE (status = 'ACTIVE' AND current_period_end <= $1)
         OR status = 'PAST_DUE'
         OR (status = 'WAIVED' AND waiver_ends_at IS NOT NULL AND waiver_ends_at <= $2)
      ORDER BY id`,
    [horizon, now]
  );

  const tally = {};
  const errors = [];
  let successCount = 0;
  for (const { id } of rows) {
    try {
      const action = await applyAction(db, id, settings, now);
      tally[action] = (tally[action] ?? 0) + 1;
      successCount += 1;
    } catch (err) {
      errors.push({ subscriptionId: id, message: err.message });
    }
  }
  return { processedCount: rows.length, successCount, errorCount: errors.length, errors, metadata: tally };
}
