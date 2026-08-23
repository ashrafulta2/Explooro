/**
 * dispute.service.js — Three-Way Dispute Arbitration & Mediation Engine (Prompt 7.3).
 *
 * Implements:
 * 1. Three-way dispute workspace connecting Buyer (Customer), Saler, and Supplier with Platform Moderator.
 * 2. Strict SLA timer enforcement per stage and automated breach escalation.
 * 3. Granular privacy isolation: moderator internal notes never leak to customer/saler/supplier.
 * 4. Maker-Checker authorization: High-tier arbitration above configured amount threshold routes to Super Admin approval.
 * 5. Multi-outcome arbitration (FULL_REFUND, PARTIAL_REFUND, SPLIT_LIABILITY, REJECTED, REPLACEMENT)
 *    backed by balanced double-entry general ledger transactions.
 * 6. Participant trust score recalculations.
 * 7. Evidence timeline generator combining order, courier, return, and dispute events.
 * 8. Precedent case search.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as trustRepo from '../repositories/trustScore.repository.js';
import * as ledgerService from './ledger.service.js';
import * as moduleRepo from '../repositories/module.repository.js';
import { writeAudit } from '../lib/audit.js';

/**
 * Generates a public unique dispute reference code: DSP-XXXXXXXX
 */
function generateDisputeRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `DSP-${code}`;
}

/**
 * Converts a monetary value to integer paisa.
 */
function toPaisa(val) {
  const num = typeof val === 'number' ? val : parseFloat(val || 0);
  return Math.round(num * 100);
}

/**
 * Formats integer paisa to 2-decimal string.
 */
function fromPaisa(paisa) {
  return (paisa / 100).toFixed(2);
}

/**
 * Resolves module sub-settings for dispute panel.
 */
async function getDisputeSettings(db) {
  try {
    if (moduleRepo && typeof moduleRepo.getModuleByKey === 'function') {
      const mod = await moduleRepo.getModuleByKey(db, 'dispute_panel');
      if (mod?.sub_settings_json) {
        return {
          sla_hours: parseInt(mod.sub_settings_json.sla_hours, 10) || 48,
          escalate_above_amount: parseFloat(mod.sub_settings_json.escalate_above_amount) || 10000,
          maker_checker_above_amount: parseFloat(mod.sub_settings_json.maker_checker_above_amount) || 5000,
        };
      }
    }
  } catch {}
  return {
    sla_hours: 48,
    escalate_above_amount: 10000,
    maker_checker_above_amount: 5000,
  };
}

/**
 * Creates a new three-way dispute thread.
 */
