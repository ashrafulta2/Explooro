/**
 * adminAnalytics.controller.js — Fastify controller for Super Admin Executive Dashboard (Prompt 11.4).
 */

import * as analyticsService from '../services/analytics.service.js';

export async function getOverviewHandler(req, reply) {
  const { timeframe = '30d' } = req.query;
  const overview = await analyticsService.getExecutiveOverview(req.server.db, { timeframe });
  return reply.send({ success: true, data: overview });
}

export async function getAlertsHandler(req, reply) {
  const alerts = await analyticsService.getOperationalAlerts(req.server.db);
  return reply.send({ success: true, data: alerts });
}

export async function getSystemHealthHandler(req, reply) {
  const health = await analyticsService.getSystemHealth(req.server.db, req.server.cache);
  return reply.send({ success: true, data: health });
}

export async function getBackupsHandler(req, reply) {
  const { limit = 20 } = req.query;
  const backups = await analyticsService.getBackupHistory(req.server.db, { limit: parseInt(limit, 10) });
  return reply.send({ success: true, data: backups });
}

export async function triggerBackupHandler(req, reply) {
  const userId = req.user?.id;
  const snapshot = await analyticsService.triggerManualBackup(req.server.db, { userId, type: 'MANUAL' });
  return reply.status(201).send({
    success: true,
    message_en: `Created verifiable backup snapshot #${snapshot.ref}`,
    message_bn: `সিস্টেম স্ন্যাপশট #${snapshot.ref} সফলভাবে তৈরি হয়েছে`,
    data: snapshot,
  });
}

export async function restoreBackupHandler(req, reply) {
  const { id } = req.params;
  const userId = req.user?.id;
  const result = await analyticsService.restoreBackup(req.server.db, parseInt(id, 10), { userId });
  return reply.send({ success: true, ...result });
}

export async function triggerRollupHandler(req, reply) {
  const { date } = req.body || {};
  const rollup = await analyticsService.runDailyRollup(req.server.db, date);
  return reply.send({
    success: true,
    message_en: `Calculated daily analytics rollup for ${rollup.rollup_date}`,
    data: rollup,
  });
}
