/**
 * customerPortal.service.js — Central Customer Portal, Feed & 1-Click Upgrade Logic (Prompt 11.3 / idea §AL.3).
 *
 * Implements:
 * 1. Customer dashboard aggregation (active orders, streak coins, wishlist drops, warranties, coupons, referrals).
 * 2. Visual tracking orders list with courier consignment sync, warranty cards, and return eligibility.
 * 3. Following feed aggregating product drops, live streams, and stories from followed sellers.
 * 4. Store follow/unfollow engine.
 * 5. 1-Click Saler Upgrade (provisions saler role, virtual store with unique vanity slug, wallet, zero paperwork).
 * 6. Wishlist price-drop evaluation & notification dispatcher.
 */

import { AppError } from '../plugins/errorHandler.js';
import { notify } from './notification.service.js';
import { SLUG_REGEX, validateSlugAvailability } from './store.service.js';
import { orderStatusSql } from '../repositories/order.repository.js';

/** Lifecycle status → 1..5 progress dot. SHIPPED and IN_TRANSIT share step 4. */
const TRACKING_STEP_BY_STATUS = {
  PLACED: 1,
  CONFIRMED: 2,
  PACKED: 3,
  SHIPPED: 4,
  IN_TRANSIT: 4,
  DELIVERED: 5,
};

// Order status is derived from the order's sub_orders — see orderStatusSql() for why.
const ORDER_STATUS = orderStatusSql('o');

// Product images live in product_images → media_assets; `products` carries no image column.
const PRIMARY_IMAGE_SQL = `(
  SELECT m.storage_key
  FROM product_images pi2
  JOIN media_assets m ON m.id = pi2.media_id
  WHERE pi2.product_id = p.id
  ORDER BY pi2.is_primary DESC, pi2.display_order ASC
  LIMIT 1
)`;

// Orders store the delivery address as flat columns, not a JSON blob.
const DELIVERY_ADDRESS_SQL = `json_build_object(
  'recipient_name', o.recipient_name,
  'recipient_phone', o.recipient_phone,
  'address_line', o.address_line,
  'upazila', o.upazila,
  'district', o.district,
  'division', o.division
)`;

/**
 * Aggregates all real-time customer portal summary metrics.
 */
