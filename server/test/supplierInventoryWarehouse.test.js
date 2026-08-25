/**
 * supplierInventoryWarehouse.test.js — Automated test suite for Prompt 11.1 (Supplier Dashboard, FEFO & Warehouse Routing).
 *
 * Verifies all ACCEPTANCE criteria for Prompt 11.1:
 * 1. Two batches expiring 2026-10-01 and 2026-12-01 → order / getFEFOBatch allocates October batch.
 * 2. An order routes to the nearest warehouse holding stock using great-circle distance.
 * 3. The expiry job flags a batch 45 days out and offers the clearance action.
 * 4. Simple Mode shows at most 6 primary actions.
 * 5. Deterministic tie-breaking and cross-warehouse fallback.
 * 6. Fastify HTTP REST API endpoints for supplier operations.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import supplierRoutes from '../src/routes/supplier.routes.js';
import * as inventoryService from '../src/services/inventory.service.js';
import * as warehouseRoutingService from '../src/services/warehouseRouting.service.js';
import { SIMPLE_MODE_ITEMS } from '../../client/src/config/navigation.js';

function createMockDb({ queryHandler = null } = {}) {
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

describe('Prompt 11.1 — Supplier / Manufacturer Dashboard, FEFO & Warehouse Routing', () => {

  // ---------------------------------------------------------------------------
  // 1. FEFO Batch Allocation (Acceptance 1)
  // ---------------------------------------------------------------------------
  test('Acceptance 1: Two batches expiring 2026-10-01 and 2026-12-01 → getFEFOBatch allocates October batch', async () => {
    const batches = [
      {
        id: 1,
        product_id: 10,
        variant_id: null,
        warehouse_node_id: 1,
        batch_number: 'LOT-2026-DEC',
        mfg_date: '2026-01-01',
        exp_date: new Date('2026-12-01'),
        qty: 50,
        status: 'ACTIVE',
        created_at: new Date('2026-01-01'),
      },
      {
        id: 2,
        product_id: 10,
        variant_id: null,
        warehouse_node_id: 1,
        batch_number: 'LOT-2026-OCT',
        mfg_date: '2026-01-01',
        exp_date: new Date('2026-10-01'),
        qty: 50,
        status: 'ACTIVE',
        created_at: new Date('2026-01-02'),
      },
    ];

    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM product_batches')) {
          // Emulate PostgreSQL ORDER BY exp_date ASC NULLS LAST, created_at ASC, id ASC
          const sorted = [...batches].sort((a, b) => a.exp_date.getTime() - b.exp_date.getTime());
          const match = sorted.find((b) => b.product_id === params[0] && b.qty >= params[3] && b.status === 'ACTIVE');
          return { rows: match ? [match] : [] };
        }
        return { rows: [] };
      },
    });

    const allocated = await inventoryService.getFEFOBatch(mockDb, {
      productId: 10,
      warehouseNodeId: 1,
      qty: 5,
    });

    assert.ok(allocated, 'getFEFOBatch should return an allocated batch');
    assert.equal(allocated.batch_number, 'LOT-2026-OCT', 'FEFO must prioritize the earlier October batch over December');
    assert.equal(allocated.exp_date.toISOString().slice(0, 10), '2026-10-01');
  });

  test('Acceptance 1.1: Multi-warehouse fallback when primary warehouse has no stock', async () => {
    const batches = [
      {
        id: 3,
        product_id: 10,
        variant_id: null,
        warehouse_node_id: 2, // Chittagong node (Node 2)
        warehouse_node_name: 'Chittagong Depot',
        warehouse_district: 'Chittagong',
        batch_number: 'LOT-CTG-STOCK',
        exp_date: new Date('2026-11-15'),
        qty: 40,
        status: 'ACTIVE',
        created_at: new Date('2026-01-01'),
      },
    ];

    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        // If targeted node = 1 (Dhaka), return empty
        if (sql.includes('pb.warehouse_node_id = $3')) {
          const match = batches.find((b) => b.warehouse_node_id === params[2]);
          return { rows: match ? [match] : [] };
        }
        // Fallback query across all nodes
        if (sql.includes('ORDER BY pb.exp_date ASC NULLS LAST, wn.priority DESC')) {
          return { rows: batches };
        }
        return { rows: [] };
      },
    });

    const fallbackResult = await inventoryService.getFEFOBatch(mockDb, {
      productId: 10,
      warehouseNodeId: 1, // Target Node 1 (empty)
      qty: 5,
    });

    assert.ok(fallbackResult, 'Fallback across warehouses must return available batch');
    assert.equal(fallbackResult.batch_number, 'LOT-CTG-STOCK');
    assert.equal(fallbackResult.warehouse_node_id, 2);
  });

  // ---------------------------------------------------------------------------
  // 2. Multi-Warehouse GIS Proximity Routing (Acceptance 2)
  // ---------------------------------------------------------------------------
  test('Acceptance 2: An order routes to the nearest warehouse holding stock (Great-Circle Distance)', async () => {
    const mockNodes = [
      {
        id: 101,
        name: 'Dhaka Central Hub',
        district: 'Dhaka',
        latitude: 23.8103,
        longitude: 90.4125,
        priority: 10,
        inventory: [{ product_id: 1, stock_qty: 50, reserved_qty: 0 }],
      },
      {
        id: 102,
        name: 'Chittagong Port Depot',
        district: 'Chittagong',
        latitude: 22.3569,
        longitude: 91.7832,
        priority: 10,
        inventory: [{ product_id: 1, stock_qty: 50, reserved_qty: 0 }],
      },
      {
        id: 103,
        name: 'Sylhet Regional Facility',
        district: 'Sylhet',
        latitude: 24.8949,
        longitude: 91.8687,
        priority: 10,
        inventory: [{ product_id: 1, stock_qty: 50, reserved_qty: 0 }],
      },
    ];

    // Case 1: Customer in Moulvibazar (Sylhet division)
    const sylhetRoute = await warehouseRoutingService.findNearestWarehouse(
      'Moulvibazar',
      [{ productId: 1, qty: 2 }],
      mockNodes
    );

    assert.ok(sylhetRoute.selectedWarehouse, 'Should select a warehouse');
    assert.equal(sylhetRoute.selectedWarehouse.id, 103, 'Customer in Moulvibazar must route to Sylhet Regional Facility (nearest)');
    assert.ok(sylhetRoute.distanceKm < 70, `Distance to Sylhet should be under 70km, got ${sylhetRoute.distanceKm}km`);

    // Case 2: Customer in Coxsbazar (Chittagong division)
    const ctgRoute = await warehouseRoutingService.findNearestWarehouse(
      'Coxsbazar',
      [{ productId: 1, qty: 2 }],
      mockNodes
    );

    assert.equal(ctgRoute.selectedWarehouse.id, 102, 'Customer in Coxsbazar must route to Chittagong Port Depot (nearest)');

    // Case 3: Customer in Gazipur (Dhaka division)
    const dkrRoute = await warehouseRoutingService.findNearestWarehouse(
      'Gazipur',
      [{ productId: 1, qty: 2 }],
      mockNodes
    );

    assert.equal(dkrRoute.selectedWarehouse.id, 101, 'Customer in Gazipur must route to Dhaka Central Hub (nearest)');
  });

  test('Acceptance 2.1: Priority breaks ties for warehouses with similar distance', async () => {
    const mockNodes = [
      {
        id: 201,
        name: 'Tejgaon Standard Depot',
        district: 'Dhaka',
        latitude: 23.8100,
        longitude: 90.4120,
        priority: 5,
        inventory: [{ product_id: 1, stock_qty: 50 }],
      },
      {
        id: 202,
        name: 'Gulshan High Priority Hub',
        district: 'Dhaka',
        latitude: 23.8105,
        longitude: 90.4128,
        priority: 25,
        inventory: [{ product_id: 1, stock_qty: 50 }],
      },
    ];

    const route = await warehouseRoutingService.findNearestWarehouse(
      'Dhaka',
      [{ productId: 1, qty: 1 }],
      mockNodes
    );

    assert.equal(route.selectedWarehouse.id, 202, 'Warehouse with higher priority (25 vs 5) should win for equidistant nodes');
  });

  // ---------------------------------------------------------------------------
  // 3. Expiry Warning Background Job & 1-Click Clearance (Acceptance 3)
  // ---------------------------------------------------------------------------
  test('Acceptance 3: The expiry job flags a batch 45 days out and offers the clearance action', async () => {
    const mockExpiringBatches = [
      {
        id: 5,
        product_id: 20,
        variant_id: null,
        warehouse_node_id: 1,
        batch_number: 'LOT-EXP-45D',
        exp_date: new Date(Date.now() + 45 * 86400000),
        qty: 80,
        status: 'ACTIVE',
        title_en: 'Organic Mustard Oil 500ml',
        title_bn: 'অর্গানিক সরিষার তেল ৫০০মি.লি.',
        supplier_id: 1,
        default_retail_price: '400.00',
        warehouse_name: 'Tejgaon Central Depot',
        days_to_expiry: 45,
      },
    ];

    let statusUpdated = false;

    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM product_batches pb') && sql.includes('pb.status IN')) {
          return { rows: mockExpiringBatches };
        }
        if (sql.includes('UPDATE product_batches') && sql.includes('EXPIRING_SOON')) {
          statusUpdated = true;
          return { rows: [{ ...mockExpiringBatches[0], status: 'EXPIRING_SOON' }] };
        }
        return { rows: [] };
      },
    });

    const jobResult = await inventoryService.checkExpiryWarnings(mockDb, null, console);

    assert.equal(jobResult.processedCount, 1);
    assert.equal(jobResult.clearanceOffers.length, 1);

    const offer = jobResult.clearanceOffers[0];
    assert.equal(offer.batchId, 5);
    assert.equal(offer.batchNumber, 'LOT-EXP-45D');
    assert.equal(offer.daysToExpiry, 45);
    assert.equal(offer.recommendedDiscountPct, 15, '45-day batch should recommend 15% markdown');
    assert.equal(offer.clearancePrice, 340, 'Retail 400 with 15% markdown should be 340');
    assert.equal(offer.action, '1_CLICK_CLEARANCE_SALE');
    assert.equal(statusUpdated, true, 'Batch status must be updated to EXPIRING_SOON');
  });

  test('Acceptance 3.1: 1-Click Clearance Action and Rapid Recall Isolation', async () => {
    let batch = {
      id: 8,
      product_id: 25,
      supplier_id: 1,
      batch_number: 'LOT-DEFECT-01',
      default_retail_price: '600.00',
      status: 'ACTIVE',
    };

    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('SELECT pb.*, p.supplier_id') && sql.includes('WHERE pb.id = $1')) {
          return { rows: [batch] };
        }
        if (sql.includes('UPDATE product_batches') && sql.includes('RECALLED')) {
          batch = { ...batch, status: 'RECALLED', recall_reason: params[1], recalled_at: new Date() };
          return { rows: [batch] };
        }
        if (sql.includes('UPDATE product_batches') && sql.includes('EXPIRING_SOON')) {
          batch = { ...batch, status: 'EXPIRING_SOON' };
          return { rows: [batch] };
        }
        return { rows: [] };
      },
    });

    // 1. Clearance trigger
    const clearanceRes = await inventoryService.applyBatchClearance(mockDb, {
      supplierId: 1,
      batchId: 8,
      discountPct: 20,
    });
    assert.equal(clearanceRes.discountPct, 20);
    assert.equal(clearanceRes.clearanceRetailPrice, 480);

    // 2. Recall trigger
    const recallRes = await inventoryService.recallBatch(mockDb, {
      supplierId: 1,
      batchId: 8,
      reason: 'Packaging seal integrity compromised',
    });
    assert.equal(recallRes.status, 'RECALLED');
    assert.equal(recallRes.recall_reason, 'Packaging seal integrity compromised');
  });

  // ---------------------------------------------------------------------------
  // 4. Simple Mode Constraint (Acceptance 4)
  // ---------------------------------------------------------------------------
  test('Acceptance 4: Simple Mode shows at most 6 primary actions', () => {
    const supplierSimpleItems = SIMPLE_MODE_ITEMS.supplier;

    assert.ok(Array.isArray(supplierSimpleItems), 'SIMPLE_MODE_ITEMS.supplier must be an array');
    assert.ok(
      supplierSimpleItems.length <= 6,
      `Simple Mode must show at most 6 primary actions, found ${supplierSimpleItems.length}`
    );
    assert.equal(supplierSimpleItems.length, 6, 'Supplier Simple Mode has exactly 6 primary actions per ia-sitemap §4');

    const keys = supplierSimpleItems.map((item) => item.key);
    assert.ok(keys.includes('supplier.simple.orders_to_pack'), 'Must contain orders to pack (pending orders)');
    assert.ok(keys.includes('supplier.simple.stock'), 'Must contain stock (low stock alerts)');
    assert.ok(keys.includes('supplier.simple.my_earnings'), 'Must contain my earnings');
    assert.ok(keys.includes('supplier.simple.print_labels'), 'Must contain print labels');
  });

  // ---------------------------------------------------------------------------
  // 5. Fastify HTTP Endpoints (Acceptance 5)
  // ---------------------------------------------------------------------------
  test('Fastify HTTP API: Supplier dashboard, inventory, batches, warehouses, fulfilment, and store status', async () => {
    let mockStoreStatus = { is_open: true, opening_time: '09:00', closing_time: '20:00' };

    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('SELECT') && sql.includes('total_products')) {
          return {
            rows: [
              {
                total_products: 15,
                total_units: 600,
                low_stock_count: 2,
                out_of_stock_count: 0,
              },
            ],
          };
        }
        if (sql.includes('pending_orders_count')) {
          return {
            rows: [
              {
                pending_orders_count: 5,
                today_earnings: '12500.00',
                total_settled_earnings: '150000.00',
              },
            ],
          };
        }
        if (sql.includes('total_active_batches')) {
          return {
            rows: [
              {
                total_active_batches: 8,
                expiring_soon_count: 2,
                expired_count: 0,
              },
            ],
          };
        }
        if (sql.includes('total_warehouses')) {
          return { rows: [{ total_warehouses: 3 }] };
        }
        if (sql.includes('active_curators_count')) {
          return { rows: [{ active_curators_count: 28 }] };
        }
        if (sql.includes('FROM physical_shop_status WHERE user_id')) {
          return { rows: [mockStoreStatus] };
        }
        if (sql.includes('INSERT INTO physical_shop_status')) {
          mockStoreStatus = { is_open: params[1], opening_time: '09:00', closing_time: '20:00' };
          return { rows: [mockStoreStatus] };
        }
        if (sql.includes('FROM products p') && sql.includes('p.supplier_id = $1')) {
          return {
            rows: [
              {
                id: 1,
                ref: 'PRD-1',
                title_en: 'Jamdani Saree',
                title_bn: 'জামদানি শাড়ি',
                stock_qty: 25,
                low_stock_threshold: 5,
                batches: [],
              },
            ],
          };
        }
        if (sql.includes('FROM product_batches pb')) {
          return {
            rows: [
              {
                id: 1,
                batch_number: 'LOT-1',
                product_title_en: 'Jamdani Saree',
                qty: 25,
                exp_date: '2026-12-01',
                status: 'ACTIVE',
                days_to_expiry: 98,
              },
            ],
          };
        }
        if (sql.includes('FROM warehouse_nodes wn')) {
          return {
            rows: [
              {
                id: 1,
                ref: 'WH-DHK-01',
                name: 'Tejgaon Depot',
                district: 'Dhaka',
                priority: 10,
                is_active: true,
                sku_count: 14,
                total_units_stored: 450,
              },
            ],
          };
        }
        if (sql.includes('FROM sub_orders so') && sql.includes('JOIN orders o')) {
          return {
            rows: [
              {
                id: 1,
                ref: 'SO-101',
                status: 'PLACED',
                recipient_name: 'Rahim Khan',
                recipient_phone: '01711223344',
                district: 'Dhaka',
                payment_method: 'COD',
                total_amount: '1200.00',
              },
            ],
          };
        }
        if (sql.includes('FROM order_items oi') && sql.includes('ANY($1::bigint[])')) {
          return {
            rows: [
              {
                sub_order_id: 1,
                title_snapshot: 'Jamdani Saree',
                qty: 1,
                batch_number: 'LOT-1',
              },
            ],
          };
        }
        if (sql.includes('saler_store_items ssi') || sql.includes('topSalers')) {
          return {
            rows: [
              {
                saler_id: 2,
                saler_name: 'Karim Saler',
                store_name: 'Dhaka Trends',
                store_slug: 'dhaka-trends',
                total_orders_sold: 15,
                total_revenue_generated: '45000.00',
                commissions_earned: '9000.00',
                curated_products_count: 4,
              },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const app = Fastify();
    app.decorate('db', mockDb);
    app.decorate('authenticate', async (req) => {
      req.user = { id: 1, role: 'supplier' };
    });
    app.decorate('requirePermission', () => async () => {});
    app.decorate('requireModule', () => async () => {});

    app.register(errorHandlerPlugin);
    await app.register(supplierRoutes, { prefix: '/api/v1' });
    await app.ready();

    // 1. GET /api/v1/supplier/dashboard
    const resDash = await app.inject({ method: 'GET', url: '/api/v1/supplier/dashboard' });
    assert.equal(resDash.statusCode, 200);
    assert.equal(resDash.json().success, true);
    assert.equal(resDash.json().data.metrics.total_products, 15);
    assert.equal(resDash.json().data.metrics.pending_orders_count, 5);

    // 2. GET /api/v1/supplier/inventory
    const resInv = await app.inject({ method: 'GET', url: '/api/v1/supplier/inventory' });
    assert.equal(resInv.statusCode, 200);
    assert.equal(resInv.json().data.length, 1);

    // 3. GET /api/v1/supplier/batches
    const resBatches = await app.inject({ method: 'GET', url: '/api/v1/supplier/batches' });
    assert.equal(resBatches.statusCode, 200);
    assert.equal(resBatches.json().data.length, 1);

    // 4. GET /api/v1/supplier/warehouses
    const resWh = await app.inject({ method: 'GET', url: '/api/v1/supplier/warehouses' });
    assert.equal(resWh.statusCode, 200);
    assert.equal(resWh.json().data.length, 1);

    // 5. GET /api/v1/supplier/fulfilment
    const resFul = await app.inject({ method: 'GET', url: '/api/v1/supplier/fulfilment' });
    assert.equal(resFul.statusCode, 200);
    assert.equal(resFul.json().data.length, 1);
    assert.equal(resFul.json().data[0].items.length, 1);

    // 6. GET /api/v1/supplier/resellers
    const resReseller = await app.inject({ method: 'GET', url: '/api/v1/supplier/resellers' });
    assert.equal(resReseller.statusCode, 200);
    assert.equal(resReseller.json().data.top_salers.length, 1);

    // 7. GET & PATCH /api/v1/supplier/store-status
    const resGetStore = await app.inject({ method: 'GET', url: '/api/v1/supplier/store-status' });
    assert.equal(resGetStore.statusCode, 200);
    assert.equal(resGetStore.json().data.is_open, true);

    const resPatchStore = await app.inject({
      method: 'PATCH',
      url: '/api/v1/supplier/store-status',
      payload: { isOpen: false },
    });
    assert.equal(resPatchStore.statusCode, 200);
    assert.equal(resPatchStore.json().data.is_open, false);

    await app.close();
  });

});
