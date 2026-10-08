/**
 * sampleKit.service.js — Sample requests and marketing kits (supplier attraction, step 4).
 *
 * A saler who has never handled a supplier's product is asked to commit blind. A sample removes that
 * risk, and a marketing kit removes the blank page after it. The platform earns `platform_fee_pct` of
 * every sample price; the kit is free.
 *
 * Invariants:
 *   1. The saler's money is never spent before it is earned: the sample total moves from their
 *      AVAILABLE bucket to their own HELD bucket (one balanced ledger group), and stays there until
 *      the request ends. It then either RELEASES (HELD -> supplier + treasury) or REFUNDS
 *      (HELD -> AVAILABLE). A request ends exactly once: every transition locks the row first and is
 *      only legal from the states that allow it, so a double click or a racing job moves nothing twice.
 *   2. Price, shipping and the platform's share are snapshotted when the request is made. Editing the
 *      offer afterwards never changes what an open request pays.
 *   3. The platform's share is taken from the sample PRICE only; the shipping fee goes whole to the
 *      supplier, who is the one paying a courier.
 *   4. One live sample per saler per product (a database index, so it holds under a race), and at most
 *      `max_open_per_saler` in flight. A declined, cancelled or expired request frees the slot.
 *   5. A supplier who does not ship within `response_days` is expired and the saler is refunded; a saler
 *      who never confirms is auto-confirmed `auto_confirm_days` after shipping, so a supplier is
 *      never left unpaid by a saler who simply forgot.
 *   6. Every number comes from the `supplier.sample_kit` platform_settings row. The defaults below
 *      only apply while that row is absent or unreadable.
 *
 * All money arithmetic is integer paisa. The pure functions are tested without a database.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { writeAudit } from '../lib/audit.js';
import { getStorageDriver } from '../integrations/storage/index.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as ledgerService from './ledger.service.js';
import * as notificationService from './notification.service.js';
import * as repo from '../repositories/sampleKit.repository.js';
import * as scorecardRepo from '../repositories/supplierScorecard.repository.js';

const GRADES = ['A', 'B', 'C', 'D'];

export const DEFAULT_RULES = Object.freeze({
  platform_fee_pct: 10,
  min_price: 10,
  max_price: 5000,
  max_shipping_fee: 300,
  response_days: 3,
  auto_confirm_days: 10,
  max_open_per_saler: 3,
  blocked_grades: Object.freeze(['D']),
  max_hashtags: 15,
  max_selling_points: 8,
  caption_max_chars: 1000,
});

const toPaisa = (v) => Math.round(Number(v) * 100);
const fromPaisa = (p) => (p / 100).toFixed(2);

/**
 * Merges a stored rules object over the defaults, field by field. A malformed field falls back to
 * its default rather than failing: one bad edit must not stop every refund from being paid.
 */
export function resolveRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_RULES;
  const int = (v, lo, hi, fallback) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
  const dec = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback);

  const out = {
    // WHY capped at 50: above that the supplier would receive less of the price than the platform keeps.
    platform_fee_pct: dec(r.platform_fee_pct, 0, 50, d.platform_fee_pct),
    min_price: dec(r.min_price, 0.01, 1000000, d.min_price),
    max_price: dec(r.max_price, 0.01, 1000000, d.max_price),
    max_shipping_fee: dec(r.max_shipping_fee, 0, 100000, d.max_shipping_fee),
    response_days: int(r.response_days, 1, 60, d.response_days),
    auto_confirm_days: int(r.auto_confirm_days, 1, 90, d.auto_confirm_days),
    max_open_per_saler: int(r.max_open_per_saler, 1, 50, d.max_open_per_saler),
    blocked_grades: Array.isArray(r.blocked_grades)
      ? [...new Set(r.blocked_grades.filter((g) => GRADES.includes(g)))]
      : [...d.blocked_grades],
    max_hashtags: int(r.max_hashtags, 0, 50, d.max_hashtags),
    max_selling_points: int(r.max_selling_points, 0, 30, d.max_selling_points),
    caption_max_chars: int(r.caption_max_chars, 50, 5000, d.caption_max_chars),
  };
  // A stored min above the stored max would make every price illegal; fall back to the pair of defaults.
  if (out.min_price > out.max_price) {
    out.min_price = d.min_price;
    out.max_price = d.max_price;
  }
  return out;
}

