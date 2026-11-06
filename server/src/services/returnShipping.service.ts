/**
 * returnShipping.service.ts — who pays to send a returned product back (migration 106).
 *
 * The rule, as Daraz runs it (owner decision 2026-11-06):
 *   SUPPLIER pays when the return is their fault (the policy's `supplier_fault_reasons`):
 *     - the whole-parcel refund keeps refunding the delivery charge (clawback.service does that);
 *     - a courier pickup is free to the customer, and the supplier pays its fee to the platform;
 *     - a customer who sent it back by hand is repaid the courier receipt, up to
 *       `max_courier_refund`, by the supplier.
 *   CUSTOMER pays when it is their choice (every other reason):
 *     - a whole-parcel refund keeps the delivery charge back (it goes to the supplier, who paid the
 *       courier to deliver; the full clawback had refunded it);
 *     - a courier pickup costs `pickup_fee`, taken from the refund and paid to the platform,
 *       which books and pays the courier;
 *     - a hand-sent return costs them whatever their courier charged, outside Explooro.
 * Staff may switch the payer at approval. What a customer is charged never exceeds what this
 * return refunded them, so a return can never leave a customer owing money.
 *
 * WHY one file: the rule, the customer page's wording and the money moved must agree. The rules are
 * configuration (`returns.shipping_policy` in platform_settings), set at /admin/platform/operations.
 * WHY ADJUSTMENT and reference RETURN_REQUEST: clawback.service nets earlier refunds by summing
 * CLAWBACK debits and REFUND credits; these moves are neither, so a later full return of the same
 * parcel neither repeats nor cancels them.
 */

import { randomUUID } from 'node:crypto';
import * as settingRepo from '../repositories/setting.repository.ts';
import * as walletRepo from '../repositories/wallet.repository.ts';
import * as ledgerService from './ledger.service.ts';
import * as vaultService from './vault.service.ts';
import { AppError } from '../plugins/errorHandler.ts';

export const POLICY_KEY = 'returns.shipping_policy';
export const SETTINGS_GROUP = 'operations';
/** return_requests.reason_code's CHECK (migration 015). */
export const REASON_CODES = Object.freeze([
  'DAMAGED', 'WRONG_ITEM', 'DEFECTIVE', 'SIZE_MISMATCH', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'OTHER',
]);
export const PAYERS = Object.freeze(['SUPPLIER', 'CUSTOMER']);
/** Equal to migration 106's seed row. */
export const DEFAULT_POLICY = Object.freeze({
  supplier_fault_reasons: Object.freeze(['DAMAGED', 'WRONG_ITEM', 'DEFECTIVE', 'NOT_AS_DESCRIBED']),
  max_courier_refund: 150,
  pickup_fee: 100,
});
/** Whole Taka. Bounds are input shapes, not business numbers; the numbers live in the setting. */
export const POLICY_LIMITS = Object.freeze({
  max_courier_refund: Object.freeze({ min: 0, max: 2000 }),
  pickup_fee: Object.freeze({ min: 0, max: 1000 }),
  customer_courier_cost: Object.freeze({ min: 0, max: 100000 }),
});

const SETTING_META = {
  valueType: 'OBJECT',
  labelEn: 'Who pays to send a return back',
  labelBn: 'ফেরত পাঠানোর খরচ কে দেবে',
};

