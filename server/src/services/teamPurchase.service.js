/**
 * teamPurchase.service.js — Social Group Buying / Team Purchase Engine (Prompt 9.5).
 *
 * Implements DFD Subsystem 16.0:
 * 1. Pinduoduo-style team purchases with a countdown window (window_hours).
 * 2. A member pays by Cash on Delivery or from their Explooro wallet. A WALLET member's money moves
 *    from their AVAILABLE bucket to their own HELD bucket when they join, and stays there until the
 *    team either completes (it pays for their order) or expires (it goes back to AVAILABLE).
 * 3. When the last member joins, every member gets a real order (orders → sub_orders → order_items)
 *    at the group price plus the shipping charge, in the same transaction as the join.
 * 4. Anti-gaming: double-join prevention, expired team completion rejection, and the group price is
 *    computed here from settings — never taken from the request.
 *
 * Every number (team sizes' discounts, window, shipping charge) is in the group_buying module's
 * settings_json, edited by a super admin at /admin/growth/group-buy.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import * as codGateService from './codGate.service.js';
import { AppError } from '../plugins/errorHandler.js';
import { generateRef } from '../lib/ref.js';
import { findDistrict } from '../lib/bdDistricts.js';
import * as orderRepo from '../repositories/order.repository.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';
import * as vaultService from './vault.service.js';
import { isEnabled, updateModuleSettings } from './module.service.js';
import { calculatePricingBreakdown } from './pricing.service.js';

export const TEAM_SIZES = Object.freeze([2, 3]);
export const PAYMENT_METHODS = Object.freeze(['COD', 'WALLET']);

export const DEFAULT_SETTINGS = Object.freeze({
  default_team_size: 3,
  window_hours: 24,
  discount_pct_2: 15,
  discount_pct_3: 25,
  shipping_charge: 60,
});

// WHY these bounds: the same numbers are in 068_team_purchase_checkout.sql's settings_schema, so
// the generic module drawer and this page refuse the same values. A discount above 90% would sell
// at a price no supplier agreed to (the price is floored at their wholesale cost anyway).
export const SETTING_LIMITS = Object.freeze({
  window_hours: { min: 1, max: 168 },
  discount_pct: { min: 0, max: 90 },
  shipping_charge: { min: 0, max: 5000 },
});

const NAME_MAX = 100;
const ADDRESS_MIN = 10;
const ADDRESS_MAX = 300;

const toPaisa = (v) => Math.round(Number(v) * 100);
const fromPaisa = (p) => (p / 100).toFixed(2);

// WHY only documented codes (docs/api-contract.md): a code missing from errorHandler's ERROR_STATUS
// answers HTTP 500, which is what TEAM_NOT_FOUND, TEAM_EXPIRED and the rest used to do.

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

// ---- settings ---------------------------------------------------------------------------------------

/**
 * Merges stored settings over the defaults, field by field. Forgiving: a malformed field falls back
 * to its default, so one bad edit cannot stop teams from completing or expiring.
 */
export function resolveSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SETTINGS;
  const int = (v, { min, max }, fallback) => (Number.isInteger(v) && v >= min && v <= max ? v : fallback);
  const num = (v, { min, max }, fallback) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback);
  // WHY discount_pct as the second fallback: rows written before 068 only had the one discount.
  const legacyPct = int(r.discount_pct, SETTING_LIMITS.discount_pct, null);
  return {
    default_team_size: TEAM_SIZES.includes(r.default_team_size) ? r.default_team_size : d.default_team_size,
    window_hours: int(r.window_hours, SETTING_LIMITS.window_hours, d.window_hours),
    discount_pct_2: int(r.discount_pct_2, SETTING_LIMITS.discount_pct, legacyPct ?? d.discount_pct_2),
    discount_pct_3: int(r.discount_pct_3, SETTING_LIMITS.discount_pct, legacyPct ?? d.discount_pct_3),
    shipping_charge: num(r.shipping_charge, SETTING_LIMITS.shipping_charge, d.shipping_charge),
  };
}

export async function getTeamBuyingSettings(db) {
  try {
    const { rows } = await db.query(
      `SELECT settings_json FROM platform_modules WHERE key = 'group_buying'`
    );
    return resolveSettings(rows[0]?.settings_json);
  } catch {
    return resolveSettings(null);
  }
}

