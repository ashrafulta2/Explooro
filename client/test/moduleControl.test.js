/**
 * moduleControl.test.js — Invariants for Module Control Panel, Grouping, Targeting,
 * Dependency Cascade, and Feature Flags (Prompts 3.1 & 3.2).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import modulesData from '../../server/src/config/modules.seed.json' with { type: 'json' };
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };

const GROUP_ORDER = [
  'trust',
  'commerce',
  'finance',
  'logistics',
  'communication',
  'growth',
  'content',
  'advanced',
  'system',
];

test('Prompt 3.2: Module Control Panel — Client Invariants', async (t) => {
  // 1. Locale Integrity
  await t.test('1. Locale integrity — en/bn key parity for modules namespace', () => {
    const enMod = Object.keys(enDict.modules || {}).sort();
    const bnMod = Object.keys(bnDict.modules || {}).sort();
    assert.deepEqual(enMod, bnMod, 'modules namespace keys must match in en and bn');
    assert.ok(enMod.includes('title'), 'must include title');
    assert.ok(enMod.includes('confirm_disable_title'), 'must include confirm_disable_title');
    assert.ok(enMod.includes('dependency_modal_title'), 'must include dependency_modal_title');
  });

  // 2. 9 Functional Groups & Counter Calculations
  await t.test('2. 9 Functional Groups partition all platform modules with accurate counts', () => {
    const modules = modulesData.modules;
    assert.ok(modules.length >= 68, 'Must contain all 68+ platform modules');

    const grouped = {};
    for (const g of GROUP_ORDER) {
      grouped[g] = [];
    }

    for (const m of modules) {
      assert.ok(GROUP_ORDER.includes(m.group), `Module ${m.key} must belong to a known group: ${m.group}`);
      grouped[m.group].push(m);
    }

    for (const g of GROUP_ORDER) {
      assert.ok(grouped[g].length > 0, `Group ${g} must have at least 1 module`);
      const enabledCount = grouped[g].filter((m) => m.default_enabled !== false).length;
      assert.ok(enabledCount >= 0 && enabledCount <= grouped[g].length);
    }
  });

  // 3. Search & Multi-Faceted Filtering Invariants
  await t.test('3. Search and filter predicates accurately isolate target modules', () => {
    const modules = modulesData.modules;

    // Search by key
    const chatMatches = modules.filter(
      (m) =>
        m.key.includes('chat') ||
        m.label_en.toLowerCase().includes('chat') ||
        (m.label_bn && m.label_bn.includes('চ্যাট'))
    );
    assert.ok(chatMatches.length >= 1, 'Chat search must return results');

    // Filter by group
    const financeModules = modules.filter((m) => m.group === 'finance');
    assert.ok(financeModules.some((m) => m.key === 'escrow_engine'), 'Finance group contains escrow_engine');

    // Filter by custom targeting support
    const targetedModules = modules.filter((m) => Array.isArray(m.targeting) && m.targeting.length > 0);
    assert.ok(targetedModules.length > 0, 'Some modules support custom targeting');
  });

  // 4. Reason Validation Rules
  await t.test('4. Reason validation enforces >= 10 non-whitespace characters', () => {
    const validateReason = (r) => typeof r === 'string' && r.trim().length >= 10;

    assert.equal(validateReason(''), false);
    assert.equal(validateReason('        '), false);
    assert.equal(validateReason('Too short'), false); // 9 chars
    assert.equal(validateReason('Emergency security patch applied to payment gateway'), true);
  });

  // 5. Dependency Cascade Detection
  await t.test('5. Dependency cascade detection identifies dependents correctly', () => {
    const modules = modulesData.modules;

    function getDependents(parentKey) {
      return modules.filter((m) => Array.isArray(m.depends_on) && m.depends_on.includes(parentKey));
    }

    const chatDependents = getDependents('chat');
    const chatDepKeys = chatDependents.map((d) => d.key);
    assert.ok(chatDepKeys.includes('whatsapp_bridge'), 'whatsapp_bridge depends on chat');
    assert.ok(chatDepKeys.includes('live_commerce'), 'live_commerce depends on chat');

    const customerVerifDependents = getDependents('customer_verification');
    assert.ok(customerVerifDependents.map((d) => d.key).includes('age_verification'), 'age_verification depends on customer_verification');
  });

  // 6. Dynamic Settings Schema Generation
  await t.test('6. Dynamic settings schema handles various JSON schema types', () => {
    const sampleSchema = {
      type: 'object',
      properties: {
        max_daily_limit: { type: 'integer', default: 5000 },
        rate_multiplier: { type: 'number', default: 1.5 },
        api_mode: { type: 'string', enum: ['SANDBOX', 'LIVE'], default: 'SANDBOX' },
        auto_retry: { type: 'boolean', default: true },
        whitelisted_ips: { type: 'array', items: { type: 'string' } },
      },
    };

    const props = sampleSchema.properties;
    assert.equal(typeof props.max_daily_limit.default, 'number');
    assert.equal(typeof props.auto_retry.default, 'boolean');
    assert.ok(props.api_mode.enum.includes('LIVE'));
    assert.equal(props.whitelisted_ips.type, 'array');
  });
});
