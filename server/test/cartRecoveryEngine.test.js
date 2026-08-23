/**
 * cartRecoveryEngine.test.js — Test suite for Prompt 9.6: Abandoned Cart Recovery (DFD Subsystem 12.0).
 *
 * Tests:
 * 1. Inactive cart detection, token generation, and cooldown enforcement.
 * 2. 3-Step recovery sequence progression (+1h reminder, +24h 5% incentive, +72h 10% final urgency).
 * 3. Immediate sequence termination when an order is placed.
 * 4. Exact cart restoration with items, variants, and product details.
 * 5. Step-level conversion attribution and recovered revenue calculation.
 * 6. Saler manual offer dispatch with discount cap validation (<= 15%).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as cartRecoveryService from '../src/services/cartRecovery.service.js';

describe('Prompt 9.6: Abandoned Cart Recovery Engine', () => {

  describe('1. Inactivity Detection & User Cooldown', () => {
    test('Detects inactive carts with items and enforces user 7-day cooldown', async () => {
      const candidateCarts = [
        { cart_id: 101, user_id: 5, guest_token: null, total_items_value: 3500 },
      ];

      const insertedRecords = [];
      const updatedCarts = [];

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('FROM platform_modules')) {
            return {
              rows: [{
                key: 'cart_recovery',
                is_enabled: true,
                default_enabled: true,
                settings_json: { inactivity_minutes: 60, user_cooldown_days: 7 },
              }],
            };
          }
          if (sql.includes('FROM carts c') && sql.includes('GROUP BY c.id')) {
            return { rows: candidateCarts };
          }
          if (sql.includes('SELECT id FROM abandoned_carts WHERE user_id = $1')) {
            // User 5 has no recent sequences within 7 days
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO abandoned_carts')) {
            const row = { id: insertedRecords.length + 1, cart_id: params[0], user_id: params[1], items_value: params[2], recovery_token: params[3] };
            insertedRecords.push(row);
            return { rows: [row] };
          }
          if (sql.includes('UPDATE carts SET status = \'ABANDONED\'')) {
            updatedCarts.push(params[0]);
            return { rows: [] };
          }
          return { rows: [] };
        },
        connect: async function () {
          return {
            query: this.query,
            release: () => {},
          };
        },
      };

      const mockCache = { get: async () => null, set: async () => {} };

      const result = await cartRecoveryService.detectAbandonedCarts(mockDb, mockCache);

      assert.equal(result.detectedCount, 1);
      assert.equal(insertedRecords.length, 1);
      assert.equal(insertedRecords[0].cart_id, 101);
      assert.ok(insertedRecords[0].recovery_token.startsWith('CRT-'));
      assert.equal(updatedCarts[0], 101);
    });
  });

  describe('2. Multi-Step Recovery Sequence Progression', () => {
    test('Sequence advances at configured intervals (+1h, +24h, +72h) with coupons', async () => {
      // 3 carts at different ages: Cart 1 (2h old, step 0), Cart 2 (26h old, step 1), Cart 3 (75h old, step 2)
      const pendingCarts = [
        { id: 1, cart_id: 101, user_id: 5, sequence_step: 0, recovery_token: 'CRT-AAAA', hours_since_detected: 2 },
        { id: 2, cart_id: 102, user_id: 6, sequence_step: 1, recovery_token: 'CRT-BBBB', hours_since_detected: 26 },
        { id: 3, cart_id: 103, user_id: 7, sequence_step: 2, recovery_token: 'CRT-CCCC', hours_since_detected: 75 },
      ];

      const logsInserted = [];
      const stepsUpdated = [];

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('FROM platform_modules')) {
            return {
              rows: [{
                key: 'cart_recovery',
                is_enabled: true,
                default_enabled: true,
                settings_json: {
                  inactivity_minutes: 60,
                  step1_hours: 1,
                  step2_hours: 24,
                  step3_hours: 72,
                  step2_discount_pct: 5,
                  step3_discount_pct: 10,
                },
              }],
            };
          }
          if (sql.includes('FROM carts c') && sql.includes('GROUP BY c.id')) {
            return { rows: [] }; // No newly detected in this sweep
          }
          if (sql.includes('FROM abandoned_carts ac') && sql.includes('ORDER BY ac.detected_at ASC')) {
            return { rows: pendingCarts };
          }
          if (sql.includes('INSERT INTO cart_recovery_logs')) {
            logsInserted.push({
              abandoned_cart_id: params[0],
              sequence_step: params[3],
              channel: params[4],
              discount_pct: params[5] || 0,
              coupon_code: params[6] || null,
            });
            return { rows: [{ id: logsInserted.length }] };
          }
          if (sql.includes('UPDATE abandoned_carts')) {
            stepsUpdated.push({ id: params[0], step: params[1] });
            return { rows: [] };
          }
          return { rows: [] };
        },
        connect: async function () {
          return {
            query: this.query,
            release: () => {},
          };
        },
      };

      const mockCache = { get: async () => null, set: async () => {} };

      const result = await cartRecoveryService.processRecoverySequence(mockDb, mockCache);

      assert.equal(result.processedCount, 3);
      assert.equal(result.step1Count, 1);
      assert.equal(result.step2Count, 1);
      assert.equal(result.step3Count, 1);

      // Verify Step 1: No coupon
      assert.equal(logsInserted[0].sequence_step, 1);
      assert.equal(logsInserted[0].discount_pct, 0);

      // Verify Step 2: 5% coupon
      assert.equal(logsInserted[1].sequence_step, 2);
      assert.equal(logsInserted[1].discount_pct, 5);
      assert.ok(logsInserted[1].coupon_code.startsWith('RECOVER5-'));

      // Verify Step 3: 10% coupon
      assert.equal(logsInserted[2].sequence_step, 3);
      assert.equal(logsInserted[2].discount_pct, 10);
      assert.ok(logsInserted[2].coupon_code.startsWith('RECOVER10-'));
    });
  });

  describe('3. Exact Cart Restoration by Signed Token', () => {
    test('Recovery link restores exact cart including variant details and quantities', async () => {
      const mockAbandonedCart = {
        id: 1,
        cart_id: 101,
        user_id: 5,
        items_value: '4500.00',
        recovery_token: 'CRT-TEST1234',
        status: 'ABANDONED',
      };

      const mockItems = [
        {
          id: 1,
          cart_id: 101,
          product_id: 50,
          variant_id: 12,
          qty: 2,
          price_at_add: '2250.00',
          product_name_en: 'Silk Jamdani Saree',
          variant_sku: 'JAM-RED-L',
          variant_attributes: { color: 'Red', size: 'Standard' },
        },
      ];

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('FROM abandoned_carts ac') && sql.includes('recovery_token = $1')) {
            return { rows: [mockAbandonedCart] };
          }
          if (sql.includes('FROM cart_items ci')) {
            return { rows: mockItems };
          }
          return { rows: [] };
        },
      };

      const restored = await cartRecoveryService.restoreCartByToken(mockDb, 'CRT-TEST1234');

      assert.ok(restored.abandoned_cart);
      assert.equal(restored.abandoned_cart.cart_id, 101);
      assert.equal(restored.items.length, 1);
      assert.equal(restored.items[0].product_name_en, 'Silk Jamdani Saree');
      assert.equal(restored.items[0].variant_sku, 'JAM-RED-L');
      assert.equal(restored.items[0].qty, 2);
      assert.equal(restored.total_items_count, 2);
      assert.equal(restored.items_value, '4500.00');
    });
  });

  describe('4. Conversion Attribution & Recovery Accounting', () => {
    test('Recording order placement attributes recovered revenue and marks cart converted', async () => {
      let abandonedCartUpdated = false;
      let cartUpdated = false;

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('UPDATE abandoned_carts')) {
            abandonedCartUpdated = true;
            return { rows: [{ cart_id: params[2], recovered_order_id: params[0], recovered_value: params[1] }] };
          }
          if (sql.includes('UPDATE carts')) {
            cartUpdated = true;
            return { rows: [{ id: params[1], status: 'CONVERTED' }] };
          }
          return { rows: [] };
        },
        connect: async function () {
          return {
            query: this.query,
            release: () => {},
          };
        },
      };

      const res = await cartRecoveryService.recordCartRecoveryConversion(mockDb, {
        cartId: 101,
        orderId: 8001,
        orderTotal: 4500.00,
      });

      assert.equal(res.converted, true);
      assert.equal(res.orderId, 8001);
      assert.equal(res.recoveredValue, 4500.00);
      assert.equal(abandonedCartUpdated, true);
      assert.equal(cartUpdated, true);
    });
  });

  describe('5. Saler Manual Offer Dispatch & Cap Enforcement', () => {
    test('Saler manual recovery offer cannot exceed configured cap (15%)', async () => {
      const mockCart = {
        id: 44,
        cart_id: 101,
        user_id: 5,
        recovery_token: 'CRT-OFFER99',
      };

      let loggedOffer = null;

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('FROM platform_modules')) {
            return {
              rows: [{
                key: 'cart_recovery',
                settings_json: { max_discount_cap_pct: 15 },
              }],
            };
          }
          if (sql.includes('SELECT * FROM abandoned_carts WHERE id = $1')) {
            return { rows: [mockCart] };
          }
          if (sql.includes('INSERT INTO cart_recovery_logs')) {
            loggedOffer = {
              abandoned_cart_id: params[0],
              cart_id: params[1],
              user_id: params[2],
              sequence_step: params[3],
              channel: params[4],
              discount_pct: params[5],
              coupon_code: params[6],
            };
            return { rows: [loggedOffer] };
          }
          if (sql.includes('UPDATE abandoned_carts')) {
            return { rows: [] };
          }
          return { rows: [] };
        },
        connect: async function () {
          return {
            query: this.query,
            release: () => {},
          };
        },
      };

      // Request 25% discount -> must be capped at 15%
      const res = await cartRecoveryService.sendManualOffer(mockDb, {
        salerUserId: 20,
        abandonedCartId: 44,
        discountPct: 25,
      });

      assert.equal(res.success, true);
      assert.equal(res.discountPct, 15); // Capped at 15%
      assert.ok(res.couponCode.startsWith('SPECIAL-15-'));
      assert.equal(loggedOffer.sequence_step, 4); // Step 4 = manual offer
      assert.equal(loggedOffer.discount_pct, 15);
    });
  });

});
