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

/**
 * The same figure as a SQL expression, for filters and sorts that must agree with `getReservedByProduct`
 * (e.g. "in stock only"). `alias` is the products table alias in the surrounding query.
 */
export function reservedUnitsSql(alias = 'p') {
  return `COALESCE((SELECT SUM(tp.required_members) FROM team_purchases tp
                      WHERE tp.product_id = ${alias}.id AND tp.status = 'ACTIVE' AND tp.expires_at > now()), 0)`;
}

/**
 * Turns raw `stock_qty` into what a shopper can actually buy: stock minus units open teams are
 * counting on. Mutates nothing; each returned row keeps `stock_on_hand` (the raw figure) and gains
 * `reserved_qty`. Rows without a product id or stock figure pass through unchanged.
 *
 * WHY here: search, the storefront and the concierge each read `stock_qty` straight off a row, so
 * a product whose last units were reserved by a half-full team still showed as buyable and then
 * failed at cart or checkout. Cart and checkout already subtract this; the display now agrees.
 */
export async function withAvailableStock(client, rows, { idKey = 'id' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = list.map((r) => r?.[idKey]).filter((v) => v !== null && v !== undefined);
  if (ids.length === 0) return list;
  const reserved = await getReservedByProduct(client, ids);
  return list.map((r) => {
    const raw = r?.stock_qty;
    if (r?.[idKey] === null || r?.[idKey] === undefined) return r;
    if (raw === null || raw === undefined || Number.isNaN(Number(raw))) return r;
    const held = reserved.get(Number(r[idKey])) || 0;
    return { ...r, stock_on_hand: Number(raw), reserved_qty: held, stock_qty: Math.max(0, Number(raw) - held) };
  });
}

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
