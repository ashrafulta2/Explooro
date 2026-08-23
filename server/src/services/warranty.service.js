/**
 * warranty.service.js — Digital Warranty & Claims Engine (Prompt 10.4 / Master Spec §AA).
 *
 * Implements:
 * 1. Digital warranty auto-issuance on order delivery with coverage terms & serial numbers.
 * 2. Real-time expiry countdown calculations and transferable warranty certificates.
 * 3. 1-click claim filing with evidence media attachments and 72-hour SLA tracking.
 * 4. Supplier claim review (Approve Repair/Replace/Refund, or Reject with reason).
 * 5. Automatic reverse courier consignment booking for physical returns on repair/replace approval.
 * 6. SLA breach auto-escalation to Admin & Moderator oversight queues.
 * 7. Product claim rate analytics feeding into supplier trust tier evaluations.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { getCourierAdapter } from '../integrations/courier/index.js';
import * as notificationService from './notification.service.js';
import * as clawbackService from './clawback.service.js';
import { writeAudit } from '../lib/audit.js';

export function generateWarrantyRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return `WAR-${code}`;
}

export function generateClaimRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return `CLM-${code}`;
}

/**
 * Auto-issues digital warranty cards for all eligible items in a delivered sub-order.
 */
export async function issueWarrantiesForSubOrder(db, { subOrderId, client = null } = {}) {
  const runner = async (txClient) => {
    // 1. Fetch sub-order, items, product warranty duration, and category transferability
    const { rows: items } = await txClient.query(
      `SELECT oi.id AS order_item_id, oi.product_id, oi.title_snapshot, oi.qty,
              so.supplier_id, so.ref AS sub_order_ref, o.customer_id, o.placed_at,
              p.warranty_months, p.brand, p.title_en, p.title_bn,
              c.is_warranty_transferable, c.name_en AS category_name_en
       FROM order_items oi
       JOIN sub_orders so ON so.id = oi.sub_order_id
       JOIN orders o ON o.id = so.order_id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE so.id = $1 AND p.warranty_months IS NOT NULL AND p.warranty_months > 0`,
      [subOrderId]
    );

    if (items.length === 0) {
      return { issuedCount: 0, cards: [] };
    }

    const issuedCards = [];

    for (const item of items) {
      // Check if warranty card already exists for this order item
      const { rows: existing } = await txClient.query(
        `SELECT id, ref FROM warranty_cards WHERE order_item_id = $1 LIMIT 1`,
        [item.order_item_id]
      );

      if (existing.length > 0) {
        issuedCards.push(existing[0]);
        continue;
      }

      const warrantyRef = generateWarrantyRef();
      const serialNumber = `SN-${item.sub_order_ref}-${item.order_item_id}-${Math.floor(1000 + Math.random() * 9000)}`;
      const coverageMonths = parseInt(item.warranty_months, 10);
      const isTransferable = Boolean(item.is_warranty_transferable);

      const coverageTermsEn = `Official manufacturer warranty for ${coverageMonths} month(s). Covers manufacturing defects, internal component failure, and certified repair. Does not cover physical damage, water ingress, or unauthorized modifications.`;
      const coverageTermsBn = `${coverageMonths} মাসের অফিশিয়াল ম্যানুফ্যাকচারার ওয়ারেন্টি। উৎপাদন ত্রুটি ও সার্টিফাইড মেরামতের নিশ্চয়তা। ফিজিক্যাল ড্যামেজ বা পানির ক্ষতি এর আওতাভুক্ত নয়।`;

      const { rows: newCardRows } = await txClient.query(
        `INSERT INTO warranty_cards (
           ref, order_item_id, customer_id, supplier_id, serial_number,
           coverage_terms_en, coverage_terms_bn, is_transferable,
           starts_at, expires_at, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now() + ($9 || ' months')::interval, now())
         RETURNING *`,
        [
          warrantyRef,
          item.order_item_id,
          item.customer_id,
          item.supplier_id,
          serialNumber,
          coverageTermsEn,
          coverageTermsBn,
          isTransferable,
          coverageMonths,
        ]
      );

      const card = newCardRows[0];
      issuedCards.push(card);

      // Dispatch in-app / push notification to customer
      try {
        await notificationService.notify(txClient, {
          userId: item.customer_id,
          templateKey: 'WARRANTY_ISSUED',
          data: {
            warrantyRef: card.ref,
            productTitle: item.title_snapshot || item.title_en || 'Product',
            expiresAt: new Date(card.expires_at).toLocaleDateString('en-GB'),
          },
          client: txClient,
        });
      } catch (err) {
        console.warn(`[WarrantyService] Notification failed: ${err.message}`);
      }

      // Write audit log
      await writeAudit(txClient, {
        actorId: null,
        actorRole: 'system',
        action: 'support.warranty.issue',
        targetType: 'warranty_card',
        targetRef: card.ref,
        afterJson: {
          card_id: card.id,
          order_item_id: item.order_item_id,
          customer_id: item.customer_id,
          supplier_id: item.supplier_id,
          expires_at: card.expires_at,
          is_transferable: isTransferable,
        },
        riskTier: 'LOW',
      }).catch(() => {});
    }

    return {
      issuedCount: issuedCards.length,
      cards: issuedCards,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Retrieves all digital warranty cards for a customer with computed live countdown status.
 */
export async function getCustomerWarrantyCards(db, customerId, { status = 'all', limit = 50, offset = 0 } = {}) {
  let statusClause = '';
  if (status === 'active') {
    statusClause = 'AND wc.expires_at > now()';
  } else if (status === 'expired') {
    statusClause = 'AND wc.expires_at <= now()';
  }

  const { rows } = await db.query(
    `SELECT wc.*,
            p.id AS product_id, p.title_en AS product_title_en, p.title_bn AS product_title_bn,
            p.brand, p.warranty_months,
            u.full_name AS supplier_name,
            s.business_name AS supplier_shop_name,
            so.ref AS sub_order_ref,
            (
              SELECT json_agg(json_build_object(
                'id', c.id,
                'ref', c.ref,
                'status', c.status,
                'resolution', c.resolution,
                'issue_description', c.issue_description,
                'sla_due_at', c.sla_due_at,
                'created_at', c.created_at
              ) ORDER BY c.created_at DESC)
              FROM warranty_claims c
              WHERE c.warranty_card_id = wc.id
            ) AS claims_json,
            COALESCE(
              (SELECT storage_key FROM media_assets WHERE id = (
                 SELECT media_id FROM product_media WHERE product_id = p.id ORDER BY position ASC LIMIT 1
               )),
              '/placeholder-product.svg'
            ) AS product_image
     FROM warranty_cards wc
     JOIN order_items oi ON oi.id = wc.order_item_id
     JOIN sub_orders so ON so.id = oi.sub_order_id
     JOIN products p ON p.id = oi.product_id
     JOIN users u ON u.id = wc.supplier_id
     LEFT JOIN stores s ON s.user_id = wc.supplier_id
     WHERE wc.customer_id = $1 ${statusClause}
     ORDER BY wc.expires_at DESC
     LIMIT $2 OFFSET $3`,
    [customerId, limit, offset]
  );

  const now = Date.now();

  const cards = rows.map((card) => {
    const expiresMs = new Date(card.expires_at).getTime();
    const startsMs = new Date(card.starts_at).getTime();
    const remainingMs = Math.max(0, expiresMs - now);
    const isActive = remainingMs > 0;

    const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
    const remainingHours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    const totalDurationMs = Math.max(1, expiresMs - startsMs);
    const elapsedMs = Math.min(totalDurationMs, now - startsMs);
    const progressPercent = Math.min(100, Math.max(0, Math.round((elapsedMs / totalDurationMs) * 100)));

    return {
      ...card,
      is_active: isActive,
      remaining_ms: remainingMs,
      remaining_days: remainingDays,
      remaining_hours: remainingHours,
      remaining_minutes: remainingMinutes,
      progress_percent: progressPercent,
      claims: card.claims_json || [],
    };
  });

  return {
    total: cards.length,
    cards,
  };
}

/**
 * Retrieves a single warranty card with full details.
 */
export async function getWarrantyCardById(db, cardIdOrRef, { customerId = null, supplierId = null } = {}) {
  const isNumeric = /^\d+$/.test(String(cardIdOrRef));
  const queryParam = isNumeric ? parseInt(cardIdOrRef, 10) : String(cardIdOrRef);
  const whereColumn = isNumeric ? 'wc.id' : 'wc.ref';

  let roleFilter = '';
  const params = [queryParam];

  if (customerId) {
    params.push(customerId);
    roleFilter += ` AND wc.customer_id = $${params.length}`;
  }
  if (supplierId) {
    params.push(supplierId);
    roleFilter += ` AND wc.supplier_id = $${params.length}`;
  }

  const { rows } = await db.query(
    `SELECT wc.*,
            p.id AS product_id, p.title_en AS product_title_en, p.title_bn AS product_title_bn,
            p.brand, p.warranty_months,
            u.full_name AS supplier_name, u.phone AS supplier_phone,
            cust.full_name AS customer_name, cust.phone AS customer_phone,
            s.business_name AS supplier_shop_name,
            so.ref AS sub_order_ref,
            (
              SELECT json_agg(c.* ORDER BY c.created_at DESC)
              FROM warranty_claims c
              WHERE c.warranty_card_id = wc.id
            ) AS claims_json
     FROM warranty_cards wc
     JOIN order_items oi ON oi.id = wc.order_item_id
     JOIN sub_orders so ON so.id = oi.sub_order_id
     JOIN products p ON p.id = oi.product_id
     JOIN users u ON u.id = wc.supplier_id
     JOIN users cust ON cust.id = wc.customer_id
     LEFT JOIN stores s ON s.user_id = wc.supplier_id
     WHERE ${whereColumn} = $1 ${roleFilter}
     LIMIT 1`,
    params
  );

  if (rows.length === 0) return null;

  const card = rows[0];
  const now = Date.now();
  const expiresMs = new Date(card.expires_at).getTime();
  const startsMs = new Date(card.starts_at).getTime();
  const remainingMs = Math.max(0, expiresMs - now);

  return {
    ...card,
    is_active: remainingMs > 0,
    remaining_days: Math.floor(remainingMs / (1000 * 60 * 60 * 24)),
    remaining_hours: Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    claims: card.claims_json || [],
  };
}

/**
 * Files a 1-click warranty repair/replace/refund claim with evidence attachments.
 */
export async function submitWarrantyClaim(db, {
  customerId,
  warrantyCardId,
  issueDescription,
  evidenceMedia = [],
  preferredResolution = 'REPAIR',
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Fetch & lock warranty card
    const { rows: cardRows } = await txClient.query(
      `SELECT wc.*, p.title_en, p.title_bn, p.id AS product_id
       FROM warranty_cards wc
       JOIN order_items oi ON oi.id = wc.order_item_id
       JOIN products p ON p.id = oi.product_id
       WHERE wc.id = $1
       FOR UPDATE`,
      [warrantyCardId]
    );

    if (cardRows.length === 0) {
      throw new Error(`WARRANTY_CARD_NOT_FOUND: Warranty card #${warrantyCardId} does not exist.`);
    }

    const card = cardRows[0];

    // Check customer ownership
    if (card.customer_id !== customerId) {
      throw new Error('UNAUTHORIZED_CLAIM: You can only file warranty claims for your own registered cards.');
    }

    // Check validity / expiration
    if (new Date(card.expires_at).getTime() <= Date.now()) {
      throw new Error('WARRANTY_EXPIRED: This warranty coverage has expired and cannot accept new claims.');
    }

    // Check for open pending claims
    const { rows: pendingClaims } = await txClient.query(
      `SELECT id, ref, status FROM warranty_claims
       WHERE warranty_card_id = $1 AND status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS')
       LIMIT 1`,
      [warrantyCardId]
    );

    if (pendingClaims.length > 0) {
      throw new Error(`CLAIM_ALREADY_OPEN: An active claim (#${pendingClaims[0].ref}) is already in progress for this card.`);
    }

    if (!issueDescription || issueDescription.trim().length < 10) {
      throw new Error('INVALID_DESCRIPTION: Please provide a clear description of the issue (minimum 10 characters).');
    }

    const claimRef = generateClaimRef();
    // 72-hour SLA deadline for supplier action
    const slaDueAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const { rows: claimRows } = await txClient.query(
      `INSERT INTO warranty_claims (
         ref, warranty_card_id, customer_id, issue_description,
         evidence_media_json, resolution, status, sla_due_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'SUBMITTED', $7, now(), now())
       RETURNING *`,
      [
        claimRef,
        card.id,
        customerId,
        issueDescription.trim(),
        JSON.stringify(Array.isArray(evidenceMedia) ? evidenceMedia : []),
        preferredResolution || 'REPAIR',
        slaDueAt.toISOString(),
      ]
    );

    const claim = claimRows[0];

    // Notify supplier about new incoming claim
    try {
      await notificationService.notify(txClient, {
        userId: card.supplier_id,
        templateKey: 'WARRANTY_CLAIM_SUBMITTED',
        data: {
          claimRef: claim.ref,
          productTitle: card.title_en || 'Product',
          slaDueAt: slaDueAt.toLocaleString('en-GB'),
        },
        client: txClient,
      });
    } catch (err) {
      console.warn(`[WarrantyService] Claim notification to supplier failed: ${err.message}`);
    }

    await writeAudit(txClient, {
      actorId: customerId,
      actorRole: 'customer',
      action: 'support.warranty.claim',
      targetType: 'warranty_claim',
      targetRef: claim.ref,
      afterJson: {
        claim_id: claim.id,
        warranty_card_id: card.id,
        preferred_resolution: preferredResolution,
        sla_due_at: slaDueAt,
      },
      riskTier: 'LOW',
    }).catch(() => {});

    return {
      success: true,
      claim,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Supplier / Admin reviews a submitted warranty claim.
 * Approves (Repair, Replace, Refund) or Rejects with required reason.
 * Auto-books reverse courier consignment for physical returns on Repair/Replace.
 */
export async function reviewWarrantyClaim(db, {
  claimId,
  supplierId = null,
  action = 'APPROVE',
  resolution = 'REPAIR',
  rejectionReason = '',
  supplierNotes = '',
  isStaffOverride = false,
  staffUserId = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Fetch claim and parent card details
    const { rows: claimRows } = await txClient.query(
      `SELECT c.*, wc.supplier_id, wc.customer_id, wc.serial_number, wc.ref AS card_ref,
              p.title_en, p.title_bn, p.id AS product_id,
              so.ref AS sub_order_ref, o.recipient_name, o.recipient_phone, o.delivery_address_json,
              oi.line_total, oi.retail_price, oi.sub_order_id
       FROM warranty_claims c
       JOIN warranty_cards wc ON wc.id = c.warranty_card_id
       JOIN order_items oi ON oi.id = wc.order_item_id
       JOIN sub_orders so ON so.id = oi.sub_order_id
       JOIN orders o ON o.id = so.order_id
       JOIN products p ON p.id = oi.product_id
       WHERE c.id = $1
       FOR UPDATE`,
      [claimId]
    );

    if (claimRows.length === 0) {
      throw new Error(`CLAIM_NOT_FOUND: Warranty claim #${claimId} does not exist.`);
    }

    const claim = claimRows[0];

    // Validate permission
    if (!isStaffOverride && supplierId && claim.supplier_id !== supplierId) {
      throw new Error('UNAUTHORIZED_REVIEW: You can only review claims filed against your products.');
    }

    const decidBy = isStaffOverride ? staffUserId : (supplierId || claim.supplier_id);

    // 2. Reject flow
    if (action === 'REJECT') {
      if (!rejectionReason || rejectionReason.trim().length < 5) {
        throw new Error('REJECTION_REASON_REQUIRED: A valid explanation is mandatory when rejecting a claim.');
      }

      await txClient.query(
        `UPDATE warranty_claims
         SET status = 'REJECTED',
             resolution = 'REJECTED',
             rejection_reason = $2,
             supplier_notes = $3,
             decided_by = $4,
             decided_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [claimId, rejectionReason.trim(), supplierNotes || null, decidBy]
      );

      // Notify customer
      try {
        await notificationService.notify(txClient, {
          userId: claim.customer_id,
          templateKey: 'WARRANTY_CLAIM_DECIDED',
          data: {
            claimRef: claim.ref,
            status: 'REJECTED',
            resolution: 'REJECTED',
          },
          client: txClient,
        });
      } catch {}

      await writeAudit(txClient, {
        actorId: decidBy,
        actorRole: isStaffOverride ? 'admin' : 'supplier',
        action: isStaffOverride ? 'support.warranty.override' : 'support.warranty.manage',
        targetType: 'warranty_claim',
        targetRef: claim.ref,
        afterJson: { status: 'REJECTED', reason: rejectionReason },
        riskTier: isStaffOverride ? 'HIGH' : 'LOW',
      }).catch(() => {});

      return {
        success: true,
        status: 'REJECTED',
        claimId,
        resolution: 'REJECTED',
      };
    }

    // 3. Approve Flow (REPAIR | REPLACE | REFUND)
    const finalResolution = ['REPAIR', 'REPLACE', 'REFUND'].includes(resolution) ? resolution : 'REPAIR';
    let reverseShipmentId = null;

    // For physical inspection (Repair / Replace), book reverse consignment with 3PL courier
    if (finalResolution === 'REPAIR' || finalResolution === 'REPLACE') {
      try {
        const courierAdapter = getCourierAdapter(process.env.COURIER_DRIVER || 'MOCK');
        const address = typeof claim.delivery_address_json === 'string'
          ? JSON.parse(claim.delivery_address_json)
          : claim.delivery_address_json || {};

        const consignment = await courierAdapter.createConsignment({
          subOrderRef: `REV-${claim.ref}`,
          recipientName: claim.recipient_name || 'Customer',
          recipientPhone: claim.recipient_phone || '+8801700000000',
          deliveryAddress: address,
          codAmount: 0,
          weightKg: 0.5,
        });

        // Insert into shipments table
        const { rows: shipRows } = await txClient.query(
          `INSERT INTO shipments (
             sub_order_id, carrier, tracking_number, courier_consignment_id, status, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, 'BOOKED', now(), now())
           RETURNING id`,
          [
            claim.sub_order_id,
            courierAdapter.name,
            consignment.trackingNumber || `REV-${claim.ref}`,
            consignment.consignmentId || `CNG-${claim.ref}`,
          ]
        );

        if (shipRows.length > 0) {
          reverseShipmentId = shipRows[0].id;
        }
      } catch (err) {
        console.warn(`[WarrantyService] Reverse shipment booking notice: ${err.message}`);
      }
    }

    // If Refund resolution, execute wallet refund / clawback
    if (finalResolution === 'REFUND') {
      try {
        await clawbackService.executeClawback(txClient, {
          subOrderId: claim.sub_order_id,
          reason: `Warranty claim #${claim.ref} approved for replacement refund`,
          refundCustomer: true,
          client: txClient,
        });
      } catch (err) {
        console.warn(`[WarrantyService] Refund clawback notice: ${err.message}`);
      }
    }

    await txClient.query(
      `UPDATE warranty_claims
       SET status = 'APPROVED',
           resolution = $2,
           reverse_shipment_id = $3,
           supplier_notes = $4,
           decided_by = $5,
           decided_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [claimId, finalResolution, reverseShipmentId, supplierNotes || null, decidBy]
    );

    // Notify customer
    try {
      await notificationService.notify(txClient, {
        userId: claim.customer_id,
        templateKey: 'WARRANTY_CLAIM_DECIDED',
        data: {
          claimRef: claim.ref,
          status: 'APPROVED',
          resolution: finalResolution,
        },
        client: txClient,
      });
    } catch {}

    await writeAudit(txClient, {
      actorId: decidBy,
      actorRole: isStaffOverride ? 'admin' : 'supplier',
      action: isStaffOverride ? 'support.warranty.override' : 'support.warranty.manage',
      targetType: 'warranty_claim',
      targetRef: claim.ref,
      afterJson: {
        status: 'APPROVED',
        resolution: finalResolution,
        reverse_shipment_id: reverseShipmentId,
      },
      riskTier: isStaffOverride ? 'HIGH' : 'LOW',
    }).catch(() => {});

    return {
      success: true,
      status: 'APPROVED',
      resolution: finalResolution,
      reverseShipmentId,
      claimId,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Updates progress on an active claim (IN_PROGRESS, COMPLETED).
 */
export async function updateClaimProgress(db, {
  claimId,
  supplierId = null,
  status = 'IN_PROGRESS',
  supplierNotes = '',
  isStaffOverride = false,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    const { rows } = await txClient.query(
      `SELECT c.*, wc.supplier_id, wc.customer_id
       FROM warranty_claims c
       JOIN warranty_cards wc ON wc.id = c.warranty_card_id
       WHERE c.id = $1
       FOR UPDATE`,
      [claimId]
    );

    if (rows.length === 0) {
      throw new Error(`CLAIM_NOT_FOUND: Claim #${claimId} not found.`);
    }

    const claim = rows[0];

    if (!isStaffOverride && supplierId && claim.supplier_id !== supplierId) {
      throw new Error('UNAUTHORIZED_ACTION: You cannot update progress for this claim.');
    }

    if (!['IN_PROGRESS', 'COMPLETED'].includes(status)) {
      throw new Error(`INVALID_STATUS: Status transition to ${status} not allowed here.`);
    }

    await txClient.query(
      `UPDATE warranty_claims
       SET status = $2,
           supplier_notes = COALESCE($3, supplier_notes),
           updated_at = now()
       WHERE id = $1`,
      [claimId, status, supplierNotes || null]
    );

    if (status === 'COMPLETED') {
      try {
        await notificationService.notify(txClient, {
          userId: claim.customer_id,
          templateKey: 'WARRANTY_CLAIM_DECIDED',
          data: {
            claimRef: claim.ref,
            status: 'COMPLETED',
            resolution: claim.resolution || 'RESOLVED',
          },
          client: txClient,
        });
      } catch {}
    }

    return {
      success: true,
      claimId,
      status,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Transfers warranty ownership to another customer if product category permits.
 */
export async function transferWarrantyCard(db, {
  cardId,
  currentCustomerId,
  targetPhoneOrEmail,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Fetch warranty card
    const { rows: cardRows } = await txClient.query(
      `SELECT wc.*, p.title_en
       FROM warranty_cards wc
       JOIN order_items oi ON oi.id = wc.order_item_id
       JOIN products p ON p.id = oi.product_id
       WHERE wc.id = $1
       FOR UPDATE`,
      [cardId]
    );

    if (cardRows.length === 0) {
      throw new Error(`CARD_NOT_FOUND: Warranty card #${cardId} not found.`);
    }

    const card = cardRows[0];

    if (card.customer_id !== currentCustomerId) {
      throw new Error('UNAUTHORIZED_TRANSFER: You can only transfer cards registered in your name.');
    }

    if (!card.is_transferable) {
      throw new Error('NOT_TRANSFERABLE: This product category does not permit secondary warranty transfers.');
    }

    if (new Date(card.expires_at).getTime() <= Date.now()) {
      throw new Error('EXPIRED_WARRANTY: Expired warranty cards cannot be transferred.');
    }

    // 2. Find target user
    const targetIdentifier = targetPhoneOrEmail.trim();
    const { rows: targetUsers } = await txClient.query(
      `SELECT id, full_name, email, phone FROM users
       WHERE (phone = $1 OR email ILIKE $1) AND status = 'ACTIVE'
       LIMIT 1`,
      [targetIdentifier]
    );

    if (targetUsers.length === 0) {
      throw new Error(`RECIPIENT_NOT_FOUND: No active Explooro user found with phone or email '${targetIdentifier}'.`);
    }

    const targetUser = targetUsers[0];

    if (targetUser.id === currentCustomerId) {
      throw new Error('INVALID_RECIPIENT: You cannot transfer a warranty card to yourself.');
    }

    // 3. Update warranty card owner
    await txClient.query(
      `UPDATE warranty_cards
       SET customer_id = $2
       WHERE id = $1`,
      [cardId, targetUser.id]
    );

    // Notify recipient
    try {
      await notificationService.notify(txClient, {
        userId: targetUser.id,
        templateKey: 'WARRANTY_ISSUED',
        data: {
          warrantyRef: card.ref,
          productTitle: card.title_en || 'Product (Transferred)',
          expiresAt: new Date(card.expires_at).toLocaleDateString('en-GB'),
        },
        client: txClient,
      });
    } catch {}

    await writeAudit(txClient, {
      actorId: currentCustomerId,
      actorRole: 'customer',
      action: 'support.warranty.transfer',
      targetType: 'warranty_card',
      targetRef: card.ref,
      beforeJson: { customer_id: currentCustomerId },
      afterJson: { customer_id: targetUser.id, recipient: targetUser.full_name },
      reason: 'Customer initiated digital warranty transfer',
      riskTier: 'LOW',
    }).catch(() => {});

    return {
      success: true,
      cardId,
      transferredTo: {
        id: targetUser.id,
        name: targetUser.full_name,
        phone: targetUser.phone,
      },
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Checks for overdue claims and escalates them to Admin on SLA breach.
 */
export async function checkAndEscalateBreachedSla(db) {
  const { rows: overdue } = await db.query(
    `SELECT c.id, c.ref, c.warranty_card_id, wc.supplier_id, wc.customer_id
     FROM warranty_claims c
     JOIN warranty_cards wc ON wc.id = c.warranty_card_id
     WHERE c.status IN ('SUBMITTED', 'UNDER_REVIEW')
       AND c.sla_due_at IS NOT NULL
       AND c.sla_due_at < now()`
  );

  if (overdue.length === 0) return { escalatedCount: 0 };

  for (const item of overdue) {
    await db.query(
      `UPDATE warranty_claims
       SET status = 'ESCALATED', updated_at = now()
       WHERE id = $1`,
      [item.id]
    );

    // Notify admins / moderators
    const { rows: adminUsers } = await db.query(
      `SELECT id FROM users WHERE role IN ('admin', 'super_admin', 'moderator') LIMIT 3`
    );

    for (const admin of adminUsers) {
      try {
        await notificationService.notify(db, {
          userId: admin.id,
          templateKey: 'WARRANTY_CLAIM_ESCALATED',
          data: {
            claimRef: item.ref,
          },
        });
      } catch {}
    }
  }

  return {
    escalatedCount: overdue.length,
    claims: overdue,
  };
}

/**
 * Supplier & Admin Claim Analytics:
 * Computes claim rate per product (claims / total delivered warranties * 100).
 * High claim rates serve as an early quality signal.
 */
export async function getProductClaimAnalytics(db, { supplierId = null, productId = null } = {}) {
  let filterClause = '';
  const params = [];

  if (supplierId) {
    params.push(supplierId);
    filterClause += ` AND p.supplier_id = $${params.length}`;
  }

  if (productId) {
    params.push(productId);
    filterClause += ` AND p.id = $${params.length}`;
  }

  const { rows } = await db.query(
    `SELECT p.id AS product_id,
            p.title_en, p.title_bn, p.brand, p.warranty_months,
            p.supplier_id, u.full_name AS supplier_name,
            COUNT(DISTINCT wc.id) AS total_warranties_issued,
            COUNT(DISTINCT c.id) AS total_claims_count,
            COUNT(DISTINCT CASE WHEN c.status = 'APPROVED' THEN c.id END) AS approved_claims_count,
            COUNT(DISTINCT CASE WHEN c.status = 'REJECTED' THEN c.id END) AS rejected_claims_count,
            COUNT(DISTINCT CASE WHEN c.status IN ('SUBMITTED','UNDER_REVIEW','ESCALATED') THEN c.id END) AS active_claims_count
     FROM products p
     JOIN users u ON u.id = p.supplier_id
     LEFT JOIN order_items oi ON oi.product_id = p.id
     LEFT JOIN warranty_cards wc ON wc.order_item_id = oi.id
     LEFT JOIN warranty_claims c ON c.warranty_card_id = wc.id
     WHERE p.warranty_months IS NOT NULL AND p.warranty_months > 0 ${filterClause}
     GROUP BY p.id, p.title_en, p.title_bn, p.brand, p.warranty_months, p.supplier_id, u.full_name
     ORDER BY total_claims_count DESC, total_warranties_issued DESC`,
    params
  );

  const analytics = rows.map((row) => {
    const totalIssued = parseInt(row.total_warranties_issued, 10) || 0;
    const totalClaims = parseInt(row.total_claims_count, 10) || 0;
    const claimRatePct = totalIssued > 0 ? parseFloat(((totalClaims / totalIssued) * 100).toFixed(2)) : 0.0;

    let qualitySignal = 'NORMAL';
    if (claimRatePct > 7.0 && totalClaims >= 3) {
      qualitySignal = 'HIGH_RISK';
    } else if (claimRatePct > 3.0 && totalClaims >= 2) {
      qualitySignal = 'ELEVATED';
    }

    return {
      product_id: row.product_id,
      title_en: row.title_en,
      title_bn: row.title_bn,
      brand: row.brand,
      warranty_months: row.warranty_months,
      supplier_id: row.supplier_id,
      supplier_name: row.supplier_name,
      total_warranties_issued: totalIssued,
      total_claims_count: totalClaims,
      approved_claims_count: parseInt(row.approved_claims_count, 10) || 0,
      rejected_claims_count: parseInt(row.rejected_claims_count, 10) || 0,
      active_claims_count: parseInt(row.active_claims_count, 10) || 0,
      claim_rate_pct: claimRatePct,
      quality_signal: qualitySignal,
    };
  });

  return {
    totalProducts: analytics.length,
    products: analytics,
  };
}

/**
 * Supplier claims list with SLA countdown and details.
 */
export async function getSupplierClaims(db, supplierId, { status = null, limit = 50, offset = 0 } = {}) {
  let statusClause = '';
  const params = [supplierId, limit, offset];

  if (status && status !== 'all') {
    params.push(status.toUpperCase());
    statusClause = ` AND c.status = $4`;
  }

  const { rows } = await db.query(
    `SELECT c.*,
            wc.ref AS warranty_card_ref, wc.serial_number, wc.expires_at AS warranty_expires_at,
            p.id AS product_id, p.title_en AS product_title_en, p.title_bn AS product_title_bn,
            u.full_name AS customer_name, u.phone AS customer_phone,
            so.ref AS sub_order_ref,
            sh.tracking_number AS reverse_tracking_number, sh.carrier AS reverse_carrier
     FROM warranty_claims c
     JOIN warranty_cards wc ON wc.id = c.warranty_card_id
     JOIN order_items oi ON oi.id = wc.order_item_id
     JOIN sub_orders so ON so.id = oi.sub_order_id
     JOIN products p ON p.id = oi.product_id
     JOIN users u ON u.id = c.customer_id
     LEFT JOIN shipments sh ON sh.id = c.reverse_shipment_id
     WHERE wc.supplier_id = $1 ${statusClause}
     ORDER BY c.created_at DESC
     LIMIT $2 OFFSET $3`,
    params
  );

  const now = Date.now();

  const claims = rows.map((claim) => {
    const slaDueMs = claim.sla_due_at ? new Date(claim.sla_due_at).getTime() : null;
    const slaRemainingMs = slaDueMs ? Math.max(0, slaDueMs - now) : null;
    const isSlaBreached = slaDueMs ? slaDueMs < now && ['SUBMITTED', 'UNDER_REVIEW'].includes(claim.status) : false;

    return {
      ...claim,
      sla_remaining_hours: slaRemainingMs !== null ? Math.floor(slaRemainingMs / (1000 * 60 * 60)) : null,
      is_sla_breached: isSlaBreached,
      evidence_media: typeof claim.evidence_media_json === 'string'
        ? JSON.parse(claim.evidence_media_json)
        : claim.evidence_media_json || [],
    };
  });

  return {
    total: claims.length,
    claims,
  };
}

/**
 * Admin / Moderator claims queue for oversight & escalations.
 */
export async function getAdminClaimsQueue(db, { status = null, limit = 50, offset = 0 } = {}) {
  let statusClause = '';
  const params = [limit, offset];

  if (status && status !== 'all') {
    params.push(status.toUpperCase());
    statusClause = ` WHERE c.status = $3`;
  }

  const { rows } = await db.query(
    `SELECT c.*,
            wc.ref AS warranty_card_ref, wc.serial_number,
            p.id AS product_id, p.title_en AS product_title_en,
            cust.full_name AS customer_name,
            supp.full_name AS supplier_name,
            so.ref AS sub_order_ref
     FROM warranty_claims c
     JOIN warranty_cards wc ON wc.id = c.warranty_card_id
     JOIN order_items oi ON oi.id = wc.order_item_id
     JOIN sub_orders so ON so.id = oi.sub_order_id
     JOIN products p ON p.id = oi.product_id
     JOIN users cust ON cust.id = c.customer_id
     JOIN users supp ON supp.id = wc.supplier_id
     ${statusClause}
     ORDER BY
       CASE WHEN c.status = 'ESCALATED' THEN 1 WHEN c.status = 'SUBMITTED' THEN 2 ELSE 3 END ASC,
       c.created_at DESC
     LIMIT $1 OFFSET $2`,
    params
  );

  return rows;
}
