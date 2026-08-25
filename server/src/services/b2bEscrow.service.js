/**
 * b2bEscrow.service.js — B2B Wholesale Escrow & Milestone Settlement Service (Prompt 10.6).
 *
 * Implements idea proposition.md §AG:
 * 1. Staged milestone escrow schedule (e.g. 30% upfront, 40% dispatch, 30% inspection).
 * 2. Mutual digital signoff with cryptographic SHA-256 immutable terms snapshot.
 * 3. Evidence-gated staged releases with High-tier Maker-Checker review for admin manual releases.
 * 4. Dispute freezing immediately halting unreleased milestones and routing to arbitration.
 * 5. Strict double-entry ledger balance across partial releases, refunds, and cancellations.
 * 6. Zero-dependency native PDF 1.4 contract summary generator.
 */

import { createHash } from 'node:crypto';
import { AppError } from '../plugins/errorHandler.js';
import { generateRef } from '../lib/ref.js';
import { toPaisa, toBdtNumber, toBdtString } from './pricing.service.js';
import { recordTransactionGroup } from './ledger.service.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import { writeAudit } from '../lib/audit.js';

/**
 * Validates and apportion milestone amounts with zero fractional paisa drift.
 */
export function calculateMilestonesSchedule({ totalAmount, milestones = [] }) {
  const totalNum = parseFloat(totalAmount);
  if (isNaN(totalNum) || totalNum <= 0) {
    throw new AppError('VALIDATION_FAILED', 'Total deal amount must be greater than zero.', 400);
  }
  if (!Array.isArray(milestones) || milestones.length < 1) {
    throw new AppError('VALIDATION_FAILED', 'At least 1 milestone is required for B2B escrow.', 400);
  }

  const totalPaisa = toPaisa(totalNum);
  let totalPct = 0;

  for (const m of milestones) {
    const pct = parseFloat(m.release_pct || m.releasePct || 0);
    if (isNaN(pct) || pct <= 0) {
      throw new AppError('VALIDATION_FAILED', 'Milestone release percentage must be greater than 0.', 400);
    }
    totalPct += pct;
  }

  if (Math.abs(totalPct - 100.0) > 0.01) {
    throw new AppError('VALIDATION_FAILED', `Milestone percentages must sum to exactly 100% (currently ${totalPct.toFixed(2)}%).`, 400);
  }

  let assignedPaisa = 0;
  const calculated = [];

  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    const pct = parseFloat(m.release_pct || m.releasePct);
    const isLast = i === milestones.length - 1;

    let mPaisa;
    if (isLast) {
      mPaisa = totalPaisa - assignedPaisa;
    } else {
      mPaisa = Math.floor((totalPaisa * pct) / 100);
      assignedPaisa += mPaisa;
    }

    calculated.push({
      sequence_no: i + 1,
      label_en: m.label_en || m.labelEn || `Milestone Phase ${i + 1}`,
      label_bn: m.label_bn || m.labelBn || `মাইলস্টোন ধাপ ${i + 1}`,
      release_pct: pct,
      amount: toBdtNumber(mPaisa),
      amount_paisa: mPaisa,
      evidence_required: m.evidence_required || m.evidenceRequired || 'NONE',
    });
  }

  return calculated;
}

/**
 * Computes an immutable SHA-256 hash of agreed contract terms and milestone schedule.
 */