export async function getCustomerDashboardSummary(db, userId) {
  const parsedUserId = Number(userId);
  if (!parsedUserId) {
    throw new AppError('AUTH_REQUIRED', 'Customer authentication required.', 'গ্রাহক প্রমাণীকরণ প্রয়োজন।');
  }

  // 1. Orders Summary (Active in-transit orders, delivered count)
  const { rows: orderRows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE derived_status NOT IN ('DELIVERED', 'CANCELLED', 'RETURNED', 'REFUNDED')) as active_orders_count,
       COUNT(*) FILTER (WHERE derived_status = 'DELIVERED') as delivered_orders_count,
       COUNT(*) as total_orders_count
     FROM (SELECT ${ORDER_STATUS} AS derived_status FROM orders o WHERE o.customer_id = $1) t`,
    [parsedUserId]
  );
  const orderStats = orderRows[0] || { active_orders_count: 0, delivered_orders_count: 0, total_orders_count: 0 };

  // 2. Latest In-Flight Order (if any)
  const { rows: latestOrderRows } = await db.query(
    // order_items hangs off sub_orders, not orders — every item lookup goes through the parcel.
    `SELECT o.id, o.ref, ${ORDER_STATUS} AS status, o.total_amount, o.created_at,
            (SELECT COUNT(*) FROM order_items oi
              JOIN sub_orders so ON so.id = oi.sub_order_id
              WHERE so.order_id = o.id) as item_count,
            (SELECT json_agg(json_build_object(
              'product_title_en', oi.title_snapshot,
              'product_title_bn', oi.title_snapshot,
              'quantity', oi.qty,
              'unit_price', oi.retail_price
             )) FROM order_items oi
                JOIN sub_orders so ON so.id = oi.sub_order_id
                WHERE so.order_id = o.id) as items
     FROM orders o
     WHERE o.customer_id = $1 AND ${ORDER_STATUS} NOT IN ('CANCELLED', 'RETURNED', 'REFUNDED')
     ORDER BY o.created_at DESC
     LIMIT 1`,
    [parsedUserId]
  );
  const latestOrder = latestOrderRows[0] || null;

  // 3. Coins & Daily Login Streak
  const { rows: coinRows } = await db.query(
    // Table is `coin_balances` (024_gamification.sql); aliased to the field names this service and
    // its callers already use.
    `SELECT balance, current_streak_days as current_streak,
            last_check_in_date as last_login_date, lifetime_earned as total_earned
     FROM coin_balances
     WHERE user_id = $1`,
    [parsedUserId]
  );
  const coins = coinRows[0] || { balance: 0, current_streak: 1, last_login_date: null, total_earned: 0 };

  // 4. Wishlist & Price-Drop Detection
  const { rows: wishlistRows } = await db.query(
    `SELECT w.id, w.product_id, w.price_at_save, p.default_retail_price as current_price,
            p.title_en, p.title_bn, p.slug
     FROM wishlists w
     JOIN products p ON p.id = w.product_id
     WHERE w.user_id = $1`,
    [parsedUserId]
  );

  let priceDropsCount = 0;
  const wishlistedItems = wishlistRows.map((item) => {
    const saved = Number(item.price_at_save);
    const current = Number(item.current_price);
    const isDropped = current < saved;
    if (isDropped) priceDropsCount++;

    return {
      id: item.id,
      product_id: item.product_id,
      title_en: item.title_en,
      title_bn: item.title_bn,
      slug: item.slug,
      saved_price: saved.toFixed(2),
      current_price: current.toFixed(2),
      price_dropped: isDropped,
      drop_amount: isDropped ? (saved - current).toFixed(2) : '0.00',
    };
  });

  // 5. Digital Warranty Cards Count
  let activeWarrantiesCount = 0;
  try {
    const { rows: warrantyRows } = await db.query(
      `SELECT COUNT(*) as active_count
       FROM warranty_cards
       WHERE customer_id = $1 AND status = 'ACTIVE' AND expires_at > NOW()`,
      [parsedUserId]
    );
    activeWarrantiesCount = Number(warrantyRows[0]?.active_count || 0);
  } catch {}

  // 6. Active Team Purchases (Group Buy)
  let activeTeamsCount = 0;
  try {
    const { rows: teamRows } = await db.query(
      `SELECT COUNT(*) as team_count
       FROM group_buy_members gbm
       JOIN group_buy_teams gbt ON gbt.id = gbm.team_id
       WHERE gbm.user_id = $1 AND gbt.status = 'ACTIVE' AND gbt.expires_at > NOW()`,
      [parsedUserId]
    );
    activeTeamsCount = Number(teamRows[0]?.team_count || 0);
  } catch {}

  // 7. Followed Stores Count
  let followedStoresCount = 0;
  try {
    const { rows: followRows } = await db.query(
      `SELECT COUNT(*) as follow_count FROM store_follows WHERE user_id = $1`,
      [parsedUserId]
    );
    followedStoresCount = Number(followRows[0]?.follow_count || 0);
  } catch {}

  // 8. User Referral Code
  // Referral codes live in their own table (023_referral.sql), not on `users`. A customer who has
  // never opened the referral flow has no row yet, hence the generated fallback.
  const { rows: refRows } = await db.query(
    `SELECT COALESCE(custom_slug, code) AS referral_code FROM user_referral_codes WHERE user_id = $1`,
    [parsedUserId]
  );
  const referralCode = refRows[0]?.referral_code || `REF${parsedUserId.toString().padStart(6, '0')}`;

  // 9. Returns & Claims in Progress
  let activeReturnsCount = 0;
  try {
    const { rows: returnRows } = await db.query(
      `SELECT COUNT(*) as return_count
       FROM return_requests
       WHERE customer_id = $1 AND status IN ('REQUESTED', 'APPROVED', 'IN_INSPECTION')`,
      [parsedUserId]
    );
    activeReturnsCount = Number(returnRows[0]?.return_count || 0);
  } catch {}

  // 10. Check if user is already a saler
  // user_roles is a join table (user_id, role_id) — the role name lives on `roles.key`.
  const { rows: roleRows } = await db.query(
    `SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1 AND r.key = 'saler'`,
    [parsedUserId]
  );
  const isAlreadySaler = roleRows.length > 0;

  return {
    user_id: parsedUserId,
    is_saler: isAlreadySaler,
    orders: {
      active_count: Number(orderStats.active_orders_count || 0),
      delivered_count: Number(orderStats.delivered_orders_count || 0),
      total_count: Number(orderStats.total_orders_count || 0),
      latest_order: latestOrder,
    },
    rewards: {
      coins_balance: Number(coins.balance || 0),
      current_streak_days: Number(coins.current_streak || 1),
      total_earned: Number(coins.total_earned || 0),
      referral_code: referralCode,
      referral_share_url: `https://explooro.com/r/${referralCode}`,
    },
    wishlist: {
      total_items: wishlistedItems.length,
      price_drops_count: priceDropsCount,
      items: wishlistedItems.slice(0, 4),
    },
    protection: {
      active_warranties_count: activeWarrantiesCount,
      active_returns_count: activeReturnsCount,
    },
    social: {
      active_teams_count: activeTeamsCount,
      followed_stores_count: followedStoresCount,
    },
  };
}

