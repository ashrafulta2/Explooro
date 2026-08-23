/**
 * return.service.js — Return & Refund Engine (DFD Subsystem 9.0 / Prompt 7.2).
 *
 * Implements:
 * 1. Customer-initiated return request with dynamic return-window enforcement (module settings)
 * 2. Mandatory evidence validation for damaged/wrong item categories
 * 3. Abuse controls & trust score penalty / automatic activity restrictions
 * 4. Reverse consignment booking via 3PL courier adapters
 * 5. Full state machine: REQUESTED -> UNDER_REVIEW -> APPROVED | REJECTED -> PICKUP_SCHEDULED -> RECEIVED -> INSPECTED -> REFUNDED | DISPUTED
 * 6. Refund execution through double-entry ledger & clawback automation (including post-release deficit recovery)
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { getCourierAdapter } from '../integrations/courier/index.js';
import * as clawbackService from './clawback.service.js';
import * as moduleRepo from '../repositories/module.repository.js';
import { writeAudit } from '../lib/audit.js';

/**
 * Generates a public unique return reference code.
 */
function generateReturnRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `RET-${code}`;
}

async function getReturnWindowDays(db, cache) {
  try {
    if (moduleRepo && typeof moduleRepo.getModuleByKey === 'function') {
      const mod = await moduleRepo.getModuleByKey(db, 'returns_engine');
      if (mod?.sub_settings_json?.return_window_days) {
        return parseInt(mod.sub_settings_json.return_window_days, 10) || 7;
      }
    }
  } catch {}
  return 7;
}

/**
 * Submits a new customer return request.
 */