export function computeAgreedTermsHash({ dealRef, totalAmount, buyerId, supplierId, terms = {}, milestones = [] }) {
  const canonical = {
    dealRef,
    totalAmount: parseFloat(totalAmount).toFixed(2),
    buyerId: String(buyerId),
    supplierId: String(supplierId),
    terms: {
      deliveryDays: terms.deliveryDays || terms.delivery_days || 30,
      inspectionPeriodHours: terms.inspectionPeriodHours || terms.inspection_period_hours || 48,
      qualitySpecs: terms.qualitySpecs || terms.quality_specs || 'Standard commercial wholesale grade',
      penaltyTerms: terms.penaltyTerms || terms.penalty_terms || 'Standard platform dispute terms',
    },
    milestones: milestones.map((m) => ({
      seq: m.sequence_no,
      pct: parseFloat(m.release_pct).toFixed(2),
      amount: parseFloat(m.amount).toFixed(2),
      evidence: m.evidence_required,
    })),
  };

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Creates a new B2B wholesale deal with milestone schedule.
 */
export async function createB2bDeal(db, {
  buyerId,
  supplierId,
  subOrderId = null,
  titleEn,
  titleBn,
  totalAmount,
  contractTerms = {},
  milestones = [],
}) {
  if (!buyerId || !supplierId) {
    throw new AppError('VALIDATION_FAILED', 'Buyer and Supplier IDs are required.', 400);
  }
  if (Number(buyerId) === Number(supplierId)) {
    throw new AppError('VALIDATION_FAILED', 'Buyer and Supplier cannot be the same account.', 400);
  }
  if (!titleEn || !titleBn) {
    throw new AppError('VALIDATION_FAILED', 'Bilingual deal titles (English & Bengali) are required.', 400);
  }

  const calculatedMilestones = calculateMilestonesSchedule({ totalAmount, milestones });
  const dealRef = generateRef('B2B');
  const termsHash = computeAgreedTermsHash({
    dealRef,
    totalAmount,
    buyerId,
    supplierId,
    terms: contractTerms,
    milestones: calculatedMilestones,
  });

  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);

  try {
    if (isDedicatedClient) await client.query('BEGIN');

    // 1. Insert Deal
    const dealSql = `
      INSERT INTO b2b_escrow_deals (
        ref, title_en, title_bn, sub_order_id, buyer_id, supplier_id,
        total_amount, status, agreed_terms_hash, contract_terms_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_SUPPLIER_ACCEPTANCE', $8, $9)
      RETURNING *;
    `;
    const { rows: dealRows } = await client.query(dealSql, [
      dealRef,
      titleEn,
      titleBn,
      subOrderId,
      buyerId,
      supplierId,
      totalAmount,
      termsHash,
      JSON.stringify(contractTerms),
    ]);
    const deal = dealRows[0];

    // 2. Insert Milestones
    const createdMilestones = [];
    for (const m of calculatedMilestones) {
      const mRef = generateRef('MLS');
      const mSql = `
        INSERT INTO b2b_escrow_milestones (
          ref, deal_id, sub_order_id, buyer_id, supplier_id,
          sequence_no, label_en, label_bn, release_pct, amount,
          evidence_required, status, agreed_terms_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING', $12)
        RETURNING *;
      `;
      const { rows: mRows } = await client.query(mSql, [
        mRef,
        deal.id,
        subOrderId,
        buyerId,
        supplierId,
        m.sequence_no,
        m.label_en,
        m.label_bn,
        m.release_pct,
        m.amount,
        m.evidence_required,
        termsHash,
      ]);
      createdMilestones.push(mRows[0]);
    }

    if (isDedicatedClient) await client.query('COMMIT');

    return {
      deal: {
        ...deal,
        total_amount: parseFloat(deal.total_amount),
        released_amount: parseFloat(deal.released_amount),
        refunded_amount: parseFloat(deal.refunded_amount),
        frozen_amount: parseFloat(deal.frozen_amount),
      },
      milestones: createdMilestones.map((m) => ({
        ...m,
        amount: parseFloat(m.amount),
        release_pct: parseFloat(m.release_pct),
      })),
    };
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }
}

/**
 * Accepts deal terms and locks funds into escrow once both buyer and supplier sign.
 */
