/**
 * delegation.controller.js — HTTP controllers for delegation & maker-checker endpoints (Prompt 2.5).
 */

import * as delegationService from '../services/delegation.service.js';
import * as makerCheckerService from '../services/makerChecker.service.js';

function requestMeta(req) {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
    traceId: req.traceId ?? null,
  };
}

/* ========================================================================= */
/* Standing Grants (Mode A)                                                 */
/* ========================================================================= */

export async function createGrant(req, reply) {
  const { db, cache } = req.server;
  const grant = await delegationService.createStandingGrant(db, cache, {
    userId: req.body.user_id ?? req.body.userId,
    permissionKey: req.body.permission_key ?? req.body.permissionKey,
    effect: req.body.effect ?? 'GRANT',
    scopeJson: req.body.scope_json ?? req.body.scope ?? req.body.scopeJson ?? null,
    reason: req.body.reason,
    expiresAt: req.body.expires_at ?? req.body.expiresAt,
    grantedBy: req.user.id,
    ...requestMeta(req),
  });
  reply.code(201).send({ data: { grant } });
}

export async function revokeGrant(req, reply) {
  const { db, cache } = req.server;
  const grant = await delegationService.revokeStandingGrant(db, cache, {
    grantId: Number(req.params.id),
    revokedBy: req.user.id,
    reason: req.body?.reason,
    ...requestMeta(req),
  });
  reply.send({ data: { revoked: true, grant } });
}

export async function listGrants(req, reply) {
  const { db } = req.server;
  const grants = await delegationService.listStandingGrants(db, {
    userId: req.query?.user_id ? Number(req.query.user_id) : null,
    permissionKey: req.query?.permission_key ?? null,
    status: req.query?.status ?? 'ACTIVE',
    limit: req.query?.limit ? Number(req.query.limit) : 50,
    offset: req.query?.offset ? Number(req.query.offset) : 0,
  });
  reply.send({ data: { grants } });
}

/* ========================================================================= */
/* Just-In-Time Requests (Mode B)                                           */
/* ========================================================================= */

export async function createAccessRequest(req, reply) {
  const { db } = req.server;
  const request = await delegationService.createAccessRequest(db, {
    requesterId: req.user.id,
    permissionKey: req.body.permission_key,
    targetScopeJson: req.body.target_scope_json ?? req.body.target_scope ?? null,
    reason: req.body.reason,
    ...requestMeta(req),
  });
  reply.code(201).send({ data: { access_request: request } });
}

export async function decideAccessRequest(req, reply) {
  const { db, cache } = req.server;
  const request = await delegationService.decideAccessRequest(db, cache, {
    requestId: Number(req.params.id),
    decision: req.body.decision,
    approverId: req.user.id,
    approverNote: req.body.note ?? null,
    windowMinutes: req.body.window_minutes ?? 120,
    ...requestMeta(req),
  });
  reply.send({ data: { access_request: request } });
}

export async function listAccessRequests(req, reply) {
  const { db } = req.server;
  const userRoles = req.user.roles || [];
  const isApprover = userRoles.includes('admin') || userRoles.includes('super_admin');

  // Requester sees only their own requests unless they are an approver viewing the queue
  const requesterId = isApprover && req.query?.all === 'true' ? null : req.query?.user_id ? Number(req.query.user_id) : isApprover ? null : req.user.id;

  const requests = await delegationService.listAccessRequests(db, {
    requesterId,
    permissionKey: req.query?.permission_key ?? null,
    status: req.query?.status ?? null,
    limit: req.query?.limit ? Number(req.query.limit) : 50,
    offset: req.query?.offset ? Number(req.query.offset) : 0,
  });
  reply.send({ data: { access_requests: requests } });
}

/* ========================================================================= */
/* Maker-Checker (Mode C)                                                   */
/* ========================================================================= */

export async function listPendingActions(req, reply) {
  const { db } = req.server;
  const actions = await makerCheckerService.listPendingActions(db, {
    actorId: req.query?.actor_id ? Number(req.query.actor_id) : null,
    actionKey: req.query?.action_key ?? null,
    status: req.query?.status ?? 'PENDING',
    limit: req.query?.limit ? Number(req.query.limit) : 50,
    offset: req.query?.offset ? Number(req.query.offset) : 0,
  });
  reply.send({ data: { pending_actions: actions } });
}

export async function decidePendingAction(req, reply) {
  const { db, cache } = req.server;
  const action = await makerCheckerService.decidePendingAction(db, cache, {
    actionId: Number(req.params.id),
    decision: req.body.decision,
    approverId: req.user.id,
    approverNote: req.body.note ?? null,
    ...requestMeta(req),
  });
  reply.send({ data: { pending_action: action } });
}
