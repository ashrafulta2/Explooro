/**
 * genie.controller.js — Request handlers for the popup genie-effect policy API.
 */

import * as genieService from '../services/genie.service.js';
import * as auditService from '../services/audit.service.js';
import * as auditRepo from '../repositories/audit.repository.js';

function dbOf(req) {
  return req.db || req.server?.db;
}

function cacheOf(req) {
  return req.cache || req.server?.cache;
}

function reqContextOf(req) {
  return {
    traceId: req.traceId,
    ip: req.ip,
    userAgent: req.headers?.['user-agent'],
  };
}

const publicShape = (p) => ({ enabled: p.enabled, duration_ms: p.duration_ms, quality: p.quality });

const limits = () => ({
  min_duration_ms: genieService.DURATION_LIMITS.min,
  max_duration_ms: genieService.DURATION_LIMITS.max,
});

/**
 * Public. The client applies this on every cold page load, so it must answer for a signed-out
 * visitor and must never fail: the service degrades to the shipped default rather than throwing.
 */
export async function getPublicPolicy(req, reply) {
  const policy = await genieService.getPolicy(dbOf(req), cacheOf(req));
  return reply.send({ policy: publicShape(policy), limits: limits(), qualities: genieService.QUALITIES });
}

/**
 * Admin read: the policy, who may change it (role defaults plus live standing grants) and the
 * recent change history, so the page can show what moved and why without a second trip to the
 * Audit Log.
 */
export async function getAdminPolicy(req, reply) {
  const db = dbOf(req);
  const [policy, authority] = await Promise.all([
    genieService.getPolicy(db, cacheOf(req)),
    genieService.getUpdateAuthority(db),
  ]);

  let history = [];
  try {
    const result = await auditRepo.listAuditLogs(db, { action: 'platform.genie.update', limit: 10 });
    history = result?.items ?? [];
  } catch {
    // The page is still useful without history; an empty list renders an explicit empty state.
  }

  return reply.send({
    policy,
    limits: limits(),
    qualities: genieService.QUALITIES,
    authority,
    history,
    can_update: Boolean(req.userPermissions?.has?.('platform.genie.update')),
  });
}

export async function updateAdminPolicy(req, reply) {
  const body = req.body || {};
  const policy = await genieService.updatePolicy(dbOf(req), cacheOf(req), auditService, {
    policy: { enabled: body.enabled, duration_ms: body.duration_ms, quality: body.quality },
    reason: body.reason,
    userId: req.user?.id ?? null,
    actorRole: req.user?.roles?.[0] ?? req.user?.role ?? null,
    reqContext: reqContextOf(req),
  });

  return reply.send({
    policy,
    message_en: 'Popup effect updated. Visitors get it on their next page load.',
    message_bn: 'পপআপ ইফেক্ট হালনাগাদ হয়েছে। দর্শনার্থীরা পরবর্তী পেজ লোডেই এটি পাবেন।',
  });
}
