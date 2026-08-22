/**
 * media.routes.js — Media routing & static storage server (Prompt 4.2).
 */

import * as mediaController from '../controllers/media.controller.js';
import { getStorageDriver } from '../integrations/storage/index.js';

export default async function mediaRoutes(app) {
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
  app.post('/media/upload-url', mediaController.requestUpload);
  app.post('/media/confirm', mediaController.confirmUpload);
  app.post('/media/direct', mediaController.directUpload);
  app.get('/media', mediaController.listMedia);
  app.get('/media/:id', mediaController.getMedia);
}
