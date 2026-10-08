/**
 * volumeIncentive.repository.js — Raw SQL for supplier volume-incentive programmes and payouts.
 * No rules here: the service decides what the numbers mean, this file only reads and stores them.
 */

export async function getRulesRow(db) {
  const { rows } = await db.query(`SELECT value_json FROM platform_settings WHERE key = 'supplier.volume_incentive'`);
  return rows[0] ? rows[0].value_json : null;
}

/**
 * "Today" and the first day of this month as the platform's calendar sees them. Done in SQL so the
 * timezone database is Postgres', and an unknown zone name throws here rather than silently shifting
 * every month boundary.
 */
export async function getLocalCalendar(db, timezone) {
  const { rows } = await db.query(
    `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS today,
            to_char(date_trunc('month', now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS month_start`,
    [timezone]
  );
  return rows[0];
}

/** Every programme version for one supplier, newest first. */
export async function listVersions(db, supplierId) {
  const { rows } = await db.query(
    `SELECT id, supplier_id, to_char(valid_from, 'YYYY-MM-DD') AS valid_from, is_active, tiers_json, created_at
       FROM volume_incentive_programs
      WHERE supplier_id = $1
      ORDER BY valid_from DESC`,
    [supplierId]
  );
  return rows;
}

/**
 * The version in force on `date` for each of the given suppliers (or all, when null): the latest row
 * whose valid_from is on or before it. A paused version is returned too - the caller treats
 * is_active = false as "no programme", which is how pausing ends the earlier tiers.
 */
