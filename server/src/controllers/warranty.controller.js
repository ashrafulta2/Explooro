/**
 * warranty.controller.js — HTTP Controller for Digital Warranty & Claims Engine (Prompt 10.4).
 */

import * as warrantyService from '../services/warranty.service.js';

/**
 * Customer: Get list of active and expired warranty cards.
 */
export async function getMyWarrantyCards(req, reply) {
  const customerId = req.user.id;
  const status = req.query.status || 'all';
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;

  const result = await warrantyService.getCustomerWarrantyCards(req.server.db, customerId, {
    status,
    limit,
    offset,
  });

  return reply.send({
    data: result,
  });
}

/**
 * Customer / Supplier / Staff: Get single warranty card details.
 */
export async function getWarrantyCardById(req, reply) {
  const cardIdOrRef = req.params.id;
  const isStaff = ['admin', 'super_admin', 'moderator'].includes(req.user.role);
  const customerId = (req.user.role === 'customer') ? req.user.id : null;
  const supplierId = (req.user.role === 'supplier') ? req.user.id : null;

  const card = await warrantyService.getWarrantyCardById(req.server.db, cardIdOrRef, {
    customerId: isStaff ? null : customerId,
    supplierId: isStaff ? null : supplierId,
  });

  if (!card) {
    return reply.status(404).send({
      error: {
        code: 'WARRANTY_CARD_NOT_FOUND',
        message_en: `Warranty certificate #${cardIdOrRef} not found.`,
        message_bn: `ওয়ারেন্টি সার্টিফিকেট #${cardIdOrRef} পাওয়া যায়নি।`,
      },
    });
  }

  return reply.send({
    data: { card },
  });
}

/**
 * Customer: File a 1-click warranty claim.
 */
export async function submitClaim(req, reply) {
  const customerId = req.user.id;
  const cardId = parseInt(req.params.id, 10);
  const { issue_description, evidence_media, preferred_resolution } = req.body;

  const result = await warrantyService.submitWarrantyClaim(req.server.db, {
    customerId,
    warrantyCardId: cardId,
    issueDescription: issue_description,
    evidenceMedia: evidence_media || [],
    preferredResolution: preferred_resolution || 'REPAIR',
  });

  return reply.status(201).send({
    data: result,
  });
}

/**
 * Customer: Transfer warranty certificate to another registered user.
 */
export async function transferWarrantyCard(req, reply) {
  const customerId = req.user.id;
  const cardId = parseInt(req.params.id, 10);
  const { target_phone_or_email } = req.body;

  if (!target_phone_or_email) {
    return reply.status(400).send({
      error: {
        code: 'MISSING_RECIPIENT',
        message_en: 'Recipient phone number or email is required.',
        message_bn: 'প্রাপকের ফোন নম্বর বা ইমেইল প্রদান করুন।',
      },
    });
  }

  const result = await warrantyService.transferWarrantyCard(req.server.db, {
    cardId,
    currentCustomerId: customerId,
    targetPhoneOrEmail: target_phone_or_email,
  });

  return reply.send({
    data: result,
  });
}

/**
 * Supplier: View incoming claims queue with SLA tracking.
 */
export async function getSupplierClaims(req, reply) {
  const supplierId = req.user.id;
  const status = req.query.status || null;
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;

  const result = await warrantyService.getSupplierClaims(req.server.db, supplierId, {
    status,
    limit,
    offset,
  });

  return reply.send({
    data: result,
  });
}

/**
 * Supplier: Review a claim (Approve or Reject with explanation).
 */
export async function reviewSupplierClaim(req, reply) {
  const supplierId = req.user.id;
  const claimId = parseInt(req.params.id, 10);
  const { action, resolution, rejection_reason, supplier_notes } = req.body;

  const result = await warrantyService.reviewWarrantyClaim(req.server.db, {
    claimId,
    supplierId,
    action: action || 'APPROVE',
    resolution: resolution || 'REPAIR',
    rejectionReason: rejection_reason || '',
    supplierNotes: supplier_notes || '',
    isStaffOverride: false,
  });

  return reply.send({
    data: result,
  });
}

/**
 * Supplier: Update claim progress status (IN_PROGRESS, COMPLETED).
 */
export async function updateClaimProgress(req, reply) {
  const supplierId = req.user.id;
  const claimId = parseInt(req.params.id, 10);
  const { status, supplier_notes } = req.body;

  const result = await warrantyService.updateClaimProgress(req.server.db, {
    claimId,
    supplierId,
    status: status || 'IN_PROGRESS',
    supplierNotes: supplier_notes || '',
    isStaffOverride: false,
  });

  return reply.send({
    data: result,
  });
}

/**
 * Supplier / Admin: Get product claim rate analytics.
 */
export async function getProductClaimAnalytics(req, reply) {
  const isStaff = ['admin', 'super_admin', 'moderator'].includes(req.user.role);
  const supplierId = isStaff ? (req.query.supplier_id ? parseInt(req.query.supplier_id, 10) : null) : req.user.id;
  const productId = req.query.product_id ? parseInt(req.query.product_id, 10) : null;

  const result = await warrantyService.getProductClaimAnalytics(req.server.db, {
    supplierId,
    productId,
  });

  return reply.send({
    data: result,
  });
}

/**
 * Admin / Moderator: View escalated & all claims queue.
 */
export async function getAdminClaimsQueue(req, reply) {
  const status = req.query.status || null;
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;

  const claims = await warrantyService.getAdminClaimsQueue(req.server.db, {
    status,
    limit,
    offset,
  });

  return reply.send({
    data: {
      total: claims.length,
      claims,
    },
  });
}

/**
 * Admin / Super Admin: Override supplier claim decision.
 */
export async function overrideClaimDecision(req, reply) {
  const claimId = parseInt(req.params.id, 10);
  const { action, resolution, rejection_reason, notes } = req.body;

  const result = await warrantyService.reviewWarrantyClaim(req.server.db, {
    claimId,
    action: action || 'APPROVE',
    resolution: resolution || 'REPAIR',
    rejectionReason: rejection_reason || '',
    supplierNotes: notes || '',
    isStaffOverride: true,
    staffUserId: req.user.id,
  });

  return reply.send({
    data: result,
  });
}
