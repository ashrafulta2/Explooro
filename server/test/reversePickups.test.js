/**
 * reversePickups.test.js — return and warranty pickups with couriers INTEGRATED (migration 105).
 *
 * 1. A reverse parcel is stored in reverse_pickups, never in shipments.
 * 2. Its courier events move only the pickup: no sub-order, escrow, stock or warranty change.
 * 3. A return pickup goes to the returns address an admin set, never to an address in the code,
 *    and is refused while that address is empty.
 * 4. A warranty pickup goes to the supplier's own warehouse, else the returns address; a failed
 *    booking still keeps the approval.
 * 5. The returns address is validated, reasoned, stale-checked and audited.
 */

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as reversePickups from '../src/services/reversePickup.service.ts';
import { handleCourierWebhook } from '../src/services/shipment.service.ts';
import { reviewReturnRequest } from '../src/services/return.service.ts';
import { reviewWarrantyClaim } from '../src/services/warranty.service.ts';
import { getCourierAdapter } from '../src/integrations/courier/index.ts';

const norm = (sql) => String(sql).trim().replace(/\s+/g, ' ');
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const ENV_KEYS = ['NODE_ENV', 'COURIER_DRIVER'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const ADDRESS = {
  name: 'Returns Desk', phone: '+8801711000000', division: 'dhaka', district: 'dhaka_city',
  upazila: 'Tejgaon', address_line: 'House 1, Road 2',
};
const EMPTY = { name: '', phone: '', division: '', district: '', upazila: '', address_line: '' };

/**
 * A db answering by SQL text and recording every query. `returnAddress` is the stored
 * operations.return_address value; couriers are INTEGRATED.
 */
function fakeDb({ returnAddress = ADDRESS, answer = null } = {}) {
  const seen = [];
  let nextPickupId = 900;
  const run = async (sql, params = []) => {
    const q = norm(sql);
    seen.push({ sql: q, params });
    const custom = answer ? answer(q, params) : null;
    if (custom) return custom;
    if (q.includes('FROM platform_settings') && params[0] === 'operations.modes') {
      return { rows: [{ key: 'operations.modes', value_json: { payout_mode: 'MANUAL', courier_mode: 'INTEGRATED' } }] };
    }
    if (q.includes('FROM platform_settings') && params[0] === 'operations.return_address') {
      return { rows: returnAddress ? [{ key: 'operations.return_address', value_json: returnAddress, updated_at: null }] : [] };
    }
    if (q.startsWith('INSERT INTO reverse_pickups')) {
      return { rows: [{ id: nextPickupId++, ref: params[0], kind: params[1], carrier: params[4], tracking_number: params[5], courier_consignment_id: params[6], status: 'PENDING' }] };
    }
    if (q.includes('u.locale')) return { rows: [{ id: params[0], full_name: 'T', locale: 'en' }] };
    return { rows: [] };
  };
  const db = { seen, query: run, async connect() { return { query: run, release() {} }; } };
  return db;
}

const inserted = (db, table) => db.seen.filter((s) => s.sql.startsWith(`INSERT INTO ${table}`));

describe('returns address (configuration, not code)', () => {
  test('a valid address is normalised; the district must belong to the division', () => {
    const ok = reversePickups.validateReturnAddress({ ...ADDRESS, phone: '01711000000', name: '  Returns Desk ' });
    assert.equal(ok.phone, '+8801711000000');
    assert.equal(ok.name, 'Returns Desk');
    assert.throws(() => reversePickups.validateReturnAddress({ ...ADDRESS, district: 'sylhet_city' }), (e) => e.details?.field === 'district');
    assert.throws(() => reversePickups.validateReturnAddress({ ...ADDRESS, division: 'atlantis' }), (e) => e.details?.field === 'division');
    assert.throws(() => reversePickups.validateReturnAddress({ ...ADDRESS, phone: '12345' }), (e) => e.details?.field === 'phone');
    assert.throws(() => reversePickups.validateReturnAddress({ ...ADDRESS, address_line: 'x' }), (e) => e.details?.field === 'address_line');
    assert.equal(reversePickups.validateReturnAddress({ ...ADDRESS, upazila: '' }).upazila, '', 'the area is optional');
  });

  test('an empty address lists every required field and refuses a courier destination', async () => {
    assert.deepEqual(reversePickups.missingReturnAddressFields(EMPTY), ['name', 'phone', 'division', 'district', 'address_line']);
    await assert.rejects(
      reversePickups.requireReturnDestination(fakeDb({ returnAddress: EMPTY })),
      (e) => e.code === 'CONFLICT' && e.details?.reason === 'RETURN_ADDRESS_MISSING'
    );
    await assert.rejects(reversePickups.requireReturnDestination(fakeDb({ returnAddress: null })), (e) => e.code === 'CONFLICT');
  });

  test('migration 105 seeds it empty, so no parcel is ever booked to an invented address', () => {
    const sql = readFileSync(new URL('../src/db/migrations/105_reverse_pickups.sql', import.meta.url), 'utf8');
    assert.match(sql, /'operations\.return_address',\s*'\{"name": "", "phone": "", "division": "", "district": "", "upazila": "", "address_line": ""\}'::jsonb/);
    assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
  });

  test('saving needs a reason, writes a CRITICAL audit row and refuses a stale form', async () => {
    const audits = [];
    const auditService = { async record(_db, row) { audits.push(row); } };
    const db = fakeDb({ returnAddress: EMPTY });
    await assert.rejects(
      reversePickups.updateReturnAddress(db, auditService, { address: ADDRESS, reason: 'short', userId: 1 }),
      (e) => e.details?.field === 'reason'
    );
    const saved = await reversePickups.updateReturnAddress(db, auditService, { address: ADDRESS, reason: 'Opened the Tejgaon returns desk', userId: 1 });
    assert.ok(db.seen.some((s) => s.sql.includes('WHERE group_key = $1') && s.sql.endsWith('FOR UPDATE') && s.params[0] === 'operations'),
      'the operations settings group is locked');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'platform.operations.return_address.update');
    assert.equal(audits[0].riskTier, 'CRITICAL');
    assert.equal(audits[0].beforeJson.name, '');
    assert.ok(saved);

    const stale = fakeDb({ answer: (q, p) => (q.includes('FROM platform_settings') && p[0] === 'operations.return_address'
      ? { rows: [{ value_json: ADDRESS, updated_at: new Date('2026-11-06T10:00:00Z') }] } : null) });
    await assert.rejects(
      reversePickups.updateReturnAddress(stale, auditService, { address: ADDRESS, reason: 'Moved to a bigger warehouse', baseUpdatedAt: null, userId: 1 }),
      (e) => e.code === 'PRECONDITION_CHANGED'
    );
  });
});

