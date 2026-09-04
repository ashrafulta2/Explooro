/**
 * salerInbox.test.js — Invariant & Unit Tests for Saler Unified Multi-Channel Inbox (Prompt 8.3).
 *
 * Tests:
 * 1. Locale integrity (100% key parity between en.json and bn.json for saler_inbox).
 * 2. GET /saler/inbox/threads contract & multi-channel presence (WhatsApp, Messenger, Direct).
 * 3. Thread search and channel filtering invariants.
 * 4. Outbound reply message dispatch (/saler/inbox/threads/:id/send).
 * 5. Interactive product card with 1-tap checkout generation (/saler/inbox/threads/:id/send-product).
 * 6. Component export invariant.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import salerHandlers from '../src/mocks/handlers/saler.js';
import UnifiedInboxPage from '../src/pages/saler/UnifiedInboxPage.js';

test('Unified Commerce Inbox — Client Invariants & Contracts', async (t) => {
  await t.test('1. Locale integrity for saler_inbox namespace', () => {
    assert.ok(enDict.saler_inbox, 'en.json must have "saler_inbox" namespace');
    assert.ok(bnDict.saler_inbox, 'bn.json must have "saler_inbox" namespace');

    const enKeys = Object.keys(enDict.saler_inbox).sort();
    const bnKeys = Object.keys(bnDict.saler_inbox).sort();

    assert.deepEqual(enKeys, bnKeys, 'saler_inbox keys must match 1:1 between en and bn');

    for (const key of enKeys) {
      assert.ok(
        enDict.saler_inbox[key] && typeof enDict.saler_inbox[key] === 'string',
        `en.json saler_inbox.${key} must be a non-empty string`
      );
      assert.ok(
        bnDict.saler_inbox[key] && typeof bnDict.saler_inbox[key] === 'string',
        `bn.json saler_inbox.${key} must be a non-empty string`
      );
    }
  });

  await t.test('2. GET /saler/inbox/threads returns multi-channel conversations', () => {
    const handler = salerHandlers.find((h) => h.path === '/saler/inbox/threads' && h.method === 'GET');
    assert.ok(handler, 'Must register GET /saler/inbox/threads');

    const res = handler.handler();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data.items), 'items must be an array');
    assert.ok(res.body.data.items.length >= 3, 'Must return at least 3 seed threads');

    const channels = new Set(res.body.data.items.map((i) => i.channel));
    assert.ok(channels.has('WHATSAPP'), 'Must include WHATSAPP channel');
    assert.ok(channels.has('MESSENGER'), 'Must include MESSENGER channel');
    assert.ok(channels.has('IN_PLATFORM'), 'Must include IN_PLATFORM channel');
  });

  await t.test('3. Channel filtering & search logic invariants', () => {
    const handler = salerHandlers.find((h) => h.path === '/saler/inbox/threads' && h.method === 'GET');
    const items = handler.handler().body.data.items;

    // Filter by channel
    const waOnly = items.filter((t) => t.channel === 'WHATSAPP');
    assert.ok(waOnly.length >= 1, 'Should find WhatsApp threads');
    assert.ok(waOnly.every((t) => t.channel === 'WHATSAPP'));

    const msOnly = items.filter((t) => t.channel === 'MESSENGER');
    assert.ok(msOnly.length >= 1, 'Should find Messenger threads');
    assert.ok(msOnly.every((t) => t.channel === 'MESSENGER'));

    // Search by phone or preview query
    const phoneQuery = '8801812345678';
    const foundByPhone = items.filter((t) => (t.customerPhone || '').includes(phoneQuery));
    assert.equal(foundByPhone.length, 1);
    assert.equal(foundByPhone[0].channel, 'WHATSAPP');

    const contentQuery = 'dupatta';
    const foundByContent = items.filter((t) => (t.last_message_preview || '').toLowerCase().includes(contentQuery));
    assert.equal(foundByContent.length, 1);
    assert.equal(foundByContent[0].channel, 'MESSENGER');
  });

  await t.test('4. POST /saler/inbox/threads/:id/send sends text reply', () => {
    const handler = salerHandlers.find((h) => h.path === '/saler/inbox/threads/:id/send' && h.method === 'POST');
    assert.ok(handler, 'Must register POST /saler/inbox/threads/:id/send');

    const res = handler.handler({
      params: { id: '10' },
      body: { content: 'Dhaka delivery will arrive tomorrow by 5 PM.' },
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.data.message, 'Must return created message');
    assert.equal(res.body.data.message.content, 'Dhaka delivery will arrive tomorrow by 5 PM.');
    assert.equal(res.body.data.message.thread_id, 10);
    assert.equal(res.body.data.message.msg_type, 'TEXT');
  });

  await t.test('5. POST /saler/inbox/threads/:id/send-product creates 1-tap checkout card', () => {
    const handler = salerHandlers.find(
      (h) => h.path === '/saler/inbox/threads/:id/send-product' && h.method === 'POST'
    );
    assert.ok(handler, 'Must register POST /saler/inbox/threads/:id/send-product');

    const res = handler.handler({
      params: { id: '10' },
      body: { product_id: 1, note: 'Special discount 10%' },
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.data.message, 'Must return created message');
    assert.equal(res.body.data.message.msg_type, 'PRODUCT_CARD');

    const payload = res.body.data.message.payload_json;
    assert.ok(payload, 'Must have payload_json');
    assert.equal(payload.productId, 1);
    assert.ok(payload.productTitle, 'Must have product title');
    assert.ok(payload.price, 'Must have price');
    assert.ok(payload.checkoutUrl.includes('/checkout/wa/'), 'Must have checkout URL');
    assert.equal(payload.note, 'Special discount 10%');
  });

  await t.test('6. UnifiedInboxPage exports a valid render function', () => {
    assert.equal(typeof UnifiedInboxPage, 'function', 'UnifiedInboxPage must be a function');
  });
});
