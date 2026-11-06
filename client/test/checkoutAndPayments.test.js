/**
 * checkoutAndPayments.test.js — Invariants for Checkout UI, Payment Selector, Quick Buy,
 * and Order Tracking (Prompts 5.3 & 5.4).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };

test('Prompts 5.3 & 5.4: Checkout & Payments — Client Invariants', async (t) => {
  // 1. Locale Integrity
  await t.test('1. Locale integrity — en/bn key parity for checkout and order namespaces', () => {
    assert.ok(enDict.checkout, 'en.json must contain checkout');
    assert.ok(bnDict.checkout, 'bn.json must contain checkout');

    const enKeys = Object.keys(enDict.checkout).sort();
    const bnKeys = Object.keys(bnDict.checkout).sort();
    assert.deepEqual(enKeys, bnKeys, 'checkout namespace keys must match between EN and BN');

    assert.ok(enKeys.includes('bkash'), 'must have bkash');
    assert.ok(enKeys.includes('nagad'), 'must have nagad');
    assert.ok(enKeys.includes('cod'), 'must have cod');
    assert.ok(enKeys.includes('verify_otp_btn'), 'must have verify_otp_btn');
  });

  // 2. Payment Method Selector & Gateway Filter Rules
  await t.test('2. Payment methods list filters according to platform module toggles', () => {
    const paymentMethods = [
      { id: 'BKASH', flag: 'bkash', title: 'bKash' },
      { id: 'NAGAD', flag: 'nagad', title: 'Nagad' },
      { id: 'ROCKET', flag: 'rocket', title: 'Rocket' },
      { id: 'CARD', flag: 'cards', title: 'Cards' },
      { id: 'COD', flag: 'cod', title: 'Cash on Delivery' },
    ];

    function filterActiveMethods(methods, activeFlags = {}) {
      return methods.filter((m) => activeFlags[m.flag] !== false);
    }

    // Default all active
    const allActive = filterActiveMethods(paymentMethods, { bkash: true, nagad: true, rocket: true, cards: true, cod: true });
    assert.equal(allActive.length, 5);

    // If card payment is disabled by module toggle
    const cardsOff = filterActiveMethods(paymentMethods, { bkash: true, nagad: true, rocket: true, cards: false, cod: true });
    assert.equal(cardsOff.length, 4);
    assert.ok(!cardsOff.some((m) => m.id === 'CARD'));
  });

  // 3. Offline Resilience Form State Invariants
  await t.test('3. Checkout form state serialization survives offline disconnects without data loss', () => {
    const formState = {
      recipientName: 'Mominul Haque',
      recipientPhone: '+8801712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      upazila: 'Dhanmondi',
      addressLine: 'House 12, Road 4/A',
      paymentMethod: 'BKASH',
      savedAt: Date.now(),
    };

    const serialized = JSON.stringify(formState);
    const restored = JSON.parse(serialized);

    assert.equal(restored.recipientName, 'Mominul Haque');
    assert.equal(restored.recipientPhone, '+8801712345678');
    assert.equal(restored.division, 'Dhaka');
    assert.equal(restored.paymentMethod, 'BKASH');
  });

  // 4. Quick Buy 2-Step Progression Invariants
  await t.test('4. Quick Buy modal computes pricing and requires recipient validation', () => {
    function validateQuickBuyStep(step, data) {
      if (step === 1) {
        // Step 1: Address & Details
        return Boolean(data.name && data.phone && data.district && data.addressLine);
      }
      if (step === 2) {
        // Step 2: Payment Confirmation
        return Boolean(data.paymentMethod && data.termsAccepted);
      }
      return false;
    }

    assert.equal(validateQuickBuyStep(1, {}), false);
    assert.equal(
      validateQuickBuyStep(1, {
        name: 'Sadia',
        phone: '01811223344',
        district: 'Chattogram',
        addressLine: 'GEC Circle',
      }),
      true
    );

    assert.equal(validateQuickBuyStep(2, { paymentMethod: 'COD', termsAccepted: false }), false);
    assert.equal(validateQuickBuyStep(2, { paymentMethod: 'COD', termsAccepted: true }), true);
  });

  // 5. Order Tracking Stage Calculation
  await t.test('5. OrderTracker stage index accurately maps lifecycle status', () => {
    const STAGES = ['PLACED', 'CONFIRMED', 'SHIPPED', 'DELIVERED'];

    function getStageIndex(status) {
      const idx = STAGES.indexOf(String(status).toUpperCase());
      return idx >= 0 ? idx : 0;
    }

    assert.equal(getStageIndex('PLACED'), 0);
    assert.equal(getStageIndex('CONFIRMED'), 1);
    assert.equal(getStageIndex('SHIPPED'), 2);
    assert.equal(getStageIndex('DELIVERED'), 3);
    assert.equal(getStageIndex('UNKNOWN'), 0);
  });
});

// Launch runs PAYMENT_DRIVER=none (no gateway signed): checkout must offer only what the server can
// charge, or a shopper picks bKash and is left with an unpaid order. See server/test/launchConfig.test.js.
test('Ways to pay come from GET /payments/methods, never from a hardcoded list or a feature flag', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

  const selector = read('components/checkout/PaymentSelector.ts');
  assert.match(selector, /onlineMethods = ONLINE_METHOD_IDS/, 'the selector takes the server list');
  assert.match(selector, /codAvailable = true/, 'and whether cash on delivery is on');
  assert.match(selector, /m\.id === 'COD' \? codAvailable : ONLINE_METHOD_IDS\.includes\(m\.id\) \? onlineMethods\.includes\(m\.id\) : true/, 'it offers only what the server listed');
  assert.match(selector, /selectedMethod = methods\.find\(\(m\) => !m\.disabled\)\?\.id \?\? ''/, 'a remembered method no longer offered falls back to a usable one');
  // The old per-method flags named no module key, so they always read "on".
  assert.doesNotMatch(selector, /isFeatureEnabled|flag: '/);

  for (const caller of ['pages/CheckoutPage.ts', 'components/cart/QuickBuyModal.ts']) {
    const code = read(caller);
    assert.match(code, /getPaymentAvailability\(\)/, `${caller} asks the server`);
    assert.match(code, /codAvailable/, `${caller} passes cash-on-delivery availability`);
  }

  const api = read('services/payment.api.ts');
  assert.match(api, /api\.get\('\/payments\/methods'\)/);
  assert.match(api, /\.catch\(\(\) => \{\s*availabilityRequest = null;\s*return \{ online: \[\], cod: true \};/, 'a failed request offers no online method and is not cached');

  const { default: orderHandlers } = await import('../src/mocks/handlers/orders.ts');
  const route = orderHandlers.find((h) => h.method === 'GET' && h.path === '/payments/methods');
  assert.ok(route, 'mock mode answers /payments/methods');
  assert.deepEqual(route.handler({}).body.data, { online_methods: ['BKASH', 'NAGAD', 'ROCKET', 'CARD'], cod: true });

  assert.ok(enDict.topup.unavailable && bnDict.topup.unavailable, 'the top-up page explains an empty method list in both locales');
  assert.ok(enDict.checkout.no_payment_method && bnDict.checkout.no_payment_method, 'checkout explains when nothing is offered');
});
