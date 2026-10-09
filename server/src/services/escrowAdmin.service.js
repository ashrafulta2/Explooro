/**
 * escrowAdmin.service.js — what the admin Escrow page (/admin/finance/escrow) reads and does.
 *
 * WHY this exists: the page used to read `holdings` from a response that only carried
 * `escrow_entries`, found nothing, and fell back to four made-up orders. Its sweep and "Release now"
 * buttons only changed those rows in the browser. Admins never saw a real taka of escrow.
 *
 * One row per sub-order (a sub-order has up to three escrow rows: supplier, saler, platform), with
 * the names an admin needs to recognise it. The summary is computed over ALL held escrow, not the
 * page, so the totals do not change when the admin searches or pages.
 */

import { AppError } from '../plugins/errorHandler.js';
import * as vaultService from './vault.service.js';
import { writeAudit } from '../lib/audit.js';

export const STATUS_FILTERS = Object.freeze(['LOCKED', 'FROZEN', 'RELEASED', 'CLAWED_BACK', 'FAILED', 'ALL']);
export const PAGE_LIMITS = Object.freeze({ default: 25, max: 100 });
const DEFAULT_RETURN_WINDOW_DAYS = 7;

const toMoney = (v) => (Number.parseFloat(v ?? 0) || 0).toFixed(2);

function normaliseQuery({ status, q, page, limit } = {}) {
  const s = String(status || 'LOCKED').toUpperCase();
  if (!STATUS_FILTERS.includes(s)) {
    throw new AppError('VALIDATION_FAILED', `status must be one of ${STATUS_FILTERS.join(', ')}.`,
      `স্ট্যাটাস হতে হবে: ${STATUS_FILTERS.join(', ')}।`, { field: 'status' });
  }
  const p = Math.max(1, Number.parseInt(page, 10) || 1);
  const l = Math.min(PAGE_LIMITS.max, Math.max(1, Number.parseInt(limit, 10) || PAGE_LIMITS.default));
  const search = typeof q === 'string' && q.trim() ? q.trim().slice(0, 100) : null;
  return { status: s, search, page: p, limit: l };
}

async function returnWindowDays(db) {
  try {
    const { rows } = await db.query(`SELECT settings_json FROM platform_modules WHERE key = $1`, ['returns_engine']);
    const n = Number.parseInt(rows[0]?.settings_json?.return_window_days, 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RETURN_WINDOW_DAYS;
  } catch {
    return DEFAULT_RETURN_WINDOW_DAYS;
  }
}

/** Totals over every held (LOCKED) escrow row. */
async function summary(db) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_held,
            COALESCE(SUM(amount) FILTER (WHERE hold_until <= now()), 0) AS mature_amount,
            COUNT(DISTINCT sub_order_id) AS held_count,
            COUNT(DISTINCT sub_order_id) FILTER (WHERE hold_until <= now()) AS mature_count
     FROM escrow_entries
     WHERE status = 'LOCKED'`
  );
  const { rows: frozen } = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS frozen_amount, COUNT(DISTINCT sub_order_id) AS frozen_count
     FROM escrow_entries WHERE status = 'FROZEN'`
  );
  const r = rows[0] || {};
  const heldCount = Number.parseInt(r.held_count, 10) || 0;
  const matureCount = Number.parseInt(r.mature_count, 10) || 0;
  return {
    total_held: toMoney(r.total_held),
    mature_amount: toMoney(r.mature_amount),
    held_count: heldCount,
    mature_count: matureCount,
    active_count: heldCount - matureCount,
    frozen_amount: toMoney(frozen[0]?.frozen_amount),
    frozen_count: Number.parseInt(frozen[0]?.frozen_count, 10) || 0,
  };
}

