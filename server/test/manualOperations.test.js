/**
 * manualOperations.test.js — running parcels and the mode switches by hand (migration 097).
 *
 * Manual payouts are tested in payoutEngine.test.js, against that file's full in-memory ledger.
 * Here:
 * 1. The modes are strict, default to MANUAL, and a save is reasoned and audited.
 * 2. A hand-sent parcel is recorded once, only by its own supplier, with a tracking number nobody
 *    else holds.
 * 3. Marking it DELIVERED runs the same lifecycle as a courier webhook (escrow, sub-order status),
 *    a closed or courier-booked parcel cannot be marked, and the webhook leaves MANUAL parcels alone.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as manualOps from '../src/services/manualOperations.service.ts';
import * as shipmentService from '../src/services/shipment.service.ts';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const norm = (sql) => String(sql).trim().replace(/\s+/g, ' ');

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

const ran = (pool, fragment) => pool.seen.some((q) => q.sql.includes(fragment));

describe('1. the payout / courier modes', () => {
  test('MANUAL is the shipped default, and a missing row reads as MANUAL', async () => {
    assert.deepEqual({ ...manualOps.DEFAULT_MODES }, { payout_mode: 'MANUAL', courier_mode: 'MANUAL' });
    const modes = await manualOps.getModes(fakePool(), null);
    assert.equal(modes.payout_mode, 'MANUAL');
    assert.equal(modes.courier_mode, 'MANUAL');
  });

  test('an unknown value in the stored row falls back to MANUAL, never to the gateway', async () => {
    const pool = fakePool((sql) => (sql.includes('FROM platform_settings')
      ? { rows: [{ key: 'operations.modes', value_json: { payout_mode: 'gateway', courier_mode: 'X' } }] }
      : { rows: [] }));
    const modes = await manualOps.getModes(pool, null);
    assert.equal(modes.payout_mode, 'MANUAL');
    assert.equal(modes.courier_mode, 'MANUAL');
  });

  test('writes are strict: an unknown mode is refused, not coerced', () => {
    assert.throws(() => manualOps.validateModes({ payout_mode: 'AUTO', courier_mode: 'MANUAL' }), (e) => e.code === 'VALIDATION_FAILED');
    assert.throws(() => manualOps.validateModes({ payout_mode: 'MANUAL', courier_mode: 'GATEWAY' }), (e) => e.code === 'VALIDATION_FAILED');
    assert.deepEqual(manualOps.validateModes({ payout_mode: 'GATEWAY', courier_mode: 'INTEGRATED' }), { payout_mode: 'GATEWAY', courier_mode: 'INTEGRATED' });
  });

  test('a save needs a reason and writes an audit row with before and after', async () => {
    let stored = null;
    const pool = fakePool((sql, params) => {
      if (sql.startsWith('INSERT INTO platform_settings')) {
        stored = JSON.parse(params[1]);
        return { rows: [] };
      }
      if (sql.includes('FROM platform_settings WHERE key = $1')) {
        return { rows: stored ? [{ key: 'operations.modes', value_json: stored }] : [] };
      }
      return { rows: [] };
    });
    const audits = [];
    const auditService = { async record(_db, row) { audits.push(row); } };

    await assert.rejects(
      () => manualOps.updateModes(pool, null, auditService, { modes: { payout_mode: 'GATEWAY', courier_mode: 'MANUAL' }, reason: 'short', userId: 1 }),
      (e) => e.code === 'VALIDATION_FAILED'
    );
    assert.equal(stored, null);

    const after = await manualOps.updateModes(pool, null, auditService, {
      modes: { payout_mode: 'GATEWAY', courier_mode: 'MANUAL' },
      reason: 'bKash merchant account is live now',
      userId: 1,
    });
    assert.equal(after.payout_mode, 'GATEWAY');
    assert.equal(audits.length, 1);
    assert.deepEqual(audits[0].beforeJson, { payout_mode: 'MANUAL', courier_mode: 'MANUAL' });
    assert.deepEqual(audits[0].afterJson, { payout_mode: 'GATEWAY', courier_mode: 'MANUAL' });
    assert.equal(audits[0].riskTier, 'CRITICAL');
    assert.ok(ran(pool, 'FOR UPDATE'), 'the settings group is locked for the read-modify-write');
  });

  test('the gateway payout routes refuse in MANUAL mode and pass in GATEWAY mode', async () => {
    await assert.rejects(() => manualOps.assertGatewayPayoutsAllowed(fakePool(), null), (e) => e.code === 'MANUAL_PAYOUT_MODE' && e.statusCode === 409);
    const gateway = fakePool((sql) => (sql.includes('FROM platform_settings')
      ? { rows: [{ value_json: { payout_mode: 'GATEWAY', courier_mode: 'MANUAL' } }] }
      : { rows: [] }));
    await manualOps.assertGatewayPayoutsAllowed(gateway, null);
  });
});

const SUB_ORDER = {
  id: 77, ref: 'SO-77', supplier_id: 101, status: 'CONFIRMED', total_amount: '1250.00', shipping_amount: '60.00',
  recipient_name: 'Nusrat', recipient_phone: '+8801711000000', payment_method: 'COD',
  delivery_address_json: { district: 'Dhaka' },
};

describe('2. recording a hand-sent parcel', () => {
  function shipPool({ subOrder = SUB_ORDER, existing = [], insertError = null } = {}) {
    return fakePool((sql, params) => {
      if (sql.includes('FROM sub_orders s JOIN orders o')) {
        // The query filters by supplier when one is passed, as the SQL does.
        return { rows: subOrder && (params[1] == null || Number(params[1]) === subOrder.supplier_id) ? [subOrder] : [] };
      }
      if (sql.startsWith('SELECT tracking_number FROM shipments')) return { rows: existing };
      if (sql.startsWith('INSERT INTO shipments')) {
        if (insertError) throw insertError;
        return { rows: [{ id: 5, ref: params[0], carrier: 'MANUAL', courier_name: params[2], tracking_number: params[3], status: 'IN_TRANSIT' }] };
      }
      return { rows: [] };
    });
  }

  test('it becomes a MANUAL, IN_TRANSIT shipment with the courier name, and the sub-order SHIPPED', async () => {
    const pool = shipPool();
    const res = await manualOps.bookManualShipment(pool, {
      subOrderId: 77, supplierId: 101, courierName: ' Sundarban Courier ', trackingNumber: 'SB-12345', actorId: 101,
    });
    assert.equal(res.shipment.carrier, 'MANUAL');
    assert.equal(res.shipment.courier_name, 'Sundarban Courier');
    const insert = pool.seen.find((q) => q.sql.startsWith('INSERT INTO shipments'));
    assert.equal(insert.params[7], '1250.00', 'a COD parcel carries the sub-order total as cash to collect');
    assert.ok(ran(pool, "UPDATE sub_orders SET status = 'SHIPPED'"));
    assert.ok(ran(pool, 'INSERT INTO audit_logs'), 'the action is audited');
  });

  test("another supplier's parcel answers NOT_FOUND, and nothing is written", async () => {
    const pool = shipPool();
    await assert.rejects(
      () => manualOps.bookManualShipment(pool, { subOrderId: 77, supplierId: 999, courierName: 'Sundarban', trackingNumber: 'SB-1', actorId: 999 }),
      (e) => e.code === 'NOT_FOUND'
    );
    assert.ok(!ran(pool, 'INSERT INTO shipments'));
  });

  test('a parcel already sent cannot be sent again', async () => {
    await assert.rejects(
      () => manualOps.bookManualShipment(shipPool({ existing: [{ tracking_number: 'SB-1' }] }), { subOrderId: 77, supplierId: 101, courierName: 'Sundarban', trackingNumber: 'SB-2', actorId: 101 }),
      (e) => e.code === 'ALREADY_SHIPPED'
    );
    await assert.rejects(
      () => manualOps.bookManualShipment(shipPool({ subOrder: { ...SUB_ORDER, status: 'DELIVERED' } }), { subOrderId: 77, supplierId: 101, courierName: 'Sundarban', trackingNumber: 'SB-2', actorId: 101 }),
      (e) => e.code === 'ALREADY_SHIPPED'
    );
  });

  test('a tracking number another parcel holds is a 409 the supplier can act on, not a 500', async () => {
    const clash = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'shipments_tracking_number_key' });
    await assert.rejects(
      () => manualOps.bookManualShipment(shipPool({ insertError: clash }), { subOrderId: 77, supplierId: 101, courierName: 'Sundarban', trackingNumber: 'SB-9', actorId: 101 }),
      (e) => e.code === 'TRACKING_NUMBER_TAKEN' && e.statusCode === 409
    );
  });

  test('blank courier or tracking number is refused before the database is touched', async () => {
    const pool = shipPool();
    await assert.rejects(
      () => manualOps.bookManualShipment(pool, { subOrderId: 77, supplierId: 101, courierName: ' ', trackingNumber: 'SB-1', actorId: 101 }),
      (e) => e.code === 'VALIDATION_FAILED'
    );
    assert.equal(pool.seen.length, 0);
  });
});

describe('3. marking a hand-sent parcel delivered or returned', () => {
  const SHIPMENT = { id: 5, ref: 'SHP-5', sub_order_id: 77, carrier: 'MANUAL', tracking_number: 'SB-12345', status: 'IN_TRANSIT', sub_order_status: 'SHIPPED' };

  function statusPool(shipment = SHIPMENT, supplierId = 101) {
    return fakePool((sql, params) => {
      if (sql.includes('FROM shipments s JOIN sub_orders so')) {
        return { rows: shipment && (params[1] == null || Number(params[1]) === supplierId) ? [shipment] : [] };
      }
      return { rows: [] };
    });
  }

  test('DELIVERED runs the courier-webhook lifecycle: event, shipment, sub-order and escrow', async () => {
    const pool = statusPool();
    const res = await manualOps.updateManualShipmentStatus(pool, null, { shipmentId: 5, supplierId: 101, status: 'DELIVERED', actorId: 101 });
    assert.equal(res.isDelivered, true);
    assert.ok(ran(pool, 'INSERT INTO shipment_events'));
    assert.ok(ran(pool, 'UPDATE shipments SET status = $2'));
    assert.ok(ran(pool, "UPDATE sub_orders SET status = 'DELIVERED'"));
    // depositToEscrow starts by locking the sub-order it escrows; the fake db has no such row, so it
    // stops there, but the call proves the delivery path reached escrow, as the webhook does.
    assert.ok(pool.seen.some((q) => q.sql.includes('escrow') || q.sql.includes('EXTERNAL_CLEARING')), 'escrow was started');
  });

  test('RETURNED restores stock instead', async () => {
    // A COD parcel that never arrived has a sub-order but no escrow yet: the clawback finds nothing
    // to take back (ESCROW_NOT_FOUND), which applyShipmentEvent treats as done.
    const pool = fakePool((sql, params) => {
      if (sql.includes('FROM shipments s JOIN sub_orders so')) return { rows: [SHIPMENT] };
      if (sql.includes('FROM sub_orders s') && sql.includes('WHERE s.id = $1')) return { rows: [{ id: 77, ref: 'SO-77', status: 'RETURNED' }] };
      if (sql.startsWith('SELECT product_id, qty AS quantity FROM order_items')) return { rows: [{ product_id: 9, quantity: 2 }] };
      return { rows: [] };
    });
    const res = await manualOps.updateManualShipmentStatus(pool, null, { shipmentId: 5, supplierId: 101, status: 'RETURNED', actorId: 101 });
    assert.equal(res.isReturned, true);
    assert.ok(ran(pool, "UPDATE sub_orders SET status = 'RETURNED'"));
    assert.ok(pool.seen.some((q) => q.sql.includes('UPDATE products SET stock_qty = stock_qty + $2') && q.params[1] === 2), 'the stock is put back');
    assert.ok(!ran(pool, "UPDATE sub_orders SET status = 'DELIVERED'"));
  });

  test('only DELIVERED and RETURNED are accepted', async () => {
    await assert.rejects(
      () => manualOps.updateManualShipmentStatus(statusPool(), null, { shipmentId: 5, supplierId: 101, status: 'IN_TRANSIT', actorId: 101 }),
      (e) => e.code === 'VALIDATION_FAILED'
    );
  });

  test('a closed parcel, a courier-booked parcel and another supplier\'s parcel are refused', async () => {
    await assert.rejects(
      () => manualOps.updateManualShipmentStatus(statusPool({ ...SHIPMENT, status: 'DELIVERED' }), null, { shipmentId: 5, supplierId: 101, status: 'RETURNED', actorId: 101 }),
      (e) => e.code === 'SHIPMENT_CLOSED'
    );
    const courier = statusPool({ ...SHIPMENT, carrier: 'PATHAO' });
    await assert.rejects(
      () => manualOps.updateManualShipmentStatus(courier, null, { shipmentId: 5, supplierId: 101, status: 'DELIVERED', actorId: 101 }),
      (e) => e.code === 'CONFLICT'
    );
    assert.ok(!ran(courier, 'INSERT INTO shipment_events'));
    await assert.rejects(
      () => manualOps.updateManualShipmentStatus(statusPool(SHIPMENT, 101), null, { shipmentId: 5, supplierId: 999, status: 'DELIVERED', actorId: 999 }),
      (e) => e.code === 'NOT_FOUND'
    );
  });

  test('a courier webhook never moves a MANUAL parcel', async () => {
    const pool = fakePool((sql) => {
      if (sql.includes('FROM shipments s JOIN sub_orders so')) return { rows: [SHIPMENT] };
      return { rows: [] };
    });
    const res = await shipmentService.handleCourierWebhook(pool, null, {
      carrier: 'MOCK',
      payload: { tracking_number: 'SB-12345', status: 'delivered', event_id: 'evt-1' },
      client: pool,
    });
    assert.equal(res.unmatched, true);
    assert.ok(!ran(pool, 'INSERT INTO shipment_events'));
  });

  test('the webhook and the manual path share one lifecycle function', () => {
    assert.match(src('services/shipment.service.ts'), /export async function applyShipmentEvent\(/);
    assert.match(src('services/shipment.service.ts'), /await applyShipmentEvent\(txClient, shipment, normalized\)/);
    assert.match(src('services/manualOperations.service.ts'), /await applyShipmentEvent\(txClient, shipment, \{/);
    assert.match(src('services/payout.service.ts'), /const updated = await settleDisbursedPayout\(txClient, \{/);
    assert.match(src('services/manualOperations.service.ts'), /await settleDisbursedPayout\(txClient, \{/);
  });
});
