/**
 * payout.controller.js — HTTP Controller for Vault Withdrawals and Admin Payout Queue (Prompt 6.3).
 */

import * as payoutService from '../services/payout.service.js';

export async function requestWithdrawal(req, reply) {
  const idempotencyKey = req.headers['idempotency-key'] || null;
  const result = await payoutService.requestPayout(req.server.db, {
    userId: req.user.id,
    method: req.body?.method,
    accountNumber: req.body?.account_number,
    accountName: req.body?.account_name,
    bankName: req.body?.bank_name,
    amount: req.body?.amount,
    idempotencyKey,
  });

  return reply.status(201).send({
    data: {
      payout: result.payout,
      wallet: result.wallet,
      risk_flags: result.riskFlags,
    },
  });
}

export async function getMyPayouts(req, reply) {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
  const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;

  const result = await payoutService.listPayoutQueue(req.server.db, {
    userId: req.user.id,
    limit,
    cursor,
  });

  return reply.send({
    data: {
      payouts: result.payouts,
      next_cursor: result.nextCursor,
      count: result.count,
    },
  });
}

export async function listPayoutQueue(req, reply) {
  const status = req.query.status || null;
  const method = req.query.method || null;
  const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
  const minAmount = req.query.min_amount || null;
  const maxAmount = req.query.max_amount || null;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
  const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;

  const result = await payoutService.listPayoutQueue(req.server.db, {
    status,
    method,
    userId,
    minAmount,
    maxAmount,
    limit,
    cursor,
  });

  return reply.send({
    data: {
      payouts: result.payouts,
      next_cursor: result.nextCursor,
      count: result.count,
    },
  });
}

export async function approvePayout(req, reply) {
  const payoutId = parseInt(req.params.id, 10);
  const approverNote = req.body?.note || 'Approved for disbursement';

  const result = await payoutService.approvePayout(req.server.db, {
    payoutId,
    approverId: req.user.id,
    approverRole: req.user.role || 'admin',
    approverNote,
  });

  if (result.isPendingMakerChecker) {
    return reply.status(202).send({
      data: result,
      meta: {
        maker_checker: {
          pending_action_id: result.pendingAction?.id,
          action_ref: result.pendingAction?.ref,
          requires_super_admin: true,
        },
      },
    });
  }

  return reply.send({
    data: result,
  });
}

export async function rejectPayout(req, reply) {
  const payoutId = parseInt(req.params.id, 10);
  const reason = req.body?.reason || 'Rejected by staff';

  const result = await payoutService.rejectPayout(req.server.db, {
    payoutId,
    reason,
    rejectedBy: req.user.id,
  });

  return reply.send({
    data: result,
  });
}

export async function batchDisburse(req, reply) {
  const payoutIds = (req.body?.payout_ids || []).map(Number);
  if (payoutIds.length === 0) {
    return reply.status(400).send({
      error: {
        code: 'EMPTY_PAYOUT_LIST',
        message_en: 'At least one payout ID must be selected for batch disbursement.',
        message_bn: 'একসাথে ডিসবার্স করতে কমপক্ষে একটি পেআউট নির্বাচন করুন।',
      },
    });
  }

  const result = await payoutService.batchDisbursePayouts(req.server.db, {
    payoutIds,
    executedBy: req.user.id,
  });

  return reply.send({
    data: result,
  });
}