export async function loadRules(db) {
  try {
    return resolveRules(await repo.getRulesRow(db));
  } catch {
    return resolveRules(null);
  }
}

function invalid(en, bn) {
  return new AppError('VALIDATION_FAILED', en, bn);
}

// ---- pure rules -------------------------------------------------------------------------------------------

/**
 * Splits what a saler pays. The platform's share comes from the price only; the supplier receives
 * the rest of the price plus the whole shipping fee. fee + supplier === total, always, to the paisa.
 */
export function splitSample({ price, shippingFee, platformFeePct }) {
  const pricePaisa = toPaisa(price);
  const shippingPaisa = toPaisa(shippingFee);
  const feePaisa = Math.round((pricePaisa * platformFeePct) / 100);
  const totalPaisa = pricePaisa + shippingPaisa;
  return {
    totalPaisa,
    feePaisa,
    supplierPaisa: totalPaisa - feePaisa,
    total: fromPaisa(totalPaisa),
    fee: fromPaisa(feePaisa),
    supplier: fromPaisa(totalPaisa - feePaisa),
  };
}

function money(value, label, { min, max, labelBn }) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n)) {
    throw invalid(`${label} must be a number.`, `${labelBn} একটি সংখ্যা হতে হবে।`);
  }
  if (Math.round(n * 100) / 100 !== n) {
    throw invalid(`${label} cannot have more than two decimal places.`, `${labelBn}-এ দুই দশমিকের বেশি ঘর হবে না।`);
  }
  if (n < min || n > max) {
    throw invalid(`${label} must be between ${min} and ${max}.`, `${labelBn} ${min} থেকে ${max}-এর মধ্যে হতে হবে।`);
  }
  return n;
}

/** Validates a sample offer. Strict: out-of-range input is refused, never clamped. */
export function validateOffer(input, rules) {
  const body = input && typeof input === 'object' ? input : {};
  return {
    price: money(body.price, 'Sample price', { min: rules.min_price, max: rules.max_price, labelBn: 'স্যাম্পলের দাম' }),
    shipping_fee: money(body.shipping_fee ?? 0, 'Shipping fee', { min: 0, max: rules.max_shipping_fee, labelBn: 'শিপিং ফি' }),
    is_active: body.is_active !== false,
  };
}

function text(value, label, { max, labelBn, required = false }) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (required) throw invalid(`${label} is required.`, `${labelBn} দিতে হবে।`);
    return null;
  }
  if (s.length > max) throw invalid(`${label} is too long (max ${max} characters).`, `${labelBn} অনেক বড় (সর্বোচ্চ ${max} অক্ষর)।`);
  return s;
}

function list(value, label, { maxItems, maxLen, labelBn, hashtag = false }) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`${label} must be a list.`, `${labelBn} একটি তালিকা হতে হবে।`);
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    let s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) continue;
    if (hashtag) {
      s = `#${s.replace(/^#+/, '').replace(/\s+/g, '')}`;
      if (s === '#') continue;
    }
    if (s.length > maxLen) throw invalid(`An item in ${label} is too long (max ${maxLen} characters).`, `${labelBn}-এর একটি আইটেম অনেক বড় (সর্বোচ্চ ${maxLen} অক্ষর)।`);
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  if (out.length > maxItems) throw invalid(`${label} can have at most ${maxItems} items.`, `${labelBn} সর্বোচ্চ ${maxItems}টি হতে পারে।`);
  return out;
}