export async function createDispute(db, cache, {
  subOrderId,
  returnId = null,
  customerId,
  disputedAmount = null,
  reason = 'ITEM_DISPUTE',
  initialMessage = '',
  attachments = [],
  openedByRole = 'CUSTOMER',
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Fetch sub-order & parties
    const { rows: subRows } = await txClient.query(
      `SELECT s.id, s.order_id, s.ref, s.supplier_id, s.saler_id, s.total_amount,
              s.saler_commission, s.status, o.customer_id
       FROM sub_orders s
       JOIN orders o ON o.id = s.order_id
       WHERE s.id = $1`,
      [subOrderId]
    );

    if (subRows.length === 0) {
      throw new Error(`SUB_ORDER_NOT_FOUND: Sub-order #${subOrderId} does not exist.`);
    }

    const subOrder = subRows[0];
    const amount = disputedAmount != null ? parseFloat(disputedAmount) : parseFloat(subOrder.total_amount);

    const settings = await getDisputeSettings(txClient);
    const slaHours = settings.sla_hours || 48;
    const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();

    // Check high amount escalation threshold
    const shouldAutoEscalate = amount >= settings.escalate_above_amount;
    const initialStatus = shouldAutoEscalate ? 'ESCALATED' : 'OPEN';
    const disputeRef = generateDisputeRef();

    const { rows: disputeRows } = await txClient.query(
      `INSERT INTO dispute_threads (
         ref, return_id, sub_order_id, customer_id, saler_id, supplier_id,
         disputed_amount, reason, status, sla_due_at, escalated_at, escalation_reason,
         created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
       RETURNING *`,
      [
        disputeRef,
        returnId,
        subOrderId,
        subOrder.customer_id,
        subOrder.saler_id,
        subOrder.supplier_id,
        amount,
        reason,
        initialStatus,
        slaDueAt,
        shouldAutoEscalate ? new Date().toISOString() : null,
        shouldAutoEscalate ? `Auto-escalated: Amount (${amount} BDT) exceeds threshold (${settings.escalate_above_amount} BDT)` : null,
      ]
    );

    const dispute = disputeRows[0];

    // If return exists, update return status to DISPUTED
    if (returnId) {
      await txClient.query(
        `UPDATE return_requests
         SET status = 'DISPUTED', updated_at = now()
         WHERE id = $1`,
        [returnId]
      );
    }

    // Insert opening message if provided
    if (initialMessage && initialMessage.trim().length > 0) {
      await txClient.query(
        `INSERT INTO dispute_messages (
           dispute_id, sender_id, sender_role, body, attachments_json, is_internal_note, created_at
         )
         VALUES ($1, $2, $3, $4, $5, false, now())`,
        [
          dispute.id,
          customerId,
          openedByRole.toUpperCase(),
          initialMessage.trim(),
          JSON.stringify(attachments || []),
        ]
      );
    }

    // Freeze active escrow entries for this sub-order while dispute is open
    await txClient.query(
      `UPDATE escrow_entries
       SET status = 'FROZEN',
           freeze_reason = $2
       WHERE sub_order_id = $1 AND status = 'LOCKED'`,
      [subOrderId, `Dispute ${dispute.ref} opened`]
    );

    await writeAudit(txClient, {
      actorId: customerId,
      actorRole: openedByRole.toLowerCase(),
      action: 'orders.dispute.create',
      targetType: 'dispute_threads',
      targetId: dispute.id,
      afterJson: { ref: dispute.ref, status: dispute.status, disputed_amount: dispute.disputed_amount },
      reason: `Dispute opened for sub-order #${subOrderId}`,
    });

    return dispute;
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Posts a new message or evidence attachment to a dispute thread.
 */
export async function postMessage(db, {
  disputeId,
  senderId,
  senderRole,
  body,
  attachments = [],
  isInternalNote = false,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    const { rows: disputeRows } = await txClient.query(
      `SELECT * FROM dispute_threads WHERE id = $1`,
      [disputeId]
    );

    if (disputeRows.length === 0) {
      throw new Error(`DISPUTE_NOT_FOUND: Dispute #${disputeId} not found.`);
    }

    const dispute = disputeRows[0];
    const roleUpper = senderRole.toUpperCase();
    const isStaff = ['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(roleUpper);

    // Permission validation
    if (!isStaff) {
      const isParticipant =
        (roleUpper === 'CUSTOMER' && dispute.customer_id === senderId) ||
        (roleUpper === 'SALER' && dispute.saler_id === senderId) ||
        (roleUpper === 'SUPPLIER' && dispute.supplier_id === senderId);

      if (!isParticipant) {
        throw new Error('UNAUTHORIZED_DISPUTE_ACCESS: You are not a participant in this dispute thread.');
      }

      if (isInternalNote) {
        throw new Error('FORBIDDEN_INTERNAL_NOTE: Only platform moderators and administrators can post internal notes.');
      }
    }

    if (!body || body.trim().length === 0) {
      throw new Error('MESSAGE_EMPTY: Message body cannot be empty.');
    }

    const { rows: msgRows } = await txClient.query(
      `INSERT INTO dispute_messages (
         dispute_id, sender_id, sender_role, body, attachments_json, is_internal_note, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, now())
       RETURNING *`,
      [
        disputeId,
        senderId,
        roleUpper,
        body.trim(),
        JSON.stringify(attachments || []),
        Boolean(isInternalNote),
      ]
    );

    // Update dispute status if under review
    let nextStatus = dispute.status;
    if (dispute.status === 'OPEN' || dispute.status === 'AWAITING_CUSTOMER' || dispute.status === 'AWAITING_SELLER') {
      nextStatus = 'UNDER_ARBITRATION';
    }

    await txClient.query(
      `UPDATE dispute_threads
       SET status = $2, updated_at = now()
       WHERE id = $1`,
      [disputeId, nextStatus]
    );

    return msgRows[0];
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Retrieves a single dispute thread with strict internal note privacy filtering.
 */
export async function getDisputeById(db, disputeId, { requestingUser } = {}) {
  const { rows: disputeRows } = await db.query(
    `SELECT d.*,
            c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
            sl.full_name AS saler_name, sl.email AS saler_email,
            sp.full_name AS supplier_name, sp.email AS supplier_email,
            so.ref AS sub_order_ref, so.status AS sub_order_status,
            r.ref AS return_ref, r.reason_code AS return_reason_code
     FROM dispute_threads d
     JOIN users c ON c.id = d.customer_id
     LEFT JOIN users sl ON sl.id = d.saler_id
     JOIN users sp ON sp.id = d.supplier_id
     JOIN sub_orders so ON so.id = d.sub_order_id
     LEFT JOIN return_requests r ON r.id = d.return_id
     WHERE d.id = $1`,
    [disputeId]
  );

  if (disputeRows.length === 0) {
    throw new Error(`DISPUTE_NOT_FOUND: Dispute #${disputeId} not found.`);
  }

  const dispute = disputeRows[0];
  const userRole = (requestingUser?.role || '').toLowerCase();
  const isStaff = ['moderator', 'admin', 'super_admin'].includes(userRole);

  // Validate user access
  if (!isStaff) {
    const isParty =
      dispute.customer_id === requestingUser?.id ||
      dispute.saler_id === requestingUser?.id ||
      dispute.supplier_id === requestingUser?.id;

    if (!isParty) {
      throw new Error('UNAUTHORIZED_DISPUTE_ACCESS: You do not have permission to view this dispute.');
    }
  }

  // Fetch messages: internal notes are strictly filtered on the SQL query level for non-staff
  let messageQuery = `
    SELECT m.*, u.full_name AS sender_name
    FROM dispute_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.dispute_id = $1
  `;
  const queryParams = [disputeId];

  if (!isStaff) {
    messageQuery += ` AND m.is_internal_note = false`;
  }

  messageQuery += ` ORDER BY m.created_at ASC`;

  const { rows: messages } = await db.query(messageQuery, queryParams);

  // Calculate SLA status
  const now = new Date();
  const slaDue = dispute.sla_due_at ? new Date(dispute.sla_due_at) : null;
  const isSlaBreached = slaDue && now > slaDue && !['RESOLVED', 'CLOSED'].includes(dispute.status);
  const remainingSlaMs = slaDue ? Math.max(0, slaDue.getTime() - now.getTime()) : 0;

  return {
    ...dispute,
    is_sla_breached: isSlaBreached,
    remaining_sla_minutes: Math.round(remainingSlaMs / (60 * 1000)),
    messages,
  };
}

/**
 * Lists disputes with role-based scoping and filter support.
 */
export async function listDisputes(db, {
  requestingUser,
  status = null,
  search = '',
  limit = 20,
  offset = 0,
} = {}) {
  const userRole = (requestingUser?.role || '').toLowerCase();
  const isStaff = ['moderator', 'admin', 'super_admin'].includes(userRole);

  let query = `
    SELECT d.*,
           c.full_name AS customer_name,
           sl.full_name AS saler_name,
           sp.full_name AS supplier_name,
           so.ref AS sub_order_ref,
           COUNT(m.id) AS total_messages
    FROM dispute_threads d
    JOIN users c ON c.id = d.customer_id
    LEFT JOIN users sl ON sl.id = d.saler_id
    JOIN users sp ON sp.id = d.supplier_id
    JOIN sub_orders so ON so.id = d.sub_order_id
    LEFT JOIN dispute_messages m ON m.dispute_id = d.id
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (!isStaff) {
    query += ` AND (d.customer_id = $${paramIdx} OR d.saler_id = $${paramIdx} OR d.supplier_id = $${paramIdx})`;
    params.push(requestingUser.id);
    paramIdx++;
  }

  if (status && status !== 'ALL') {
    query += ` AND d.status = $${paramIdx}`;
    params.push(status);
    paramIdx++;
  }

  if (search && search.trim().length > 0) {
    query += ` AND (d.ref ILIKE $${paramIdx} OR so.ref ILIKE $${paramIdx} OR c.full_name ILIKE $${paramIdx})`;
    params.push(`%${search.trim()}%`);
    paramIdx++;
  }

  query += `
    GROUP BY d.id, c.full_name, sl.full_name, sp.full_name, so.ref
    ORDER BY
      CASE WHEN d.status = 'ESCALATED' THEN 1
           WHEN d.status = 'OPEN' THEN 2
           WHEN d.status = 'UNDER_ARBITRATION' THEN 3
           ELSE 4 END ASC,
      d.sla_due_at ASC,
      d.created_at DESC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `;
  params.push(limit, offset);

  const { rows } = await db.query(query, params);

  const now = new Date();
  const enhancedRows = rows.map((r) => {
    const slaDue = r.sla_due_at ? new Date(r.sla_due_at) : null;
    const isSlaBreached = slaDue && now > slaDue && !['RESOLVED', 'CLOSED'].includes(r.status);
    const remainingMs = slaDue ? Math.max(0, slaDue.getTime() - now.getTime()) : 0;

    return {
      ...r,
      is_sla_breached: isSlaBreached,
      remaining_sla_minutes: Math.round(remainingMs / (60 * 1000)),
    };
  });

  return {
    disputes: enhancedRows,
    count: enhancedRows.length,
    limit,
    offset,
  };
}

/**
 * Builds a chronological, immutable EvidenceTimeline.
 */
export async function getEvidenceTimeline(db, disputeId, { requestingUser } = {}) {
  const dispute = await getDisputeById(db, disputeId, { requestingUser });
  const timelineEvents = [];

  // 1. Sub-order Placement
  timelineEvents.push({
    id: `event-order-${dispute.sub_order_id}`,
    type: 'ORDER_PLACED',
    category: 'COMMERCE',
    title: 'Order Placed & Escrow Locked',
    actor: dispute.customer_name,
    actor_role: 'CUSTOMER',
    timestamp: dispute.created_at, // earliest reference anchor
    metadata: {
      sub_order_ref: dispute.sub_order_ref,
      disputed_amount: dispute.disputed_amount,
    },
  });

  // 2. Fetch shipment events if any
  try {
    const { rows: shipEvents } = await db.query(
      `SELECT e.*, s.ref AS shipment_ref, s.courier
       FROM shipment_events e
       JOIN shipments s ON s.id = e.shipment_id
       WHERE s.sub_order_id = $1
       ORDER BY e.occurred_at ASC`,
      [dispute.sub_order_id]
    );

    for (const se of shipEvents) {
      timelineEvents.push({
        id: `event-shipment-${se.id}`,
        type: 'COURIER_EVENT',
        category: 'LOGISTICS',
        title: `Courier: ${se.normalized_status}`,
        actor: se.courier,
        actor_role: 'COURIER',
        timestamp: se.occurred_at,
        metadata: {
          tracking_note: se.note,
          raw_status: se.raw_status,
        },
      });
    }
  } catch {}

  // 3. Return request events if linked
  if (dispute.return_id) {
    try {
      const { rows: returnRows } = await db.query(
        `SELECT * FROM return_requests WHERE id = $1`,
        [dispute.return_id]
      );
      if (returnRows.length > 0) {
        const ret = returnRows[0];
        timelineEvents.push({
          id: `event-return-${ret.id}`,
          type: 'RETURN_REQUESTED',
          category: 'RETURN',
          title: `Return Requested: ${ret.reason_code}`,
          actor: dispute.customer_name,
          actor_role: 'CUSTOMER',
          timestamp: ret.created_at,
          metadata: {
            reason_code: ret.reason_code,
            evidence_urls: ret.evidence_urls_json || ret.evidence_media_json || [],
            inspection_notes: ret.inspection_notes,
          },
        });
      }
    } catch {}
  }

  // 4. Dispute Thread Created
  timelineEvents.push({
    id: `event-dispute-${dispute.id}`,
    type: 'DISPUTE_OPENED',
    category: 'DISPUTE',
    title: `Dispute Thread Initiated (${dispute.ref})`,
    actor: dispute.customer_name,
    actor_role: 'CUSTOMER',
    timestamp: dispute.created_at,
    metadata: {
      reason: dispute.reason,
      disputed_amount: dispute.disputed_amount,
      sla_due_at: dispute.sla_due_at,
    },
  });

  // 5. Messages and uploads (privacy filtered)
  for (const msg of dispute.messages || []) {
    timelineEvents.push({
      id: `event-msg-${msg.id}`,
      type: msg.is_internal_note ? 'INTERNAL_NOTE' : 'MESSAGE',
      category: 'COMMUNICATION',
      title: msg.is_internal_note ? 'Moderator Private Note' : `${msg.sender_role} Message`,
      actor: msg.sender_name,
      actor_role: msg.sender_role,
      timestamp: msg.created_at,
      body: msg.body,
      attachments: msg.attachments_json || [],
      is_internal: msg.is_internal_note,
    });
  }

  // 6. Escalation event if occurred
  if (dispute.escalated_at) {
    timelineEvents.push({
      id: `event-escalation-${dispute.id}`,
      type: 'DISPUTE_ESCALATED',
      category: 'ARBITRATION',
      title: 'Escalated to Super Admin',
      actor: 'System / Moderator',
      actor_role: 'MODERATOR',
      timestamp: dispute.escalated_at,
      metadata: {
        reason: dispute.escalation_reason,
      },
    });
  }

  // 7. Resolution event if resolved
  if (dispute.resolved_at) {
    timelineEvents.push({
      id: `event-resolution-${dispute.id}`,
      type: 'DISPUTE_RESOLVED',
      category: 'ARBITRATION',
      title: `Arbitration Decision: ${dispute.outcome}`,
      actor: 'Arbitrator',
      actor_role: 'MODERATOR',
      timestamp: dispute.resolved_at,
      metadata: {
        outcome: dispute.outcome,
        outcome_split: dispute.outcome_split_json,
        resolution_notes: dispute.resolution_notes,
      },
    });
  }

  // Sort strictly chronological
  timelineEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return {
    dispute_ref: dispute.ref,
    timeline: timelineEvents,
  };
}

/**
 * Searches past precedents to promote consistency.
 */
export async function searchPrecedents(db, { reason = null, limit = 5 } = {}) {
  let query = `
    SELECT d.id, d.ref, d.reason, d.disputed_amount, d.outcome, d.outcome_split_json,
           d.resolution_notes, d.resolved_at
    FROM dispute_threads d
    WHERE d.status = 'RESOLVED' AND d.outcome IS NOT NULL
  `;
  const params = [];

  if (reason && reason.trim().length > 0) {
    query += ` AND d.reason ILIKE $1`;
    params.push(`%${reason.trim()}%`);
  }

  query += ` ORDER BY d.resolved_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await db.query(query, params);
  return rows;
}

/**
 * Arbitrates and settles a dispute.
 *
 * Implements High-Tier Maker-Checker:
 * If a moderator resolves a dispute above `maker_checker_above_amount`,
 * creates a `pending_admin_actions` row and sets status to AWAITING_SUPER_ADMIN.
 */
export async function arbitrateDispute(db, cache, {
  disputeId,
  outcome,
  outcomeSplit = {},
  arbitratorId,
  arbitratorRole = 'moderator',
  resolutionNotes = 'Arbitrated by moderator',
  client = null,
} = {}) {
  const runner = async (txClient) => {
    const { rows: disputeRows } = await txClient.query(
      `SELECT d.*, s.order_id, s.saler_id, s.supplier_id, s.total_amount,
              s.saler_commission, s.subtotal_base, o.customer_id
       FROM dispute_threads d
       JOIN sub_orders s ON s.id = d.sub_order_id
       JOIN orders o ON o.id = s.order_id
       WHERE d.id = $1
       FOR UPDATE`,
      [disputeId]
    );

    if (disputeRows.length === 0) {
      throw new Error(`DISPUTE_NOT_FOUND: Dispute #${disputeId} not found.`);
    }

    const dispute = disputeRows[0];
    if (['RESOLVED', 'CLOSED'].includes(dispute.status)) {
      throw new Error(`DISPUTE_ALREADY_RESOLVED: Dispute ${dispute.ref} is already ${dispute.status}.`);
    }

    const validOutcomes = ['FULL_REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'REJECTED', 'SPLIT_LIABILITY'];
    if (!validOutcomes.includes(outcome)) {
      throw new Error(`INVALID_OUTCOME: Outcome "${outcome}" must be one of ${validOutcomes.join(', ')}`);
    }

    const settings = await getDisputeSettings(txClient);
    const amount = parseFloat(dispute.disputed_amount);
    const isModerator = arbitratorRole.toLowerCase() === 'moderator';
    const isSuperAdmin = arbitratorRole.toLowerCase() === 'super_admin';

    // 1. High-tier Maker-Checker check
    if (isModerator && amount > settings.maker_checker_above_amount) {
      // Create pending_admin_actions record
      const actionRef = `ACT-${randomUUID().substring(0, 8).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const { rows: actionRows } = await txClient.query(
        `INSERT INTO pending_admin_actions (
           ref, action_key, risk_tier, actor_id, target_entity, target_id,
           payload_json, status, expires_at, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         RETURNING *`,
        [
          actionRef,
          'orders.dispute.arbitrate',
          'HIGH',
          arbitratorId,
          'dispute_threads',
          dispute.id,
          JSON.stringify({
            disputeId: dispute.id,
            outcome,
            outcomeSplit,
            resolutionNotes,
          }),
          'PENDING',
          expiresAt,
        ]
      );

      const pendingAction = actionRows[0];

      await txClient.query(
        `UPDATE dispute_threads
         SET status = 'AWAITING_SUPER_ADMIN',
             pending_action_id = $2,
             resolution_notes = $3,
             updated_at = now()
         WHERE id = $1`,
        [dispute.id, pendingAction.id, `Proposed: ${outcome} (Awaiting Super Admin approval)`]
      );

      await writeAudit(txClient, {
        actorId: arbitratorId,
        actorRole: arbitratorRole,
        action: 'orders.dispute.arbitrate_proposed',
        targetType: 'dispute_threads',
        targetId: dispute.id,
        afterJson: { pending_action_id: pendingAction.id, proposed_outcome: outcome },
        reason: `Dispute resolution exceeds moderator limit (${amount} > ${settings.maker_checker_above_amount} BDT); requires maker-checker approval.`,
      });

      return {
        isPendingMakerChecker: true,
        disputeId: dispute.id,
        disputeRef: dispute.ref,
        pendingAction,
        message: 'Resolution submitted for Super Admin review.',
      };
    }

    // 2. Immediate Execution (Super Admin, Admin, or below Maker-Checker threshold)
    // Resolve Wallets
    const customerWallet = await walletRepo.getOrCreateWallet(db, dispute.customer_id, { client: txClient });
    const supplierWallet = await walletRepo.getOrCreateWallet(db, dispute.supplier_id, { client: txClient });
    const salerWallet = dispute.saler_id ? await walletRepo.getOrCreateWallet(db, dispute.saler_id, { client: txClient }) : null;

    // Fetch escrow entries
    const { rows: escrowRows } = await txClient.query(
      `SELECT * FROM escrow_entries WHERE sub_order_id = $1 FOR UPDATE`,
      [dispute.sub_order_id]
    );

    const isEscrowReleased = escrowRows.some((e) => e.status === 'RELEASED');
    const totalDisputedPaisa = toPaisa(dispute.disputed_amount);

    let customerRefundPaisa = 0;
    let supplierClawbackPaisa = 0;
    let salerClawbackPaisa = 0;

    if (outcome === 'FULL_REFUND') {
      customerRefundPaisa = totalDisputedPaisa;
      // Default: Supplier absorbs base cost, Saler absorbs commission
      const salerCommissionPaisa = toPaisa(dispute.saler_commission || 0);
      salerClawbackPaisa = Math.min(salerCommissionPaisa, totalDisputedPaisa);
      supplierClawbackPaisa = totalDisputedPaisa - salerClawbackPaisa;
    } else if (outcome === 'PARTIAL_REFUND') {
      customerRefundPaisa = toPaisa(outcomeSplit.buyer_refund || totalDisputedPaisa * 0.5);
      salerClawbackPaisa = toPaisa(outcomeSplit.saler_clawback || 0);
      supplierClawbackPaisa = toPaisa(outcomeSplit.supplier_clawback || (customerRefundPaisa - salerClawbackPaisa));
    } else if (outcome === 'SPLIT_LIABILITY') {
      customerRefundPaisa = toPaisa(outcomeSplit.buyer_refund || 0);
      salerClawbackPaisa = toPaisa(outcomeSplit.saler_clawback || 0);
      supplierClawbackPaisa = toPaisa(outcomeSplit.supplier_clawback || 0);
    } else if (outcome === 'REJECTED') {
      customerRefundPaisa = 0;
      supplierClawbackPaisa = 0;
      salerClawbackPaisa = 0;
    } else if (outcome === 'REPLACEMENT') {
      customerRefundPaisa = 0;
      supplierClawbackPaisa = 0;
      salerClawbackPaisa = 0;
    }

    // Double-Entry Ledger execution if monetary movement occurs
    if (customerRefundPaisa > 0) {
      const entries = [];
      const balanceBucket = isEscrowReleased ? 'AVAILABLE' : 'ESCROW';

      // 1. Credit Customer
      entries.push({
        walletId: customerWallet.id,
        entryType: 'CREDIT',
        amount: fromPaisa(customerRefundPaisa),
        balanceBucket: 'AVAILABLE',
        category: 'REFUND',
        referenceType: 'DISPUTE',
        referenceId: dispute.id,
        memo: `Dispute ${dispute.ref} ${outcome} to customer`,
        createdBy: arbitratorId,
      });

      // 2. Debit Supplier
      if (supplierClawbackPaisa > 0) {
        entries.push({
          walletId: supplierWallet.id,
          entryType: 'DEBIT',
          amount: fromPaisa(supplierClawbackPaisa),
          balanceBucket: balanceBucket,
          category: 'CLAWBACK',
          referenceType: 'DISPUTE',
          referenceId: dispute.id,
          memo: `Dispute ${dispute.ref} clawback from supplier`,
          createdBy: arbitratorId,
        });
      }

      // 3. Debit Saler if commission reversed
      if (salerClawbackPaisa > 0 && salerWallet) {
        entries.push({
          walletId: salerWallet.id,
          entryType: 'DEBIT',
          amount: fromPaisa(salerClawbackPaisa),
          balanceBucket: balanceBucket,
          category: 'CLAWBACK',
          referenceType: 'DISPUTE',
          referenceId: dispute.id,
          memo: `Dispute ${dispute.ref} commission clawback from saler`,
          createdBy: arbitratorId,
        });
      }

      // Check balance invariant
      const totalDebits = supplierClawbackPaisa + salerClawbackPaisa;
      if (totalDebits < customerRefundPaisa) {
        // Platform absorbs shortfall
        const shortfallPaisa = customerRefundPaisa - totalDebits;
        const platformWallet = await walletRepo.getOrCreateWallet(db, 1, { client: txClient }); // Platform wallet ID 1
        entries.push({
          walletId: platformWallet.id,
          entryType: 'DEBIT',
          amount: fromPaisa(shortfallPaisa),
          balanceBucket: 'AVAILABLE',
          category: 'ADJUSTMENT',
          referenceType: 'DISPUTE',
          referenceId: dispute.id,
          memo: `Platform dispute subsidy for ${dispute.ref}`,
          createdBy: arbitratorId,
        });
      }

      await ledgerService.recordTransactionGroup(txClient, {
        entries,
        defaultCategory: 'REFUND',
        defaultReferenceType: 'DISPUTE',
        defaultReferenceId: dispute.id,
        memo: `Dispute ${dispute.ref} settlement`,
        createdBy: arbitratorId,
      });
    }

    // If escrow was FROZEN and outcome is REJECTED, unfreeze escrow
    if (outcome === 'REJECTED') {
      await txClient.query(
        `UPDATE escrow_entries
         SET status = 'LOCKED', freeze_reason = NULL
         WHERE sub_order_id = $1 AND status = 'FROZEN'`,
        [dispute.sub_order_id]
      );
    } else if (outcome === 'FULL_REFUND' && !isEscrowReleased) {
      await txClient.query(
        `UPDATE escrow_entries
         SET status = 'CLAWED_BACK'
         WHERE sub_order_id = $1 AND status IN ('LOCKED', 'FROZEN')`,
        [dispute.sub_order_id]
      );
    }

    // Update dispute row to RESOLVED
    const { rows: updatedRows } = await txClient.query(
      `UPDATE dispute_threads
       SET status = 'RESOLVED',
           outcome = $2,
           outcome_split_json = $3,
           resolution_notes = $4,
           resolved_by = $5,
           resolved_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        dispute.id,
        outcome,
        JSON.stringify(outcomeSplit),
        resolutionNotes,
        arbitratorId,
      ]
    );

    // If return linked, update return status
    if (dispute.return_id) {
      const returnFinalStatus = outcome === 'REJECTED' ? 'REJECTED' : 'REFUNDED';
      await txClient.query(
        `UPDATE return_requests
         SET status = $2,
             refunded_at = CASE WHEN $2 = 'REFUNDED' THEN now() ELSE NULL END,
             updated_at = now()
         WHERE id = $1`,
        [dispute.return_id, returnFinalStatus]
      );
    }

    // Adjust trust scores based on arbitration outcome
    try {
      if (outcome === 'FULL_REFUND' || outcome === 'PARTIAL_REFUND') {
        // Supplier penalized
        const suppScore = await trustRepo.findTrustScoreByUserId(txClient, dispute.supplier_id);
        if (suppScore) {
          const currentScore = parseInt(suppScore.score, 10) || 50;
          await trustRepo.upsertTrustScore(txClient, {
            userId: dispute.supplier_id,
            score: Math.max(10, currentScore - 5),
            manualAdjustment: (suppScore.manual_adjustment || 0) - 5,
            adjustedBy: arbitratorId,
          });
        }
      } else if (outcome === 'REJECTED') {
        // Customer penalized for fraudulent / unjustified dispute
        const custScore = await trustRepo.findTrustScoreByUserId(txClient, dispute.customer_id);
        if (custScore) {
          const currentScore = parseInt(custScore.score, 10) || 50;
          await trustRepo.upsertTrustScore(txClient, {
            userId: dispute.customer_id,
            score: Math.max(10, currentScore - 3),
            manualAdjustment: (custScore.manual_adjustment || 0) - 3,
            adjustedBy: arbitratorId,
          });
        }
      }
    } catch {}

    await writeAudit(txClient, {
      actorId: arbitratorId,
      actorRole: arbitratorRole,
      action: 'orders.dispute.arbitrate',
      targetType: 'dispute_threads',
      targetId: dispute.id,
      afterJson: { outcome, outcome_split: outcomeSplit, resolution_notes: resolutionNotes },
      reason: `Arbitrated dispute ${dispute.ref}: ${outcome}`,
    });

    return {
      success: true,
      dispute: updatedRows[0],
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Escalates a dispute thread to Super Admin.
 */
export async function escalateDispute(db, {
  disputeId,
  reason = 'Escalated by staff',
  escalatedBy = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    const { rows } = await txClient.query(
      `UPDATE dispute_threads
       SET status = 'ESCALATED',
           escalated_at = now(),
           escalation_reason = $2,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [disputeId, reason]
    );

    if (rows.length === 0) {
      throw new Error(`DISPUTE_NOT_FOUND: Dispute #${disputeId} not found.`);
    }

    if (escalatedBy) {
      await writeAudit(txClient, {
        actorId: escalatedBy,
        actorRole: 'staff',
        action: 'orders.dispute.escalate',
        targetType: 'dispute_threads',
        targetId: disputeId,
        afterJson: { status: 'ESCALATED', escalation_reason: reason },
        reason,
      });
    }

    return rows[0];
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Sweeps and auto-escalates all active disputes where SLA has expired.
 */
export async function checkAndEscalateBreachedSlas(db, cache) {
  const { rows: breached } = await db.query(
    `SELECT id, ref, disputed_amount, sla_due_at
     FROM dispute_threads
     WHERE status IN ('OPEN', 'UNDER_ARBITRATION', 'AWAITING_CUSTOMER', 'AWAITING_SELLER')
       AND sla_due_at < now()`
  );

  const escalatedIds = [];
  for (const d of breached) {
    await escalateDispute(db, {
      disputeId: d.id,
      reason: `SLA_BREACH: Dispute timer expired on ${new Date(d.sla_due_at).toISOString()}`,
    });
    escalatedIds.push(d.id);
  }

  return {
    escalated_count: escalatedIds.length,
    escalated_ids: escalatedIds,
  };
}