/**
 * Validates an admin's settings edit. Strict: an out-of-range value is refused, never clamped.
 * Only the fields present are returned, so a partial edit leaves the rest alone.
 */
export function validateSettingsPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('VALIDATION_FAILED', 'Settings must be an object.', 'সেটিংস সঠিক নয়।');
  }
  const out = {};
  const bad = (en, bn) => new AppError('VALIDATION_FAILED', en, bn);

  if (input.shipping_charge !== undefined) {
    const n = input.shipping_charge;
    const { min, max } = SETTING_LIMITS.shipping_charge;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
      throw bad(`Shipping charge must be between ৳${min} and ৳${max}.`, `শিপিং চার্জ ৳${min} থেকে ৳${max}-এর মধ্যে হতে হবে।`);
    }
    if (Math.round(n * 100) / 100 !== n) {
      throw bad('Shipping charge cannot have more than two decimal places.', 'শিপিং চার্জে দুই দশমিকের বেশি ঘর হবে না।');
    }
    out.shipping_charge = n;
  }
  for (const key of ['discount_pct_2', 'discount_pct_3']) {
    if (input[key] === undefined) continue;
    const { min, max } = SETTING_LIMITS.discount_pct;
    if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) {
      throw bad(`Discount must be a whole number from ${min} to ${max}.`, `ছাড় ${min} থেকে ${max}-এর মধ্যে একটি পূর্ণ সংখ্যা হতে হবে।`);
    }
    out[key] = input[key];
  }
  if (input.window_hours !== undefined) {
    const { min, max } = SETTING_LIMITS.window_hours;
    if (!Number.isInteger(input.window_hours) || input.window_hours < min || input.window_hours > max) {
      throw bad(`Team window must be ${min} to ${max} hours.`, `টিমের সময়সীমা ${min} থেকে ${max} ঘণ্টা হতে হবে।`);
    }
    out.window_hours = input.window_hours;
  }
  if (input.default_team_size !== undefined) {
    if (!TEAM_SIZES.includes(input.default_team_size)) {
      throw bad('Default team size must be 2 or 3.', 'ডিফল্ট টিমের আকার ২ বা ৩ হতে হবে।');
    }
    out.default_team_size = input.default_team_size;
  }
  if (Object.keys(out).length === 0) {
    throw bad('Nothing to update.', 'পরিবর্তন করার মতো কিছু নেই।');
  }
  return out;
}

// ---- pure rules -------------------------------------------------------------------------------------

/**
 * The price one member pays for the product in a team of `size`. Rounded to whole taka like the
 * product page shows it, and never below the supplier's wholesale cost (base cost + wholesale
 * margin): a team discount comes out of the retail margin, not out of the supplier's price.
 */
export function computeGroupPrice({ retailPrice, baseCost, wholesaleMargin, discountPct }) {
  const retailPaisa = toPaisa(retailPrice);
  const floorPaisa = toPaisa(baseCost) + toPaisa(wholesaleMargin || 0);
  const discountedPaisa = Math.round((retailPaisa * (100 - discountPct)) / 100 / 100) * 100;
  const groupPaisa = Math.min(retailPaisa, Math.max(floorPaisa, discountedPaisa));
  const effectivePct = retailPaisa > 0 ? Math.round(((retailPaisa - groupPaisa) * 100) / retailPaisa) : 0;
  return { groupPaisa, group_price: fromPaisa(groupPaisa), discount_pct: effectivePct };
}

export function discountForSize(settings, size) {
  return size === 2 ? settings.discount_pct_2 : settings.discount_pct_3;
}