/** Validates a marketing kit. A video link must be http(s); anything else is refused, never stored. */
export function validateKit(input, rules) {
  const body = input && typeof input === 'object' ? input : {};
  const caption_en = text(body.caption_en, 'English caption', { max: rules.caption_max_chars, labelBn: 'ইংরেজি ক্যাপশন' });
  const caption_bn = text(body.caption_bn, 'Bangla caption', { max: rules.caption_max_chars, labelBn: 'বাংলা ক্যাপশন' });
  const hashtags = list(body.hashtags, 'Hashtags', { maxItems: rules.max_hashtags, maxLen: 40, labelBn: 'হ্যাশট্যাগ', hashtag: true });
  const selling_points = list(body.selling_points, 'Selling points', { maxItems: rules.max_selling_points, maxLen: 140, labelBn: 'বিক্রির পয়েন্ট' });

  let video_url = null;
  const rawUrl = typeof body.video_url === 'string' ? body.video_url.trim() : '';
  if (rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || rawUrl.length > 500) {
      throw invalid('The video link must be a web address starting with http:// or https://.', 'ভিডিও লিংক অবশ্যই http:// বা https:// দিয়ে শুরু হওয়া ওয়েব ঠিকানা হতে হবে।');
    }
    video_url = parsed.toString();
  }

  if (!caption_en && !caption_bn && !hashtags.length && !selling_points.length && !video_url) {
    throw invalid('A kit needs at least a caption, hashtags, selling points or a video.', 'কিটে অন্তত একটি ক্যাপশন, হ্যাশট্যাগ, বিক্রির পয়েন্ট বা ভিডিও দিতে হবে।');
  }
  return { caption_en, caption_bn, hashtags, selling_points, video_url, is_published: body.is_published !== false };
}

/** The delivery details a supplier needs to post the sample. */
export function validateShipTo(input) {
  const body = input && typeof input === 'object' ? input : {};
  const name = text(body.name, 'Recipient name', { max: 100, labelBn: 'প্রাপকের নাম', required: true });
  const address = text(body.address, 'Delivery address', { max: 300, labelBn: 'ঠিকানা', required: true });
  const phone = text(body.phone, 'Phone number', { max: 20, labelBn: 'ফোন নম্বর', required: true });
  if (!/^\+?[0-9][0-9 \-]{5,18}[0-9]$/.test(phone)) {
    throw invalid('Enter a valid phone number.', 'সঠিক ফোন নম্বর দিন।');
  }
  return { name, phone, address };
}

/**
 * Which moves each party may make from each status. Anything not listed is illegal, which is what
 * keeps a request from ending twice.
 */
export const TRANSITIONS = Object.freeze({
  accept: { actor: 'supplier', from: ['REQUESTED'], to: 'ACCEPTED' },
  ship: { actor: 'supplier', from: ['REQUESTED', 'ACCEPTED'], to: 'SHIPPED' },
  decline: { actor: 'supplier', from: ['REQUESTED', 'ACCEPTED'], to: 'DECLINED' },
  cancel: { actor: 'saler', from: ['REQUESTED'], to: 'CANCELLED' },
  confirm: { actor: 'saler', from: ['SHIPPED'], to: 'DELIVERED' },
  expire: { actor: 'system', from: ['REQUESTED', 'ACCEPTED'], to: 'EXPIRED' },
  auto_confirm: { actor: 'system', from: ['SHIPPED'], to: 'DELIVERED' },
});

/** What happens to the held money when a move ends the request. */
const REFUNDS = new Set(['DECLINED', 'CANCELLED', 'EXPIRED']);
const RELEASES = new Set(['DELIVERED']);

// ---- shared helpers ---------------------------------------------------------------------------------------

async function supplierGrade(db, supplierId) {
  try {
    return (await scorecardRepo.findOne(db, supplierId))?.grade ?? null;
  } catch {
    // WHY swallow: before migration 062 there is no table; an ungraded supplier is never blocked.
    return null;
  }
}

function assertGradeAllowed(grade, rules) {
  if (grade != null && rules.blocked_grades.includes(grade)) {
    throw new AppError(
      'SUPPLIER_GRADE_BLOCKED',
      `Suppliers graded ${grade} on the Supplier Scorecard cannot offer samples. Improve your scorecard and try again.`,
      `সাপ্লায়ার স্কোরকার্ডে ${grade} গ্রেডের সাপ্লায়াররা স্যাম্পল অফার করতে পারেন না। স্কোরকার্ড উন্নত করে আবার চেষ্টা করুন।`
    );
  }
}

