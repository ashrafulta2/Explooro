/**
 * variantOptions.controller.ts — which variant options each category offers (/admin/catalog/variant-options).
 */

import * as variantOptions from '../services/variantOptions.service.ts';
import * as auditService from '../services/audit.service.ts';
import * as auditRepo from '../repositories/audit.repository.ts';
import { AppError } from '../plugins/errorHandler.ts';

const dbOf = (req) => req.db || req.server?.db;

export async function getAdminPolicy(req, reply) {
  const db = dbOf(req);
  const policy = await variantOptions.getPolicy(db);
  let history = [];
  try {
    const result = await auditRepo.listAuditLogs(db, { action: 'catalog.variant_options.update', limit: 10 });
    history = result?.items ?? [];
  } catch {
    // The page still works without history.
  }
  return reply.send({
    data: {
      ...policy,
      history,
      can_update: Boolean(req.userPermissions?.has?.('catalog.category.manage')),
    },
  });
}

export async function updateAdminPolicy(req, reply) {
  const body = req.body || {};
  const policy = await variantOptions.updatePolicy(dbOf(req), auditService, {
    rules: { categories: body.categories },
    reason: body.reason,
    baseUpdatedAt: body.base_updated_at,
    userId: req.user?.id ?? null,
    actorRole: req.user?.roles?.[0] ?? req.user?.role ?? null,
    reqContext: { traceId: req.traceId, ip: req.ip, userAgent: req.headers?.['user-agent'] },
  });
  return reply.send({
    data: policy,
    message_en: 'Variant options saved. Product forms use them from the next save.',
    message_bn: 'ভ্যারিয়েন্ট অপশন সেভ হয়েছে। পরের সেভ থেকে প্রোডাক্ট ফর্মে এগুলো প্রযোজ্য।',
  });
}

/** What the product form may offer for one category: GET /catalog/variant-options?category_id=. */
export async function getForCategory(req, reply) {
  const raw = String(req.query?.category_id ?? '');
  if (!/^\d+$/.test(raw)) {
    throw new AppError('VALIDATION_FAILED', 'category_id must be a category id.', 'category_id অবশ্যই একটি ক্যাটেগরি আইডি হতে হবে।', { field: 'category_id' });
  }
  const options = await variantOptions.loadAllowedForCategory(dbOf(req), Number(raw));
  return reply.send({ data: { category_id: Number(raw), options } });
}