export async function listHoldings(db, query = {}) {
  const { status, search, page, limit } = normaliseQuery(query);

  // WHY the status rule: a sub-order is "held" while any of its rows is LOCKED; it is RELEASED only
  // when every row is. Rows of one sub-order are written together, so mixed states are rare.
  const { rows } = await db.query(
    `WITH holdings AS (
       SELECT e.sub_order_id,
              SUM(e.amount) AS amount,
              COALESCE(SUM(e.amount) FILTER (WHERE e.beneficiary_role = 'SUPPLIER'), 0) AS supplier_amount,
              COALESCE(SUM(e.amount) FILTER (WHERE e.beneficiary_role = 'SALER'), 0) AS saler_amount,
              COALESCE(SUM(e.amount) FILTER (WHERE e.beneficiary_role = 'PLATFORM'), 0) AS platform_amount,
              MIN(e.hold_until) AS hold_until,
              MAX(e.released_at) AS released_at,
              MIN(e.created_at) AS locked_at,
              MAX(e.failure_count) AS failure_count,
              MAX(e.last_error) AS last_error,
              CASE
                WHEN bool_or(e.status = 'LOCKED') THEN 'LOCKED'
                WHEN bool_or(e.status = 'FROZEN') THEN 'FROZEN'
                WHEN bool_and(e.status = 'RELEASED') THEN 'RELEASED'
                WHEN bool_or(e.status = 'CLAWED_BACK') THEN 'CLAWED_BACK'
                ELSE 'FAILED'
              END AS status
       FROM escrow_entries e
       GROUP BY e.sub_order_id
     )
     SELECT h.*,
            s.ref AS sub_order_ref, s.delivered_at, s.status AS sub_order_status,
            o.ref AS order_ref, o.payment_method,
            COALESCE(cp.display_name, cp.full_name, cu.ref) AS customer_name,
            COALESCE(sp.display_name, sp.full_name, su.ref) AS supplier_name,
            COALESCE(vs.shop_name, slp.display_name, slp.full_name, sl.ref) AS saler_name,
            cod.status AS cod_status,
            COUNT(*) OVER () AS total_count
     FROM holdings h
     JOIN sub_orders s ON s.id = h.sub_order_id
     JOIN orders o ON o.id = s.order_id
     LEFT JOIN users cu ON cu.id = o.customer_id
     LEFT JOIN user_profiles cp ON cp.user_id = cu.id
     LEFT JOIN users su ON su.id = s.supplier_id
     LEFT JOIN user_profiles sp ON sp.user_id = su.id
     LEFT JOIN users sl ON sl.id = s.saler_id
     LEFT JOIN user_profiles slp ON slp.user_id = sl.id
     LEFT JOIN LATERAL (
       SELECT v.shop_name FROM virtual_stores v WHERE v.saler_id = s.saler_id ORDER BY v.id LIMIT 1
     ) vs ON true
     LEFT JOIN LATERAL (
       SELECT c.status FROM cod_reconciliation c WHERE c.sub_order_id = s.id ORDER BY c.id DESC LIMIT 1
     ) cod ON true
     WHERE ($1::text = 'ALL' OR h.status = $1::text)
       AND ($2::text IS NULL
            OR s.ref ILIKE '%' || $2::text || '%'
            OR o.ref ILIKE '%' || $2::text || '%'
            OR COALESCE(cp.display_name, cp.full_name, cu.ref) ILIKE '%' || $2::text || '%'
            OR COALESCE(sp.display_name, sp.full_name, su.ref) ILIKE '%' || $2::text || '%'
            OR COALESCE(vs.shop_name, slp.display_name, slp.full_name, sl.ref, '') ILIKE '%' || $2::text || '%')
     ORDER BY (h.status = 'LOCKED') DESC, h.hold_until ASC, h.sub_order_id ASC
     LIMIT $3 OFFSET $4`,
    [status, search, limit, (page - 1) * limit]
  );

  const nowMs = Date.now();
  const holdings = rows.map((r) => {
    const remainingSeconds = Math.max(0, Math.round((new Date(r.hold_until).getTime() - nowMs) / 1000));
    const isLocked = r.status === 'LOCKED';
    // A COD order's cash must be reconciled first (vault.service.js releaseEscrow refuses otherwise).
    const codBlocked = r.payment_method === 'COD' && r.cod_status !== 'MATCHED' && r.cod_status !== 'RESOLVED';
    return {
      sub_order_id: Number(r.sub_order_id),
      sub_order_ref: r.sub_order_ref,
      order_ref: r.order_ref,
      payment_method: r.payment_method,
      customer_name: r.customer_name,
      supplier_name: r.supplier_name,
      saler_name: r.saler_name,
      amount: toMoney(r.amount),
      supplier_amount: toMoney(r.supplier_amount),
      saler_amount: toMoney(r.saler_amount),
      platform_amount: toMoney(r.platform_amount),
      status: r.status,
      locked_at: r.locked_at,
      delivered_at: r.delivered_at,
      hold_until: r.hold_until,
      released_at: r.released_at,
      remaining_seconds: isLocked ? remainingSeconds : 0,
      is_due: isLocked && remainingSeconds === 0,
      release_blocked_reason: isLocked && codBlocked ? 'COD_NOT_RECONCILED' : null,
      failure_count: Number(r.failure_count) || 0,
      last_error: r.last_error,
    };
  });

  const total = Number.parseInt(rows[0]?.total_count, 10) || 0;
  const [stats, windowDays] = await Promise.all([summary(db), returnWindowDays(db)]);

  return {
    holdings,
    summary: { ...stats, return_window_days: windowDays },
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    filter: { status, q: search },
  };
}