/**
 * Returns customer orders with items, visual tracking stages, and courier info.
 */
export async function getCustomerOrders(db, userId, { status = 'ALL', limit = 20, offset = 0 } = {}) {
  const parsedUserId = Number(userId);

  let statusClause = '';
  const params = [parsedUserId, Number(limit), Number(offset)];

  // Filters map onto the real sub_orders lifecycle enum (PLACED → CONFIRMED → PACKED → SHIPPED →
  // IN_TRANSIT → DELIVERED, plus CANCELLED/RETURNED/REFUNDED). The previous vocabulary here
  // ('PENDING', 'PROCESSING', 'DISPATCHED', 'OUT_FOR_DELIVERY') matched no value the schema allows.
  if (status === 'PROCESSING') {
    statusClause = `AND ${ORDER_STATUS} IN ('PLACED', 'CONFIRMED', 'PACKED')`;
  } else if (status === 'IN_TRANSIT') {
    statusClause = `AND ${ORDER_STATUS} IN ('SHIPPED', 'IN_TRANSIT')`;
  } else if (status === 'DELIVERED') {
    statusClause = `AND ${ORDER_STATUS} = 'DELIVERED'`;
  } else if (status === 'CANCELLED') {
    statusClause = `AND ${ORDER_STATUS} IN ('CANCELLED', 'RETURNED', 'REFUNDED')`;
  }

  const { rows: orderRows } = await db.query(
    `SELECT o.id, o.ref, ${ORDER_STATUS} AS status, o.total_amount,
            o.shipping_amount AS delivery_fee, o.discount_amount,
            o.payment_method, o.payment_status,
            ${DELIVERY_ADDRESS_SQL} AS delivery_address_json,
            o.created_at, o.updated_at
     FROM orders o
     WHERE o.customer_id = $1 ${statusClause}
     ORDER BY o.created_at DESC
     LIMIT $2 OFFSET $3`,
    params
  );

  const enrichedOrders = await Promise.all(
    orderRows.map(async (order) => {
      // 1. Order Items
      const { rows: itemRows } = await db.query(
        // order_items snapshots one title (title_snapshot) rather than an en/bn pair, and carries
        // qty / retail_price / line_total. The live product title is joined for language fallback.
        `SELECT oi.id, oi.product_id, oi.variant_id, oi.qty as quantity,
                oi.retail_price as unit_price, oi.line_total as total_price,
                COALESCE(oi.title_snapshot, p.title_en) as product_title_en,
                COALESCE(p.title_bn, oi.title_snapshot) as product_title_bn,
                pv.sku as product_sku,
                p.slug as product_slug,
                ${PRIMARY_IMAGE_SQL} as image_key,
                (SELECT id FROM warranty_cards WHERE order_item_id = oi.id LIMIT 1) as warranty_card_id
         FROM order_items oi
         JOIN sub_orders so ON so.id = oi.sub_order_id
         JOIN products p ON p.id = oi.product_id
         LEFT JOIN product_variants pv ON pv.id = oi.variant_id
         WHERE so.order_id = $1`,
        [order.id]
      );

      // 2. Sub-orders & 3PL Logistics Tracking
      const { rows: subRows } = await db.query(
        // Courier and tracking live on `shipments` (keyed by sub_order_id), not on the parcel row.
        `SELECT so.id, so.ref, so.status,
                sh.carrier as courier_name, sh.tracking_number,
                sh.created_at as dispatched_at, so.delivered_at,
                COALESCE(up.display_name, up.full_name) as supplier_name_en,
                COALESCE(up.display_name, up.full_name) as supplier_name_bn
         FROM sub_orders so
         LEFT JOIN users u ON u.id = so.supplier_id
         LEFT JOIN user_profiles up ON up.user_id = u.id
         LEFT JOIN shipments sh ON sh.sub_order_id = so.id
         WHERE so.order_id = $1`,
        [order.id]
      );

      // Visual tracking stage 1..5. SHIPPED and IN_TRANSIT collapse into one "on its way" step, so
      // the six lifecycle statuses map onto five dots. Terminal statuses (cancelled/returned/
      // refunded) fall through to 1 rather than rendering a misleading progress bar.
      const trackingStep = TRACKING_STEP_BY_STATUS[order.status] ?? 1;

      const isDelivered = order.status === 'DELIVERED';
      const orderDate = new Date(order.created_at);
      const now = new Date();
      const daysSinceOrder = (now.getTime() - orderDate.getTime()) / (1000 * 3600 * 24);
      const isReturnEligible = isDelivered && daysSinceOrder <= 7;

      return {
        id: Number(order.id),
        ref: order.ref,
        status: order.status,
        tracking_step: trackingStep,
        total_amount: Number(order.total_amount).toFixed(2),
        delivery_fee: Number(order.delivery_fee || 0).toFixed(2),
        discount_amount: Number(order.discount_amount || 0).toFixed(2),
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        address: typeof order.delivery_address_json === 'string'
          ? JSON.parse(order.delivery_address_json || '{}')
          : (order.delivery_address_json || {}),
        created_at: order.created_at,
        is_return_eligible: isReturnEligible,
        is_cancellable: ['PLACED', 'CONFIRMED'].includes(order.status),
        items: itemRows.map((it) => ({
          id: Number(it.id),
          product_id: Number(it.product_id),
          title_en: it.product_title_en,
          title_bn: it.product_title_bn,
          slug: it.product_slug,
          quantity: it.quantity,
          unit_price: Number(it.unit_price).toFixed(2),
          total_price: Number(it.total_price).toFixed(2),
          image_url: it.image_key ? `/media/${it.image_key}` : '/placeholder-product.svg',
          warranty_card_id: it.warranty_card_id ? Number(it.warranty_card_id) : null,
        })),
        sub_orders: subRows.map((so) => ({
          id: Number(so.id),
          ref: so.ref,
          status: so.status,
          courier_name: so.courier_name || 'Standard Logistics',
          tracking_number: so.tracking_number,
          tracking_url: so.tracking_number ? `https://track.explooro.com/${so.tracking_number}` : null,
          supplier_name: so.supplier_name_en || 'Merchant Partner',
        })),
      };
    })
  );

  return {
    orders: enrichedOrders,
    count: enrichedOrders.length,
  };
}