async function treasuryUserId(client) {
  const { rows } = await client.query(
    `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.key = 'super_admin'
      ORDER BY u.id ASC LIMIT 1`
  );
  return rows[0]?.id ?? 1;
}

function imageUrl(driver, key) {
  return key ? driver.getPublicUrl(key) : null;
}

/** Tells someone about a change. Best effort: a notification must never undo or block the money. */
async function tell(db, userId, templateKey, data) {
  try {
    await notificationService.notify(db, { userId, templateKey, data });
  } catch (err) {
    console.warn(`[sampleKit] notification ${templateKey} to user ${userId} failed: ${err.message}`);
  }
}

// ---- supplier side ----------------------------------------------------------------------------------------

/** Everything the supplier's Samples page needs: their products with offers, and incoming requests. */
export async function getSupplierView(db, supplierId) {
  const rules = await loadRules(db);
  const [products, requests, grade] = await Promise.all([
    repo.listSupplierProducts(db, supplierId),
    repo.listRequestsForSupplier(db, supplierId),
    supplierGrade(db, supplierId),
  ]);
  return {
    rules,
    grade,
    blocked: grade != null && rules.blocked_grades.includes(grade),
    products,
    requests,
  };
}

async function ownedProductOrThrow(db, supplierId, productId) {
  const product = await repo.getOwnedProduct(db, supplierId, productId);
  if (!product) throw new AppError('NOT_FOUND', 'Product not found.', 'পণ্যটি পাওয়া যায়নি।');
  return product;
}

/** Saves a supplier's sample offer for one of their products. Throws on a blocked grade or bad numbers. */
export async function saveOffer(db, { supplierId, productId, input, actor = null }) {
  const rules = await loadRules(db);
  await ownedProductOrThrow(db, supplierId, productId);
  const clean = validateOffer(input, rules);
  // WHY only when switching ON: a blocked supplier must still be able to withdraw what they offer.
  if (clean.is_active) assertGradeAllowed(await supplierGrade(db, supplierId), rules);

  const before = await repo.getOffer(db, productId);
  const saved = await repo.upsertOffer(db, {
    productId, supplierId, price: clean.price.toFixed(2), shippingFee: clean.shipping_fee.toFixed(2), isActive: clean.is_active,
  });
  await writeAudit(db, {
    action: 'supplier.sample_offer.save',
    targetType: 'sample_offer',
    targetRef: String(saved.id),
    before: before ? { price: before.price, shipping_fee: before.shipping_fee, is_active: before.is_active } : null,
    after: { price: saved.price, shipping_fee: saved.shipping_fee, is_active: saved.is_active },
    actorId: actor ?? supplierId,
  });
  return saved;
}

/** Saves a supplier's marketing kit for one of their products. */
export async function saveKit(db, { supplierId, productId, input, actor = null }) {
  const rules = await loadRules(db);
  await ownedProductOrThrow(db, supplierId, productId);
  const clean = validateKit(input, rules);

  const before = await repo.getKit(db, productId);
  const saved = await repo.upsertKit(db, { productId, supplierId, kit: clean });
  await writeAudit(db, {
    action: 'supplier.marketing_kit.save',
    targetType: 'marketing_kit',
    targetRef: String(saved.id),
    before: before ? { caption_en: before.caption_en, caption_bn: before.caption_bn, hashtags: before.hashtags, selling_points: before.selling_points, video_url: before.video_url, is_published: before.is_published } : null,
    after: { caption_en: saved.caption_en, caption_bn: saved.caption_bn, hashtags: saved.hashtags, selling_points: saved.selling_points, video_url: saved.video_url, is_published: saved.is_published },
    actorId: actor ?? supplierId,
  });
  return saved;
}

// ---- saler side -------------------------------------------------------------------------------------------

/** The offers a saler can take up, their own requests, and how many more they may have in flight. */
export async function getSalerView(db, salerId) {
  const rules = await loadRules(db);
  const driver = getStorageDriver();
  const [offers, requests, open] = await Promise.all([
    repo.listOffersForSaler(db, salerId),
    repo.listRequestsForSaler(db, salerId),
    repo.countOpenForSaler(db, salerId),
  ]);
  return {
    rules,
    open_count: open,
    slots_left: Math.max(0, rules.max_open_per_saler - open),
    offers: offers.map(({ image_key, ...o }) => {
      const split = splitSample({ price: o.price, shippingFee: o.shipping_fee, platformFeePct: rules.platform_fee_pct });
      return { ...o, total: split.total, image_url: imageUrl(driver, image_key) };
    }),
    requests,
  };
}

