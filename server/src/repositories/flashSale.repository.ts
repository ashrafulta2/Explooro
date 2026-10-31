/**
 * flashSale.repository.ts — SQL fragments shared by every reader that prices a flash sale.
 *
 * WHY one definition: the cart read (cart.repository.ts), add-to-cart and checkout
 * (flashSale.service.ts) must agree on which deal is live and on what a customer already bought.
 */

/**
 * A deal is live inside its window while it has units left. SCHEDULED counts once inside its window,
 * because nothing promotes a sale to ACTIVE (see product.repository.ts CATALOG_FROM). A sold-out,
 * ended, paused or emergency-stopped deal is not live, so its cart line falls back to retail.
 *
 * @param {string} [alias] the flash_sales table alias, e.g. 'f'
 */
export function liveFlashSaleSql(alias = '') {
  const c = alias ? `${alias}.` : '';
  return `${c}status IN ('ACTIVE', 'SCHEDULED')
        AND now() BETWEEN ${c}starts_at AND ${c}ends_at
        AND ${c}sold_qty + ${c}reserved_qty < ${c}allocated_qty`;
}

/**
 * Units a customer has bought at one deal's price, across orders (order_items.flash_sale_id,
 * migration 095). A cancelled parcel gives its units back, so it does not count.
 *
 * @param {string} dealRef      SQL for the deal id, e.g. '$1' or 'fs.id'
 * @param {string} customerRef  SQL for the customer id, e.g. '$2' or 'c.user_id'
 */
export function boughtAtDealSql(dealRef, customerRef) {
  return `SELECT COALESCE(SUM(oi.qty), 0)::int AS bought_qty
            FROM order_items oi
            JOIN sub_orders so ON so.id = oi.sub_order_id
            JOIN orders o ON o.id = so.order_id
           WHERE oi.flash_sale_id = ${dealRef} AND o.customer_id = ${customerRef} AND so.status <> 'CANCELLED'`;
}