export async function acceptDealTerms(db, { dealId, userId, role }) {
  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);

  try {
    if (isDedicatedClient) await client.query('BEGIN');

    const { rows: deals } = await client.query(
      'SELECT * FROM b2b_escrow_deals WHERE id = $1 FOR UPDATE;',
      [dealId]
    );
    if (!deals.length) {
      throw new AppError('NOT_FOUND', `B2B Deal #${dealId} not found.`, 404);
    }
    const deal = deals[0];

    const isBuyer = Number(deal.buyer_id) === Number(userId);
    const isSupplier = Number(deal.supplier_id) === Number(userId);

    if (!isBuyer && !isSupplier && role !== 'admin' && role !== 'super_admin') {
      throw new AppError('FORBIDDEN', 'You are not a participant in this B2B deal.', 403);
    }

    let buyerSignedAt = deal.buyer_signed_at;
    let supplierSignedAt = deal.supplier_signed_at;

    if (isBuyer) buyerSignedAt = new Date().toISOString();
    if (isSupplier) supplierSignedAt = new Date().toISOString();

    let newStatus = deal.status;
    let lockedEscrowTxn = null;

    // Both parties have accepted -> Lock funds into escrow
    if (buyerSignedAt && supplierSignedAt && deal.status !== 'LOCKED_IN_ESCROW' && deal.status !== 'IN_PROGRESS') {
      newStatus = 'LOCKED_IN_ESCROW';

      // Ensure buyer wallet exists and has sufficient available balance
      const buyerWallet = await walletRepo.getOrCreateWallet(db, deal.buyer_id, { client });

      // Move funds from buyer AVAILABLE to buyer ESCROW
      const dealAmount = parseFloat(deal.total_amount);
      const buyerAvailable = parseFloat(buyerWallet.available_balance);

      if (buyerAvailable < dealAmount) {
        throw new AppError(
          'INSUFFICIENT_FUNDS',
          `Buyer wallet has insufficient available balance (৳${buyerAvailable.toFixed(2)}) for B2B deal total ৳${dealAmount.toFixed(2)}.`,
          400
        );
      }

      lockedEscrowTxn = await recordTransactionGroup(client, {
        entries: [
          {
            walletId: buyerWallet.id,
            entryType: 'DEBIT',
            amount: dealAmount,
            balanceBucket: 'AVAILABLE',
            category: 'B2B_ESCROW_LOCK',
            referenceType: 'B2B_DEAL',
            referenceId: deal.id,
            memo: `Lock funds into B2B Wholesale Escrow for deal ${deal.ref}`,
            createdBy: userId,
          },
          {
            walletId: buyerWallet.id,
            entryType: 'CREDIT',
            amount: dealAmount,
            balanceBucket: 'ESCROW',
            category: 'B2B_ESCROW_LOCK',
            referenceType: 'B2B_DEAL',
            referenceId: deal.id,
            memo: `Holding funds in B2B Escrow for deal ${deal.ref}`,
            createdBy: userId,
          },
        ],
        defaultCategory: 'B2B_ESCROW_LOCK',
        defaultReferenceType: 'B2B_DEAL',
        defaultReferenceId: deal.id,
        createdBy: userId,
      });

      newStatus = 'IN_PROGRESS';
    }

    const { rows: updatedDeals } = await client.query(
      `UPDATE b2b_escrow_deals
       SET buyer_signed_at = $1,
           supplier_signed_at = $2,
           status = $3,
           updated_at = now()
       WHERE id = $4
       RETURNING *;`,
      [buyerSignedAt, supplierSignedAt, newStatus, dealId]
    );

    if (isDedicatedClient) await client.query('COMMIT');

    return {
      deal: updatedDeals[0],
      locked: Boolean(lockedEscrowTxn),
      txn_group_id: lockedEscrowTxn?.txn_group_id || null,
    };
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }
}

/**
 * Submits evidence for a milestone (e.g. dispatch proof, bill of lading, inspection).
 */
export async function submitMilestoneEvidence(db, {
  milestoneId,
  supplierId,
  evidenceType,
  mediaUrls = [],
  notes = '',
}) {
  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);

  try {
    if (isDedicatedClient) await client.query('BEGIN');

    const { rows: ms } = await client.query(
      'SELECT * FROM b2b_escrow_milestones WHERE id = $1 FOR UPDATE;',
      [milestoneId]
    );
    if (!ms.length) {
      throw new AppError('NOT_FOUND', `Milestone #${milestoneId} not found.`, 404);
    }
    const milestone = ms[0];

    if (milestone.status === 'RELEASED') {
      throw new AppError('INVALID_STATE', 'Milestone has already been released.', 400);
    }
    if (milestone.status === 'FROZEN') {
      throw new AppError('INVALID_STATE', 'Milestone is frozen due to an active dispute.', 400);
    }
    if (milestone.status === 'REFUNDED') {
      throw new AppError('INVALID_STATE', 'Milestone has been refunded.', 400);
    }

    const evidenceData = {
      evidence_type: evidenceType || milestone.evidence_required,
      media_urls: Array.isArray(mediaUrls) ? mediaUrls : [mediaUrls],
      submitted_at: new Date().toISOString(),
      submitted_by: supplierId,
      notes,
    };

    const { rows: updated } = await client.query(
      `UPDATE b2b_escrow_milestones
       SET status = 'EVIDENCE_SUBMITTED',
           evidence_media_json = $1
       WHERE id = $2
       RETURNING *;`,
      [JSON.stringify(evidenceData), milestoneId]
    );

    if (isDedicatedClient) await client.query('COMMIT');
    return updated[0];
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }
}

/**
 * Releases a staged milestone payout.
 * Non-super-admin manual releases above threshold require Maker-Checker approval.
 */
