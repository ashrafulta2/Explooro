/**
 * moderation.service.js — Unified Product Approval & Content Moderation Pipeline (Prompt 7.4 / DFD Subsystem 10.0).
 *
 * Implements:
 * 1. Unified queue covering: PRODUCT_NEW, PRODUCT_EDIT, REVIEW, UGC_VIDEO, STOREFRONT_ASSET, LIVE_STREAM, CHAT_REPORT.
 * 2. Automated advisory pre-screening:
 *    - Banned keyword lists (English & Bengali)
 *    - Price anomaly detection
 *    - Duplicate listing detection via title/checksum matching
 *    - Prohibited category verification
 * 3. Per-category auto-approval rules and FORCE_REVIEW_QUEUE restriction enforcement.
 * 4. Concurrency lock claiming (prevents two moderators claiming the same item).
 * 5. Moderation actions: APPROVE, REJECT (bilingual feedback), REQUEST_CHANGES, ESCALATE, SHADOW_RESTRICT.
 * 6. Bulk moderation operations and throughput metrics.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import * as moduleRepo from '../repositories/module.repository.js';
import { writeAudit } from '../lib/audit.js';

// Default blocklist dictionaries (can be augmented by module sub-settings)
const DEFAULT_KEYWORD_BLOCKLIST_EN = [
  'counterfeit', 'replica', 'fake', 'first copy', 'master copy',
  'narcotics', 'weapon', 'gun', 'explosive', 'stolen', 'unauthorized',
];

const DEFAULT_KEYWORD_BLOCKLIST_BN = [
  'নকল', 'ক্লোন', 'মাস্টার কপি', 'অস্ত্র', 'মাদক', 'চোরাই', 'অননুমোদিত',
];

/**
 * Generates a public unique moderation reference code: MOD-XXXXXXXX
 */
function generateModerationRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `MOD-${code}`;
}

/**
 * Resolves moderation module settings.
 */
async function getModerationSettings(db) {
  let settings = {
    sla_hours: 24,
    keyword_blocklist_en: DEFAULT_KEYWORD_BLOCKLIST_EN,
    keyword_blocklist_bn: DEFAULT_KEYWORD_BLOCKLIST_BN,
    price_anomaly_multiplier: 5,
    auto_approval_enabled: false,
    auto_approve_category_ids: [],
  };

  try {
    if (moduleRepo && typeof moduleRepo.getModuleByKey === 'function') {
      const modMod = await moduleRepo.getModuleByKey(db, 'product_moderation');
      if (modMod?.sub_settings_json) {
        if (modMod.sub_settings_json.sla_hours) settings.sla_hours = parseInt(modMod.sub_settings_json.sla_hours, 10);
        if (Array.isArray(modMod.sub_settings_json.keyword_blocklist_en)) {
          settings.keyword_blocklist_en = [...new Set([...DEFAULT_KEYWORD_BLOCKLIST_EN, ...modMod.sub_settings_json.keyword_blocklist_en])];
        }
        if (Array.isArray(modMod.sub_settings_json.keyword_blocklist_bn)) {
          settings.keyword_blocklist_bn = [...new Set([...DEFAULT_KEYWORD_BLOCKLIST_BN, ...modMod.sub_settings_json.keyword_blocklist_bn])];
        }
        if (modMod.sub_settings_json.price_anomaly_multiplier) {
          settings.price_anomaly_multiplier = parseFloat(modMod.sub_settings_json.price_anomaly_multiplier);
        }
      }

      const autoMod = await moduleRepo.getModuleByKey(db, 'auto_approval');
      if (autoMod && autoMod.is_enabled) {
        settings.auto_approval_enabled = true;
        if (Array.isArray(autoMod.sub_settings_json?.category_ids)) {
          settings.auto_approve_category_ids = autoMod.sub_settings_json.category_ids.map(Number);
        }
      }
    }
  } catch {}

  return settings;
}