describe('return pickups', () => {
  const returnRow = (q) => (q.includes('FROM return_requests r')
    ? { rows: [{
      id: 5, ref: 'RET-5', status: 'REQUESTED', sub_order_ref: 'SUB-1', supplier_id: 42,
      recipient_name: 'Sadia Rahman', recipient_phone: '+8801712345678',
      delivery_address_json: { division: 'chittagong', district: 'cumilla', address_line: 'Kandirpar 3' },
    }] }
    : null);

  test('with the address empty the approval is refused and nothing is booked', async () => {
    process.env.COURIER_DRIVER = 'mock';
    const db = fakeDb({ returnAddress: EMPTY, answer: returnRow });
    await assert.rejects(
      reviewReturnRequest(db, null, { returnRequestId: 5, action: 'APPROVE', reviewedBy: 1, client: db }),
      (e) => e.details?.reason === 'RETURN_ADDRESS_MISSING'
    );
    assert.equal(inserted(db, 'reverse_pickups').length, 0);
    assert.equal(db.seen.some((s) => s.sql.startsWith('UPDATE return_requests')), false);
  });

  test('a courier collects from the customer and delivers to the returns address', async () => {
    process.env.COURIER_DRIVER = 'mock';
    const db = fakeDb({ answer: returnRow });
    const res = await reviewReturnRequest(db, null, { returnRequestId: 5, action: 'APPROVE', reviewedBy: 1, client: db });
    assert.equal(res.status, 'PICKUP_SCHEDULED');
    assert.match(res.reverseTrackingNumber, /^TRK-MOCK-/);

    const [ins] = inserted(db, 'reverse_pickups');
    assert.ok(ins, 'stored as a reverse pickup');
    assert.equal(ins.params[1], 'RETURN');
    assert.equal(ins.params[2], 5, 'linked to the return request');
    assert.equal(ins.params[7], 'Sadia Rahman', 'picked up from the customer');
    assert.equal(JSON.parse(ins.params[9]).district, 'cumilla');
    assert.equal(ins.params[10], 'Returns Desk', 'delivered to the configured address');
    assert.equal(JSON.parse(ins.params[12]).address_line, 'House 1, Road 2');
    assert.equal(inserted(db, 'shipments').length, 0, 'never a forward shipment');

    const update = db.seen.find((s) => s.sql.startsWith('UPDATE return_requests'));
    assert.match(update.sql, /reverse_pickup_id = \$5/);
    assert.equal(update.params[4], 900);
  });

  test('no warehouse name, phone or address is written in the return code any more', () => {
    const src = read('services/return.service.ts');
    for (const literal of ['Explooro Returns Warehouse', '+8801700000000', 'Tejgaon Industrial Area']) {
      assert.equal(src.includes(literal), false, `return.service still contains "${literal}"`);
    }
  });
});