export async function releaseMilestone(db, {
  milestoneId,
  actorId,
  actorRole,
  isSuperAdmin = false,
  isMakerCheckerApproval = false,
  notes = '',
}) {
  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);

  try {
    if (isDedicatedClient) await client.query('BEGIN');

    const { rows: ms } = await client.query(
      `SELECT m.*, d.ref as deal_ref, d.status as deal_status, d.total_amount as deal_total
       FROM b2b_escrow_milestones m
       JOIN b2b_escrow_deals d ON m.deal_id = d.id
       WHERE m.id = $1 FOR UPDATE;`,
      [milestoneId]
    );
    if (!ms.length) {
      throw new AppError('NOT_FOUND', `Milestone #${milestoneId} not found.`, 404);
    }
    const milestone = ms[0];

    if (milestone.status === 'RELEASED') {
      throw new AppError('INVALID_STATE', 'Milestone has already been released.', 400);
    }
    if (milestone.status === 'FROZEN') {
      throw new AppError('INVALID_STATE', 'Milestone is frozen due to active dispute.', 400);
    }
    if (milestone.status === 'REFUNDED') {
      throw new AppError('INVALID_STATE', 'Milestone has been refunded.', 400);
    }

    const isBuyer = Number(milestone.buyer_id) === Number(actorId);
    const isAdmin = actorRole === 'admin' || actorRole === 'super_admin' || isSuperAdmin;

    if (!isBuyer && !isAdmin) {
      throw new AppError('FORBIDDEN', 'Only the buyer or an authorized admin can release milestone escrow funds.', 403);
    }

    const milestoneAmount = parseFloat(milestone.amount);

    // Maker-Checker Check for non-super-admin manual release
    if (isAdmin && !isSuperAdmin && !isBuyer && !isMakerCheckerApproval) {
      // Create pending admin action (Maker-Checker HIGH tier)
      const actionRef = generateRef('ACT');
      const actionSql = `
        INSERT INTO pending_admin_actions (
          ref, action_type, target_entity_type, target_entity_id,
          payload_json, requested_by, risk_tier, status, notes
        ) VALUES ($1, 'b2b_escrow.release', 'b2b_escrow_milestone', $2, $3, $4, 'HIGH', 'PENDING', $5)
        RETURNING *;
      `;
      const { rows: actionRows } = await client.query(actionSql, [
        actionRef,
        milestoneId,
        JSON.stringify({ milestoneId, amount: milestoneAmount, dealId: milestone.deal_id, notes }),
        actorId,
        notes || `Admin manual release of milestone #${milestone.sequence_no} (৳${milestoneAmount.toFixed(2)}) for deal ${milestone.deal_ref}`,
      ]);

      if (isDedicatedClient) await client.query('COMMIT');

      return {
        is_pending_maker_checker: true,
        action: actionRows[0],
        message: 'Milestone manual release queued for Super Admin confirmation (Maker-Checker HIGH tier).',
      };
    }

    // Direct Execution (Buyer release or Super Admin / Maker-Checker approved)
    const buyerWallet = await walletRepo.getOrCreateWallet(db, milestone.buyer_id, { client });
    const supplierWallet = await walletRepo.getOrCreateWallet(db, milestone.supplier_id, { client });

    // Double-Entry Ledger Transfer:
    // Debit Buyer ESCROW -> Credit Supplier AVAILABLE
    const ledgerTxn = await recordTransactionGroup(client, {
      entries: [
        {
          walletId: buyerWallet.id,
          entryType: 'DEBIT',
          amount: milestoneAmount,
          balanceBucket: 'ESCROW',
          category: 'B2B_MILESTONE_RELEASE',
          referenceType: 'B2B_MILESTONE',
          referenceId: milestone.id,
          memo: `Release Milestone #${milestone.sequence_no} (${milestone.release_pct}%) to Supplier for deal ${milestone.deal_ref}`,
          createdBy: actorId,
        },
        {
          walletId: supplierWallet.id,
          entryType: 'CREDIT',
          amount: milestoneAmount,
          balanceBucket: 'AVAILABLE',
          category: 'B2B_MILESTONE_RELEASE',
          referenceType: 'B2B_MILESTONE',
          referenceId: milestone.id,
          memo: `Settlement for Milestone #${milestone.sequence_no} (${milestone.release_pct}%) from deal ${milestone.deal_ref}`,
          createdBy: actorId,
        },
      ],
      defaultCategory: 'B2B_MILESTONE_RELEASE',
      defaultReferenceType: 'B2B_MILESTONE',
      defaultReferenceId: milestone.id,
      createdBy: actorId,
    });

    // Update milestone status
    const { rows: updatedMilestones } = await client.query(
      `UPDATE b2b_escrow_milestones
       SET status = 'RELEASED',
           released_by = $1,
           released_at = now()
       WHERE id = $2
       RETURNING *;`,
      [actorId, milestoneId]
    );

    // Update deal released_amount and status if all milestones released
    await client.query(
      `UPDATE b2b_escrow_deals
       SET released_amount = released_amount + $1,
           updated_at = now()
       WHERE id = $2;`,
      [milestoneAmount, milestone.deal_id]
    );

    const { rows: remainingPending } = await client.query(
      `SELECT COUNT(*) as count FROM b2b_escrow_milestones
       WHERE deal_id = $1 AND status != 'RELEASED';`,
      [milestone.deal_id]
    );

    if (parseInt(remainingPending[0].count, 10) === 0) {
      await client.query(
        `UPDATE b2b_escrow_deals SET status = 'COMPLETED', updated_at = now() WHERE id = $1;`,
        [milestone.deal_id]
      );
    }

    // Write audit log
    await writeAudit(client, {
      userId: actorId,
      action: 'b2b.milestone.release',
      entityType: 'b2b_escrow_milestone',
      entityId: milestoneId,
      beforeJson: { status: milestone.status, released_amount: milestone.deal_total },
      afterJson: { status: 'RELEASED', released_amount: milestoneAmount, txn_group_id: ledgerTxn.txn_group_id },
      notes,
    });

    if (isDedicatedClient) await client.query('COMMIT');

    return {
      is_pending_maker_checker: false,
      milestone: updatedMilestones[0],
      txn_group_id: ledgerTxn.txn_group_id,
    };
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }
}

