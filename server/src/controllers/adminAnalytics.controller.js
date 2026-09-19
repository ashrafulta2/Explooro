/**
 * adminAnalytics.controller.js — Fastify controller for Super Admin Executive Dashboard (Prompt 11.4).
 */

import * as analyticsService from '../services/analytics.service.js';
import { writeAudit } from '../lib/audit.js';

export async function getOverviewHandler(req, reply) {
  const { timeframe = '30d', from = null, to = null } = req.query;
  const overview = await analyticsService.getExecutiveOverview(req.server.db, { timeframe, from, to });
  return reply.send({ success: true, data: overview });
}

/**
 * Data behind the dashboard's CSV export. The file itself is assembled in the browser (so its
 * headers can be localised), but the *egress* is decided here: permission-gated by
 * `admin.analytics.export` (HIGH tier) and audit-logged, which a purely client-side download
 * would have skipped.
 */
export async function exportOverviewHandler(req, reply) {
  const db = req.server.db;
  const { timeframe = '30d', from = null, to = null } = req.body || {};
  const overview = await analyticsService.getExecutiveOverview(db, { timeframe, from, to });

  await writeAudit(db, {
    actor_id: req.user?.id || null,
    actor_role: req.user?.role || 'super_admin',
    action: 'ANALYTICS_EXPORT',
    target_type: 'EXECUTIVE_ANALYTICS',
    target_ref: `${overview.period.from}..${overview.period.to}`,
    before_json: null,
    after_json: {
      timeframe: overview.timeframe,
      period: overview.period,
      data_source: overview.data_source,
      points: overview.chart_data.length,
    },
    metadata_json: { ip: req.ip },
  });

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
  const db = req.server.db;
  // Validates first (400 on a malformed or future date) so a bad request never reaches the
  // aggregate queries — and defaults to yesterday, the day the nightly job would compute.
  const day = analyticsService.assertRollupDate((req.body || {}).date);
  const before = await analyticsService.getRollupForDate(db, day);
  const rollup = await analyticsService.runDailyRollup(db, day);

  // WHY audited: a manual rollup overwrites the stored figures every KPI on the dashboard is
  // computed from, so "who recomputed 12 Aug and what changed" must be answerable afterwards.
  await writeAudit(db, {
    actor_id: req.user?.id || null,
    actor_role: req.user?.role || 'super_admin',
    action: 'ANALYTICS_ROLLUP_RUN',
    target_type: 'DAILY_ANALYTICS_ROLLUP',
    target_ref: day,
    before_json: before
      ? { gmv: before.gmv, platform_net_revenue: before.platform_net_revenue, total_orders: before.total_orders }
      : null,
    after_json: {
      gmv: rollup.gmv,
      platform_net_revenue: rollup.platform_net_revenue,
      total_orders: rollup.total_orders,
    },
    metadata_json: { ip: req.ip },
  });

  return reply.send({
    success: true,
    message_en: `Calculated daily analytics rollup for ${day}`,
    message_bn: `${day} তারিখের দৈনিক অ্যানালিটিক্স রোলআপ হিসাব করা হয়েছে`,
    data: { ...rollup, rollup_date: day },
  });
}
