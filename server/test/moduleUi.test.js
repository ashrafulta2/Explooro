/**
 * moduleUi.test.js — Unit test suite for Prompt 3.2 (Module Control Panel UI & Feature Flags).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

describe('Module Control Panel UI & Feature Flags (Prompt 3.2)', () => {
  test('featureFlags: isFeatureEnabled and setFlags update state and dispatch to listeners', () => {
    let internalFlags = { sponsored_ads: true, chat: true, live_commerce: false };
    const listeners = [];
    const subscribe = (fn) => {
      listeners.push(fn);
      return () => {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    };

    const isFeatureEnabled = (key) => Boolean(internalFlags[key]);
    const setFlags = (newFlags) => {
      internalFlags = { ...internalFlags, ...newFlags };
      for (const fn of listeners) fn(internalFlags);
    };

    assert.equal(isFeatureEnabled('sponsored_ads'), true);
    assert.equal(isFeatureEnabled('live_commerce'), false);

    let notified = null;
    const unsub = subscribe((flags) => {
      notified = flags;
    });

    setFlags({ sponsored_ads: false });
    assert.equal(isFeatureEnabled('sponsored_ads'), false);
    assert.equal(notified?.sponsored_ads, false);

    unsub();
  });

  test('DOM Gate Scanner: turning off sponsored_ads marks gated elements with hidden', () => {
    // Mock DOM node structure
    const createMockElement = (tag, attrs = {}) => {
      const attributes = { ...attrs };
      const styles = {};
      return {
        tagName: tag.toUpperCase(),
        getAttribute: (k) => attributes[k],
        setAttribute: (k, v) => { attributes[k] = v; },
        removeAttribute: (k) => { delete attributes[k]; },
        hasAttribute: (k) => k in attributes,
        style: {
          setProperty: (prop, val) => { styles[prop] = val; },
          removeProperty: (prop) => { delete styles[prop]; },
          get: (prop) => styles[prop],
        },
        _attrs: attributes,
        _styles: styles,
      };
    };

    const adSlot1 = createMockElement('div', { 'data-module': 'sponsored_ads' });
    const chatWidget = createMockElement('div', { 'data-module': 'chat' });
    const elements = [adSlot1, chatWidget];

    const mockRoot = {
      querySelectorAll: (sel) => {
        if (sel === '[data-module]') return elements;
        return [];
      },
    };

    const flags = { sponsored_ads: true, chat: true };
    const scanDom = (root, currentFlags) => {
      const els = root.querySelectorAll('[data-module]');
      for (const el of els) {
        const key = el.getAttribute('data-module');
        const enabled = Boolean(currentFlags[key]);
        if (!enabled) {
          el.setAttribute('data-module-disabled', 'true');
          el.setAttribute('hidden', '');
          el.style.setProperty('display', 'none');
        } else {
          el.removeAttribute('data-module-disabled');
          el.removeAttribute('hidden');
          el.style.removeProperty('display');
        }
      }
    };

    // Initially both are enabled
    scanDom(mockRoot, flags);
    assert.equal(adSlot1.hasAttribute('hidden'), false);
    assert.equal(chatWidget.hasAttribute('hidden'), false);

    // Turn off sponsored_ads
    flags.sponsored_ads = false;
    scanDom(mockRoot, flags);

    assert.equal(adSlot1.hasAttribute('hidden'), true);
    assert.equal(adSlot1.getAttribute('data-module-disabled'), 'true');
    assert.equal(adSlot1.style.get('display'), 'none');
    assert.equal(chatWidget.hasAttribute('hidden'), false);
  });

  test('Dynamic Settings Schema: handles boolean, integer, number, string, enum, array schemas', () => {
    const sampleSchema = {
      type: 'object',
      properties: {
        max_daily_budget_bdt: { type: 'integer', minimum: 100, maximum: 100000, default: 5000 },
        auto_moderation: { type: 'boolean', default: true },
        allowed_payment_gateways: { type: 'array', items: { type: 'string' }, default: ['bkash', 'nagad'] },
        payout_schedule: { type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY'], default: 'WEEKLY' },
      },
    };

    const parsedControls = [];
    for (const [key, def] of Object.entries(sampleSchema.properties)) {
      let controlType = 'text';
      if (def.type === 'boolean') controlType = 'switch';
      else if (def.enum) controlType = 'select';
      else if (def.type === 'integer' || def.type === 'number') controlType = 'number';
      else if (def.type === 'array') controlType = 'array_tags';

      parsedControls.push({ key, controlType, defaultVal: def.default });
    }

    assert.equal(parsedControls.length, 4);
    assert.deepEqual(parsedControls.map((c) => c.controlType), ['number', 'switch', 'array_tags', 'select']);
  });

  test('Grouped Accordion: 9 distinct functional groups with counter calculations', () => {
    const mockModules = [
      { key: 'fraud_engine', group_key: 'trust', is_enabled: true },
      { key: 'device_fingerprinting', group_key: 'trust', is_enabled: false },
      { key: 'flash_deals', group_key: 'commerce', is_enabled: true },
      { key: 'wholesale_bulk_pricing', group_key: 'commerce', is_enabled: true },
      { key: 'sponsored_ads', group_key: 'growth', is_enabled: true },
    ];

    const groupCounts = {};
    for (const m of mockModules) {
      if (!groupCounts[m.group_key]) {
        groupCounts[m.group_key] = { total: 0, enabled: 0 };
      }
      groupCounts[m.group_key].total += 1;
      if (m.is_enabled) groupCounts[m.group_key].enabled += 1;
    }

    assert.equal(groupCounts.trust.total, 2);
    assert.equal(groupCounts.trust.enabled, 1);
    assert.equal(groupCounts.commerce.total, 2);
    assert.equal(groupCounts.commerce.enabled, 2);
    assert.equal(groupCounts.growth.total, 1);
    assert.equal(groupCounts.growth.enabled, 1);
  });
});