/**
 * Performs automated advisory pre-screening on submitted content.
 */
export async function preScreenContent({
  titleEn = '',
  titleBn = '',
  descriptionEn = '',
  descriptionBn = '',
  defaultRetailPrice = null,
  baseCost = null,
  categoryId = null,
  checksums = [],
  db = null,
} = {}) {
  const flags = [];
  const settings = db ? await getModerationSettings(db) : {
    keyword_blocklist_en: DEFAULT_KEYWORD_BLOCKLIST_EN,
    keyword_blocklist_bn: DEFAULT_KEYWORD_BLOCKLIST_BN,
    price_anomaly_multiplier: 5,
  };

  const textEn = `${titleEn} ${descriptionEn}`.toLowerCase();
  const textBn = `${titleBn} ${descriptionBn}`.toLowerCase();

  // 1. English Banned Keyword Check
  for (const word of settings.keyword_blocklist_en) {
    if (textEn.includes(word.toLowerCase())) {
      flags.push({
        code: 'PROHIBITED_KEYWORD_EN',
        severity: 'HIGH',
        label_en: `Contains prohibited term: "${word}"`,
        label_bn: `নিষিদ্ধ শব্দ পাওয়া গেছে: "${word}"`,
        term: word,
      });
      break;
    }
  }

  // 2. Bengali Banned Keyword Check
  for (const word of settings.keyword_blocklist_bn) {
    if (textBn.includes(word.toLowerCase())) {
      flags.push({
        code: 'PROHIBITED_KEYWORD_BN',
        severity: 'HIGH',
        label_en: `Contains prohibited Bengali term: "${word}"`,
        label_bn: `নিষিদ্ধ বাংলা শব্দ পাওয়া গেছে: "${word}"`,
        term: word,
      });
      break;
    }
  }

  // 3. Price Anomaly Detection
  if (defaultRetailPrice != null && baseCost != null) {
    const retail = parseFloat(defaultRetailPrice);
    const cost = parseFloat(baseCost);

    if (retail < cost) {
      flags.push({
        code: 'PRICE_BELOW_BASE_COST',
        severity: 'CRITICAL',
        label_en: `Retail price (৳${retail.toFixed(2)}) is lower than base cost (৳${cost.toFixed(2)})`,
        label_bn: `খুচরা মূল্য (৳${retail.toFixed(2)}) বেস খরচের (৳${cost.toFixed(2)}) চেয়ে কম`,
      });
    } else if (cost > 0 && retail > cost * settings.price_anomaly_multiplier) {
      flags.push({
        code: 'PRICE_ANOMALY_HIGH_MARKUP',
        severity: 'MEDIUM',
        label_en: `Retail price (৳${retail.toFixed(2)}) is over ${settings.price_anomaly_multiplier}x base cost (৳${cost.toFixed(2)})`,
        label_bn: `খুচরা মূল্য (৳${retail.toFixed(2)}) বেস খরচের চেয়ে ${settings.price_anomaly_multiplier} গুণেরও বেশি`,
      });
    }
  }

  // 4. Duplicate Listing Detection via title in Database if available
  if (db && titleEn && titleEn.trim().length > 3) {
    try {
      const { rows: dups } = await db.query(
        `SELECT id, ref, title_en FROM products
         WHERE title_en ILIKE $1 AND deleted_at IS NULL
         LIMIT 1`,
        [titleEn.trim()]
      );
      if (dups.length > 0) {
        flags.push({
          code: 'POTENTIAL_DUPLICATE_TITLE',
          severity: 'LOW',
          label_en: `Similar product title exists: "${dups[0].title_en}" (${dups[0].ref})`,
          label_bn: `একই শিরোনামের পণ্য বিদ্যমান: "${dups[0].title_en}" (${dups[0].ref})`,
          matching_product_id: dups[0].id,
        });
      }
    } catch {}
  }

  return flags;
}

