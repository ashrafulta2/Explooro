/**
 * adProduct.repository.js — SQL only for the ad product catalogue and reserved-slot inventory.
 *
 * No business rules here: pricing lives in services/adPricing.js, policy in
 * services/adProducts.service.js. This file just moves rows.
 */

/**
 * Lists ad products. `onlyEnabled` is what the seller-facing catalogue uses; the admin rate-card
 * editor lists everything, including formats that are switched off.
 */
export async function listProducts(db, { onlyEnabled = false, role = null } = {}) {
  const where = [];
  const params = [];

  if (onlyEnabled) where.push('is_enabled = true');
  if (role) {
    params.push(role);
    where.push(`$${params.length} = ANY(allowed_roles)`);
  }

  const { rows } = await db.query(
    `SELECT * FROM ad_products
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY sort_order ASC, id ASC`,
    params
  );
  return rows;
}

export async function getProductByKey(db, key, { client } = {}) {
  const runner = client ?? db;
  const { rows } = await runner.query(`SELECT * FROM ad_products WHERE key = $1`, [key]);
  return rows[0] || null;
}

export async function getProductById(db, id, { client } = {}) {
  const runner = client ?? db;
  const { rows } = await runner.query(`SELECT * FROM ad_products WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function updateProduct(client, id, fields) {
  const { rows } = await client.query(
    `UPDATE ad_products
     SET rate_card       = COALESCE($1::jsonb, rate_card),
         is_enabled      = COALESCE($2, is_enabled),
         requires_review = COALESCE($3, requires_review),
         badge_key       = CASE WHEN $4::text = '__CLEAR__' THEN NULL ELSE COALESCE($4, badge_key) END,
         allowed_roles   = COALESCE($5::text[], allowed_roles),
         sort_order      = COALESCE($6, sort_order),
         name_en         = COALESCE($7, name_en),
         name_bn         = COALESCE($8, name_bn),
         tagline_en      = COALESCE($9, tagline_en),
         tagline_bn      = COALESCE($10, tagline_bn),
         updated_by      = $11,
         updated_at      = now()
     WHERE id = $12
     RETURNING *`,
    [
      fields.rate_card ? JSON.stringify(fields.rate_card) : null,
      fields.is_enabled ?? null,
      fields.requires_review ?? null,
      fields.badge_key ?? null,
      fields.allowed_roles ?? null,
      fields.sort_order ?? null,
      fields.name_en ?? null,
      fields.name_bn ?? null,
      fields.tagline_en ?? null,
      fields.tagline_bn ?? null,
      fields.updated_by ?? null,
      id,
    ]
  );
  return rows[0] || null;
}

/**
 * Counts how many of a slot's daily positions are already taken for each day in a range.
 * Returns rows of { booking_date, taken }.
 */
export async function getSlotUsage(db, slotKey, fromDate, toDate, { client } = {}) {
  const runner = client ?? db;
  const { rows } = await runner.query(
    `SELECT booking_date, COUNT(*)::int AS taken
     FROM ad_slot_bookings
     WHERE slot_key = $1 AND booking_date >= $2 AND booking_date <= $3
     GROUP BY booking_date
     ORDER BY booking_date`,
    [slotKey, fromDate, toDate]
  );
  return rows;
}

/**
 * Which slot_index values are free on EVERY day of the range — a booking must hold the same
 * position for its whole run, so the seller's banner does not hop between positions mid-campaign.
 */
export async function findFreeSlotIndex(client, slotKey, fromDate, toDate, slotsPerPeriod) {
  const { rows } = await client.query(
    `SELECT DISTINCT slot_index
     FROM ad_slot_bookings
     WHERE slot_key = $1 AND booking_date >= $2 AND booking_date <= $3`,
    [slotKey, fromDate, toDate]
  );
  const taken = new Set(rows.map((r) => r.slot_index));
  for (let i = 1; i <= slotsPerPeriod; i += 1) {
    if (!taken.has(i)) return i;
  }
  return null;
}

/**
 * Inserts one booking row per day of the run. Relies on uq_ad_slot_bookings_slot_day to reject a
 * double booking even if two purchases race inside separate transactions.
 */
export async function insertSlotBookings(client, { campaignId, adProductId, slotKey, slotIndex, dates, amountPerDay }) {
  if (!dates.length) return 0;

  const values = [];
  const params = [];
  dates.forEach((date, i) => {
    const base = i * 6;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    params.push(campaignId, adProductId, slotKey, slotIndex, date, amountPerDay);
  });

  const { rowCount } = await client.query(
    `INSERT INTO ad_slot_bookings (campaign_id, ad_product_id, slot_key, slot_index, booking_date, amount)
     VALUES ${values.join(', ')}`,
    params
  );
  return rowCount;
}

export async function releaseBookingsForCampaign(client, campaignId) {
  const { rowCount } = await client.query(
    `DELETE FROM ad_slot_bookings WHERE campaign_id = $1 AND booking_date >= CURRENT_DATE`,
    [campaignId]
  );
  return rowCount;
}

/**
 * Platform-side revenue rollup per ad format, for the admin pricing dashboard.
 */
export async function getRevenueByProduct(db, { days = 30 } = {}) {
  const { rows } = await db.query(
    `SELECT p.id,
            p.key,
            COUNT(DISTINCT c.id)::int                       AS campaigns,
            COALESCE(SUM(c.spent_amount), 0)                AS revenue,
            COALESCE(SUM(c.impressions_count), 0)::bigint   AS impressions,
            COALESCE(SUM(c.clicks_count), 0)::bigint        AS clicks
     FROM ad_products p
     LEFT JOIN ad_campaigns c
            ON c.ad_product_id = p.id
           AND c.created_at >= now() - ($1 || ' days')::interval
     GROUP BY p.id, p.key
     ORDER BY revenue DESC`,
    [String(days)]
  );
  return rows;
}
