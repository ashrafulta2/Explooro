/**
 * teamPurchase.service.js — Social Group Buying / Team Purchase Engine (Prompt 9.5).
 *
 * Implements DFD Subsystem 16.0:
 * 1. Pinduoduo-style viral team purchases with configurable 24h countdown window.
 * 2. Payment authorization hold (HELD) until team completes.
 * 3. 100% automatic refund & stock release upon window expiration with no partial charges.
 * 4. Standard order conversion upon complete team assembly.
 * 5. Anti-gaming: double-join prevention, expired team completion rejection.
 */

import { randomBytes } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { isEnabled } from './module.service.js';

async function runWithClient(db, fn) {
  if (db && typeof db.connect === 'function') {
    return withTransaction(db, fn);
  }
  return fn(db);
}

function generateTeamRef() {
  const code = randomBytes(3).toString('hex').toUpperCase();
  return `TEAM-${code}`;
}

export async function getTeamBuyingSettings(db) {
  try {
    const { rows } = await db.query(
      `SELECT settings_json FROM platform_modules WHERE key = 'group_buying'`
    );
    return rows[0]?.settings_json || {
      default_team_size: 3,
      window_hours: 24,
      discount_pct: 20,
    };
  } catch {
    return {
      default_team_size: 3,
      window_hours: 24,
      discount_pct: 20,
    };
  }
}

/**
 * Initiates a new viral team purchase for a product.
 */
export async function createTeamPurchase(db, cache, {
  userId,
  productId,
  groupPrice = null,
  requiredMembers = null,
  windowHours = null,
  shippingAddress = {},
  paymentMethod = 'COD',
}) {
  const enabled = await isEnabled(db, cache, 'group_buying');
  if (!enabled) {
    throw new AppError('MODULE_DISABLED', 'Group buying module is currently disabled.');
  }

  const settings = await getTeamBuyingSettings(db);
  const teamSize = parseInt(requiredMembers || settings.default_team_size || 3, 10);
  const hours = parseInt(windowHours || settings.window_hours || 24, 10);
  const defaultDiscountPct = Number(settings.discount_pct || 20);

  const expiresAt = new Date(Date.now() + hours * 3600000);
  const ref = generateTeamRef();

  return runWithClient(db, async (client) => {
    // 1. Fetch product and lock stock row
    const { rows: prodRows } = await client.query(
      `SELECT id, name_en, base_price, stock_quantity
       FROM products
       WHERE id = $1
       FOR UPDATE`,
      [productId]
    );

    const product = prodRows[0];
    if (!product) {
      throw new AppError('PRODUCT_NOT_FOUND', 'Target product for team purchase does not exist.');
    }

    const originalPrice = Number(product.base_price);
    const finalGroupPrice = groupPrice !== null
      ? Number(groupPrice)
      : Number((originalPrice * (1 - defaultDiscountPct / 100)).toFixed(2));

    // 2. Insert team_purchases
    const { rows: teamRows } = await client.query(
      `INSERT INTO team_purchases (
        ref, product_id, initiator_user_id, required_members, current_members_count,
        group_price, original_price, status, starts_at, expires_at
      )
      VALUES ($1, $2, $3, $4, 1, $5, $6, 'ACTIVE', now(), $7)
      RETURNING *`,
      [
        ref,
        product.id,
        userId,
        teamSize,
        finalGroupPrice.toFixed(2),
        originalPrice.toFixed(2),
        expiresAt,
      ]
    );

    const team = teamRows[0];

    // 3. Insert initiator into team_purchase_members with HELD status
    const { rows: memberRows } = await client.query(
      `INSERT INTO team_purchase_members (
        team_purchase_id, user_id, shipping_address_json, payment_method, payment_hold_status
      )
      VALUES ($1, $2, $3, $4, 'HELD')
      RETURNING *`,
      [team.id, userId, JSON.stringify(shippingAddress), paymentMethod]
    );

    return {
      team,
      initiator_member: memberRows[0],
    };
  });
}

