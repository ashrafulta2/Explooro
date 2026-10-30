/**
 * vaultCheckout.service.ts — paying a normal checkout from the shopper's own vault (migration 092).
 *
 * A customer cannot withdraw (finance.payout.request is saler/supplier only), so the referral
 * commissions and top-ups in their vault are spent here instead. Two moves, each one balanced
 * ledger group inside the caller's transaction:
 *
 *   payOrderFromVault         at checkout: shopper AVAILABLE -> EXTERNAL_CLEARING (the order total),
 *                             then every sub-order's escrow is locked from the clearing wallet,
 *                             exactly as payment.service does for a confirmed bKash order
 *   refundCancelledOrderToVault  on cancel of any order paid up front (vault, bKash, Nagad, Rocket,
 *                             card): each sub-order's escrow goes back to the clearing wallet, then
 *                             EXTERNAL_CLEARING -> shopper AVAILABLE (the order total). Owner decision
 *                             2026-10-30: a cancelled online payment comes back to the vault, not to the
 *                             gateway (no gateway driver can refund for real yet).
 *
 * Invariants:
 *   1. The shopper is charged exactly orders.total_amount (after any coupon) and refunded exactly that,
 *      never the escrow sum, which is the order before the coupon.
 *   2. Never overdrawn: the shopper's wallet is locked FOR UPDATE (with the clearing wallet, in id
 *      order, as the ledger locks them) and the order is refused with INSUFFICIENT_VAULT_BALANCE if
 *      AVAILABLE is short. The ledger itself does not refuse a negative balance.
 *   3. Once only: both moves are keyed by the order, so a retried cancel refunds nothing twice.
 */

import { randomUUID } from 'node:crypto';
import { AppError } from '../plugins/errorHandler.ts';
import * as walletRepo from '../repositories/wallet.repository.ts';
import * as ledgerService from './ledger.service.ts';
import * as vaultService from './vault.service.ts';
import { writeAudit } from '../lib/audit.ts';

export const VAULT_METHOD = 'WALLET';

/**
 * Pure. True when cancelling this order must hand money back: it was paid up front. COD is paid at
 * the door, so a COD order that can still be cancelled has taken nothing.
 */
export function isRefundableOnCancel(order) {
  return Boolean(order) && order.payment_status === 'PAID' && String(order.payment_method || '').toUpperCase() !== 'COD';
}

const toPaisa = (v) => Math.round(Number(v) * 100);
const fromPaisa = (p) => (p / 100).toFixed(2);

/** Pure. How many paisa the vault is short of the total; 0 when it can pay. */
export function vaultShortfallPaisa(availableBalance, totalPaisa) {
  const available = toPaisa(availableBalance || 0);
  return Math.max(Number(totalPaisa) - available, 0);
}

async function ledgerKeyUsed(client, key) {
  const { rows } = await client.query(`SELECT 1 FROM ledger_transactions WHERE idempotency_key = $1 LIMIT 1`, [key]);
  return rows.length > 0;
}

/**
 * Pays a just-created order from the shopper's vault and locks its escrow. Must run inside the
 * checkout transaction (`client`), after its sub-orders exist, so a short balance rolls back the
 * whole order and a paid order can never exist without its escrow.
 */
