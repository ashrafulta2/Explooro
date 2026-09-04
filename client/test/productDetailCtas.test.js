/**
 * productDetailCtas.test.js — Invariant tests for Product Detail Page CTAs:
 * - "Chat with Seller" functionality, thread linking & inquiry pre-fill.
 * - "Team Purchase" social group buying, pricing calculation, modal & mock handlers.
 * - Bilingual locale parity across English and Bengali.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import chatHandlers from '../src/mocks/handlers/chat.js';
import { teamPurchaseHandlers } from '../src/mocks/handlers/teamPurchase.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const enLoc = JSON.parse(readFileSync(join(root, 'src/locales/en.json'), 'utf8'));
const bnLoc = JSON.parse(readFileSync(join(root, 'src/locales/bn.json'), 'utf8'));
const pdpSrc = readFileSync(join(root, 'src/pages/ProductDetailPage.js'), 'utf8');
const chatPageSrc = readFileSync(join(root, 'src/pages/ChatPage.js'), 'utf8');
const teamModalSrc = readFileSync(join(root, 'src/components/product/TeamPurchaseModal.js'), 'utf8');

describe('Product Detail CTAs — Chat with Seller & Team Purchase Invariants', () => {
  it('1. Locale parity — all new team_purchases and product_detail.cta keys exist in both locales', () => {
    const requiredCtaKeys = ['add_to_cart', 'quick_buy', 'chat_with_seller', 'team_purchase'];
    for (const key of requiredCtaKeys) {
      assert.ok(enLoc.product_detail?.cta?.[key] || enLoc.marketplace?.product?.[key], `Missing en key for ${key}`);
      assert.ok(bnLoc.product_detail?.cta?.[key] || bnLoc.marketplace?.product?.[key], `Missing bn key for ${key}`);
    }

    const requiredTeamKeys = [
      'modal_title',
      'modal_subtitle',
      'active_teams_heading',
      'start_new_heading',
      'team_size_label',
      'members_2',
      'members_3',
      'btn_start',
      'teaser_title',
      'teaser_desc',
      'explore_teams',
    ];

    for (const key of requiredTeamKeys) {
      assert.ok(enLoc.team_purchases?.[key], `Missing en.json team_purchases.${key}`);
      assert.ok(bnLoc.team_purchases?.[key], `Missing bn.json team_purchases.${key}`);
    }
  });

  it('2. ProductDetailPage renders redesigned structure with primary and social CTA rows', () => {
    assert.ok(pdpSrc.includes('product-detail-page__cta-section'), 'Missing cta-section container');
    assert.ok(pdpSrc.includes('product-detail-page__primary-ctas'), 'Missing primary-ctas container');
    assert.ok(pdpSrc.includes('product-detail-page__social-bar'), 'Missing social-bar container');
    assert.ok(pdpSrc.includes('btn--chat-seller'), 'Missing btn--chat-seller class');
    assert.ok(pdpSrc.includes('btn--team-purchase'), 'Missing btn--team-purchase class');
    assert.ok(pdpSrc.includes('team-badge-discount'), 'Missing team-badge-discount badge');
    assert.ok(pdpSrc.includes('team-purchase-teaser'), 'Missing team-purchase-teaser banner');
  });

  it('3. Chat with Seller calls /chat/threads with supplier metadata and navigates to /chat?threadId=...', () => {
    assert.ok(pdpSrc.includes("api.post('/chat/threads'"), 'Chat button must call POST /chat/threads');
    assert.ok(pdpSrc.includes('target_user_id'), 'Chat thread creation must supply target_user_id');
    assert.ok(pdpSrc.includes('CUSTOMER_SALER'), 'Chat thread must use CUSTOMER_SALER type');
    assert.ok(pdpSrc.includes('/chat?threadId='), 'Chat button must navigate to /chat with threadId param');
  });

  it('4. ChatPage accepts query params and auto-selects targetThreadId with product inquiry banner', () => {
    assert.ok(chatPageSrc.includes('{ params, query, navigate }'), 'ChatPage signature must accept query params');
    assert.ok(chatPageSrc.includes('targetThreadId'), 'ChatPage must parse targetThreadId');
    assert.ok(chatPageSrc.includes('chat-product-inquiry-banner'), 'ChatPage must display inquiry banner when product inquiry passed');
    assert.ok(chatPageSrc.includes('initialValue'), 'ChatPage must pass inquiry draft as initialValue to composer');
  });

  it('5. Mock chat handlers support POST /chat/threads and GET /chat/threads/:id', () => {
    const postThreadHandler = chatHandlers.find((h) => h.method === 'POST' && h.path === '/chat/threads');
    assert.ok(postThreadHandler, 'POST /chat/threads handler missing in mock');

    // Test creating thread with supplier name metadata
    const testSupplierId = 999;
    const res = postThreadHandler.handler({
      body: {
        target_user_id: testSupplierId,
        metadata: { supplier_name: 'Rahim Fashion' },
      },
    });
    assert.ok(res.status === 201 || res.status === 200);
    assert.ok(res.body?.data?.thread?.id);
    assert.equal(res.body?.data?.thread?.other_participant_name, 'Rahim Fashion');

    const getThreadHandler = chatHandlers.find((h) => h.method === 'GET' && h.path === '/chat/threads/:id');
    assert.ok(getThreadHandler, 'GET /chat/threads/:id handler missing in mock');
    const getRes = getThreadHandler.handler({ params: { id: res.body.data.thread.id } });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.thread.id, res.body.data.thread.id);
  });

  it('6. TeamPurchaseModal implements group discount calculation and POST /team-purchases submission', () => {
    assert.ok(teamModalSrc.includes('openTeamPurchaseModal'), 'TeamPurchaseModal must export openTeamPurchaseModal');
    assert.ok(teamModalSrc.includes('calcGroupPrice'), 'TeamPurchaseModal must calculate group price');
    assert.ok(teamModalSrc.includes("api.post('/team-purchases'"), 'TeamPurchaseModal must post to /team-purchases');
    assert.ok(teamModalSrc.includes('/team/'), 'TeamPurchaseModal must redirect to created team page');
  });

  it('7. Mock team purchase handlers support GET /team-purchases and dynamic product fields in POST', () => {
    const getTeamsHandler = teamPurchaseHandlers.find((h) => h.method === 'GET' && h.path === '/team-purchases');
    assert.ok(getTeamsHandler, 'GET /team-purchases handler missing in mock');

    const postTeamHandler = teamPurchaseHandlers.find((h) => h.method === 'POST' && h.path === '/team-purchases');
    assert.ok(postTeamHandler, 'POST /team-purchases handler missing in mock');

    const createRes = postTeamHandler.handler({
      body: {
        product_id: 108,
        product_name_en: 'Handloom Tant Saree - Special Edition',
        product_name_bn: 'তাঁত শাড়ি - স্পেশাল এডিশন',
        product_image_url: 'https://example.com/saree.jpg',
        original_price: 3200,
        group_price: 2400,
        required_members: 3,
      },
    });

    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.team.product_name_en, 'Handloom Tant Saree - Special Edition');
    assert.equal(createRes.body.team.group_price, 2400);
    assert.equal(createRes.body.team.original_price, 3200);
    assert.equal(createRes.body.team.status, 'ACTIVE');
  });
});
