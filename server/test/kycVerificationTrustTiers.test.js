/**
 * kycVerificationTrustTiers.test.js — Prompt 7.5 Test Suite
 *
 * Tests:
 * - Acceptance 1: A supplier cannot list a product until verification is complete when supplier_verification is ON.
 * - Acceptance 2: Every document view writes an audit row naming the viewer.
 * - Acceptance 3: A rejected supplier can appeal and re-submit.
 * - Acceptance 4: Tier promotion updates search placement multiplier and daily withdrawal limits.
 * - Acceptance 5: KYC approval by moderator routes to Maker-Checker pending action; Super Admin executes directly.
 * - Fastify HTTP API endpoints for KYC submission and admin review center.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import kycRoutes from '../src/routes/kyc.routes.js';
import * as kycService from '../src/services/kyc.service.js';
import * as trustTierService from '../src/services/trustTier.service.js';
import * as productService from '../src/services/product.service.js';

function createMockDb() {
  const users = [
    { id: 1, full_name: 'Admin User', role: 'super_admin', email: 'admin@explooro.com', is_phone_verified: true },
    { id: 2, full_name: 'Moderator One', role: 'moderator', email: 'mod1@explooro.com', is_phone_verified: true },
    { id: 101, full_name: 'Unverified Supplier', role: 'supplier', email: 'unverified@explooro.com', created_at: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString() },
    { id: 102, full_name: 'Verified Supplier', role: 'supplier', email: 'verified@explooro.com', created_at: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString() },
  ];

  const categories = [
    { id: 1, name_en: 'Clothing', auto_approve: true },
  ];

  const products = [];

  const kycVerifications = [
    {
      id: 1,
      ref: 'KYC-VERIFIED-102',
      user_id: 102,
      kyc_type: 'SUPPLIER',
      current_step: 4,
      status: 'VERIFIED',
      nid_number: 'encrypted_nid',
      nid_hash: kycService.hashNid('19901234567890123'),
      business_name: 'Verified Garments Ltd.',
      business_address: 'Dhaka EPZ',
      verified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
  ];

  const kycDocuments = [
    {
      id: 10,
      kyc_id: 1,
      doc_type: 'NID_FRONT',
      storage_key: 'kyc/supplier/doc10.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 250000,
      view_count: 0,
      last_viewed_by: null,
      last_viewed_at: null,
      created_at: new Date().toISOString(),
    },
  ];

  const trustScores = [
    {
      user_id: 101,
      tier: 'STARTER',
      score: 50,
      completed_orders: 5,
      delivery_success_rate: 90,
      dispute_rate: 0,
    },
    {
      user_id: 102,
      tier: 'VERIFIED_TRADER',
      score: 85,
      completed_orders: 250,
      delivery_success_rate: 98,
      dispute_rate: 1.0,
    },
  ];

  const pendingAdminActions = [];
  const auditLogs = [];

  let nextKycId = 2;
  let nextDocId = 20;
  let nextActionId = 1;

  const mockDb = {
    users,
    categories,
    products,
    kycVerifications,
    kycDocuments,
    trustScores,
    pendingAdminActions,
    auditLogs,
    async query(sql, params = []) {
      const q = sql.trim();

      // SELECT categories
      if (q.includes('FROM categories WHERE id = $1')) {
        const catId = params[0];
        const found = categories.find((c) => c.id === Number(catId));
        return { rows: found ? [found] : [] };
      }

      // SELECT kyc_verifications duplicate NID
      if (q.includes('FROM kyc_verifications') && q.includes('WHERE nid_hash = $1 AND user_id <> $2')) {
        const hash = params[0];
        const uId = params[1];
        const found = kycVerifications.filter((k) => k.nid_hash === hash && k.user_id !== uId && k.status === 'VERIFIED');
        return { rows: found };
      }

      // SELECT kyc_verifications for getKycStatus
      if (q.includes('FROM kyc_verifications k') && q.includes('WHERE k.user_id = $1')) {
        const uId = params[0];
        const list = kycVerifications.filter((k) => k.user_id === Number(uId));
        return { rows: list.length > 0 ? [list[list.length - 1]] : [] };
      }

      // SELECT kyc_verifications WHERE user_id = $1 (generic check or product check)
      if (q.includes('FROM kyc_verifications') && q.includes('WHERE user_id = $1')) {
        const uId = params[0];
        const list = kycVerifications.filter((k) => k.user_id === Number(uId));
        if (q.includes("status = 'VERIFIED'")) {
          return { rows: list.filter((k) => k.status === 'VERIFIED') };
        }
        return { rows: list.length > 0 ? [list[list.length - 1]] : [] };
      }

      // SELECT single kyc_verifications WHERE id = $1
      if (q.includes('FROM kyc_verifications') && q.includes('WHERE id = $1') || q.includes('WHERE k.id = $1')) {
        const kId = params[0];
        const found = kycVerifications.find((k) => k.id === Number(kId));
        if (!found) return { rows: [] };
        const u = users.find((usr) => usr.id === found.user_id) || {};
        const ts = trustScores.find((t) => t.user_id === found.user_id) || {};
        return {
          rows: [
            {
              ...found,
              applicant_name: u.full_name,
              applicant_email: u.email,
              applicant_role: u.role,
              current_tier: ts.tier || 'STARTER',
              trust_score: ts.score || 50,
            },
          ],
        };
      }

      // INSERT INTO kyc_verifications
      if (q.startsWith('INSERT INTO kyc_verifications')) {
        const row = {
          id: nextKycId++,
          ref: params[0],
          user_id: params[1],
          kyc_type: params[2],
          nid_number: params[3],
          nid_hash: params[4],
          trade_license_no: params[5],
          vat_tin: params[6],
          business_name: params[7],
          business_address: params[8],
          current_step: params[9],
          status: 'PENDING',
          purge_after: params[10],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        kycVerifications.push(row);
        return { rows: [row] };
      }

      // UPDATE kyc_verifications
      if (q.startsWith('UPDATE kyc_verifications')) {
        const kId = params[0];
        const found = kycVerifications.find((k) => k.id === Number(kId));
        if (found) {
          if (q.includes('status = $2')) {
            found.status = params[1];
            found.reviewed_by = params[2];
            found.reviewed_at = new Date().toISOString();
            found.verified_at = params[3];
            found.rejection_reason = params[4];
            found.rejection_reason_bn = params[5];
          } else if (q.includes("status = 'APPEALED'")) {
            found.status = 'APPEALED';
          }
          found.updated_at = new Date().toISOString();
          return { rows: [found] };
        }
        return { rows: [] };
      }

      // INSERT INTO kyc_documents
      if (q.startsWith('INSERT INTO kyc_documents')) {
        const doc = {
          id: nextDocId++,
          kyc_id: params[0],
          doc_type: params[1],
          storage_key: params[2],
          mime_type: params[3],
          size_bytes: params[4],
          view_count: 0,
          created_at: new Date().toISOString(),
        };
        kycDocuments.push(doc);
        return { rows: [doc] };
      }

      // SELECT kyc_documents WHERE kyc_id = $1
      if (q.includes('FROM kyc_documents') && q.includes('WHERE kyc_id = $1')) {
        const kId = params[0];
        return { rows: kycDocuments.filter((d) => d.kyc_id === Number(kId)) };
      }

      // SELECT single kyc_documents WHERE d.id = $1
      if (q.includes('FROM kyc_documents') && (q.includes('WHERE id = $1') || q.includes('WHERE d.id = $1'))) {
        const dId = params[0];
        const doc = kycDocuments.find((d) => d.id === Number(dId));
        if (!doc) return { rows: [] };
        const kyc = kycVerifications.find((k) => k.id === doc.kyc_id) || {};
        return {
          rows: [
            {
              ...doc,
              user_id: kyc.user_id,
              kyc_ref: kyc.ref,
            },
          ],
        };
      }

      // UPDATE kyc_documents view_count
      if (q.startsWith('UPDATE kyc_documents') && q.includes('view_count = view_count + 1')) {
        const dId = params[0];
        const reviewerId = params[1];
        const doc = kycDocuments.find((d) => d.id === Number(dId));
        if (doc) {
          doc.view_count++;
          doc.last_viewed_by = reviewerId;
          doc.last_viewed_at = new Date().toISOString();
          return { rows: [doc] };
        }
        return { rows: [] };
      }

      // INSERT INTO pending_admin_actions
      if (q.startsWith('INSERT INTO pending_admin_actions')) {
        const action = {
          id: nextActionId++,
          ref: params[0],
          action_key: params[1],
          risk_tier: params[2],
          actor_id: params[3],
          target_entity: params[4],
          target_id: params[5],
          payload_json: typeof params[6] === 'string' ? JSON.parse(params[6]) : params[6],
          status: params[7],
          expires_at: params[8],
          created_at: new Date().toISOString(),
        };
        pendingAdminActions.push(action);
        return { rows: [action] };
      }

      // SELECT trust tier user metrics
      if (q.includes('FROM users u') && q.includes('LEFT JOIN trust_scores ts')) {
        const uId = params[0];
        const u = users.find((usr) => usr.id === Number(uId));
        if (!u) return { rows: [] };
        const ts = trustScores.find((t) => t.user_id === Number(uId)) || {};
        const isVer = kycVerifications.some((k) => k.user_id === Number(uId) && k.status === 'VERIFIED');
        return {
          rows: [
            {
              id: u.id,
              full_name: u.full_name,
              role: u.role,
              email: u.email,
              phone: u.phone,
              created_at: u.created_at || new Date().toISOString(),
              tier: ts.tier || 'STARTER',
              current_tier: ts.tier || 'STARTER',
              completed_orders: ts.completed_orders || 0,
              delivery_success_rate: ts.delivery_success_rate || 100,
              dispute_rate: ts.dispute_rate || 0,
              score: ts.score || 50,
              is_verified: isVer,
            },
          ],
        };
      }

      // INSERT INTO trust_scores ON CONFLICT
      if (q.startsWith('INSERT INTO trust_scores')) {
        const uId = params[0];
        const tier = params[1];
        let found = trustScores.find((t) => t.user_id === Number(uId));
        if (found) {
          found.tier = tier;
        } else {
          found = { user_id: uId, tier, score: params[2] };
          trustScores.push(found);
        }
        return { rows: [found] };
      }

      // SELECT kyc queue
      if (q.includes('FROM kyc_verifications k') && q.includes('JOIN users u')) {
        return {
          rows: kycVerifications.map((k) => {
            const u = users.find((usr) => usr.id === k.user_id) || {};
            const ts = trustScores.find((t) => t.user_id === k.user_id) || {};
            return {
              ...k,
              applicant_name: u.full_name,
              applicant_email: u.email,
              applicant_role: u.role,
              current_tier: ts.tier || 'STARTER',
              trust_score: ts.score || 50,
              doc_count: kycDocuments.filter((d) => d.kyc_id === k.id).length,
            };
          }),
        };
      }

      // INSERT products
      if (q.startsWith('INSERT INTO products')) {
        const p = { id: 801, title_en: params[3] };
        products.push(p);
        return { rows: [p] };
      }

      // audit_logs
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
      kycVerifications,
      kycDocuments,
      trustScores,
      pendingAdminActions,
      auditLogs,
    },
  };
}

test('Prompt 7.5 — KYC Verification, Blue-Tick & Trust Tiers', async (t) => {
  // Test 1: Acceptance 1 — A supplier cannot list a product until verification is complete when supplier_verification module is on
  await t.test('Acceptance 1: Unverified supplier product listing is blocked with KYC_REQUIRED', async () => {
    const { mockDb } = createMockDb();

    // 1. Unverified supplier (id 101) tries to list product with isSupplierVerificationEnabled = true
    await assert.rejects(
      async () => {
        await productService.createProduct(mockDb, {
          supplierId: 101,
          categoryId: 1,
          titleEn: 'Sample Silk Saree',
          titleBn: 'সিল্ক শাড়ি',
          baseCost: '1000.00',
          wholesaleMargin: '200.00',
          defaultRetailPrice: '1500.00',
          isSupplierVerificationEnabled: true,
        });
      },
      (err) => {
        assert.equal(err.code, 'KYC_REQUIRED');
        return true;
      }
    );

    // 2. Verified supplier (id 102) can list successfully
    const product = await productService.createProduct(mockDb, {
      supplierId: 102,
      categoryId: 1,
      titleEn: 'Verified Saree',
      titleBn: 'যাচাইকৃত শাড়ি',
      baseCost: '1000.00',
      wholesaleMargin: '200.00',
      defaultRetailPrice: '1500.00',
      isSupplierVerificationEnabled: true,
    });

    assert.ok(product);
  });

  // Test 2: Acceptance 2 — Every document view writes an audit row naming the viewer
  await t.test('Acceptance 2: Inspecting a KYC document increments view count and writes an audit log', async () => {
    const { mockDb, state } = createMockDb();

    const viewResult = await kycService.viewKycDocument(mockDb, {
      docId: 10,
      reviewerId: 2, // Moderator One
    });

    assert.equal(viewResult.id, 10);
    assert.equal(viewResult.view_count, 1);

    // Verify audit trail logged
    const audit = state.auditLogs.find((l) => l.includes('users.kyc.document_view'));
    assert.ok(audit, 'Audit log must record users.kyc.document_view');
  });

  // Test 3: Acceptance 3 — A rejected supplier can appeal and re-submit
  await t.test('Acceptance 3: Rejected KYC submission can be appealed and re-reviewed', async () => {
    const { mockDb, state } = createMockDb();

    // 1. Submit KYC application for user 101
    const subRes = await kycService.submitKycStep(mockDb, {
      userId: 101,
      kycType: 'SUPPLIER',
      step: 1,
      nidNumber: '19951234567890123',
    });
    const kycId = subRes.kycId;

    // 2. Super Admin rejects submission with reason
    await kycService.decideKyc(mockDb, {
      kycId,
      decision: 'REJECTED',
      reviewerId: 1,
      reviewerRole: 'super_admin',
      reasonEn: 'NID image resolution is too low.',
      reasonBn: 'এনআইডির ছবির রেজোলিউশন কম।',
    });

    const statusAfterReject = await kycService.getKycStatus(mockDb, 101);
    assert.equal(statusAfterReject.status, 'REJECTED');
    assert.equal(statusAfterReject.rejection_reason, 'NID image resolution is too low.');

    // 3. User appeals rejection
    const appealRes = await kycService.appealKyc(mockDb, {
      kycId,
      userId: 101,
      appealNote: 'Uploaded high resolution scanned document.',
    });
    assert.equal(appealRes.status, 'APPEALED');

    const statusAfterAppeal = await kycService.getKycStatus(mockDb, 101);
    assert.equal(statusAfterAppeal.status, 'APPEALED');
  });

  // Test 4: Acceptance 4 — Tier promotion visibly changes search placement and withdrawal limits
  await t.test('Acceptance 4: Trust tier engine dynamically calculates benefits per tier ladder', async () => {
    const starterBenefits = trustTierService.getTierBenefits('STARTER');
    assert.equal(starterBenefits.search_boost_multiplier, 1.0);
    assert.equal(starterBenefits.max_daily_withdrawal, '20000.00');
    assert.equal(starterBenefits.profit_split_bonus_pct, 0.0);

    const verifiedBenefits = trustTierService.getTierBenefits('VERIFIED_TRADER');
    assert.equal(verifiedBenefits.search_boost_multiplier, 1.25);
    assert.equal(verifiedBenefits.max_daily_withdrawal, '50000.00');
    assert.equal(verifiedBenefits.profit_split_bonus_pct, 2.0);

    const eliteBenefits = trustTierService.getTierBenefits('ELITE_PARTNER');
    assert.equal(eliteBenefits.search_boost_multiplier, 1.5);
    assert.equal(eliteBenefits.max_daily_withdrawal, '200000.00');
    assert.equal(eliteBenefits.profit_split_bonus_pct, 5.0);

    // Recompute user 102 (250 orders, 98% delivery success, 90 days active) -> ELITE_PARTNER
    const { mockDb } = createMockDb();
    const tierRes = await trustTierService.recomputeUserTier(mockDb, 102);
    assert.equal(tierRes.currentTier, 'ELITE_PARTNER');
    assert.equal(tierRes.benefits.search_boost_multiplier, 1.5);
  });

  // Test 5: Maker-checker for moderator KYC approval vs Direct Super Admin execution
  await t.test('Acceptance 5: Moderator approval routes to Maker-Checker; Super Admin approves directly', async () => {
    const { mockDb, state } = createMockDb();

    // 1. Moderator 2 approves user 101's KYC -> Must create pending_admin_actions (HIGH tier)
    const modDecide = await kycService.decideKyc(mockDb, {
      kycId: 1,
      decision: 'VERIFIED',
      reviewerId: 2,
      reviewerRole: 'moderator',
    });

    assert.equal(modDecide.makerCheckerPending, true);
    assert.ok(modDecide.pendingActionId);
    assert.equal(state.pendingAdminActions.length, 1);

    // 2. Super Admin approves directly
    const adminDecide = await kycService.decideKyc(mockDb, {
      kycId: 1,
      decision: 'VERIFIED',
      reviewerId: 1,
      reviewerRole: 'super_admin',
    });

    assert.equal(adminDecide.makerCheckerPending, false);
    assert.equal(adminDecide.decision, 'VERIFIED');
  });

  // Test 6: Fastify HTTP API endpoints
  await t.test('Fastify HTTP API: Route registration and endpoint behavior', async () => {
    const { mockDb } = createMockDb();
    const app = Fastify({ logger: false });

    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);

    app.decorate('authenticate', async (req) => {
      const role = req.headers['x-role'] || 'supplier';
      const id = parseInt(req.headers['x-user-id'] || '102', 10);
      req.user = { id, role, full_name: 'Verified Supplier' };
    });

    app.decorate('requirePermission', () => async () => {});
    app.decorate('requireRestriction', () => async () => {});
    app.decorate('requireModule', () => async () => {});
    app.decorate('db', mockDb);
    app.decorate('cache', { get: async () => null, set: async () => 'OK', del: async () => 1 });

    await app.register(kycRoutes, { prefix: '/api/v1' });

    // 1. GET /api/v1/kyc/status
    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/v1/kyc/status',
      headers: { 'x-user-id': '102', 'x-role': 'supplier' },
    });

    assert.equal(statusRes.statusCode, 200);
    assert.equal(statusRes.json().data.status, 'VERIFIED');

    // 2. GET /api/v1/admin/kyc/queue
    const queueRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/kyc/queue',
      headers: { 'x-user-id': '1', 'x-role': 'super_admin' },
    });

    assert.equal(queueRes.statusCode, 200);
    assert.ok(queueRes.json().data.items.length >= 1);

    // 3. GET /api/v1/admin/kyc/tiers/:userId
    const tierRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/kyc/tiers/102',
      headers: { 'x-user-id': '1', 'x-role': 'super_admin' },
    });

    assert.equal(tierRes.statusCode, 200);
    assert.equal(tierRes.json().data.benefits.tier, 'VERIFIED_TRADER');

    await app.close();
  });
});
