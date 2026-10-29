/**
 * partnerOrder.service.ts — A partner places an order for a customer through the public API
 * (POST /api/v1/public/orders, docs/public-api.md).
 *
 * Decisions (2026-10-30):
 *  - The buyer is the customer, not the partner: customer.phone finds their account or creates a
 *    bare one (shadowCustomer.service.ts), so the order lands in the customer's own history and the
 *    COD risk gate judges the customer. The API key's owner is credited as the shop partner on each
 *    line they carry in their store, exactly as a storefront visit would credit them.
 *  - Cash on Delivery only. Nobody is at a browser to finish a bKash/Nagad redirect. A risky COD
 *    order answers 422 COD_OTP_REQUIRED and texts the customer a code; the partner repeats the call
 *    with the same Idempotency-Key and `otp_code`.
 *  - Idempotency-Key is required and scoped to the API key, so two partners can never collide on
 *    the same string. A repeat with the same body returns the first order; a different body is 409.
 *
 * Everything after the lines are built is the real checkout (checkout.service.ts): row locks, stock,
 * pricing split, sub-orders per supplier. Nothing about money is decided here.
 */

import { AppError } from '../plugins/errorHandler.ts';
import { normalisePhone } from './staff.service.ts';
import { findOrCreateCustomerByPhone } from './shadowCustomer.service.ts';
import { executeCheckout } from './checkout.service.ts';
import * as orderRepo from '../repositories/order.repository.ts';
import { SOURCE } from './attribution.service.ts';

export const PAYMENT_METHODS = Object.freeze(['COD']);

// WHY a bound at all: the key is stored in orders.idempotency_key and echoed in errors. 200 is far
// above a UUID (36) or any request id an integration would send.
export const IDEMPOTENCY_KEY_MAX = 200;

const invalid = (field: string, en: string, bn: string) => new AppError('VALIDATION_FAILED', en, bn, { field });

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

const positiveId = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * Checks and normalises the request body. Pure, so the whole contract is testable without a database.
 * Lines for the same product and variant are merged: checkout checks stock per line, so two lines of
 * 5 against a stock of 6 would otherwise both pass.
 */
export function parsePartnerOrder(body: any) {
  const { customer, items, shipping_address: address } = body || {};

  if (!Array.isArray(items) || items.length === 0) {
    throw invalid('items', 'At least 1 item is required to place an order.', 'অর্ডার দিতে অন্তত ১টি আইটেম লাগবে।');
  }
  if (!customer || !text(customer.name) || !text(customer.phone)) {
    throw invalid('customer', 'Customer name and phone number are required.', 'গ্রাহকের নাম ও ফোন নম্বর আবশ্যক।');
  }
  const phone = normalisePhone(customer.phone);
  if (!phone) {
    throw invalid('customer.phone', 'customer.phone must be a Bangladeshi mobile number.', 'customer.phone একটি বাংলাদেশি মোবাইল নম্বর হতে হবে।');
  }
  if (!address || !text(address.division) || !text(address.district) || !text(address.address_line)) {
    throw invalid(
      'shipping_address',
      'shipping_address needs division, district and address_line.',
      'shipping_address এ division, district এবং address_line আবশ্যক।'
    );
  }

  const paymentMethod = body.payment_method == null ? 'COD' : String(body.payment_method).toUpperCase();
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw invalid(
      'payment_method',
      'Only Cash on Delivery (COD) is available through the public API.',
      'পাবলিক API দিয়ে শুধু ক্যাশ অন ডেলিভারি (COD) দেওয়া যায়।'
    );
  }

  const merged = new Map();
  items.forEach((item, i) => {
    const productId = positiveId(item?.product_id);
    const variantId = item?.variant_id == null ? null : positiveId(item.variant_id);
    const qty = Number(item?.quantity);
    if (!productId || (item?.variant_id != null && !variantId) || !Number.isSafeInteger(qty) || qty < 1) {
      throw invalid(
        `items[${i}]`,
        `items[${i}] needs a product_id, an optional variant_id and a whole quantity of at least 1.`,
        `items[${i}] এ product_id, ঐচ্ছিক variant_id এবং কমপক্ষে ১ এর পূর্ণসংখ্যা quantity লাগবে।`
      );
    }
    const key = `${productId}:${variantId ?? ''}`;
    const line = merged.get(key) || { productId, variantId, qty: 0 };
    line.qty += qty;
    merged.set(key, line);
  });

  return {
    customer: { name: text(customer.name), phone },
    address: {
      division: text(address.division),
      district: text(address.district),
      upazila: text(address.upazila) || null,
      addressLine: text(address.address_line),
    },
    items: [...merged.values()],
    paymentMethod,
    otpCode: body.otp_code == null ? null : String(body.otp_code),
  };
}

