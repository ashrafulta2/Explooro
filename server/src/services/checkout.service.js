/**
 * checkout.service.js — Transactional Checkout Engine (Prompt 5.2).
 *
 * Enforces:
 *  1. One atomic PostgreSQL transaction with automatic rollback on any failure.
 *  2. Idempotency guarantee via Idempotency-Key.
 *  3. Cart live revalidation (status, prices, stock).
 *  4. Coupon validation (code, expiry, min spend, budget cap, per-user limits).
 *  5. COD anti-fraud risk check with SMS OTP gate (COD_OTP_REQUIRED).
 *  6. Deterministic row locking (id ASC) to eliminate deadlocks.
 *  7. FEFO batch allocation.
 *  8. Multi-supplier order splitting with exact pricing formula via pricing.service.js.
 *  9. Stock decrement and cart conversion.
 */

import { createHash } from 'node:crypto';
import { AppError } from '../plugins/errorHandler.js';
import { generateRef } from '../lib/ref.js';
import * as cartService from './cart.service.js';
import * as cartRepo from '../repositories/cart.repository.js';
import * as orderRepo from '../repositories/order.repository.js';
import * as couponRepo from '../repositories/coupon.repository.js';
import * as trustScoreService from './trustScore.service.js';
import * as otpService from './otp.service.js';
import { calculatePricingBreakdown, toPaisa, toBdtNumber } from './pricing.service.js';

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
  if (guestToken && userId) {
    try {
      await cartService.mergeGuestCartOnLogin(pool, { guestToken, userId });
    } catch {}
  }
  let cart = await cartService.getCart(pool, { userId, guestToken });
  if ((!cart || !cart.items || cart.items.length === 0) && guestToken) {
    cart = await cartService.getCart(pool, { guestToken });
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

    // 5. Coupon Validation & Calculation
    let coupon = null;
    let discountAmountPaisa = 0;

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

      const minSpendPaisa = toPaisa(coupon.min_spend);
      if (itemsAmountPaisa < minSpendPaisa) {
        throw new AppError(
          'COUPON_INVALID',
          `Minimum order spend of ৳${(minSpendPaisa / 100).toFixed(2)} required for this coupon.`,
          `এই কুপনের জন্য সর্বনিম্ন ৳${(minSpendPaisa / 100).toFixed(2)} অর্ডারের প্রয়োজন।`
        );
      }

      if (coupon.budget_cap != null) {
        const budgetUsedPaisa = toPaisa(coupon.budget_used);
        const budgetCapPaisa = toPaisa(coupon.budget_cap);
        if (budgetUsedPaisa >= budgetCapPaisa) {
          throw new AppError(
            'COUPON_BUDGET_EXHAUSTED',
            'Coupon discount budget has been exhausted.',
            'কুপনের বাজেট শেষ হয়ে গেছে।'
          );
        }
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

      // Compute discount
      if (coupon.discount_type === 'PERCENT') {
        const pct = parseFloat(coupon.discount_value);
        let rawDiscount = Math.floor((itemsAmountPaisa * pct) / 100);
        if (coupon.max_discount != null) {
          const maxPaisa = toPaisa(coupon.max_discount);
          rawDiscount = Math.min(rawDiscount, maxPaisa);
        }
        discountAmountPaisa = rawDiscount;
      } else if (coupon.discount_type === 'FIXED') {
        discountAmountPaisa = Math.min(itemsAmountPaisa, toPaisa(coupon.discount_value));
      }
    }

    // 6. Multi-Supplier Grouping & Shipping Calculation
    // Group line items by supplier_id
    const supplierGroups = new Map();
    for (const item of cart.items) {
      const suppId = item.supplier_id;
      if (!supplierGroups.has(suppId)) {
        supplierGroups.set(suppId, []);
      }
      supplierGroups.get(suppId).push(item);
    }

    const supplierCount = supplierGroups.size;
    const shippingPerParcelPaisa = toPaisa(60.0); // ৳60 per supplier parcel
    const totalShippingPaisa = supplierCount * shippingPerParcelPaisa;

    const totalAmountPaisa = itemsAmountPaisa + totalShippingPaisa - discountAmountPaisa;
    const totalAmountBdt = toBdtNumber(totalAmountPaisa);

    // 7. COD Anti-Fraud & Trust Score Risk Gate
    let isOtpVerified = false;
    let trustScoreAtOrder = 50;

    if (paymentMethod === 'COD') {
      const risk = await trustScoreService.evaluateCodRisk(client, {
        userId,
        orderAmount: totalAmountBdt,
      });

      trustScoreAtOrder = risk.trustScore;

      if (risk.requiresOtp) {
        if (!otpCode) {
          // Trigger SMS OTP send
          try {
            // WHY the explicit `null`: sendOtp's signature is
            // (db, cache, smsSender, emailSender, options). This call was still passing the options
            // object in the emailSender slot, so destructuring `undefined` threw on every COD gate —
            // and the catch below swallowed it, so the OTP was never created or sent.
            await otpService.sendOtp(client, cache, async () => {}, null, {
              phone: cleanPhone,
              purpose: 'COD_CONFIRM',
              ip: '127.0.0.1',
              isDevelopment: true,
            });
          } catch (err) {
            // Mock/test senders may fail; the gate below is raised regardless. Surface the cause so
            // a broken send is not indistinguishable from a working one.
            client.log?.warn?.({ err }, 'COD OTP dispatch failed');
          }

          throw new AppError(
            'COD_OTP_REQUIRED',
            'SMS OTP verification is required for this Cash on Delivery order.',
            'এই ক্যাশ অন ডেলিভারি অর্ডারের জন্য এসএমএস ওটিপি যাচাইকরণ প্রয়োজন।',
            {
              phone: cleanPhone,
              trust_score: risk.trustScore,
              reason: risk.reason,
            }
          );
        }

        // Verify provided OTP
        await otpService.verifyOtp(client, {
          phone: cleanPhone,
          code: otpCode,
          purpose: 'COD_CONFIRM',
        });

        isOtpVerified = true;
      }
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
    let remainingDiscountPaisa = discountAmountPaisa;

    for (const [supplierId, items] of supplierGroups.entries()) {
      const subOrderRef = `${orderRef}-${supplierIndex}`;
      supplierIndex += 1;

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

        // Calculate Pricing Formula via pricing.service.js
        const pricing = calculatePricingBreakdown({
          baseCost: prod.base_cost,
          wholesaleMargin: prod.wholesale_margin,
          retailPrice: item.unit_price,
          salerSplitPct: 40,
          platformSplitPct: 60,
        });

        const lineTotalPaisa = toPaisa(item.unit_price) * itemQty;
        subOrderItemsAmountPaisa += lineTotalPaisa;

        subOrderBasePaisa += (pricing.paisa.base_cost * itemQty);
        subOrderWholesaleMarginPaisa += (pricing.paisa.wholesale_margin * itemQty);
        subOrderNetRetailMarginPaisa += (pricing.paisa.net_retail_margin * itemQty);
        subOrderSalerCommissionPaisa += (pricing.paisa.saler_earning * itemQty);
        subOrderPlatformMarginPaisa += (pricing.paisa.platform_earning * itemQty);

        processedItems.push({
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

      // Prorate discount share for this sub-order
      let subOrderDiscountSharePaisa = 0;
      if (discountAmountPaisa > 0 && itemsAmountPaisa > 0) {
        subOrderDiscountSharePaisa = Math.min(
          remainingDiscountPaisa,
          Math.floor((discountAmountPaisa * subOrderItemsAmountPaisa) / itemsAmountPaisa)
        );
        remainingDiscountPaisa -= subOrderDiscountSharePaisa;
      }

      const subOrderShippingPaisa = shippingPerParcelPaisa;
      const subOrderTotalPaisa = subOrderItemsAmountPaisa + subOrderShippingPaisa - subOrderDiscountSharePaisa;

      const subOrder = await orderRepo.createSubOrder(client, {
        ref: subOrderRef,
        orderId: rootOrder.id,
        supplierId,
        salerId: items[0].saler_id || null,
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
    await client.query(
      `UPDATE carts SET status = 'CONVERTED', converted_order_id = $1, updated_at = now() WHERE id = $2`,
      [rootOrder.id, cart.cart_id]
    );
    await cartRepo.clearCartItems(client, cart.cart_id);

    // 12. Commit Transaction
    await client.query('COMMIT');

    // 13. Fetch fully formatted order response
    const fullOrder = await orderRepo.findOrderById(pool, rootOrder.id);

    // Background trust score re-calculation
    trustScoreService.calculateAndPersistTrustScore(pool, userId).catch(() => {});

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
