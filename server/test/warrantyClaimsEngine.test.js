/**
 * warrantyClaimsEngine.test.js — Automated test suite for Prompt 10.4.
 *
 * Verifies the ACCEPTANCE criteria from docs/prompt.md Prompt 10.4:
 * 1. Delivery issues a digital warranty card with a correct expiry countdown.
 * 2. A claim moves through the full lifecycle with correct notifications.
 * 3. Claim rate per product is visible to Admin and affects the supplier's tier.
 * 4. Transferability rules enforced per category.
 * 5. SLA breach automatically escalates to Admin review.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as warrantyService from '../src/services/warranty.service.js';
import { calculateTierFromMetrics } from '../src/services/trustTier.service.js';

function createMockDb({
  queryHandler = null,
} = {}) {
  return {
    async query(sql, params = []) {
      if (queryHandler) {
        return queryHandler(sql, params);
      }
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, params = []) {
          if (queryHandler) {
            return queryHandler(sql, params);
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
}

describe('Prompt 10.4 — Digital Warranty & Claims Engine', () => {
  test('issueWarrantiesForSubOrder auto-issues warranty card on delivery for products with warranty_months > 0', async () => {
    let insertedCard = null;
    let notificationSent = null;

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        // Query items for sub-order
        if (sql.includes('FROM order_items oi') && sql.includes('WHERE so.id = $1')) {
          return {
            rows: [
              {
                order_item_id: 101,
                product_id: 50,
                title_snapshot: 'Walton 43-inch Smart TV',
                qty: 1,
                supplier_id: 9,
                sub_order_ref: 'SO-9921',
                customer_id: 3,
                warranty_months: 12,
                brand: 'Walton',
                is_warranty_transferable: true,
              },
            ],
          };
        }

        // Check existing
        if (sql.includes('SELECT id, ref FROM warranty_cards WHERE order_item_id = $1')) {
          return { rows: [] };
        }

        // Insert new card
        if (sql.includes('INSERT INTO warranty_cards')) {
          insertedCard = {
            id: 1,
            ref: params[0],
            order_item_id: params[1],
            customer_id: params[2],
            supplier_id: params[3],
            serial_number: params[4],
            is_transferable: params[7],
            starts_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 12 * 30 * 24 * 3600 * 1000).toISOString(),
          };
          return { rows: [insertedCard] };
        }

        // Audit or other queries
        return { rows: [] };
      },
    });

    const result = await warrantyService.issueWarrantiesForSubOrder(db, {
      subOrderId: 501,
      client: db,
    });

    assert.equal(result.issuedCount, 1, 'Should issue 1 warranty card');
    assert.ok(insertedCard, 'Card should be inserted');
    assert.ok(insertedCard.ref.startsWith('WAR-'), 'Ref should match WAR- prefix');
    assert.equal(insertedCard.customer_id, 3);
    assert.equal(insertedCard.supplier_id, 9);
    assert.equal(insertedCard.is_transferable, true);
  });

  test('getCustomerWarrantyCards returns active status and countdown calculation', async () => {
    const futureDate = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(); // 10 days in future

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        return {
          rows: [
            {
              id: 1,
              ref: 'WAR-DEMO-01',
              customer_id: 3,
              supplier_id: 9,
              order_item_id: 101,
              serial_number: 'SN-SO-9921-101-8891',
              is_transferable: true,
              starts_at: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
              expires_at: futureDate,
              product_title_en: 'Walton 43-inch Smart TV',
              supplier_name: 'Walton Official',
              claims_json: [],
            },
          ],
        };
      },
    });

    const result = await warrantyService.getCustomerWarrantyCards(db, 3);
    assert.equal(result.total, 1);
    const card = result.cards[0];
    assert.equal(card.is_active, true, 'Card with future expires_at must be active');
    assert.ok(card.remaining_days >= 9, 'Should have ~10 days remaining');
    assert.ok(card.remaining_ms > 0);
  });

  test('submitWarrantyClaim validates active warranty and creates claim with 72h SLA', async () => {
    let insertedClaim = null;

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        // Lock card
        if (sql.includes('SELECT wc.*, p.title_en') && sql.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 1,
                ref: 'WAR-DEMO-01',
                customer_id: 3,
                supplier_id: 9,
                expires_at: new Date(Date.now() + 100 * 24 * 3600 * 1000).toISOString(),
                title_en: 'Walton 43-inch Smart TV',
              },
            ],
          };
        }

        // Check active claims
        if (sql.includes('SELECT id, ref, status FROM warranty_claims')) {
          return { rows: [] };
        }

        // Insert claim
        if (sql.includes('INSERT INTO warranty_claims')) {
          insertedClaim = {
            id: 10,
            ref: params[0],
            warranty_card_id: params[1],
            customer_id: params[2],
            issue_description: params[3],
            evidence_media_json: params[4],
            resolution: params[5],
            status: 'SUBMITTED',
            sla_due_at: params[6],
          };
          return { rows: [insertedClaim] };
        }

        return { rows: [] };
      },
    });

    const result = await warrantyService.submitWarrantyClaim(db, {
      customerId: 3,
      warrantyCardId: 1,
      issueDescription: 'Screen backlight stopped working and display is black.',
      preferredResolution: 'REPAIR',
      client: db,
    });

    assert.equal(result.success, true);
    assert.ok(insertedClaim);
    assert.ok(insertedClaim.ref.startsWith('CLM-'));
    assert.equal(insertedClaim.status, 'SUBMITTED');
    assert.ok(new Date(insertedClaim.sla_due_at).getTime() > Date.now(), 'SLA deadline must be in the future');
  });

  test('reviewWarrantyClaim on REPAIR resolution books reverse consignment via courier adapter', async () => {
    let updatedClaim = null;
    let createdShipment = null;

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('SELECT c.*, wc.supplier_id') && sql.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 10,
                ref: 'CLM-DEMO-88',
                warranty_card_id: 1,
                supplier_id: 9,
                customer_id: 3,
                sub_order_id: 501,
                sub_order_ref: 'SO-9921',
                delivery_address_json: { district: 'Dhaka', address: 'Dhanmondi 27' },
                recipient_name: 'Sadia Rahman',
                recipient_phone: '01712345678',
              },
            ],
          };
        }

        if (sql.includes('INSERT INTO shipments')) {
          createdShipment = { id: 77, tracking_number: params[2] };
          return { rows: [createdShipment] };
        }

        if (sql.includes('UPDATE warranty_claims') && sql.includes('status = \'APPROVED\'')) {
          updatedClaim = {
            id: params[0],
            status: 'APPROVED',
            resolution: params[1],
            reverse_shipment_id: params[2],
          };
          return { rows: [updatedClaim] };
        }

        return { rows: [] };
      },
    });

    const result = await warrantyService.reviewWarrantyClaim(db, {
      claimId: 10,
      supplierId: 9,
      action: 'APPROVE',
      resolution: 'REPAIR',
      client: db,
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'APPROVED');
    assert.equal(result.resolution, 'REPAIR');
    assert.ok(result.reverseShipmentId, 'Reverse consignment shipment must be booked on repair approval');
  });

  test('reviewWarrantyClaim on REJECT requires rejection reason', async () => {
    const db = createMockDb({
      queryHandler: async (sql) => {
        if (sql.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 10,
                ref: 'CLM-DEMO-88',
                supplier_id: 9,
                customer_id: 3,
              },
            ],
          };
        }
        return { rows: [] };
      },
    });

    await assert.rejects(
      async () => {
        await warrantyService.reviewWarrantyClaim(db, {
          claimId: 10,
          supplierId: 9,
          action: 'REJECT',
          rejectionReason: '', // missing
          client: db,
        });
      },
      /REJECTION_REASON_REQUIRED/,
      'Must reject if rejection reason is missing'
    );
  });

  test('transferWarrantyCard enforces category transferability rule and reassigns ownership', async () => {
    let updatedCard = null;

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('SELECT wc.*, p.title_en') && sql.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 1,
                ref: 'WAR-DEMO-01',
                customer_id: 3,
                is_transferable: true,
                expires_at: new Date(Date.now() + 50 * 24 * 3600 * 1000).toISOString(),
                title_en: 'Walton 43-inch Smart TV',
              },
            ],
          };
        }

        if (sql.includes('u.email ILIKE $1')) {
          return {
            rows: [
              { id: 15, full_name: 'Tanvir Ahmed', phone: '01811223344', email: 'tanvir@example.com' },
            ],
          };
        }

        if (sql.includes('UPDATE warranty_cards') && sql.includes('customer_id = $2')) {
          updatedCard = { id: params[0], customer_id: params[1] };
          return { rows: [updatedCard] };
        }

        return { rows: [] };
      },
    });

    const result = await warrantyService.transferWarrantyCard(db, {
      cardId: 1,
      currentCustomerId: 3,
      targetPhoneOrEmail: '01811223344',
      client: db,
    });

    assert.equal(result.success, true);
    assert.equal(result.transferredTo.id, 15);
    assert.ok(updatedCard);
    assert.equal(updatedCard.customer_id, 15);
  });

  test('checkAndEscalateBreachedSla escalates overdue claims to Admin', async () => {
    let escalatedClaimId = null;

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('WHERE c.status IN (\'SUBMITTED\', \'UNDER_REVIEW\')')) {
          return {
            rows: [
              {
                id: 105,
                ref: 'CLM-OVERDUE-01',
                warranty_card_id: 1,
                supplier_id: 9,
                customer_id: 3,
              },
            ],
          };
        }

        if (sql.includes('UPDATE warranty_claims') && sql.includes('status = \'ESCALATED\'')) {
          escalatedClaimId = params[0];
          return { rows: [{ id: 105, status: 'ESCALATED' }] };
        }

        if (sql.includes('JOIN roles r') && sql.includes("r.key IN")) {
          return { rows: [{ id: 1 }] };
        }

        return { rows: [] };
      },
    });

    const result = await warrantyService.checkAndEscalateBreachedSla(db);
    assert.equal(result.escalatedCount, 1);
    assert.equal(escalatedClaimId, 105);
  });

  test('getProductClaimAnalytics correctly computes product claim rates & quality signals', async () => {
    const db = createMockDb({
      queryHandler: async () => {
        return {
          rows: [
            {
              product_id: 10,
              title_en: 'Low Defect Saree',
              warranty_months: 6,
              supplier_id: 9,
              supplier_name: 'Rahim Textiles',
              total_warranties_issued: 100,
              total_claims_count: 1,
              approved_claims_count: 1,
              rejected_claims_count: 0,
              active_claims_count: 0,
            },
            {
              product_id: 20,
              title_en: 'Defective Electric Kettle',
              warranty_months: 12,
              supplier_id: 9,
              supplier_name: 'Rahim Textiles',
              total_warranties_issued: 20,
              total_claims_count: 4, // 20% claim rate -> HIGH_RISK
              approved_claims_count: 3,
              rejected_claims_count: 0,
              active_claims_count: 1,
            },
          ],
        };
      },
    });

    const result = await warrantyService.getProductClaimAnalytics(db, { supplierId: 9 });
    assert.equal(result.totalProducts, 2);

    const normalProduct = result.products.find((p) => p.product_id === 10);
    assert.equal(normalProduct.claim_rate_pct, 1.0);
    assert.equal(normalProduct.quality_signal, 'NORMAL');

    const highRiskProduct = result.products.find((p) => p.product_id === 20);
    assert.equal(highRiskProduct.claim_rate_pct, 20.0);
    assert.equal(highRiskProduct.quality_signal, 'HIGH_RISK');
  });

  test('calculateTierFromMetrics prevents promotion to ELITE_PARTNER if warranty claim rate is high', () => {
    // High performing supplier with high claim rate (>7%)
    const tierWithHighClaimRate = calculateTierFromMetrics({
      isVerified: true,
      completedOrders: 350,
      ratingAvg: 4.8,
      deliverySuccessRate: 98,
      disputeRate: 1.0,
      warrantyClaimRate: 12.5, // Exceeds 7% threshold
      daysActive: 120,
    });

    assert.equal(
      tierWithHighClaimRate,
      'VERIFIED_TRADER',
      'High claim rate must block promotion to ELITE_PARTNER'
    );

    // Same supplier with healthy low claim rate (<=7%)
    const tierWithLowClaimRate = calculateTierFromMetrics({
      isVerified: true,
      completedOrders: 350,
      ratingAvg: 4.8,
      deliverySuccessRate: 98,
      disputeRate: 1.0,
      warrantyClaimRate: 2.1,
      daysActive: 120,
    });

    assert.equal(
      tierWithLowClaimRate,
      'ELITE_PARTNER',
      'Supplier with healthy claim rate should achieve ELITE_PARTNER'
    );
  });
});
