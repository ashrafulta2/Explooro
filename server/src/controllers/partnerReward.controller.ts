/**
 * partnerReward.controller.ts — the monthly shop partner reward pool (/admin/growth/partner-rewards and
 * the partner dashboard card).
 */

import * as partnerReward from '../services/partnerReward.service.ts';
import * as auditRepo from '../repositories/audit.repository.ts';

const dbOf = (req) => req.db || req.server?.db;
const can = (req, key) => Boolean(req.userPermissions?.has?.(key));

export async function getAdminView(req, reply) {
  const db = dbOf(req);
  const view = await partnerReward.getAdminView(db, { page: req.query?.page, limit: req.query?.limit });
  let history = [];
  try {
    const result = await auditRepo.listAuditLogs(db, { action: 'growth.partner_reward.update', limit: 10 });
    history = result?.items ?? [];
  } catch {
    // The page still works without history.
  }
  return reply.send({
    ...view,
    history,
    can_update: can(req, 'growth.partner_reward.update'),
    can_run: can(req, 'growth.partner_reward.run'),
  });
}

export async function getRunPayouts(req, reply) {
  const runId = Number(req.params.id);
  const result = await partnerReward.getRunPayouts(dbOf(req), runId, { page: req.query?.page, limit: req.query?.limit });
  return reply.send(result);
}

export async function updateRules(req, reply) {
  const body = req.body || {};
  const policy = await partnerReward.updateRules(dbOf(req), {
    input: body,
    reason: body.reason,
    expectedUpdatedAt: body.expected_updated_at ?? null,
    userId: req.user?.id ?? null,
    actorRole: req.user?.roles?.[0] ?? req.user?.role ?? null,
    reqContext: { traceId: req.traceId, ip: req.ip, userAgent: req.headers?.['user-agent'] },
  });
  return reply.send({
    policy,
    message_en: 'Reward rules saved. They apply to every month not yet closed.',
    message_bn: 'রিওয়ার্ডের নিয়ম সংরক্ষিত হয়েছে। যে মাসগুলো এখনো বন্ধ হয়নি সেগুলোতে প্রযোজ্য।',
  });
}

/**
 * Closes every finished month now, without waiting for the settle delay. Repeating it is harmless:
 * a month with a run is skipped, which is what makes the Idempotency-Key header a formality here.
 */
export async function closeNow(req, reply) {
  const { results } = await partnerReward.closeDueMonths(dbOf(req), { triggeredBy: req.user?.id ?? null, ignoreLag: true });
  const closed = results.filter((r) => !r.skipped);
  return reply.send({
    closed,
    message_en: closed.length ? `Closed ${closed.length} month(s) and paid the pool.` : 'There is no finished month left to close.',
    message_bn: closed.length ? `${closed.length}টি মাস বন্ধ করে pool পরিশোধ করা হয়েছে।` : 'বন্ধ করার মতো কোনো শেষ হওয়া মাস নেই।',
  });
}

export async function getOwnView(req, reply) {
  const data = await partnerReward.getOwnView(dbOf(req), req.user?.id);
  return reply.send({ data });
}