/** Published marketing kits, with each product's gallery as the image pack. */
export async function getKitsView(db) {
  const driver = getStorageDriver();
  const rows = await repo.listKitsForSaler(db);
  return {
    kits: rows.map(({ image_keys, ...k }) => ({ ...k, images: (image_keys || []).map((key) => imageUrl(driver, key)) })),
  };
}

/**
 * Asks for a sample and holds its cost. The whole thing is one transaction: the request row, the
 * hold, and the one-per-product check either all happen or none do.
 */
export async function requestSample(db, { salerId, productId, shipTo, note = null }) {
  const rules = await loadRules(db);
  const to = validateShipTo(shipTo);
  const cleanNote = text(note, 'Note', { max: 300, labelBn: 'নোট' });

  const offer = await repo.getOffer(db, productId);
  const product = offer ? await db.query(`SELECT id, supplier_id, status, title_en, title_bn FROM products WHERE id = $1 AND deleted_at IS NULL`, [productId]).then((r) => r.rows[0]) : null;
  if (!offer || !offer.is_active || !product || product.status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', 'This product is not offering samples right now.', 'এই পণ্যের স্যাম্পল এখন পাওয়া যাচ্ছে না।');
  }
  if (String(offer.supplier_id) === String(salerId)) {
    throw new AppError('FORBIDDEN', 'You cannot request a sample of your own product.', 'নিজের পণ্যের স্যাম্পল চাওয়া যায় না।');
  }
  // WHY re-check the grade here as well as when the offer is saved: a supplier can drop to D after
  // switching samples on, and a saler must not be sent to a supplier the platform now rates poorly.
  assertGradeAllowed(await supplierGrade(db, offer.supplier_id), rules);

  const split = splitSample({ price: offer.price, shippingFee: offer.shipping_fee, platformFeePct: rules.platform_fee_pct });

  const created = await withTransaction(db, async (client) => {
    const salerWallet = await walletRepo.getOrCreateWallet(client, salerId, { client });
    const [locked] = await walletRepo.getWalletsByIdsForUpdate(client, [salerWallet.id]);

    // Counted under the wallet lock, so two simultaneous requests cannot both slip under the limit.
    if ((await repo.countOpenForSaler(client, salerId)) >= rules.max_open_per_saler) {
      throw new AppError('SAMPLE_LIMIT_REACHED', `You can have at most ${rules.max_open_per_saler} samples in progress at once.`, `একসাথে সর্বোচ্চ ${rules.max_open_per_saler}টি স্যাম্পল চলতে পারে।`);
    }
    if (toPaisa(locked.available_balance) < split.totalPaisa) {
      throw new AppError('INSUFFICIENT_BALANCE', `Your vault needs ৳${split.total} for this sample.`, `এই স্যাম্পলের জন্য আপনার ভল্টে ৳${split.total} থাকতে হবে।`);
    }

    let request;
    try {
      request = await repo.insertRequest(client, {
        productId, supplierId: offer.supplier_id, salerId, price: offer.price, shippingFee: offer.shipping_fee,
        platformFee: split.fee, shipTo: to, note: cleanNote,
      });
    } catch (err) {
      if (err.code === '23505') {
        throw new AppError('SAMPLE_ALREADY_REQUESTED', 'You already have a sample of this product.', 'এই পণ্যের স্যাম্পল আপনার আগেই আছে।');
      }
      throw err;
    }

    const txnGroupId = randomUUID();
    await ledgerService.recordTransactionGroup(client, {
      txnGroupId,
      entries: [
        { walletId: salerWallet.id, entryType: 'DEBIT', amount: split.total, balanceBucket: 'AVAILABLE', idempotencyKey: `sample:${request.id}:hold:out` },
        { walletId: salerWallet.id, entryType: 'CREDIT', amount: split.total, balanceBucket: 'HELD', idempotencyKey: `sample:${request.id}:hold:in` },
      ],
      defaultCategory: 'SAMPLE_HOLD',
      defaultReferenceType: 'sample_requests',
      defaultReferenceId: request.id,
      memo: `Sample held for product #${productId}`,
      createdBy: salerId,
    });
    await repo.setHold(client, request.id, txnGroupId);
    return request;
  });

  await tell(db, created.supplier_id, 'SAMPLE_REQUESTED', { productTitleEn: product.title_en, productTitleBn: product.title_bn, days: rules.response_days });
  return created;
}

