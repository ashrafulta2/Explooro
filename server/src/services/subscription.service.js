/**
 * subscription.service.js — Seller subscription plans (Saler Pro) — admin side.
 *
 * Everything here sits behind the `subscription_fees` module (default OFF). The module switch is the
 * only on/off control: with it OFF the tables are inert, nothing is billed and pricing ignores the
 * rebate. Plans, rebate %, grace days and the billing period are rows / module settings an admin
 * edits at /admin/finance/subscriptions — none of them is a constant in this file.
 *
 * Invariants:
 *   - a plan's rebate can never exceed the platform's current global share (it moves points from
 *     the platform's cut to the saler's; it must not push the platform share below zero);
 *   - plan `code` is immutable after creation (invoices and audit rows refer to it);
 *   - every write is audited with before/after.
 */

import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { writeAudit } from '../lib/audit.js';
import * as moduleRepo from '../repositories/module.repository.js';
import { resolvePlatformPricingConfig } from './pricing.service.js';

export const MODULE_KEY = 'subscription_fees';

/**
 * WHY a fallback table: 003_modules.sql re-seeds the settings *schema* but deliberately never
 * overwrites `settings_json` (that would reset an admin's edits), so a database seeded before a key
 * existed lacks it. These mirror the seed defaults and apply only to keys that are missing.
 */
export const ENGINE_DEFAULTS = Object.freeze({
  monthly_fee: 0,
  listing_fee: 0,
  free_listing_quota: 100,
  default_overage_fee: 5,
  grace_period_days: 5,
  billing_period_days: 30,
  renewal_reminder_days: 3,
  auto_renew_default: true,
});

const INTEGER_SETTINGS = ['free_listing_quota', 'grace_period_days', 'billing_period_days', 'renewal_reminder_days'];
const MONEY_SETTINGS = ['monthly_fee', 'listing_fee', 'default_overage_fee'];
const BOOLEAN_SETTINGS = ['auto_renew_default'];

const PLAN_ROLES = ['ALL', 'saler', 'supplier'];
const MAX_FEATURES = 12;
const MAX_FEATURE_LENGTH = 160;
const MAX_NAME_LENGTH = 80;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function invalid(message_en, message_bn, details) {
  return new AppError('VALIDATION_FAILED', message_en, message_bn, details);
}

function toNumber(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const n = typeof value === 'number' ? value : Number(value);
  if (value === '' || value === null || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw invalid(
      `${field} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`,
      `${field} অবশ্যই ${min} থেকে ${max}-এর মধ্যে হতে হবে।`,
      { field }
    );
  }
  return n;
}

function toFeatureList(value, field) {
  if (!Array.isArray(value) || value.length > MAX_FEATURES) {
    throw invalid(
      `${field} must be a list of at most ${MAX_FEATURES} items.`,
      `${field} সর্বোচ্চ ${MAX_FEATURES}টি আইটেমের তালিকা হতে হবে।`,
      { field }
    );
  }
  return value.map((item) => {
    const text = String(item ?? '').trim();
    if (!text || text.length > MAX_FEATURE_LENGTH) {
      throw invalid(
        `Each item in ${field} must be 1–${MAX_FEATURE_LENGTH} characters.`,
        `${field}-এর প্রতিটি আইটেম ১–${MAX_FEATURE_LENGTH} অক্ষরের হতে হবে।`,
        { field }
      );
    }
    return text;
  });
}

function toName(value, field) {
  const text = String(value ?? '').trim();
  if (!text || text.length > MAX_NAME_LENGTH) {
    throw invalid(
      `${field} is required (max ${MAX_NAME_LENGTH} characters).`,
      `${field} আবশ্যক (সর্বোচ্চ ${MAX_NAME_LENGTH} অক্ষর)।`,
      { field }
    );
  }
  return text;
}

/**
 * Validates and normalises a plan body. Pure — no I/O — so the rules are testable without a DB.
 * `partial: true` (update) only validates the keys that were sent; create requires the names.
 * Unknown keys are ignored, never stored.
 */