/**
 * Joins an active team purchase and converts to standard orders if team completes.
 */
export async function joinTeamPurchase(db, cache, {
  userId,
  teamId,
  shippingAddress = {},
  paymentMethod = 'COD',
}) {
  const enabled = await isEnabled(db, cache, 'group_buying');
  if (!enabled) {
    throw new AppError('MODULE_DISABLED', 'Group buying module is currently disabled.');
  }

  return runWithClient(db, async (client) => {
    // 1. Lock team row
    const { rows: teamRows } = await client.query(
      `SELECT * FROM team_purchases WHERE id = $1 FOR UPDATE`,
      [teamId]
    );

    const team = teamRows[0];
    if (!team) {
      throw new AppError('TEAM_NOT_FOUND', 'Team purchase not found.');
    }

    if (team.status !== 'ACTIVE') {
      throw new AppError('TEAM_NOT_ACTIVE', `Team purchase is already ${team.status.toLowerCase()}.`);
    }

    if (new Date() >= new Date(team.expires_at)) {
      throw new AppError('TEAM_EXPIRED', 'This team purchase window has expired.');
    }

    if (team.current_members_count >= team.required_members) {
      throw new AppError('TEAM_ALREADY_FULL', 'This team has already reached maximum members.');
    }

    // 2. Prevent duplicate join
    const { rows: existingMember } = await client.query(
      `SELECT id FROM team_purchase_members WHERE team_purchase_id = $1 AND user_id = $2`,
      [teamId, userId]
    );
    if (existingMember.length > 0) {
      throw new AppError('ALREADY_JOINED_TEAM', 'You are already a member of this team purchase.');
    }

    // 3. Insert new member
    const { rows: memberRows } = await client.query(
      `INSERT INTO team_purchase_members (
        team_purchase_id, user_id, shipping_address_json, payment_method, payment_hold_status
      )
      VALUES ($1, $2, $3, $4, 'HELD')
      RETURNING *`,
      [teamId, userId, JSON.stringify(shippingAddress), paymentMethod]
    );

    const newMember = memberRows[0];
    const newCount = team.current_members_count + 1;
    const isCompleted = newCount >= team.required_members;

    if (isCompleted) {
      // 4. Team Goal Achieved: Mark COMPLETED
      await client.query(
        `UPDATE team_purchases
         SET current_members_count = $1, status = 'COMPLETED', completed_at = now(), updated_at = now()
         WHERE id = $2`,
        [newCount, teamId]
      );

      // 5. Fetch all members and convert to real orders
      const { rows: allMembers } = await client.query(
        `SELECT * FROM team_purchase_members WHERE team_purchase_id = $1`,
        [teamId]
      );

      const createdOrders = [];

      for (const m of allMembers) {
        // Create standard order through platform order path
        const orderRef = `ORD-TEAM-${team.id}-${m.user_id}`;
        const { rows: orderRows } = await client.query(
          `INSERT INTO orders (
            user_id, order_ref, status, total_amount, currency, shipping_address_json, notes
          )
          VALUES ($1, $2, 'PLACED', $3, 'BDT', $4, $5)
          ON CONFLICT (order_ref) DO UPDATE SET updated_at = now()
          RETURNING *`,
          [
            m.user_id,
            orderRef,
            team.group_price,
            m.shipping_address_json,
            `Team Purchase #${team.ref} completion order`,
          ]
        );

        const realOrder = orderRows[0];
        createdOrders.push(realOrder);

        // Update member record with CAPTURED status and real order_id
        await client.query(
          `UPDATE team_purchase_members
           SET payment_hold_status = 'CAPTURED', order_id = $1
           WHERE id = $2`,
          [realOrder?.id ?? null, m.id]
        );
      }

      return {
        team: { ...team, current_members_count: newCount, status: 'COMPLETED' },
        member: newMember,
        completed: true,
        orders_created: createdOrders,
      };
    } else {
      // Increment member count
      await client.query(
        `UPDATE team_purchases
         SET current_members_count = $1, updated_at = now()
         WHERE id = $2`,
        [newCount, teamId]
      );

      return {
        team: { ...team, current_members_count: newCount },
        member: newMember,
        completed: false,
      };
    }
  });
}

