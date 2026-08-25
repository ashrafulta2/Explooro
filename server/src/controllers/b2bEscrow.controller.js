/**
 * b2bEscrow.controller.js — B2B Wholesale Escrow & Milestone Settlement Controller (Prompt 10.6).
 */

import * as b2bService from '../services/b2bEscrow.service.js';

export async function createDeal(req, reply) {
  const buyerId = req.body.buyer_id || req.body.buyerId || req.user.id;
  const supplierId = req.body.supplier_id || req.body.supplierId;

  const result = await b2bService.createB2bDeal(req.server.db, {
    buyerId,
    supplierId,
    subOrderId: req.body.sub_order_id || req.body.subOrderId || null,
    titleEn: req.body.title_en || req.body.titleEn,
    titleBn: req.body.title_bn || req.body.titleBn,
    totalAmount: req.body.total_amount || req.body.totalAmount,
    contractTerms: req.body.contract_terms || req.body.contractTerms || {},
    milestones: req.body.milestones || [],
  });

  return reply.code(201).send({ success: true, data: result });
}

export async function listDeals(req, reply) {
  const deals = await b2bService.listB2bDeals(req.server.db, {
    userId: req.user.id,
    role: req.user.role,
    status: req.query.status || null,
  });

  return reply.send({ success: true, data: deals });
}

export async function getDeal(req, reply) {
  const deal = await b2bService.getB2bDealById(req.server.db, req.params.idOrRef);
  return reply.send({ success: true, data: deal });
}

export async function acceptDealTerms(req, reply) {
  const dealId = parseInt(req.params.id, 10);
  const result = await b2bService.acceptDealTerms(req.server.db, {
    dealId,
    userId: req.user.id,
    role: req.user.role,
  });

  return reply.send({ success: true, data: result });
}

export async function submitMilestoneEvidence(req, reply) {
  const milestoneId = parseInt(req.params.id, 10);
  const result = await b2bService.submitMilestoneEvidence(req.server.db, {
    milestoneId,
    supplierId: req.user.id,
    evidenceType: req.body.evidence_type || req.body.evidenceType,
    mediaUrls: req.body.media_urls || req.body.mediaUrls || [],
    notes: req.body.notes || '',
  });

  return reply.send({ success: true, data: result });
}

export async function releaseMilestone(req, reply) {
  const milestoneId = parseInt(req.params.id, 10);
  const isSuperAdmin = req.user.role === 'super_admin';

  const result = await b2bService.releaseMilestone(req.server.db, {
    milestoneId,
    actorId: req.user.id,
    actorRole: req.user.role,
    isSuperAdmin,
    isMakerCheckerApproval: Boolean(req.body.is_maker_checker_approval),
    notes: req.body.notes || '',
  });

  return reply.send({ success: true, data: result });
}

export async function raiseDispute(req, reply) {
  const dealId = parseInt(req.params.id, 10);
  const result = await b2bService.raiseB2bDispute(req.server.db, {
    dealId,
    raisedBy: req.user.id,
    reasonEn: req.body.reason_en || req.body.reasonEn,
    reasonBn: req.body.reason_bn || req.body.reasonBn,
    evidenceMedia: req.body.evidence_media || req.body.evidenceMedia || [],
  });

  return reply.send({ success: true, data: result });
}

export async function refundMilestone(req, reply) {
  const milestoneId = parseInt(req.params.id, 10);
  const result = await b2bService.refundMilestone(req.server.db, {
    milestoneId,
    actorId: req.user.id,
    reason: req.body.reason || '',
  });

  return reply.send({ success: true, data: result });
}

export async function cancelDeal(req, reply) {
  const dealId = parseInt(req.params.id, 10);
  const result = await b2bService.cancelDeal(req.server.db, {
    dealId,
    actorId: req.user.id,
    reason: req.body.reason || '',
  });

  return reply.send({ success: true, data: result });
}

export async function downloadContractPdf(req, reply) {
  const deal = await b2bService.getB2bDealById(req.server.db, req.params.id);

  const pdfBuffer = b2bService.generateContractPdf({
    deal,
    milestones: deal.milestones || [],
    buyer: { name: deal.buyer_name, phone: deal.buyer_phone },
    supplier: { name: deal.supplier_name, phone: deal.supplier_phone },
  });

  reply.header('Content-Type', 'application/pdf');
  reply.header('Content-Disposition', `attachment; filename="contract-${deal.ref}.pdf"`);
  return reply.send(pdfBuffer);
}