export async function payOrderFromVault(client, { orderId, orderRef, userId, totalPaisa }) {
  if (!userId) {
    throw new AppError('UNAUTHORIZED', 'Sign in to pay from your vault.', 'ভল্ট থেকে পরিশোধ করতে লগইন করুন।');
  }
  const wallet = await walletRepo.getOrCreateWallet(client, userId, { client });
  const clearingId = await vaultService.resolveClearingWalletId(client);
  const locked = await walletRepo.getWalletsByIdsForUpdate(client, [wallet.id, clearingId]);
  const mine = locked.find((w) => String(w.id) === String(wallet.id));

  const short = vaultShortfallPaisa(mine?.available_balance, totalPaisa);
  if (short > 0) {
    throw new AppError(
      'INSUFFICIENT_VAULT_BALANCE',
      `Your vault is ৳${fromPaisa(short)} short of this order. Add money or pick another way to pay.`,
      `এই অর্ডারের জন্য আপনার ভল্টে ৳${fromPaisa(short)} কম আছে। টাকা যোগ করুন অথবা অন্যভাবে পরিশোধ করুন।`,
      { shortfall: fromPaisa(short), available: mine?.available_balance ?? '0.00' }
    );
  }

  // WHY skipped at zero: a coupon can bring the total to nothing, and a ledger group needs amounts > 0.
  if (totalPaisa > 0) {
    await ledgerService.recordTransactionGroup(client, {
      txnGroupId: randomUUID(),
      defaultCategory: 'VAULT_PAYMENT',
      defaultReferenceType: 'orders',
      defaultReferenceId: Number(orderId),
      memo: `Order ${orderRef} paid from vault`,
      entries: [
        { walletId: wallet.id, entryType: 'DEBIT', amount: fromPaisa(totalPaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `vault_payment:${orderId}:debit` },
        { walletId: clearingId, entryType: 'CREDIT', amount: fromPaisa(totalPaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `vault_payment:${orderId}:credit` },
      ],
    });
  }

  await client.query(`UPDATE orders SET payment_status = 'PAID', updated_at = now() WHERE id = $1`, [orderId]);
  const { rows: subOrders } = await client.query(
    `UPDATE sub_orders SET status = 'CONFIRMED', updated_at = now() WHERE order_id = $1 RETURNING id`,
    [orderId]
  );
  for (const so of subOrders.sort((a, b) => Number(a.id) - Number(b.id))) {
    await vaultService.depositToEscrow(client, {
      subOrderId: so.id,
      buyerWalletId: clearingId,
      idempotencyKey: `escrow_lock_paid:${so.id}`,
      client,
    });
  }

  await writeAudit(client, {
    action: 'orders.order.pay_from_vault',
    actorId: userId,
    targetType: 'orders',
    targetRef: orderRef,
    before: { payment_status: 'PENDING', available_balance: mine?.available_balance ?? '0.00' },
    after: { payment_status: 'PAID', amount: fromPaisa(totalPaisa), wallet_id: wallet.id },
    riskTier: 'LOW',
  });
  return { paid: true, amount: fromPaisa(totalPaisa) };
}

/**
 * Gives a cancelled, paid-up-front order its money back, into the shopper's vault. Runs inside the
 * caller's transaction. Returns the escrow of every sub-order to the clearing wallet (a gateway order
 * whose escrow never locked has none, and is refunded all the same: the gateway did take the money),
 * then credits the shopper the order total. A no-op for COD, for an unpaid order and for one already
 * refunded.
 */
export async function refundCancelledOrderToVault(client, order, { actorId = null, reason = 'Order cancelled' } = {}) {
  if (!isRefundableOnCancel(order)) return { refunded: false };
  const key = `vault_refund:${order.id}`;
  if (await ledgerKeyUsed(client, `${key}:credit`)) return { refunded: false, reason: 'ALREADY_REFUNDED' };

  const clearingId = await vaultService.resolveClearingWalletId(client);
  const { rows: escrowed } = await client.query(
    `SELECT DISTINCT s.id FROM sub_orders s
       JOIN escrow_entries e ON e.sub_order_id = s.id
      WHERE s.order_id = $1 AND e.status <> 'CLAWED_BACK'
      ORDER BY s.id`,
    [order.id]
  );
  for (const so of escrowed) {
    await vaultService.executeClawback(client, {
      subOrderId: so.id,
      reason,
      executedBy: actorId,
      refundBuyerWalletId: clearingId,
      idempotencyKey: `vault_cancel:${so.id}`,
      client,
    });
  }

  const totalPaisa = toPaisa(order.total_amount);
  const wallet = await walletRepo.getOrCreateWallet(client, order.customer_id, { client });
  if (totalPaisa > 0) {
    await ledgerService.recordTransactionGroup(client, {
      txnGroupId: randomUUID(),
      defaultCategory: 'VAULT_REFUND',
      defaultReferenceType: 'orders',
      defaultReferenceId: Number(order.id),
      memo: `Order ${order.ref} cancelled, ${order.payment_method} payment returned to the vault`,
      entries: [
        { walletId: clearingId, entryType: 'DEBIT', amount: fromPaisa(totalPaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:debit` },
        { walletId: wallet.id, entryType: 'CREDIT', amount: fromPaisa(totalPaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:credit` },
      ],
    });
  }

  await client.query(`UPDATE orders SET payment_status = 'REFUNDED', updated_at = now() WHERE id = $1`, [order.id]);
  await writeAudit(client, {
    action: 'orders.order.vault_refund',
    actorId: actorId ?? order.customer_id,
    targetType: 'orders',
    targetRef: order.ref,
    before: { payment_status: 'PAID' },
    after: { payment_status: 'REFUNDED', amount: fromPaisa(totalPaisa), wallet_id: wallet.id, paid_by: order.payment_method },
    riskTier: 'LOW',
  });
  return { refunded: true, amount: fromPaisa(totalPaisa) };
}