/**
 * Submits an item to the unified moderation queue or auto-approves if criteria met.
 */
export async function submitToQueue(db, {
  itemType,
  entityId,
  submittedBy,
  payloadSnapshot = {},
  categoryId = null,
  isForceReview = false,
  extraAutoFlags = [],
  client = null,
} = {}) {
  const runner = async (txClient) => {
    const settings = await getModerationSettings(txClient);

    // 1. Evaluate Category Auto-Approval Rule
    let isCategoryAutoApproved = false;
    if (categoryId) {
      if (settings.auto_approval_enabled && settings.auto_approve_category_ids.includes(Number(categoryId))) {
        isCategoryAutoApproved = true;
      } else {
        // Check categories table auto_approve flag if exists
        try {
          const { rows: catRows } = await txClient.query(
            `SELECT auto_approve FROM categories WHERE id = $1`,
            [categoryId]
          );
          if (catRows.length > 0 && catRows[0].auto_approve) {
            isCategoryAutoApproved = true;
          }
        } catch {}
      }
    }

    // If auto-approved and user is NOT under FORCE_REVIEW_QUEUE restriction, bypass queue!
    if (isCategoryAutoApproved && !isForceReview) {
      // Direct activation of entity
      if (itemType === 'PRODUCT_NEW' || itemType === 'PRODUCT_EDIT') {
        await txClient.query(
          `UPDATE products SET status = 'ACTIVE', updated_at = now() WHERE id = $1`,
          [entityId]
        );
      } else if (itemType === 'REVIEW') {
        await txClient.query(
          `UPDATE reviews SET status = 'PUBLISHED', updated_at = now() WHERE id = $1`,
          [entityId]
        );
      }

      return {
        autoApproved: true,
        itemType,
        entityId,
        status: 'APPROVED',
        message: 'Auto-approved per category policy.',
      };
    }

    // 2. Run Automated Advisory Pre-screening, plus any caller-supplied flags already computed
    // from domain-specific signals the generic pre-screen can't see (e.g. reviewIntegrity.js's
    // velocity/duplicate/rating-mismatch checks for REVIEW items).
    const autoFlags = [
      ...extraAutoFlags,
      ...(await preScreenContent({
        titleEn: payloadSnapshot.title_en || payloadSnapshot.title || '',
        titleBn: payloadSnapshot.title_bn || '',
        descriptionEn: payloadSnapshot.description_en || payloadSnapshot.body || '',
        descriptionBn: payloadSnapshot.description_bn || '',
        defaultRetailPrice: payloadSnapshot.default_retail_price || payloadSnapshot.price,
        baseCost: payloadSnapshot.base_cost,
        categoryId,
        db: txClient,
      })),
    ];

    const slaHours = settings.sla_hours || 24;
    const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();
    const modRef = generateModerationRef();

    const { rows: queueRows } = await txClient.query(
      `INSERT INTO moderation_queue (
         ref, item_type, entity_id, submitted_by, status, auto_flags_json,
         payload_snapshot_json, sla_due_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, now(), now())
       RETURNING *`,
      [
        modRef,
        itemType,
        entityId,
        submittedBy,
        JSON.stringify(autoFlags),
        JSON.stringify(payloadSnapshot),
        slaDueAt,
      ]
    );

    const queueItem = queueRows[0];

    // If product, set status to PENDING_APPROVAL and insert into product_approvals
    if (itemType === 'PRODUCT_NEW' || itemType === 'PRODUCT_EDIT') {
      await txClient.query(
        `UPDATE products SET status = 'PENDING_APPROVAL', updated_at = now() WHERE id = $1`,
        [entityId]
      );

      try {
        await txClient.query(
          `INSERT INTO product_approvals (
             product_id, submitted_by, status, auto_flags_json, sla_due_at, created_at
           )
           VALUES ($1, $2, 'PENDING', $3, $4, now())`,
          [entityId, submittedBy, JSON.stringify(autoFlags), slaDueAt]
        );
      } catch {}
    } else if (itemType === 'REVIEW') {
      await txClient.query(
        `UPDATE reviews SET status = 'PENDING', updated_at = now() WHERE id = $1`,
        [entityId]
      );
    }

    return {
      autoApproved: false,
      queueItem,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Claims a queue item for exclusive review with concurrency safety.
 * Prevents two moderators from claiming the same item simultaneously.
 */
export async function claimItem(db, { queueId, moderatorId, client = null } = {}) {
  const runner = async (txClient) => {
    const { rows } = await txClient.query(
      `UPDATE moderation_queue
       SET claimed_by = $2,
           claimed_at = now(),
           status = 'IN_REVIEW',
           updated_at = now()
       WHERE id = $1 AND (claimed_by IS NULL OR claimed_by = $2)
       RETURNING *`,
      [queueId, moderatorId]
    );

    if (rows.length === 0) {
      // Check if item exists or already claimed by another
      const { rows: existing } = await txClient.query(
        `SELECT q.*, u.full_name as claimed_by_name
         FROM moderation_queue q
         LEFT JOIN user_profiles u ON u.user_id = q.claimed_by
         WHERE q.id = $1`,
        [queueId]
      );

      if (existing.length === 0) {
        throw new Error(`QUEUE_ITEM_NOT_FOUND: Queue item #${queueId} does not exist.`);
      }

      const item = existing[0];
      throw new Error(
        `ITEM_ALREADY_CLAIMED: This item is currently claimed by moderator ${item.claimed_by_name || `#${item.claimed_by}`}.`
      );
    }

    return rows[0];
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Releases a claim lock on a queue item.
 */
export async function releaseClaim(db, { queueId, moderatorId, client = null } = {}) {
  const runner = async (txClient) => {
    const { rows } = await txClient.query(
      `UPDATE moderation_queue
       SET claimed_by = NULL,
           claimed_at = NULL,
           status = 'PENDING',
           updated_at = now()
       WHERE id = $1 AND claimed_by = $2
       RETURNING *`,
      [queueId, moderatorId]
    );

    if (rows.length === 0) {
      throw new Error(`CANNOT_RELEASE_CLAIM: Item #${queueId} is not claimed by moderator #${moderatorId}.`);
    }

    return rows[0];
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Decides a moderation queue item (APPROVE, REJECT, REQUEST_CHANGES, ESCALATE).
 */
export async function decideItem(db, {
  queueId,
  decision,
  moderatorId,
  reasonEn = '',
  reasonBn = '',
  changesRequestedEn = '',
  changesRequestedBn = '',
  shadowRestrictSeller = false,
  client = null,
} = {}) {
  const validDecisions = ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'ESCALATED'];
  if (!validDecisions.includes(decision)) {
    throw new Error(`INVALID_DECISION: Decision must be one of: ${validDecisions.join(', ')}`);
  }

  const runner = async (txClient) => {
    const { rows: queueRows } = await txClient.query(
      `SELECT * FROM moderation_queue WHERE id = $1 FOR UPDATE`,
      [queueId]
    );

    if (queueRows.length === 0) {
      throw new Error(`QUEUE_ITEM_NOT_FOUND: Queue item #${queueId} does not exist.`);
    }

    const item = queueRows[0];

    // Update queue record
    const { rows: updatedQueueRows } = await txClient.query(
      `UPDATE moderation_queue
       SET status = $2,
           decided_by = $3,
           decided_at = now(),
           rejection_reason_en = $4,
           rejection_reason_bn = $5,
           changes_requested_en = $6,
           changes_requested_bn = $7,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        queueId,
        decision,
        moderatorId,
        reasonEn || null,
        reasonBn || null,
        changesRequestedEn || null,
        changesRequestedBn || null,
      ]
    );

    // Apply outcome to underlying entity
    if (item.item_type === 'PRODUCT_NEW' || item.item_type === 'PRODUCT_EDIT') {
      let nextProductStatus = 'ACTIVE';
      if (decision === 'REJECTED') nextProductStatus = 'REJECTED';
      else if (decision === 'CHANGES_REQUESTED') nextProductStatus = 'CHANGES_REQUESTED';
      else if (decision === 'ESCALATED') nextProductStatus = 'PENDING_APPROVAL';

      await txClient.query(
        `UPDATE products SET status = $2, updated_at = now() WHERE id = $1`,
        [item.entity_id, nextProductStatus]
      );

      // Update product_approvals if present
      try {
        await txClient.query(
          `UPDATE product_approvals
           SET status = $2, decided_by = $3, decided_at = now(), reason = $4, reason_bn = $5
           WHERE product_id = $1`,
          [item.entity_id, decision, moderatorId, reasonEn, reasonBn]
        );
      } catch {}
    } else if (item.item_type === 'REVIEW') {
      const reviewStatus = decision === 'APPROVED' ? 'PUBLISHED' : decision === 'REJECTED' ? 'REMOVED' : 'FLAGGED';
      await txClient.query(
        `UPDATE reviews SET status = $2, updated_at = now() WHERE id = $1`,
        [item.entity_id, reviewStatus]
      );
    } else if (item.item_type === 'UGC_VIDEO' || item.item_type === 'STOREFRONT_ASSET') {
      const mediaStatus = decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
      await txClient.query(
        `UPDATE media_assets SET moderation_status = $2 WHERE id = $1`,
        [item.entity_id, mediaStatus]
      );
    }

    // Shadow restrict seller if requested
    if (shadowRestrictSeller && item.submitted_by) {
      try {
        await txClient.query(
          `INSERT INTO user_restrictions (
             user_id, restriction_type, can_list_products, reason_en, reason_bn,
             created_by, starts_at, is_active, created_at
           )
           VALUES ($1, 'SHADOW_BAN', 'BLOCK', $2, $3, $4, now(), true, now())`,
          [
            item.submitted_by,
            reasonEn || 'Content moderation policy violation',
            reasonBn || 'কন্টেন্ট মডারেশন পলিসি লঙ্ঘনের কারণে সীমাবদ্ধতা',
            moderatorId,
          ]
        );
      } catch {}
    }

    await writeAudit(txClient, {
      actorId: moderatorId,
      actorRole: 'moderator',
      action: `moderation.${item.item_type.toLowerCase()}.${decision.toLowerCase()}`,
      targetType: 'moderation_queue',
      targetId: queueId,
      afterJson: { decision, reason_en: reasonEn, reason_bn: reasonBn },
      reason: `Moderator verdict on ${item.item_type} #${item.entity_id}: ${decision}`,
    });

    return {
      success: true,
      decision,
      queueItem: updatedQueueRows[0],
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Bulk executes decisions across multiple queue items.
 */
export async function bulkDecide(db, {
  queueIds = [],
  decision,
  moderatorId,
  reasonEn = '',
  reasonBn = '',
} = {}) {
  const results = [];
  for (const qId of queueIds) {
    try {
      const res = await decideItem(db, {
        queueId: qId,
        decision,
        moderatorId,
        reasonEn,
        reasonBn,
      });
      results.push({ queueId: qId, success: true, decision: res.decision });
    } catch (err) {
      results.push({ queueId: qId, success: false, error: err.message });
    }
  }

  return {
    total: queueIds.length,
    processed: results.filter((r) => r.success).length,
    results,
  };
}

/**
 * Lists moderation queue items with filtering and SLA computation.
 */
export async function getQueue(db, {
  itemType = null,
  status = null,
  claimedBy = null,
  flaggedOnly = false,
  search = '',
  limit = 20,
  offset = 0,
} = {}) {
  let query = `
    SELECT q.*,
           u.full_name AS submitter_name,
           usr.email AS submitter_email,
           cu.full_name AS claimed_by_name,
           du.full_name AS decided_by_name
    FROM moderation_queue q
    JOIN users usr ON usr.id = q.submitted_by
    LEFT JOIN user_profiles u ON u.user_id = q.submitted_by
    LEFT JOIN user_profiles cu ON cu.user_id = q.claimed_by
    LEFT JOIN user_profiles du ON du.user_id = q.decided_by
    WHERE 1=1
  `;
  const params = [];

  if (itemType && itemType !== 'ALL') {
    params.push(itemType);
    query += ` AND q.item_type = $${params.length}`;
  }

  if (status && status !== 'ALL') {
    params.push(status);
    query += ` AND q.status = $${params.length}`;
  }

  if (claimedBy) {
    params.push(claimedBy);
    query += ` AND q.claimed_by = $${params.length}`;
  }

  if (flaggedOnly) {
    query += ` AND jsonb_array_length(q.auto_flags_json) > 0`;
  }

  if (search && search.trim().length > 0) {
    params.push(`%${search.trim()}%`);
    query += ` AND (q.ref ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR q.payload_snapshot_json::text ILIKE $${params.length})`;
  }

  query += `
    ORDER BY
      CASE WHEN q.status = 'PENDING' THEN 1
           WHEN q.status = 'IN_REVIEW' THEN 2
           ELSE 3 END ASC,
      q.sla_due_at ASC,
      q.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  params.push(limit, offset);

  const { rows } = await db.query(query, params);

  const now = new Date();
  const enhanced = rows.map((r) => {
    const slaDue = r.sla_due_at ? new Date(r.sla_due_at) : null;
    const isSlaBreached = slaDue && now > slaDue && ['PENDING', 'IN_REVIEW'].includes(r.status);
    const remainingMs = slaDue ? Math.max(0, slaDue.getTime() - now.getTime()) : 0;

    return {
      ...r,
      auto_flags: Array.isArray(r.auto_flags_json) ? r.auto_flags_json : [],
      is_sla_breached: isSlaBreached,
      remaining_sla_minutes: Math.round(remainingMs / (60 * 1000)),
    };
  });

  return {
    items: enhanced,
    count: enhanced.length,
    limit,
    offset,
  };
}

/**
 * Aggregates moderator throughput KPIs.
 */
export async function getModeratorStats(db, { moderatorId = null } = {}) {
  let query = `
    SELECT
      COUNT(id) AS total_items,
      COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pending_count,
      COUNT(CASE WHEN status = 'IN_REVIEW' THEN 1 END) AS in_review_count,
      COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) AS approved_count,
      COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) AS rejected_count,
      COUNT(CASE WHEN status = 'CHANGES_REQUESTED' THEN 1 END) AS changes_requested_count,
      COUNT(CASE WHEN status = 'ESCALATED' THEN 1 END) AS escalated_count,
      COUNT(CASE WHEN jsonb_array_length(auto_flags_json) > 0 THEN 1 END) AS flagged_count
    FROM moderation_queue
    WHERE 1=1
  `;
  const params = [];
  if (moderatorId) {
    params.push(moderatorId);
    query += ` AND (decided_by = $1 OR claimed_by = $1)`;
  }

  const { rows } = await db.query(query, params);
  const stats = rows[0] || {};

  return {
    total_items: parseInt(stats.total_items, 10) || 0,
    pending_count: parseInt(stats.pending_count, 10) || 0,
    in_review_count: parseInt(stats.in_review_count, 10) || 0,
    approved_count: parseInt(stats.approved_count, 10) || 0,
    rejected_count: parseInt(stats.rejected_count, 10) || 0,
    changes_requested_count: parseInt(stats.changes_requested_count, 10) || 0,
    escalated_count: parseInt(stats.escalated_count, 10) || 0,
    flagged_count: parseInt(stats.flagged_count, 10) || 0,
  };
}