// ---- the one place a request changes state ----------------------------------------------------------------

/**
 * Moves a request along `action` inside one transaction, and settles the held money if that ends it.
 * `who` is the acting user id (null for the system); `actor` says which party they are acting as.
 * Returns the updated row. Throws SAMPLE_STATE_INVALID when the move is not legal from where it is.
 */
export async function transition(db, { requestId, action, actor, who = null, trackingNote = null, reason = null }) {
  const rule = TRANSITIONS[action];
  if (!rule) throw new Error(`Unknown sample action: ${action}`);

  const result = await withTransaction(db, async (client) => {
    const row = await repo.lockRequest(client, requestId);
    if (!row) throw new AppError('NOT_FOUND', 'Sample request not found.', 'স্যাম্পল অনুরোধটি পাওয়া যায়নি।');

    if (rule.actor !== actor) throw new Error(`Action ${action} cannot be taken as ${actor}`);

    // Ownership: a supplier acts only on their own requests, a saler only on theirs.
    if (rule.actor === 'supplier' && String(row.supplier_id) !== String(who)) {
      throw new AppError('FORBIDDEN', 'This is not your sample request.', 'এটি আপনার স্যাম্পল অনুরোধ নয়।');
    }
    if (rule.actor === 'saler' && String(row.saler_id) !== String(who)) {
      throw new AppError('FORBIDDEN', 'This is not your sample request.', 'এটি আপনার স্যাম্পল অনুরোধ নয়।');
    }
    if (!rule.from.includes(row.status)) {
      throw new AppError('SAMPLE_STATE_INVALID', `This sample is already ${row.status.toLowerCase()}.`, 'এই স্যাম্পলের অবস্থা এখন আর এটি করার অনুমতি দেয় না।');
    }

    let closeTxnGroupId = null;
    if (REFUNDS.has(rule.to) || RELEASES.has(rule.to)) {
      closeTxnGroupId = await settleHeld(client, row, rule.to);
    }
    const updated = await repo.setStatus(client, row.id, rule.to, {
      trackingNote: trackingNote || null,
      declineReason: reason || null,
      closeTxnGroupId,
    });
    return { updated, previous: row };
  });

  await announce(db, result.updated, action);
  return result.updated;
}

/** Moves the held money out: back to the saler on a refund, to the supplier and treasury on a release. */
async function settleHeld(client, row, outcome) {
  const totalPaisa = toPaisa(row.price) + toPaisa(row.shipping_fee);
  const feePaisa = toPaisa(row.platform_fee);
  const salerWallet = await walletRepo.getOrCreateWallet(client, row.saler_id, { client });
  const txnGroupId = randomUUID();
  const key = `sample:${row.id}:${outcome === 'DELIVERED' ? 'release' : 'refund'}`;

  if (outcome === 'DELIVERED') {
    const supplierWallet = await walletRepo.getOrCreateWallet(client, row.supplier_id, { client });
    const treasuryWallet = await walletRepo.getOrCreateWallet(client, await treasuryUserId(client), { client });
    const entries = [
      { walletId: salerWallet.id, entryType: 'DEBIT', amount: fromPaisa(totalPaisa), balanceBucket: 'HELD', idempotencyKey: `${key}:out` },
      { walletId: supplierWallet.id, entryType: 'CREDIT', amount: fromPaisa(totalPaisa - feePaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:supplier` },
    ];
    if (feePaisa > 0) {
      entries.push({ walletId: treasuryWallet.id, entryType: 'CREDIT', amount: fromPaisa(feePaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:fee` });
    }
    await ledgerService.recordTransactionGroup(client, {
      txnGroupId, entries, defaultCategory: 'SAMPLE_RELEASE', defaultReferenceType: 'sample_requests',
      defaultReferenceId: row.id, memo: `Sample #${row.id} delivered`,
    });
  } else {
    await ledgerService.recordTransactionGroup(client, {
      txnGroupId,
      entries: [
        { walletId: salerWallet.id, entryType: 'DEBIT', amount: fromPaisa(totalPaisa), balanceBucket: 'HELD', idempotencyKey: `${key}:out` },
        { walletId: salerWallet.id, entryType: 'CREDIT', amount: fromPaisa(totalPaisa), balanceBucket: 'AVAILABLE', idempotencyKey: `${key}:in` },
      ],
      defaultCategory: 'SAMPLE_REFUND', defaultReferenceType: 'sample_requests',
      defaultReferenceId: row.id, memo: `Sample #${row.id} ${outcome.toLowerCase()}`,
    });
  }
  return txnGroupId;
}

