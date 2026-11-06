/**
 * launchConfig.test.js — the server can boot and run the launch configuration safely.
 *
 * At launch no MFS merchant, card gateway or courier API has signed (traceability row 131), so the
 * owner runs PAYMENT_DRIVER=none and COURIER_DRIVER=none in production. Here:
 * 1. The payments module imports in production. It used to build a MOCK gateway at import time,
 *    which throws in production, so every production boot crashed.
 * 2. PAYMENT_DRIVER=none offers no online method, the factory refuses every gateway, checkout
 *    refuses an online method before it touches the database, and top-up lists no methods.
 * 3. Shipments: public tracking carries no personal data and never matches a bare sub-order id;
 *    a label is only for the parcel's supplier or an admin; only a supplier books its own parcel;
 *    the mock courier never books a parcel in production.
 */

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  createPaymentGateway,
  onlineMethodsForDriver,
  ONLINE_METHODS,
} from '../src/integrations/payments/index.ts';
import { executeCheckout } from '../src/services/checkout.service.ts';
import * as walletTopup from '../src/services/walletTopup.service.ts';
import * as shipmentService from '../src/services/shipment.service.ts';

const norm = (sql) => String(sql).trim().replace(/\s+/g, ' ');
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

/** A pool whose client answers by matching SQL text, and records every query it saw. */
function fakePool(answer = () => ({ rows: [] })) {
  const seen = [];
  const client = {
    async query(sql, params = []) {
      seen.push({ sql: norm(sql), params });
      return answer(norm(sql), params);
    },
    release() {},
  };
  return { seen, ...client, async connect() { return client; } };
}