export async function versionsInForce(db, date, supplierIds = null) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (supplier_id)
            id, supplier_id, to_char(valid_from, 'YYYY-MM-DD') AS valid_from, is_active, tiers_json
       FROM volume_incentive_programs
      WHERE valid_from <= $1::date
        AND ($2::bigint[] IS NULL OR supplier_id = ANY($2::bigint[]))
      ORDER BY supplier_id, valid_from DESC`,
    [date, supplierIds]
  );
  return rows;
}

/** Inserts a new version, or replaces one that has not started yet (same supplier + valid_from). */
export async function upsertVersion(db, { supplierId, validFrom, isActive, tiers, createdBy }) {
  const { rows } = await db.query(
    `INSERT INTO volume_incentive_programs (supplier_id, valid_from, is_active, tiers_json, created_by)
     VALUES ($1, $2::date, $3, $4::jsonb, $5)
     ON CONFLICT (supplier_id, valid_from) DO UPDATE
       SET is_active = EXCLUDED.is_active, tiers_json = EXCLUDED.tiers_json, created_by = EXCLUDED.created_by
     RETURNING id, supplier_id, to_char(valid_from, 'YYYY-MM-DD') AS valid_from, is_active, tiers_json`,
    [supplierId, validFrom, isActive, JSON.stringify(tiers), createdBy]
  );
  return rows[0];
}

/**
 * Delivered volume per saler for the given suppliers in one calendar month (platform timezone).
 *
 * Volume is the goods value: total_amount less shipping. Only DELIVERED counts - and it is read at
 * settlement time, after `settle_lag_days`, so a return that flipped the status in the meantime has
 * already dropped out. A supplier's own account is never a saler of itself.
 */
export async function volumeBySaler(db, { supplierIds, periodStart, periodEnd, timezone }) {
  if (!supplierIds.length) return [];
  const { rows } = await db.query(
    `SELECT supplier_id, saler_id, SUM(total_amount - shipping_amount) AS volume
       FROM sub_orders
      WHERE status = 'DELIVERED'
        AND saler_id IS NOT NULL
        AND saler_id <> supplier_id
        AND supplier_id = ANY($1::bigint[])
        AND delivered_at >= ($2::date)::timestamp AT TIME ZONE $4
        AND delivered_at <  (($3::date) + 1)::timestamp AT TIME ZONE $4
      GROUP BY supplier_id, saler_id`,
    [supplierIds, periodStart, periodEnd, timezone]
  );
  return rows;
}

/** One saler's running volume against each supplier, this month - for the progress cards. */
export async function volumeForSaler(db, { salerId, periodStart, periodEnd, timezone }) {
  const { rows } = await db.query(
    `SELECT supplier_id, SUM(total_amount - shipping_amount) AS volume
       FROM sub_orders
      WHERE status = 'DELIVERED' AND saler_id = $1 AND saler_id <> supplier_id
        AND delivered_at >= ($2::date)::timestamp AT TIME ZONE $4
        AND delivered_at <  (($3::date) + 1)::timestamp AT TIME ZONE $4
      GROUP BY supplier_id`,
    [salerId, periodStart, periodEnd, timezone]
  );
  return rows;
}

/** Inserts the payout row if this supplier x saler x month has none. Returns the row only when new. */
export async function insertPayoutIfAbsent(db, p) {
  const { rows } = await db.query(
    `INSERT INTO volume_incentive_payouts
       (supplier_id, saler_id, period_start, period_end, volume, rebate_pct,
        gross_amount, platform_fee, net_amount, tiers_snapshot)
     VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (supplier_id, saler_id, period_start) DO NOTHING
     RETURNING *`,
    [p.supplierId, p.salerId, p.periodStart, p.periodEnd, p.volume, p.rebatePct, p.gross, p.fee, p.net, JSON.stringify(p.tiers)]
  );
  return rows[0] || null;
}

export async function listOpenPayouts(db) {
  const { rows } = await db.query(
    `SELECT *, to_char(period_start, 'YYYY-MM-DD') AS period_start_s, to_char(period_end, 'YYYY-MM-DD') AS period_end_s
       FROM volume_incentive_payouts WHERE status = 'UNFUNDED' ORDER BY id ASC`
  );
  return rows;
}

/** Locks one payout row so two overlapping job runs cannot both pay it. */
export async function lockPayout(db, payoutId) {
  const { rows } = await db.query(`SELECT * FROM volume_incentive_payouts WHERE id = $1 FOR UPDATE`, [payoutId]);
  return rows[0] || null;
}

export async function markPaid(db, payoutId, txnGroupId) {
  await db.query(
    `UPDATE volume_incentive_payouts SET status = 'PAID', ledger_txn_group_id = $2, paid_at = now() WHERE id = $1`,
    [payoutId, txnGroupId]
  );
}

export async function markLapsed(db, payoutId) {
  await db.query(`UPDATE volume_incentive_payouts SET status = 'LAPSED' WHERE id = $1 AND status = 'UNFUNDED'`, [payoutId]);
}

const PAYOUT_COLUMNS = `id, supplier_id, saler_id, to_char(period_start, 'YYYY-MM-DD') AS period_start,
       to_char(period_end, 'YYYY-MM-DD') AS period_end, volume, rebate_pct, gross_amount, platform_fee,
       net_amount, status, paid_at, created_at`;

export async function listPayoutsForSupplier(db, supplierId, limit = 50) {
  const { rows } = await db.query(
    `SELECT ${PAYOUT_COLUMNS} FROM volume_incentive_payouts
      WHERE supplier_id = $1 ORDER BY period_start DESC, id DESC LIMIT $2`,
    [supplierId, limit]
  );
  return rows;
}

export async function listPayoutsForSaler(db, salerId, limit = 50) {
  const { rows } = await db.query(
    `SELECT p.id, p.supplier_id, p.saler_id, to_char(p.period_start, 'YYYY-MM-DD') AS period_start,
            to_char(p.period_end, 'YYYY-MM-DD') AS period_end, p.volume, p.rebate_pct, p.gross_amount,
            p.platform_fee, p.net_amount, p.status, p.paid_at, p.created_at,
            COALESCE(NULLIF(up.display_name, ''), NULLIF(up.full_name, ''), 'Supplier') AS supplier_name
       FROM volume_incentive_payouts p
       LEFT JOIN user_profiles up ON up.user_id = p.supplier_id
      WHERE p.saler_id = $1 ORDER BY p.period_start DESC, p.id DESC LIMIT $2`,
    [salerId, limit]
  );
  return rows;
}