/**
 * Returns activity feed from stores followed by the customer.
 */
export async function getFollowingFeed(db, userId) {
  const parsedUserId = Number(userId);

  // 1. Followed Stores List
  const { rows: storeRows } = await db.query(
    `SELECT vs.id, vs.ref, vs.slug, vs.shop_name, vs.bio, vs.is_active as is_published,
            COALESCE(up.display_name, up.full_name) as saler_name_en,
            COALESCE(up.display_name, up.full_name) as saler_name_bn,
            (SELECT COUNT(*) FROM saler_store_items WHERE saler_id = vs.saler_id) as total_products,
            sf.created_at as followed_at
     FROM store_follows sf
     JOIN virtual_stores vs ON vs.id = sf.store_id
     JOIN users u ON u.id = vs.saler_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE sf.user_id = $1 AND vs.deleted_at IS NULL
     ORDER BY sf.created_at DESC`,
    [parsedUserId]
  );

  const followedStoreIds = storeRows.map((s) => s.id);

  if (followedStoreIds.length === 0) {
    // If user follows 0 stores, provide suggested popular stores
    const { rows: suggestedRows } = await db.query(
      `SELECT vs.id, vs.ref, vs.slug, vs.shop_name, vs.bio,
              (SELECT COUNT(*) FROM saler_store_items WHERE saler_id = vs.saler_id) as total_products
       FROM virtual_stores vs
       WHERE vs.deleted_at IS NULL AND vs.is_active = true
       ORDER BY vs.created_at DESC
       LIMIT 4`
    );

    return {
      followed_stores: [],
      suggested_stores: suggestedRows.map((s) => ({
        id: Number(s.id),
        slug: s.slug,
        shop_name: s.shop_name,
        bio: s.bio,
        total_products: Number(s.total_products || 0),
        is_following: false,
      })),
      product_drops: [],
      live_streams: [],
      stories: [],
    };
  }

  // 2. Product Drops from Followed Stores (Recently curated items)
  const { rows: dropRows } = await db.query(
    `SELECT ssi.id as item_id, ssi.added_at as dropped_at,
            vs.id as store_id, vs.slug as store_slug, vs.shop_name,
            p.id as product_id, p.ref as product_ref, p.slug as product_slug,
            p.title_en, p.title_bn, p.default_retail_price as retail_price,
            ${PRIMARY_IMAGE_SQL} as image_key
     FROM store_follows sf
     JOIN virtual_stores vs ON vs.id = sf.store_id
     JOIN saler_store_items ssi ON ssi.saler_id = vs.saler_id
     JOIN products p ON p.id = ssi.product_id
     WHERE sf.user_id = $1 AND p.status = 'ACTIVE'
     ORDER BY ssi.added_at DESC
     LIMIT 12`,
    [parsedUserId]
  );

  // 3. Active & Scheduled Live Streams from Followed Merchants
  let liveStreams = [];
  try {
    const { rows: liveRows } = await db.query(
      `SELECT ls.id, ls.title, ls.status, ls.viewer_count, ls.scheduled_for as scheduled_at,
              vs.slug as store_slug, vs.shop_name
       FROM store_follows sf
       JOIN virtual_stores vs ON vs.id = sf.store_id
       JOIN live_streams ls ON ls.host_id = vs.saler_id
       WHERE sf.user_id = $1 AND ls.status IN ('LIVE', 'SCHEDULED')
       ORDER BY ls.status DESC, ls.created_at DESC
       LIMIT 6`,
      [parsedUserId]
    );
    liveStreams = liveRows.map((l) => ({
      id: Number(l.id),
      title: l.title,
      status: l.status,
      viewer_count: Number(l.viewer_count || 0),
      store_slug: l.store_slug,
      shop_name: l.shop_name,
      scheduled_at: l.scheduled_at,
    }));
  } catch {}

  // 4. Stories from Followed Merchants
  let stories = [];
  try {
    const { rows: storyRows } = await db.query(
      `SELECT st.id, st.slug, st.title_en as title, st.title_bn, st.cover_image_url, st.view_count, st.created_at,
              vs.slug as store_slug, vs.shop_name
       FROM store_follows sf
       JOIN virtual_stores vs ON vs.id = sf.store_id
       JOIN stories st ON st.author_id = vs.saler_id
       WHERE sf.user_id = $1 AND st.status = 'PUBLISHED'
       ORDER BY st.created_at DESC
       LIMIT 6`,
      [parsedUserId]
    );
    stories = storyRows.map((s) => ({
      id: Number(s.id),
      slug: s.slug,
      title: s.title,
      cover_image_url: s.cover_image_url || '/placeholder-product.svg',
      view_count: Number(s.view_count || 0),
      store_slug: s.store_slug,
      shop_name: s.shop_name,
      created_at: s.created_at,
    }));
  } catch {}

  return {
    followed_stores: storeRows.map((s) => ({
      id: Number(s.id),
      slug: s.slug,
      shop_name: s.shop_name,
      bio: s.bio,
      total_products: Number(s.total_products || 0),
      is_following: true,
      followed_at: s.followed_at,
    })),
    product_drops: dropRows.map((d) => ({
      item_id: Number(d.item_id),
      store_id: Number(d.store_id),
      store_slug: d.store_slug,
      shop_name: d.shop_name,
      product_id: Number(d.product_id),
      product_ref: d.product_ref,
      slug: d.product_slug,
      title_en: d.title_en,
      title_bn: d.title_bn,
      retail_price: Number(d.retail_price).toFixed(2),
      image_url: d.image_key ? `/media/${d.image_key}` : '/placeholder-product.svg',
      dropped_at: d.dropped_at,
    })),
    live_streams: liveStreams,
    stories: stories,
  };
}