/** Validates the two fields the form asks for. Returns the trimmed values. */
export function validateRecipient({ recipientName, addressLine }) {
  const name = typeof recipientName === 'string' ? recipientName.trim() : '';
  const address = typeof addressLine === 'string' ? addressLine.trim() : '';
  if (!name) {
    throw new AppError('VALIDATION_FAILED', "Recipient's name is required.", 'প্রাপকের নাম আবশ্যক।');
  }
  if (name.length > NAME_MAX) {
    throw new AppError('VALIDATION_FAILED', `Recipient's name can be at most ${NAME_MAX} characters.`, `প্রাপকের নাম সর্বোচ্চ ${NAME_MAX} অক্ষরের হতে পারে।`);
  }
  if (address.length < ADDRESS_MIN || address.length > ADDRESS_MAX) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Address must be ${ADDRESS_MIN} to ${ADDRESS_MAX} characters (house, road, area, district).`,
      `ঠিকানা ${ADDRESS_MIN} থেকে ${ADDRESS_MAX} অক্ষরের হতে হবে (বাড়ি, রাস্তা, এলাকা, জেলা)।`
    );
  }
  return { recipient_name: name, address_line: address };
}

function assertPaymentMethod(method) {
  if (!PAYMENT_METHODS.includes(method)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Choose Cash on Delivery or Wallet.',
      'ক্যাশ অন ডেলিভারি অথবা ওয়ালেট বেছে নিন।'
    );
  }
}

// ---- wallet hold ------------------------------------------------------------------------------------

/** AVAILABLE → HELD in the member's own wallet. Throws INSUFFICIENT_BALANCE when it does not fit. */
async function holdWalletFunds(client, { teamId, userId, amountPaisa }) {
  const wallet = await walletRepo.getOrCreateWallet(client, userId, { client });
  const [locked] = await walletRepo.getWalletsByIdsForUpdate(client, [wallet.id]);
  if (toPaisa(locked.available_balance) < amountPaisa) {
    throw new AppError(
      'INSUFFICIENT_BALANCE',
      `Your wallet needs ৳${fromPaisa(amountPaisa)} for this team purchase.`,
      `এই টিম পারচেজের জন্য আপনার ওয়ালেটে ৳${fromPaisa(amountPaisa)} থাকতে হবে।`,
      { required: fromPaisa(amountPaisa), available: locked.available_balance }
    );
  }
  const txnGroupId = randomUUID();
  const key = `team:${teamId}:user:${userId}:hold`;
  await ledgerService.recordTransactionGroup(client, {
    txnGroupId,
    entries: [
      { walletId: wallet.id, entryType: 'DEBIT', amount: fromPaisa(amountPaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:out` },
      { walletId: wallet.id, entryType: 'CREDIT', amount: fromPaisa(amountPaisa), balanceBucket: 'HELD', idempotencyKey: `${key}:in` },
    ],
    defaultCategory: 'TEAM_PURCHASE_HOLD',
    defaultReferenceType: 'team_purchases',
    defaultReferenceId: teamId,
    memo: `Held for team purchase #${teamId}`,
    createdBy: userId,
  });
  return txnGroupId;
}

