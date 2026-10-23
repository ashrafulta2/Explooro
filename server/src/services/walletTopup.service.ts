/**
 * walletTopup.service.ts — adding money to a vault through bKash, Nagad or a card (migration 088).
 *
 * A top-up is a `payment_transactions` row with intent TOPUP and no order, so it is paid, confirmed,
 * webhooked and reconciled by exactly the machinery orders use (payment.service.ts). This file owns
 * the two things that differ:
 *   initiateTopUp  checks the amount against `wallet.topup`, opens the transaction, asks the driver
 *   creditTopUp    once the gateway has confirmed, credits the vault exactly once
 *
 * WHY the external clearing wallet pays the credit: the customer's taka is now in the company's
 * merchant account, outside the ledger. That is what EXTERNAL_CLEARING stands for (migration 070),
 * so the platform's own treasury never looks richer or poorer because someone topped up.
 */

import { randomUUID } from 'node:crypto';
import { AppError } from '../plugins/errorHandler.ts';
import { generateRef } from '../lib/ref.ts';
import { withTransaction } from '../config/db.ts';
import { createPaymentGateway } from '../integrations/payments/index.ts';
import * as paymentRepo from '../repositories/payment.repository.ts';
import * as walletRepo from '../repositories/wallet.repository.ts';
import * as ledgerService from './ledger.service.ts';
import { resolveClearingWalletId } from './vault.service.ts';
import { writeAudit } from '../lib/audit.ts';

export const RULES_KEY = 'wallet.topup';
// Which gateway driver collects each method a person can pick. Mirrors payment.service GATEWAY_BY_METHOD.
export const GATEWAY_BY_METHOD = Object.freeze({ BKASH: 'BKASH', NAGAD: 'NAGAD', CARD: 'SSLCOMMERZ' });
export const RULE_LIMITS = Object.freeze({ amount: { min: 1, max: 1000000 } });
export const DEFAULT_RULES = Object.freeze({ min_amount: 50, max_amount: 25000, daily_limit: 50000, methods: Object.freeze(['BKASH', 'NAGAD', 'CARD']) });

const toPaisa = (v) => Math.round(Number(v) * 100);
const fromPaisa = (p) => (p / 100).toFixed(2);

/** Forgiving read: a malformed field falls back to its default. */
export function resolveRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const L = RULE_LIMITS.amount;
  const money = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v >= L.min && v <= L.max ? v : d);
  const min = money(r.min_amount, DEFAULT_RULES.min_amount);
  const max = money(r.max_amount, DEFAULT_RULES.max_amount);
  const methods = Array.isArray(r.methods) ? r.methods.map((m) => String(m).toUpperCase()).filter((m) => m in GATEWAY_BY_METHOD) : [];
  return {
    min_amount: min,
    max_amount: max >= min ? max : Math.max(min, DEFAULT_RULES.max_amount),
    daily_limit: money(r.daily_limit, DEFAULT_RULES.daily_limit),
    methods: methods.length ? [...new Set(methods)] : [...DEFAULT_RULES.methods],
  };
}

export async function loadRules(db) {
  const { rows } = await db.query(`SELECT value_json FROM platform_settings WHERE key = $1`, [RULES_KEY]);
  return resolveRules(rows[0]?.value_json);
}

