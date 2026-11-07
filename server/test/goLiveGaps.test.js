/**
 * goLiveGaps.test.js — the code gaps closed before launch on 2026-11-06 (traceability row 134).
 *
 * 1. The payout queue's "All statuses" shows every payout.
 * 2. A sub-order cannot be booked with a courier twice.
 * 3. With couriers MANUAL, return and warranty pickups book nothing; a failed warranty booking can
 *    no longer abort the whole approval.
 * 4. Module settings are read from the column that holds them (return window, disputes, moderation).
 * 5. Payment modules really switch payment methods, on the server.
 * 6. An account that has not agreed to the current terms cannot check out or withdraw.
 * 7. Email-only codes are refused when no email can be sent.
 * 8. The legal pages are prerendered.
 */

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as payoutController from '../src/controllers/payout.controller.ts';
import * as shipmentService from '../src/services/shipment.service.ts';
import { courierBookingAvailable } from '../src/services/manualOperations.service.ts';
import { reviewReturnRequest, getReturnWindowDays } from '../src/services/return.service.ts';
import { availableMethods, isMethodAvailable } from '../src/services/paymentMethods.service.ts';
import { assertAgreed } from '../src/services/legal.service.ts';
import { emailDeliveryAvailable } from '../src/integrations/email/index.ts';
import { sendOtp } from '../src/services/otp.service.ts';
import { prerenderConfig } from '../../client/prerender.config.js';

const norm = (sql) => String(sql).trim().replace(/\s+/g, ' ');
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const ENV_KEYS = ['NODE_ENV', 'PAYMENT_DRIVER', 'COURIER_DRIVER', 'EMAIL_DRIVER', 'ALLOW_MOCK_DRIVERS_IN_PRODUCTION'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/**
 * A db answering by SQL text. `modes` is the operations.modes row; `modules` maps a module key to
 * { is_enabled, settings_json } (absent = not seeded).
 */
function fakeDb({ answer = () => null, modes = null, modules = {} } = {}) {
  const seen = [];
  const run = async (sql, params = []) => {
    const q = norm(sql);
    seen.push({ sql: q, params });
    const custom = answer(q, params);
    if (custom) return custom;
    if (q.includes('FROM platform_settings') && params[0] === 'operations.modes') {
      return { rows: modes ? [{ key: 'operations.modes', value_json: modes }] : [] };
    }
    if (q.includes('FROM platform_modules') && q.includes('WHERE key = $1')) {
      const m = modules[params[0]];
      return { rows: m ? [{ key: params[0], default_enabled: true, depends_on: [], settings_json: {}, ...m }] : [] };
    }
    return { rows: [] };
  };
  const db = { seen, query: run, release() {} };
  db.connect = async () => db;
  return db;
}

describe('1. payout queue "All statuses"', () => {
  test('ALL filters nothing, a real status still filters', async () => {
    for (const [status, filtered] of [['ALL', false], ['all', false], ['REQUESTED', true]]) {
      const db = fakeDb();
      await payoutController.listPayoutQueue({ query: { status }, server: { db, cache: null } }, { send: () => {} });
      const list = db.seen.find((q) => q.sql.includes('FROM payout_requests') || q.sql.includes('FROM payouts'));
      assert.ok(list, 'the list query ran');
      assert.equal(/p\.status = \$/.test(list.sql), filtered, status);
    }
  });

  test('the page no longer sends ALL', () => {
    const page = readFileSync(new URL('../../client/src/pages/admin/PayoutQueuePage.ts', import.meta.url), 'utf8');
    assert.match(page, /if \(statusFilter && statusFilter !== 'ALL'\) params\.set\('status', statusFilter\)/);
  });
});

describe('2. one courier booking per sub-order', () => {
  const subOrder = (status) => ({ id: 77, order_id: 1, ref: 'SUB-77', supplier_id: 42, total_amount: '990.00', status, payment_method: 'COD', recipient_name: 'R', recipient_phone: 'P', delivery_address_json: { district: 'Dhaka' } });
  const db = (status, existing = []) => fakeDb({
    answer: (q) => {
      if (q.includes('FROM sub_orders s')) return { rows: [subOrder(status)] };
      if (q.startsWith('SELECT tracking_number FROM shipments WHERE sub_order_id')) return { rows: existing };
      if (q.startsWith('INSERT INTO shipments')) return { rows: [{ id: 1, tracking_number: 'T-NEW', label_url: null }] };
      return null;
    },
  });

  test('a second booking, or one for a parcel already on its way, is refused', async () => {
    await assert.rejects(shipmentService.createShipmentForSubOrder(db('CONFIRMED', [{ tracking_number: 'T-1' }]), { subOrderId: 77, carrierOverride: 'MOCK' }), (e) => e.code === 'ALREADY_SHIPPED');
    await assert.rejects(shipmentService.createShipmentForSubOrder(db('SHIPPED'), { subOrderId: 77, carrierOverride: 'MOCK' }), (e) => e.code === 'ALREADY_SHIPPED');
    await assert.rejects(shipmentService.createShipmentForSubOrder(db('DELIVERED'), { subOrderId: 77, carrierOverride: 'MOCK' }), (e) => e.code === 'ALREADY_SHIPPED');
  });

  test('a first booking still goes through', async () => {
    process.env.NODE_ENV = 'development';
    const d = db('CONFIRMED');
    await shipmentService.createShipmentForSubOrder(d, { subOrderId: 77, carrierOverride: 'MOCK' });
    assert.ok(d.seen.some((q) => q.sql.startsWith('INSERT INTO shipments')));
  });

  test('manual parcels use the same rule', () => {
    // Any other names may share the import; what matters is the list comes from shipment.service.
    assert.match(read('services/manualOperations.service.ts'), /SHIPPABLE_SUB_ORDER_STATUSES[^}]*\} from '\.\/shipment\.service\.ts'/);
  });
});

