/**
 * journeyMetrics.test.js — Prompt 13.7: the guided-experience metrics.
 *
 * Unit cases need no database. The "real Postgres" block checks that the SQL aggregation reconciles
 * with the raw events; it is opt-in and safe on a shared dev database (BEGIN … ROLLBACK):
 *
 *   JOURNEY_TEST_DATABASE_URL=postgresql://… npm test -w server -- test/journeyMetrics.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import '../src/config/loadEnvFile.ts';
import { buildReport, readSettings, SETTING_LIMITS } from '../src/services/journeyMetrics.service.ts';
import { stepEventsOf, getNextStep } from '../src/services/nextStep.service.ts';
import { stepAggregates, eventTotals } from '../src/repositories/journeyMetrics.repository.ts';
import { JOURNEYS, journeyFor } from '../src/config/journeys.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const row = (journey, step_id, extra = {}) => ({
  journey, step_id, reached: 0, reached_events: 0, completed: 0, abandoned: 0, settled: 0, timed: 0, median_seconds: null, ...extra,
});

describe('settings', () => {
  it('defaults to a 40% threshold and a 7-day wait', () => {
    assert.deepEqual(readSettings({}), { abandon_threshold_pct: 40, abandon_after_days: 7 });
    assert.deepEqual(readSettings(null), { abandon_threshold_pct: 40, abandon_after_days: 7 });
  });

  it('clamps out-of-range values and ignores non-integers', () => {
    assert.equal(readSettings({ abandon_threshold_pct: 200 }).abandon_threshold_pct, 95);
    assert.equal(readSettings({ abandon_threshold_pct: 1 }).abandon_threshold_pct, 5);
    assert.equal(readSettings({ abandon_after_days: 'x' }).abandon_after_days, 7);
  });

  it('migration 103 seeds the same defaults and bounds as SETTING_LIMITS', () => {
    const sql = read('src/db/migrations/103_journey_metrics.sql');
    for (const [key, { min, max, fallback }] of Object.entries(SETTING_LIMITS)) {
      assert.match(sql, new RegExp(`"${key}": ${fallback}`), `${key} default`);
      assert.match(sql, new RegExp(`"minimum": ${min}, "maximum": ${max}, "default": ${fallback}`), `${key} bounds`);
    }
  });
});

describe('buildReport', () => {
  const totals = { reached_events: 0, completed_events: 0 };

  it('lists every journey step in order, zeros where nothing happened yet', () => {
    const report = buildReport([], totals, [], { is_enabled: true, settings_json: {} });
    const roles = [...new Set(JOURNEYS.map((s) => s.role))];
    assert.deepEqual(report.journeys.map((j) => j.role), roles);
    for (const j of report.journeys) {
      assert.deepEqual(j.steps.map((s) => s.id), journeyFor(j.role).map((s) => s.id));
      for (const s of j.steps) {
        assert.equal(s.reached, 0);
        assert.equal(s.abandon_rate, null);
        assert.equal(s.flagged, false);
        assert.equal(s.title_key, `journey.${j.role}.${s.id}.title`);
      }
    }
    assert.deepEqual(report.flagged, []);
  });

  it('flags a step only when its abandon rate is above the configured threshold', () => {
    const rows = [
      row('customer', 'add_address', { reached: 10, completed: 5, abandoned: 5, settled: 10 }), // 50%
      row('customer', 'place_order', { reached: 10, completed: 6, abandoned: 4, settled: 10 }), // 40%, not above
    ];
    const at40 = buildReport(rows, totals, [], { settings_json: { abandon_threshold_pct: 40 } });
    const step = (r, id) => r.journeys.find((j) => j.role === 'customer').steps.find((s) => s.id === id);
    assert.equal(step(at40, 'add_address').abandon_rate, 50);
    assert.equal(step(at40, 'add_address').flagged, true);
    assert.equal(step(at40, 'place_order').flagged, false, 'exactly 40% is not "more than 40%"');
    assert.deepEqual(at40.flagged.map((f) => f.id), ['add_address']);

    const at30 = buildReport(rows, totals, [], { settings_json: { abandon_threshold_pct: 30 } });
    assert.deepEqual(at30.flagged.map((f) => f.id), ['add_address', 'place_order'], 'the threshold is configuration');
  });

  it('marks steps that wait on a buyer or a courier', () => {
    const report = buildReport([], totals, [], null);
    const steps = report.journeys.find((j) => j.role === 'customer').steps;
    assert.equal(steps.find((s) => s.id === 'receive_order').waits_on_others, true);
    assert.equal(steps.find((s) => s.id === 'add_address').waits_on_others, false);
  });

  it('reports the opt-out rate per role and the module state', () => {
    const report = buildReport([], totals, [{ role: 'saler', users: 8, opted_out: 2 }], { is_enabled: false });
    assert.deepEqual(report.journeys.find((j) => j.role === 'saler').opt_out, { users: 8, opted_out: 2, rate: 25 });
    assert.deepEqual(report.journeys.find((j) => j.role === 'customer').opt_out, { users: 0, opted_out: 0, rate: null });
    assert.deepEqual(report.module, { key: 'guided_experience', enabled: false });
  });
});

describe('the Next-Step engine records what it showed', () => {
  const payload = {
    enabled: true, reason: null, journey: 'customer', progress: { done: 1, total: 3 },
    current: { id: 'add_address' },
    upcoming: [],
    steps: [{ id: 'verify_phone', status: 'done' }, { id: 'add_address', status: 'todo' }, { id: 'fill_cart', status: 'todo' }],
  };

  it('the current step is REACHED and every done step COMPLETED', () => {
    assert.deepEqual(stepEventsOf(payload), [
      { step_id: 'verify_phone', event: 'COMPLETED' },
      { step_id: 'add_address', event: 'REACHED' },
    ]);
  });

  it('an opted-out or empty answer records nothing', () => {
    assert.deepEqual(stepEventsOf({ ...payload, enabled: false }), []);
    assert.deepEqual(stepEventsOf({ ...payload, journey: null }), []);
  });

  it('a failed write never costs the user their card', async () => {
    const db = {
      async query(sql) {
        if (sql.includes('show_next_steps FROM user_profiles')) return { rows: [] };
        if (sql.includes('platform_modules')) return { rows: [] };
        if (sql.includes('SELECT EXISTS')) return { rows: [{ done: false }] };
        throw new Error('unexpected');
      },
    };
    const deps = {
      resolvePermissions: async () => ({ permissions: new Set() }),
      isEnabled: async () => true,
      recordStepEvents: async () => { throw new Error('db down'); },
    };
    const out = await getNextStep(db, null, { id: 1, roles: ['customer'] }, deps);
    assert.equal(out.current.id, 'verify_phone');
  });
});

describe('route and permission', () => {
  it('GET /admin/platform/guided-experience is guarded by platform.guidance.view and its page', () => {
    const src = read('src/routes/journeyMetrics.routes.ts');
    assert.match(src, /'\/admin\/platform\/guided-experience'/);
    assert.match(src, /preHandler: \[app\.authenticate, app\.requirePermission\('platform\.guidance\.view'\)\]/);
    assert.match(src, /config: \{ page: '\/admin\/platform\/guided-experience' \}/);
    assert.match(read('src/app.ts'), /register\(journeyMetricsRoutes, \{ prefix: '\/api\/v1' \}\)/);
  });

  it('the permission is LOW, delegable, in the catalog and seeded for admin and super admin', () => {
    const catalog = JSON.parse(read('../docs/permission-catalog.json'));
    const list = Array.isArray(catalog) ? catalog : catalog.permissions;
    const p = list.find((x) => x.key === 'platform.guidance.view');
    assert.ok(p, 'in docs/permission-catalog.json');
    assert.equal(p.risk_tier, 'LOW');
    assert.equal(p.delegable, true);
    const seed = read('src/db/seeds/001_roles_permissions.sql');
    assert.match(seed, /\('platform\.guidance\.view', 'platform', .*'LOW', true,/);
    assert.match(seed, /\('admin', 'platform\.guidance\.view'\)/);
    assert.match(seed, /\('super_admin', 'platform\.guidance\.view'\)/);
  });
});

const DB_URL = process.env.JOURNEY_TEST_DATABASE_URL;

describe('journey metrics — real Postgres', { skip: DB_URL ? false : 'set JOURNEY_TEST_DATABASE_URL to a migrated database' }, () => {
  let client;
  const db = { query: (...args) => client.query(...args) };
  let users = [];

  before(async () => {
    const pg = createRequire(import.meta.url)('pg');
    client = new pg.Client({ connectionString: DB_URL, ssl: /sslmode=require/i.test(DB_URL) ? { rejectUnauthorized: false } : false });
    await client.connect();
    await client.query('BEGIN');
    await client.query('DELETE FROM journey_step_events');
    users = (await client.query('SELECT id FROM users ORDER BY id LIMIT 4')).rows.map((r) => r.id);
  });

  after(async () => {
    await client?.query('ROLLBACK').catch(() => {});
    await client?.end().catch(() => {});
  });

  it('per-step numbers reconcile with the raw events', async (t) => {
    if (users.length < 4) return t.skip('needs four users');
    const [a, b, c, d] = users;
    const ins = (u, step, event, daysAgo) =>
      client.query(
        `INSERT INTO journey_step_events (user_id, journey, step_id, event, occurred_at) VALUES ($1, 'customer', $2, $3, now() - make_interval(days => $4))`,
        [u, step, event, daysAgo]
      );
    // add_address: a finished in 1 day, b in 3 days, c stalled 10 days ago, d reached yesterday.
    await ins(a, 'add_address', 'REACHED', 5); await ins(a, 'add_address', 'COMPLETED', 4);
    await ins(b, 'add_address', 'REACHED', 6); await ins(b, 'add_address', 'COMPLETED', 3);
    await ins(c, 'add_address', 'REACHED', 10);
    await ins(d, 'add_address', 'REACHED', 1);
    // verify_phone: done before the card ever showed it (no REACHED row).
    await ins(a, 'verify_phone', 'COMPLETED', 6);

    const rows = await stepAggregates(db, 7);
    const addr = rows.find((r) => r.step_id === 'add_address');
    assert.equal(addr.reached, 4);
    assert.equal(addr.reached_events, 4);
    assert.equal(addr.completed, 2);
    assert.equal(addr.abandoned, 1, 'only c: d is inside the 7-day wait');
    assert.equal(addr.settled, 3);
    assert.equal(addr.timed, 2);
    assert.equal(Math.round(addr.median_seconds / 86400), 2, 'median of 1 and 3 days');
    const phone = rows.find((r) => r.step_id === 'verify_phone');
    assert.deepEqual([phone.reached, phone.reached_events, phone.completed, phone.timed], [1, 0, 1, 0]);

    const totals = await eventTotals(db);
    assert.equal(rows.reduce((n, r) => n + r.reached_events, 0), totals.reached_events);
    assert.equal(rows.reduce((n, r) => n + r.completed, 0), totals.completed_events);

    const report = buildReport(rows, totals, [], { settings_json: { abandon_threshold_pct: 30 } });
    const step = report.journeys.find((j) => j.role === 'customer').steps.find((s) => s.id === 'add_address');
    assert.equal(step.abandon_rate, 33.3);
    assert.equal(step.flagged, true);
  });
});