/** Stored form of a partner's Idempotency-Key: one namespace per API key. */
export function scopedIdempotencyKey(apiKeyRef: string, raw: unknown) {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) {
    throw new AppError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'An Idempotency-Key header is required to place an order.',
      'অর্ডার দিতে একটি Idempotency-Key হেডার আবশ্যক।'
    );
  }
  if (key.length > IDEMPOTENCY_KEY_MAX) {
    throw invalid(
      'Idempotency-Key',
      `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX} characters.`,
      `Idempotency-Key সর্বোচ্চ ${IDEMPOTENCY_KEY_MAX} অক্ষরের হতে পারে।`
    );
  }
  return `api:${apiKeyRef}:${key}`;
}

/** True when a stored order is the one this request describes (same customer and the same lines). */
export function isSameRequest(order: any, request: ReturnType<typeof parsePartnerOrder>, customerId: number) {
  if (Number(order.customer_id) !== Number(customerId)) return false;
  const sig = (lines: { productId: any; variantId: any; qty: any }[]) => lines
    .map((l) => `${Number(l.productId)}:${l.variantId == null ? '' : Number(l.variantId)}:${Number(l.qty)}`)
    .sort()
    .join(',');
  const stored = (order.sub_orders || []).flatMap((so) => so.items || [])
    .map((it) => ({ productId: it.product_id, variantId: it.variant_id, qty: it.qty }));
  return sig(stored) === sig(request.items);
}

/**
 * Turns the request's items into checkout lines (the shape cartService.getCart gives checkout).
 * Prices come from the product, never the request. Status and stock are checked again by checkout
 * under its row locks; this only refuses what does not exist at all.
 */
export async function buildLines(db: any, { items, partnerId, buyerId }: { items: any[]; partnerId: number; buyerId: number }) {
  const productIds = [...new Set(items.map((l) => l.productId))];
  const { rows: products } = await db.query(
    `SELECT p.id, p.title_en, p.title_bn, p.default_retail_price, p.supplier_id,
            EXISTS (SELECT 1 FROM saler_store_items i
                    WHERE i.saler_id = $2 AND i.product_id = p.id AND i.is_active) AS partner_carries
     FROM products p
     WHERE p.id = ANY($1::bigint[]) AND p.status = 'ACTIVE' AND p.deleted_at IS NULL`,
    [productIds, partnerId]
  );
  const productById = new Map<number, any>(products.map((p) => [Number(p.id), p]));

  const variantIds = items.map((l) => l.variantId).filter((v) => v != null);
  const variantById = new Map<number, any>();
  if (variantIds.length) {
    const { rows } = await db.query(
      `SELECT id, product_id, price_delta FROM product_variants WHERE id = ANY($1::bigint[]) AND is_active`,
      [variantIds]
    );
    rows.forEach((v) => variantById.set(Number(v.id), v));
  }

  return items.map((line) => {
    const product = productById.get(line.productId);
    if (!product) {
      throw new AppError(
        'NOT_FOUND',
        `Product ${line.productId} is not available.`,
        `পণ্য ${line.productId} উপলব্ধ নেই।`,
        { product_id: line.productId }
      );
    }
    let unitPrice = Number(product.default_retail_price);
    if (line.variantId != null) {
      const variant = variantById.get(line.variantId);
      if (!variant || Number(variant.product_id) !== line.productId) {
        throw new AppError(
          'NOT_FOUND',
          `Variant ${line.variantId} of product ${line.productId} is not available.`,
          `পণ্য ${line.productId} এর ভ্যারিয়েন্ট ${line.variantId} উপলব্ধ নেই।`,
          { product_id: line.productId, variant_id: line.variantId }
        );
      }
      // price_delta is signed and relative to the product price, as in cart.service.ts.
      unitPrice += Number(variant.price_delta ?? 0);
    }
    // WHY the same rule as a storefront touch (attribution.service.ts): the partner earns only on a
    // product they carry in their store, and never on their own purchase.
    const credited = product.partner_carries && Number(partnerId) !== Number(buyerId);
    return {
      product_id: line.productId,
      variant_id: line.variantId,
      qty: line.qty,
      unit_price: unitPrice,
      supplier_id: product.supplier_id,
      saler_id: credited ? Number(partnerId) : null,
      short_link_id: null,
      attribution_source: credited ? SOURCE.STOREFRONT : null,
      bundle_id: null,
      product_title_en: product.title_en,
      product_title_bn: product.title_bn,
    };
  });
}

