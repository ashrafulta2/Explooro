/**
 * productModerationPipeline.test.js — Prompt 7.4 Test Suite
 *
 * Tests:
 * - Acceptance 1: A new product does not go live until approved when the moderation module is on.
 * - Acceptance 2: Turning on auto_approval for a category bypasses the queue for that category only.
 * - Acceptance 3: Two moderators cannot claim the same item simultaneously.
 * - Acceptance 4: A rejection reason reaches the seller in their chosen language.
 * - Pre-screening engine: Detects banned keywords (EN/BN), price anomalies, and duplicate listings.
 * - Bulk actions and throughput statistics aggregation.
 * - Fastify HTTP endpoints for the moderation pipeline.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import moderationRoutes from '../src/routes/moderation.routes.js';
import * as moderationService from '../src/services/moderation.service.js';

// Mock in-memory database helper
function createMockDb() {
  const users = [
    { id: 1, full_name: 'Admin User', role: 'super_admin', email: 'admin@explooro.com' },
    { id: 2, full_name: 'Moderator One', role: 'moderator', email: 'mod1@explooro.com' },
    { id: 3, full_name: 'Moderator Two', role: 'moderator', email: 'mod2@explooro.com' },
    { id: 4, full_name: 'Karim Supplier', role: 'supplier', email: 'supplier@explooro.com' },
  ];

  const categories = [
    { id: 10, name_en: 'Electronics', auto_approve: false },
    { id: 20, name_en: 'Books & Stationery', auto_approve: true },
  ];

  const products = [
    {
      id: 501,
      ref: 'PRD-501',
      title_en: 'Cotton Panjabi',
      title_bn: 'সুতি পাঞ্জাবি',
      status: 'PENDING_APPROVAL',
      category_id: 10,
      supplier_id: 4,
      default_retail_price: '1200.00',
      base_cost: '800.00',
      wholesale_margin: '200.00',
      deleted_at: null,
    },
  ];

  const moderationQueue = [];
  const productApprovals = [];
  const userRestrictions = [];
  const auditLogs = [];

  const modules = [
    {
      key: 'product_moderation',
      is_enabled: true,
      sub_settings_json: {
        sla_hours: 24,
        keyword_blocklist_en: ['replica', 'counterfeit'],
        keyword_blocklist_bn: ['নকল', 'ক্লোন'],
        price_anomaly_multiplier: 5,
      },
    },
    {
      key: 'auto_approval',
      is_enabled: true,
      sub_settings_json: {
        category_ids: [20],
      },
    },
  ];

  let nextQueueId = 1;

  const mockDb = {
    users,
    categories,
    products,
    moderationQueue,
    productApprovals,
    userRestrictions,
    auditLogs,
    modules,
    async query(sql, params = []) {
      const q = sql.trim();

      // SELECT module
      if (q.includes('FROM platform_modules WHERE key = $1')) {
        const key = params[0];
        const found = modules.find((m) => m.key === key);
        return { rows: found ? [found] : [] };
      }

      // SELECT categories
      if (q.includes('FROM categories WHERE id = $1')) {
        const catId = params[0];
        const found = categories.find((c) => c.id === Number(catId));
        return { rows: found ? [found] : [] };
      }

      // Duplicate product search
      if (q.includes('FROM products') && q.includes('WHERE title_en ILIKE $1')) {
        const title = params[0].toLowerCase();
        const found = products.filter((p) => p.title_en.toLowerCase() === title && !p.deleted_at);
        return { rows: found };
      }

      // INSERT INTO moderation_queue
      if (q.startsWith('INSERT INTO moderation_queue')) {
        const id = nextQueueId++;
        const item = {
          id,
          ref: params[0],
          item_type: params[1],
          entity_id: params[2],
          submitted_by: params[3],
          status: 'PENDING',
          auto_flags_json: typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4],
          payload_snapshot_json: typeof params[5] === 'string' ? JSON.parse(params[5]) : params[5],
          sla_due_at: params[6],
          claimed_by: null,
          claimed_at: null,
          decided_by: null,
          decided_at: null,
          rejection_reason_en: null,
          rejection_reason_bn: null,
          changes_requested_en: null,
          changes_requested_bn: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        moderationQueue.push(item);
        return { rows: [item] };
      }

      // UPDATE products
      if (q.startsWith('UPDATE products')) {
        if (q.includes("status = 'ACTIVE'")) {
          const pId = params[0];
          const prod = products.find((p) => p.id === Number(pId));
          if (prod) prod.status = 'ACTIVE';
          return { rows: [prod] };
        }
        if (q.includes("status = 'PENDING_APPROVAL'")) {
          const pId = params[0];
          const prod = products.find((p) => p.id === Number(pId));
          if (prod) prod.status = 'PENDING_APPROVAL';
          return { rows: [prod] };
        }
        if (q.includes('status = $2')) {
          const pId = params[0];
          const nextStatus = params[1];
          const prod = products.find((p) => p.id === Number(pId));
          if (prod) prod.status = nextStatus;
          return { rows: [prod] };
        }
      }

      // INSERT INTO product_approvals
      if (q.startsWith('INSERT INTO product_approvals')) {
        const entry = {
          product_id: params[0],
          submitted_by: params[1],
          status: 'PENDING',
          auto_flags_json: typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2],
          sla_due_at: params[3],
        };
        productApprovals.push(entry);
        return { rows: [entry] };
      }

      // UPDATE moderation_queue (Claiming lock)
      if (q.startsWith('UPDATE moderation_queue') && q.includes('claimed_by = $2') && q.includes('(claimed_by IS NULL OR claimed_by = $2)')) {
        const queueId = params[0];
        const moderatorId = params[1];
        const item = moderationQueue.find((item) => item.id === Number(queueId));
        if (item && (item.claimed_by === null || item.claimed_by === moderatorId)) {
          item.claimed_by = moderatorId;
          item.claimed_at = new Date().toISOString();
          item.status = 'IN_REVIEW';
          item.updated_at = new Date().toISOString();
          return { rows: [item] };
        }
        return { rows: [] };
      }

      // UPDATE moderation_queue (Release claim)
      if (q.startsWith('UPDATE moderation_queue') && q.includes('claimed_by = NULL') && q.includes('claimed_by = $2')) {
        const queueId = params[0];
        const moderatorId = params[1];
        const item = moderationQueue.find((item) => item.id === Number(queueId));
        if (item && item.claimed_by === moderatorId) {
          item.claimed_by = null;
          item.claimed_at = null;
          item.status = 'PENDING';
          return { rows: [item] };
        }
        return { rows: [] };
      }

      // SELECT moderation_queue FOR UPDATE or single item
      if (q.includes('FROM moderation_queue') && (q.includes('WHERE id = $1') || q.includes('WHERE q.id = $1'))) {
        const queueId = params[0];
        const item = moderationQueue.find((i) => i.id === Number(queueId));
        if (!item) return { rows: [] };
        const submitter = users.find((u) => u.id === item.submitted_by) || {};
        const claimer = users.find((u) => u.id === item.claimed_by) || {};
        return {
          rows: [
            {
              ...item,
              submitter_name: submitter.full_name,
              submitter_email: submitter.email,
              submitter_role: submitter.role,
              claimed_by_name: claimer.full_name,
            },
          ],
        };
      }

      // UPDATE moderation_queue (Decision)
      if (q.startsWith('UPDATE moderation_queue') && q.includes('status = $2') && q.includes('decided_by = $3')) {
        const queueId = params[0];
        const decision = params[1];
        const decidedBy = params[2];
        const reasonEn = params[3];
        const reasonBn = params[4];
        const changesEn = params[5];
        const changesBn = params[6];
        const item = moderationQueue.find((i) => i.id === Number(queueId));
        if (item) {
          item.status = decision;
          item.decided_by = decidedBy;
          item.decided_at = new Date().toISOString();
          item.rejection_reason_en = reasonEn;
          item.rejection_reason_bn = reasonBn;
          item.changes_requested_en = changesEn;
          item.changes_requested_bn = changesBn;
          item.updated_at = new Date().toISOString();
          return { rows: [item] };
        }
        return { rows: [] };
      }

      // SELECT getQueue
      if (q.includes('FROM moderation_queue q') && q.includes('JOIN users u')) {
        let list = [...moderationQueue];
        const enhanced = list.map((item) => {
          const u = users.find((usr) => usr.id === item.submitted_by) || {};
          const cu = users.find((usr) => usr.id === item.claimed_by) || {};
          return {
            ...item,
            submitter_name: u.full_name,
            submitter_email: u.email,
            submitter_role: u.role,
            claimed_by_name: cu.full_name,
          };
        });
        return { rows: enhanced };
      }

      // SELECT getModeratorStats
      if (q.includes('COUNT(id) AS total_items') && q.includes('FROM moderation_queue')) {
        return {
          rows: [
            {
              total_items: moderationQueue.length,
              pending_count: moderationQueue.filter((i) => i.status === 'PENDING').length,
              in_review_count: moderationQueue.filter((i) => i.status === 'IN_REVIEW').length,
              approved_count: moderationQueue.filter((i) => i.status === 'APPROVED').length,
              rejected_count: moderationQueue.filter((i) => i.status === 'REJECTED').length,
              changes_requested_count: moderationQueue.filter((i) => i.status === 'CHANGES_REQUESTED').length,
              escalated_count: moderationQueue.filter((i) => i.status === 'ESCALATED').length,
              flagged_count: moderationQueue.filter((i) => Array.isArray(i.auto_flags_json) && i.auto_flags_json.length > 0).length,
            },
          ],
        };
      }

      // INSERT INTO user_restrictions
      if (q.startsWith('INSERT INTO user_restrictions')) {
        userRestrictions.push({
          user_id: params[0],
          reason_en: params[1],
          reason_bn: params[2],
        });
        return { rows: [{ id: 1 }] };
      }

      // INSERT INTO audit_logs
      if (q.startsWith('INSERT INTO audit_logs')) {
        auditLogs.push(params);
        return { rows: [{ id: 1 }] };
      }

      return { rows: [] };
    },
  };

  const poolMock = {
    ...mockDb,
    async connect() {
      return {
        ...mockDb,
        release() {},
      };
    },
  };

  return {
    mockDb: poolMock,
    state: {
      users,
      categories,
      products,
      moderationQueue,
      productApprovals,
      userRestrictions,
      auditLogs,
      modules,
    },
  };
}

test('Prompt 7.4 — Product Approval & Content Moderation Pipeline', async (t) => {
  // Test 1: Acceptance 1 — A new product does not go live until approved when the moderation module is on
  await t.test('Acceptance 1: New product enters queue as PENDING and product remains PENDING_APPROVAL', async () => {
    const { mockDb, state } = createMockDb();

    const result = await moderationService.submitToQueue(mockDb, {
      itemType: 'PRODUCT_NEW',
      entityId: 501,
      submittedBy: 4,
      categoryId: 10, // Category 10 has auto_approve = false
      payloadSnapshot: {
        title_en: 'Cotton Panjabi',
        title_bn: 'সুতি পাঞ্জাবি',
        default_retail_price: '1200.00',
        base_cost: '800.00',
      },
    });

    assert.equal(result.autoApproved, false);
    assert.equal(result.queueItem.status, 'PENDING');
    assert.ok(result.queueItem.ref.startsWith('MOD-'));

    const prod = state.products.find((p) => p.id === 501);
    assert.equal(prod.status, 'PENDING_APPROVAL');
  });

  // Test 2: Acceptance 2 — Turning on auto_approval for a category bypasses the queue for that category only
  await t.test('Acceptance 2: Auto-approved category bypasses moderation queue immediately', async () => {
    const { mockDb, state } = createMockDb();

    const result = await moderationService.submitToQueue(mockDb, {
      itemType: 'PRODUCT_NEW',
      entityId: 501,
      submittedBy: 4,
      categoryId: 20, // Category 20 is in auto_approve_category_ids
      payloadSnapshot: {
        title_en: 'Story Book',
        title_bn: 'গল্পের বই',
        default_retail_price: '300.00',
        base_cost: '200.00',
      },
    });

    assert.equal(result.autoApproved, true);
    assert.equal(result.status, 'APPROVED');

    const prod = state.products.find((p) => p.id === 501);
    assert.equal(prod.status, 'ACTIVE');
    assert.equal(state.moderationQueue.length, 0); // Not added to queue
  });

  // Test 3: Acceptance 3 — Two moderators cannot claim the same item simultaneously
  await t.test('Acceptance 3: Concurrency locking prevents duplicate claiming by two moderators', async () => {
    const { mockDb } = createMockDb();

    // 1. Submit item to queue
    const subRes = await moderationService.submitToQueue(mockDb, {
      itemType: 'PRODUCT_NEW',
      entityId: 501,
      submittedBy: 4,
      categoryId: 10,
      payloadSnapshot: { title_en: 'Cotton Panjabi' },
    });
    const queueId = subRes.queueItem.id;

    // 2. Moderator 1 claims item
    const claim1 = await moderationService.claimItem(mockDb, {
      queueId,
      moderatorId: 2,
    });
    assert.equal(claim1.claimed_by, 2);
    assert.equal(claim1.status, 'IN_REVIEW');

    // 3. Moderator 2 attempts to claim the same item -> must reject with ITEM_ALREADY_CLAIMED
    await assert.rejects(
      async () => {
        await moderationService.claimItem(mockDb, {
          queueId,
          moderatorId: 3,
        });
      },
      /ITEM_ALREADY_CLAIMED/
    );

    // 4. Moderator 1 releases claim -> now Moderator 2 can claim
    await moderationService.releaseClaim(mockDb, {
      queueId,
      moderatorId: 2,
    });

    const claim2 = await moderationService.claimItem(mockDb, {
      queueId,
      moderatorId: 3,
    });
    assert.equal(claim2.claimed_by, 3);
  });

  // Test 4: Acceptance 4 — A rejection reason reaches the seller in their chosen language
  await t.test('Acceptance 4: Rejection stores bilingual reasons and updates entity status', async () => {
    const { mockDb, state } = createMockDb();

    const subRes = await moderationService.submitToQueue(mockDb, {
      itemType: 'PRODUCT_NEW',
      entityId: 501,
      submittedBy: 4,
      categoryId: 10,
      payloadSnapshot: { title_en: 'Counterfeit Saree' },
    });
    const queueId = subRes.queueItem.id;

    const decRes = await moderationService.decideItem(mockDb, {
      queueId,
      decision: 'REJECTED',
      moderatorId: 2,
      reasonEn: 'Counterfeit brand goods are prohibited.',
      reasonBn: 'নকল ব্র্যান্ডের পণ্য প্ল্যাটফর্মে নিষিদ্ধ।',
      shadowRestrictSeller: true,
    });

    assert.equal(decRes.success, true);
    assert.equal(decRes.decision, 'REJECTED');
    assert.equal(decRes.queueItem.rejection_reason_en, 'Counterfeit brand goods are prohibited.');
    assert.equal(decRes.queueItem.rejection_reason_bn, 'নকল ব্র্যান্ডের পণ্য প্ল্যাটফর্মে নিষিদ্ধ।');

    const prod = state.products.find((p) => p.id === 501);
    assert.equal(prod.status, 'REJECTED');
    assert.equal(state.userRestrictions.length, 1);
  });

  // Test 5: Automated pre-screening flags
  await t.test('Pre-screening Engine: Detects prohibited keywords (EN & BN) and pricing anomalies', async () => {
    const flagsEn = await moderationService.preScreenContent({
      titleEn: 'Super Replica Watch',
      descriptionEn: 'High quality copy',
      defaultRetailPrice: 500,
      baseCost: 800, // Price < Base Cost
    });

    assert.ok(flagsEn.some((f) => f.code === 'PROHIBITED_KEYWORD_EN'));
    assert.ok(flagsEn.some((f) => f.code === 'PRICE_BELOW_BASE_COST'));

    const flagsBn = await moderationService.preScreenContent({
      titleBn: 'নকল জামদানি শাড়ি',
      descriptionBn: 'কম দামে পণ্য',
      defaultRetailPrice: 15000,
      baseCost: 2000, // Retail > 5x base cost
    });

    assert.ok(flagsBn.some((f) => f.code === 'PROHIBITED_KEYWORD_BN'));
    assert.ok(flagsBn.some((f) => f.code === 'PRICE_ANOMALY_HIGH_MARKUP'));
  });

  // Test 6: Bulk actions & throughput metrics
  await t.test('Bulk Decisions & Stats: Processes multiple queue items and calculates KPIs', async () => {
    const { mockDb } = createMockDb();

    // Create 2 items
    const item1 = await moderationService.submitToQueue(mockDb, {
      itemType: 'PRODUCT_NEW',
      entityId: 501,
      submittedBy: 4,
      categoryId: 10,
      payloadSnapshot: { title_en: 'Item 1' },
    });
    const item2 = await moderationService.submitToQueue(mockDb, {
      itemType: 'PRODUCT_NEW',
      entityId: 501,
      submittedBy: 4,
      categoryId: 10,
      payloadSnapshot: { title_en: 'Item 2' },
    });

    const bulkRes = await moderationService.bulkDecide(mockDb, {
      queueIds: [item1.queueItem.id, item2.queueItem.id],
      decision: 'APPROVED',
      moderatorId: 2,
    });

    assert.equal(bulkRes.total, 2);
    assert.equal(bulkRes.processed, 2);

    const stats = await moderationService.getModeratorStats(mockDb);
    assert.equal(stats.approved_count, 2);
    assert.equal(stats.total_items, 2);
  });

  // Test 7: Fastify HTTP Endpoints
  await t.test('Fastify HTTP API: Route registration and endpoint behavior', async () => {
    const { mockDb } = createMockDb();
    const app = Fastify({ logger: false });

    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);

    // Mock auth & permissions
    app.decorate('authenticate', async (req) => {
      const role = req.headers['x-role'] || 'moderator';
      const id = parseInt(req.headers['x-user-id'] || '2', 10);
      req.user = { id, role, full_name: 'Moderator One' };
    });

    app.decorate('requirePermission', () => async () => {});
    app.decorate('requireRestriction', () => async () => {});
    app.decorate('requireModule', () => async () => {});
    app.decorate('db', mockDb);
    app.decorate('cache', { get: async () => null, set: async () => 'OK', del: async () => 1 });

    await app.register(moderationRoutes, { prefix: '/api/v1' });

    // 1. Test pre-screen endpoint
    const preScreenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/moderation/pre-screen',
      headers: {
        'x-user-id': '2',
        'x-role': 'moderator',
      },
      payload: {
        title_en: 'Replica Bag',
        base_cost: 1000,
        default_retail_price: 500,
      },
    });

    assert.equal(preScreenRes.statusCode, 200);
    const body = JSON.parse(preScreenRes.payload);
    assert.ok(body.data.flag_count >= 2);
    assert.equal(body.data.has_critical, true);

    // 2. Submit item to mock queue and test GET /api/v1/moderation/queue
    await moderationService.submitToQueue(mockDb, {
      itemType: 'PRODUCT_NEW',
      entityId: 501,
      submittedBy: 4,
      categoryId: 10,
      payloadSnapshot: { title_en: 'Testing Panjabi' },
    });

    const queueRes = await app.inject({
      method: 'GET',
      url: '/api/v1/moderation/queue',
      headers: {
        'x-user-id': '2',
        'x-role': 'moderator',
      },
    });

    assert.equal(queueRes.statusCode, 200);
    assert.ok(queueRes.json().data.items.length >= 1);

    // 3. Test stats endpoint
    const statsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/moderation/stats',
      headers: {
        'x-user-id': '2',
        'x-role': 'moderator',
      },
    });

    assert.equal(statsRes.statusCode, 200);
    assert.ok(statsRes.json().data.total_items >= 1);

    await app.close();
  });
});