/**
 * Toggles following a virtual store.
 */
export async function toggleFollowStore(db, { userId, storeId }) {
  const parsedUserId = Number(userId);
  const parsedStoreId = Number(storeId);

  if (!parsedUserId || !parsedStoreId) {
    throw new AppError('VALIDATION_ERROR', 'User ID and Store ID are required.');
  }

  const { rows: existing } = await db.query(
    `SELECT id FROM store_follows WHERE user_id = $1 AND store_id = $2`,
    [parsedUserId, parsedStoreId]
  );

  if (existing.length > 0) {
    await db.query(`DELETE FROM store_follows WHERE id = $1`, [existing[0].id]);
    return { is_following: false, store_id: parsedStoreId };
  }

  await db.query(
    `INSERT INTO store_follows (user_id, store_id, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, store_id) DO NOTHING`,
    [parsedUserId, parsedStoreId]
  );

  return { is_following: true, store_id: parsedStoreId };
}

/**
 * 1-Click Genuine Saler Upgrade:
 * - Grants 'saler' role in user_roles.
 * - Provisions a virtual store with a clean vanity slug.
 * - Ensures user digital wallet exists.
 * - Completes in under 3 seconds with zero paperwork.
 */
export async function becomeSaler(db, userId) {
  const parsedUserId = Number(userId);
  if (!parsedUserId) {
    throw new AppError('AUTH_REQUIRED', 'Sign in required for 1-click saler upgrade.');
  }

  // 1. Fetch User details
  const { rows: userRows } = await db.query(
    `SELECT u.id, u.phone,
            COALESCE(up.display_name, up.full_name) AS full_name_en,
            COALESCE(up.display_name, up.full_name) AS full_name_bn
     FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id = $1`,
    [parsedUserId]
  );
  const user = userRows[0];
  if (!user) {
    throw new AppError('NOT_FOUND', 'User account not found.');
  }

  // 2. Grant Saler Role
  await db.query(
    `INSERT INTO user_roles (user_id, role_id, assigned_at)
     SELECT $1, r.id, NOW() FROM roles r WHERE r.key = 'saler'
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [parsedUserId]
  );

  // 3. Check if user already has a store
  const { rows: existingStoreRows } = await db.query(
    `SELECT id, ref, slug, shop_name, is_active AS is_published FROM virtual_stores WHERE saler_id = $1 LIMIT 1`,
    [parsedUserId]
  );

  if (existingStoreRows.length > 0) {
    return {
      success: true,
      already_existed: true,
      store: existingStoreRows[0],
      redirect_url: '/saler/store-builder',
      message_en: 'Saler portal ready! Welcome back to your storefront.',
      message_bn: 'আপনার বিক্রেতা পোর্টাল সক্রিয় আছে! স্টোরফ্রন্ট বিল্ডারে স্বাগতম।',
    };
  }

  // 4. Generate a unique vanity store slug
  const baseName = (user.full_name_en || 'store')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'shop';

  const suffix = user.phone ? user.phone.slice(-4) : Math.floor(1000 + Math.random() * 9000);
  let candidateSlug = `${baseName}-${suffix}`;

  // Validate slug availability and append random integer if taken
  const slugCheck = await validateSlugAvailability(db, candidateSlug);
  if (!slugCheck.available) {
    candidateSlug = `${baseName}-${suffix}-${Math.floor(100 + Math.random() * 900)}`;
  }

  const storeRef = `VS-${Date.now().toString().slice(-6)}`;
  const defaultShopName = user.full_name_en ? `${user.full_name_en}'s Shop` : `Store ${candidateSlug}`;

  // 5. Provision Virtual Store
  const { rows: newStoreRows } = await db.query(
    `INSERT INTO virtual_stores
       (ref, saler_id, slug, shop_name, bio, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
     RETURNING id, ref, slug, shop_name, is_active AS is_published`,
    [
      storeRef,
      parsedUserId,
      candidateSlug,
      defaultShopName,
      'Welcome to my official digital storefront on Explooro!',
    ]
  );

  // 6. Ensure Wallet Exists
  await db.query(
    // wallets splits escrow into held_balance / pending_escrow_balance — there is no single
    // `escrow_balance` column.
    `INSERT INTO wallets (user_id, available_balance, held_balance, pending_escrow_balance, currency, created_at, updated_at)
     VALUES ($1, 0.00, 0.00, 0.00, 'BDT', NOW(), NOW())
     ON CONFLICT (user_id) DO NOTHING`,
    [parsedUserId]
  );

  return {
    success: true,
    already_existed: false,
    store: newStoreRows[0],
    redirect_url: '/saler/store-builder',
    message_en: 'Congratulations! Your virtual store is created. Welcome to Explooro Saler Hub!',
    message_bn: 'অভিনন্দন! আপনার ভার্চুয়াল দোকান তৈরি হয়েছে। এক্সপ্লোরো বিক্রেতা পোর্টালে স্বাগতম!',
  };
}

/**
 * Evaluates wishlists for price drops and dispatches notifications.
 */
export async function checkPriceDropAlerts(db, userId = null) {
  let userClause = '';
  const params = [];
  if (userId) {
    params.push(Number(userId));
    userClause = 'AND w.user_id = $1';
  }

  const { rows: dropRows } = await db.query(
    `SELECT w.id as wishlist_id, w.user_id, w.product_id, w.price_at_save,
            p.default_retail_price as current_price, p.title_en, p.title_bn
     FROM wishlists w
     JOIN products p ON p.id = w.product_id
     WHERE w.notify_on_drop = true
       AND p.default_retail_price < w.price_at_save
       ${userClause}`,
    params
  );

  const notificationsSent = [];

  for (const item of dropRows) {
    const saved = Number(item.price_at_save);
    const current = Number(item.current_price);
    const dropAmount = (saved - current).toFixed(2);

    // Record price drop alert log
    try {
      await db.query(
        `INSERT INTO price_drop_alerts (user_id, product_id, saved_price, dropped_price, drop_amount, notification_sent_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [item.user_id, item.product_id, saved, current, dropAmount]
      );
    } catch {}

    // Dispatch multi-channel notification
    try {
      await notify(db, {
        userId: item.user_id,
        templateKey: 'PRICE_DROP_ALERT',
        data: {
          productTitle: item.title_en || 'Wishlist item',
          dropAmount,
          currentPrice: current.toFixed(2),
        },
      });
      notificationsSent.push({
        user_id: item.user_id,
        product_id: item.product_id,
        drop_amount: dropAmount,
      });
    } catch {}
  }

  return {
    total_evaluated: dropRows.length,
    alerts_dispatched: notificationsSent.length,
    notifications: notificationsSent,
  };
}