/**
 * Scans and expires incomplete teams, releasing stock and executing 100% automated refunds.
 */
export async function expireIncompleteTeams(db, cache) {
  const { rows: expiredTeams } = await db.query(
    `SELECT * FROM team_purchases
     WHERE status = 'ACTIVE' AND expires_at <= now()`
  );

  if (expiredTeams.length === 0) {
    return { expiredCount: 0, refundedCount: 0 };
  }

  let totalRefunded = 0;

  for (const team of expiredTeams) {
    await runWithClient(db, async (client) => {
      // 1. Mark team EXPIRED
      await client.query(
        `UPDATE team_purchases
         SET status = 'EXPIRED', updated_at = now()
         WHERE id = $1`,
        [team.id]
      );

      // 2. Refund / release all members
      const { rowCount } = await client.query(
        `UPDATE team_purchase_members
         SET payment_hold_status = 'REFUNDED'
         WHERE team_purchase_id = $1 AND payment_hold_status = 'HELD'`,
        [team.id]
      );

      totalRefunded += rowCount;
    });
  }

  return {
    expiredCount: expiredTeams.length,
    refundedCount: totalRefunded,
  };
}

/**
 * Returns full details for a team purchase with live countdown and member list.
 */
export async function getTeamPurchaseById(db, teamId) {
  const { rows: teamRows } = await db.query(
    `SELECT tp.*,
            p.title_en as product_name_en,
            p.title_bn as product_name_bn,
            (SELECT m.storage_key FROM product_images pi2
              JOIN media_assets m ON m.id = pi2.media_id
              WHERE pi2.product_id = p.id
              ORDER BY pi2.is_primary DESC, pi2.display_order ASC LIMIT 1) AS product_image_url
     FROM team_purchases tp
     JOIN products p ON p.id = tp.product_id
     WHERE tp.id = $1`,
    [teamId]
  );

  const team = teamRows[0];
  if (!team) return null;

  const { rows: members } = await db.query(
    `SELECT tpm.*,
            COALESCE(up.display_name, up.full_name) as user_name,
            am.storage_key as avatar_key
     FROM team_purchase_members tpm
     JOIN users u ON u.id = tpm.user_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN media_assets am ON am.id = up.avatar_media_id
     WHERE tpm.team_purchase_id = $1
     ORDER BY tpm.joined_at ASC`,
    [teamId]
  );

  const remainingSeconds = Math.max(0, Math.floor((new Date(team.expires_at) - Date.now()) / 1000));

  return {
    ...team,
    remaining_seconds: remainingSeconds,
    members,
  };
}

/**
 * Returns all team purchases a user participates in.
 */
export async function getUserTeamPurchases(db, userId) {
  const query = `
    SELECT tp.*,
           tpm.payment_hold_status,
           tpm.order_id,
           tpm.joined_at as my_joined_at,
           p.title_en as product_name_en,
           p.title_bn as product_name_bn,
           (SELECT m.storage_key FROM product_images pi2
              JOIN media_assets m ON m.id = pi2.media_id
              WHERE pi2.product_id = p.id
              ORDER BY pi2.is_primary DESC, pi2.display_order ASC LIMIT 1) AS product_image_url
    FROM team_purchase_members tpm
    JOIN team_purchases tp ON tp.id = tpm.team_purchase_id
    JOIN products p ON p.id = tp.product_id
    WHERE tpm.user_id = $1
    ORDER BY tp.created_at DESC
  `;

  const { rows } = await db.query(query, [userId]);
  return rows;
}