/**
 * Releases one sub-order's escrow now, before its return window ends. finance.escrow.release_manual
 * (CRITICAL, super admin only). Needs a reason and writes an audit row with before/after.
 */
export async function releaseOne(db, { subOrderId, reason, actorId = null, actorRole = null, reqContext = {} }) {
  const id = Number.parseInt(subOrderId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError('VALIDATION_FAILED', 'Unknown sub-order.', 'সাব-অর্ডারটি পাওয়া যায়নি।', { field: 'subOrderId' });
  }
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    throw new AppError('VALIDATION_FAILED', 'Give a reason of at least 10 characters.',
      'অন্তত ১০ অক্ষরের একটি কারণ লিখুন।', { field: 'reason' });
  }

  const { rows: before } = await db.query(
    `SELECT beneficiary_role, amount, status, hold_until FROM escrow_entries WHERE sub_order_id = $1 ORDER BY id`,
    [id]
  );
  if (before.length === 0) {
    throw new AppError('NOT_FOUND', 'This sub-order has no escrow.', 'এই সাব-অর্ডারে কোনো এসক্রো নেই।');
  }
  if (!before.some((e) => e.status === 'LOCKED')) {
    throw new AppError('CONFLICT', 'This escrow is not held any more.', 'এই এসক্রো আর আটকে নেই।');
  }

  let result;
  try {
    result = await vaultService.releaseEscrow(db, {
      subOrderId: id,
      releasedBy: actorId,
      idempotencyKey: `admin_release:${id}`,
    });
  } catch (err) {
    if (String(err.message).startsWith('COD_FUNDS_NOT_RECONCILED')) {
      throw new AppError('CONFLICT',
        'The courier has not handed over this COD cash yet. Reconcile it first.',
        'কুরিয়ার এই ক্যাশ অন ডেলিভারির টাকা এখনো জমা দেয়নি। আগে হিসাব মেলান।',
        { reason: 'COD_NOT_RECONCILED' });
    }
    throw err;
  }

  const { rows: after } = await db.query(
    `SELECT beneficiary_role, amount, status, hold_until, released_at FROM escrow_entries WHERE sub_order_id = $1 ORDER BY id`,
    [id]
  );

  await writeAudit(db, {
    actor_id: actorId,
    actor_role: actorRole,
    action: 'finance.escrow.release_manual',
    target_type: 'SUB_ORDER',
    target_ref: String(id),
    before_json: { entries: before },
    after_json: { entries: after },
    meta: { reason: reason.trim() },
    risk_tier: 'CRITICAL',
    ip: reqContext.ip ?? null,
    user_agent: reqContext.userAgent ?? null,
    trace_id: reqContext.traceId ?? null,
  });

  return { sub_order_id: id, released: Boolean(result?.success ?? true), entries: after };
}
