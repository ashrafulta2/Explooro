/**
 * mediaPipeline.test.js — Test suite for Prompt 4.2 (Media Pipeline, Storage Drivers, Magic Bytes & Derivatives).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import mediaRoutes from '../src/routes/media.routes.js';
import {
  detectMimeType,
  detectDimensions,
  generateDerivatives,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
} from '../src/services/media.service.js';
import { getStorageDriver, localStorageDriver } from '../src/integrations/storage/index.js';

function createMockDb() {
  const assets = [];

  return {
    assets,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('INSERT INTO media_assets')) {
        const newAsset = {
          id: assets.length + 1,
          ref: params[0],
          owner_id: params[1],
          purpose: params[2],
          storage_driver: params[3],
          storage_key: params[4],
          mime_type: params[5],
          size_bytes: params[6],
          width: params[7],
          height: params[8],
          duration_seconds: params[9],
          derivatives_json: typeof params[10] === 'string' ? JSON.parse(params[10]) : params[10],
          poster_media_id: params[11],
          quality_score: params[12],
          moderation_status: params[13],
          created_at: new Date().toISOString(),
          deleted_at: null,
        };
        assets.push(newAsset);
        return { rows: [newAsset] };
      }

      if (normalized.startsWith('SELECT * FROM media_assets') && normalized.includes('WHERE id = $1')) {
        const found = assets.find((a) => a.id === parseInt(params[0], 10));
        return { rows: found ? [found] : [] };
      }

      if (normalized.startsWith('SELECT * FROM media_assets') && normalized.includes('WHERE ref = $1')) {
        const found = assets.find((a) => a.ref === params[0]);
        return { rows: found ? [found] : [] };
      }

      if (normalized.startsWith('SELECT * FROM media_assets')) {
        return { rows: [...assets] };
      }

      return { rows: [] };
    },
  };
}

describe('Media Pipeline (Prompt 4.2)', () => {
  let app;
  let mockDb;

  // Valid 1x1 sample PNG buffer
  const validPngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  // Valid sample JPEG buffer header
  const validJpgBuffer = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11,
    0x08, 0x01, 0x90, 0x02, 0x58, 0x03, 0x01, 0x22, 0x00, 0xFF, 0xD9,
  ]); // 600x400 JPG

  // Fake Windows executable buffer (MZ header)
  const fakeExeBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

  before(async () => {
    mockDb = createMockDb();
    app = Fastify({ logger: false });
    app.decorate('db', mockDb);

    app.addHook('onRequest', (req, reply, done) => {
      req.user = { id: 101, ref: 'USR-SUPP-DHAKA', role: 'supplier', restrictions: [] };
      done();
    });

    app.register(requestContextPlugin);
    app.register(errorHandlerPlugin);
    await app.register(mediaRoutes, { prefix: '/api/v1' });

    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('Acceptance 1: With STORAGE_DRIVER=local, uploading a product image works end-to-end with zero cloud credentials', async () => {
    // 1. Request upload URL
    const initRes = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload-url',
      payload: {
        purpose: 'PRODUCT',
        mime_type: 'image/png',
        size_bytes: validPngBuffer.length,
        filename: 'shirt.png',
      },
    });

    assert.equal(initRes.statusCode, 201);
    const initBody = initRes.json();
    assert.ok(initBody.uploadUrl);
    assert.ok(initBody.storageKey);

    // 2. Direct upload to local storage
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/media/direct',
      payload: {
        purpose: 'PRODUCT',
        filename: 'shirt.png',
        data_base64: validPngBuffer.toString('base64'),
      },
    });

    assert.equal(uploadRes.statusCode, 201);
    const asset = uploadRes.json().asset;
    assert.equal(asset.mime_type, 'image/png');
    assert.equal(asset.storage_driver, 'LOCAL');
    assert.equal(asset.moderation_status, 'APPROVED');
    assert.ok(asset.url.startsWith('/storage/'));

    // 3. Confirm static route serves the uploaded asset
    const serveRes = await app.inject({
      method: 'GET',
      url: `/api/v1${asset.url}`,
    });
    assert.equal(serveRes.statusCode, 200);
    assert.equal(serveRes.headers['content-type'], 'image/png');
  });

  test('Acceptance 2: A 10MB image is rejected server-side with 413 MEDIA_TOO_LARGE', async () => {
    const tenMbSize = 10 * 1024 * 1024;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload-url',
      payload: {
        purpose: 'PRODUCT',
        mime_type: 'image/jpeg',
        size_bytes: tenMbSize,
        filename: 'large-photo.jpg',
      },
    });

    assert.equal(res.statusCode, 413);
    const body = res.json();
    assert.equal(body.error.code, 'MEDIA_TOO_LARGE');
    assert.ok(body.error.message_en.includes('10.0MB'));
    assert.ok(body.error.message_bn);
  });

  test('Acceptance 3: Uploading a .exe renamed to .jpg is rejected by magic-byte sniffing with 415 MEDIA_TYPE_REJECTED', async () => {
    // Attempt direct upload of fake .exe masquerading as .jpg
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/direct',
      payload: {
        purpose: 'PRODUCT',
        filename: 'malware.jpg',
        data_base64: fakeExeBuffer.toString('base64'),
      },
    });

    assert.equal(res.statusCode, 415);
    const body = res.json();
    assert.equal(body.error.code, 'MEDIA_TYPE_REJECTED');
    assert.ok(body.error.message_bn);
  });

  test('Acceptance 4: Derivatives are generated across breakpoints (thumb, card, detail) with aspect ratios', () => {
    const key = 'product/12345_MED-TEST.jpg';
    const derivatives = generateDerivatives(key, localStorageDriver, 1200, 800);

    assert.ok(derivatives.thumb);
    assert.equal(derivatives.thumb.width, 200);
    assert.equal(derivatives.thumb.height, 133);
    assert.ok(derivatives.thumb.webp.includes('/storage/derivatives/thumb/'));
    assert.ok(derivatives.thumb.avif.includes('/storage/derivatives/thumb/'));
    assert.ok(derivatives.thumb.jpg.includes('/storage/derivatives/thumb/'));

    assert.ok(derivatives.card);
    assert.equal(derivatives.card.width, 400);
    assert.equal(derivatives.card.height, 267);

    assert.ok(derivatives.detail);
    assert.equal(derivatives.detail.width, 1200);
    assert.equal(derivatives.detail.height, 800);
  });

  test('Acceptance 5: Upload by user with FORCE_REVIEW_QUEUE restriction is marked PENDING moderation', async () => {
    // App with restricted user hook
    const restrictedApp = Fastify({ logger: false });
    restrictedApp.decorate('db', mockDb);
    restrictedApp.addHook('onRequest', (req, reply, done) => {
      req.user = {
        id: 105,
        ref: 'USR-RESTRICTED',
        role: 'saler',
        restrictions: [
          { capability_key: 'can_upload_media', mode: 'FORCE_REVIEW_QUEUE' },
        ],
      };
      done();
    });

    restrictedApp.register(requestContextPlugin);
    restrictedApp.register(errorHandlerPlugin);
    await restrictedApp.register(mediaRoutes, { prefix: '/api/v1' });
    await restrictedApp.ready();

    const uploadRes = await restrictedApp.inject({
      method: 'POST',
      url: '/api/v1/media/direct',
      payload: {
        purpose: 'PRODUCT',
        filename: 'restricted_upload.png',
        data_base64: validPngBuffer.toString('base64'),
      },
    });

    assert.equal(uploadRes.statusCode, 201);
    const asset = uploadRes.json().asset;
    assert.equal(asset.moderation_status, 'PENDING');

    await restrictedApp.close();
  });
});