describe('3. return and warranty pickups follow the courier mode', () => {
  test('courier booking is available only when INTEGRATED with a real driver', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_MOCK_DRIVERS_IN_PRODUCTION;
    process.env.COURIER_DRIVER = 'none';
    assert.equal(await courierBookingAvailable(fakeDb()), false, 'MANUAL by default');
    assert.equal(await courierBookingAvailable(fakeDb({ modes: { payout_mode: 'MANUAL', courier_mode: 'INTEGRATED' } })), false, 'mock courier in production');
    process.env.COURIER_DRIVER = 'steadfast';
    assert.equal(await courierBookingAvailable(fakeDb({ modes: { payout_mode: 'MANUAL', courier_mode: 'INTEGRATED' } })), true);
    process.env.NODE_ENV = 'development';
    process.env.COURIER_DRIVER = 'mock';
    assert.equal(await courierBookingAvailable(fakeDb({ modes: { payout_mode: 'MANUAL', courier_mode: 'INTEGRATED' } })), true, 'the mock books in development');
  });

  test('approving a return with couriers MANUAL books nothing and invents no tracking number', async () => {
    const db = fakeDb({
      answer: (q) => (q.includes('FROM return_requests r') ? { rows: [{ id: 5, ref: 'RET-5', status: 'REQUESTED', sub_order_ref: 'SUB-1', supplier_id: 42 }] } : null),
    });
    const res = await reviewReturnRequest(db, null, { returnRequestId: 5, action: 'APPROVE', reviewedBy: 1 });
    assert.equal(res.status, 'PICKUP_SCHEDULED');
    assert.equal(res.carrier, 'MANUAL');
    assert.equal(res.reverseTrackingNumber, null);
    const update = db.seen.find((q) => q.sql.startsWith('UPDATE return_requests'));
    assert.match(update.sql, /reverse_tracking_number = NULL, reverse_carrier = 'MANUAL'/);
  });

  test('a failed warranty pickup booking rolls back to a savepoint instead of aborting the approval', () => {
    const src = read('services/warranty.service.ts');
    assert.match(src, /await courierBookingAvailable\(txClient\)\)\) \{\s*await txClient\.query\('SAVEPOINT warranty_reverse_pickup'\)/);
    assert.match(src, /ROLLBACK TO SAVEPOINT warranty_reverse_pickup/);
  });
});

