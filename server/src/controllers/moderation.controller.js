/**
 * moderation.controller.js — Fastify controller for Product Approval & Content Moderation (Prompt 7.4).
 */

import * as moderationService from '../services/moderation.service.js';

export async function getQueue(req, reply) {
  const { item_type, status, claimed_by, flagged_only, search, limit = 20, offset = 0 } = req.query || {};

  const result = await moderationService.getQueue(req.server.db, {
    itemType: item_type,
    status,
    claimedBy: claimed_by ? parseInt(claimed_by, 10) : null,
    flaggedOnly: flagged_only === 'true' || flagged_only === true,
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

export async function getItemById(req, reply) {
  const queueId = parseInt(req.params.id, 10);
  const result = await moderationService.getQueue(req.server.db, { limit: 1 });
  // Find single item
  const { rows } = await req.server.db.query(
    `SELECT q.*,
            u.full_name AS submitter_name, u.email AS submitter_email, u.role AS submitter_role,
            cu.full_name AS claimed_by_name, du.full_name AS decided_by_name
     FROM moderation_queue q
     JOIN users u ON u.id = q.submitted_by
     LEFT JOIN users cu ON cu.id = q.claimed_by
     LEFT JOIN users du ON du.id = q.decided_by
     WHERE q.id = $1`,
    [queueId]
  );

  if (rows.length === 0) {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message_en: `Queue item #${queueId} not found.` },
    });
  }

  const item = rows[0];
  return reply.send({
    data: {
      ...item,
      auto_flags: Array.isArray(item.auto_flags_json) ? item.auto_flags_json : [],
    },
    meta: { trace_id: req.traceId },
  });
}

export async function claimItem(req, reply) {
  const queueId = parseInt(req.params.id, 10);

  const claimed = await moderationService.claimItem(req.server.db, {
    queueId,
    moderatorId: req.user.id,
  });

  return reply.send({
    data: claimed,
    meta: { trace_id: req.traceId },
  });
}

export async function releaseClaim(req, reply) {
  const queueId = parseInt(req.params.id, 10);

  const released = await moderationService.releaseClaim(req.server.db, {
    queueId,
    moderatorId: req.user.id,
  });

  return reply.send({
    data: released,
    meta: { trace_id: req.traceId },
  });
}

export async function decideItem(req, reply) {
  const queueId = parseInt(req.params.id, 10);
  const {
    decision,
    reason_en,
    reason_bn,
    changes_requested_en,
    changes_requested_bn,
    shadow_restrict_seller,
  } = req.body || {};

  const result = await moderationService.decideItem(req.server.db, {
    queueId,
    decision,
    moderatorId: req.user.id,
    reasonEn: reason_en,
    reasonBn: reason_bn,
    changesRequestedEn: changes_requested_en,
    changesRequestedBn: changes_requested_bn,
    shadowRestrictSeller: Boolean(shadow_restrict_seller),
  });

  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function bulkDecide(req, reply) {
  const { queue_ids, decision, reason_en, reason_bn } = req.body || {};

  const result = await moderationService.bulkDecide(req.server.db, {
    queueIds: queue_ids || [],
    decision,
    moderatorId: req.user.id,
    reasonEn: reason_en,
    reasonBn: reason_bn,
  });

  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function getStats(req, reply) {
  const stats = await moderationService.getModeratorStats(req.server.db, {
    moderatorId: req.query?.my_stats === 'true' ? req.user.id : null,
  });

  return reply.send({
    data: stats,
    meta: { trace_id: req.traceId },
  });
}

export async function preScreen(req, reply) {
  const {
    title_en,
    title_bn,
    description_en,
    description_bn,
    default_retail_price,
    base_cost,
    category_id,
  } = req.body || {};

  const flags = await moderationService.preScreenContent({
    titleEn: title_en,
    titleBn: title_bn,
    descriptionEn: description_en,
    descriptionBn: description_bn,
    defaultRetailPrice: default_retail_price,
    baseCost: base_cost,
    categoryId: category_id,
    db: req.server.db,
  });

  return reply.send({
    data: {
      flags,
      flag_count: flags.length,
      has_critical: flags.some((f) => f.severity === 'CRITICAL'),
    },
    meta: { trace_id: req.traceId },
  });
}
