/**
 * recommendationAdmin.test.js — Phase G: the operator's hands on the personalized home feed
 * (/admin/platform/recommendations).
 *
 *   1. Specs      — the form the page draws is built from the limits the readers already enforce, so there
 *                   is no second copy of a bound; every shipped default is a valid value.
 *   2. Strict     — a write is refused, not clamped: out of range, wrong type, unknown or missing key.
 *   3. Rails      — the list rules (known, unique, window only where it applies, order kept).
 *   4. Writing    — one OBJECT row, one transaction, one audit row with before/after and the reason; a
 *                   rejected or conflicting write changes and audits nothing; the settings snapshot the
 *                   feed reads is dropped so the edit applies at once.
 *   5. Reading    — what the system is RUNNING (missing row = defaults; out-of-range row = flagged).
 *   6. HTTP       — the three routes, and a user without the permission getting a 403 (the negative test
 *                   docs/super-admin-audit.md §5 invariant 11 asks for).
 *   7. Contract   — catalog, seed and route guards agree.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';

import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import recommendationAdminRoutes from '../src/routes/recommendationAdmin.routes.js';
import * as admin from '../src/services/recommendationAdmin.service.js';
import * as auditService from '../src/services/audit.service.js';
import * as recoCache from '../src/services/recoCache.service.js';
import * as recommendation from '../src/services/recommendation.service.js';
import * as homeRails from '../src/services/homeRails.service.js';
import * as diversity from '../src/services/diversity.service.js';
import * as clientMock from '../../client/src/mocks/handlers/recommendations.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');

/** A platform_settings + audit_logs stand-in that records BEGIN/COMMIT/ROLLBACK and FOR UPDATE locks. */
function createMockDb({ failReads = false, rows = {} } = {}) {
  const settings = new Map();
  const put = (key, value) =>
    settings.set(key, { key, value_json: JSON.stringify(value), value_type: 'OBJECT', group_key: 'recommendation', updated_by: null, updated_at: null });
  for (const [key, value] of Object.entries(rows)) put(key, value);

  const auditLog = [];
  const txnOps = [];
  let lockTaken = 0;

  const db = {
    settings,
    auditLog,
    txnOps,
    put,
    get lockTaken() {
      return lockTaken;
    },
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
        txnOps.push(q);
        return { rows: [] };
      }
      if (q.startsWith('SELECT key, value_json FROM platform_settings') && q.includes('FOR UPDATE')) {
        lockTaken += 1;
        return { rows: [...settings.values()].map((r) => ({ key: r.key, value_json: r.value_json })) };
      }
      if (q.startsWith('SELECT key, value_json, value_type') && q.includes('WHERE group_key = $1')) {
        if (failReads) throw new Error('relation "platform_settings" does not exist');
        return { rows: [...settings.values()].filter((r) => r.group_key === params[0]).sort((a, b) => a.key.localeCompare(b.key)) };
      }
      if (q.startsWith('INSERT INTO platform_settings')) {
        const [key, valueJson, valueType, labelEn, labelBn, groupKey, isSensitive, updatedBy] = params;
        const row = {
          key, value_json: valueJson, value_type: valueType, label_en: labelEn, label_bn: labelBn,
          group_key: groupKey, is_sensitive: isSensitive, updated_by: updatedBy, updated_at: new Date().toISOString(),
        };
        settings.set(key, row);
        return { rows: [row] };
      }
      if (q.startsWith('INSERT INTO audit_logs')) {
        const row = {
          id: auditLog.length + 1, actor_id: params[0], actor_role: params[1], action: params[2],
          target_type: params[3], target_ref: params[4],
          before_json: params[5] ? JSON.parse(params[5]) : null, after_json: params[6] ? JSON.parse(params[6]) : null,
          risk_tier: params[8],
        };
        auditLog.push(row);
        return { rows: [row] };
      }
      if (q.startsWith('SELECT r.key, r.label_en')) {
        return { rows: [{ key: 'super_admin', label_en: 'Super Admin', label_bn: 'সুপার অ্যাডমিন' }] };
      }
      return { rows: [] };
    },
  };
  db.connect = async () => ({ query: db.query, release() {} });
  return db;
}

function createCache() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.get(k) ?? null; },
    async set(k, v) { store.set(k, v); },
    async del(k) { store.delete(k); },
  };
}

const REASON = 'Raising trending after the Eid campaign review.';
const save = (db, cache, section, value, extra = {}) =>
  admin.updateSection(db, cache, auditService, { section, value, reason: REASON, userId: 7, actorRole: 'super_admin', ...extra });
const refused = (fn) => assert.throws(fn, (err) => err.code === 'VALIDATION_FAILED' && Boolean(err.messageBn));