export function parsePlanInput(body = {}, { partial = false } = {}) {
  const has = (k) => body[k] !== undefined;
  const out = {};

  if (!partial || has('name_en')) out.name_en = toName(body.name_en, 'name_en');
  if (!partial || has('name_bn')) out.name_bn = toName(body.name_bn ?? body.name_en, 'name_bn');
  if (has('role')) {
    if (!PLAN_ROLES.includes(body.role)) {
      throw invalid(`role must be one of ${PLAN_ROLES.join(', ')}.`, 'role অবৈধ।', { field: 'role' });
    }
    out.role = body.role;
  }
  if (has('monthly_fee')) out.monthly_fee = toNumber(body.monthly_fee, 'monthly_fee');
  if (has('free_listings')) out.free_listings = toNumber(body.free_listings, 'free_listings', { integer: true, max: 2147483647 });
  if (has('extra_listing_fee')) out.extra_listing_fee = toNumber(body.extra_listing_fee, 'extra_listing_fee');
  if (has('commission_rebate_pct')) out.commission_rebate_pct = toNumber(body.commission_rebate_pct, 'commission_rebate_pct', { max: 100 });
  if (has('features_en')) out.features_en = toFeatureList(body.features_en, 'features_en');
  if (has('features_bn')) out.features_bn = toFeatureList(body.features_bn, 'features_bn');
  if (has('is_active')) out.is_active = Boolean(body.is_active);
  if (has('sort_order')) out.sort_order = toNumber(body.sort_order, 'sort_order', { integer: true, min: -1000000, max: 1000000 });
  return out;
}

/**
 * A rebate moves points from the platform's share to the saler's, so it cannot exceed what the
 * platform currently keeps. Throws; otherwise returns the rebate unchanged.
 */
export function assertRebateWithinPlatformShare(rebatePct, platformSplitPct) {
  if (Number(rebatePct) > Number(platformSplitPct)) {
    throw invalid(
      `Rebate (${rebatePct}%) cannot exceed the platform's current share (${platformSplitPct}%).`,
      `রিবেট (${rebatePct}%) প্ল্যাটফর্মের বর্তমান ভাগ (${platformSplitPct}%) ছাড়াতে পারবে না।`,
      { field: 'commission_rebate_pct', platform_split_pct: platformSplitPct }
    );
  }
  return rebatePct;
}

const WAIVER_FOREVER = 'PERMANENT';
const MAX_WAIVER_MONTHS = 60;

/** "3_MONTHS" -> 3, "PERMANENT" -> null (no end date). Anything else is rejected. */
export function parseWaiverDuration(value = WAIVER_FOREVER) {
  if (value === WAIVER_FOREVER) return null;
  const match = /^(\d{1,2})_MONTHS$/.exec(String(value));
  const months = match ? Number(match[1]) : 0;
  if (months < 1 || months > MAX_WAIVER_MONTHS) {
    throw invalid(
      `waiver_duration must be PERMANENT or N_MONTHS (1–${MAX_WAIVER_MONTHS}).`,
      `waiver_duration অবৈধ।`,
      { field: 'waiver_duration' }
    );
  }
  return months;
}

/** Validates a settings patch. Only the keys in ENGINE_DEFAULTS are accepted; others are rejected. */
export function parseEngineSettings(patch = {}) {
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in ENGINE_DEFAULTS)) {
      throw invalid(`Unknown setting "${key}".`, `অজানা সেটিং "${key}"।`, { field: key });
    }
    if (INTEGER_SETTINGS.includes(key)) out[key] = toNumber(value, key, { integer: true, max: 100000 });
    else if (MONEY_SETTINGS.includes(key)) out[key] = toNumber(value, key);
    else if (BOOLEAN_SETTINGS.includes(key)) out[key] = Boolean(value);
  }
  return out;
}

export function slugifyCode(nameEn) {
  const slug = String(nameEn).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug || 'plan';
}

/** The module row's switch plus every setting, with defaults filling any key an old row lacks. */
export async function getEngineSettings(db) {
  const row = await moduleRepo.getModuleByKey(db, MODULE_KEY);
  return {
    is_enabled: Boolean(row?.is_enabled),
    ...ENGINE_DEFAULTS,
    ...(row?.settings_json || {}),
  };
}