/** Pure. Refuses an amount or method the rules do not allow; returns the amount in paisa. */
export function validateRequest({ amount, method }, rules, alreadyTodayPaisa = 0) {
  const m = String(method || '').toUpperCase();
  if (!rules.methods.includes(m)) {
    throw new AppError('PAYMENT_METHOD_UNSUPPORTED', 'Pick bKash, Nagad or a card.', 'বিকাশ, নগদ বা কার্ড বেছে নিন।', { field: 'method' });
  }
  // WHY a pattern and not arithmetic: 10.1 * 100 is 1010.0000000000001 in floating point, so a
  // "has more than two decimals" test done with numbers refuses ৳10.10.
  const text = typeof amount === 'number' ? String(amount) : String(amount ?? '').trim();
  const paisa = toPaisa(text);
  if (!/^\d+(\.\d{1,2})?$/.test(text) || paisa <= 0) {
    throw new AppError('VALIDATION_FAILED', 'Enter an amount in taka, with at most two decimals.', 'টাকার পরিমাণ লিখুন, সর্বোচ্চ দুই দশমিক ঘর।', { field: 'amount' });
  }
  if (paisa < toPaisa(rules.min_amount) || paisa > toPaisa(rules.max_amount)) {
    throw new AppError('VALIDATION_FAILED',
      `A top-up must be from ৳${rules.min_amount} to ৳${rules.max_amount}.`,
      `টাকা যোগের পরিমাণ ৳${rules.min_amount} থেকে ৳${rules.max_amount} এর মধ্যে হতে হবে।`,
      { field: 'amount', min: rules.min_amount, max: rules.max_amount });
  }
  if (alreadyTodayPaisa + paisa > toPaisa(rules.daily_limit)) {
    throw new AppError('TOPUP_DAILY_LIMIT',
      `You can add up to ৳${rules.daily_limit} in 24 hours; ৳${fromPaisa(alreadyTodayPaisa)} is already on its way or added.`,
      `২৪ ঘণ্টায় সর্বোচ্চ ৳${rules.daily_limit} যোগ করা যায়; ৳${fromPaisa(alreadyTodayPaisa)} ইতিমধ্যে যোগ হয়েছে বা প্রক্রিয়াধীন।`,
      { daily_limit: rules.daily_limit });
  }
  return { paisa, gateway: GATEWAY_BY_METHOD[m], method: m };
}