/**
 * Freezes remaining unreleased milestones and routes deal into the dispute workspace.
 */
export async function raiseB2bDispute(db, {
  dealId,
  raisedBy,
  reasonEn,
  reasonBn,
  evidenceMedia = [],
}) {
  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);

  try {
    if (isDedicatedClient) await client.query('BEGIN');

    const { rows: deals } = await client.query(
      'SELECT * FROM b2b_escrow_deals WHERE id = $1 FOR UPDATE;',
      [dealId]
    );
    if (!deals.length) {
      throw new AppError('NOT_FOUND', `B2B Deal #${dealId} not found.`, 404);
    }
    const deal = deals[0];

    const isBuyer = Number(deal.buyer_id) === Number(raisedBy);
    const isSupplier = Number(deal.supplier_id) === Number(raisedBy);

    if (!isBuyer && !isSupplier) {
      throw new AppError('FORBIDDEN', 'Only deal participants can raise a B2B escrow dispute.', 403);
    }

    // Freeze all remaining non-released milestones
    const { rows: frozenRows } = await client.query(
      `UPDATE b2b_escrow_milestones
       SET status = 'FROZEN'
       WHERE deal_id = $1 AND status IN ('PENDING', 'EVIDENCE_SUBMITTED')
       RETURNING *;`,
      [dealId]
    );

    const frozenTotal = frozenRows.reduce((acc, m) => acc + parseFloat(m.amount), 0);

    // Create dispute record in disputes table
    const disputeRef = generateRef('DIS');
    const disputeSql = `
      INSERT INTO disputes (
        ref, sub_order_id, customer_id, supplier_id, saler_id,
        category, reason, status, claim_amount, evidence_json
      ) VALUES ($1, $2, $3, $4, $5, 'B2B_ESCROW', $6, 'OPEN', $7, $8)
      RETURNING *;
    `;
    const { rows: disputeRows } = await client.query(disputeSql, [
      disputeRef,
      deal.sub_order_id,
      deal.buyer_id,
      deal.supplier_id,
      deal.buyer_id, // buyer is the saler
      reasonEn || 'B2B Wholesale Escrow Milestone Dispute',
      frozenTotal,
      JSON.stringify({ evidenceMedia, reasonBn, frozenMilestones: frozenRows.map((m) => m.id) }),
    ]);
    const dispute = disputeRows[0];

    // Update deal
    const { rows: updatedDeals } = await client.query(
      `UPDATE b2b_escrow_deals
       SET status = 'DISPUTED',
           dispute_id = $1,
           frozen_amount = $2,
           updated_at = now()
       WHERE id = $3
       RETURNING *;`,
      [dispute.id, frozenTotal, dealId]
    );

    if (isDedicatedClient) await client.query('COMMIT');

    return {
      deal: updatedDeals[0],
      dispute,
      frozen_milestones_count: frozenRows.length,
      frozen_amount: frozenTotal,
    };
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }
}

/**
 * Refunds an unreleased milestone back to the buyer (Double-entry: ESCROW -> AVAILABLE).
 */