export async function updateEngineSettings(db, patch, actor) {
  const clean = parseEngineSettings(patch);
  return withTransaction(db, async (client) => {
    const row = await moduleRepo.getModuleByKey(client, MODULE_KEY);
    if (!row) throw new AppError('NOT_FOUND', 'The subscription module is not seeded.', 'সাবস্ক্রিপশন মডিউল সিড করা নেই।');
    const before = { ...ENGINE_DEFAULTS, ...(row.settings_json || {}) };
    const after = { ...before, ...clean };
    await moduleRepo.updateModuleSettings(client, MODULE_KEY, { settingsJson: after, updatedBy: actor?.id ?? null });
    await writeAudit(client, {
      actor_id: actor?.id ?? null,
      actor_role: actor?.role ?? null,
      action: 'UPDATE_SUBSCRIPTION_SETTINGS',
      target_type: 'SUBSCRIPTION',
      target_ref: 'MODULE_SETTINGS',
      before_json: before,
      after_json: after,
    });
    return after;
  });
}

const PLAN_COLUMNS = `p.id, p.code, p.name_en, p.name_bn, p.role, p.monthly_fee::float8 AS monthly_fee,
  p.free_listings, p.extra_listing_fee::float8 AS extra_listing_fee,
  p.commission_rebate_pct::float8 AS commission_rebate_pct, p.features_en, p.features_bn,
  p.is_active, p.sort_order`;

