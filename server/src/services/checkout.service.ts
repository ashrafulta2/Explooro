/**
 * checkout.service.ts — Transactional Checkout Engine (Prompt 5.2).
 *
 * Enforces:
 *  1. One atomic PostgreSQL transaction with automatic rollback on any failure.
 *  2. Idempotency guarantee via Idempotency-Key.
 *  3. Cart live revalidation (status, prices, stock).
 *  4. Coupon validation (code, expiry, min spend, budget cap, per-user limits).
 *  5. COD anti-fraud risk check with SMS OTP gate (COD_OTP_REQUIRED).
 *  6. Deterministic row locking (id ASC) to eliminate deadlocks.
 *  7. FEFO batch allocation.
 *  8. Multi-supplier order splitting with exact pricing formula via pricing.service.ts.
 *  9. Stock decrement and cart conversion.
 */

import { createHash } from 'node:crypto';
import { AppError } from '../plugins/errorHandler.ts';
import { generateRef } from '../lib/ref.ts';
import * as cartService from './cart.service.ts';
import * as cartRepo from '../repositories/cart.repository.ts';
import * as orderRepo from '../repositories/order.repository.ts';
import * as couponRepo from '../repositories/coupon.repository.ts';
import * as adsService from './ads.service.ts';
import * as trustScoreService from './trustScore.service.ts';
import * as codGateService from './codGate.service.ts';
import * as deliveryChargeService from './deliveryCharge.service.ts';
import { getReservedByProduct } from './teamStockReservation.service.ts';
import { calculatePricingBreakdown, resolveSplitPercentages, toPaisa, toBdtNumber } from './pricing.service.ts';
import { computeCheckoutCouponDiscount, allocateDiscountBySupplier } from './coupon.service.ts';
import { pickParcelSaler } from './attribution.service.ts';
import * as shortlinkService from './shortlink.service.ts';
import { payOrderFromVault, VAULT_METHOD } from './vaultCheckout.service.ts';

export function hashPayload(payload) {
  return createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
}