// ── 1. Specs ────────────────────────────────────────────────────────────────────────────────────
describe('Specs — one source for the bounds', () => {
  test('there is a section for each setting row the feed reads, in the order the page shows them', () => {
    assert.deepEqual(admin.SECTION_KEYS, ['weights', 'tuning', 'rails', 'diversity', 'covisit', 'cache']);
    assert.deepEqual(
      admin.SECTION_KEYS.map((k) => admin.SECTIONS[k].rowKey),
      ['recommendation.weights', 'recommendation.tuning', 'recommendation.rails', 'recommendation.diversity', 'recommendation.covisit', 'recommendation.cache']
    );
  });

  test('every shipped default is itself a value the validator accepts', () => {
    for (const name of admin.SECTION_KEYS) {
      const defaults = JSON.parse(JSON.stringify(admin.SECTIONS[name].defaults));
      assert.deepEqual(admin.validateSection(name, defaults), defaults, name);
    }
  });

  test('the fields mirror the readers: same keys, same defaults, same bounds', () => {
    const keys = (name) => admin.SECTIONS[name].fields.map((f) => f.key);
    assert.deepEqual(keys('weights'), Object.keys(recommendation.DEFAULT_WEIGHTS));
    assert.deepEqual(keys('tuning'), Object.keys(recommendation.DEFAULT_TUNING));
    assert.deepEqual(keys('diversity'), ['enabled', ...Object.keys(diversity.DIVERSITY_LIMITS)]);
    for (const f of admin.SECTIONS.weights.fields) {
      assert.equal(f.default, recommendation.DEFAULT_WEIGHTS[f.key]);
      assert.deepEqual([f.min, f.max], [recommendation.WEIGHT_LIMITS.min, recommendation.WEIGHT_LIMITS.max]);
    }
    for (const f of admin.SECTIONS.tuning.fields) {
      const lim = recommendation.TUNING_LIMITS[f.key];
      assert.deepEqual([f.min, f.max, f.type === 'int'], [lim.min, lim.max, Boolean(lim.integer)], f.key);
    }
  });

  test('the explore_every field carries its "0 switches it off" rule to the page', () => {
    const f = admin.SECTIONS.diversity.fields.find((x) => x.key === 'explore_every');
    assert.equal(f.allowZero, true);
  });

  test('re-validating what the reader makes of a value changes nothing (the two agree)', () => {
    for (const name of admin.SECTION_KEYS) {
      const s = admin.SECTIONS[name];
      const read = s.sanitize(JSON.parse(JSON.stringify(s.defaults)));
      assert.deepEqual(admin.validateSection(name, read), read, name);
    }
  });
});