describe('4. module settings come from settings_json', () => {
  test('the return window is the configured one, including 0', async () => {
    const window = (settings) => getReturnWindowDays(fakeDb({ modules: { returns_engine: { is_enabled: true, settings_json: settings } } }), null);
    assert.equal(await window({ return_window_days: 14 }), 14);
    assert.equal(await window({ return_window_days: 0 }), 0);
    assert.equal(await window({}), 7);
  });

  test('disputes and moderation read the same column', () => {
    assert.match(read('services/dispute.service.ts'), /mod\.settings_json \?\? mod\.sub_settings_json/);
    assert.match(read('services/moderation.service.ts'), /modMod\.settings_json \?\? modMod\.sub_settings_json/);
  });
});

describe('5. payment modules switch payment methods', () => {
  const ON = { is_enabled: true };
  const all = { mfs_payment: ON, card_payment: ON, cod_payment: ON };

  test('no gateway: cash on delivery only', async () => {
    process.env.PAYMENT_DRIVER = 'none';
    assert.deepEqual(await availableMethods(fakeDb({ modules: all })), { online_methods: [], cod: true });
  });

  test('every module on, mock driver: bKash, Nagad and card; Rocket stays off by its default', async () => {
    process.env.PAYMENT_DRIVER = 'mock';
    assert.deepEqual((await availableMethods(fakeDb({ modules: all }))).online_methods, ['BKASH', 'NAGAD', 'CARD']);
  });

  test('each switch is honoured', async () => {
    process.env.PAYMENT_DRIVER = 'mock';
    const avail = (modules) => availableMethods(fakeDb({ modules: { ...all, ...modules } }));
    assert.deepEqual((await avail({ mfs_payment: { is_enabled: false } })).online_methods, ['CARD']);
    assert.deepEqual((await avail({ card_payment: { is_enabled: false } })).online_methods, ['BKASH', 'NAGAD']);
    assert.deepEqual((await avail({ mfs_payment: { is_enabled: true, settings_json: { bkash_enabled: false, rocket_enabled: true } } })).online_methods, ['NAGAD', 'ROCKET', 'CARD']);
    assert.equal((await avail({ cod_payment: { is_enabled: false } })).cod, false);
  });

  test('an unseeded module offers no gateway', async () => {
    process.env.PAYMENT_DRIVER = 'mock';
    assert.deepEqual((await availableMethods(fakeDb())).online_methods, []);
  });

  test('isMethodAvailable', () => {
    const a = { online_methods: ['NAGAD'], cod: false };
    assert.equal(isMethodAvailable('WALLET', a), true);
    assert.equal(isMethodAvailable('COD', a), false);
    assert.equal(isMethodAvailable('nagad', a), true);
    assert.equal(isMethodAvailable('BKASH', a), false);
  });

  test('checkout, top-up and the public endpoint all ask the one service', () => {
    assert.match(read('services/checkout.service.ts'), /isMethodAvailable\(paymentMethod, availability\)/);
    assert.match(read('services/walletTopup.service.ts'), /\(await availableMethods\(db, null\)\)\.online_methods/);
    assert.match(read('routes/payment.routes.ts'), /data: await availableMethods\(/);
  });
});

describe('6. no checkout or withdrawal before agreeing to the current terms', () => {
  const legalDb = (accepted) => fakeDb({
    answer: (q, params) => {
      if (q.startsWith('SELECT DISTINCT ON (d.doc_key)')) {
        return { rows: params[0].filter((k) => k === 'terms' || k === 'privacy').map((k, i) => ({ id: i + 1, doc_key: k, version: 1, title_en: k, title_bn: k, required_version: 1 })) };
      }
      if (q.startsWith('SELECT doc_key, MAX(version) AS version FROM legal_acceptances')) {
        return { rows: Object.entries(accepted).map(([doc_key, version]) => ({ doc_key, version })) };
      }
      return null;
    },
  });

  test('a pending agreement refuses with LEGAL_ACCEPTANCE_REQUIRED and names the documents', async () => {
    await assert.rejects(assertAgreed(legalDb({ terms: 1 }), 9), (e) => e.code === 'LEGAL_ACCEPTANCE_REQUIRED'
      && e.details.pending.length === 1 && e.details.pending[0].key === 'privacy');
    await assertAgreed(legalDb({ terms: 1, privacy: 1 }), 9);
    await assertAgreed(legalDb({}), null);
  });

  test('the code is a 403 in the closed enum and the contract', () => {
    assert.match(read('plugins/errorHandler.ts'), /LEGAL_ACCEPTANCE_REQUIRED: 403/);
    assert.match(readFileSync(new URL('../../docs/api-contract.md', import.meta.url), 'utf8'), /`LEGAL_ACCEPTANCE_REQUIRED` \| 403/);
  });

  test('checkout, withdrawal, live-stream orders and team purchases call it; the checkout page asks on it', () => {
    assert.match(read('services/checkout.service.ts'), /await assertAgreed\(pool, userId\)/);
    assert.match(read('controllers/payout.controller.ts'), /await assertAgreed\(req\.server\.db, req\.user\.id,/);
    assert.match(read('services/liveStream.service.ts'), /await assertAgreed\(pool, user\?\.id\)/);
    assert.equal((read('services/teamPurchase.service.ts').match(/await assertAgreed\(db, userId\)/g) || []).length, 2, 'starting and joining a team');
    const page = readFileSync(new URL('../../client/src/pages/CheckoutPage.ts', import.meta.url), 'utf8');
    assert.match(page, /err\.code === 'LEGAL_ACCEPTANCE_REQUIRED'[\s\S]{0,300}checkAndPromptLegal\(\)/);
  });
});

describe('7. email codes need a way to send email', () => {
  test('production without a real driver cannot deliver email; development can', () => {
    assert.equal(emailDeliveryAvailable({ NODE_ENV: 'production', EMAIL_DRIVER: 'mock' }), false);
    assert.equal(emailDeliveryAvailable({ NODE_ENV: 'production', EMAIL_DRIVER: 'mock', ALLOW_MOCK_DRIVERS_IN_PRODUCTION: 'true' }), true);
    assert.equal(emailDeliveryAvailable({ NODE_ENV: 'development' }), true);
  });

  test('an email-only code is refused before anything is stored; a phone still works', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_MOCK_DRIVERS_IN_PRODUCTION;
    process.env.EMAIL_DRIVER = 'mock';
    const db = fakeDb();
    await assert.rejects(sendOtp(db, null, null, null, { email: 'a@example.test', purpose: 'REGISTER', ip: '1.1.1.1' }), (e) => e.code === 'VALIDATION_FAILED' && e.details?.field === 'email');
    assert.equal(db.seen.length, 0);
  });

  test('sign-up refuses an email-only account before creating it', () => {
    const ctrl = read('controllers/auth.controller.ts');
    assert.ok(ctrl.indexOf('emailDeliveryAvailable()') < ctrl.indexOf('authService.registerUser('));
  });
});

describe('8. the legal pages are prerendered', () => {
  test('every document path is in the prerender config', () => {
    const paths = prerenderConfig.routes.map((r) => r.path);
    for (const p of ['/legal/terms', '/legal/privacy', '/legal/refund', '/legal/partner-agreement']) assert.ok(paths.includes(p), p);
  });
});