export async function executeCheckout(pool, cache, {
  userId,
  idempotencyKey,
  recipientName,
  recipientPhone,
  division,
  district,
  upazila = null,
  addressLine,
  paymentMethod = 'COD',
  couponCode = null,
  otpCode = null,
  guestToken = null,
  adCampaignId = null,
  smsSender = null,
  isDevelopment = false,
  ip = null,
  lines = null,
}) {
  // 1. Validate Idempotency-Key requirement
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new AppError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'An Idempotency-Key header is required for checkout.',
      'চেকআউটের জন্য একটি Idempotency-Key হেডার আবশ্যক।'
    );
  }

  const payloadFingerprint = hashPayload({
    userId,
    recipientName,
    recipientPhone,
    division,
    district,
    addressLine,
    paymentMethod,
    couponCode,
  });

  // Check if idempotency key already completed in DB
  const existingOrder = await orderRepo.findOrderByIdempotencyKey(pool, idempotencyKey);
  if (existingOrder) {
    return {
      order: existingOrder,
      isReplay: true,
      originalAt: existingOrder.created_at,
    };
  }

  // 2. Load Cart
  // WHY `lines`: an order placed through the public API (partnerOrder.service.ts) has no cart. Its
  // lines have the cart line shape and go through the same locks, pricing and escrow below; only the
  // cart conversion at the end is skipped (cart_id is null).
  let cart;
  if (lines) {
    cart = { cart_id: null, items: lines };
  } else {
    if (guestToken && userId) {
      try {
        await cartService.mergeGuestCartOnLogin(pool, { guestToken, userId });
      } catch {}
    }
    cart = await cartService.getCart(pool, { userId, guestToken });
    if ((!cart || !cart.items || cart.items.length === 0) && guestToken) {
      cart = await cartService.getCart(pool, { guestToken });
    }
  }
  if (!cart || !cart.items || cart.items.length === 0) {
    throw new AppError(
      'BAD_REQUEST',
      'Cannot checkout with an empty cart.',
      'খালি কার্ট দিয়ে চেকআউট করা যাবে না।'
    );
  }

  // Validate recipient information
  if (!recipientName || !recipientPhone || !division || !district || !addressLine) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Recipient name, phone, division, district, and address line are required.',
      'প্রাপকের নাম, ফোন, বিভাগ, জেলা এবং ঠিকানার বিবরণ আবশ্যক।'
    );
  }

  // Normalize phone number (E.164)
  let cleanPhone = recipientPhone.replace(/[\s-]/g, '');
  if (cleanPhone.startsWith('01')) cleanPhone = `+88${cleanPhone}`;
  if (!/^\+8801[3-9]\d{8}$/.test(cleanPhone)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Invalid Bangladeshi phone number for delivery.',
      'ডেলিভারির জন্য ভুল বাংলাদেশি ফোন নম্বর।'
    );
  }

  // 3. Acquire atomic database client for single PostgreSQL transaction
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 4. Deterministic Row Locking on Products & Variants (id ASC)
    const { productsById, variantsById } = await orderRepo.lockProductsAndVariants(client, cart.items);

    // WHY: units that open team purchases are counting on are not for sale here; the product rows are
    // locked above, so this read cannot race a team being created.
    const reservedByProduct = await getReservedByProduct(client, cart.items.map((i) => i.product_id));

    // Verify product status & stock sufficiency
    let itemsAmountPaisa = 0;
    for (const item of cart.items) {
      const prod = productsById.get(Number(item.product_id));
      if (!prod || prod.status !== 'ACTIVE') {
        throw new AppError(
          'NOT_FOUND',
          `Product "${item.product_title_en}" is no longer available.`,
          `পণ্য "${item.product_title_bn}" এখন আর উপলব্ধ নেই।`
        );
      }

      let availableStock = Number(prod.stock_qty);
      if (item.variant_id) {
        const variant = variantsById.get(Number(item.variant_id));
        if (!variant || !variant.is_active) {
          throw new AppError(
            'NOT_FOUND',
            `Selected variant for "${item.product_title_en}" is no longer available.`,
            `"${item.product_title_bn}" এর নির্বাচিত ভ্যারিয়েন্টটি আর উপলব্ধ নেই।`
          );
        }
        availableStock = Number(variant.stock_qty);
      }
      availableStock = Math.min(availableStock, Number(prod.stock_qty) - (reservedByProduct.get(Number(item.product_id)) || 0));

      if (availableStock < item.qty) {
        throw new AppError(
          'INSUFFICIENT_STOCK',
          `Only ${availableStock} left of "${item.product_title_en}".`,
          `"${item.product_title_bn}" এর মাত্র ${availableStock}টি বাকি আছে।`,
          {
            product_ref: prod.ref,
            requested: item.qty,
            available: availableStock,
          }
        );
      }

      const unitPricePaisa = toPaisa(item.unit_price);
      itemsAmountPaisa += (unitPricePaisa * item.qty);
    }

    // 5. Multi-Supplier Grouping & Shipping (before the coupon: a free-shipping coupon needs the charge)
    const supplierGroups = new Map();
    for (const item of cart.items) {
      const suppId = item.supplier_id;
      if (!supplierGroups.has(suppId)) {
        supplierGroups.set(suppId, []);
      }
      supplierGroups.get(suppId).push(item);
    }

    const supplierCount = supplierGroups.size;
    // WHY fresh: the charge written onto the order must be the one in the database now, not a
    // cached copy from before a super admin changed it.
    const shippingPerParcelPaisa = toPaisa(await deliveryChargeService.perParcelCharge(client, cache, { fresh: true }));

    // 6. Coupon Validation & Calculation
    let coupon = null;
    let discountAmountPaisa = 0;
    let discountShareBySupplier = new Map();

    if (couponCode) {
      coupon = await couponRepo.findCouponByCode(client, couponCode, { forUpdate: true });
      if (!coupon) {
        throw new AppError(
          'COUPON_INVALID',
          'Invalid or inactive coupon code.',
          'ভুল বা নিষ্ক্রিয় কুপন কোড।'
        );
      }

      const now = new Date();
      if (new Date(coupon.starts_at) > now || new Date(coupon.expires_at) < now) {
        throw new AppError(
          'COUPON_INVALID',
          'Coupon has expired.',
          'কুপনের মেয়াদ শেষ হয়ে গেছে।'
        );
      }

      if (coupon.usage_limit != null && Number(coupon.usage_count) >= Number(coupon.usage_limit)) {
        throw new AppError(
          'COUPON_INVALID',
          'Coupon usage limit reached.',
          'কুপন ব্যবহারের সীমা পূর্ণ হয়েছে।'
        );
      }

      // Check per-user redemption limit
      const userUsage = await couponRepo.getUserRedemptionCount(client, coupon.id, userId);
      if (userUsage >= Number(coupon.per_user_limit || 1)) {
        throw new AppError(
          'COUPON_INVALID',
          'You have reached the usage limit for this coupon.',
          'আপনি এই কুপন ব্যবহারের সর্বোচ্চ সীমায় পৌঁছে গেছেন।'
        );
      }

      if (coupon.first_order_only) {
        // WHY: orders has no status; an order counts unless every one of its sub-orders was cancelled.
        const { rows: priorOrders } = await client.query(
          `SELECT 1 FROM orders o
           WHERE o.customer_id = $1
             AND EXISTS (SELECT 1 FROM sub_orders so WHERE so.order_id = o.id AND so.status <> 'CANCELLED')
           LIMIT 1`,
          [userId]
        );
        if (priorOrders.length > 0) {
          throw new AppError(
            'COUPON_INVALID',
            'This coupon is only valid on your first order.',
            'এই কুপনটি শুধুমাত্র আপনার প্রথম অর্ডারে প্রযোজ্য।'
          );
        }
      }

      const computed = computeCheckoutCouponDiscount({
        coupon,
        lines: cart.items.map((item) => ({
          productId: item.product_id,
          categoryId: productsById.get(Number(item.product_id))?.category_id,
          supplierId: item.supplier_id,
          salerId: item.saler_id,
          unitPricePaisa: toPaisa(item.unit_price),
          qty: Number(item.qty),
        })),
        shippingPerParcelPaisa,
      });
      discountAmountPaisa = computed.discountPaisa;
      discountShareBySupplier = allocateDiscountBySupplier(discountAmountPaisa, computed.basisBySupplier);
    }

    const totalShippingPaisa = supplierCount * shippingPerParcelPaisa;

    const totalAmountPaisa = itemsAmountPaisa + totalShippingPaisa - discountAmountPaisa;
    const totalAmountBdt = toBdtNumber(totalAmountPaisa);

    // 7. COD Anti-Fraud & Trust Score Risk Gate (shared with team purchase — see codGate.service.ts
    //    for why the OTP itself is written on the pool, not on this transaction).
    let isOtpVerified = false;
    let trustScoreAtOrder = 50;

    if (paymentMethod === 'COD') {
      const gate = await codGateService.enforceCodGate(pool, cache, {
        client,
        userId,
        phone: cleanPhone,
        orderAmount: totalAmountBdt,
        otpCode,
        smsSender,
        isDevelopment,
        ip,
      });
      isOtpVerified = gate.isOtpVerified;
      trustScoreAtOrder = gate.trustScore;
    }

    // 8. Create Parent Order
    const orderRef = generateRef('ORD');
    const rootOrder = await orderRepo.createOrder(client, {
      ref: orderRef,
      customerId: userId,
      totalAmount: toBdtNumber(totalAmountPaisa),
      itemsAmount: toBdtNumber(itemsAmountPaisa),
      shippingAmount: toBdtNumber(totalShippingPaisa),
      discountAmount: toBdtNumber(discountAmountPaisa),
      currency: 'BDT',
      paymentMethod,
      paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'PENDING',
      isOtpVerified,
      trustScoreAtOrder,
      couponId: coupon?.id || null,
      idempotencyKey,
      recipientName,
      recipientPhone: cleanPhone,
      division,
      district,
      upazila,
      addressLine,
    });

    // 9. FEFO Batch Allocation, Stock Decrement & Sub-Orders Creation
    let supplierIndex = 1;
    // Revenue each short link brought in this order, recorded after commit (paisa by link id).
    const linkRevenuePaisa = new Map();

    // WHY re-checked here: a guest cart line keeps its shop partner when the guest logs in, and that
    // partner may be the shopper themself. Nobody earns commission on their own purchase.
    const lineSalerOf = (item) => (item.saler_id && Number(item.saler_id) !== Number(userId) ? Number(item.saler_id) : null);

    for (const [supplierId, items] of supplierGroups.entries()) {
      const subOrderRef = `${orderRef}-${supplierIndex}`;
      supplierIndex += 1;

      const parcel = pickParcelSaler(items.map((item) => ({
        salerId: lineSalerOf(item),
        shortLinkId: item.short_link_id ?? null,
        source: item.attribution_source ?? null,
        lineTotalPaisa: toPaisa(item.unit_price) * Number(item.qty),
      })));

      let subOrderBasePaisa = 0;
      let subOrderWholesaleMarginPaisa = 0;
      let subOrderNetRetailMarginPaisa = 0;
      let subOrderSalerCommissionPaisa = 0;
      let subOrderPlatformMarginPaisa = 0;
      let subOrderItemsAmountPaisa = 0;

      const processedItems = [];

      for (const item of items) {
        const prod = productsById.get(Number(item.product_id));
        const itemQty = Number(item.qty);

        // FEFO Batch allocation
        const allocatedBatch = await orderRepo.allocateFefoBatch(client, {
          productId: item.product_id,
          variantId: item.variant_id,
          qty: itemQty,
        });

        // Deduct inventory stock
        await orderRepo.deductStock(client, {
          productId: item.product_id,
          variantId: item.variant_id,
          qty: itemQty,
        });

        // Calculate Pricing Formula via pricing.service.ts
        // WHY resolved, not 40/60: the split is a business number (platform_settings / overrides), and
        // the Shop Partner Pro rebate can only reach the order if checkout asks for this shop partner's split.
        const lineSalerId = lineSalerOf(item);
        const split = await resolveSplitPercentages(client, {
          productId: prod.id,
          productRef: prod.ref,
          categoryId: prod.category_id,
          salerId: lineSalerId,
          cache,
        });
        const pricing = calculatePricingBreakdown({
          baseCost: prod.base_cost,
          wholesaleMargin: prod.wholesale_margin,
          retailPrice: item.unit_price,
          salerSplitPct: split.salerSplitPct,
          platformSplitPct: split.platformSplitPct,
          ruleSource: split.ruleSource,
          // WHY: the supplier's per-unit partner profit (migration 085) sets the partner share; that share
          // is escrowed to the partner reward pool, not to this line's partner (vault.service.ts).
          partnerProfit: prod.partner_profit,
        });

        const lineTotalPaisa = toPaisa(item.unit_price) * itemQty;
        subOrderItemsAmountPaisa += lineTotalPaisa;

        subOrderBasePaisa += (pricing.paisa.base_cost * itemQty);
        subOrderWholesaleMarginPaisa += (pricing.paisa.wholesale_margin * itemQty);
        subOrderNetRetailMarginPaisa += (pricing.paisa.net_retail_margin * itemQty);
        // Only lines credited to the parcel's shop partner pay into its commission; any other line's
        // partner share stays with the platform via the reconcile below (kept per line on order_items).
        if (lineSalerId != null && lineSalerId === parcel.salerId) {
          subOrderSalerCommissionPaisa += (pricing.paisa.saler_earning * itemQty);
        }
        subOrderPlatformMarginPaisa += (pricing.paisa.platform_earning * itemQty);

        if (lineSalerId != null && item.short_link_id) {
          const linkId = Number(item.short_link_id);
          linkRevenuePaisa.set(linkId, (linkRevenuePaisa.get(linkId) || 0) + lineTotalPaisa);
        }

        processedItems.push({
          salerId: lineSalerId,
          productId: item.product_id,
          variantId: item.variant_id,
          batchId: allocatedBatch?.id || null,
          bundleId: item.bundle_id,
          titleSnapshot: item.product_title_en,
          qty: itemQty,
          basePrice: pricing.base_cost,
          retailPrice: pricing.retail_price,
          lineTotal: toBdtNumber(lineTotalPaisa),
        });
      }

      // Reconcile rounding to satisfy DB constraint: saler_commission + platform_margin = net_retail_margin
      subOrderPlatformMarginPaisa = subOrderNetRetailMarginPaisa - subOrderSalerCommissionPaisa;

      // This sub-order's part of the discount: only parcels holding in-scope items carry any of it.
      const subOrderDiscountSharePaisa = discountShareBySupplier.get(String(supplierId)) || 0;

      const subOrderShippingPaisa = shippingPerParcelPaisa;
      const subOrderTotalPaisa = subOrderItemsAmountPaisa + subOrderShippingPaisa - subOrderDiscountSharePaisa;

      const subOrder = await orderRepo.createSubOrder(client, {
        ref: subOrderRef,
        orderId: rootOrder.id,
        supplierId,
        salerId: parcel.salerId,
        shortLinkId: parcel.shortLinkId,
        attributionSource: parcel.source,
        subtotalBase: toBdtNumber(subOrderBasePaisa),
        wholesaleMargin: toBdtNumber(subOrderWholesaleMarginPaisa),
        netRetailMargin: toBdtNumber(subOrderNetRetailMarginPaisa),
        salerCommission: toBdtNumber(subOrderSalerCommissionPaisa),
        platformMargin: toBdtNumber(subOrderPlatformMarginPaisa),
        shippingAmount: toBdtNumber(subOrderShippingPaisa),
        discountShare: toBdtNumber(subOrderDiscountSharePaisa),
        totalAmount: toBdtNumber(subOrderTotalPaisa),
        status: 'PLACED',
      });

      // Insert order items
      for (const pItem of processedItems) {
        await orderRepo.createOrderItem(client, {
          subOrderId: subOrder.id,
          salerId: pItem.salerId,
          productId: pItem.productId,
          variantId: pItem.variantId,
          batchId: pItem.batchId,
          bundleId: pItem.bundleId,
          titleSnapshot: pItem.titleSnapshot,
          qty: pItem.qty,
          basePrice: pItem.basePrice,
          retailPrice: pItem.retailPrice,
          lineTotal: pItem.lineTotal,
        });
      }
    }

    // 9b. A vault order is paid now, in this transaction: a short balance rolls back the whole order,
    //     and a paid order never exists without its escrow (vaultCheckout.service.ts).
    if (paymentMethod === VAULT_METHOD) {
      await payOrderFromVault(client, { orderId: rootOrder.id, orderRef, userId, totalPaisa: totalAmountPaisa });
    }

    // 10. Record Coupon Redemption
    if (coupon) {
      await couponRepo.incrementCouponUsage(client, coupon.id, toBdtNumber(discountAmountPaisa));
      await couponRepo.recordRedemption(client, {
        couponId: coupon.id,
        userId,
        orderId: rootOrder.id,
        discountAmount: toBdtNumber(discountAmountPaisa),
      });
    }

    // 11. Convert Cart & Clear Items
    if (cart.cart_id != null) {
      await client.query(
        `UPDATE carts SET status = 'CONVERTED', converted_order_id = $1, updated_at = now() WHERE id = $2`,
        [rootOrder.id, cart.cart_id]
      );
      await cartRepo.clearCartItems(client, cart.cart_id);
    }

    // 12. Commit Transaction
    await client.query('COMMIT');

    // 13. Fetch fully formatted order response
    const fullOrder = await orderRepo.findOrderById(pool, rootOrder.id);

    // Background trust score re-calculation
    trustScoreService.calculateAndPersistTrustScore(pool, userId).catch(() => {});

    // Count the sale on each shop partner link that brought one of its lines (Social Seller Kit
    // analytics). After commit and on the pool, like the CPA step below: a counter must never undo an order.
    for (const [shortLinkId, paisa] of linkRevenuePaisa) {
      shortlinkService.recordShortLinkConversion(pool, { shortLinkId, orderTotal: toBdtNumber(paisa) }).catch(() => {});
    }

    // 12. Process CPA Attribution if an ad was clicked
    if (adCampaignId) {
      try {
        await adsService.processCpaAttribution(
          client,
          adCampaignId,
          rootOrder.ref,
          toBdtNumber(totalAmountPaisa)
        );
      } catch (err) {
        // Silent catch: we don't want to fail checkout just because attribution or billing failed
      }
    }

    return {
      order: fullOrder,
      isReplay: false,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
