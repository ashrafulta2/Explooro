/**
 * adminAnalytics.test.js — Automated test suite for Prompt 11.4 (Super Admin Executive Analytics & System Health).
 *
 * Verifies all ACCEPTANCE criteria from docs/prompt.md Prompt 11.4:
 * 1. The dashboard loads in under 1 second with pre-computed summary rollups.
 * 2. Every KPI reconciles with underlying sources of truth (GMV, Take Rate, AOV, Liabilities).
 * 3. Alert cards deep-link correctly to operational remedy pages.
 * 4. A manual backup produces a verifiable SHA-256 snapshot record.
 * 5. System health aggregates API latency percentiles, error rate, and job run history.
 * 6. Fastify HTTP REST API endpoints return 200 OK.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import adminAnalyticsRoutes from '../src/routes/adminAnalytics.routes.js';
import * as analyticsService from '../src/services/analytics.service.js';

function createMockDb({ queryHandler = null } = {}) {
  const db = {
    async query(sql, params = []) {
      if (queryHandler) {
        return queryHandler(sql, params);
      }
      return { rows: [] };
    },
  };
  db.connect = async () => ({
    query: (sql, params) => db.query(sql, params),
    release: () => {},
  });
  return db;
}

describe('Prompt 11.4 — Super Admin Executive Dashboard & System Health', () => {

  // ---------------------------------------------------------------------------
  // 1. Pre-computed Rollups & Sub-Second Loading (Acceptance 1)
  // ---------------------------------------------------------------------------
  test('Acceptance 1: Dashboard loads pre-computed rollups in under 1 second without transactional table scans', async () => {
    const seededRollups = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      rollup_date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      gmv: '45000.00',
      platform_net_revenue: '3600.00',
      total_orders: 25,
      delivered_orders: 22,
      cancelled_orders: 2,
      returned_orders: 1,
      aov: '1800.00',
      take_rate_pct: '8.00',
      active_sellers_count: 140,
      new_customers_count: 10,
      new_salers_count: 2,
      new_suppliers_count: 1,
      escrow_liability: '150000.00',
      pending_payout_liability: '35000.00',
      cod_exposure: '85000.00',
      dispute_count: 0,
      dispute_rate_pct: '0.00',
      conversion_rate_pct: '3.50',
      breakdown_json: '{}',
    }));

    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM daily_analytics_rollups')) {
          return { rows: seededRollups };
        }
        return { rows: [] };
      },
    });

    const startTime = Date.now();
    const overview = await analyticsService.getExecutiveOverview(mockDb, { timeframe: '30d' });
    const durationMs = Date.now() - startTime;

    assert.ok(durationMs < 1000, `Dashboard overview must resolve in <1s, took ${durationMs}ms`);
    assert.ok(overview.kpis);
    assert.equal(overview.kpis.gmv.value, 1350000); // 30 * 45000
    assert.equal(overview.kpis.net_platform_revenue.value, 108000); // 30 * 3600
    assert.equal(overview.kpis.take_rate.value, 8.0);
    assert.equal(overview.chart_data.length, 30);
  });

  // ---------------------------------------------------------------------------
  // 2. Nightly Rollup Aggregation & Reconciliation (Acceptance 2)
  // ---------------------------------------------------------------------------
  test('Acceptance 2: Nightly rollup reconciles GMV, Net Revenue, Take Rate, AOV, and Liabilities accurately', async () => {
    let savedRollup = null;

    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM orders') && sql.includes('DATE(created_at) = $1')) {
          return {
            rows: [
              {
                gmv: '125000.00',
                total_orders: 50,
                delivered_orders: 45,
                cancelled_orders: 3,
                returned_orders: 2,
                aov: '2500.00',
              },
            ],
          };
        }
        if (sql.includes('FROM sub_orders') && sql.includes('platform_fee')) {
          return {
            rows: [{ net_revenue: '10000.00' }], // 8% of 125,000
          };
        }
        if (sql.includes('FROM users u')) {
          return {
            rows: [{ new_customers: 20, new_salers: 5, new_suppliers: 2 }],
          };
        }
        if (sql.includes('FROM user_roles') && sql.includes('active_sellers')) {
          return { rows: [{ active_sellers: 88 }] };
        }
        if (sql.includes('FROM wallets')) {
          return { rows: [{ escrow_liability: '65000.00' }] };
        }
        if (sql.includes('FROM payout_requests')) {
          return { rows: [{ pending_payouts: '18000.00' }] };
        }
        if (sql.includes('FROM sub_orders so') && sql.includes('COD')) {
          return { rows: [{ cod_exposure: '32000.00' }] };
        }
        if (sql.includes('FROM disputes')) {
          return { rows: [{ dispute_count: 1 }] };
        }
        if (sql.includes('INSERT INTO daily_analytics_rollups')) {
          savedRollup = {
            rollup_date: params[0],
            gmv: params[1],
            platform_net_revenue: params[2],
            total_orders: params[3],
            aov: params[7],
            take_rate_pct: params[8],
            active_sellers_count: params[9],
            escrow_liability: params[13],
            pending_payout_liability: params[14],
            cod_exposure: params[15],
          };
          return { rows: [savedRollup] };
        }
        return { rows: [] };
      },
    });

    const result = await analyticsService.runDailyRollup(mockDb, '2026-08-23');

    assert.equal(result.rollup_date, '2026-08-23');
    assert.equal(result.gmv, 125000.00);
    assert.equal(result.platform_net_revenue, 10000.00);
    assert.equal(result.total_orders, 50);
    assert.equal(result.aov, 2500.00);
    assert.equal(result.take_rate_pct, 8.00);
    assert.equal(result.active_sellers_count, 88);
    assert.equal(result.escrow_liability, 65000.00);
    assert.equal(result.pending_payout_liability, 18000.00);
    assert.equal(result.cod_exposure, 32000.00);
  });

  // ---------------------------------------------------------------------------
  // 3. Operational Action Alerts & Remedy Deep Links (Acceptance 3)
  // ---------------------------------------------------------------------------
  test('Acceptance 3: Operational action alerts identify backlogs and deep-link directly to remedy pages', async () => {
    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM kyc_verifications')) {
          return { rows: [{ pending_kyc: 4 }] };
        }
        if (sql.includes('FROM products') && sql.includes('PENDING_APPROVAL')) {
          return { rows: [{ pending_products: 7 }] };
        }
        if (sql.includes('FROM warranty_claims') && sql.includes('72 hours')) {
          return { rows: [{ breached_claims: 2 }] };
        }
        if (sql.includes('FROM ledger_entries')) {
          return { rows: [{ total_debits: '100000.00', total_credits: '100000.00' }] }; // zero drift
        }
        if (sql.includes('FROM payout_requests') && sql.includes('FAILED')) {
          return { rows: [{ failed_payouts: 1 }] };
        }
        if (sql.includes('FROM sub_orders') && sql.includes('cod_settled_at IS NULL')) {
          return { rows: [{ unreconciled_cod: 15 }] };
        }
        if (sql.includes('FROM webhook_deliveries') && sql.includes('DEAD_LETTER')) {
          return { rows: [{ dlq_count: 3 }] };
        }
        return { rows: [] };
      },
    });

    const report = await analyticsService.getOperationalAlerts(mockDb);

    assert.ok(report.alerts.length >= 6);

    const kycAlert = report.alerts.find((a) => a.id === 'approval_queue');
    assert.equal(kycAlert.count, 11);
    assert.equal(kycAlert.action_url, '/admin/verification');

    const slaAlert = report.alerts.find((a) => a.id === 'sla_breaches');
    assert.equal(slaAlert.count, 2);
    assert.equal(slaAlert.severity, 'CRITICAL');
    assert.equal(slaAlert.action_url, '/moderator/disputes');

    const codAlert = report.alerts.find((a) => a.id === 'unreconciled_cod');
    assert.equal(codAlert.count, 15);
    assert.equal(codAlert.action_url, '/admin/cod-reconciliation');

    const dlqAlert = report.alerts.find((a) => a.id === 'dlq_webhooks');
    assert.equal(dlqAlert.count, 3);
    assert.equal(dlqAlert.action_url, '/admin/platform/api-keys');
  });

  // ---------------------------------------------------------------------------
  // 4. Verifiable Backup Snapshot & SHA-256 Checksum (Acceptance 4)
  // ---------------------------------------------------------------------------
  test('Acceptance 4: Manual backup creates a verifiable snapshot record with SHA-256 fingerprint', async () => {
    let savedBackup = null;

    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('SELECT COUNT(*) as count FROM')) {
          return { rows: [{ count: 150 }] };
        }
        if (sql.includes('INSERT INTO system_backups')) {
          savedBackup = {
            id: 1,
            ref: params[0],
            snapshot_type: params[1],
            sha256_checksum: params[2],
            table_counts_json: params[3],
            size_bytes: params[4],
            status: 'COMPLETED',
            created_by: params[5],
            created_at: new Date().toISOString(),
          };
          return { rows: [savedBackup] };
        }
        return { rows: [] };
      },
    });

    const snapshot = await analyticsService.triggerManualBackup(mockDb, { userId: 1, type: 'MANUAL' });

    assert.ok(snapshot.ref.startsWith('BAK-'));
    assert.equal(snapshot.snapshot_type, 'MANUAL');
    assert.equal(typeof snapshot.sha256_checksum, 'string');
    assert.equal(snapshot.sha256_checksum.length, 64, 'SHA-256 checksum must be exactly 64 hex characters');
    assert.equal(snapshot.status, 'COMPLETED');
  });

  // ---------------------------------------------------------------------------
  // 5. System Health Vitals & Diagnostics (Acceptance 5)
  // ---------------------------------------------------------------------------
  test('Acceptance 5: System health aggregates API latency percentiles, DB pool, and scheduler jobs', async () => {
    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM job_runs')) {
          return {
            rows: [
              {
                id: 10,
                job_name: 'analytics_nightly_rollup',
                status: 'COMPLETED',
                started_at: new Date().toISOString(),
                duration_ms: 450,
                processed_count: 1,
              },
            ],
          };
        }
        if (sql.includes('FROM webhook_deliveries')) {
          return {
            rows: [{ total_deliveries: 100, successful_deliveries: 98, dlq_count: 2 }],
          };
        }
        return { rows: [] };
      },
    });

    const health = await analyticsService.getSystemHealth(mockDb);

    assert.equal(health.overall_status, 'OPERATIONAL');
    assert.ok(health.api_vitals.p50_latency_ms > 0);
    assert.ok(health.api_vitals.p95_latency_ms > 0);
    assert.ok(health.api_vitals.p99_latency_ms > 0);
    assert.equal(health.db_health.status, 'HEALTHY');
    assert.equal(health.cache_health.status, 'HEALTHY');
    assert.equal(health.webhooks.dlq_depth, 2);
    assert.equal(health.job_runs.length, 1);
    assert.equal(health.job_runs[0].job_name, 'analytics_nightly_rollup');
  });

  // ---------------------------------------------------------------------------
  // 6. Fastify HTTP Endpoints (Acceptance 6)
  // ---------------------------------------------------------------------------
  test('Fastify HTTP API: /admin/analytics/overview, alerts, health, and backups return 200 OK', async () => {
    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM daily_analytics_rollups')) {
          return { rows: [] };
        }
        if (sql.includes('FROM kyc_verifications')) {
          return { rows: [{ pending_kyc: 0 }] };
        }
        if (sql.includes('FROM job_runs')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT COUNT(*) as count FROM')) {
          return { rows: [{ count: 10 }] };
        }
        if (sql.includes('INSERT INTO system_backups')) {
          return { rows: [{ id: 1, ref: 'BAK-TEST', sha256_checksum: 'a'.repeat(64), status: 'COMPLETED' }] };
        }
        if (sql.includes('FROM system_backups')) {
          return { rows: [{ id: 1, ref: 'BAK-TEST', sha256_checksum: 'a'.repeat(64), status: 'COMPLETED' }] };
        }
        return { rows: [] };
      },
    });

    const app = Fastify();
    app.decorate('db', mockDb);
    app.decorate('cache', { driver: 'memory' });
    app.decorate('authenticate', async (req) => {
      req.user = { id: 1, role: 'super_admin' };
    });

    app.register(errorHandlerPlugin);
    await app.register(adminAnalyticsRoutes, { prefix: '/api/v1' });
    await app.ready();

    // 1. GET /api/v1/admin/analytics/overview
    const resOv = await app.inject({ method: 'GET', url: '/api/v1/admin/analytics/overview?timeframe=30d' });
    assert.equal(resOv.statusCode, 200);
    assert.equal(resOv.json().success, true);
    assert.ok(resOv.json().data.kpis);

    // 2. GET /api/v1/admin/analytics/alerts
    const resAl = await app.inject({ method: 'GET', url: '/api/v1/admin/analytics/alerts' });
    assert.equal(resAl.statusCode, 200);
    assert.equal(resAl.json().success, true);
    assert.ok(Array.isArray(resAl.json().data.alerts));

    // 3. GET /api/v1/admin/system/health
    const resHl = await app.inject({ method: 'GET', url: '/api/v1/admin/system/health' });
    assert.equal(resHl.statusCode, 200);
    assert.equal(resHl.json().success, true);

    // 4. GET /api/v1/admin/system/backups
    const resBk = await app.inject({ method: 'GET', url: '/api/v1/admin/system/backups' });
    assert.equal(resBk.statusCode, 200);
    assert.equal(resBk.json().success, true);

    // 5. POST /api/v1/admin/system/backups/trigger
    const resTrig = await app.inject({ method: 'POST', url: '/api/v1/admin/system/backups/trigger' });
    assert.equal(resTrig.statusCode, 201);
    assert.equal(resTrig.json().success, true);

    await app.close();
  });


  // ---------------------------------------------------------------------------
  // 7. Executive cockpit hardening: ranges, real timestamps, audited rollup + export
  // ---------------------------------------------------------------------------
  describe('Executive cockpit hardening', () => {
    const TODAY = new Date('2026-09-19T08:00:00Z');

    test('resolveOverviewRange: presets keep their window; a custom range wins and compares like-for-like', () => {
      const p30 = analyticsService.resolveOverviewRange({ timeframe: '30d' }, TODAY);
      assert.equal(p30.timeframe, '30d');
      assert.equal(p30.days, 30);
      assert.equal(p30.from, '2026-08-20');
      assert.equal(p30.to, '2026-09-19');
      assert.equal(p30.prevFrom, '2026-07-21');

      assert.equal(analyticsService.resolveOverviewRange({ timeframe: '1y' }, TODAY).days, 365);
      assert.equal(analyticsService.resolveOverviewRange({ timeframe: 'bogus' }, TODAY).timeframe, '30d', 'unknown preset falls back');

      const custom = analyticsService.resolveOverviewRange({ from: '2026-08-01', to: '2026-08-20', timeframe: '7d' }, TODAY);
      assert.equal(custom.timeframe, 'custom');
      assert.equal(custom.days, 20, 'inclusive day count');
      assert.equal(custom.prevFrom, '2026-07-12', 'previous window is the same length, ending the day before `from`');
    });

    test('resolveOverviewRange rejects malformed, reversed, future and over-long ranges with VALIDATION_FAILED', () => {
      const bad = [
        { from: '2026-08-01' },
        { to: '2026-08-01' },
        { from: 'nope', to: '2026-08-01' },
        { from: '2026-02-30', to: '2026-03-01' },
        { from: '2026-13-01', to: '2026-13-02' },
        { from: '2026-09-10', to: '2026-09-01' },
        { from: '2026-09-01', to: '2026-09-20' },
        { from: '2025-01-01', to: '2026-09-01' },
        { from: "2026-09-01'; DROP TABLE users;--", to: '2026-09-02' },
      ];
      for (const range of bad) {
        assert.throws(
          () => analyticsService.resolveOverviewRange(range, TODAY),
          (err) => err.code === 'VALIDATION_FAILED' && err.statusCode === 400,
          `should reject ${JSON.stringify(range)}`
        );
      }
      // Exactly the limit is fine.
      assert.equal(analyticsService.resolveOverviewRange({ from: '2025-09-18', to: '2026-09-18' }, TODAY).days, 366);
    });

    test('getExecutiveOverview binds the range as query parameters (never interpolated into SQL)', async () => {
      const seen = [];
      const db = createMockDb({
        queryHandler: async (sql, params) => {
          if (sql.includes('FROM daily_analytics_rollups')) seen.push({ sql, params });
          return { rows: [] };
        },
      });
      await analyticsService.getExecutiveOverview(db, { from: '2026-08-01', to: '2026-08-20' });
      const ranged = seen.filter((q) => q.params && q.params.length);
      assert.equal(ranged.length, 2, 'current + previous window queries');
      assert.deepEqual(ranged[0].params, ['2026-08-01', '2026-08-20']);
      assert.deepEqual(ranged[1].params, ['2026-07-12', '2026-08-01']);
      for (const q of ranged) assert.ok(!/INTERVAL/i.test(q.sql), 'no interpolated INTERVAL literal');
    });

    test('chart dates survive pg returning DATE as a local-midnight Date object', async () => {
      // node-postgres parses DATE to `new Date(y, m, d)` in local time. The old label code was
      // String(date).slice(5, 10), which produced "ep 01" from "Tue Sep 01 2026 ...".
      const rows = [1, 2, 3].map((d) => ({
        rollup_date: new Date(2026, 8, d),
        gmv: '1000.00', platform_net_revenue: '80.00', total_orders: 2,
        active_sellers_count: 5, new_customers_count: 1, new_salers_count: 0, new_suppliers_count: 0,
        escrow_liability: '10', pending_payout_liability: '5', cod_exposure: '2',
        dispute_rate_pct: '0', conversion_rate_pct: '3', take_rate_pct: '8', aov: '500',
        created_at: new Date('2026-09-04T02:00:00Z'),
      }));
      const db = createMockDb({
        queryHandler: async (sql) => {
          if (sql.includes('MAX(created_at)')) return { rows: [{ last_rollup_at: new Date('2026-09-04T02:00:00Z') }] };
          if (sql.includes('FROM daily_analytics_rollups')) return { rows };
          return { rows: [] };
        },
      });
      const ov = await analyticsService.getExecutiveOverview(db, { timeframe: '7d' });
      assert.deepEqual(ov.chart_data.map((p) => p.date), ['2026-09-01', '2026-09-02', '2026-09-03']);
      assert.equal(analyticsService.toDayString('2026-09-01T00:00:00.000Z'), '2026-09-01');
      assert.equal(analyticsService.toDayString(null), '');
      assert.equal(ov.data_source, 'rollup');
      assert.equal(ov.last_rollup_at, '2026-09-04T02:00:00.000Z', 'reports when the rollup really ran, not "now"');
      assert.equal(ov.period.days, 7);
    });

    test('with no rollups the payload is flagged as baseline so the UI can say the numbers are placeholders', async () => {
      const ov = await analyticsService.getExecutiveOverview(createMockDb(), { timeframe: '30d' });
      assert.equal(ov.data_source, 'baseline');
      assert.equal(ov.last_rollup_at, null);
    });

    test('assertRollupDate defaults to yesterday and refuses malformed or future dates', () => {
      assert.equal(analyticsService.assertRollupDate(undefined, TODAY), '2026-09-18');
      assert.equal(analyticsService.assertRollupDate('', TODAY), '2026-09-18');
      assert.equal(analyticsService.assertRollupDate('2026-09-19', TODAY), '2026-09-19', 'today is allowed');
      for (const bad of ['2026-09-20', 'yesterday', '2026-13-01', '19-09-2026', 20260919]) {
        assert.throws(() => analyticsService.assertRollupDate(bad, TODAY), (e) => e.code === 'VALIDATION_FAILED', String(bad));
      }
    });

    /** Builds an app whose requirePermission records which permission each route demands. */
    async function buildApp({ auditRows = [], rollupRows = [] } = {}) {
      const demanded = new Map();
      const db = createMockDb({
        queryHandler: async (sql, params) => {
          if (sql.includes('audit_logs')) {
            auditRows.push({ sql, params });
            return { rows: [{ id: 1, row_hash: 'h', created_at: new Date() }] };
          }
          if (sql.includes('SELECT * FROM daily_analytics_rollups WHERE rollup_date')) return { rows: rollupRows };
          if (sql.includes('INSERT INTO daily_analytics_rollups')) {
            return { rows: [{ rollup_date: params[0], gmv: params[1], platform_net_revenue: params[2], total_orders: params[3] }] };
          }
          return { rows: [] };
        },
      });
      const app = Fastify();
      app.decorate('db', db);
      app.decorate('cache', { driver: 'memory' });
      app.decorate('authenticate', async (req) => { req.user = { id: 7, role: 'admin' }; });
      app.decorate('requirePermission', (perm) => {
        demanded.set(perm, (demanded.get(perm) || 0) + 1);
        return async () => {};
      });
      app.register(errorHandlerPlugin);
      await app.register(adminAnalyticsRoutes, { prefix: '/api/v1' });
      await app.ready();
      return { app, demanded };
    }

    test('routes: rollup and export have their own permissions instead of riding on dashboard.view', async () => {
      const { app, demanded } = await buildApp();
      assert.ok(demanded.has('admin.analytics.rollup'), 'rollup-now requires admin.analytics.rollup');
      assert.ok(demanded.has('admin.analytics.export'), 'export requires admin.analytics.export');
      assert.ok(demanded.has('admin.dashboard.view'), 'reads still use admin.dashboard.view');
      const { readFileSync } = await import('node:fs');
      const catalog = JSON.parse(readFileSync(new URL('../../docs/permission-catalog.json', import.meta.url), 'utf8'));
      const keys = new Set(catalog.permissions.map((p) => p.key));
      for (const k of demanded.keys()) assert.ok(keys.has(k), `${k} is declared in docs/permission-catalog.json`);
      const rollup = catalog.permissions.find((p) => p.key === 'admin.analytics.rollup');
      assert.deepEqual([...rollup.default_roles].sort(), ['admin', 'super_admin']);
      await app.close();
    });

    test('POST /admin/analytics/rollup-now: validates the date, recomputes, and writes an audit row', async () => {
      const auditRows = [];
      const { app } = await buildApp({ auditRows, rollupRows: [{ gmv: '900.00', platform_net_revenue: '70.00', total_orders: 3 }] });

      const bad = await app.inject({ method: 'POST', url: '/api/v1/admin/analytics/rollup-now', payload: { date: '2099-01-01' } });
      assert.equal(bad.statusCode, 400);
      assert.equal(bad.json().error.code, 'VALIDATION_FAILED');
      assert.equal(auditRows.length, 0, 'a rejected request must not be audited as if it ran');

      const ok = await app.inject({ method: 'POST', url: '/api/v1/admin/analytics/rollup-now', payload: { date: '2026-09-10' } });
      assert.equal(ok.statusCode, 200);
      assert.equal(ok.json().data.rollup_date, '2026-09-10');
      assert.ok(auditRows.length >= 1, 'an audit_logs row is written');
      const flat = JSON.stringify(auditRows[0].params);
      assert.ok(flat.includes('ANALYTICS_ROLLUP_RUN'), 'action recorded');
      assert.ok(flat.includes('2026-09-10'), 'target recorded');
      assert.ok(flat.includes('900.00'), 'before snapshot recorded');
      await app.close();
    });

    test('POST /admin/analytics/export returns the data and audits the egress; bad ranges are 400', async () => {
      const auditRows = [];
      const { app } = await buildApp({ auditRows });
      const ok = await app.inject({ method: 'POST', url: '/api/v1/admin/analytics/export', payload: { timeframe: '7d' } });
      assert.equal(ok.statusCode, 200);
      assert.ok(ok.json().data.kpis && ok.json().data.chart_data);
      assert.ok(auditRows.length >= 1, 'export is audited');
      assert.ok(JSON.stringify(auditRows[0].params).includes('ANALYTICS_EXPORT'));

      const before = auditRows.length;
      const bad = await app.inject({ method: 'POST', url: '/api/v1/admin/analytics/export', payload: { from: '2026-09-10', to: '2026-09-01' } });
      assert.equal(bad.statusCode, 400);
      assert.equal(auditRows.length, before, 'rejected export leaves no audit row');

      const custom = await app.inject({ method: 'GET', url: '/api/v1/admin/analytics/overview?from=2026-08-01&to=2026-08-20' });
      assert.equal(custom.statusCode, 200);
      assert.equal(custom.json().data.timeframe, 'custom');
      const badGet = await app.inject({ method: 'GET', url: '/api/v1/admin/analytics/overview?from=2026-08-01' });
      assert.equal(badGet.statusCode, 400);
      await app.close();
    });
  });

});