describe('a return the customer sends back themselves (couriers MANUAL)', () => {
  const approvedManual = { id: 5, ref: 'RET-5', status: 'PICKUP_SCHEDULED', reverse_carrier: 'MANUAL' };

  test('an approved manual return carries the returns address, and only that one', async () => {
    const rows = [
      approvedManual,
      { id: 6, ref: 'RET-6', status: 'REQUESTED', reverse_carrier: null },
      { id: 7, ref: 'RET-7', status: 'PICKUP_SCHEDULED', reverse_carrier: 'MOCK' },
      { id: 8, ref: 'RET-8', status: 'RECEIVED', reverse_carrier: 'MANUAL' },
    ];
    const out = await reversePickups.withSendBackAddress(fakeDb(), rows);
    assert.deepEqual(out[0].send_back, {
      name: 'Returns Desk', phone: '+8801711000000', division: 'dhaka', district: 'dhaka_city', upazila: 'Tejgaon', address_line: 'House 1, Road 2',
    });
    for (const r of out.slice(1)) assert.equal('send_back' in r, false, `${r.ref} must not carry an address`);
  });

  test('while the address is empty it is null, so the page says staff will call', async () => {
    const [r] = await reversePickups.withSendBackAddress(fakeDb({ returnAddress: EMPTY }), [approvedManual]);
    assert.equal(r.send_back, null);
  });

  test('no query at all when no return needs it', async () => {
    const db = fakeDb();
    await reversePickups.withSendBackAddress(db, [{ id: 6, status: 'REQUESTED' }]);
    assert.equal(db.seen.length, 0);
  });

  test('the customer returns list uses it', () => {
    assert.match(read('controllers/return.controller.ts'), /await reversePickupService\.withSendBackAddress\(req\.server\.db, rows\)/);
  });
});

describe('warranty pickups', () => {
  const claimRow = (q) => (q.includes('SELECT c.*, wc.supplier_id') && q.includes('FOR UPDATE')
    ? { rows: [{
      id: 10, ref: 'CLM-10', warranty_card_id: 1, supplier_id: 9, customer_id: 3, sub_order_id: 501,
      status: 'SUBMITTED', recipient_name: 'Sadia Rahman', recipient_phone: '+8801712345678',
      delivery_address_json: { division: 'dhaka', district: 'dhaka_city', address_line: 'Dhanmondi 27' },
    }] }
    : null);

  test('with no supplier warehouse the item goes to the returns address', async () => {
    process.env.COURIER_DRIVER = 'mock';
    const db = fakeDb({ answer: claimRow });
    const res = await reviewWarrantyClaim(db, { claimId: 10, supplierId: 9, action: 'APPROVE', resolution: 'REPAIR', client: db });
    assert.equal(res.status, 'APPROVED');
    const [ins] = inserted(db, 'reverse_pickups');
    assert.equal(ins.params[1], 'WARRANTY');
    assert.equal(ins.params[3], 10, 'linked to the claim');
    assert.equal(ins.params[10], 'Returns Desk');
    assert.equal(inserted(db, 'shipments').length, 0);
  });

  test('with nowhere to send it the booking is skipped but the approval stands', async () => {
    process.env.COURIER_DRIVER = 'mock';
    const db = fakeDb({ returnAddress: EMPTY, answer: claimRow });
    const res = await reviewWarrantyClaim(db, { claimId: 10, supplierId: 9, action: 'APPROVE', resolution: 'REPLACE', client: db });
    assert.equal(res.status, 'APPROVED');
    assert.equal(res.reversePickupId, null);
    assert.ok(db.seen.some((s) => s.sql === 'ROLLBACK TO SAVEPOINT warranty_reverse_pickup'));
    const update = db.seen.find((s) => s.sql.startsWith("UPDATE warranty_claims SET status = 'APPROVED'"));
    assert.ok(update, 'the claim is still approved');
  });

  test('the warranty code no longer writes reverse parcels into shipments', () => {
    const src = read('services/warranty.service.ts');
    assert.equal(src.includes('INSERT INTO shipments'), false);
    assert.match(src, /reverse_pickup_id = \$3/);
  });
});