export async function createReturnRequest(db, cache, {
  customerId,
  subOrderId,
  items = [],
  reasonCode,
  customerNote = '',
  evidenceUrls = [],
  preferredResolution = 'WALLET_REFUND',
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Fetch sub-order, order, and delivery timestamp
    const { rows: subRows } = await txClient.query(
      `SELECT s.id, s.order_id, s.ref, s.supplier_id, s.saler_id, s.total_amount, s.status,
              s.shipping_amount, o.customer_id, s.delivered_at, o.payment_method
       FROM sub_orders s
       JOIN orders o ON o.id = s.order_id
       WHERE s.id = $1
       FOR UPDATE`,
      [subOrderId]
    );

    if (subRows.length === 0) {
      throw new Error(`SUB_ORDER_NOT_FOUND: Sub-order #${subOrderId} does not exist.`);
    }

    const subOrder = subRows[0];

    // Customer ownership validation
    if (subOrder.customer_id !== customerId) {
      throw new Error('UNAUTHORIZED_RETURN: You can only request returns for your own delivered orders.');
    }

    // Status check
    if (subOrder.status !== 'DELIVERED') {
      throw new Error(`SUB_ORDER_NOT_DELIVERED: Returns can only be requested for delivered orders. Current status: ${subOrder.status}`);
    }

    // 2. Dynamic Return Window Enforcement (from module settings)
    const windowDays = await getReturnWindowDays(txClient, cache);

    if (subOrder.delivered_at) {
      const deliveredTime = new Date(subOrder.delivered_at).getTime();
      const elapsedMs = Date.now() - deliveredTime;
      const maxMs = windowDays * 24 * 60 * 60 * 1000;
      if (elapsedMs > maxMs) {
        throw new Error(`RETURN_WINDOW_EXPIRED: Return policy allows requests within ${windowDays} days of delivery.`);
      }
    }

    // 3. Mandatory Evidence Validation
    const evidenceRequiredReasons = ['DAMAGED', 'WRONG_ITEM', 'DEFECTIVE'];
    if (evidenceRequiredReasons.includes(reasonCode) && (!Array.isArray(evidenceUrls) || evidenceUrls.length === 0)) {
      throw new Error(`EVIDENCE_REQUIRED: Photo or video evidence is mandatory for ${reasonCode} return requests.`);
    }

    // 4. Fetch Order Items for unit price validation & refund total calculation
    const { rows: orderItemRows } = await txClient.query(
      `SELECT id, product_id, quantity, unit_price FROM order_items WHERE sub_order_id = $1`,
      [subOrderId]
    );

    let calculatedRefund = 0;
    const validatedItems = [];

    for (const reqItem of items) {
      const matched = orderItemRows.find((oi) => oi.id === reqItem.order_item_id || oi.product_id === reqItem.product_id);
      if (!matched) {
        throw new Error(`INVALID_RETURN_ITEM: Item #${reqItem.order_item_id || reqItem.product_id} does not belong to sub-order #${subOrderId}.`);
      }
      const qty = Math.min(reqItem.quantity || 1, matched.quantity);
      const unitPrice = parseFloat(matched.unit_price);
      calculatedRefund += qty * unitPrice;

      validatedItems.push({
        order_item_id: matched.id,
        product_id: matched.product_id,
        quantity: qty,
        unit_price: unitPrice.toFixed(2),
        item_reason_notes: reqItem.item_reason_notes || '',
      });
    }

    if (validatedItems.length === 0) {
      // Return all items if none specified
      for (const matched of orderItemRows) {
        const qty = matched.quantity;
        const unitPrice = parseFloat(matched.unit_price);
        calculatedRefund += qty * unitPrice;
        validatedItems.push({
          order_item_id: matched.id,
          product_id: matched.product_id,
          quantity: qty,
          unit_price: unitPrice.toFixed(2),
          item_reason_notes: customerNote,
        });
      }
    }

    // 5. Abuse Controls & Customer Trust Score Inspection
    const { rows: trustRows } = await txClient.query(
      `SELECT user_id, score, tier, completed_orders, return_rate FROM trust_scores WHERE user_id = $1`,
      [customerId]
    );

    let isAutoApproved = false;
    let initialStatus = 'REQUESTED';

    if (trustRows.length > 0) {
      const trust = trustRows[0];
      const completed = trust.completed_orders || 1;
      const currentReturns = Math.round(((trust.return_rate || 0) / 100) * completed);
      const newReturnCount = currentReturns + 1;
      const newReturnRate = (newReturnCount / completed) * 100;

      // Update trust scores
      await txClient.query(
        `UPDATE trust_scores
         SET return_rate = $2,
             score = GREATEST(0, score - 5),
             updated_at = now()
         WHERE user_id = $1`,
        [customerId, newReturnRate.toFixed(2)]
      );

      // Excessive Returns Abuse Trigger (> 30% return rate on at least 3 orders)
      if (newReturnRate > 30 && completed >= 3) {
        // Enforce restriction via activity control
        await txClient.query(
          `INSERT INTO user_restrictions (
             user_id, scope, target_id, capability, mode, reason_en, reason_bn, created_by
           )
           VALUES ($1, 'USER', $1, 'can_return', 'BLOCK',
                   'Automated restriction: Return rate exceeded 30% threshold.',
                   'স্বয়ংক্রিয় সীমাবদ্ধতা: রিটার্নের হার ৩০% এর সীমা অতিক্রম করেছে।', 1)
           ON CONFLICT DO NOTHING`,
          [customerId]
        );
      }

      // Auto-approval evaluation for trusted customers
      if (trust.score >= 80 && (reasonCode === 'DAMAGED' || reasonCode === 'DEFECTIVE')) {
        isAutoApproved = true;
        initialStatus = 'APPROVED';
      }
    }

    const returnRef = generateReturnRef();

    // 6. Insert Return Request
    const { rows: retRows } = await txClient.query(
      `INSERT INTO return_requests (
         ref, sub_order_id, customer_id, reason_code, customer_note,
         status, evidence_urls_json, preferred_resolution, refund_amount
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric(14,2))
       RETURNING *`,
      [
        returnRef,
        subOrderId,
        customerId,
        reasonCode,
        customerNote,
        initialStatus,
        JSON.stringify(evidenceUrls || []),
        preferredResolution,
        calculatedRefund.toFixed(2),
      ]
    );

    const returnReq = retRows[0];

    // 7. Insert Return Items
    for (const item of validatedItems) {
      await txClient.query(
        `INSERT INTO return_items (
           return_request_id, order_item_id, product_id, quantity, unit_price, item_reason_notes
         )
         VALUES ($1, $2, $3, $4, $5::numeric(14,2), $6)`,
        [
          returnReq.id,
          item.order_item_id,
          item.product_id,
          item.quantity,
          item.unit_price,
          item.item_reason_notes,
        ]
      );
    }

    await writeAudit(txClient, {
      actorId: customerId,
      actorRole: 'customer',
      action: 'returns.request.create',
      targetType: 'return_request',
      targetRef: returnReq.ref,
      afterJson: { sub_order_id: subOrderId, refund_amount: calculatedRefund, status: initialStatus },
      riskTier: 'LOW',
    }).catch(() => {});

    return {
      success: true,
      returnRequest: returnReq,
      isAutoApproved,
      status: initialStatus,
      refundAmount: calculatedRefund.toFixed(2),
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Reviews a return request (Approve or Reject).
 */
export async function reviewReturnRequest(db, cache, {
  returnRequestId,
  action = 'APPROVE',
  rejectionReason = '',
  reviewedBy = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    const { rows: retRows } = await txClient.query(
      `SELECT r.*, s.ref AS sub_order_ref, s.supplier_id, o.recipient_name, o.recipient_phone, o.delivery_address_json
       FROM return_requests r
       JOIN sub_orders s ON s.id = r.sub_order_id
       JOIN orders o ON o.id = s.order_id
       WHERE r.id = $1
       FOR UPDATE`,
      [returnRequestId]
    );

    if (retRows.length === 0) {
      throw new Error(`RETURN_NOT_FOUND: Return request #${returnRequestId} does not exist.`);
    }

    const returnReq = retRows[0];

    if (action === 'REJECT') {
      await txClient.query(
        `UPDATE return_requests
         SET status = 'REJECTED', rejection_reason = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now()
         WHERE id = $1`,
        [returnRequestId, rejectionReason || 'Return request criteria not met', reviewedBy]
      );

      return { success: true, status: 'REJECTED', returnRequestId };
    }

    // APPROVE -> Book reverse courier consignment & set status to PICKUP_SCHEDULED
    const courierAdapter = getCourierAdapter(process.env.COURIER_DRIVER || 'MOCK');
    const reverseConsignment = await courierAdapter.createConsignment({
      subOrderRef: `REV-${returnReq.sub_order_ref}`,
      recipientName: 'Explooro Returns Warehouse',
      recipientPhone: '+8801700000000',
      deliveryAddress: { street: 'Tejgaon Industrial Area', district: 'Dhaka', division: 'Dhaka' },
      codAmount: 0.00,
    });

    const reverseTracking = reverseConsignment.trackingNumber || `REV-${Date.now()}`;

    await txClient.query(
      `UPDATE return_requests
       SET status = 'PICKUP_SCHEDULED',
           reverse_tracking_number = $2,
           reverse_carrier = $3,
           reviewed_by = $4,
           reviewed_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [returnRequestId, reverseTracking, courierAdapter.name, reviewedBy]
    );

    return {
      success: true,
      status: 'PICKUP_SCHEDULED',
      reverseTrackingNumber: reverseTracking,
      carrier: courierAdapter.name,
      returnRequestId,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Records physical arrival and warehouse condition inspection of the returned parcel.
 */
export async function receiveAndInspectReturn(db, {
  returnRequestId,
  inspectionNotes = 'Items verified in good condition',
  conditionPass = true,
  inspectedBy = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    const nextStatus = conditionPass ? 'INSPECTED' : 'DISPUTED';

    const { rows } = await txClient.query(
      `UPDATE return_requests
       SET status = $2,
           inspection_notes = $3,
           received_at = COALESCE(received_at, now()),
           inspected_at = now(),
           reviewed_by = COALESCE(reviewed_by, $4),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [returnRequestId, nextStatus, inspectionNotes, inspectedBy]
    );

    if (rows.length === 0) {
      throw new Error(`RETURN_NOT_FOUND: Return request #${returnRequestId} does not exist.`);
    }

    return {
      success: true,
      status: nextStatus,
      conditionPass,
      returnRequest: rows[0],
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Executes customer refund and triggers seller escrow clawback / stock restoration.
 */
export async function executeRefund(db, cache, {
  returnRequestId,
  approvedBy = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Fetch return request
    const { rows: retRows } = await txClient.query(
      `SELECT r.*, s.id AS sub_order_id, s.ref AS sub_order_ref, s.status AS sub_order_status
       FROM return_requests r
       JOIN sub_orders s ON s.id = r.sub_order_id
       WHERE r.id = $1
       FOR UPDATE`,
      [returnRequestId]
    );

    if (retRows.length === 0) {
      throw new Error(`RETURN_NOT_FOUND: Return request #${returnRequestId} does not exist.`);
    }

    const returnReq = retRows[0];

    if (returnReq.status === 'REFUNDED') {
      return { success: true, alreadyRefunded: true, status: 'REFUNDED', returnRequestId };
    }

    // 2. Trigger Clawback Engine from Prompt 6.2 (atomic ledger reversals, deficit recovery, customer wallet credit)
    const clawbackResult = await clawbackService.processReturnClawback(txClient, {
      subOrderId: returnReq.sub_order_id,
      returnRequestId: returnReq.id,
      reason: `Return #${returnReq.ref} approved and inspected`,
      refundCustomer: true,
      approvedBy,
      cache,
      client: txClient,
    });

    // 3. Restore warehouse stock for returned items
    const { rows: items } = await txClient.query(
      `SELECT product_id, quantity FROM return_items WHERE return_request_id = $1`,
      [returnRequestId]
    );

    for (const item of items) {
      await txClient.query(
        `UPDATE products
         SET stock_quantity = stock_quantity + $2, updated_at = now()
         WHERE id = $1`,
        [item.product_id, item.quantity]
      );
    }

    // 4. Update return request status
    await txClient.query(
      `UPDATE return_requests
       SET status = 'REFUNDED', refunded_at = now(), updated_at = now()
       WHERE id = $1`,
      [returnRequestId]
    );

    return {
      success: true,
      status: 'REFUNDED',
      refundAmount: returnReq.refund_amount,
      clawbackResult,
      returnRequestId,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Retrieves details of a return request.
 */
export async function getReturnDetails(db, returnRequestIdOrRef, { customerId = null, client = null } = {}) {
  const runner = client ?? db;

  let query = `
    SELECT r.*, s.ref AS sub_order_ref, s.total_amount AS sub_order_total, s.status AS sub_order_status,
           u.full_name AS customer_name, u.phone AS customer_phone
    FROM return_requests r
    JOIN sub_orders s ON s.id = r.sub_order_id
    JOIN users u ON u.id = r.customer_id
    WHERE (r.id = $1 OR r.ref = $2)
  `;
  const params = [parseInt(returnRequestIdOrRef, 10) || 0, String(returnRequestIdOrRef)];

  if (customerId) {
    query += ` AND r.customer_id = $3`;
    params.push(customerId);
  }

  const { rows: retRows } = await runner.query(query, params);
  if (retRows.length === 0) return null;

  const returnReq = retRows[0];

  const { rows: itemRows } = await runner.query(
    `SELECT ri.*, p.title AS product_title, p.primary_image_url
     FROM return_items ri
     JOIN products p ON p.id = ri.product_id
     WHERE ri.return_request_id = $1`,
    [returnReq.id]
  );

  return {
    ...returnReq,
    items: itemRows,
    evidence_urls: typeof returnReq.evidence_urls_json === 'string'
      ? JSON.parse(returnReq.evidence_urls_json)
      : (returnReq.evidence_urls_json || []),
  };
}

/**
 * Retrieves admin returns moderation queue.
 */
export async function getAdminReturnsQueue(db, { status = null, limit = 50, offset = 0, client = null } = {}) {
  const runner = client ?? db;

  let query = `
    SELECT r.*, s.ref AS sub_order_ref, s.total_amount AS sub_order_total,
           u.full_name AS customer_name, u.phone AS customer_phone,
           ts.score AS customer_trust_score, ts.tier AS customer_trust_tier, ts.return_rate AS customer_return_rate
    FROM return_requests r
    JOIN sub_orders s ON s.id = r.sub_order_id
    JOIN users u ON u.id = r.customer_id
    LEFT JOIN trust_scores ts ON ts.user_id = r.customer_id
  `;
  const params = [];

  if (status && status !== 'ALL') {
    query += ` WHERE r.status = $1`;
    params.push(status);
  }

  query += ` ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const { rows } = await runner.query(query, params);
  return rows;
}
