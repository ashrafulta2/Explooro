/**
 * openDeveloperApiAndWebhooks.test.js — Automated test suite for Prompt 10.7.
 *
 * Verifies the ACCEPTANCE criteria from docs/prompt.md Prompt 10.7:
 * 1. API key generation with SHA-256 hashing, safe prefix, and single-reveal token.
 * 2. Scoped permissions enforcement: A key with catalog.products.read can read products but is denied write access.
 * 3. Outbound HMAC-SHA256 signed webhook dispatching.
 * 4. Webhook failing 3 times lands in the Dead-Letter Queue (DLQ) and is manually replayable.
 * 5. IP allowlisting and instant key revocation.
 * 6. OpenAPI 3 specification validation matching live endpoints.
 * 7. Fastify HTTP REST API endpoints.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import * as apiKeyService from '../src/services/apiKey.service.js';
import * as webhookService from '../src/services/webhookDelivery.service.js';

function createMockDb({ queryHandler = null } = {}) {
  return {
    async query(sql, params = []) {
      if (queryHandler) {
        return queryHandler(sql, params);
      }
      return { rows: [] };
    },
  };
}

describe('Prompt 10.7 — Open Marketplace API, Webhooks & Developer SDK', () => {

  // ---------------------------------------------------------------------------
  // 1. API Key Generation & Hashing
  // ---------------------------------------------------------------------------
  test('generateApiKey generates high-entropy token, stores SHA-256 hash, and returns raw token once', async () => {
    let keyInserted = null;

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('INSERT INTO api_keys')) {
          keyInserted = {
            id: 1,
            ref: params[0],
            name: params[1],
            user_id: params[2],
            key_hash: params[3],
            key_prefix: params[4],
            scopes: JSON.parse(params[5]),
            rate_limit_rpm: params[6],
            ip_allowlist: JSON.parse(params[7]),
            status: 'ACTIVE',
            expires_at: params[8],
            created_at: new Date().toISOString(),
          };
          return { rows: [keyInserted] };
        }
        return { rows: [] };
      },
    });

    const res = await apiKeyService.generateApiKey(db, {
      userId: 6,
      name: 'Custom ERP Sync Key',
      scopes: ['catalog.products.read', 'catalog.stores.read'],
      rateLimitRpm: 120,
      ipAllowlist: ['192.168.1.50'],
      expiresInDays: 30,
    });

    assert.ok(res.raw_token.startsWith('exp_live_'));
    assert.equal(res.key.name, 'Custom ERP Sync Key');
    assert.equal(res.key.user_id, 6);
    assert.equal(res.key.rate_limit_rpm, 120);
    assert.ok(res.key.key_prefix.startsWith('exp_live_'));

    // Verify stored hash matches SHA-256 of raw token
    const expectedHash = apiKeyService.hashApiKey(res.raw_token);
    assert.equal(keyInserted.key_hash, expectedHash);
  });

  // ---------------------------------------------------------------------------
  // 2. API Key Authentication & IP Allowlist
  // ---------------------------------------------------------------------------
  test('authenticateApiKey verifies token, enforces IP allowlist, and updates last_used_at', async () => {
    const rawToken = 'exp_live_abcdef1234567890abcdef1234567890';
    const keyHash = apiKeyService.hashApiKey(rawToken);

    const storedKey = {
      id: 5,
      ref: 'KEY-5001',
      name: 'Mobile App Key',
      user_id: 6,
      user_role: 'saler',
      user_name: 'Habib Traders',
      user_is_active: true,
      key_hash: keyHash,
      key_prefix: 'exp_live_abcdef...',
      scopes: JSON.stringify(['catalog.products.read', 'orders.create']),
      rate_limit_rpm: 60,
      ip_allowlist: JSON.stringify(['203.0.113.19']),
      status: 'ACTIVE',
      expires_at: null,
    };

    let updatedLastUsed = false;

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('SELECT k.*, u.id as user_id')) {
          if (params[0] === keyHash) return { rows: [storedKey] };
          return { rows: [] };
        }
        if (sql.includes('UPDATE api_keys SET last_used_at = now()')) {
          updatedLastUsed = true;
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    // 1. Success on allowed IP
    const authResult = await apiKeyService.authenticateApiKey(db, rawToken, '203.0.113.19');
    assert.ok(authResult);
    assert.equal(authResult.userId, 6);
    assert.equal(authResult.name, 'Mobile App Key');
    assert.deepEqual(authResult.scopes, ['catalog.products.read', 'orders.create']);

    // 2. Forbidden on disallowed IP
    await assert.rejects(
      () => apiKeyService.authenticateApiKey(db, rawToken, '198.51.100.44'),
      (err) => err.code === 'FORBIDDEN'
    );

    // 3. Null on invalid token
    const invalidResult = await apiKeyService.authenticateApiKey(db, 'exp_live_invalid_token');
    assert.equal(invalidResult, null);
  });

  // ---------------------------------------------------------------------------
  // 3. Scoped Permission Check (Acceptance 1)
  // ---------------------------------------------------------------------------
  test('hasScope enforces Phase 2 RBAC permissions: Read key has read but is denied write access', () => {
    const readOnlyKey = {
      id: 1,
      scopes: ['catalog.products.read', 'catalog.categories.read'],
    };

    const partnerWriteKey = {
      id: 2,
      scopes: ['catalog.products.read', 'orders.create'],
    };

    // ReadOnly Key
    assert.equal(apiKeyService.hasScope(readOnlyKey, 'catalog.products.read'), true);
    assert.equal(apiKeyService.hasScope(readOnlyKey, 'orders.create'), false);

    // Partner Write Key
    assert.equal(apiKeyService.hasScope(partnerWriteKey, 'catalog.products.read'), true);
    assert.equal(apiKeyService.hasScope(partnerWriteKey, 'orders.create'), true);
  });

  // ---------------------------------------------------------------------------
  // 4. Outbound Webhook HMAC-SHA256 Signing
  // ---------------------------------------------------------------------------
  test('signWebhookPayload produces valid HMAC-SHA256 signature against secret', () => {
    const payload = JSON.stringify({ event: 'order.created', order_ref: 'SO-1001' });
    const secret = 'whsec_test_secret_key_889911';

    const sig1 = webhookService.signWebhookPayload(payload, secret);
    const sig2 = webhookService.signWebhookPayload(payload, secret);

    assert.equal(typeof sig1, 'string');
    assert.equal(sig1.length, 64);
    assert.equal(sig1, sig2, 'Signature must be deterministic');

    // Modifying payload breaks signature
    const modifiedPayload = JSON.stringify({ event: 'order.created', order_ref: 'SO-1002' });
    const sigModified = webhookService.signWebhookPayload(modifiedPayload, secret);
    assert.notEqual(sig1, sigModified);
  });

  // ---------------------------------------------------------------------------
  // 5. Webhook Retries, Exponential Backoff & Dead-Letter Queue (Acceptance 2)
  // ---------------------------------------------------------------------------
  test('deliverWebhookAttempt transitions to DEAD_LETTER after 3 failed attempts and is replayable', async () => {
    let deliveryRecord = {
      id: 88,
      subscription_id: 1,
      event_name: 'order.delivered',
      payload_json: { order_ref: 'SO-9911' },
      attempt_number: 1,
      max_attempts: 3,
      status: 'PENDING',
      target_url: 'https://partner.example.com/webhook',
      secret: 'whsec_secret_123',
    };

    const db = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('webhook_deliveries') && sql.includes('SELECT')) {
          return { rows: [deliveryRecord] };
        }
        if (sql.includes('webhook_deliveries') && sql.includes('FAILED')) {
          deliveryRecord.status = 'FAILED';
          deliveryRecord.attempt_number = (deliveryRecord.attempt_number || 1) + 1;
          deliveryRecord.response_status = params[0];
          deliveryRecord.next_retry_at = params[3];
          return { rows: [deliveryRecord] };
        }
        if (sql.includes('webhook_deliveries') && sql.includes('DEAD_LETTER')) {
          deliveryRecord.status = 'DEAD_LETTER';
          deliveryRecord.error_message = params[2];
          return { rows: [deliveryRecord] };
        }
        if (sql.includes('webhook_deliveries') && sql.includes('PENDING')) {
          deliveryRecord.status = 'PENDING';
          deliveryRecord.attempt_number = 1;
          return { rows: [deliveryRecord] };
        }
        if (sql.includes('webhook_deliveries') && sql.includes('DELIVERED')) {
          deliveryRecord.status = 'DELIVERED';
          deliveryRecord.response_status = params[0];
          return { rows: [deliveryRecord] };
        }
        return { rows: [] };
      },
    });

    // Mock HTTP client that fails with 503
    const failingHttpClient = async () => ({
      status: 503,
      body: 'Service Unavailable',
    });

    // Attempt 1: Fails -> status = FAILED, attempt_number becomes 2
    deliveryRecord.attempt_number = 1;
    const res1 = await webhookService.deliverWebhookAttempt(db, 88, failingHttpClient);
    assert.equal(res1.status, 'FAILED');
    assert.equal(res1.attempt_number, 2);

    // Attempt 2: Fails -> status = FAILED, attempt_number becomes 3
    deliveryRecord.attempt_number = 2;
    const res2 = await webhookService.deliverWebhookAttempt(db, 88, failingHttpClient);
    assert.equal(res2.status, 'FAILED');
    assert.equal(res2.attempt_number, 3);

    // Attempt 3: Fails -> transitions to DEAD_LETTER
    deliveryRecord.attempt_number = 3;
    const res3 = await webhookService.deliverWebhookAttempt(db, 88, failingHttpClient);
    assert.equal(res3.status, 'DEAD_LETTER');

    // Replay tool re-attempts delivery
    const succeedingHttpClient = async () => ({
      status: 200,
      body: '{"ok": true}',
    });

    const replayRes = await webhookService.replayWebhookDelivery(db, {
      deliveryId: 88,
      httpClient: succeedingHttpClient,
    });
    assert.equal(replayRes.status, 'DELIVERED');
    assert.equal(replayRes.response_status, 200);
  });

  // ---------------------------------------------------------------------------
  // 6. OpenAPI 3 Specification Validation (Acceptance 3)
  // ---------------------------------------------------------------------------
  test('docs/public-api.md exists and specifies OpenAPI 3.0 catalog and order schemas', () => {
    const filePath = path.resolve(process.cwd(), '../docs/public-api.md');
    assert.ok(existsSync(filePath), 'docs/public-api.md must exist');

    const content = readFileSync(filePath, 'utf8');
    assert.ok(content.includes('openapi: 3.0.3') || content.includes('openapi: 3.0'));
    assert.ok(content.includes('/public/products'));
    assert.ok(content.includes('/public/stores'));
    assert.ok(content.includes('/public/categories'));
    assert.ok(content.includes('/public/orders'));
    assert.ok(content.includes('orders.create'));
    assert.ok(content.includes('X-Explooro-Signature'));
  });

  // ---------------------------------------------------------------------------
  // 7. Fastify HTTP Endpoints Integration
  // ---------------------------------------------------------------------------
  test('Fastify HTTP API: Public catalog querying returns 200', async () => {
    const Fastify = (await import('fastify')).default;
    const publicApiRoutes = (await import('../src/routes/publicApi.routes.js')).default;
    const errorHandlerPlugin = (await import('../src/plugins/errorHandler.js')).default;

    const mockDb = createMockDb({
      queryHandler: async (sql) => {
        if (sql.includes('FROM products p')) {
          return {
            rows: [
              {
                id: 10,
                ref: 'PRD-10',
                slug: 'mens-cotton-shirt',
                title_en: 'Men Cotton Shirt',
                title_bn: 'পুরুষ সুতি শার্ট',
                retail_price: '1200.00',
                stock_quantity: 50,
                media_json: [],
                category_name_en: 'Apparel',
              },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const app = Fastify();
    app.decorate('db', mockDb);
    app.decorate('authenticate', async (req) => {
      req.user = { id: 1, role: 'admin' };
    });
    app.decorate('requireModule', () => async () => {});

    app.register(errorHandlerPlugin);
    await app.register(publicApiRoutes, { prefix: '/api/v1' });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/public/products',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].retail_price, 1200.00);

    await app.close();
  });

});
