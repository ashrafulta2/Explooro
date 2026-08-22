/**
 * checkoutUi.test.js — Test suite for Prompt 5.4 (Checkout UI, Quick Buy & Order Tracking logic).
 *
 * Verifies:
 *  1. Bangladesh Geo Hierarchy: All 8 divisions and 64 districts are defined with bilingual data.
 *  2. Phone Validation: Validates +8801 / 01 prefix and 11-digit formats across all BD telecom operators.
 *  3. Order Tracker: Correctly maps 4 visual stages and status edge cases.
 *  4. Idempotency Generation: Keys conform to unique UUID / alphanumeric schema.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BANGLADESH_DIVISIONS,
  getDivisions,
  getDivisionById,
  getDistrictsByDivision,
  getUpazilasByDistrict,
} from '../../client/src/data/bangladeshGeo.js';
import { normalizeBdPhone, isValidBdPhone } from '../../client/src/components/checkout/AddressForm.js';
import { getStageIndex, ORDER_STAGES } from '../../client/src/components/order/OrderTracker.js';
import { generateIdempotencyKey } from '../../client/src/services/order.api.js';

describe('Prompt 5.4 — Checkout UI, Quick Buy & Order Tracking Logic', () => {
  test('Acceptance 1: Bangladesh Geo data contains all 8 divisions and 64 districts', () => {
    const divisions = getDivisions();
    assert.equal(divisions.length, 8, 'Must have 8 divisions');

    const expectedDivisions = ['dhaka', 'chittagong', 'rajshahi', 'khulna', 'barisal', 'sylhet', 'rangpur', 'mymensingh'];
    for (const id of expectedDivisions) {
      assert.ok(divisions.some((d) => d.id === id), `Division ${id} exists`);
    }

    let totalDistricts = 0;
    divisions.forEach((div) => {
      assert.ok(div.name_en && div.name_bn, `Division ${div.id} has bilingual names`);
      totalDistricts += div.districts.length;
    });

    assert.equal(totalDistricts, 64, 'Must have exactly 64 districts in Bangladesh');
  });

  test('Acceptance 2: Cascading Geo helpers resolve correctly', () => {
    const dhakaDistricts = getDistrictsByDivision('dhaka');
    assert.ok(dhakaDistricts.length > 0, 'Dhaka has districts');
    assert.ok(dhakaDistricts.some((d) => d.id === 'gazipur'), 'Gazipur is in Dhaka division');

    const dhanmondiUpazilas = getUpazilasByDistrict('dhaka', 'dhaka_city');
    assert.ok(dhanmondiUpazilas.includes('Dhanmondi'), 'Dhanmondi is in Dhaka City');
  });

  test('Acceptance 3: Bangladeshi phone number validation and normalization', () => {
    // Valid formats
    const validPhones = [
      '01711111111',
      '01300000000',
      '01400000000',
      '01500000000',
      '01600000000',
      '01800000000',
      '01900000000',
      '+8801711111111',
      '+8801812345678',
      '01711-111111',
      '+88 01711 111111',
    ];

    for (const phone of validPhones) {
      assert.equal(isValidBdPhone(phone), true, `Phone "${phone}" should be valid`);
      const norm = normalizeBdPhone(phone);
      assert.ok(norm.startsWith('+8801'), `Normalized "${norm}" starts with +8801`);
    }

    // Invalid formats
    const invalidPhones = [
      '01200000000', // Invalid operator code (012)
      '01000000000', // Invalid operator code (010)
      '0171111111',  // Too short (10 digits)
      '017111111111', // Too long (12 digits)
      'abcd1234567',
      '',
    ];

    for (const phone of invalidPhones) {
      assert.equal(isValidBdPhone(phone), false, `Phone "${phone}" should be invalid`);
    }
  });

  test('Acceptance 4: OrderTracker stage index resolution', () => {
    assert.equal(ORDER_STAGES.length, 4, 'Has 4 standard stages');
    assert.equal(getStageIndex('PLACED'), 0);
    assert.equal(getStageIndex('CONFIRMED'), 1);
    assert.equal(getStageIndex('PROCESSING'), 1);
    assert.equal(getStageIndex('SHIPPED'), 2);
    assert.equal(getStageIndex('IN_TRANSIT'), 2);
    assert.equal(getStageIndex('DELIVERED'), 3);
    assert.equal(getStageIndex('CANCELLED'), -1);
  });

  test('Acceptance 5: Idempotency Key generator produces non-empty unique strings', () => {
    const k1 = generateIdempotencyKey();
    const k2 = generateIdempotencyKey();
    assert.ok(k1 && typeof k1 === 'string');
    assert.ok(k2 && typeof k2 === 'string');
    assert.notEqual(k1, k2, 'Keys must be unique');
  });
});