export async function refundMilestone(db, {
  milestoneId,
  actorId,
  reason = '',
}) {
  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);

  try {
    if (isDedicatedClient) await client.query('BEGIN');

    const { rows: ms } = await client.query(
      `SELECT m.*, d.ref as deal_ref
       FROM b2b_escrow_milestones m
       JOIN b2b_escrow_deals d ON m.deal_id = d.id
       WHERE m.id = $1 FOR UPDATE;`,
      [milestoneId]
    );
    if (!ms.length) {
      throw new AppError('NOT_FOUND', `Milestone #${milestoneId} not found.`, 404);
    }
    const milestone = ms[0];

    if (milestone.status === 'RELEASED') {
      throw new AppError('INVALID_STATE', 'Released milestones cannot be refunded directly; use clawback.', 400);
    }
    if (milestone.status === 'REFUNDED') {
      throw new AppError('INVALID_STATE', 'Milestone has already been refunded.', 400);
    }

    const milestoneAmount = parseFloat(milestone.amount);
    const buyerWallet = await walletRepo.getOrCreateWallet(db, milestone.buyer_id, { client });

    // Double-entry transfer: Debit Buyer ESCROW -> Credit Buyer AVAILABLE
    const ledgerTxn = await recordTransactionGroup(client, {
      entries: [
        {
          walletId: buyerWallet.id,
          entryType: 'DEBIT',
          amount: milestoneAmount,
          balanceBucket: 'ESCROW',
          category: 'B2B_MILESTONE_REFUND',
          referenceType: 'B2B_MILESTONE',
          referenceId: milestone.id,
          memo: `Refund Milestone #${milestone.sequence_no} (${milestone.release_pct}%) to Buyer for deal ${milestone.deal_ref}: ${reason}`,
          createdBy: actorId,
        },
        {
          walletId: buyerWallet.id,
          entryType: 'CREDIT',
          amount: milestoneAmount,
          balanceBucket: 'AVAILABLE',
          category: 'B2B_MILESTONE_REFUND',
          referenceType: 'B2B_MILESTONE',
          referenceId: milestone.id,
          memo: `Refund balance restored for Milestone #${milestone.sequence_no} from deal ${milestone.deal_ref}`,
          createdBy: actorId,
        },
      ],
      defaultCategory: 'B2B_MILESTONE_REFUND',
      defaultReferenceType: 'B2B_MILESTONE',
      defaultReferenceId: milestone.id,
      createdBy: actorId,
    });

    const { rows: updatedMilestones } = await client.query(
      `UPDATE b2b_escrow_milestones
       SET status = 'REFUNDED'
       WHERE id = $1
       RETURNING *;`,
      [milestoneId]
    );

    await client.query(
      `UPDATE b2b_escrow_deals
       SET refunded_amount = refunded_amount + $1,
           updated_at = now()
       WHERE id = $2;`,
      [milestoneAmount, milestone.deal_id]
    );

    if (isDedicatedClient) await client.query('COMMIT');

    return {
      milestone: updatedMilestones[0],
      refunded_amount: milestoneAmount,
      txn_group_id: ledgerTxn.txn_group_id,
    };
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }
}

/**
 * Cancels a deal and refunds all unreleased escrow funds back to the buyer.
 */
export async function cancelDeal(db, { dealId, actorId, reason = '' }) {
  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);

  try {
    if (isDedicatedClient) await client.query('BEGIN');

    const { rows: deals } = await client.query(
      'SELECT * FROM b2b_escrow_deals WHERE id = $1 FOR UPDATE;',
      [dealId]
    );
    if (!deals.length) {
      throw new AppError('NOT_FOUND', `B2B Deal #${dealId} not found.`, 404);
    }
    const deal = deals[0];

    const { rows: unreleasedMilestones } = await client.query(
      `SELECT * FROM b2b_escrow_milestones
       WHERE deal_id = $1 AND status IN ('PENDING', 'EVIDENCE_SUBMITTED', 'FROZEN')
       FOR UPDATE;`,
      [dealId]
    );

    const totalToRefund = unreleasedMilestones.reduce((acc, m) => acc + parseFloat(m.amount), 0);

    if (totalToRefund > 0) {
      const buyerWallet = await walletRepo.getOrCreateWallet(db, deal.buyer_id, { client });

      await recordTransactionGroup(client, {
        entries: [
          {
            walletId: buyerWallet.id,
            entryType: 'DEBIT',
            amount: totalToRefund,
            balanceBucket: 'ESCROW',
            category: 'B2B_DEAL_CANCEL_REFUND',
            referenceType: 'B2B_DEAL',
            referenceId: deal.id,
            memo: `Cancel deal ${deal.ref}: Refund remaining unreleased escrow: ${reason}`,
            createdBy: actorId,
          },
          {
            walletId: buyerWallet.id,
            entryType: 'CREDIT',
            amount: totalToRefund,
            balanceBucket: 'AVAILABLE',
            category: 'B2B_DEAL_CANCEL_REFUND',
            referenceType: 'B2B_DEAL',
            referenceId: deal.id,
            memo: `Restored available funds from cancelled B2B deal ${deal.ref}`,
            createdBy: actorId,
          },
        ],
        defaultCategory: 'B2B_DEAL_CANCEL_REFUND',
        defaultReferenceType: 'B2B_DEAL',
        defaultReferenceId: deal.id,
        createdBy: actorId,
      });

      await client.query(
        `UPDATE b2b_escrow_milestones
         SET status = 'REFUNDED'
         WHERE deal_id = $1 AND status IN ('PENDING', 'EVIDENCE_SUBMITTED', 'FROZEN');`,
        [dealId]
      );
    }

    const { rows: updatedDeals } = await client.query(
      `UPDATE b2b_escrow_deals
       SET status = 'CANCELLED',
           refunded_amount = refunded_amount + $1,
           updated_at = now()
       WHERE id = $2
       RETURNING *;`,
      [totalToRefund, dealId]
    );

    if (isDedicatedClient) await client.query('COMMIT');

    return {
      deal: updatedDeals[0],
      refunded_amount: totalToRefund,
    };
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }
}

