/**
 * dispute.controller.js — Fastify controller for Three-Way Dispute Arbitration (Prompt 7.3).
 */

import * as disputeService from '../services/dispute.service.js';

export async function createDispute(req, reply) {
  const {
    sub_order_id,
    return_id,
    disputed_amount,
    reason,
    initial_message,
    attachments,
  } = req.body || {};

  const dispute = await disputeService.createDispute(req.server.db, req.server.cache, {
    subOrderId: sub_order_id,
    returnId: return_id,
    customerId: req.user.id,
    disputedAmount: disputed_amount,
    reason,
    initialMessage: initial_message,
    attachments,
    openedByRole: req.user.role || 'CUSTOMER',
  });

  return reply.status(201).send({
    data: dispute,
    meta: {
      trace_id: req.traceId,
      dispute_ref: dispute.ref,
    },
  });
}

export async function listDisputes(req, reply) {
  const { status, search, limit = 20, offset = 0 } = req.query || {};

  const result = await disputeService.listDisputes(req.server.db, {
    requestingUser: req.user,
    status,
    search,
    limit: parseInt(limit, 10) || 20,
    offset: parseInt(offset, 10) || 0,
  });

  return reply.send({
    data: result,
    meta: {
      trace_id: req.traceId,
      count: result.count,
    },
  });
}

export async function getDisputeById(req, reply) {
  const disputeId = parseInt(req.params.id, 10);

  const dispute = await disputeService.getDisputeById(req.server.db, disputeId, {
    requestingUser: req.user,
  });

  return reply.send({
    data: dispute,
    meta: {
      trace_id: req.traceId,
    },
  });
}

export async function postMessage(req, reply) {
  const disputeId = parseInt(req.params.id, 10);
  const { body, attachments, is_internal_note } = req.body || {};

  const msg = await disputeService.postMessage(req.server.db, {
    disputeId,
    senderId: req.user.id,
    senderRole: req.user.role || 'CUSTOMER',
    body,
    attachments,
    isInternalNote: is_internal_note,
  });

  return reply.status(201).send({
    data: msg,
    meta: {
      trace_id: req.traceId,
    },
  });
}

export async function getEvidenceTimeline(req, reply) {
  const disputeId = parseInt(req.params.id, 10);

  const timelineData = await disputeService.getEvidenceTimeline(req.server.db, disputeId, {
    requestingUser: req.user,
  });

  return reply.send({
    data: timelineData,
    meta: {
      trace_id: req.traceId,
    },
  });
}

export async function searchPrecedents(req, reply) {
  const { reason, limit = 5 } = req.query || {};

  const precedents = await disputeService.searchPrecedents(req.server.db, {
    reason,
    limit: parseInt(limit, 10) || 5,
  });

  return reply.send({
    data: {
      precedents,
      count: precedents.length,
    },
    meta: {
      trace_id: req.traceId,
    },
  });
}

export async function arbitrateDispute(req, reply) {
  const disputeId = parseInt(req.params.id, 10);
  const { outcome, outcome_split, resolution_notes } = req.body || {};

  const result = await disputeService.arbitrateDispute(req.server.db, req.server.cache, {
    disputeId,
    outcome,
    outcomeSplit: outcome_split,
    arbitratorId: req.user.id,
    arbitratorRole: req.user.role || 'moderator',
    resolutionNotes: resolution_notes,
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
    meta: {
      trace_id: req.traceId,
    },
  });
}

export async function escalateDispute(req, reply) {
  const disputeId = parseInt(req.params.id, 10);
  const { reason } = req.body || {};

  const result = await disputeService.escalateDispute(req.server.db, {
    disputeId,
    reason: reason || 'Escalated to Super Admin for arbitration',
    escalatedBy: req.user.id,
  });

  return reply.send({
    data: result,
    meta: {
      trace_id: req.traceId,
    },
  });
}