function readJsonValue(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const isWholeIn = (n, { min, max }) => Number.isInteger(n) && n >= min && n <= max;

/** A stored row as a complete policy. Forgiving: anything unreadable falls back to the default. */
export function rowToPolicy(row): Record<string, any> {
  const v = readJsonValue(row?.value_json) || {};
  const reasons = Array.isArray(v.supplier_fault_reasons)
    ? REASON_CODES.filter((code) => v.supplier_fault_reasons.includes(code))
    : [...DEFAULT_POLICY.supplier_fault_reasons];
  const num = (key) => {
    const n = Number(v[key]);
    return isWholeIn(n, POLICY_LIMITS[key]) ? n : DEFAULT_POLICY[key];
  };
  return {
    supplier_fault_reasons: reasons,
    max_courier_refund: num('max_courier_refund'),
    pickup_fee: num('pickup_fee'),
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  };
}

export async function getPolicy(db) {
  try {
    return rowToPolicy(await settingRepo.getSettingByKey(db, POLICY_KEY));
  } catch {
    return rowToPolicy(null);
  }
}

/** Pure and strict: out of range is refused, never clamped. */
export function validatePolicy(input: Record<string, any> = {}) {
  const reasons = input.supplier_fault_reasons;
  if (!Array.isArray(reasons) || reasons.some((r) => !REASON_CODES.includes(r))) {
    throw new AppError('VALIDATION_FAILED', `Fault reasons must be from ${REASON_CODES.join(', ')}.`,
      `কারণগুলো ${REASON_CODES.join(', ')} থেকে হতে হবে।`, { field: 'supplier_fault_reasons' });
  }
  const out: Record<string, any> = { supplier_fault_reasons: REASON_CODES.filter((r) => reasons.includes(r)) };
  for (const key of ['max_courier_refund', 'pickup_fee']) {
    const n = Number(input[key]);
    const { min, max } = POLICY_LIMITS[key];
    if (!isWholeIn(n, POLICY_LIMITS[key])) {
      throw new AppError('VALIDATION_FAILED', `${key} must be a whole number of Taka from ${min} to ${max}.`,
        `${key} ${min} থেকে ${max} এর মধ্যে পূর্ণ টাকা হতে হবে।`, { field: key, min, max });
    }
    out[key] = n;
  }
  return out;
}

export async function updatePolicy(
  db,
  auditService,
  { policy, reason, baseUpdatedAt = undefined, userId, actorRole = null, reqContext = ({} as { ip?: string, userAgent?: string, traceId?: string }) }
) {
  const next = validatePolicy(policy);
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    throw new AppError('VALIDATION_FAILED', 'Give a reason of at least 10 characters for this change.',
      'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।', { field: 'reason' });
  }

  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);
  let before;
  let after;
  try {
    if (isDedicatedClient) await client.query('BEGIN');
    await settingRepo.lockSettingsGroup(client, SETTINGS_GROUP);
    before = rowToPolicy(await settingRepo.getSettingByKey(client, POLICY_KEY));
    if (baseUpdatedAt !== undefined && String(baseUpdatedAt ?? '') !== String(before.updated_at ? new Date(before.updated_at).toISOString() : '')) {
      throw new AppError('PRECONDITION_CHANGED',
        'Someone changed these rules while you were editing. Reload and try again.',
        'আপনি সম্পাদনা করার সময় অন্য কেউ এই নিয়ম বদলেছেন। পাতা আবার খুলে চেষ্টা করুন।');
    }
    await settingRepo.upsertSetting(client, { key: POLICY_KEY, valueJson: next, groupKey: SETTINGS_GROUP, updatedBy: userId ?? null, ...SETTING_META });
    after = rowToPolicy(await settingRepo.getSettingByKey(client, POLICY_KEY));
    if (isDedicatedClient) await client.query('COMMIT');
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }

  const strip = ({ updated_at, updated_by, ...rest }) => rest;
  if (auditService?.record) {
    await auditService.record(db, {
      action: 'platform.operations.return_shipping.update',
      targetType: 'platform_settings',
      targetRef: POLICY_KEY,
      beforeJson: strip(before),
      afterJson: strip(after),
      meta: { reason: reason.trim() },
      riskTier: 'CRITICAL',
      actorId: userId ?? null,
      actorRole,
      ip: reqContext.ip ?? null,
      userAgent: reqContext.userAgent ?? null,
      traceId: reqContext.traceId ?? null,
    });
  }
  return after;
}

/** Who pays for this reason under the policy. */
export function defaultPayer(reasonCode, policy) {
  return (policy?.supplier_fault_reasons ?? DEFAULT_POLICY.supplier_fault_reasons).includes(reasonCode) ? 'SUPPLIER' : 'CUSTOMER';
}

/** A staff override at approval, or null for "use the default". */
export function parsePayerOverride(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!PAYERS.includes(value)) {
    throw new AppError('VALIDATION_FAILED', `Who pays must be one of ${PAYERS.join(', ')}.`,
      `খরচ কে দেবে তা ${PAYERS.join(', ')} এর একটি হতে হবে।`, { field: 'return_shipping_paid_by' });
  }
  return value;
}

/** What staff typed from the customer's courier receipt, in Taka with paisa, or null. */
export function parseCourierCost(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  const { min, max } = POLICY_LIMITS.customer_courier_cost;
  if (!Number.isFinite(n) || n < min || n > max || Math.round(n * 100) !== n * 100) {
    throw new AppError('VALIDATION_FAILED', `The courier receipt must be an amount from ${min} to ${max} Taka.`,
      `কুরিয়ারের রসিদের টাকা ${min} থেকে ${max} এর মধ্যে হতে হবে।`, { field: 'customer_courier_cost' });
  }
  return n;
}

/** How the product came back: a courier booked through us, by the customer's own hand, or unknown. */
export function pickupModeOf(returnReq) {
  if (returnReq?.reverse_pickup_id || (returnReq?.reverse_carrier && returnReq.reverse_carrier !== 'MANUAL')) return 'COURIER';
  if (returnReq?.reverse_carrier === 'MANUAL') return 'HAND';
  return 'NONE';
}

