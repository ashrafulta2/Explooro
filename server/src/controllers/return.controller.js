/**
 * return.controller.js — HTTP Controller for Return Requests & Moderation Queue (Prompt 7.2).
 */

import * as returnService from '../services/return.service.js';

export async function requestReturn(req, reply) {
  const customerId = req.user.id;
  const {
    sub_order_id,
    items,
    reason_code,
    customer_note,
    evidence_urls,
    preferred_resolution,
  } = req.body;

  const result = await returnService.createReturnRequest(req.server.db, req.server.cache, {
    customerId,
    subOrderId: parseInt(sub_order_id, 10),
    items: items || [],
    reasonCode: reason_code,
    customerNote: customer_note || '',
    evidenceUrls: evidence_urls || [],
    preferredResolution: preferred_resolution || 'WALLET_REFUND',
  });

  return reply.status(201).send({
    data: result,
  });
}

export async function getMyReturns(req, reply) {
  const customerId = req.user.id;
  const { rows } = await req.server.db.query(
    `SELECT r.*, s.ref AS sub_order_ref, s.total_amount AS sub_order_total
     FROM return_requests r
     JOIN sub_orders s ON s.id = r.sub_order_id
     WHERE r.customer_id = $1
     ORDER BY r.created_at DESC`,
    [customerId]
  );

  return reply.send({
    data: {
      returns: rows,
    },
  });
}

export async function getReturnById(req, reply) {
  const idOrRef = req.params.id;
  const isStaff = req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'moderator';
  const customerId = isStaff ? null : req.user.id;

  const data = await returnService.getReturnDetails(req.server.db, idOrRef, { customerId });

  if (!data) {
    return reply.status(404).send({
      error: {
        code: 'RETURN_NOT_FOUND',
        message_en: `Return request #${idOrRef} not found.`,
        message_bn: `রিটার্ন রিকোয়েস্ট #${idOrRef} পাওয়া যায়নি।`,
      },
    });
  }

  return reply.send({
    data,
  });
}

export async function getAdminQueue(req, reply) {
  const status = req.query.status || null;
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;

  const returns = await returnService.getAdminReturnsQueue(req.server.db, {
    status,
    limit,
    offset,
  });

  return reply.send({
    data: {
      returns,
      limit,
      offset,
    },
  });
}

export async function reviewReturn(req, reply) {
  const returnRequestId = parseInt(req.params.id, 10);
  const { action, rejection_reason } = req.body;

  const result = await returnService.reviewReturnRequest(req.server.db, req.server.cache, {
    returnRequestId,
    action: action || 'APPROVE',
    rejectionReason: rejection_reason || '',
    reviewedBy: req.user.id,
  });

  return reply.send({
    data: result,
  });
}

export async function inspectReturn(req, reply) {
  const returnRequestId = parseInt(req.params.id, 10);
  const { inspection_notes, condition_pass } = req.body;

  const result = await returnService.receiveAndInspectReturn(req.server.db, {
    returnRequestId,
    inspectionNotes: inspection_notes || 'Inspected at returns warehouse',
    conditionPass: condition_pass !== false,
    inspectedBy: req.user.id,
  });

  return reply.send({
    data: result,
  });
}

export async function refundReturn(req, reply) {
  const returnRequestId = parseInt(req.params.id, 10);

  const result = await returnService.executeRefund(req.server.db, req.server.cache, {
    returnRequestId,
    approvedBy: req.user.id,
  });

  return reply.send({
    data: result,
  });
}