describe('courier webhooks for reverse parcels', () => {
  const pickupRow = (status = 'IN_TRANSIT') => ({
    id: 900, ref: 'REV-RET-5-ABC', kind: 'RETURN', return_request_id: 5, warranty_claim_id: null,
    carrier: 'MOCK', tracking_number: 'TRK-MOCK-REV1', status, delivered_at: null,
  });

  async function deliver(db, eventId = 'evt-rev-1', status = 'DELIVERED') {
    process.env.NODE_ENV = 'test';
    process.env.COURIER_DRIVER = 'mock';
    return handleCourierWebhook(db, null, {
      carrier: 'MOCK',
      payload: { event_id: eventId, tracking_number: 'TRK-MOCK-REV1', status },
      client: db,
    });
  }

  test('DELIVERED moves only the pickup: no sub-order, escrow, stock or warranty change', async () => {
    const db = fakeDb({ answer: (q) => (q.includes('FROM reverse_pickups') ? { rows: [pickupRow()] } : null) });
    const res = await deliver(db);
    assert.equal(res.reversePickup, true);
    assert.equal(res.currentStatus, 'DELIVERED');
    assert.equal(res.isDelivered, false, 'so no referral is credited after the transaction');

    assert.equal(inserted(db, 'reverse_pickup_events').length, 1);
    const upd = db.seen.find((s) => s.sql.startsWith('UPDATE reverse_pickups'));
    assert.equal(upd.params[1], 'DELIVERED');
    for (const forbidden of ['UPDATE sub_orders', 'FROM shipments s', 'INSERT INTO shipment_events', 'escrow', 'UPDATE products', 'INSERT INTO warranty_cards']) {
      assert.equal(db.seen.some((s) => s.sql.includes(forbidden)), false, `a reverse parcel ran "${forbidden}"`);
    }
  });

  test('the lookup is scoped to the carrier that sent the event', async () => {
    const db = fakeDb();
    await deliver(db);
    const lookup = db.seen.find((s) => s.sql.includes('FROM reverse_pickups'));
    assert.match(lookup.sql, /WHERE carrier = \$1/);
    assert.equal(lookup.params[0], 'MOCK');
  });

  test('a replayed event is recorded once', async () => {
    const db = fakeDb({ answer: (q) => {
      if (q.includes('FROM reverse_pickups')) return { rows: [pickupRow()] };
      if (q.includes('FROM reverse_pickup_events WHERE event_id')) return { rows: [{ id: 1 }] };
      return null;
    } });
    const res = await deliver(db);
    assert.equal(res.duplicate, true);
    assert.equal(inserted(db, 'reverse_pickup_events').length, 0);
    assert.equal(db.seen.some((s) => s.sql.startsWith('UPDATE reverse_pickups')), false);
  });

  test('a late event does not reopen a pickup that has arrived', async () => {
    const db = fakeDb({ answer: (q) => (q.includes('FROM reverse_pickups') ? { rows: [pickupRow('DELIVERED')] } : null) });
    const res = await deliver(db, 'evt-late', 'IN_TRANSIT');
    assert.equal(res.currentStatus, 'DELIVERED');
    assert.equal(inserted(db, 'reverse_pickup_events').length, 1, 'still recorded');
    assert.equal(db.seen.some((s) => s.sql.startsWith('UPDATE reverse_pickups')), false);
  });

  test('a forward parcel still runs the normal lifecycle when no reverse pickup matches', async () => {
    const db = fakeDb();
    const res = await deliver(db, 'evt-fwd');
    assert.equal(res.unmatched, true, 'no shipment either, in this fake');
    assert.ok(db.seen.some((s) => s.sql.includes('FROM shipments s')), 'the shipments lookup still runs');
  });
});

describe('courier adapters', () => {
  test('every carrier can book a return pickup', async () => {
    for (const key of ['MOCK', 'STEADFAST', 'PATHAO', 'REDX']) {
      const adapter = getCourierAdapter(key);
      assert.equal(typeof adapter.createReturnPickup, 'function', key);
      const booked = await adapter.createReturnPickup({
        ref: 'REV-1', pickupName: 'A', pickupPhone: '+8801712345678', pickupAddress: { district: 'cumilla' },
        recipientName: 'Returns Desk', recipientPhone: '+8801711000000', deliveryAddress: { district: 'dhaka_city' },
      });
      assert.ok(booked.trackingNumber, `${key} returns a tracking number`);
      assert.equal(Number(booked.codAmount ?? 0), 0, `${key} collects no cash on a pickup`);
    }
  });
});