const money = (v: unknown) => (v == null ? null : Number(v));

/**
 * What the partner gets back. An explicit projection: order_items carries base_price, and sub_orders
 * carry the margin split, both supplier cost data that must not leave through the public API.
 */
export function toPublicOrder(order: any) {
  return {
    id: Number(order.id),
    ref: order.ref,
    items_amount: money(order.items_amount),
    shipping_amount: money(order.shipping_amount),
    discount_amount: money(order.discount_amount),
    total_amount: money(order.total_amount),
    currency: order.currency,
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    is_otp_verified: Boolean(order.is_otp_verified),
    recipient: {
      name: order.recipient_name,
      phone: order.recipient_phone,
      division: order.division,
      district: order.district,
      upazila: order.upazila,
      address_line: order.address_line,
    },
    placed_at: order.placed_at,
    sub_orders: (order.sub_orders || []).map((so) => ({
      ref: so.ref,
      status: so.status,
      supplier_name: so.supplier_name ?? null,
      shipping_amount: money(so.shipping_amount),
      total_amount: money(so.total_amount),
      items: (so.items || []).map((it) => ({
        product_id: Number(it.product_id),
        product_ref: it.product_ref ?? null,
        variant_id: it.variant_id == null ? null : Number(it.variant_id),
        variant_sku: it.variant_sku ?? null,
        title: it.title_snapshot,
        quantity: Number(it.qty),
        unit_price: money(it.retail_price),
        line_total: money(it.line_total),
      })),
    })),
  };
}

const isIdempotencyRace = (err: any) => err?.code === '23505' && String(err?.constraint || '').includes('idempotency');

/**
 * @returns {Promise<{ order: object, isReplay: boolean }>} order is already the public projection
 */
export async function placePartnerOrder(pool: any, cache: any, {
  apiKey,
  body,
  idempotencyKey,
  smsSender = null,
  isDevelopment = false,
  ip = null,
}: { apiKey: any; body: any; idempotencyKey: unknown; smsSender?: any; isDevelopment?: boolean; ip?: string | null }) {
  const request = parsePartnerOrder(body);
  const storedKey = scopedIdempotencyKey(apiKey.ref, idempotencyKey);

  const { id: customerId } = await findOrCreateCustomerByPhone(pool, request.customer);

  const replay = async () => {
    const existing = await orderRepo.findOrderByIdempotencyKey(pool, storedKey);
    if (!existing) return null;
    if (!isSameRequest(existing, request, customerId)) {
      throw new AppError(
        'IDEMPOTENCY_MISMATCH',
        'This Idempotency-Key was already used for a different order.',
        'এই Idempotency-Key আগে অন্য একটি অর্ডারে ব্যবহার হয়েছে।',
        { order_ref: existing.ref }
      );
    }
    return { order: toPublicOrder(existing), isReplay: true };
  };

  const earlier = await replay();
  if (earlier) return earlier;

  const lines = await buildLines(pool, { items: request.items, partnerId: Number(apiKey.userId), buyerId: customerId });

  try {
    const result = await executeCheckout(pool, cache, {
      userId: customerId,
      idempotencyKey: storedKey,
      recipientName: request.customer.name,
      recipientPhone: request.customer.phone,
      division: request.address.division,
      district: request.address.district,
      upazila: request.address.upazila,
      addressLine: request.address.addressLine,
      paymentMethod: request.paymentMethod,
      otpCode: request.otpCode,
      smsSender,
      isDevelopment,
      ip,
      lines,
    });
    return { order: toPublicOrder(result.order), isReplay: Boolean(result.isReplay) };
  } catch (err) {
    // Two identical requests at once: both miss the lookup, the database lets one order in and
    // refuses the other on the UNIQUE key. The loser answers with the winner's order.
    if (isIdempotencyRace(err)) {
      const raced = await replay();
      if (raced) return raced;
    }
    throw err;
  }
}