// ── 2. Strict validation ────────────────────────────────────────────────────────────────────────
describe('Strict validation — refused, never clamped', () => {
  const flatSections = ['weights', 'tuning', 'diversity', 'covisit', 'cache'];
  const fresh = (name) => JSON.parse(JSON.stringify(admin.SECTIONS[name].defaults));

  test('both ends of every numeric field are accepted, one step past either end is refused', () => {
    for (const name of flatSections) {
      for (const f of admin.SECTIONS[name].fields.filter((x) => x.type !== 'bool')) {
        const step = f.type === 'int' ? 1 : 0.01;
        for (const ok of [f.min, f.max]) {
          const v = fresh(name);
          v[f.key] = ok;
          // The weights guard (some positive weight) is a different rule; keep one positive in play.
          if (name === 'weights' && f.key === 'trending') v.bestseller = 1;
          assert.equal(admin.validateSection(name, v)[f.key], ok, `${name}.${f.key}=${ok}`);
        }
        for (const bad of [f.min - step, f.max + step]) {
          // explore_every: 0 is allowed (off) but 1 is not, so its below-min probe is 1 not min-1.
          const probe = f.allowZero && bad < f.min ? f.min - 1 : bad;
          if (f.allowZero && probe === 0) continue;
          const v = fresh(name);
          v[f.key] = probe;
          refused(() => admin.validateSection(name, v));
        }
      }
    }
  });

  test('explore_every: 0 turns exploration off, 1 is refused (it would make every slot an exploration slot)', () => {
    const v = fresh('diversity');
    v.explore_every = 0;
    assert.equal(admin.validateSection('diversity', v).explore_every, 0);
    v.explore_every = 1;
    refused(() => admin.validateSection('diversity', v));
  });

  test('a number must be a number: strings, null, NaN, Infinity and booleans are refused', () => {
    for (const bad of ['3', null, undefined, NaN, Infinity, true, [], {}]) {
      const v = fresh('weights');
      v.trending = bad;
      refused(() => admin.validateSection('weights', v));
    }
  });

  test('a whole-number field refuses a fraction', () => {
    const v = fresh('tuning');
    v.viewed_window_days = 14.5;
    refused(() => admin.validateSection('tuning', v));
  });

  test('a switch must be a real boolean, not "true" or 1', () => {
    for (const bad of ['true', 1, 0, null]) {
      const v = fresh('cache');
      v.enabled = bad;
      refused(() => admin.validateSection('cache', v));
    }
  });

  test('an unknown key and a missing key are both refused (a typo cannot silently do nothing)', () => {
    const extra = { ...fresh('diversity'), max_per_suplier: 3 };
    refused(() => admin.validateSection('diversity', extra));
    const missing = fresh('diversity');
    delete missing.window;
    refused(() => admin.validateSection('diversity', missing));
  });

  test('the value must be an object', () => {
    for (const bad of [null, [], 'x', 5, undefined]) refused(() => admin.validateSection('cache', bad));
  });

  test('an unknown section is refused', () => {
    refused(() => admin.validateSection('rankings', {}));
  });

  test('the cache floor holds: a pool TTL below the minimum is refused, settings TTL 0 is allowed', () => {
    const v = fresh('cache');
    v.pool_ttl_seconds = recoCache.CACHE_LIMITS.pool_ttl_seconds.min - 1;
    refused(() => admin.validateSection('cache', v));
    const ok = fresh('cache');
    ok.settings_ttl_seconds = 0;
    assert.equal(admin.validateSection('cache', ok).settings_ttl_seconds, 0);
  });

  test('co-visitation keeps its floor of 2 actors', () => {
    const v = fresh('covisit');
    v.min_actors = 1;
    refused(() => admin.validateSection('covisit', v));
  });

  test('weights: all positive signals at 0 is refused; penalties at 0 are fine', () => {
    const zero = fresh('weights');
    for (const k of Object.keys(zero)) if (!k.endsWith('_penalty')) zero[k] = 0;
    refused(() => admin.validateSection('weights', zero));
    const penaltiesOff = fresh('weights');
    for (const k of Object.keys(penaltiesOff)) if (k.endsWith('_penalty')) penaltiesOff[k] = 0;
    assert.equal(admin.validateSection('weights', penaltiesOff).out_of_stock_penalty, 0);
  });

  test('the error says which field and carries both languages', () => {
    const v = fresh('weights');
    v.trending = 99;
    try {
      admin.validateSection('weights', v);
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal(err.code, 'VALIDATION_FAILED');
      assert.equal(err.details?.field ?? err.field, 'trending');
      assert.ok(err.messageEn && err.messageBn);
    }
  });
});

// ── 3. Rails ────────────────────────────────────────────────────────────────────────────────────
describe('Rails — the layout list', () => {
  const layout = () => JSON.parse(JSON.stringify(homeRails.DEFAULT_RAILS_CONFIG));

  test('the order the admin sets is the order stored', () => {
    const v = layout();
    v.rails.reverse();
    assert.deepEqual(admin.validateSection('rails', v).rails.map((r) => r.key), v.rails.map((r) => r.key));
  });

  test('an empty list is respected: an admin who removed every rail meant it', () => {
    assert.deepEqual(admin.validateSection('rails', { min_items: 4, rails: [] }).rails, []);
  });

  test('a rail can be omitted (turned off by removal) and the rest stay', () => {
    const v = layout();
    v.rails = v.rails.filter((r) => r.key !== 'near_you');
    assert.equal(admin.validateSection('rails', v).rails.some((r) => r.key === 'near_you'), false);
  });

  test('an unknown rail and a repeated rail are refused', () => {
    const unknown = layout();
    unknown.rails[0].key = 'editors_picks';
    refused(() => admin.validateSection('rails', unknown));
    const twice = layout();
    twice.rails.push({ ...twice.rails[0] });
    refused(() => admin.validateSection('rails', twice));
  });

  test('window_days belongs to new_arrivals only, and new_arrivals must have it', () => {
    const stray = layout();
    stray.rails.find((r) => r.key === 'trending').window_days = 30;
    refused(() => admin.validateSection('rails', stray));
    const missing = layout();
    delete missing.rails.find((r) => r.key === 'new_arrivals').window_days;
    refused(() => admin.validateSection('rails', missing));
  });

  test('limit, window and min_items are bounded and whole', () => {
    const { limit, min_items: mi, window_days: wd } = homeRails.RAIL_LIMITS;
    const probe = (mut) => {
      const v = layout();
      mut(v);
      return v;
    };
    refused(() => admin.validateSection('rails', probe((v) => (v.rails[0].limit = limit.max + 1))));
    refused(() => admin.validateSection('rails', probe((v) => (v.rails[0].limit = 0))));
    refused(() => admin.validateSection('rails', probe((v) => (v.rails[0].limit = 5.5))));
    refused(() => admin.validateSection('rails', probe((v) => (v.min_items = mi.max + 1))));
    refused(() => admin.validateSection('rails', probe((v) => (v.rails.find((r) => r.key === 'new_arrivals').window_days = wd.max + 1))));
    assert.equal(admin.validateSection('rails', probe((v) => (v.rails[0].limit = limit.max))).rails[0].limit, limit.max);
  });

  test('a rail record with a stray field is refused', () => {
    const v = layout();
    v.rails[0].title = 'Hello';
    refused(() => admin.validateSection('rails', v));
  });

  test('the catalogue lists every rail the feed can run, with what each needs', () => {
    assert.deepEqual(admin.RAIL_CATALOGUE.map((r) => r.key), homeRails.RAIL_KEYS);
    assert.equal(admin.RAIL_CATALOGUE.find((r) => r.key === 'new_arrivals').has_window, true);
    assert.equal(admin.RAIL_CATALOGUE.find((r) => r.key === 'near_you').needs, 'district');
    assert.equal(admin.RAIL_CATALOGUE.find((r) => r.key === 'also_viewed').needs, 'covisit');
  });
});

