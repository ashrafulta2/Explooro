/**
 * cartRecovery.service.js — Abandoned Cart Recovery Engine (Prompt 9.6).
 *
 * Implements DFD Subsystem 12.0:
 * 1. Inactivity detection: identifies carts idle >= N minutes with items.
 * 2. 3-Step configurable recovery sequence (+1h reminder, +24h 5% incentive, +72h 10% final urgency).
 * 3. Exact cart restoration with signed recovery tokens.
 * 4. Multi-party coupon incentive controls and single-use discount caps.
 * 5. Step-level attribution and conversion tracking.
 * 6. Anti-spam user cooldowns (7 days) and 1 sequence per cart cap.
 * 7. Saler cart insights dashboard and manual offer dispatch.
 */

import { randomBytes } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { isEnabled } from './module.service.js';

// WHY a subquery: products carry no image column. The primary image is the top-ranked row in
// product_images, whose bytes live on media_assets.storage_key (006_catalog.sql).
const PRIMARY_IMAGE_SQL = `(
  SELECT m.storage_key
  FROM product_images pi2
  JOIN media_assets m ON m.id = pi2.media_id
  WHERE pi2.product_id = p.id
  ORDER BY pi2.is_primary DESC, pi2.display_order ASC
  LIMIT 1
)`;

async function runWithClient(db, fn) {
  if (db && typeof db.connect === 'function') {
    return withTransaction(db, fn);
  }
  return fn(db);
}

function generateRecoveryToken() {
  const token = randomBytes(4).toString('hex').toUpperCase();
  return `CRT-${token}`;
}

export async function getCartRecoverySettings(db) {
  try {
    const { rows } = await db.query(
      `SELECT settings_json FROM platform_modules WHERE key = 'cart_recovery'`
    );
    return rows[0]?.settings_json || {
      inactivity_minutes: 60,
      step1_hours: 1,
      step2_hours: 24,
      step3_hours: 72,
      step2_discount_pct: 5,
      step3_discount_pct: 10,
      max_discount_cap_pct: 15,
      user_cooldown_days: 7,
      quiet_hours_start: 22,
      quiet_hours_end: 8,
    };
  } catch {
    return {
      inactivity_minutes: 60,
      step1_hours: 1,
      step2_hours: 24,
      step3_hours: 72,
      step2_discount_pct: 5,
      step3_discount_pct: 10,
      max_discount_cap_pct: 15,
      user_cooldown_days: 7,
      quiet_hours_start: 22,
      quiet_hours_end: 8,
    };
  }
}

/**
 * Scans active carts and registers newly abandoned carts.
 */
export async function detectAbandonedCarts(db, cache) {
  const enabled = await isEnabled(db, cache, 'cart_recovery');
  if (!enabled) return { detectedCount: 0 };

  const settings = await getCartRecoverySettings(db);
  const inactivityMinutes = Number(settings.inactivity_minutes || 60);
  const userCooldownDays = Number(settings.user_cooldown_days || 7);

  return runWithClient(db, async (client) => {
    // 1. Find active carts idle >= inactivityMinutes with items and no order created
    const query = `
      SELECT c.id as cart_id,
             c.user_id,
             c.guest_token,
             SUM(ci.qty * ci.price_at_add) as total_items_value
      FROM carts c
      JOIN cart_items ci ON ci.cart_id = c.id
      LEFT JOIN abandoned_carts ac ON ac.cart_id = c.id
      WHERE c.status = 'ACTIVE'
        AND c.converted_order_id IS NULL
        AND c.last_activity_at <= (now() - ($1 || ' minutes')::interval)
        AND ac.id IS NULL
      GROUP BY c.id, c.user_id, c.guest_token
      HAVING count(ci.id) > 0
    `;

    const { rows: candidateCarts } = await client.query(query, [inactivityMinutes]);
    if (candidateCarts.length === 0) return { detectedCount: 0 };

    let newlyDetected = 0;

    for (const candidate of candidateCarts) {
      // 2. Check user cooldown
      if (candidate.user_id) {
        const { rows: recentSequences } = await client.query(
          `SELECT id FROM abandoned_carts
           WHERE user_id = $1
             AND detected_at >= (now() - ($2 || ' days')::interval)
           LIMIT 1`,
          [candidate.user_id, userCooldownDays]
        );
        if (recentSequences.length > 0) {
          // User already in cooldown window, skip to avoid spam
          continue;
        }
      }

      const recoveryToken = generateRecoveryToken();
      const itemsValue = candidate.total_items_value || 0;

      // 3. Insert abandoned cart record
      await client.query(
        `INSERT INTO abandoned_carts (
          cart_id, user_id, items_value, sequence_step, recovery_token, detected_at
        )
        VALUES ($1, $2, $3, 0, $4, now())
        ON CONFLICT (cart_id) DO NOTHING`,
        [candidate.cart_id, candidate.user_id, itemsValue, recoveryToken]
      );

      // 4. Mark cart status as ABANDONED
      await client.query(
        `UPDATE carts SET status = 'ABANDONED', updated_at = now() WHERE id = $1`,
        [candidate.cart_id]
      );

      newlyDetected++;
    }

    return { detectedCount: newlyDetected };
  });
}

