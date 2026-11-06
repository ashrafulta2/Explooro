/**
 * legal.controller.ts — HTTP layer for the legal documents (services/legal.service.ts).
 */

import * as legal from '../services/legal.service.ts';
import * as auditService from '../services/audit.service.ts';
import * as auditRepo from '../repositories/audit.repository.ts';

const dbOf = (req) => req.db || req.server?.db;
const rolesOf = (req) => (Array.isArray(req.user?.roles) ? req.user.roles : req.user?.role ? [req.user.role] : []);
const reqContext = (req) => ({ traceId: req.traceId, ip: req.ip, userAgent: req.headers?.['user-agent'] });

export async function listDocuments(req, reply) {
  return reply.send({ data: await legal.listCurrent(dbOf(req)) });
}

export async function getDocument(req, reply) {
  const version = req.query?.version != null ? Number(req.query.version) : null;
  return reply.send({ data: await legal.getDocument(dbOf(req), req.params.key, { version }) });
}

export async function getPending(req, reply) {
  const pending = await legal.pendingFor(dbOf(req), { userId: req.user.id, roles: rolesOf(req) });
  return reply.send({ data: { pending } });
}

export async function acceptDocuments(req, reply) {
  const pending = await legal.accept(dbOf(req), {
    userId: req.user.id,
    roles: rolesOf(req),
    documentIds: req.body?.document_ids,
    ip: req.ip ?? null,
    userAgent: req.headers?.['user-agent'] ?? null,
  });
  return reply.send({ data: { pending } });
}

export async function getAdminOverview(req, reply) {
  const db = dbOf(req);
  const overview = await legal.getAdminOverview(db);
  let history = [];
  try {
    const [published, company] = await Promise.all([
      auditRepo.listAuditLogs(db, { action: 'platform.legal.publish', limit: 10 }),
      auditRepo.listAuditLogs(db, { action: 'platform.legal.company.update', limit: 10 }),
    ]);
    history = [...(published?.items ?? []), ...(company?.items ?? [])]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 15);
  } catch {
    // The page still works without history.
  }
  return reply.send({
    ...overview,
    history,
    can_publish: Boolean(req.userPermissions?.has?.('platform.legal.publish')),
  });
}

export async function publishVersion(req, reply) {
  const { reason, ...input } = req.body || {};
  const row = await legal.publishVersion(dbOf(req), auditService, {
    key: req.params.key,
    input,
    reason,
    userId: req.user?.id ?? null,
    actorRole: rolesOf(req)[0] ?? null,
    reqContext: reqContext(req),
  });
  return reply.code(201).send({
    data: row,
    message_en: row.requires_reacceptance
      ? `Version ${row.version} is published. Everyone it applies to is asked to agree on their next visit.`
      : `Version ${row.version} is published. Nobody is asked to agree again.`,
    message_bn: row.requires_reacceptance
      ? `সংস্করণ ${row.version} প্রকাশিত হয়েছে। যাঁদের জন্য প্রযোজ্য, তাঁদের পরের বার এলে সম্মতি দিতে বলা হবে।`
      : `সংস্করণ ${row.version} প্রকাশিত হয়েছে। কাউকে আবার সম্মতি দিতে বলা হবে না।`,
  });
}

export async function updateCompany(req, reply) {
  const { reason, ...company } = req.body || {};
  const saved = await legal.updateCompany(dbOf(req), auditService, {
    company,
    reason,
    userId: req.user?.id ?? null,
    actorRole: rolesOf(req)[0] ?? null,
    reqContext: reqContext(req),
  });
  return reply.send({
    data: saved,
    message_en: 'Company details saved. Every document shows them now.',
    message_bn: 'কোম্পানির তথ্য সেভ হয়েছে। সব নথিতে এখন এগুলো দেখাবে।',
  });
}
