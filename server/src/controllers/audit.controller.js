/**
 * audit.controller.js — HTTP Controller for Audit Log Query & Verification APIs (Prompt 2.7).
 */

import * as auditService from '../services/audit.service.js';

export async function listAuditLogs(req, reply) {
  const { db } = req.server;
  const filters = {
    actorId: req.query.actor_id ? Number(req.query.actor_id) : (req.query.actor ? Number(req.query.actor) : null),
    action: req.query.action ?? null,
    targetType: req.query.target_type ?? null,
    targetRef: req.query.target_ref ?? null,
    riskTier: req.query.risk_tier ?? null,
    traceId: req.query.trace_id ?? null,
    startDate: req.query.start_date ?? req.query.from ?? null,
    endDate: req.query.end_date ?? req.query.to ?? null,
    cursor: req.query.cursor ? Number(req.query.cursor) : null,
    limit: req.query.limit ? Math.min(Number(req.query.limit), 100) : 50,
  };

  const result = await auditService.queryAuditLogs(db, filters);
  reply.send({ data: result });
}

export async function verifyAuditChain(req, reply) {
  const { db } = req.server;
  const result = await auditService.verifyChain(db);
  reply.send({ data: result });
}

export async function getUserTimeline(req, reply) {
  const { db } = req.server;
  const userId = Number(req.params.id);
  const result = await auditService.getUserTimeline(db, userId);
  reply.send({ data: result });
}