// ── 4. Writing ──────────────────────────────────────────────────────────────────────────────────
describe('Writing — transaction, audit, cache, conflict', () => {
  const weights = (over = {}) => ({ ...recommendation.DEFAULT_WEIGHTS, ...over });

  test('one OBJECT row in the recommendation group, in one transaction, under the group lock', async () => {
    const db = createMockDb();
    await save(db, createCache(), 'weights', weights({ trending: 4 }));
    const row = db.settings.get('recommendation.weights');
    assert.equal(row.value_type, 'OBJECT');
    assert.equal(row.group_key, 'recommendation');
    assert.equal(JSON.parse(row.value_json).trending, 4);
    assert.equal(row.updated_by, 7);
    assert.deepEqual(db.txnOps, ['BEGIN', 'COMMIT']);
    assert.ok(db.lockTaken >= 1);
  });

  test('one audit row: the section, before and after, the reason, MEDIUM risk, the actor', async () => {
    const db = createMockDb({ rows: { 'recommendation.weights': recommendation.DEFAULT_WEIGHTS } });
    await save(db, createCache(), 'weights', weights({ trending: 4 }));
    assert.equal(db.auditLog.length, 1);
    const e = db.auditLog[0];
    assert.equal(e.action, 'platform.recommendation.update');
    assert.equal(e.target_ref, 'recommendation.weights');
    assert.equal(e.risk_tier, 'MEDIUM');
    assert.equal(e.actor_id, 7);
    assert.equal(e.before_json.section, 'weights');
    assert.equal(e.before_json.value.trending, recommendation.DEFAULT_WEIGHTS.trending);
    assert.equal(e.after_json.value.trending, 4);
    assert.match(e.after_json.meta?.reason ?? '', /Eid campaign/);
  });

  test('saving one section never touches another section\'s row', async () => {
    const db = createMockDb({ rows: { 'recommendation.diversity': diversity.DEFAULT_DIVERSITY } });
    const before = db.settings.get('recommendation.diversity').value_json;
    await save(db, createCache(), 'cache', { ...recoCache.DEFAULT_CACHE, pool_ttl_seconds: 120 });
    assert.equal(db.settings.get('recommendation.diversity').value_json, before);
    assert.equal(JSON.parse(db.settings.get('recommendation.cache').value_json).pool_ttl_seconds, 120);
  });

  test('the feed\'s settings snapshot is dropped, so the edit applies on the next request', async () => {
    const db = createMockDb({ rows: { 'recommendation.weights': recommendation.DEFAULT_WEIGHTS } });
    const cache = createCache();
    const read = async () => recommendation.sanitizeWeights(
      JSON.parse((await recoCache.loadRecommendationRows(db, cache)).find((r) => r.key === 'recommendation.weights').value_json)
    );
    assert.equal((await read()).trending, recommendation.DEFAULT_WEIGHTS.trending);
    assert.ok(cache.store.has('reco:settings:v1'), 'the snapshot is cached');
    await save(db, cache, 'weights', weights({ trending: 6 }));
    assert.equal(cache.store.has('reco:settings:v1'), false, 'dropped by the save');
    assert.equal((await read()).trending, 6, 'and the very next read sees the new weight');
  });

  test('a rejected value mutates nothing, audits nothing and opens no transaction', async () => {
    const db = createMockDb({ rows: { 'recommendation.weights': recommendation.DEFAULT_WEIGHTS } });
    const stored = db.settings.get('recommendation.weights').value_json;
    await assert.rejects(save(db, createCache(), 'weights', weights({ trending: 999 })), (e) => e.code === 'VALIDATION_FAILED');
    assert.equal(db.settings.get('recommendation.weights').value_json, stored);
    assert.equal(db.auditLog.length, 0);
    assert.deepEqual(db.txnOps, []);
  });

  test('the reason is mandatory in the service itself, not only in the route schema', async () => {
    const db = createMockDb();
    for (const reason of [undefined, '', 'short', '         ']) {
      await assert.rejects(
        admin.updateSection(db, createCache(), auditService, { section: 'cache', value: recoCache.DEFAULT_CACHE, reason, userId: 7 }),
        (e) => e.code === 'VALIDATION_FAILED'
      );
    }
    assert.equal(db.settings.size, 0);
    assert.equal(db.auditLog.length, 0);
  });

  test('a stale form is a CONFLICT: nothing is written, nothing audited, the transaction rolls back', async () => {
    const db = createMockDb();
    const cache = createCache();
    await save(db, cache, 'cache', { ...recoCache.DEFAULT_CACHE, pool_ttl_seconds: 90 }); // another admin got there first
    db.txnOps.length = 0;
    db.auditLog.length = 0;
    await assert.rejects(
      save(db, cache, 'cache', { ...recoCache.DEFAULT_CACHE, pool_ttl_seconds: 300 }, { baseUpdatedAt: null }),
      (e) => e.code === 'CONFLICT' && Boolean(e.messageBn)
    );
    assert.equal(JSON.parse(db.settings.get('recommendation.cache').value_json).pool_ttl_seconds, 90);
    assert.equal(db.auditLog.length, 0);
    assert.deepEqual(db.txnOps, ['BEGIN', 'ROLLBACK']);
  });

  test('a form loaded from the current row saves; so does a first save against a section on defaults', async () => {
    const db = createMockDb();
    const cache = createCache();
    const first = await save(db, cache, 'cache', { ...recoCache.DEFAULT_CACHE, pool_ttl_seconds: 90 }, { baseUpdatedAt: null });
    assert.equal(first.value.pool_ttl_seconds, 90);
    const second = await save(db, cache, 'cache', { ...recoCache.DEFAULT_CACHE, pool_ttl_seconds: 120 }, { baseUpdatedAt: first.updated_at });
    assert.equal(second.value.pool_ttl_seconds, 120);
  });

  test('omitting base_updated_at skips the check (callers that do not track it)', async () => {
    const db = createMockDb();
    await save(db, createCache(), 'cache', { ...recoCache.DEFAULT_CACHE, pool_ttl_seconds: 90 });
    await save(db, createCache(), 'cache', { ...recoCache.DEFAULT_CACHE, pool_ttl_seconds: 120 });
    assert.equal(JSON.parse(db.settings.get('recommendation.cache').value_json).pool_ttl_seconds, 120);
  });

  test('what is stored is what every reader makes of it, unchanged', async () => {
    const db = createMockDb();
    const layout = JSON.parse(JSON.stringify(homeRails.DEFAULT_RAILS_CONFIG));
    layout.rails.reverse();
    layout.rails[0].limit = 6;
    await save(db, createCache(), 'rails', layout);
    const stored = JSON.parse(db.settings.get('recommendation.rails').value_json);
    assert.deepEqual(homeRails.sanitizeRailsConfig(stored), stored);
    assert.equal(stored.rails[0].limit, 6);
  });

  test('a failure inside the transaction rolls back and releases the connection', async () => {
    const db = createMockDb();
    let released = 0;
    db.connect = async () => ({
      query: async (sql, params) => {
        if (String(sql).includes('INSERT INTO platform_settings')) throw new Error('disk full');
        return db.query(sql, params);
      },
      release() { released += 1; },
    });
    await assert.rejects(save(db, createCache(), 'cache', recoCache.DEFAULT_CACHE), /disk full/);
    assert.ok(db.txnOps.includes('ROLLBACK'));
    assert.equal(released, 1);
    assert.equal(db.auditLog.length, 0);
  });
});

