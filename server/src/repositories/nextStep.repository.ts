/**
 * nextStep.repository.ts — the yes/no questions behind every journey step (Prompt 13.2).
 *
 * One statement per fact, keyed by the fact id in config/journeys.ts. The meaning of each is written
 * out in client/src/config/journeys.ts JOURNEY_FACTS (`proof`) and docs/journeys.md §2.
 *
 * WHY one static statement per fact instead of one query built from the list: `npm run check:sql`
 * PREPAREs every static SQL literal against the real schema and skips anything with `${...}`. Built
 * SQL would hide a misspelled column until production; these are all checked. The cost is a few
 * EXISTS lookups per uncached request, each answered by an index on the user's own rows.
 *
 * `user` facts take the user id as $1. `platform` facts take no parameter: they are about the whole
 * platform, so any admin who completes one completes it for all.
 */

interface FactQuery {
  scope: 'user' | 'platform';
  sql: string;
}

export const FACT_QUERIES: Record<string, FactQuery> = {
  'user.phone_verified': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND is_phone_verified) AS done`,
  },
  'user.address_saved': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM user_addresses WHERE user_id = $1) AS done`,
  },
  'staff.two_factor_enrolled': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM staff_2fa WHERE user_id = $1 AND enrolled_at IS NOT NULL) AS done`,
  },
  // WHY "or ordered": checkout empties the cart, and a done step must never become undone.
  'customer.cart_started': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.user_id = $1)
              OR EXISTS (SELECT 1 FROM orders WHERE customer_id = $1) AS done`,
  },
  'customer.order_placed': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM orders WHERE customer_id = $1) AS done`,
  },
  'customer.order_delivered': {
    scope: 'user',
    sql: `SELECT EXISTS (
            SELECT 1 FROM sub_orders so JOIN orders o ON o.id = so.order_id
            WHERE o.customer_id = $1 AND so.status = 'DELIVERED'
          ) AS done`,
  },
  'customer.review_written': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM reviews WHERE user_id = $1 AND deleted_at IS NULL) AS done`,
  },
  'kyc.submitted': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM kyc_verifications WHERE user_id = $1) AS done`,
  },
  'saler.store_named': {
    scope: 'user',
    sql: `SELECT EXISTS (
            SELECT 1 FROM virtual_stores
            WHERE saler_id = $1 AND deleted_at IS NULL
              AND COALESCE(slug, '') <> '' AND COALESCE(shop_name, '') <> ''
          ) AS done`,
  },
  'saler.three_products': {
    scope: 'user',
    sql: `SELECT (SELECT COUNT(*) FROM saler_store_items WHERE saler_id = $1 AND is_active) >= 3 AS done`,
  },
  'saler.link_created': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM short_links WHERE saler_id = $1) AS done`,
  },
  'saler.order_received': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM sub_orders WHERE saler_id = $1) AS done`,
  },
  'wallet.payout_requested': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM payout_requests WHERE user_id = $1) AS done`,
  },
  'supplier.product_listed': {
    scope: 'user',
    sql: `SELECT EXISTS (
            SELECT 1 FROM products WHERE supplier_id = $1 AND status <> 'ARCHIVED' AND deleted_at IS NULL
          ) AS done`,
  },
  'supplier.product_live': {
    scope: 'user',
    sql: `SELECT EXISTS (
            SELECT 1 FROM products
            WHERE supplier_id = $1 AND status = 'ACTIVE' AND stock_qty > 0 AND deleted_at IS NULL
          ) AS done`,
  },
  'supplier.order_received': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM sub_orders WHERE supplier_id = $1) AS done`,
  },
  'supplier.order_shipped': {
    scope: 'user',
    sql: `SELECT EXISTS (
            SELECT 1 FROM shipments sh JOIN sub_orders so ON so.id = sh.sub_order_id WHERE so.supplier_id = $1
          ) AS done`,
  },
  'moderation.item_claimed': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM moderation_queue WHERE claimed_by = $1 OR decided_by = $1) AS done`,
  },
  'moderation.item_decided': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM moderation_queue WHERE decided_by = $1) AS done`,
  },
  'moderation.dispute_decided': {
    scope: 'user',
    sql: `SELECT EXISTS (
            SELECT 1 FROM audit_logs
            WHERE actor_id = $1 AND action IN ('orders.dispute.arbitrate', 'orders.dispute.arbitrate_proposed')
          ) AS done`,
  },
  'staff.return_decided': {
    scope: 'user',
    sql: `SELECT EXISTS (
            SELECT 1 FROM audit_logs
            WHERE actor_id = $1 AND action IN ('returns.request.approve', 'returns.request.reject')
          ) AS done`,
  },
  'content.banner_live': {
    scope: 'platform',
    sql: `SELECT EXISTS (SELECT 1 FROM banners WHERE is_active) AS done`,
  },
  'content.story_published': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM stories WHERE author_id = $1 AND status = 'PUBLISHED') AS done`,
  },
  'content.release_note_published': {
    scope: 'platform',
    sql: `SELECT EXISTS (SELECT 1 FROM release_notes WHERE published_at IS NOT NULL) AS done`,
  },
  'content.translation_saved': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM audit_logs WHERE actor_id = $1 AND action = 'translation.upsert') AS done`,
  },
  'admin.kyc_reviewed': {
    scope: 'user',
    sql: `SELECT EXISTS (SELECT 1 FROM kyc_verifications WHERE reviewed_by = $1) AS done`,
  },
  'admin.product_reviewed': {
    scope: 'user',
    sql: `SELECT EXISTS (
            SELECT 1 FROM moderation_queue WHERE decided_by = $1 AND item_type IN ('PRODUCT_NEW', 'PRODUCT_EDIT')
          ) AS done`,
  },
  'admin.payout_reviewed': {
    scope: 'user',
    sql: `SELECT EXISTS (
            SELECT 1 FROM audit_logs
            WHERE actor_id = $1 AND action IN ('finance.payout.approve_request', 'finance.payout.reject')
          ) AS done`,
  },
  // WHY audit rows for settings: migrations seed defaults, so the settings row always exists; an
  // audit row proves someone actually chose the value.
  'platform.language_chosen': {
    scope: 'platform',
    sql: `SELECT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'platform.localization.update') AS done`,
  },
  'platform.delivery_set': {
    scope: 'platform',
    sql: `SELECT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'platform.delivery.update') AS done`,
  },
  'platform.operations_set': {
    scope: 'platform',
    sql: `SELECT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'platform.operations.update') AS done`,
  },
  'platform.category_exists': {
    scope: 'platform',
    sql: `SELECT EXISTS (SELECT 1 FROM categories) AS done`,
  },
  'platform.staff_invited': {
    scope: 'platform',
    sql: `SELECT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'staff.account.create') AS done`,
  },
  'platform.supplier_verified': {
    scope: 'platform',
    sql: `SELECT EXISTS (SELECT 1 FROM kyc_verifications WHERE kyc_type = 'SUPPLIER' AND status = 'VERIFIED') AS done`,
  },
  'platform.product_live': {
    scope: 'platform',
    sql: `SELECT EXISTS (SELECT 1 FROM products WHERE status = 'ACTIVE' AND deleted_at IS NULL) AS done`,
  },
};

/** Answers the given facts for one user. An unknown fact id is a programming error, so it throws. */
export async function evaluateFacts(db, userId: number, facts: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const fact of new Set(facts)) {
    const query = FACT_QUERIES[fact];
    if (!query) throw new Error(`nextStep: no query for fact "${fact}"`);
    const { rows } = await db.query(query.sql, query.scope === 'user' ? [userId] : []);
    out[fact] = rows[0]?.done === true;
  }
  return out;
}

/** The supplier's KYC is approved: the gate product.service checks before any listing. */
export async function isKycVerified(db, userId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM kyc_verifications WHERE user_id = $1 AND status = 'VERIFIED') AS done`,
    [userId]
  );
  return rows[0]?.done === true;
}

/** A product is waiting on a moderator, so the user has nothing to do but wait. */
export async function hasProductAwaitingReview(db, userId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM products WHERE supplier_id = $1 AND status = 'PENDING_APPROVAL' AND deleted_at IS NULL
     ) AS done`,
    [userId]
  );
  return rows[0]?.done === true;
}

export async function hasWithdrawableBalance(db, userId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM wallets WHERE user_id = $1 AND available_balance > 0) AS done`,
    [userId]
  );
  return rows[0]?.done === true;
}

/** True unless the user switched guidance off. No profile row means they never did. */
export async function getShowNextSteps(db, userId: number): Promise<boolean> {
  const { rows } = await db.query(`SELECT show_next_steps FROM user_profiles WHERE user_id = $1`, [userId]);
  return rows[0] ? rows[0].show_next_steps !== false : true;
}

export async function setShowNextSteps(db, userId: number, show: boolean): Promise<void> {
  await db.query(
    `INSERT INTO user_profiles (user_id, show_next_steps) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET show_next_steps = EXCLUDED.show_next_steps`,
    [userId, show]
  );
}
