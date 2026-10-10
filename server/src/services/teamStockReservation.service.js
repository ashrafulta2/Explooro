/**
 * teamStockReservation.service.js — how many units of a product are spoken for by open teams.
 *
 * A team purchase takes stock only when it fills, so without this a normal checkout (or a second
 * team) could spend the units a half-full team is counting on, and the last joiner would be refused
 * after everyone else had already paid or held funds.
 *
 * WHY derived, not stored: the reservation is `required_members` of every ACTIVE, unexpired team.
 * There is no counter to drift and nothing to release — a team that completes, expires or is
 * cancelled stops counting the moment its status or window changes, even if the expiry job is late.
 *
 * Callers that act on the number must already hold the product row `FOR UPDATE`, which is what
 * checkout and team creation do; that lock is what makes the read race-free.
 */

const OPEN_TEAMS = `status = 'ACTIVE' AND expires_at > now()`;

/** Units of one product held by open teams, optionally ignoring one team (its own reservation). */
export async function getReservedForProduct(client, productId, { excludeTeamId = null } = {}) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(required_members), 0)::int AS reserved
       FROM team_purchases
      WHERE product_id = $1 AND ${OPEN_TEAMS}
        AND ($2::bigint IS NULL OR id <> $2)`,
    [productId, excludeTeamId]
  );
  return rows[0]?.reserved ?? 0;
}

/** The same for many products at once: Map(productId -> reserved units). */
export async function getReservedByProduct(client, productIds) {
  const ids = [...new Set((productIds || []).map(Number))];
  const map = new Map(ids.map((id) => [id, 0]));
  if (ids.length === 0) return map;
  const { rows } = await client.query(
    `SELECT product_id, SUM(required_members)::int AS reserved
       FROM team_purchases
      WHERE product_id = ANY($1::bigint[]) AND ${OPEN_TEAMS}
      GROUP BY product_id`,
    [ids]
  );
  for (const r of rows) map.set(Number(r.product_id), Number(r.reserved));
  return map;
}
