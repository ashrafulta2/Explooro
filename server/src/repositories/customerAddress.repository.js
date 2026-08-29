/**
 * customerAddress.repository.js — SQL repository for customer saved delivery addresses.
 *
 * Enforces the raw-SQL layered architecture (docs/architecture-map.md §1): every `user_addresses`
 * query lives here, and the service composes these calls inside a transaction. Each function
 * accepts `db`, which may be a pool or an in-transaction client — both expose `.query`.
 */

const ADDRESS_COLUMNS = `
  id, user_id, label, custom_label, recipient_name, recipient_phone,
  division, district, upazila, address_line, delivery_notes, postal_code,
  is_default, created_at, updated_at
`;

/** Max rows returned for one customer's address book — a hard ceiling, not a page size. */
export const MAX_ADDRESSES_PER_USER = 20;

export async function listByUser(db, userId, limit = MAX_ADDRESSES_PER_USER) {
  const { rows } = await db.query(
    `SELECT ${ADDRESS_COLUMNS}
       FROM user_addresses
      WHERE user_id = $1
      ORDER BY is_default DESC, updated_at DESC NULLS LAST, created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function countByUser(db, userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM user_addresses WHERE user_id = $1`,
    [userId]
  );
  return rows[0]?.total || 0;
}

export async function findByIdForUser(db, addressId, userId) {
  const { rows } = await db.query(
    `SELECT ${ADDRESS_COLUMNS}
       FROM user_addresses
      WHERE id = $1 AND user_id = $2`,
    [addressId, userId]
  );
  return rows[0] || null;
}

/** Clears the default flag on every address for a user. Call before promoting a new default. */
export async function clearDefaultForUser(db, userId) {
  await db.query(
    `UPDATE user_addresses SET is_default = false WHERE user_id = $1 AND is_default = true`,
    [userId]
  );
}

export async function insert(db, userId, a) {
  const { rows } = await db.query(
    `INSERT INTO user_addresses
       (user_id, label, custom_label, recipient_name, recipient_phone,
        division, district, upazila, address_line, delivery_notes, postal_code,
        is_default, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
     RETURNING ${ADDRESS_COLUMNS}`,
    [
      userId, a.label, a.custom_label, a.recipient_name, a.recipient_phone,
      a.division, a.district, a.upazila, a.address_line, a.delivery_notes, a.postal_code,
      a.is_default,
    ]
  );
  return rows[0];
}

export async function update(db, addressId, userId, a) {
  const { rows } = await db.query(
    `UPDATE user_addresses
        SET label = $1, custom_label = $2, recipient_name = $3, recipient_phone = $4,
            division = $5, district = $6, upazila = $7, address_line = $8,
            delivery_notes = $9, postal_code = $10, is_default = $11, updated_at = now()
      WHERE id = $12 AND user_id = $13
      RETURNING ${ADDRESS_COLUMNS}`,
    [
      a.label, a.custom_label, a.recipient_name, a.recipient_phone,
      a.division, a.district, a.upazila, a.address_line, a.delivery_notes, a.postal_code,
      a.is_default, addressId, userId,
    ]
  );
  return rows[0] || null;
}

export async function remove(db, addressId, userId) {
  await db.query(`DELETE FROM user_addresses WHERE id = $1 AND user_id = $2`, [addressId, userId]);
}

export async function promoteDefault(db, addressId, userId) {
  const { rows } = await db.query(
    `UPDATE user_addresses
        SET is_default = true, updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING ${ADDRESS_COLUMNS}`,
    [addressId, userId]
  );
  return rows[0] || null;
}

/** The most recently touched address for a user, used to auto-promote a new default after a delete. */
export async function findMostRecentForUser(db, userId) {
  const { rows } = await db.query(
    `SELECT id FROM user_addresses
      WHERE user_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * One-shot idempotent seed: if the customer has no saved address yet but their profile carries a
 * usable delivery address, materialise it as their default. `WHERE NOT EXISTS` keeps this atomic —
 * a concurrent caller either sees the row already or is blocked by ux_user_addresses_single_default,
 * so it can never create a second row or a second default.
 */
export async function seedFromProfileIfEmpty(db, userId) {
  const { rows } = await db.query(
    `INSERT INTO user_addresses
       (user_id, label, recipient_name, recipient_phone,
        division, district, upazila, address_line, postal_code,
        is_default, created_at, updated_at)
     SELECT u.id, 'HOME',
            COALESCE(NULLIF(TRIM(up.full_name), ''), NULLIF(TRIM(up.display_name), ''), 'Customer'),
            COALESCE(NULLIF(TRIM(u.phone), ''), '+8801700000000'),
            up.division, up.district, COALESCE(up.upazila, ''), up.address_line,
            COALESCE(up.postal_code, ''),
            true, now(), now()
       FROM users u
       JOIN user_profiles up ON up.user_id = u.id
      WHERE u.id = $1
        AND up.address_line IS NOT NULL AND TRIM(up.address_line) <> ''
        AND up.division IS NOT NULL AND TRIM(up.division) <> ''
        AND up.district IS NOT NULL AND TRIM(up.district) <> ''
        AND NOT EXISTS (SELECT 1 FROM user_addresses ua WHERE ua.user_id = $1)
     RETURNING ${ADDRESS_COLUMNS}`,
    [userId]
  );
  return rows[0] || null;
}