const ANNOUNCE = {
  accept: { to: 'saler', en: 'was accepted by the supplier', bn: 'সাপ্লায়ার গ্রহণ করেছেন' },
  ship: { to: 'saler', en: 'has been shipped', bn: 'পাঠানো হয়েছে' },
  decline: { to: 'saler', en: 'was declined and your money is back in your vault', bn: 'বাতিল হয়েছে এবং আপনার টাকা ভল্টে ফেরত এসেছে' },
  expire: { to: 'saler', en: 'expired because the supplier did not ship in time — your money is back in your vault', bn: 'সাপ্লায়ার সময়মতো না পাঠানোয় মেয়াদ শেষ হয়েছে — আপনার টাকা ভল্টে ফেরত এসেছে' },
  confirm: { to: 'supplier', en: 'was confirmed received and the payment is in your vault', bn: 'প্রাপ্তি নিশ্চিত হয়েছে এবং পেমেন্ট আপনার ভল্টে জমা হয়েছে' },
  auto_confirm: { to: 'supplier', en: 'was confirmed automatically and the payment is in your vault', bn: 'স্বয়ংক্রিয়ভাবে নিশ্চিত হয়েছে এবং পেমেন্ট আপনার ভল্টে জমা হয়েছে' },
};

async function announce(db, row, action) {
  const a = ANNOUNCE[action];
  if (!a) return;
  const { rows } = await db.query(`SELECT title_en, title_bn FROM products WHERE id = $1`, [row.product_id]);
  await tell(db, a.to === 'saler' ? row.saler_id : row.supplier_id, 'SAMPLE_UPDATED', {
    productTitleEn: rows[0]?.title_en ?? '', productTitleBn: rows[0]?.title_bn ?? '', statusEn: a.en, statusBn: a.bn,
  });
}

// ---- settlement (the hourly job) --------------------------------------------------------------------------

/**
 * Refunds samples the supplier never shipped, and releases samples the saler never confirmed. Each
 * request is its own transaction, so one failure never holds up the rest.
 */
export async function settleDue(db, logger = console) {
  const rules = await loadRules(db);
  const result = { expired: 0, auto_confirmed: 0, skipped: 0, errors: [] };

  const sweeps = [
    { ids: await repo.listUnshippedOlderThan(db, rules.response_days), action: 'expire', counter: 'expired' },
    { ids: await repo.listShippedOlderThan(db, rules.auto_confirm_days), action: 'auto_confirm', counter: 'auto_confirmed' },
  ];
  for (const { ids, action, counter } of sweeps) {
    for (const id of ids) {
      try {
        await transition(db, { requestId: id, action, actor: 'system' });
        result[counter] += 1;
      } catch (err) {
        // A request the saler or supplier just moved is no longer eligible: that is not a failure.
        if (err.code === 'SAMPLE_STATE_INVALID') result.skipped += 1;
        else {
          result.errors.push({ id, message: err.message });
          logger.error?.(`[sampleKit] ${action} failed for request ${id}: ${err.message}`);
        }
      }
    }
  }
  return result;
}
