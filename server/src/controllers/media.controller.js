/**
 * media.controller.js — Media endpoint handlers (Prompt 4.2).
 */

import * as mediaService from '../services/media.service.js';
import * as mediaRepo from '../repositories/media.repository.js';
import { getStorageDriver } from '../integrations/storage/index.js';

export async function requestUpload(req, reply) {
  const { purpose, mime_type, size_bytes, filename } = req.body || {};
  const userId = req.user?.id || null;

  const result = await mediaService.requestUploadUrl({
    userId,
    purpose,
    mimeType: mime_type,
    sizeBytes: size_bytes,
    filename,
  });

  return reply.status(201).send(result);
}

export async function directUpload(req, reply) {
  const db = req.db || req.server?.db;
  const { purpose, filename, data_base64, storage_key } = req.body || {};
  const userId = req.user?.id || null;

  let buffer;
  if (data_base64) {
    const base64Data = data_base64.replace(/^data:([A-Za-z-+/]+);base64,/, '');
    buffer = Buffer.from(base64Data, 'base64');
  } else if (req.body instanceof Buffer) {
    buffer = req.body;
  } else if (req.rawBody) {
    buffer = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody);
  } else {
    buffer = Buffer.from('');
  }

  const asset = await mediaService.processAndSaveMedia(db, {
    userId,
    purpose: purpose || 'PRODUCT',
    buffer,
    storageKey: storage_key,
    userRestrictions: req.user?.restrictions || [],
  });

  return reply.status(201).send({ asset });
}

export async function confirmUpload(req, reply) {
  const db = req.db || req.server?.db;
  const { storage_key, purpose } = req.body || {};
  const userId = req.user?.id || null;

  const driver = getStorageDriver();
  const obj = await driver.getObject({ key: storage_key });

  if (!obj || !obj.buffer) {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Uploaded file not found in storage.' },
    });
  }

  const asset = await mediaService.processAndSaveMedia(db, {
    userId,
    purpose,
    buffer: obj.buffer,
    storageKey: storage_key,
    userRestrictions: req.user?.restrictions || [],
  });

  return reply.status(201).send({ asset });
}

export async function listMedia(req, reply) {
  const db = req.db || req.server?.db;
  const { purpose, limit = 50, offset = 0 } = req.query || {};
  const userId = req.user?.id || null;

  const assets = await mediaRepo.listMediaAssets(db, {
    ownerId: userId,
    purpose: purpose?.toUpperCase(),
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  });

  const driver = getStorageDriver();
  const mapped = assets.map((a) => ({
    ...a,
    url: driver.getPublicUrl(a.storage_key),
  }));

  return reply.send({ assets: mapped });
}

export async function getMedia(req, reply) {
  const db = req.db || req.server?.db;
  const { id } = req.params;

  let asset = null;
  if (/^\d+$/.test(id)) {
    asset = await mediaRepo.getMediaAssetById(db, parseInt(id, 10));
  } else {
    asset = await mediaRepo.getMediaAssetByRef(db, id);
  }

  if (!asset) {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Media asset not found.' },
    });
  }

  const driver = getStorageDriver();
  return reply.send({
    asset: {
      ...asset,
      url: driver.getPublicUrl(asset.storage_key),
    },
  });
}