// ── 5. Reading ──────────────────────────────────────────────────────────────────────────────────
describe('Reading — what the system is running', () => {
  test('with no rows every section is its shipped default and says so', async () => {
    const sections = await admin.getSettings(createMockDb());
    assert.deepEqual(sections.map((s) => s.key), admin.SECTION_KEYS);
    for (const s of sections) {
      assert.equal(s.is_default, true, s.key);
      assert.equal(s.has_fallbacks, false, s.key);
      assert.deepEqual(s.value, JSON.parse(JSON.stringify(s.defaults)), s.key);
    }
  });

  test('an unreadable table is the shipped defaults, not an error', async () => {
    const sections = await admin.getSettings(createMockDb({ failReads: true }));
    assert.equal(sections.length, admin.SECTION_KEYS.length);
    assert.ok(sections.every((s) => s.is_default));
  });

  test('a stored row is returned with its author and time and is no longer "default"', async () => {
    const db = createMockDb();
    await save(db, createCache(), 'diversity', { ...diversity.DEFAULT_DIVERSITY, window: 8 });
    const s = (await admin.getSettings(db)).find((x) => x.key === 'diversity');
    assert.equal(s.is_default, false);
    assert.equal(s.value.window, 8);
    assert.equal(s.updated_by, 7);
    assert.ok(s.updated_at);
  });

  test('a healthy row whose keys JSONB has re-ordered is NOT flagged (Postgres does not keep key order)', async () => {
    const reversed = Object.fromEntries(Object.entries(recommendation.DEFAULT_WEIGHTS).reverse());
    const layout = JSON.parse(JSON.stringify(homeRails.DEFAULT_RAILS_CONFIG));
    layout.rails = layout.rails.map((r) => Object.fromEntries(Object.entries(r).reverse()));
    const db = createMockDb({ rows: { 'recommendation.weights': reversed, 'recommendation.rails': Object.fromEntries(Object.entries(layout).reverse()) } });
    const sections = await admin.getSettings(db);
    assert.equal(sections.find((s) => s.key === 'weights').has_fallbacks, false);
    assert.equal(sections.find((s) => s.key === 'rails').has_fallbacks, false);
  });

  test('…but a reordered RAILS LIST is a real difference and is not hidden by that tolerance', async () => {
    const layout = JSON.parse(JSON.stringify(homeRails.DEFAULT_RAILS_CONFIG));
    layout.rails.reverse();
    layout.rails.push({ key: 'ghost_rail', enabled: true, limit: 5 }); // dropped by the reader, so the stored row differs
    const db = createMockDb({ rows: { 'recommendation.rails': layout } });
    assert.equal((await admin.getSettings(db)).find((s) => s.key === 'rails').has_fallbacks, true);
  });

  test('a hand-edited out-of-range field shows the value that is really running, and is flagged', async () => {
    const db = createMockDb({ rows: { 'recommendation.weights': { ...recommendation.DEFAULT_WEIGHTS, trending: 900 } } });
    const s = (await admin.getSettings(db)).find((x) => x.key === 'weights');
    assert.equal(s.value.trending, recommendation.DEFAULT_WEIGHTS.trending, 'what the feed runs');
    assert.equal(s.has_fallbacks, true, 'the page can tell the operator their stored value is not in effect');
  });

  test('the form description has bounds and defaults for the page, and no server-only parts', async () => {
    const s = (await admin.getSettings(createMockDb())).find((x) => x.key === 'covisit');
    const f = s.fields.find((x) => x.key === 'full_score');
    assert.deepEqual([f.type, f.min, f.max, f.default], ['number', 0.01, 1, 0.3]);
    assert.equal('sanitize' in s, false);
    const rails = (await admin.getSettings(createMockDb())).find((x) => x.key === 'rails');
    assert.equal(rails.fields, undefined);
    assert.equal(rails.catalogue.length, homeRails.RAIL_KEYS.length);
    assert.deepEqual(rails.limits, homeRails.RAIL_LIMITS);
  });

  test('penalties are marked so the page can say "subtracts"', async () => {
    const s = (await admin.getSettings(createMockDb())).find((x) => x.key === 'weights');
    assert.equal(s.fields.find((f) => f.key === 'out_of_stock_penalty').penalty, true);
    assert.equal(s.fields.find((f) => f.key === 'trending').penalty, undefined);
  });
});