const paisa = (taka) => Math.max(0, Math.round((Number(taka) || 0) * 100));
const taka = (p) => (p / 100).toFixed(2);

/**
 * Pure: the moves a refunded return makes, in paisa. `customerRefund` is what this return just
 * credited the customer; their charges are capped by it.
 */
export function planSettlement({
  paidBy,
  mode,
  isFullReturn,
  deliveryCharge = 0,
  customerRefund = 0,
  customerCourierCost = null,
  policy = DEFAULT_POLICY,
}: Record<string, any>) {
  const moves = [];
  if (paidBy === 'SUPPLIER') {
    if (mode === 'HAND') {
      const p = Math.min(paisa(customerCourierCost), paisa(policy.max_courier_refund));
      if (p > 0) moves.push({ kind: 'COURIER_RECEIPT_REPAID', from: 'SUPPLIER', to: 'CUSTOMER', paisa: p });
    } else if (mode === 'COURIER') {
      const p = paisa(policy.pickup_fee);
      if (p > 0) moves.push({ kind: 'PICKUP_FEE', from: 'SUPPLIER', to: 'PLATFORM', paisa: p });
    }
  } else if (paidBy === 'CUSTOMER') {
    let budget = paisa(customerRefund);
    if (isFullReturn) {
      const p = Math.min(paisa(deliveryCharge), budget);
      if (p > 0) moves.push({ kind: 'DELIVERY_CHARGE_KEPT', from: 'CUSTOMER', to: 'SUPPLIER', paisa: p });
      budget -= p;
    }
    if (mode === 'COURIER') {
      const p = Math.min(paisa(policy.pickup_fee), budget);
      if (p > 0) moves.push({ kind: 'PICKUP_FEE', from: 'CUSTOMER', to: 'PLATFORM', paisa: p });
    }
  }
  const customerNet = moves.reduce((sum, m) => sum + (m.to === 'CUSTOMER' ? m.paisa : 0) - (m.from === 'CUSTOMER' ? m.paisa : 0), 0);
  return { paidBy, mode, moves, customerNetPaisa: customerNet };
}

const MEMO = {
  COURIER_RECEIPT_REPAID: 'Return courier receipt repaid by the supplier',
  PICKUP_FEE: 'Return pickup fee',
  DELIVERY_CHARGE_KEPT: 'Delivery charge kept on a change-of-mind return',
};

/**
 * Moves the return-shipping money for a refunded return, inside the refund's transaction, and
 * records what it did on the return. Called once by return.service executeRefund.
 */
