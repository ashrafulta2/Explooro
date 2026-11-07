/**
 * flyerDesign.repository.ts — Data access for flyer_saved_designs (110_flyer_saved_designs.sql).
 */

/** A user's saved design keys, newest first. */
export async function listKeys(db, userId: number, limit: number): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT design_key FROM flyer_saved_designs
     WHERE user_id = $1
     ORDER BY created_at DESC, design_key
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => r.design_key);
}

/**
 * Saves keys for a user. A key saved again moves to the top (its time is refreshed), which is what
 * the person means by saving it now.
 *
 * `at` lets the caller give each key of a batch its own time, so a merged list keeps its order.
 */
export async function upsertKeys(db, userId: number, keys: string[], at: Date[]) {
  if (!keys.length) return;
  await db.query(
    `INSERT INTO flyer_saved_designs (user_id, design_key, created_at)
     SELECT $1, k, t FROM unnest($2::text[], $3::timestamptz[]) AS u(k, t)
     ON CONFLICT (user_id, design_key) DO UPDATE SET created_at = EXCLUDED.created_at`,
    [userId, keys, at],
  );
}

/** Adds keys the user does not have yet; keys already saved keep their own time and place. */
export async function insertMissingKeys(db, userId: number, keys: string[], at: Date[]) {
  if (!keys.length) return;
  await db.query(
    `INSERT INTO flyer_saved_designs (user_id, design_key, created_at)
     SELECT $1, k, t FROM unnest($2::text[], $3::timestamptz[]) AS u(k, t)
     ON CONFLICT (user_id, design_key) DO NOTHING`,
    [userId, keys, at],
  );
}

export async function deleteKey(db, userId: number, key: string) {
  await db.query('DELETE FROM flyer_saved_designs WHERE user_id = $1 AND design_key = $2', [userId, key]);
}

/** Drops everything past the newest `limit` designs. */
export async function trimToLimit(db, userId: number, limit: number) {
  await db.query(
    `DELETE FROM flyer_saved_designs
     WHERE user_id = $1
       AND design_key NOT IN (
         SELECT design_key FROM flyer_saved_designs
         WHERE user_id = $1
         ORDER BY created_at DESC, design_key
         LIMIT $2
       )`,
    [userId, limit],
  );
}