// The browser mock cannot import server code, so it carries a copy of the fields and bounds. This is
// what stops that copy going stale: any retuned limit, new field or changed default fails here.
describe('Client mock mirrors the live service', () => {
  test('every flat section: same fields, types, bounds, defaults and flags', async () => {
    const live = await admin.getSettings(createMockDb());
    for (const name of ['weights', 'tuning', 'diversity', 'covisit', 'cache']) {
      const section = live.find((s) => s.key === name);
      assert.deepEqual(JSON.parse(JSON.stringify(clientMock.MOCK_FIELDS[name])), JSON.parse(JSON.stringify(section.fields)), name);
    }
  });

  test('rails: same catalogue, limits and shipped layout', async () => {
    const rails = (await admin.getSettings(createMockDb())).find((s) => s.key === 'rails');
    assert.deepEqual(clientMock.MOCK_RAIL_CATALOGUE, JSON.parse(JSON.stringify(rails.catalogue)));
    assert.deepEqual(clientMock.MOCK_RAIL_LIMITS, JSON.parse(JSON.stringify(rails.limits)));
    assert.deepEqual(clientMock.MOCK_RAIL_DEFAULTS, JSON.parse(JSON.stringify(rails.defaults)));
  });

  test('the mock answers GET with the same section order as the service', () => {
    const body = clientMock.recommendationHandlers.find((h) => h.method === 'GET' && h.path === '/admin/platform/recommendations').handler().body;
    assert.deepEqual(body.sections.map((s) => s.key), admin.SECTION_KEYS);
  });
});