export async function listPlans(db, { onlyActive = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${PLAN_COLUMNS},
            (SELECT count(*)::int FROM subscriptions s
              WHERE s.plan_id = p.id AND s.status IN ('ACTIVE','PAST_DUE','WAIVED')) AS active_subscribers
       FROM subscription_plans p
      WHERE ($1::boolean = false OR p.is_active)
      ORDER BY p.sort_order, p.id`,
    [onlyActive]
  );
  return rows;
}

async function currentPlatformShare(db) {
  const config = await resolvePlatformPricingConfig(db);
  return config.platformSplitPct;
}

export async function createPlan(db, body, actor) {
  const data = parsePlanInput(body);
  const rebate = data.commission_rebate_pct ?? 0;
  assertRebateWithinPlatformShare(rebate, await currentPlatformShare(db));

  return withTransaction(db, async (client) => {
    // WHY a suffix loop: two plans may share an English name; the code only has to be unique.
    const base = slugifyCode(data.name_en);
    let code = base;
    for (let n = 2; ; n += 1) {
      const { rows } = await client.query('SELECT 1 FROM subscription_plans WHERE code = $1', [code]);
      if (!rows.length) break;
      code = `${base}_${n}`;
    }
    const { rows } = await client.query(
      `INSERT INTO subscription_plans
         (code, name_en, name_bn, role, monthly_fee, free_listings, extra_listing_fee,
          commission_rebate_pct, features_en, features_bn, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)
       RETURNING id`,
      [
        code, data.name_en, data.name_bn, data.role ?? 'ALL', data.monthly_fee ?? 0,
        data.free_listings ?? ENGINE_DEFAULTS.free_listing_quota, data.extra_listing_fee ?? 0, rebate,
        JSON.stringify(data.features_en ?? []), JSON.stringify(data.features_bn ?? []),
        data.is_active ?? true, data.sort_order ?? 0,
      ]
    );
    const plan = await getPlan(client, rows[0].id);
    await writeAudit(client, {
      actor_id: actor?.id ?? null,
      actor_role: actor?.role ?? null,
      action: 'CREATE_SUBSCRIPTION_PLAN',
      target_type: 'SUBSCRIPTION',
      target_ref: plan.code,
      after_json: plan,
    });
    return plan;
  });
}

export async function getPlan(db, id) {
  const { rows } = await db.query(`SELECT ${PLAN_COLUMNS} FROM subscription_plans p WHERE p.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function updatePlan(db, id, patch, actor) {
  const data = parsePlanInput(patch, { partial: true });
  if (data.commission_rebate_pct !== undefined) {
    assertRebateWithinPlatformShare(data.commission_rebate_pct, await currentPlatformShare(db));
  }
  const keys = Object.keys(data);
  if (!keys.length) throw invalid('Nothing to update.', 'আপডেট করার কিছু নেই।');

  return withTransaction(db, async (client) => {
    const before = await client.query(`SELECT ${PLAN_COLUMNS} FROM subscription_plans p WHERE p.id = $1 FOR UPDATE`, [id]);
    if (!before.rows.length) throw new AppError('NOT_FOUND', 'Plan not found.', 'প্ল্যান পাওয়া যায়নি।');

    const jsonCols = ['features_en', 'features_bn'];
    const sets = keys.map((k, i) => `${k} = $${i + 2}${jsonCols.includes(k) ? '::jsonb' : ''}`);
    const values = keys.map((k) => (jsonCols.includes(k) ? JSON.stringify(data[k]) : data[k]));
    await client.query(`UPDATE subscription_plans SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [id, ...values]);

    const after = await getPlan(client, id);
    await writeAudit(client, {
      actor_id: actor?.id ?? null,
      actor_role: actor?.role ?? null,
      action: 'UPDATE_SUBSCRIPTION_PLAN',
      target_type: 'SUBSCRIPTION',
      target_ref: after.code,
      before_json: before.rows[0],
      after_json: after,
    });
    return after;
  });
}

const ROLE_SQL = `CASE WHEN EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                                     WHERE ur.user_id = u.id AND r.key = 'supplier')
                       THEN 'supplier' ELSE 'saler' END`;

/** Paginated roster. `quota_used` is the merchant's live listings, measured against the plan's quota. */
export async function listSubscribers(db, { status = null, page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
  const { rows } = await db.query(
    `SELECT s.id, s.status, s.current_period_end AS next_renewal, s.waiver_reason, s.waiver_ends_at,
            (s.status = 'WAIVED') AS waived,
            u.id AS user_id, u.ref, u.phone,
            COALESCE(up.display_name, up.full_name, u.ref) AS merchant_name,
            COALESCE((SELECT vs.shop_name FROM virtual_stores vs WHERE vs.saler_id = u.id ORDER BY vs.id LIMIT 1), '') AS store_name,
            ${ROLE_SQL} AS role,
            p.id AS plan_id, p.name_en AS plan_name, p.monthly_fee::float8 AS monthly_fee,
            p.free_listings AS quota_total,
            CASE WHEN ${ROLE_SQL} = 'supplier'
                 THEN (SELECT count(*)::int FROM products pr WHERE pr.supplier_id = u.id AND pr.deleted_at IS NULL AND pr.status = 'ACTIVE')
                 ELSE (SELECT count(*)::int FROM saler_store_items si WHERE si.saler_id = u.id AND si.is_active)
            END AS quota_used,
            count(*) OVER () AS total
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN subscription_plans p ON p.id = s.plan_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE s.status IN ('ACTIVE','PAST_DUE','WAIVED') AND ($1::text IS NULL OR s.status = $1)
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $2 OFFSET $3`,
    [status, size, offset]
  );
  return {
    subscribers: rows.map(({ total, ...row }) => row),
    total: rows.length ? Number(rows[0].total) : 0,
    page: Math.floor(offset / size) + 1,
    page_size: size,
  };
}

/**
 * Real figures from the tables. Two the old mock invented are reported honestly: `overage_fees_bdt`
 * is 0 because per-listing overage billing does not exist yet, and `churn_rate_pct` is the share of
 * paid subscriptions that ended in the last 30 days.
 */
export async function getMetrics(db) {
  const { rows } = await db.query(
    `SELECT
       COALESCE(SUM(p.monthly_fee) FILTER (WHERE s.status = 'ACTIVE' AND p.monthly_fee > 0), 0)::float8 AS mrr_bdt,
       count(*) FILTER (WHERE s.status = 'ACTIVE' AND p.monthly_fee > 0)::int AS paid_subscribers_count,
       count(*) FILTER (WHERE s.status = 'PAST_DUE')::int AS past_due_count,
       count(*) FILTER (WHERE s.status = 'WAIVED')::int AS waived_count
     FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.status IN ('ACTIVE','PAST_DUE','WAIVED')`
  );
  const ended = await db.query(
    `SELECT count(*)::int AS n FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.status IN ('CANCELLED','EXPIRED') AND p.monthly_fee > 0
        AND COALESCE(s.cancelled_at, s.updated_at) >= now() - interval '30 days'`
  );
  const merchants = await db.query(
    `SELECT count(DISTINCT ur.user_id)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE r.key IN ('saler','supplier')`
  );
  const m = rows[0];
  const denominator = m.paid_subscribers_count + ended.rows[0].n;
  return {
    mrr_bdt: m.mrr_bdt,
    paid_subscribers_count: m.paid_subscribers_count,
    past_due_count: m.past_due_count,
    waived_count: m.waived_count,
    free_tier_count: Math.max(merchants.rows[0].n - m.paid_subscribers_count - m.waived_count - m.past_due_count, 0),
    overage_fees_bdt: 0,
    churn_rate_pct: denominator ? Math.round((ended.rows[0].n / denominator) * 1000) / 10 : 0,
  };
}

/** One call for the admin page: module state + plans + roster + metrics. */
export async function getOverview(db, query = {}) {
  const [module, plans, roster, metrics] = await Promise.all([
    getEngineSettings(db),
    listPlans(db),
    listSubscribers(db, { status: query.status ?? null, page: query.page, pageSize: query.page_size }),
    getMetrics(db),
  ]);
  return {
    module,
    metrics,
    plans,
    subscribers: roster.subscribers,
    total_subscribers: roster.total,
    page: roster.page,
    page_size: roster.page_size,
  };
}

/**
 * Admin waiver / status change. A waiver keeps the subscription (and its rebate) without billing;
 * lifting it returns the subscription to ACTIVE, which the renewal job then bills from the next period.
 */
export async function updateSubscriberStatus(db, id, patch, actor) {
  const waived = patch?.waived;
  if (typeof waived !== 'boolean') {
    throw invalid('`waived` (true/false) is required.', '`waived` (true/false) আবশ্যক।', { field: 'waived' });
  }
  const months = waived ? parseWaiverDuration(patch.waiver_duration) : null;
  const reason = String(patch.waiver_reason ?? '').trim();
  if (waived && !reason) {
    throw invalid('A waiver needs a reason.', 'ফি মওকুফের একটি কারণ দিতে হবে।', { field: 'waiver_reason' });
  }

  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, status, waiver_reason, waiver_ends_at FROM subscriptions
        WHERE id = $1 AND status IN ('ACTIVE','PAST_DUE','WAIVED') FOR UPDATE`,
      [id]
    );
    if (!rows.length) throw new AppError('NOT_FOUND', 'Subscription not found.', 'সাবস্ক্রিপশন পাওয়া যায়নি।');
    const before = rows[0];
    const nextStatus = waived ? 'WAIVED' : 'ACTIVE';
    await client.query(
      `UPDATE subscriptions
          SET status = $2, waiver_reason = $3, waived_by = $4,
              waiver_ends_at = CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(months => $5::int) END,
              grace_ends_at = CASE WHEN $2 = 'WAIVED' THEN NULL ELSE grace_ends_at END,
              updated_at = now()
        WHERE id = $1`,
      [id, nextStatus, waived ? reason : null, waived ? actor?.id ?? null : null, months]
    );
    const after = { ...before, status: nextStatus, waiver_reason: waived ? reason : null, waiver_months: months };
    await writeAudit(client, {
      actor_id: actor?.id ?? null,
      actor_role: actor?.role ?? null,
      action: 'UPDATE_SUBSCRIBER_STATUS',
      target_type: 'SUBSCRIPTION',
      target_ref: `SUBSCRIBER:${id}`,
      before_json: before,
      after_json: after,
    });
    return after;
  });
}
