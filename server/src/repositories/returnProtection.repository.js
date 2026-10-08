/**
 * returnProtection.repository.js — Raw SQL for return-protection enrolments and covers.
 * No rules here: the service decides what the numbers mean, this file only reads and stores them.
 */

export async function getRulesRow(db) {
  const { rows } = await db.query(`SELECT value_json FROM platform_settings WHERE key = 'supplier.return_protection'`);
  return rows[0] ? rows[0].value_json : null;
}

// ---- enrolment --------------------------------------------------------------------------------------------

export async function getOpenEnrollment(db, supplierId) {
  const { rows } = await db.query(
    `SELECT * FROM return_protection_enrollments WHERE supplier_id = $1 AND ended_at IS NULL`,
    [supplierId]
  );
  return rows[0] || null;
}

/** Opens an enrolment. Null when one is already open (the partial unique index decides, so a race is safe). */
export async function openEnrollment(db, supplierId) {
  const { rows } = await db.query(
    `INSERT INTO return_protection_enrollments (supplier_id) VALUES ($1)
     ON CONFLICT (supplier_id) WHERE ended_at IS NULL DO NOTHING
     RETURNING *`,
    [supplierId]
  );
  return rows[0] || null;
}

export async function closeEnrollment(db, supplierId) {
  const { rows } = await db.query(
    `UPDATE return_protection_enrollments SET ended_at = now()
      WHERE supplier_id = $1 AND ended_at IS NULL
      RETURNING *`,
    [supplierId]
  );
  return rows[0] || null;
}

// ---- covers -----------------------------------------------------------------------------------------------

/** The sub-order facts a cover is made from, plus whether its supplier was enrolled when it was placed. */
export async function getSubOrderForCover(db, subOrderId) {
  const { rows } = await db.query(
    `SELECT s.id, s.supplier_id, s.saler_id, s.saler_commission, s.created_at,
            EXISTS (SELECT 1 FROM return_protection_enrollments e
                     WHERE e.supplier_id = s.supplier_id
                       AND e.started_at <= s.created_at
                       AND (e.ended_at IS NULL OR e.ended_at > s.created_at)) AS was_enrolled
       FROM sub_orders s
      WHERE s.id = $1`,
    [subOrderId]
  );
  return rows[0] || null;
}

export async function insertCover(db, c) {
  const { rows } = await db.query(
    `INSERT INTO return_protection_covers (sub_order_id, supplier_id, saler_id, insured_amount, premium_pct, premium_amount)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sub_order_id) DO NOTHING
     RETURNING *`,
    [c.subOrderId, c.supplierId, c.salerId, c.insured, c.premiumPct, c.premium]
  );
  return rows[0] || null;
}

export async function lockCover(client, subOrderId) {
  const { rows } = await client.query(`SELECT * FROM return_protection_covers WHERE sub_order_id = $1 FOR UPDATE`, [subOrderId]);
  return rows[0] || null;
}

export async function markPremiumCharged(client, coverId, txnGroupId) {
  await client.query(
    `UPDATE return_protection_covers SET premium_charged_at = now(), premium_txn_group_id = $2 WHERE id = $1`,
    [coverId, txnGroupId]
  );
}

export async function markClaimed(client, coverId, { amount, txnGroupId, returnRequestId }) {
  await client.query(
    `UPDATE return_protection_covers
        SET status = 'CLAIMED', claim_amount = $2, claim_txn_group_id = $3, claimed_at = now(), return_request_id = $4
      WHERE id = $1`,
    [coverId, amount, txnGroupId, returnRequestId]
  );
}

export async function markDenied(client, coverId, reason, returnRequestId) {
  await client.query(
    `UPDATE return_protection_covers SET status = 'DENIED', denied_reason = $2, return_request_id = $3 WHERE id = $1`,
    [coverId, reason, returnRequestId]
  );
}

/** What the clawback took from the saler on this order (their own escrow entry). */
export async function getSalerEscrowEntry(db, subOrderId, salerId) {
  const { rows } = await db.query(
    `SELECT e.id, e.amount, e.status
       FROM escrow_entries e
       JOIN wallets w ON w.id = e.wallet_id
      WHERE e.sub_order_id = $1 AND e.beneficiary_role = 'SALER' AND w.user_id = $2`,
    [subOrderId, salerId]
  );
  return rows[0] || null;
}