// ── 6. HTTP ─────────────────────────────────────────────────────────────────────────────────────
describe('HTTP surface', () => {
  let app;
  let db;
  const guarded = [];
  const as = { roles: ['super_admin'] };

  before(async () => {
    db = createMockDb();
    app = Fastify({ logger: false });
    app.decorate('db', db);
    app.decorate('cache', createCache());
    app.decorate('authenticate', async (req) => {
      req.user = { id: 9, ref: 'USR-ADMIN', roles: as.roles, role: as.roles[0] };
      req.userPermissions = new Set(as.roles.includes('super_admin') ? ['platform.recommendation.update', 'platform.recommendation.view'] : []);
    });
    app.decorate('requirePermission', (permKey) => {
      guarded.push(permKey);
      return async (req, reply) => {
        if (!req.user?.roles?.includes('super_admin')) {
          return reply.status(403).send({ error: { code: 'PERMISSION_DENIED' } });
        }
      };
    });
    app.register(requestContextPlugin);
    app.register(errorHandlerPlugin);
    await app.register(recommendationAdminRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  const url = '/api/v1/admin/platform/recommendations';

  test('the read returns every section, the roster, the history, the runtime and can_update', async () => {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.sections.map((s) => s.key), admin.SECTION_KEYS);
    assert.ok(body.authority.roles.some((r) => r.key === 'super_admin'));
    assert.ok(Array.isArray(body.history));
    assert.ok(body.runtime.node.pool && body.runtime.node.settings, 'the cache counters are on the page');
    assert.equal(body.can_update, true);
    assert.equal(body.min_reason_length, 10);
  });

  test('the funnel read answers with a window and a list, empty when nothing is tagged', async () => {
    const res = await app.inject({ method: 'GET', url: `${url}/funnel?days=30&attribution_days=14` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.window, { days: 30, attribution_days: 14 });
    assert.deepEqual(body.surfaces, []);
    assert.ok(body.limits.days.max >= 30);
  });

  test('the funnel refuses a stray query parameter and an unknown audience', async () => {
    assert.equal((await app.inject({ method: 'GET', url: `${url}/funnel?audience=admin` })).statusCode, 400);
  });

  test('PUT with no reason is refused by the route schema', async () => {
    const res = await app.inject({ method: 'PUT', url: `${url}/cache`, payload: { value: recoCache.DEFAULT_CACHE } });
    assert.equal(res.statusCode, 400);
  });

  test('PUT with a reason under 10 characters is refused', async () => {
    const res = await app.inject({ method: 'PUT', url: `${url}/cache`, payload: { value: recoCache.DEFAULT_CACHE, reason: 'because' } });
    assert.equal(res.statusCode, 400);
  });

  test('PUT to an unknown section is refused and writes nothing', async () => {
    const res = await app.inject({ method: 'PUT', url: `${url}/payments`, payload: { value: {}, reason: 'A perfectly good reason here.' } });
    assert.equal(res.statusCode, 400);
    assert.equal(db.settings.has('recommendation.payments'), false);
  });

  test('an out-of-range value is a 400 with both languages and the field, and changes nothing', async () => {
    const res = await app.inject({
      method: 'PUT', url: `${url}/weights`,
      payload: { value: { ...recommendation.DEFAULT_WEIGHTS, trending: 400 }, reason: 'Trying an absurd weight here.' },
    });
    assert.equal(res.statusCode, 400);
    const err = res.json().error;
    assert.equal(err.code, 'VALIDATION_FAILED');
    assert.ok(err.message_en && err.message_bn);
    assert.equal(db.settings.has('recommendation.weights'), false);
  });

  test('a stale form is a 409', async () => {
    await app.inject({ method: 'PUT', url: `${url}/diversity`, payload: { value: { ...diversity.DEFAULT_DIVERSITY, window: 7 }, reason: 'First admin saves a window.' } });
    const res = await app.inject({
      method: 'PUT', url: `${url}/diversity`,
      payload: { value: { ...diversity.DEFAULT_DIVERSITY, window: 9 }, base_updated_at: null, reason: 'Second admin had an old form.' },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'CONFLICT');
  });

  test('a valid PUT saves, audits and is visible on the next read', async () => {
    const res = await app.inject({
      method: 'PUT', url: `${url}/covisit`,
      payload: { value: { ...JSON.parse(JSON.stringify(admin.SECTIONS.covisit.defaults)), min_actors: 5 }, reason: 'Catalog grew, so ask for more evidence.' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().section.value.min_actors, 5);
    assert.ok(res.json().message_en && res.json().message_bn);
    assert.ok(db.auditLog.some((e) => e.action === 'platform.recommendation.update' && e.target_ref === 'recommendation.covisit'));
    const read = (await app.inject({ method: 'GET', url })).json();
    assert.equal(read.sections.find((s) => s.key === 'covisit').value.min_actors, 5);
  });

  test('without the permission every route is a 403 and nothing is written (the negative test)', async () => {
    as.roles = ['customer'];
    try {
      const writes = db.settings.size;
      const audits = db.auditLog.length;
      assert.equal((await app.inject({ method: 'GET', url })).statusCode, 403);
      assert.equal((await app.inject({ method: 'GET', url: `${url}/funnel` })).statusCode, 403);
      const put = await app.inject({ method: 'PUT', url: `${url}/cache`, payload: { value: recoCache.DEFAULT_CACHE, reason: 'I should not be able to do this.' } });
      assert.equal(put.statusCode, 403);
      assert.equal(db.settings.size, writes);
      assert.equal(db.auditLog.length, audits);
    } finally {
      as.roles = ['super_admin'];
    }
  });

  test('reads are guarded by the view key and the write by the update key', async () => {
    assert.deepEqual(
      guarded.sort(),
      ['platform.recommendation.update', 'platform.recommendation.view']
    );
    const src = fs.readFileSync(path.join(repoRoot, 'server/src/routes/recommendationAdmin.routes.js'), 'utf8');
    assert.match(src, /preHandler: \[auth, view\]/);
    assert.match(src, /preHandler: \[auth, update\]/);
    assert.doesNotMatch(src, /config:\s*\{[^}]*requirePermission/, 'invariant 11: the guard is a preHandler, never a config key');
  });

  test('every route declares its page, so parking the page at /admin/platform/pages parks the API too', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'server/src/routes/recommendationAdmin.routes.js'), 'utf8');
    assert.equal((src.match(/config: \{ page: PAGE \}/g) || []).length, 3);
    assert.match(src, /const PAGE = '\/admin\/platform\/recommendations'/);
  });
});

// ── 7. Contract ─────────────────────────────────────────────────────────────────────────────────
describe('Permission catalog, seed and wiring', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/permission-catalog.json'), 'utf8'));
  const byKey = new Map(catalog.permissions.map((p) => [p.key, p]));

  test('the update key is delegable and MEDIUM — handing it to one person is the point', () => {
    const p = byKey.get('platform.recommendation.update');
    assert.ok(p, 'in the catalog');
    assert.equal(p.delegable, true);
    assert.equal(p.risk_tier, 'MEDIUM', 'CRITICAL would imply delegable:false');
    assert.deepEqual(p.default_roles, ['super_admin']);
    assert.ok(p.plain_en && p.plain_bn);
  });

  test('the view key is LOW and held by admin and super admin', () => {
    const p = byKey.get('platform.recommendation.view');
    assert.ok(p, 'in the catalog');
    assert.equal(p.risk_tier, 'LOW');
    assert.ok(p.default_roles.includes('admin') && p.default_roles.includes('super_admin'));
  });

  test('the generated seed carries both keys and their role grants', () => {
    const seed = fs.readFileSync(path.join(repoRoot, 'server/src/db/seeds/001_roles_permissions.sql'), 'utf8');
    assert.match(seed, /\('platform\.recommendation\.view', 'platform'/);
    assert.match(seed, /\('platform\.recommendation\.update', 'platform'/);
    assert.match(seed, /\('super_admin', 'platform\.recommendation\.update'\)/);
    assert.match(seed, /\('admin', 'platform\.recommendation\.view'\)/);
  });

  test('the routes are registered in app.js', () => {
    const app = fs.readFileSync(path.join(repoRoot, 'server/src/app.js'), 'utf8');
    assert.match(app, /import recommendationAdminRoutes from '\.\/routes\/recommendationAdmin\.routes\.js'/);
    assert.match(app, /app\.register\(recommendationAdminRoutes, \{ prefix: '\/api\/v1' \}\)/);
  });
});
