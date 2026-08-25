/**
 * theme.controller.js — Request handlers for Theme Studio APIs (Prompt 3.5).
 */

import * as themeService from '../services/theme.service.js';
import * as auditService from '../services/audit.service.js';

export async function getActive(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const active = await themeService.getActiveTheme(db, cache);
  return reply.send({ theme: active, tokens: active?.tokens_json || null });
}

export async function listPalettes(req, reply) {
  const db = req.db || req.server?.db;
  const palettes = await themeService.listPalettes(db);
  return reply.send({ palettes });
}

export async function saveDraft(req, reply) {
  const db = req.db || req.server?.db;
  const { name, preset_key, tokens } = req.body || {};
  const userId = req.user?.id || 1;

  const draft = await themeService.saveDraft(db, {
    name,
    presetKey: preset_key,
    tokens,
    userId,
  });

  return reply.status(201).send({ draft });
}

export async function publishTheme(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const { id } = req.params;
  const userId = req.user?.id || 1;

  const published = await themeService.publishTheme(db, cache, auditService, {
    id: parseInt(id, 10),
    userId,
    reqContext: {
      traceId: req.traceId,
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    },
  });

  return reply.send({ published });
}

export async function validateContrast(req, reply) {
  const { tokens } = req.body || {};
  // Reports the EFFECTIVE palette when a master block is present, so the Studio can show what was
  // actually certified rather than only what it submitted.
  return reply.send(themeService.inspectPalette(tokens));
}