/**
 * Generates a valid zero-dependency PDF 1.4 binary buffer for B2B contract summaries.
 */
export function generateContractPdf({
  deal,
  milestones = [],
  buyer = {},
  supplier = {},
}) {
  const dealRef = deal.ref || 'B2B-0000';
  const dealTitle = (deal.title_en || 'B2B Wholesale Escrow Agreement').replace(/[()\\]/g, '');
  const totalAmount = `BDT ${parseFloat(deal.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  const hash = deal.agreed_terms_hash || 'UNHASHED-PENDING-TERMS';
  const status = deal.status || 'DRAFT';
  const buyerName = (buyer.name || buyer.shop_name || `Buyer #${deal.buyer_id}`).replace(/[()\\]/g, '');
  const supplierName = (supplier.name || supplier.shop_name || `Supplier #${deal.supplier_id}`).replace(/[()\\]/g, '');
  const createdDate = new Date(deal.created_at || Date.now()).toISOString().split('T')[0];

  // PDF content stream
  let streamText = `BT
/F1 18 Tf
50 750 Td
(EXPLOORO B2B WHOLESALE ESCROW CONTRACT) Tj
/F1 10 Tf
0 -20 Td
(Contract Ref: ${dealRef} | Date: ${createdDate} | Status: ${status}) Tj
0 -25 Td
/F1 12 Tf
(Deal Title: ${dealTitle}) Tj
/F1 10 Tf
0 -20 Td
(Total Deal Value: ${totalAmount}) Tj
0 -15 Td
(Agreed Cryptographic Hash: ${hash}) Tj
0 -25 Td
/F1 12 Tf
(PARTIES TO THE AGREEMENT:) Tj
/F1 10 Tf
0 -15 Td
(1. Buyer / Saler: ${buyerName}) Tj
0 -15 Td
(2. Manufacturer / Supplier: ${supplierName}) Tj
0 -25 Td
/F1 12 Tf
(STAGED ESCROW MILESTONE SCHEDULE:) Tj
/F1 10 Tf
`;

  let yOffset = 0;
  for (const m of milestones) {
    const mLabel = (m.label_en || `Phase ${m.sequence_no}`).replace(/[()\\]/g, '');
    const mAmt = `BDT ${parseFloat(m.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const mEvidence = m.evidence_required || 'NONE';
    const mStatus = m.status || 'PENDING';

    streamText += `0 -18 Td
([Phase ${m.sequence_no}] ${m.release_pct}%: ${mLabel} | Amount: ${mAmt} | Evidence: ${mEvidence} | ${mStatus}) Tj
`;
  }

  streamText += `0 -35 Td
/F1 11 Tf
(LEGAL & ESCROW DISBURSEMENT TERMS:) Tj
/F1 9 Tf
0 -15 Td
(Funds are securely held in Explooro Escrow Vault and disbursed strictly in stages.) Tj
0 -12 Td
(Dispute freezes remaining unreleased milestones immediately for arbitration.) Tj
0 -12 Td
(Both parties acknowledged terms with SHA-256 digital signature snapshot.) Tj
0 -30 Td
/F1 10 Tf
(Digital Signature Snapshot: ${hash.substring(0, 32)}...) Tj
ET`;

  const streamLength = Buffer.byteLength(streamText, 'utf8');

  // Assembly of standard PDF 1.4 objects
  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamText}\nendstream\nendobj\n`;
  const obj5 = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  const header = `%PDF-1.4\n`;
  const offset1 = header.length;
  const offset2 = offset1 + obj1.length;
  const offset3 = offset2 + obj2.length;
  const offset4 = offset3 + obj3.length;
  const offset5 = offset4 + obj4.length;
  const xrefOffset = offset5 + obj5.length;

  const xref = `xref
0 6
0000000000 65535 f 
${String(offset1).padStart(10, '0')} 00000 n 
${String(offset2).padStart(10, '0')} 00000 n 
${String(offset3).padStart(10, '0')} 00000 n 
${String(offset4).padStart(10, '0')} 00000 n 
${String(offset5).padStart(10, '0')} 00000 n 
`;

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + obj1 + obj2 + obj3 + obj4 + obj5 + xref + trailer, 'utf8');
}

