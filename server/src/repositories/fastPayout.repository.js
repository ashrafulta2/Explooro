/**
 * fastPayout.repository.js — Raw SQL for early escrow releases.
 * No rules here: the service decides who may take one and what it costs.
 */

export async function getRulesRow(db) {
  const { rows } = await db.query(`SELECT value_json FROM platform_settings WHERE key = 'supplier.fast_payout'`);
  return rows[0] ? rows[0].value_json : null;
}

const ENTRY_COLUMNS = `
  e.id AS entry_id, e.sub_order_id, e.beneficiary_role, e.amount, e.status, e.hold_until,
  w.user_id, w.id AS wallet_id,
  s.ref AS sub_order_ref, s.status AS sub_order_status, s.supplier_id, s.delivered_at,
  o.payment_method AS payment_method,
  c.status AS cod_status,
  EXISTS (SELECT 1 FROM return_requests r
           WHERE r.sub_order_id = e.sub_order_id AND r.status NOT IN ('REJECTED','REFUNDED')) AS has_open_return,
  EXISTS (SELECT 1 FROM dispute_threads d
           WHERE d.sub_order_id = e.sub_order_id AND d.status NOT IN ('RESOLVED','CLOSED')) AS has_open_dispute`;

const ENTRY_JOINS = `
  FROM escrow_entries e
  JOIN wallets w ON w.id = e.wallet_id
  JOIN sub_orders s ON s.id = e.sub_order_id
  JOIN orders o ON o.id = s.order_id
  LEFT JOIN cod_reconciliation c ON c.sub_order_id = e.sub_order_id`;

/** A person's still-locked escrow entries, newest first, each with what is needed to judge it. */
export async function listLockedEntries(db, userId, limit = 100) {
  const { rows } = await db.query(
    `SELECT ${ENTRY_COLUMNS}
     ${ENTRY_JOINS}
      WHERE w.user_id = $1 AND e.status = 'LOCKED' AND e.beneficiary_role IN ('SUPPLIER','SALER')
      ORDER BY e.hold_until ASC, e.id ASC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

/** One entry, locked for the rest of the transaction. Null when it does not exist. */
export async function lockEntry(client, entryId) {
  const { rows } = await client.query(
    `SELECT ${ENTRY_COLUMNS}
     ${ENTRY_JOINS}
      WHERE e.id = $1
      FOR UPDATE OF e`,
    [entryId]
  );
  return rows[0] || null;
}

/** What the person has taken early whose original hold has not ended: the most a return could claw back. */
export async function outstandingAmount(db, userId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(gross_amount), 0) AS total
       FROM fast_payouts
      WHERE user_id = $1 AND original_hold_until > now()`,
    [userId]
  );
  return rows[0].total;
}

export async function markReleased(client, entryId) {
  await client.query(`UPDATE escrow_entries SET status = 'RELEASED', released_at = now() WHERE id = $1`, [entryId]);
}

export async function insertFastPayout(client, p) {
  const { rows } = await client.query(
    `INSERT INTO fast_payouts
       (escrow_entry_id, sub_order_id, user_id, wallet_id, beneficiary_role, gross_amount, fee_pct, fee_amount,
        net_amount, grade, original_hold_until, days_saved, ledger_txn_group_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [p.entryId, p.subOrderId, p.userId, p.walletId, p.role, p.gross, p.feePct, p.fee, p.net, p.grade, p.holdUntil, p.daysSaved, p.txnGroupId]
  );
  return rows[0];
}

export async function listHistory(db, userId, limit = 50) {
  const { rows } = await db.query(
    `SELECT f.id, f.sub_order_id, s.ref AS sub_order_ref, f.beneficiary_role, f.gross_amount, f.fee_pct,
            f.fee_amount, f.net_amount, f.grade, f.days_saved, f.created_at
       FROM fast_payouts f
       JOIN sub_orders s ON s.id = f.sub_order_id
      WHERE f.user_id = $1
      ORDER BY f.id DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}
