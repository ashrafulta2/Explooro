/**
 * recommendationAdmin.controller.js — Request handlers for the personalized-feed admin page (Phase G).
 */

import * as admin from '../services/recommendationAdmin.service.js';
import * as funnel from '../services/recoFunnel.service.js';
import * as recoCache from '../services/recoCache.service.js';
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

/**
 * How the feed is doing right now. Two honest scopes: the counters are this node's since boot, the
 * driver block is the cache adapter's own (shared across nodes when it is Redis).
 */
async function runtimeOf(req) {
  const out = { node: recoCache.getStats(), driver: null };
  try {
    out.driver = (await cacheOf(req)?.stats?.()) ?? null;
  } catch {
    // The counters are still worth showing without the driver's view.
  }
  return out;
}

/**
 * Admin read: every section as it is running, the rail catalogue, who may change it, the recent change
 * history and how the cache is behaving — one trip, so the page never renders half a picture.
 */
export async function getAdminSettings(req, reply) {
  const db = dbOf(req);
  const [sections, authority, runtime] = await Promise.all([
    admin.getSettings(db),
    admin.getUpdateAuthority(db),
    runtimeOf(req),
  ]);

  let history = [];
  try {
    const result = await auditRepo.listAuditLogs(db, { action: admin.AUDIT_ACTION, limit: 15 });
    history = result?.items ?? [];
  } catch {
    // The page is still useful without history; an empty list renders an explicit empty state.
  }

  return reply.send({
    sections,
    authority,
    history,
    runtime,
    min_reason_length: admin.MIN_REASON_LENGTH,
    can_update: Boolean(req.userPermissions?.has?.(admin.UPDATE_PERMISSION)),
  });
}

/** Which surface works: impressions, clicks and click-attributed carts/purchases per surface. */
export async function getAdminFunnel(req, reply) {
  const q = req.query || {};
  const result = await funnel.getFunnel(dbOf(req), {
    audience: q.audience,
    days: q.days,
    attributionDays: q.attribution_days,
  });
  return reply.send({ ...result, limits: funnel.FUNNEL_LIMITS });
}

export async function updateAdminSection(req, reply) {
  const body = req.body || {};
  const section = await admin.updateSection(dbOf(req), cacheOf(req), auditService, {
    section: req.params.section,
    value: body.value,
    reason: body.reason,
    baseUpdatedAt: body.base_updated_at,
    userId: req.user?.id ?? null,
    actorRole: req.user?.roles?.[0] ?? req.user?.role ?? null,
    reqContext: reqContextOf(req),
  });

  return reply.send({
    section,
    message_en: 'Feed settings updated. Shoppers get them within a few seconds.',
    message_bn: 'ফিডের সেটিংস হালনাগাদ হয়েছে। ক্রেতারা কয়েক সেকেন্ডের মধ্যেই এটি পাবেন।',
  });
}