export async function countRecentClaims(db, salerId, days) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM return_protection_covers
      WHERE saler_id = $1 AND status = 'CLAIMED' AND claimed_at > now() - ($2 || ' days')::interval`,
    [salerId, String(days)]
  );
  return rows[0].n;
}

// ---- sweeps (the job) -------------------------------------------------------------------------------------

/**
 * Sub-orders whose premium is due: the supplier's money has been released, the supplier was enrolled when
 * the order was placed, and no premium has been charged yet. Covers that were never created are found too.
 */
export async function listPremiumDue(db, limit) {
  const { rows } = await db.query(
    `SELECT s.id
       FROM sub_orders s
       JOIN escrow_entries e ON e.sub_order_id = s.id AND e.beneficiary_role = 'SUPPLIER' AND e.status = 'RELEASED'
       LEFT JOIN return_protection_covers c ON c.sub_order_id = s.id
      WHERE s.saler_id IS NOT NULL AND s.saler_commission > 0
        AND (c.id IS NULL OR (c.status = 'ACTIVE' AND c.premium_charged_at IS NULL))
        AND EXISTS (SELECT 1 FROM return_protection_enrollments en
                     WHERE en.supplier_id = s.supplier_id
                       AND en.started_at <= s.created_at
                       AND (en.ended_at IS NULL OR en.ended_at > s.created_at))
      ORDER BY s.id
      LIMIT $1`,
    [limit]
  );
  return rows.map((r) => r.id);
}

/**
 * Refunded returns of covered orders whose claim was never settled: the safety net for a claim that failed
 * at the moment of the refund. The claim runs in a savepoint, so a failure also rolls back the cover row it
 * had just made - which is why this looks at the order and its enrolment, not only at existing covers.
 * Bounded to recent refunds so the sweep never rescans history.
 */
export async function listClaimsDue(db, limit) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (s.id) s.id AS sub_order_id, r.id AS return_request_id
       FROM return_requests r
       JOIN sub_orders s ON s.id = r.sub_order_id
       LEFT JOIN return_protection_covers c ON c.sub_order_id = s.id
      WHERE r.status = 'REFUNDED' AND r.refunded_at > now() - interval '60 days'
        AND s.saler_id IS NOT NULL AND s.saler_commission > 0
        AND (c.id IS NULL OR c.status = 'ACTIVE')
        AND EXISTS (SELECT 1 FROM return_protection_enrollments en
                     WHERE en.supplier_id = s.supplier_id
                       AND en.started_at <= s.created_at
                       AND (en.ended_at IS NULL OR en.ended_at > s.created_at))
      ORDER BY s.id, r.id
      LIMIT $1`,
    [limit]
  );
  return rows;
}

// ---- views ------------------------------------------------------------------------------------------------

export async function supplierStats(db, supplierId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS covers,
            COUNT(*) FILTER (WHERE status = 'CLAIMED')::int AS claims,
            COALESCE(SUM(claim_amount) FILTER (WHERE status = 'CLAIMED'), 0) AS claimed_total,
            COALESCE(SUM(premium_amount) FILTER (WHERE premium_charged_at IS NOT NULL), 0) AS premiums_paid
       FROM return_protection_covers WHERE supplier_id = $1`,
    [supplierId]
  );
  return rows[0];
}

export async function listCoversForSupplier(db, supplierId, limit = 50) {
  const { rows } = await db.query(
    `SELECT c.id, s.ref AS sub_order_ref, c.insured_amount, c.premium_pct, c.premium_amount, c.premium_charged_at,
            c.status, c.claim_amount, c.claimed_at, c.denied_reason, c.created_at
       FROM return_protection_covers c
       JOIN sub_orders s ON s.id = c.sub_order_id
      WHERE c.supplier_id = $1
      ORDER BY c.id DESC
      LIMIT $2`,
    [supplierId, limit]
  );
  return rows;
}

export async function listCoversForSaler(db, salerId, limit = 50) {
  const { rows } = await db.query(
    `SELECT c.id, s.ref AS sub_order_ref, c.insured_amount, c.status, c.claim_amount, c.claimed_at,
            c.denied_reason, c.created_at
       FROM return_protection_covers c
       JOIN sub_orders s ON s.id = c.sub_order_id
      WHERE c.saler_id = $1
      ORDER BY c.id DESC
      LIMIT $2`,
    [salerId, limit]
  );
  return rows;
}

/** Suppliers a saler can currently sell for with cover, with their name where one is known. */
export async function listProtectedSuppliers(db, limit = 100) {
  const { rows } = await db.query(
    `SELECT e.supplier_id, COALESCE(up.display_name, up.full_name) AS supplier_name, e.started_at
       FROM return_protection_enrollments e
       JOIN users u ON u.id = e.supplier_id
       LEFT JOIN user_profiles up ON up.user_id = e.supplier_id
      WHERE e.ended_at IS NULL
      ORDER BY e.started_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

/** True once the supplier's escrow entry on this order has been released to them. */
export async function isSupplierReleased(db, subOrderId) {
  const { rows } = await db.query(
    `SELECT 1 FROM escrow_entries WHERE sub_order_id = $1 AND beneficiary_role = 'SUPPLIER' AND status = 'RELEASED' LIMIT 1`,
    [subOrderId]
  );
  return rows.length > 0;
}
