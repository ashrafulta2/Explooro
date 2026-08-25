/**
 * kyc.controller.js — Fastify controller for KYC Verification & Trust Tiers (Prompt 7.5).
 */

import * as kycService from '../services/kyc.service.js';
import * as trustTierService from '../services/trustTier.service.js';

export async function submitStep(req, reply) {
  const {
    kyc_type = 'SUPPLIER',
    step = 1,
    nid_number,
    trade_license_no,
    vat_tin,
    business_name,
    business_address,
    documents = [],
  } = req.body || {};

  const result = await kycService.submitKycStep(req.server.db, {
    userId: req.user.id,
    kycType: kyc_type,
    step: parseInt(step, 10) || 1,
    nidNumber: nid_number,
    tradeLicenseNo: trade_license_no,
    vatTin: vat_tin,
    businessName: business_name,
    businessAddress: business_address,
    documents,
  });

  return reply.status(201).send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function getMyStatus(req, reply) {
  const status = await kycService.getKycStatus(req.server.db, req.user.id);

  return reply.send({
    data: status,
    meta: { trace_id: req.traceId },
  });
}

export async function appeal(req, reply) {
  const { kyc_id, appeal_note } = req.body || {};

  const result = await kycService.appealKyc(req.server.db, {
    kycId: parseInt(kyc_id, 10),
    userId: req.user.id,
    appealNote: appeal_note,
  });

  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function getQueue(req, reply) {
  const { kyc_type, status, limit = 20, offset = 0 } = req.query || {};

  const result = await kycService.getKycQueue(req.server.db, {
    kycType: kyc_type,
    status,
    limit: parseInt(limit, 10) || 20,
    offset: parseInt(offset, 10) || 0,
  });

  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function getKycById(req, reply) {
  const kycId = parseInt(req.params.id, 10);

  const { rows } = await req.server.db.query(
    `SELECT k.id, k.ref, k.user_id, k.kyc_type, k.business_name, k.business_address,
            k.current_step, k.status, k.rejection_reason, k.rejection_reason_bn,
            k.created_at, k.reviewed_at, k.verified_at,
            up.full_name AS applicant_name,
            u.email AS applicant_email,
            u.phone AS applicant_phone,
            COALESCE(ts.tier, 'STARTER') as current_tier,
            COALESCE(ts.score, 50) as trust_score
     FROM kyc_verifications k
     JOIN users u ON u.id = k.user_id
     LEFT JOIN user_profiles up ON up.user_id = k.user_id
     LEFT JOIN trust_scores ts ON ts.user_id = k.user_id
     WHERE k.id = $1`,
    [kycId]
  );

  if (rows.length === 0) {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message_en: `KYC submission #${kycId} not found.` },
    });
  }

  const kyc = rows[0];
  const { rows: docs } = await req.server.db.query(
    `SELECT id, doc_type, mime_type, size_bytes, view_count, created_at
     FROM kyc_documents
     WHERE kyc_id = $1
     ORDER BY id ASC`,
    [kycId]
  );

  return reply.send({
    data: {
      ...kyc,
      documents: docs,
    },
    meta: { trace_id: req.traceId },
  });
}

export async function viewDocument(req, reply) {
  const docId = parseInt(req.params.docId, 10);

  const document = await kycService.viewKycDocument(req.server.db, {
    docId,
    reviewerId: req.user.id,
  });

  return reply.send({
    data: document,
    meta: { trace_id: req.traceId },
  });
}

export async function decide(req, reply) {
  const kycId = parseInt(req.params.id, 10);
  const { decision, reason_en, reason_bn } = req.body || {};

  const result = await kycService.decideKyc(req.server.db, {
    kycId,
    decision,
    reviewerId: req.user.id,
    reviewerRole: req.user.role || 'moderator',
    reasonEn: reason_en,
    reasonBn: reason_bn,
  });

  const statusCode = result.makerCheckerPending ? 202 : 200;
  return reply.status(statusCode).send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function getTrustTier(req, reply) {
  const userId = parseInt(req.params.userId, 10);

  const { rows } = await req.server.db.query(
    `SELECT u.id, up.full_name,
            COALESCE(ts.tier, 'STARTER') as tier,
            COALESCE(ts.score, 50) as score,
            COALESCE(ts.completed_orders, 0) as completed_orders,
            COALESCE(ts.delivery_success_rate, 100) as delivery_success_rate,
            COALESCE(ts.dispute_rate, 0) as dispute_rate
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN trust_scores ts ON ts.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );

  if (rows.length === 0) {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message_en: `User #${userId} not found.` },
    });
  }

  const user = rows[0];
  const benefits = trustTierService.getTierBenefits(user.tier);

  return reply.send({
    data: {
      user,
      benefits,
    },
    meta: { trace_id: req.traceId },
  });
}

export async function recomputeTiers(req, reply) {
  const result = await trustTierService.recomputeAllTiers(req.server.db);

  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}
