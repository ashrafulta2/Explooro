/**
 * integration.controller.ts — request handlers for /admin/platform/integrations (migration 108).
 */

import * as integrationService from '../services/integration.service.ts';
import * as auditService from '../services/audit.service.ts';

function dbOf(req) {
  return req.db || req.server?.db;
}

function optionsOf(req) {
  const config = req.server?.config;
  return {
    encryptionKey: config?.auth?.piiEncryptionKey ?? process.env.PII_ENCRYPTION_KEY,
    publicApiUrl: config?.core?.publicApiUrl ?? process.env.PUBLIC_API_URL,
  };
}

function actorOf(req) {
  return {
    userId: req.user?.id ?? null,
    actorRole: req.user?.roles?.[0] ?? req.user?.role ?? null,
    reqContext: { traceId: req.traceId, ip: req.ip, userAgent: req.headers?.['user-agent'] },
  };
}

export async function listIntegrations(req, reply) {
  const { publicApiUrl } = optionsOf(req);
  const result = await integrationService.listIntegrations(dbOf(req), { publicApiUrl });
  return reply.send({
    ...result,
    can_manage: Boolean(req.userPermissions?.has?.('platform.integration.manage')),
  });
}

export async function updateCredentials(req, reply) {
  const body = req.body || {};
  const result = await integrationService.updateCredentials(dbOf(req), auditService, {
    key: req.params.key,
    values: body.values,
    clear: body.clear,
    reason: body.reason,
    ...optionsOf(req),
    ...actorOf(req),
  });
  return reply.send({
    integration: result.integration,
    previous_credentials_unreadable: result.previous_credentials_unreadable,
  });
}

export async function setStatus(req, reply) {
  const body = req.body || {};
  const result = await integrationService.setEnabled(dbOf(req), auditService, {
    key: req.params.key,
    enabled: body.enabled,
    reason: body.reason,
    ...optionsOf(req),
    ...actorOf(req),
  });
  return reply.send(result);
}

export async function testIntegration(req, reply) {
  const { publicApiUrl } = optionsOf(req);
  const result = await integrationService.testIntegration(dbOf(req), auditService, {
    key: req.params.key,
    publicApiUrl,
    ...actorOf(req),
  });
  return reply.send(result);
}

export async function listWebhookLogs(req, reply) {
  const result = await integrationService.listWebhookLogs(dbOf(req), { limit: req.query?.limit });
  return reply.send(result);
}