export async function settleReturnShipping(txClient, { returnReq, isFullReturn, customerRefund, approvedBy = null }) {
  const policy = await getPolicy(txClient);
  const paidBy = PAYERS.includes(returnReq.return_shipping_paid_by)
    ? returnReq.return_shipping_paid_by
    : defaultPayer(returnReq.reason_code, policy);
  const plan = planSettlement({
    paidBy,
    mode: pickupModeOf(returnReq),
    isFullReturn,
    deliveryCharge: returnReq.shipping_amount,
    customerRefund,
    customerCourierCost: returnReq.customer_courier_cost,
    policy,
  });

  let supplierDeficit = null;
  if (plan.moves.length > 0) {
    const walletOf: Record<string, any> = {};
    const needs = new Set(plan.moves.flatMap((m) => [m.from, m.to]));
    if (needs.has('CUSTOMER')) walletOf.CUSTOMER = (await walletRepo.getOrCreateWallet(txClient, returnReq.customer_id, { client: txClient })).id;
    if (needs.has('SUPPLIER')) walletOf.SUPPLIER = (await walletRepo.getOrCreateWallet(txClient, returnReq.supplier_id, { client: txClient })).id;
    if (needs.has('PLATFORM')) walletOf.PLATFORM = await vaultService.resolvePlatformWalletId(txClient, txClient);

    // What the supplier can cover from their vault right now, read under lock (after this refund's
    // clawback, which runs first in the same transaction).
    const supplierPaisa = plan.moves.filter((m) => m.from === 'SUPPLIER').reduce((sum, m) => sum + m.paisa, 0);
    let supplierAvailablePaisa = 0;
    if (supplierPaisa > 0) {
      const wallet = await walletRepo.getWalletByIdForUpdate(txClient, walletOf.SUPPLIER);
      supplierAvailablePaisa = Math.max(0, paisa(wallet?.available_balance));
    }

    const entries = [];
    for (const m of plan.moves) {
      const memo = `${MEMO[m.kind]} (return ${returnReq.ref})`;
      const common = { amount: taka(m.paisa), balanceBucket: 'AVAILABLE' as const, category: 'ADJUSTMENT', referenceType: 'RETURN_REQUEST', referenceId: returnReq.id, memo, createdBy: approvedBy };
      entries.push({ ...common, walletId: walletOf[m.from], entryType: 'DEBIT' as const });
      entries.push({ ...common, walletId: walletOf[m.to], entryType: 'CREDIT' as const });
    }
    await ledgerService.recordTransactionGroup(txClient, {
      txnGroupId: randomUUID(),
      entries,
      defaultCategory: 'ADJUSTMENT',
      defaultReferenceType: 'RETURN_REQUEST',
      defaultReferenceId: returnReq.id,
      createdBy: approvedBy,
    });

    // WHY recorded and not refused: the customer is owed the money whatever the supplier holds, so
    // the supplier's vault goes below zero, as with a clawback they cannot cover, and the daily
    // settleDeficitRecoveries job marks it recovered as their next earnings come in.
    if (supplierPaisa > supplierAvailablePaisa) {
      supplierDeficit = await recordSupplierDeficit(txClient, {
        returnReq,
        walletId: walletOf.SUPPLIER,
        totalPaisa: supplierPaisa,
        coveredPaisa: supplierAvailablePaisa,
      });
    }

    // The pickup charge collected, beside what the courier quoted, for the reconciliation report.
    const fee = plan.moves.find((m) => m.kind === 'PICKUP_FEE');
    if (fee && returnReq.reverse_pickup_id) {
      await txClient.query(
        'UPDATE reverse_pickups SET fee_charged = $2, fee_charged_from = $3, updated_at = now() WHERE id = $1',
        [returnReq.reverse_pickup_id, taka(fee.paisa), fee.from]
      );
    }
  }

  const record = {
    paid_by: plan.paidBy,
    mode: plan.mode,
    moves: plan.moves.map((m) => ({ kind: m.kind, from: m.from, to: m.to, amount: taka(m.paisa) })),
    customer_net: (plan.customerNetPaisa / 100).toFixed(2),
    supplier_deficit: supplierDeficit,
  };
  await txClient.query(
    `UPDATE return_requests SET return_shipping_paid_by = $2, shipping_settlement_json = $3, updated_at = now() WHERE id = $1`,
    [returnReq.id, plan.paidBy, JSON.stringify(record)]
  );
  return record;
}

/** A recovery record for return shipping a supplier could not cover (migration 107). */
async function recordSupplierDeficit(txClient, { returnReq, walletId, totalPaisa, coveredPaisa }) {
  const ref = `NBR-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const { rows } = await txClient.query(
    `INSERT INTO negative_balance_recoveries (
       ref, wallet_id, user_id, sub_order_id, return_request_id,
       total_clawback_amount, recovered_from_available, unrecovered_deficit, recovery_status, reason
     )
     VALUES ($1, $2, $3, $4, $5, $6::numeric(14,2), $7::numeric(14,2), $8::numeric(14,2), 'PENDING', $9)
     RETURNING ref, unrecovered_deficit`,
    [
      ref,
      walletId,
      returnReq.supplier_id,
      returnReq.sub_order_id ?? null,
      returnReq.id,
      taka(totalPaisa),
      taka(coveredPaisa),
      taka(totalPaisa - coveredPaisa),
      `Return shipping for return ${returnReq.ref}, paid by the supplier`,
    ]
  );
  return rows[0] ? { ref: rows[0].ref, amount: taka(totalPaisa - coveredPaisa) } : null;
}

/**
 * Adds `return_shipping` to a customer's returns: who pays and the policy's amounts, so the page can
 * say it in words. Before approval the payer is the default for the reason and may still change.
 */
export async function withShippingTerms(db, returns) {
  const rows = Array.isArray(returns) ? returns : [];
  if (rows.length === 0) return rows;
  const policy = await getPolicy(db);
  return rows.map((r) => ({
    ...r,
    return_shipping: {
      paid_by: PAYERS.includes(r.return_shipping_paid_by) ? r.return_shipping_paid_by : defaultPayer(r.reason_code, policy),
      decided: PAYERS.includes(r.return_shipping_paid_by),
      max_courier_refund: policy.max_courier_refund,
      pickup_fee: policy.pickup_fee,
      settlement: readJsonValue(r.shipping_settlement_json) ?? null,
    },
  }));
}

/** What the return form shows before a customer picks a reason. */
export function publicTerms(policy) {
  return {
    supplier_fault_reasons: policy.supplier_fault_reasons,
    max_courier_refund: policy.max_courier_refund,
    pickup_fee: policy.pickup_fee,
  };
}
