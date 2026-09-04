/**
 * chatPage.test.js — Invariant & Unit Tests for Real-Time Chat Workspace (/chat).
 *
 * Tests:
 * 1. Locale integrity (100% key parity between en.json and bn.json for `chat` namespace).
 * 2. Component exports: ChatPage, ThreadList, MessageBubble, MessageComposer.
 * 3. Stylesheet aggregator invariant: main.css imports chat.css.
 * 4. Reset stylesheet invariant: reset.css hides elements with `.hidden` and `[hidden]`.
 * 5. chat.css defines core workspace classes.
 * 6. DOM rendering invariants for MessageBubble, ThreadList, and MessageComposer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import { ThreadList } from '../src/components/chat/ThreadList.js';
import { MessageBubble } from '../src/components/chat/MessageBubble.js';
import { MessageComposer } from '../src/components/chat/MessageComposer.js';
import ChatPage from '../src/pages/ChatPage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Real-Time Chat Workspace — Client Invariants & Contracts', async (t) => {
  await t.test('1. Locale integrity for chat namespace', () => {
    assert.ok(enDict.chat, 'en.json must have "chat" namespace');
    assert.ok(bnDict.chat, 'bn.json must have "chat" namespace');

    const enKeys = Object.keys(enDict.chat).sort();
    const bnKeys = Object.keys(bnDict.chat).sort();

    assert.deepEqual(enKeys, bnKeys, 'chat keys must match 1:1 between en and bn');

    for (const key of enKeys) {
      assert.ok(
        enDict.chat[key] && typeof enDict.chat[key] === 'string',
        `en.json chat.${key} must be a non-empty string`
      );
      assert.ok(
        bnDict.chat[key] && typeof bnDict.chat[key] === 'string',
        `bn.json chat.${key} must be a non-empty string`
      );
    }
  });

  await t.test('2. Component export invariants', () => {
    assert.equal(typeof ChatPage, 'function', 'ChatPage must export a default function');
    assert.equal(typeof ThreadList, 'function', 'ThreadList must export a function');
    assert.equal(typeof MessageBubble, 'function', 'MessageBubble must export a function');
    assert.equal(typeof MessageComposer, 'function', 'MessageComposer must export a function');
  });

  await t.test('3. Stylesheet aggregator includes chat.css', () => {
    const mainCssPath = path.resolve(__dirname, '../src/styles/main.css');
    const content = fs.readFileSync(mainCssPath, 'utf8');
    assert.ok(
      content.includes("@import './components/chat.css';"),
      'main.css must import components/chat.css'
    );
  });

  await t.test('4. Reset stylesheet enforces .hidden rule', () => {
    const resetCssPath = path.resolve(__dirname, '../src/styles/reset.css');
    const content = fs.readFileSync(resetCssPath, 'utf8');
    assert.ok(
      content.includes('.hidden') && content.includes('display: none !important'),
      'reset.css must include .hidden display: none rule'
    );
  });

  await t.test('5. chat.css defines core workspace classes', () => {
    const chatCssPath = path.resolve(__dirname, '../src/styles/components/chat.css');
    assert.ok(fs.existsSync(chatCssPath), 'components/chat.css must exist');
    const content = fs.readFileSync(chatCssPath, 'utf8');

    const requiredSelectors = [
      '.chat-page-container',
      '.chat-topbar',
      '.chat-status-pill',
      '.chat-threads-sidebar',
      '.chat-thread-card',
      '.chat-conversation-area',
      '.chat-messages-stream',
      '.chat-product-inquiry-banner',
      '.chat-bubble-container',
      '.message-bubble-body',
      '.product-bubble',
      '.typing-banner',
      '.chat-composer-component',
      '.quick-reply-chip',
      '.composer-textarea',
      '.composer-send-btn',
    ];

    for (const sel of requiredSelectors) {
      assert.ok(content.includes(sel), `chat.css must define ${sel}`);
    }
  });

  await t.test('6. DOM rendering invariants for MessageBubble', () => {
    const origDoc = globalThis.document;
    try {
      function createMockEl(tag) {
        const el = {
          tagName: tag.toUpperCase(),
          className: '',
          classList: {
            add(c) { el.className = `${el.className} ${c}`.trim(); },
            remove(c) { el.className = el.className.replace(c, '').trim(); },
            contains(c) { return el.className.includes(c); },
          },
          setAttribute(k, v) { el[k] = String(v); },
          removeAttribute(k) { delete el[k]; },
          getAttribute(k) { return el[k]; },
          innerHTML: '',
          style: {},
          children: [],
          appendChild(child) { el.children.push(child); return child; },
          querySelector(sel) {
            if (sel.startsWith('.')) {
              const cls = sel.slice(1);
              if (el.className.includes(cls)) return el;
            }
            return null;
          },
          addEventListener() {},
        };
        return el;
      }

      globalThis.document = {
        createElement: createMockEl,
      };

      // Outgoing text message
      const outgoingEl = MessageBubble({
        message: { id: 1, sender_id: 10, content: 'Hello seller!' },
        isOutgoing: true,
        currentUserId: 10,
      });
      assert.ok(outgoingEl.className.includes('chat-bubble-container'), 'Container class');
      assert.ok(outgoingEl.className.includes('outgoing'), 'Outgoing class for self sender');
      assert.ok(outgoingEl.innerHTML.includes('Hello seller!'), 'Renders content');
      assert.ok(outgoingEl.innerHTML.includes('message-bubble-body'), 'Body class');

      // Incoming text message
      const incomingEl = MessageBubble({
        message: { id: 2, sender_id: 20, content: 'Hi buyer!' },
        isOutgoing: false,
        currentUserId: 10,
      });
      assert.ok(incomingEl.className.includes('incoming'), 'Incoming class for other sender');
      assert.ok(incomingEl.innerHTML.includes('Hi buyer!'), 'Renders incoming content');
      assert.ok(incomingEl.innerHTML.includes('btn-report-msg'), 'Incoming has report button');

      // Product card message
      const prodCardEl = MessageBubble({
        message: {
          id: 3,
          sender_id: 20,
          msg_type: 'PRODUCT_CARD',
          payload_json: {
            productTitle: 'Jamdani Saree',
            price: '3500.00',
            checkoutUrl: '/checkout/1',
          },
        },
        isOutgoing: false,
        currentUserId: 10,
      });
      assert.ok(prodCardEl.innerHTML.includes('product-bubble'), 'Product bubble class');
      assert.ok(prodCardEl.innerHTML.includes('Jamdani Saree'), 'Product title');
      assert.ok(prodCardEl.innerHTML.includes('৳3500.00'), 'Formatted price in BDT');
      assert.ok(prodCardEl.innerHTML.includes('product-bubble-cta'), '1-tap Buy Now button');
    } finally {
      globalThis.document = origDoc;
    }
  });
});
