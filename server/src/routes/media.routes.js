/**
 * media.routes.js — Media routing & static storage server (Prompt 4.2).
 */

import * as mediaController from '../controllers/media.controller.js';
import { getStorageDriver } from '../integrations/storage/index.js';
import { MAX_IMAGE_SIZE_BYTES } from '../services/media.service.js';
import { AppError } from '../plugins/errorHandler.js';

// WHY: /media/direct carries the file as a base64 data URL inside JSON, which is ~4/3 the file's
// size. Fastify's default 1MB body limit rejected any photo over ~750KB with a bare 413 before the
// service could apply its own 8MB rule, so a normal phone photo could never be uploaded.
const DIRECT_UPLOAD_BODY_LIMIT = Math.ceil((MAX_IMAGE_SIZE_BYTES * 4) / 3) + 64 * 1024;

export default async function mediaRoutes(app) {
  // WHY authenticate: the service stamps media_assets.owner_id from req.user, and product/avatar
  // linking only accepts media the caller owns. Without a guard req.user was never populated, so
  // every upload was ownerless — anonymous writes to storage, and unusable by the uploader.
  // Same fallback as product.routes.js for minimal test apps that simulate req.user themselves.
  const authenticate =
    app.authenticate ||
    (async (req) => {
      if (!req.user) throw new AppError('AUTH_REQUIRED', 'Sign in required.', 'সাইন ইন করা প্রয়োজন।');
    });

  // Static route to serve files from local storage driver in development
  app.get('/storage/*', async (req, reply) => {
    const key = req.params['*'];
    const driver = getStorageDriver();
    const obj = await driver.getObject({ key });

    if (!obj || !obj.buffer) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'File not found' } });
    }

    const ext = key.split('.').pop()?.toLowerCase();
    const mimeMap = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      avif: 'image/avif',
      mp4: 'video/mp4',
    };

    const contentType = mimeMap[ext] || 'application/octet-stream';
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(obj.buffer);
  });

  // Media API endpoints
  app.post('/media/upload-url', { preHandler: [authenticate] }, mediaController.requestUpload);
  app.post('/media/confirm', { preHandler: [authenticate] }, mediaController.confirmUpload);
  app.post(
    '/media/direct',
    { preHandler: [authenticate], bodyLimit: DIRECT_UPLOAD_BODY_LIMIT },
    mediaController.directUpload
  );
  app.get('/media', mediaController.listMedia);
  app.get('/media/:id', mediaController.getMedia);
}