/** HELD → AVAILABLE. `reason` is 'complete' (the order's escrow deposit spends it next) or 'expire'. */
async function releaseWalletFunds(client, { teamId, userId, amountPaisa, reason }) {
  const wallet = await walletRepo.getOrCreateWallet(client, userId, { client });
  const key = `team:${teamId}:user:${userId}:release`;
  await ledgerService.recordTransactionGroup(client, {
    entries: [
      { walletId: wallet.id, entryType: 'DEBIT', amount: fromPaisa(amountPaisa), balanceBucket: 'HELD', idempotencyKey: `${key}:out` },
      { walletId: wallet.id, entryType: 'CREDIT', amount: fromPaisa(amountPaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:in` },
    ],
    defaultCategory: 'TEAM_PURCHASE_RELEASE',
    defaultReferenceType: 'team_purchases',
    defaultReferenceId: teamId,
    memo: reason === 'expire' ? `Team purchase #${teamId} expired` : `Team purchase #${teamId} completed`,
    createdBy: userId,
  });
}

function memberTotalPaisa(team) {
  return toPaisa(team.group_price) + toPaisa(team.shipping_charge || 0);
}

/**
 * The same COD trust / OTP gate checkout applies, for a member about to owe group price + shipping
 * on delivery. The code goes to the account phone, which is also the phone on the order.
 * A WALLET member pays up front and is not gated.
 */
async function gateCodMember(db, cache, client, { team, userId, paymentMethod, cod }) {
  if (paymentMethod !== 'COD') return { isOtpVerified: false, trustScore: null };
  const { rows } = await client.query(`SELECT phone FROM users WHERE id = $1`, [userId]);
  return codGateService.enforceCodGate(db, cache, {
    client,
    userId,
    phone: rows[0]?.phone || null,
    orderAmount: Number(fromPaisa(memberTotalPaisa(team))),
    otpCode: cod?.otpCode ?? null,
    smsSender: cod?.smsSender ?? null,
    isDevelopment: Boolean(cod?.isDevelopment),
    ip: cod?.ip ?? null,
  });
}

// ---- quote ------------------------------------------------------------------------------------------

/**
 * What the team-purchase form shows before anything is created: the price for each team size, the
 * shipping charge, the accepted payment methods and (when signed in) the wallet balance. The form
 * renders these numbers rather than computing its own, so what it shows is what is charged.
 */
export async function getQuote(db, { productId, userId = null }) {
  const { rows } = await db.query(
    `SELECT id, default_retail_price, base_cost, wholesale_margin, status, stock_qty
     FROM products WHERE id = $1`,
    [productId]
  );
  const product = rows[0];
  if (!product || product.status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', 'This product is not available for a team purchase.', 'এই পণ্যটি টিম পারচেজের জন্য উপলব্ধ নয়।');
  }
  const settings = await getTeamBuyingSettings(db);
  const options = TEAM_SIZES.map((size) => {
    const price = computeGroupPrice({
      retailPrice: product.default_retail_price,
      baseCost: product.base_cost,
      wholesaleMargin: product.wholesale_margin,
      discountPct: discountForSize(settings, size),
    });
    return { members: size, group_price: price.group_price, discount_pct: price.discount_pct };
  });

  let walletBalance = null;
  if (userId) {
    const wallet = await walletRepo.getWalletByUserId(db, userId);
    walletBalance = wallet ? wallet.available_balance : '0.00';
  }

  return {
    product_id: product.id,
    retail_price: product.default_retail_price,
    in_stock: Number(product.stock_qty) > 0,
    options,
    default_team_size: settings.default_team_size,
    window_hours: settings.window_hours,
    shipping_charge: fromPaisa(toPaisa(settings.shipping_charge)),
    payment_methods: [...PAYMENT_METHODS],
    wallet_balance: walletBalance,
  };
}

// ---- create / join ----------------------------------------------------------------------------------

/**
 * Starts a new team purchase. The starter is its first member.
 */
export async function createTeamPurchase(db, cache, {
  userId,
  productId,
  requiredMembers = null,
  recipientName,
  addressLine,
  paymentMethod = 'COD',
  cod = null,
}) {
  const enabled = await isEnabled(db, cache, 'group_buying');
  if (!enabled) {
    throw new AppError('MODULE_DISABLED', 'Group buying module is currently disabled.');
  }

  const recipient = validateRecipient({ recipientName, addressLine });
  assertPaymentMethod(paymentMethod);

  const settings = await getTeamBuyingSettings(db);
  const teamSize = requiredMembers == null ? settings.default_team_size : Number(requiredMembers);
  if (!TEAM_SIZES.includes(teamSize)) {
    throw new AppError('VALIDATION_FAILED', 'A team has 2 or 3 members.', 'টিমে ২ বা ৩ জন সদস্য থাকে।');
  }

  const expiresAt = new Date(Date.now() + settings.window_hours * 3600000);
  const ref = generateTeamRef();

  return runWithClient(db, async (client) => {
    const { rows: prodRows } = await client.query(
      `SELECT id, default_retail_price, base_cost, wholesale_margin, status, stock_qty
       FROM products
       WHERE id = $1
       FOR UPDATE`,
      [productId]
    );

    const product = prodRows[0];
    if (!product || product.status !== 'ACTIVE') {
      throw new AppError('NOT_FOUND', 'Target product for team purchase does not exist.', 'এই পণ্যটি টিম পারচেজের জন্য উপলব্ধ নয়।');
    }
    if (Number(product.stock_qty) < teamSize) {
      throw new AppError('INSUFFICIENT_STOCK', 'Not enough stock for a team of this size.', 'এই আকারের টিমের জন্য যথেষ্ট স্টক নেই।');
    }

    // WHY computed here and never read from the request: the client used to send group_price, so
    // any shopper could start a team at ৳1.
    const price = computeGroupPrice({
      retailPrice: product.default_retail_price,
      baseCost: product.base_cost,
      wholesaleMargin: product.wholesale_margin,
      discountPct: discountForSize(settings, teamSize),
    });

    const { rows: teamRows } = await client.query(
      `INSERT INTO team_purchases (
        ref, product_id, initiator_user_id, required_members, current_members_count,
        group_price, original_price, shipping_charge, status, starts_at, expires_at
      )
      VALUES ($1, $2, $3, $4, 1, $5, $6, $7, 'ACTIVE', now(), $8)
      RETURNING *`,
      [
        ref,
        product.id,
        userId,
        teamSize,
        price.group_price,
        Number(product.default_retail_price).toFixed(2),
        fromPaisa(toPaisa(settings.shipping_charge)),
        expiresAt,
      ]
    );
    const team = teamRows[0];

    const gate = await gateCodMember(db, cache, client, { team, userId, paymentMethod, cod });
    const member = await addMember(client, { team, userId, recipient, paymentMethod, gate });

    return {
      team,
      initiator_member: member,
    };
  });
}

async function addMember(client, { team, userId, recipient, paymentMethod, gate = null }) {
  const { rows } = await client.query(
    `INSERT INTO team_purchase_members (
      team_purchase_id, user_id, shipping_address_json, payment_method, payment_hold_status,
      is_otp_verified, trust_score_at_join
    )
    VALUES ($1, $2, $3, $4, 'HELD', $5, $6)
    RETURNING *`,
    [team.id, userId, JSON.stringify(recipient), paymentMethod, Boolean(gate?.isOtpVerified), gate?.trustScore == null ? null : Math.round(gate.trustScore)]
  );
  const member = rows[0];

  if (paymentMethod === 'WALLET') {
    const holdId = await holdWalletFunds(client, {
      teamId: team.id,
      userId,
      amountPaisa: memberTotalPaisa(team),
    });
    await client.query(
      `UPDATE team_purchase_members SET hold_txn_group_id = $1 WHERE id = $2`,
      [holdId, member.id]
    );
    member.hold_txn_group_id = holdId;
  }
  return member;
}

/**
 * Joins an active team purchase, and converts every member to a real order if this join fills it.
 */
export async function joinTeamPurchase(db, cache, {
  userId,
  teamId,
  recipientName,
  addressLine,
  paymentMethod = 'COD',
  cod = null,
}) {
  const enabled = await isEnabled(db, cache, 'group_buying');
  if (!enabled) {
    throw new AppError('MODULE_DISABLED', 'Group buying module is currently disabled.');
  }

  const recipient = validateRecipient({ recipientName, addressLine });
  assertPaymentMethod(paymentMethod);

  return runWithClient(db, async (client) => {
    const { rows: teamRows } = await client.query(
      `SELECT * FROM team_purchases WHERE id = $1 FOR UPDATE`,
      [teamId]
    );

    const team = teamRows[0];
    if (!team) {
      throw new AppError('NOT_FOUND', 'Team purchase not found.', 'টিম পারচেজটি পাওয়া যায়নি।');
    }

    if (team.status !== 'ACTIVE') {
      throw new AppError('TEAM_PURCHASE_CLOSED', `Team purchase is already ${team.status.toLowerCase()}.`, 'এই টিম পারচেজটি আর চালু নেই।');
    }

    if (new Date() >= new Date(team.expires_at)) {
      throw new AppError('TEAM_PURCHASE_CLOSED', 'This team purchase window has expired.', 'এই টিম পারচেজের সময় শেষ হয়ে গেছে।');
    }

    if (team.current_members_count >= team.required_members) {
      throw new AppError('TEAM_PURCHASE_CLOSED', 'This team has already reached maximum members.', 'এই টিম ইতিমধ্যে পূর্ণ।');
    }

    const { rows: existingMember } = await client.query(
      `SELECT id FROM team_purchase_members WHERE team_purchase_id = $1 AND user_id = $2`,
      [teamId, userId]
    );
    if (existingMember.length > 0) {
      throw new AppError('CONFLICT', 'You are already a member of this team purchase.', 'আপনি ইতিমধ্যে এই টিমের সদস্য।');
    }

    const gate = await gateCodMember(db, cache, client, { team, userId, paymentMethod, cod });
    const newMember = await addMember(client, { team, userId, recipient, paymentMethod, gate });
    const newCount = team.current_members_count + 1;

    if (newCount < team.required_members) {
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

    const orders = await completeTeam(client, cache, team);
    await client.query(
      `UPDATE team_purchases
       SET current_members_count = $1, status = 'COMPLETED', completed_at = now(), updated_at = now()
       WHERE id = $2`,
      [newCount, teamId]
    );

    return {
      team: { ...team, current_members_count: newCount, status: 'COMPLETED' },
      member: newMember,
      completed: true,
      orders_created: orders,
    };
  });
}

/**
 * Turns every member of a full team into an order of one unit at the group price plus shipping.
 * Runs inside the join's transaction: if any step fails (stock ran out, the product was paused),
 * the join is refused and nothing — no member, no hold, no order — is kept.
 */
async function completeTeam(client, cache, team) {
  const { rows: prodRows } = await client.query(
    `SELECT id, ref, title_en, status, stock_qty, base_cost, wholesale_margin, supplier_id
     FROM products WHERE id = $1 FOR UPDATE`,
    [team.product_id]
  );
  const product = prodRows[0];
  if (!product || product.status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', 'This product is no longer available.', 'এই পণ্যটি এখন আর উপলব্ধ নেই।');
  }
  if (Number(product.stock_qty) < team.required_members) {
    throw new AppError(
      'INSUFFICIENT_STOCK',
      'The product ran out of stock before the team filled.',
      'টিম পূর্ণ হওয়ার আগেই পণ্যটির স্টক শেষ হয়ে গেছে।'
    );
  }

  const { rows: members } = await client.query(
    `SELECT tpm.id, tpm.user_id, tpm.shipping_address_json, tpm.payment_method, u.phone,
            tpm.is_otp_verified, tpm.trust_score_at_join,
            up.full_name AS profile_name
     FROM team_purchase_members tpm
     JOIN users u ON u.id = tpm.user_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE tpm.team_purchase_id = $1
     ORDER BY tpm.id ASC`,
    [team.id]
  );

  // WHY no saler share: a team purchase is bought from the product page, not through a saler's
  // storefront, so there is no saler to pay. With a 40/60 split and no saler wallet the escrow
  // deposit would lock less than the buyer paid; 0/100 makes the escrow equal the order total.
  const pricing = calculatePricingBreakdown({
    baseCost: product.base_cost,
    wholesaleMargin: product.wholesale_margin,
    retailPrice: team.group_price,
    salerSplitPct: 0,
    platformSplitPct: 100,
    ruleSource: 'TEAM_PURCHASE',
  });

  const shippingPaisa = toPaisa(team.shipping_charge || 0);
  const itemPaisa = toPaisa(team.group_price);
  const totalPaisa = itemPaisa + shippingPaisa;
  const created = [];

  for (const m of members) {
    const address = typeof m.shipping_address_json === 'string'
      ? JSON.parse(m.shipping_address_json)
      : (m.shipping_address_json || {});
    // WHY the fallbacks: members who joined before 068 stored { street, name, district, division }.
    const addressLine = address.address_line || address.street || '';
    const place = findDistrict(addressLine)
      || (address.district ? { division: address.division || '', district: address.district } : null);
    const isWallet = m.payment_method === 'WALLET';

    if (isWallet) {
      // The hold goes back to AVAILABLE and the escrow deposit below spends it, both in this transaction.
      await releaseWalletFunds(client, { teamId: team.id, userId: m.user_id, amountPaisa: totalPaisa, reason: 'complete' });
    }

    const order = await orderRepo.createOrder(client, {
      ref: generateRef('ORD'),
      customerId: m.user_id,
      totalAmount: fromPaisa(totalPaisa),
      itemsAmount: fromPaisa(itemPaisa),
      shippingAmount: fromPaisa(shippingPaisa),
      paymentMethod: m.payment_method,
      paymentStatus: isWallet ? 'PAID' : 'PENDING',
      teamPurchaseId: team.id,
      isOtpVerified: Boolean(m.is_otp_verified),
      trustScoreAtOrder: m.trust_score_at_join ?? null,
      idempotencyKey: `team:${team.id}:user:${m.user_id}`,
      recipientName: address.recipient_name || address.name || m.profile_name || '',
      recipientPhone: m.phone,
      // WHY empty when not found: the form asks for one free-text address, and the full address is
      // in address_line either way. Courier routing falls back to its default for an empty district.
      division: place?.division ?? '',
      district: place?.district ?? '',
      addressLine,
    });

    const batch = await orderRepo.allocateFefoBatch(client, { productId: product.id, qty: 1 });
    await orderRepo.deductStock(client, { productId: product.id, qty: 1 });

    const subOrder = await orderRepo.createSubOrder(client, {
      ref: `${order.ref}-1`,
      orderId: order.id,
      supplierId: product.supplier_id,
      salerId: null,
      subtotalBase: pricing.base_cost,
      wholesaleMargin: pricing.wholesale_margin,
      netRetailMargin: pricing.net_retail_margin,
      salerCommission: pricing.saler_earning,
      platformMargin: pricing.platform_earning,
      shippingAmount: fromPaisa(shippingPaisa),
      totalAmount: fromPaisa(totalPaisa),
      status: isWallet ? 'CONFIRMED' : 'PLACED',
    });

    await orderRepo.createOrderItem(client, {
      subOrderId: subOrder.id,
      productId: product.id,
      batchId: batch?.id || null,
      titleSnapshot: product.title_en,
      qty: 1,
      basePrice: pricing.base_cost,
      retailPrice: pricing.retail_price,
      lineTotal: fromPaisa(itemPaisa),
    });

    if (isWallet) {
      await vaultService.depositToEscrow(client, { subOrderId: subOrder.id, client });
    }

    await client.query(
      `UPDATE team_purchase_members
       SET payment_hold_status = 'CAPTURED', order_id = $1
       WHERE id = $2`,
      [order.id, m.id]
    );

    created.push({ id: order.id, ref: order.ref, user_id: m.user_id, total_amount: fromPaisa(totalPaisa) });
  }

  return created;
}

/**
 * Expires incomplete teams. WALLET members get their held money back in AVAILABLE; nothing was
 * charged to a COD member. Stock was never taken (it is deducted only when a team completes).
 */
export async function expireIncompleteTeams(db, cache) {
  const { rows: expiredTeams } = await db.query(
    `SELECT id FROM team_purchases
     WHERE status = 'ACTIVE' AND expires_at <= now()`
  );

  if (expiredTeams.length === 0) {
    return { expiredCount: 0, refundedCount: 0 };
  }

  let expiredCount = 0;
  let totalRefunded = 0;

  for (const { id } of expiredTeams) {
    await runWithClient(db, async (client) => {
      // Re-read under lock: a last-second join may have completed this team since the scan.
      const { rows } = await client.query(
        `SELECT * FROM team_purchases WHERE id = $1 FOR UPDATE`,
        [id]
      );
      const team = rows[0];
      if (!team || team.status !== 'ACTIVE') return;

      await client.query(
        `UPDATE team_purchases
         SET status = 'EXPIRED', updated_at = now()
         WHERE id = $1`,
        [team.id]
      );

      const { rows: held } = await client.query(
        `SELECT id, user_id, payment_method, hold_txn_group_id
         FROM team_purchase_members
         WHERE team_purchase_id = $1 AND payment_hold_status = 'HELD'
         ORDER BY id ASC`,
        [team.id]
      );

      for (const m of held) {
        if (m.payment_method === 'WALLET' && m.hold_txn_group_id) {
          await releaseWalletFunds(client, {
            teamId: team.id,
            userId: m.user_id,
            amountPaisa: memberTotalPaisa(team),
            reason: 'expire',
          });
        }
      }

      const { rowCount } = await client.query(
        `UPDATE team_purchase_members
         SET payment_hold_status = 'REFUNDED'
         WHERE team_purchase_id = $1 AND payment_hold_status = 'HELD'`,
        [team.id]
      );

      expiredCount += 1;
      totalRefunded += rowCount;
    });
  }

  return {
    expiredCount,
    refundedCount: totalRefunded,
  };
}

// ---- reads ------------------------------------------------------------------------------------------

const PRODUCT_IMAGE_SQL = `(SELECT m.storage_key FROM product_images pi2
              JOIN media_assets m ON m.id = pi2.media_id
              WHERE pi2.product_id = p.id
              ORDER BY pi2.is_primary DESC, pi2.display_order ASC LIMIT 1)`;

/**
 * Returns full details for a team purchase with live countdown and member list.
 * WHY members carry no address: this endpoint is public (anyone with the team link), and each
 * member's row holds their name and delivery address.
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
    `SELECT tpm.id, tpm.user_id, tpm.payment_hold_status, tpm.joined_at,
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
 * Open teams anyone may join, optionally for one product. Public, so no member details.
 */
export async function listOpenTeams(db, { productId = null, limit = 20 } = {}) {
  const { rows } = await db.query(
    `SELECT tp.id, tp.ref, tp.product_id, tp.required_members, tp.current_members_count,
            tp.group_price, tp.original_price, tp.shipping_charge, tp.status, tp.expires_at,
            p.title_en AS product_name_en, p.title_bn AS product_name_bn,
            ${PRODUCT_IMAGE_SQL} AS product_image_url,
            COALESCE(up.display_name, up.full_name) AS host_name,
            GREATEST(0, EXTRACT(EPOCH FROM (tp.expires_at - now())))::int AS remaining_seconds
     FROM team_purchases tp
     JOIN products p ON p.id = tp.product_id
     LEFT JOIN user_profiles up ON up.user_id = tp.initiator_user_id
     WHERE tp.status = 'ACTIVE' AND tp.expires_at > now()
       AND tp.current_members_count < tp.required_members
       AND ($1::bigint IS NULL OR tp.product_id = $1)
     ORDER BY tp.expires_at ASC
     LIMIT $2`,
    [productId, limit]
  );
  return rows.map((r) => ({ ...r, members: [{ user_name: r.host_name }] }));
}

/**
 * Returns all team purchases a user participates in.
 */
export async function getUserTeamPurchases(db, userId) {
  const query = `
    SELECT tp.*,
           tpm.payment_hold_status,
           tpm.payment_method AS my_payment_method,
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

// ---- admin ------------------------------------------------------------------------------------------

/** Everything /admin/growth/group-buy shows: settings, real counts, and the latest teams. */
export async function getAdminOverview(db, { limit = 50, offset = 0 } = {}) {
  const settings = await getTeamBuyingSettings(db);

  const { rows: statRows } = await db.query(
    `SELECT COUNT(*)::int AS total_teams,
            COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_pools,
            COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_teams,
            COUNT(*) FILTER (WHERE status = 'EXPIRED')::int AS expired_teams,
            COALESCE((SELECT SUM(o.total_amount) FROM orders o WHERE o.team_purchase_id IS NOT NULL), 0)::numeric(14,2) AS gross_team_gmv_bdt
     FROM team_purchases`
  );
  const s = statRows[0];
  const finished = s.completed_teams + s.expired_teams;

  const { rows: teams } = await db.query(
    `SELECT tp.id, tp.ref AS team_code, tp.required_members AS target_members,
            tp.current_members_count AS joined_members, tp.group_price,
            tp.original_price AS retail_price, tp.shipping_charge, tp.status, tp.expires_at,
            p.title_en AS product_title,
            COALESCE(up.display_name, up.full_name, u.ref) AS initiator_name
     FROM team_purchases tp
     JOIN products p ON p.id = tp.product_id
     JOIN users u ON u.id = tp.initiator_user_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     ORDER BY tp.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return {
    settings,
    limits: SETTING_LIMITS,
    stats: {
      ...s,
      conversion_rate_pct: finished > 0 ? Math.round((s.completed_teams * 1000) / finished) / 10 : null,
    },
    teams,
  };
}

/** Saves an admin's settings edit (validated strictly), with an audit row through the module service. */
export async function updateSettings(db, cache, actor, input) {
  const patch = validateSettingsPatch(input);
  await updateModuleSettings(db, cache, actor, 'group_buying', {
    settings: patch,
    reason: 'Team purchase settings edited at /admin/growth/group-buy',
  });
  return getTeamBuyingSettings(db);
}
