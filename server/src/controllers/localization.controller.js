/**
 * localization.controller.js — Request handlers for the Language & Localization policy API.
 */

import * as localizationService from '../services/localization.service.js';
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
 * Public. The client boots from this, so it must answer for a signed-out visitor and must never
 * fail: the service already degrades to the shipped default rather than throwing.
 */
export async function getPublicPolicy(req, reply) {
  const policy = await localizationService.getPolicy(dbOf(req), cacheOf(req));
  return reply.send({
    policy: {
      default_locale: policy.default_locale,
      enabled_locales: policy.enabled_locales,
      allow_user_override: policy.allow_user_override,
    },
    supported_locales: localizationService.SUPPORTED_LOCALES,
  });
}

/**
 * Admin read. Returns the policy, the roster of who may change it (role defaults plus live
 * standing grants), and the recent change history so the page can show what moved and why
 * without a second trip to the Audit Log.
 */
export async function getAdminPolicy(req, reply) {
  const db = dbOf(req);
  const [policy, authority] = await Promise.all([
    localizationService.getPolicy(db, cacheOf(req)),
    localizationService.getUpdateAuthority(db),
  ]);

  let history = [];
  try {
    const result = await auditRepo.listAuditLogs(db, {
      action: 'platform.localization.update',
      limit: 10,
    });
    history = result?.items ?? [];
  } catch {
    // The page is still useful without history; an empty list renders an explicit empty state.
  }

  return reply.send({
    policy,
    supported_locales: localizationService.SUPPORTED_LOCALES,
    authority,
    history,
    can_update: Boolean(req.userPermissions?.has?.('platform.localization.update')),
  });
}

export async function updateAdminPolicy(req, reply) {
  const body = req.body || {};
  const policy = await localizationService.updatePolicy(dbOf(req), cacheOf(req), auditService, {
    policy: {
      default_locale: body.default_locale,
      enabled_locales: body.enabled_locales,
      allow_user_override: body.allow_user_override,
    },
    reason: body.reason,
    userId: req.user?.id ?? null,
    actorRole: req.user?.roles?.[0] ?? req.user?.role ?? null,
    reqContext: reqContextOf(req),
  });

  return reply.send({
    policy,
    message_en: 'Default language updated. New visitors will see it immediately.',
    message_bn: 'ডিফল্ট ভাষা হালনাগাদ হয়েছে। নতুন দর্শনার্থীরা সঙ্গে সঙ্গে এটি দেখবেন।',
  });
}