/** What this account started or added in the last 24 hours (failed attempts do not count). */
async function last24hPaisa(db, userId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(amount), 0)::text AS total FROM payment_transactions
      WHERE user_id = $1 AND intent = 'TOPUP' AND status IN ('INITIATED', 'PENDING', 'SUCCESS')
        AND created_at >= now() - INTERVAL '24 hours'`,
    [userId]
  );
  return toPaisa(rows[0]?.total ?? 0);
}

/**
 * Opens a top-up and hands back where to pay. A replayed Idempotency-Key returns the same transaction
 * instead of opening a second one.
 */
export async function initiateTopUp(db, { userId, amount, method, returnUrl = null, callbackUrl = null, idempotencyKey = null, customer = {} as { name?: string; phone?: string } }) {
  if (idempotencyKey) {
    const existing = await paymentRepo.findPaymentTransactionByIdempotencyKey(db, idempotencyKey);
    if (existing) {
      if (Number(existing.user_id) !== Number(userId) || existing.intent !== 'TOPUP') {
        throw new AppError('IDEMPOTENCY_MISMATCH', 'This request key was already used for something else.', 'এই রিকোয়েস্ট কী অন্য কাজে ব্যবহার হয়েছে।');
      }
      return { transactionRef: existing.ref, status: existing.status, amount: existing.amount, gateway: existing.gateway, redirectUrl: existing.raw_response?.redirectUrl || null, isReplay: true };
    }
  }

  const rules = await loadRules(db);
  const { paisa, gateway, method: m } = validateRequest({ amount, method }, rules, await last24hPaisa(db, userId));
  const ref = generateRef('TOP');
  const driver = createPaymentGateway(gateway);

  const txn = await paymentRepo.createPaymentTransaction(db, {
    ref,
    orderId: null,
    userId,
    gateway,
    intent: 'TOPUP',
    amount: fromPaisa(paisa),
    status: 'INITIATED',
    rawRequest: { purpose: 'WALLET_TOPUP', method: m, amount: fromPaisa(paisa), idempotencyKey },
    idempotencyKey,
  });

  let result;
  try {
    result = await driver.createPayment({
      orderId: null,
      orderRef: ref,
      amount: fromPaisa(paisa),
      currency: 'BDT',
      customer: { name: customer.name, phone: customer.phone },
      returnUrl,
      callbackUrl,
      idempotencyKey,
    });
  } catch (err) {
    await paymentRepo.updatePaymentTransaction(db, txn.id, { status: 'FAILED', rawResponse: { error: err.message } });
    throw err;
  }

  const updated = await paymentRepo.updatePaymentTransaction(db, txn.id, {
    status: result.status || 'INITIATED',
    gatewayRef: result.gatewayRef || result.paymentId,
    rawResponse: { redirectUrl: result.redirectUrl ?? null, paymentId: result.paymentId ?? null },
  });

  return { transactionRef: updated.ref, status: updated.status, amount: updated.amount, gateway, method: m, redirectUrl: result.redirectUrl ?? null };
}

/**
 * Credits the vault for a confirmed top-up — once. Called by payment.service.executePayment after the
 * gateway confirmed (and again on any replay, which then finds the credit and does nothing).
 *
 * WHY lock the transaction row and look the credit up first: the ledger's idempotency index is per
 * month partition, so it cannot by itself stop a webhook and an execute racing to credit twice.
 */
export async function creditTopUp(db, transactionRef) {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM payment_transactions WHERE ref = $1 FOR UPDATE`,
      [transactionRef]
    );
    const txn = rows[0];
    if (!txn || txn.intent !== 'TOPUP' || txn.status !== 'SUCCESS') return { credited: false, reason: 'NOT_CONFIRMED' };

    const key = `wallet_topup:${txn.ref}`;
    const { rows: done } = await client.query(
      `SELECT 1 FROM ledger_transactions WHERE idempotency_key = $1 LIMIT 1`,
      [`${key}:credit`]
    );
    if (done.length) return { credited: false, reason: 'ALREADY_CREDITED' };

    const clearingId = await resolveClearingWalletId(client);
    const wallet = await walletRepo.getOrCreateWallet(client, txn.user_id, { client });
    await ledgerService.recordTransactionGroup(client, {
      txnGroupId: randomUUID(),
      defaultCategory: 'WALLET_TOPUP',
      defaultReferenceType: 'payment_transactions',
      defaultReferenceId: Number(txn.id),
      memo: `Vault top-up ${txn.ref} via ${txn.gateway}`,
      entries: [
        { walletId: clearingId, entryType: 'DEBIT', amount: Number(txn.amount).toFixed(2), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:debit` },
        { walletId: wallet.id, entryType: 'CREDIT', amount: Number(txn.amount).toFixed(2), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:credit` },
      ],
    });
    await writeAudit(client, {
      action: 'finance.wallet.topup',
      actorId: txn.user_id,
      targetType: 'payment_transactions',
      targetRef: txn.ref,
      before: null,
      after: { amount: txn.amount, gateway: txn.gateway, wallet_id: wallet.id },
      riskTier: 'LOW',
    });
    return { credited: true, amount: Number(txn.amount).toFixed(2) };
  });
}

/** GET /wallet/topups: the caller's balance, the rules and their recent top-ups (paginated). */
export async function getOwnView(db, userId, { page = 1, limit = 10 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const p = Math.max(Number(page) || 1, 1);
  const [rules, wallet, { rows }] = await Promise.all([
    loadRules(db),
    walletRepo.getOrCreateWallet(db, userId),
    db.query(
      `SELECT ref, gateway, amount, status, created_at, COUNT(*) OVER()::int AS total
         FROM payment_transactions
        WHERE user_id = $1 AND intent = 'TOPUP'
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, size, (p - 1) * size]
    ),
  ]);
  const method = Object.fromEntries(Object.entries(GATEWAY_BY_METHOD).map(([k, v]) => [v, k]));
  return {
    balance: wallet?.available_balance ?? '0.00',
    rules: { min_amount: rules.min_amount, max_amount: rules.max_amount, daily_limit: rules.daily_limit, methods: rules.methods },
    items: rows.map(({ total, ...r }) => ({ ...r, method: method[r.gateway] ?? r.gateway })),
    total: rows[0]?.total ?? 0,
    page: p,
    limit: size,
  };
}