const ENV_KEYS = ['NODE_ENV', 'PAYMENT_DRIVER', 'COURIER_DRIVER', 'ALLOW_MOCK_DRIVERS_IN_PRODUCTION'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('1. the payments module imports in production', () => {
  test('importing it with NODE_ENV=production does not throw', () => {
    const entry = fileURLToPath(new URL('../src/integrations/payments/index.ts', import.meta.url));
    const res = spawnSync(process.execPath, ['-e', `import(${JSON.stringify('file:///' + entry.replace(/\\/g, '/'))}).then(() => console.log('IMPORTED'))`], {
      env: { ...process.env, NODE_ENV: 'production', PAYMENT_DRIVER: 'none', ALLOW_MOCK_DRIVERS_IN_PRODUCTION: 'false' },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /IMPORTED/);
  });

  test('nothing builds a gateway at import time any more', () => {
    assert.doesNotMatch(src('integrations/payments/index.ts'), /export const \w+ = createPaymentGateway\(/);
  });
});

describe('2. PAYMENT_DRIVER=none: cash on delivery and the vault only', () => {
  test('the online methods follow the driver', () => {
    assert.deepEqual(onlineMethodsForDriver('none'), []);
    assert.deepEqual(onlineMethodsForDriver('NONE'), []);
    assert.deepEqual(onlineMethodsForDriver('mock'), [...ONLINE_METHODS]);
    assert.deepEqual(onlineMethodsForDriver(undefined), [...ONLINE_METHODS]);
    // Rocket has no live driver, so a live deployment never offers it.
    assert.deepEqual(onlineMethodsForDriver('bkash'), ['BKASH', 'NAGAD', 'CARD']);
  });

  test('the factory refuses every gateway, in every environment', () => {
    process.env.PAYMENT_DRIVER = 'none';
    for (const env of ['development', 'production']) {
      process.env.NODE_ENV = env;
      for (const g of ['BKASH', 'NAGAD', 'SSLCOMMERZ', 'CARD', 'MOCK']) {
        assert.throws(() => createPaymentGateway(g), (e) => e.code === 'PAYMENT_METHOD_UNSUPPORTED', `${env} ${g}`);
      }
    }
  });

  test('checkout refuses an online method before any lock or insert', async () => {
    process.env.PAYMENT_DRIVER = 'none';
    for (const method of ONLINE_METHODS) {
      const pool = fakePool();
      await assert.rejects(
        executeCheckout(pool, null, { userId: 7, idempotencyKey: `k-${method}`, paymentMethod: method }),
        (e) => e.code === 'PAYMENT_METHOD_UNSUPPORTED'
      );
      // Only the idempotency replay lookup ran.
      assert.ok(pool.seen.every((q) => q.sql.startsWith('SELECT * FROM orders WHERE idempotency_key')), JSON.stringify(pool.seen));
    }
  });

  test('checkout still accepts cash on delivery and the vault past that point', async () => {
    process.env.PAYMENT_DRIVER = 'none';
    for (const method of ['COD', 'WALLET']) {
      const pool = fakePool();
      // An empty cart is the next refusal; reaching it proves the method was not refused.
      const err = await executeCheckout(pool, null, { userId: 7, idempotencyKey: `k-${method}`, paymentMethod: method }).catch((e) => e);
      assert.notEqual(err?.code, 'PAYMENT_METHOD_UNSUPPORTED', method);
    }
  });

  test('top-up lists no methods while no gateway is connected', async () => {
    process.env.PAYMENT_DRIVER = 'none';
    const rules = await walletTopup.loadRules(fakePool());
    assert.deepEqual(rules.methods, []);
    assert.throws(() => walletTopup.validateRequest({ amount: 500, method: 'BKASH' }, rules), (e) => e.code === 'PAYMENT_METHOD_UNSUPPORTED');

    process.env.PAYMENT_DRIVER = 'mock';
    assert.deepEqual((await walletTopup.loadRules(fakePool())).methods, ['BKASH', 'NAGAD', 'CARD']);
  });

  test('the public methods endpoint is registered', () => {
    assert.match(src('routes/payment.routes.ts'), /fastify\.get\('\/payments\/methods'/);
  });
});

describe('3. shipments', () => {
  const shipmentRow = {
    id: 5, carrier: 'MANUAL', courier_name: 'Sundarban', tracking_number: 'SB-1234', status: 'IN_TRANSIT',
    delivered_at: null, created_at: '2026-11-01T00:00:00Z', sub_order_status: 'SHIPPED',
    recipient_name: 'Rahima', recipient_phone: '+8801711111111', delivery_address_json: { district: 'Dhaka' },
    cod_amount: '990.00', current_latitude: '23.8', current_longitude: '90.4',
  };

  test('public tracking matches the tracking number only and carries no personal data', async () => {
    const pool = fakePool((sql) => {
      if (sql.includes('FROM shipments s')) return { rows: [shipmentRow] };
      if (sql.includes('FROM shipment_events')) return { rows: [{ normalized_status: 'IN_TRANSIT', carrier_status: 'X', location: 'Hub', note: 'Call +8801711111111', latitude: 1, longitude: 2, created_at: 'now' }] };
      return { rows: [] };
    });
    const out = await shipmentService.getPublicShipmentTracking(pool, 'SB-1234');
    const text = JSON.stringify(out);
    for (const secret of ['Rahima', '+8801711111111', 'Dhaka', '990.00', '23.8', '90.4']) {
      assert.ok(!text.includes(secret), `leaked ${secret}`);
    }
    assert.equal(out.shipment.tracking_number, 'SB-1234');
    assert.equal(out.events[0].location, 'Hub');

    const lookup = pool.seen.find((q) => q.sql.includes('FROM shipments s'));
    assert.doesNotMatch(lookup.sql, /sub_order_id = \$/);
    assert.deepEqual(lookup.params, ['SB-1234']);
    assert.doesNotMatch(lookup.sql, /recipient_|delivery_address|cod_amount|latitude/);
  });

  test('an empty tracking number finds nothing', async () => {
    const pool = fakePool();
    assert.equal(await shipmentService.getPublicShipmentTracking(pool, '  '), null);
    assert.equal(pool.seen.length, 0);
  });

  test('the public route uses the public view', () => {
    const ctrl = src('controllers/courierWebhook.controller.ts');
    assert.match(ctrl, /getPublicShipmentTracking\(/);
    assert.doesNotMatch(ctrl, /getShipmentTracking\(/);
  });

  const owned = (supplierId) => fakePool((sql) => (sql.includes('FROM shipments s') ? { rows: [{ supplier_id: supplierId }] } : { rows: [] }));

  test('a label is for the parcel supplier or an admin, NOT_FOUND for anyone else', async () => {
    await shipmentService.assertCanReadShipment(owned(42), 5, { id: 42, roles: ['supplier'] });
    await shipmentService.assertCanReadShipment(owned(42), 5, { id: 1, roles: ['admin'] });
    await shipmentService.assertCanReadShipment(owned(42), 5, { id: 1, roles: ['super_admin'] });
    await assert.rejects(shipmentService.assertCanReadShipment(owned(42), 5, { id: 43, roles: ['supplier'] }), (e) => e.code === 'NOT_FOUND');
    await assert.rejects(shipmentService.assertCanReadShipment(owned(42), 5, { id: 9, roles: ['customer'] }), (e) => e.code === 'NOT_FOUND');
    await assert.rejects(shipmentService.assertCanReadShipment(fakePool(), 5, { id: 1, roles: ['admin'] }), (e) => e.code === 'NOT_FOUND');
  });

  test('a supplier books only its own sub-order', async () => {
    const pool = fakePool((sql, params) => (sql.startsWith('SELECT id FROM sub_orders') && params[1] === 42 ? { rows: [{ id: params[0] }] } : { rows: [] }));
    await shipmentService.assertOwnSubOrder(pool, 77, 42);
    await assert.rejects(shipmentService.assertOwnSubOrder(pool, 77, 43), (e) => e.code === 'NOT_FOUND');
  });

  test('the label and create routes are guarded by module and permission', () => {
    const routes = src('routes/logistics.routes.ts');
    assert.match(routes, /preHandler: \[app\.authenticate, reqModule\('courier_hub'\), reqPerm\('logistics\.shipment\.view'\)\]/);
    assert.match(routes, /preHandler: \[app\.authenticate, reqModule\('courier_hub'\), reqPerm\('logistics\.consignment\.create'\)\]/);
    const ctrl = src('controllers/courierWebhook.controller.ts');
    assert.match(ctrl, /assertCanReadShipment\(/);
    assert.match(ctrl, /assertOwnSubOrder\(/);
    assert.match(ctrl, /courierMode === 'MANUAL'/);
  });

  test('the mock courier never books a parcel in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.COURIER_DRIVER = 'none';
    delete process.env.ALLOW_MOCK_DRIVERS_IN_PRODUCTION;
    const pool = fakePool((sql) => {
      if (sql.includes('FROM sub_orders s')) {
        return { rows: [{ id: 77, order_id: 1, ref: 'SUB-77', supplier_id: 42, total_amount: '990.00', status: 'CONFIRMED', payment_method: 'COD', recipient_name: 'R', recipient_phone: 'P', delivery_address_json: { district: 'Dhaka' } }] };
      }
      return { rows: [] };
    });
    await assert.rejects(shipmentService.createShipmentForSubOrder(pool, { subOrderId: 77, requestedBy: 42 }), (e) => e.code === 'CONFLICT');
    assert.ok(!pool.seen.some((q) => q.sql.startsWith('INSERT INTO shipments')));

    assert.equal(shipmentService.mockCourierRefused({ NODE_ENV: 'production' }), true);
    assert.equal(shipmentService.mockCourierRefused({ NODE_ENV: 'production', ALLOW_MOCK_DRIVERS_IN_PRODUCTION: 'true' }), false);
    assert.equal(shipmentService.mockCourierRefused({ NODE_ENV: 'development' }), false);
  });
});
