/**
 * restriction.controller.js — HTTP Controller for Granular User Activity Restrictions (Prompt 2.6).
 */

import * as restrictionService from '../services/restriction.service.js';
import * as segmentService from '../services/segment.service.js';

function requestMeta(req) {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
    traceId: req.traceId ?? null,
  };
}

export async function listRestrictions(req, reply) {
  const { db } = req.server;
  const filter = {
    subjectType: req.query.subject_type ?? req.query.subjectType ?? null,
    capabilityKey: req.query.capability_key ?? req.query.capabilityKey ?? null,
    mode: req.query.mode ?? null,
    status: req.query.status ?? 'ACTIVE',
    limit: req.query.limit ? Number(req.query.limit) : 50,
    offset: req.query.offset ? Number(req.query.offset) : 0,
  };
  const restrictions = await restrictionService.listAllRestrictions(db, filter);
  reply.send({ data: { restrictions } });
}

export async function getUserRestrictions(req, reply) {
  const { db } = req.server;
  const userId = Number(req.params.id);
  const restrictions = await restrictionService.getUserRestrictions(db, userId);
  reply.send({ data: { restrictions } });
}

export async function createRestriction(req, reply) {
  const { db, cache } = req.server;
  const restriction = await restrictionService.applyRestriction(db, cache, {
    subjectType: req.body.subject_type ?? req.body.subjectType,
    subjectRef: req.body.subject_ref ?? req.body.subjectRef,
    segmentPredicate: req.body.segment_predicate ?? req.body.segmentPredicate ?? null,
    capabilityKey: req.body.capability_key ?? req.body.capabilityKey,
    mode: req.body.mode,
    limitValue: req.body.limit_value ?? req.body.limitValue ?? null,
    reason: req.body.reason,
    reasonBn: req.body.reason_bn ?? req.body.reasonBn ?? null,
    evidenceJson: req.body.evidence_json ?? req.body.evidenceJson ?? null,
    appliedBy: req.user.id,
    expiresAt: req.body.expires_at ?? req.body.expiresAt ?? null,
    ...requestMeta(req),
  });
  reply.code(201).send({ data: { restriction } });
}

export async function updateRestriction(req, reply) {
  const { db, cache } = req.server;
  const restrictionId = Number(req.params.id);
  const restriction = await restrictionService.updateRestriction(db, cache, {
    restrictionId,
    mode: req.body.mode ?? null,
    limitValue: req.body.limit_value ?? req.body.limitValue ?? null,
    reason: req.body.reason ?? null,
    reasonBn: req.body.reason_bn ?? req.body.reasonBn ?? null,
    evidenceJson: req.body.evidence_json ?? req.body.evidenceJson ?? null,
    expiresAt: req.body.expires_at ?? req.body.expiresAt ?? null,
    updatedBy: req.user.id,
    ...requestMeta(req),
  });
  reply.send({ data: { restriction } });
}

export async function liftRestriction(req, reply) {
  const { db, cache } = req.server;
  const restrictionId = Number(req.params.id);
  const restriction = await restrictionService.liftRestriction(db, cache, {
    restrictionId,
    liftedBy: req.user.id,
    reason: req.body?.reason,
    ...requestMeta(req),
  });
  reply.send({ data: { lifted: true, restriction } });
}

export async function previewSegment(req, reply) {
  const { db } = req.server;
  const predicate = req.body.segment_predicate ?? req.body;
  const result = await segmentService.previewSegmentMatch(db, predicate);
  reply.send({ data: result });
}