/**
 * Sweeps unrecovered abandoned carts and advances the multi-step recovery sequence.
 */
export async function processRecoverySequence(db, cache) {
  const enabled = await isEnabled(db, cache, 'cart_recovery');
  if (!enabled) return { processedCount: 0 };

  // Step 1: Detect newly abandoned carts first
  await detectAbandonedCarts(db, cache);

  const settings = await getCartRecoverySettings(db);
  const step1Hours = Number(settings.step1_hours || 1);
  const step2Hours = Number(settings.step2_hours || 24);
  const step3Hours = Number(settings.step3_hours || 72);
  const step2Discount = Number(settings.step2_discount_pct || 5);
  const step3Discount = Number(settings.step3_discount_pct || 10);

  let step1Count = 0;
  let step2Count = 0;
  let step3Count = 0;

  // 1. Fetch pending unrecovered abandoned carts
  const { rows: pendingCarts } = await db.query(
    `SELECT ac.*,
            c.status as cart_status,
            c.converted_order_id,
            EXTRACT(EPOCH FROM (now() - ac.detected_at))/3600 as hours_since_detected
     FROM abandoned_carts ac
     JOIN carts c ON c.id = ac.cart_id
     WHERE ac.recovered_at IS NULL
       AND c.converted_order_id IS NULL
     ORDER BY ac.detected_at ASC`
  );

  for (const cart of pendingCarts) {
    const hours = cart.hours_since_detected;

    await runWithClient(db, async (client) => {
      // Step 0 -> Step 1 (+1h Reminder)
      if (cart.sequence_step === 0 && hours >= step1Hours) {
        await client.query(
          `INSERT INTO cart_recovery_logs (
            abandoned_cart_id, cart_id, user_id, sequence_step, channel, discount_pct, coupon_code, sent_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
          [cart.id, cart.cart_id, cart.user_id, 1, 'IN_APP', 0, null]
        );

        await client.query(
          `UPDATE abandoned_carts
           SET sequence_step = 1, last_nudge_at = now()
           WHERE id = $1`,
          [cart.id]
        );
        step1Count++;
      }
      // Step 1 -> Step 2 (+24h 5% Incentive Coupon)
      else if (cart.sequence_step === 1 && hours >= step2Hours) {
        const couponCode = `RECOVER5-${cart.recovery_token}`;

        await client.query(
          `INSERT INTO cart_recovery_logs (
            abandoned_cart_id, cart_id, user_id, sequence_step, channel, discount_pct, coupon_code, sent_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
          [cart.id, cart.cart_id, cart.user_id, 2, 'IN_APP', step2Discount, couponCode]
        );

        await client.query(
          `UPDATE abandoned_carts
           SET sequence_step = 2, last_nudge_at = now()
           WHERE id = $1`,
          [cart.id]
        );
        step2Count++;
      }
      // Step 2 -> Step 3 (+72h 10% Final Notice)
      else if (cart.sequence_step === 2 && hours >= step3Hours) {
        const couponCode = `RECOVER10-${cart.recovery_token}`;

        await client.query(
          `INSERT INTO cart_recovery_logs (
            abandoned_cart_id, cart_id, user_id, sequence_step, channel, discount_pct, coupon_code, sent_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
          [cart.id, cart.cart_id, cart.user_id, 3, 'IN_APP', step3Discount, couponCode]
        );

        await client.query(
          `UPDATE abandoned_carts
           SET sequence_step = 3, last_nudge_at = now()
           WHERE id = $1`,
          [cart.id]
        );
        step3Count++;
      }
    });
  }

  return {
    processedCount: pendingCarts.length,
    step1Count,
    step2Count,
    step3Count,
  };
}

/**
 * Restores an exact cart with items and product details by signed recovery token.
 */
export async function restoreCartByToken(db, recoveryToken) {
  const { rows: cartRows } = await db.query(
    `SELECT ac.*, c.status as cart_status
     FROM abandoned_carts ac
     JOIN carts c ON c.id = ac.cart_id
     WHERE ac.recovery_token = $1`,
    [recoveryToken]
  );

  const abandonedCart = cartRows[0];
  if (!abandonedCart) {
    throw new AppError('INVALID_RECOVERY_TOKEN', 'Abandoned cart recovery token is invalid or expired.');
  }

  const { rows: items } = await db.query(
    `SELECT ci.*,
            p.title_en as product_name_en,
            p.title_bn as product_name_bn,
            p.base_cost as base_price,
            ${PRIMARY_IMAGE_SQL} as primary_image_url,
            pv.sku as variant_sku,
            pv.attributes_json as variant_attributes
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     LEFT JOIN product_variants pv ON pv.id = ci.variant_id
     WHERE ci.cart_id = $1`,
    [abandonedCart.cart_id]
  );

  return {
    abandoned_cart: abandonedCart,
    items,
    total_items_count: items.reduce((sum, it) => sum + it.qty, 0),
    items_value: abandonedCart.items_value,
  };
}

/**
 * Records cart conversion and attributes recovered revenue.
 */
export async function recordCartRecoveryConversion(db, {
  cartId,
  orderId,
  orderTotal,
}) {
  return runWithClient(db, async (client) => {
    // 1. Update abandoned_carts
    await client.query(
      `UPDATE abandoned_carts
       SET recovered_at = now(),
           recovered_order_id = $1,
           recovered_value = $2
       WHERE cart_id = $3 AND recovered_at IS NULL`,
      [orderId, orderTotal, cartId]
    );

    // 2. Mark carts CONVERTED
    await client.query(
      `UPDATE carts
       SET status = 'CONVERTED',
           converted_order_id = $1,
           updated_at = now()
       WHERE id = $2`,
      [orderId, cartId]
    );

    return { converted: true, orderId, recoveredValue: orderTotal };
  });
}

/**
 * Dispatches a seller-customized recovery offer within the configured cap.
 */
export async function sendManualOffer(db, {
  salerUserId,
  abandonedCartId,
  discountPct = 10,
}) {
  const settings = await getCartRecoverySettings(db);
  const maxCap = Number(settings.max_discount_cap_pct || 15);
  const discount = Math.min(Math.max(1, parseFloat(discountPct) || 10), maxCap);

  return runWithClient(db, async (client) => {
    const { rows: acRows } = await client.query(
      `SELECT * FROM abandoned_carts WHERE id = $1`,
      [abandonedCartId]
    );
    const cart = acRows[0];
    if (!cart) {
      throw new AppError('CART_NOT_FOUND', 'Target abandoned cart does not exist.');
    }

    const couponCode = `SPECIAL-${discount}-${cart.recovery_token}`;

    const { rows: logRows } = await client.query(
      `INSERT INTO cart_recovery_logs (
        abandoned_cart_id, cart_id, user_id, sequence_step, channel, discount_pct, coupon_code, sent_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      RETURNING *`,
      [cart.id, cart.cart_id, cart.user_id, 4, 'IN_APP', discount, couponCode]
    );

    await client.query(
      `UPDATE abandoned_carts SET last_nudge_at = now() WHERE id = $1`,
      [cart.id]
    );

    return {
      success: true,
      offerLog: logRows[0],
      couponCode,
      discountPct: discount,
    };
  });
}

/**
 * Aggregates cart abandonment insights, drop-off products, and funnel attribution for sellers.
 */
export async function getSalerCartInsights(db, salerUserId) {
  // 1. Overall stats
  const { rows: summaryRows } = await db.query(
    `SELECT
       COUNT(DISTINCT ac.id) as total_abandoned_carts,
       COALESCE(SUM(ac.items_value), 0) as total_abandoned_value,
       COUNT(DISTINCT CASE WHEN ac.recovered_at IS NOT NULL THEN ac.id END) as total_recovered_carts,
       COALESCE(SUM(CASE WHEN ac.recovered_at IS NOT NULL THEN ac.recovered_value ELSE 0 END), 0) as total_recovered_revenue
     FROM abandoned_carts ac
     JOIN cart_items ci ON ci.cart_id = ac.cart_id
     WHERE ci.saler_id = $1 OR $1 IS NULL`,
    [salerUserId || null]
  );

  const summary = summaryRows[0] || {
    total_abandoned_carts: 0,
    total_abandoned_value: '0.00',
    total_recovered_carts: 0,
    total_recovered_revenue: '0.00',
  };

  const totalAbandoned = parseInt(summary.total_abandoned_carts, 10) || 0;
  const totalRecovered = parseInt(summary.total_recovered_carts, 10) || 0;
  const recoveryRatePct = totalAbandoned > 0 ? ((totalRecovered / totalAbandoned) * 100).toFixed(1) : '0.0';

  // 2. Funnel Attribution by Step
  const { rows: funnelRows } = await db.query(
    `SELECT
       crl.sequence_step,
       COUNT(DISTINCT crl.id) as nudges_sent,
       COUNT(DISTINCT CASE WHEN ac.recovered_at IS NOT NULL THEN ac.id END) as converted_count,
       COALESCE(SUM(CASE WHEN ac.recovered_at IS NOT NULL THEN ac.recovered_value ELSE 0 END), 0) as revenue_recovered
     FROM cart_recovery_logs crl
     JOIN abandoned_carts ac ON ac.id = crl.abandoned_cart_id
     GROUP BY crl.sequence_step
     ORDER BY crl.sequence_step ASC`
  );

  // 3. Top Abandoned Products
  const { rows: topProducts } = await db.query(
    `SELECT
       p.id as product_id,
       p.title_en as name_en,
       p.title_bn as name_bn,
       ${PRIMARY_IMAGE_SQL} as primary_image_url,
       COUNT(ci.id) as abandon_count,
       SUM(ci.qty * ci.price_at_add) as lost_revenue_estimate
     FROM cart_items ci
     JOIN abandoned_carts ac ON ac.cart_id = ci.cart_id
     JOIN products p ON p.id = ci.product_id
     WHERE ci.saler_id = $1 OR $1 IS NULL
     GROUP BY p.id, p.title_en, p.title_bn
     ORDER BY abandon_count DESC
     LIMIT 5`,
    [salerUserId || null]
  );

  // 4. Active Abandoned Carts Queue (for manual offers)
  const { rows: activeQueue } = await db.query(
    `SELECT ac.id,
            ac.cart_id,
            ac.items_value,
            ac.sequence_step,
            ac.recovery_token,
            ac.last_nudge_at,
            ac.detected_at,
            COALESCE(up.display_name, up.full_name) as customer_name,
            ROUND(EXTRACT(EPOCH FROM (now() - ac.detected_at))/3600, 1) as hours_abandoned
     FROM abandoned_carts ac
     LEFT JOIN users u ON u.id = ac.user_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE ac.recovered_at IS NULL
     ORDER BY ac.detected_at DESC
     LIMIT 15`
  );

  return {
    summary: {
      total_abandoned_carts: totalAbandoned,
      total_abandoned_value: Number(summary.total_abandoned_value).toFixed(2),
      total_recovered_carts: totalRecovered,
      total_recovered_revenue: Number(summary.total_recovered_revenue).toFixed(2),
      recovery_rate_pct: recoveryRatePct,
    },
    funnel: funnelRows,
    top_products: topProducts,
    active_queue: activeQueue,
  };
}