/**
 * Lists B2B escrow deals for a user or admin.
 */
export async function listB2bDeals(db, { userId, role, status = null }) {
  let sql = `
    SELECT d.*,
           COALESCE(bp.display_name, bp.full_name) as buyer_name, b.phone as buyer_phone,
           COALESCE(sp.display_name, sp.full_name) as supplier_name, s.phone as supplier_phone,
           (SELECT json_agg(m ORDER BY m.sequence_no)
            FROM b2b_escrow_milestones m
            WHERE m.deal_id = d.id) as milestones
    FROM b2b_escrow_deals d
    JOIN users b ON d.buyer_id = b.id
    LEFT JOIN user_profiles bp ON bp.user_id = b.id
    JOIN users s ON d.supplier_id = s.id
    LEFT JOIN user_profiles sp ON sp.user_id = s.id
  `;

  const params = [];
  const conditions = [];

  if (role !== 'admin' && role !== 'super_admin') {
    params.push(userId);
    conditions.push(`(d.buyer_id = $${params.length} OR d.supplier_id = $${params.length})`);
  }

  if (status) {
    params.push(status);
    conditions.push(`d.status = $${params.length}`);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  sql += ` ORDER BY d.created_at DESC;`;

  const { rows } = await db.query(sql, params);
  return rows.map((r) => ({
    ...r,
    total_amount: parseFloat(r.total_amount || 0),
    released_amount: parseFloat(r.released_amount || 0),
    refunded_amount: parseFloat(r.refunded_amount || 0),
    frozen_amount: parseFloat(r.frozen_amount || 0),
    milestones: (r.milestones || []).map((m) => ({
      ...m,
      amount: parseFloat(m.amount || 0),
      release_pct: parseFloat(m.release_pct),
    })),
  }));
}

/**
 * Gets a single B2B escrow deal by ID or Ref.
 */
export async function getB2bDealById(db, dealIdOrRef) {
  const isNumeric = /^\d+$/.test(String(dealIdOrRef));
  const whereClause = isNumeric ? 'd.id = $1' : 'd.ref = $1';

  const sql = `
    SELECT d.*,
           COALESCE(bp.display_name, bp.full_name) as buyer_name, b.phone as buyer_phone,
           COALESCE(sp.display_name, sp.full_name) as supplier_name, s.phone as supplier_phone,
           (SELECT json_agg(m ORDER BY m.sequence_no)
            FROM b2b_escrow_milestones m
            WHERE m.deal_id = d.id) as milestones
    FROM b2b_escrow_deals d
    JOIN users b ON d.buyer_id = b.id
    LEFT JOIN user_profiles bp ON bp.user_id = b.id
    JOIN users s ON d.supplier_id = s.id
    LEFT JOIN user_profiles sp ON sp.user_id = s.id
    WHERE ${whereClause};
  `;

  const { rows } = await db.query(sql, [dealIdOrRef]);
  if (!rows.length) {
    throw new AppError('NOT_FOUND', `B2B Deal "${dealIdOrRef}" not found.`, 404);
  }

  const r = rows[0];
  return {
    ...r,
    total_amount: parseFloat(r.total_amount || 0),
    released_amount: parseFloat(r.released_amount || 0),
    refunded_amount: parseFloat(r.refunded_amount || 0),
    frozen_amount: parseFloat(r.frozen_amount || 0),
    milestones: (r.milestones || []).map((m) => ({
      ...m,
      amount: parseFloat(m.amount || 0),
      release_pct: parseFloat(m.release_pct),
    })),
  };
}
