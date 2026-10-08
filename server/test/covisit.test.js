/**
 * covisit.test.js — Invariants for Phase E of the personalized home feed (co-visitation, migration 059).
 *
 *   1. Policy      — the numbers are a setting, sanitised per field; defaults cannot drift from the
 *                    migration; the "at least 2 shoppers" floor cannot be configured away.
 *   2. Seeds       — the signal starts from the shopper's own recent products, recent first, no repeats.
 *   3. Score SQL   — one indexed lookup over the seeds, every bound parameter used, the seeds themselves
 *                    excluded, weight 0 / no seeds / nothing bound; only numbers are inlined.
 *   4. Spec        — an opted-out shopper has no seeds and nothing is read about them.
 *   5. Rebuild     — the aggregate is replaced in ONE transaction, from customer intent events only,
 *                    keeps no actor identity, and a failed run leaves the old aggregate in place.
 *   6. Migration   — what 059 creates: an aggregate keyed by product pair with no actor column.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as covisit from '../src/services/covisit.service.js';
import * as covisitRepo from '../src/repositories/covisit.repository.js';
import * as reco from '../src/services/recommendation.service.js';
import { buildBlendedRank } from '../src/repositories/recommendation.repository.js';
import { runCovisitRebuild } from '../src/jobs/covisitRebuild.job.js';

const migration = fs.readFileSync(path.resolve(import.meta.dirname, '../src/db/migrations/059_covisitation.sql'), 'utf8');

function makeDb(routes = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      for (const r of routes) if (r.match(sql)) return r.reply(sql, params);
      return { rows: [], rowCount: 0 };
    },
  };
}

/** A pool: connect() hands out a client that records its statements, like pg.Pool. */
function makePool({ failOn } = {}) {
  const client = makeDb([
    { match: (s) => s.includes('COUNT(DISTINCT product_id)'), reply: () => ({ rows: [{ products: 4 }] }) },
    { match: (s) => s.includes('INSERT INTO product_covisits'), reply: () => ({ rows: [], rowCount: 9 }) },
  ]);
  const inner = client.query.bind(client);
  client.query = async (sql, params) => {
    if (failOn && sql.includes(failOn)) throw new Error('boom');
    return inner(sql, params);
  };
  client.release = () => { client.released = true; };
  const pool = { totalCount: 1, async connect() { return client; }, async query() { throw new Error('use the client'); } };
  return { pool, client };
}

const spec = (over = {}) => ({
  weights: { ...reco.DEFAULT_WEIGHTS },
  tuning: { ...reco.DEFAULT_TUNING },
  audience: 'customer',
  categoryIds: [],
  brands: [],
  supplierIds: [],
  viewedIds: [],
  purchasedIds: [],
  covisitIds: [],
  covisitFullScore: 0.3,
  district: null,
  ...over,
});

const build = (s) => {
  const params = [];
  const r = buildBlendedRank(s, params);
  return { ...r, params, sql: `${r.select} ${r.joins} ${r.orderBy}`.replace(/\s+/g, ' ') };
};

// ── 1. Policy ───────────────────────────────────────────────────────────────────────────────────
describe('Co-visitation — policy', () => {
  test('shipped defaults are exactly what migration 059 seeds', () => {
    const m = migration.match(/'recommendation\.covisit',\s*'(\{[\s\S]*?\})'::jsonb/);
    assert.ok(m, 'recommendation.covisit must be seeded');
    assert.deepEqual(JSON.parse(m[1]), JSON.parse(JSON.stringify(covisit.DEFAULT_COVISIT)));
  });

  test('every default sits inside its own limit', () => {
    for (const [k, { min, max, integer }] of Object.entries(covisit.COVISIT_LIMITS)) {
      const v = covisit.DEFAULT_COVISIT[k];
      assert.ok(v >= min && v <= max, k);
      if (integer) assert.ok(Number.isInteger(v), k);
    }
  });

  test('a bad value falls back to its own default and keeps the rest', () => {
    const out = covisit.sanitizeCovisit({ window_days: 30, min_actors: 'many', max_related: 9999, full_score: 0.5 });
    assert.equal(out.window_days, 30);
    assert.equal(out.min_actors, covisit.DEFAULT_COVISIT.min_actors);
    assert.equal(out.max_related, covisit.DEFAULT_COVISIT.max_related);
    assert.equal(out.full_score, 0.5);
  });

  test('a pair can never be a single shopper: min_actors below 2 is refused', () => {
    assert.equal(covisit.sanitizeCovisit({ min_actors: 1 }).min_actors, covisit.DEFAULT_COVISIT.min_actors);
    assert.equal(covisit.sanitizeCovisit({ min_actors: 0 }).min_actors, covisit.DEFAULT_COVISIT.min_actors);
    assert.equal(covisit.sanitizeCovisit({ min_actors: 2 }).min_actors, 2);
  });

  test('null, empty and fractional-for-integer values are rejected, not read as zero', () => {
    const out = covisit.sanitizeCovisit({ window_days: null, seed_limit: '', max_related: 2.5, enabled: 'no' });
    assert.equal(out.window_days, covisit.DEFAULT_COVISIT.window_days);
    assert.equal(out.seed_limit, covisit.DEFAULT_COVISIT.seed_limit);
    assert.equal(out.max_related, covisit.DEFAULT_COVISIT.max_related);
    assert.equal(out.enabled, true, 'a non-boolean enabled falls back to the default');
  });

  test('enabled=false is respected', () => {
    assert.equal(covisit.sanitizeCovisit({ enabled: false }).enabled, false);
  });

  test('garbage in place of an object yields the defaults', () => {
    for (const bad of [null, undefined, 'x', 5, [1, 2]]) {
      assert.deepEqual(covisit.sanitizeCovisit(bad), JSON.parse(JSON.stringify(covisit.DEFAULT_COVISIT)));
    }
  });

  test('resolveCovisitConfig reads the row (JSON string too) and survives a missing table', async () => {
    const db = makeDb([
      {
        match: (s) => s.includes('FROM platform_settings'),
        reply: () => ({ rows: [{ key: 'recommendation.covisit', value_json: JSON.stringify({ min_actors: 5 }) }] }),
      },
    ]);
    assert.equal((await covisit.resolveCovisitConfig(db)).min_actors, 5);
    const broken = { query: async () => { throw new Error('relation "platform_settings" does not exist'); } };
    assert.deepEqual(await covisit.resolveCovisitConfig(broken), JSON.parse(JSON.stringify(covisit.DEFAULT_COVISIT)));
  });

  test('the ranking config carries the co-visitation policy from the same settings read', async () => {
    const db = makeDb([
      {
        match: (s) => s.includes('FROM platform_settings'),
        reply: () => ({ rows: [{ key: 'recommendation.covisit', value_json: { seed_limit: 3 } }] }),
      },
    ]);
    const cfg = await reco.resolveRankingConfig(db);
    assert.equal(cfg.covisit.seed_limit, 3);
    assert.equal(db.calls.length, 1, 'one settings read, not one per policy');
  });

  test('the weight exists, is on by default and is a positive signal', () => {
    assert.equal(reco.DEFAULT_WEIGHTS.covisited, 2);
    assert.equal(reco.sanitizeWeights({ covisited: 99 }).covisited, reco.DEFAULT_WEIGHTS.covisited);
    assert.equal(reco.sanitizeWeights({ covisited: 0 }).covisited, 0);
  });
});

// ── 2. Seeds ────────────────────────────────────────────────────────────────────────────────────
describe('Co-visitation — seeds', () => {
  test('recently opened first, then bought, no repeats', () => {
    assert.deepEqual(covisit.pickSeedIds({ viewedIds: [5, 6], purchasedIds: [6, 7] }), [5, 6, 7]);
  });

  test('capped at seed_limit, keeping the most recent', () => {
    const seeds = covisit.pickSeedIds({ viewedIds: [1, 2, 3, 4, 5], purchasedIds: [9] }, { seed_limit: 3 });
    assert.deepEqual(seeds, [1, 2, 3]);
  });

  test('no history, no seeds', () => {
    assert.deepEqual(covisit.pickSeedIds({}), []);
    assert.deepEqual(covisit.pickSeedIds(), []);
  });

  test('ids that arrive as strings and numbers are the same product', () => {
    assert.deepEqual(covisit.pickSeedIds({ viewedIds: ['5'], purchasedIds: [5] }), ['5']);
  });
});

// ── 3. Score SQL ────────────────────────────────────────────────────────────────────────────────
describe('Co-visitation — score SQL', () => {
  test('with seeds it joins the precomputed aggregate, not the event log', () => {
    const { sql, params } = build(spec({ covisitIds: [5, 6] }));
    assert.match(sql, /LEFT JOIN \( SELECT related_product_id AS product_id, SUM\(score\) AS s FROM product_covisits/);
    assert.match(sql, /'covisited'/);
    assert.ok(params.some((p) => Array.isArray(p) && p.join() === '5,6'));
    const join = sql.slice(sql.indexOf('FROM product_covisits'), sql.indexOf(') cv ON'));
    assert.doesNotMatch(join, /product_interaction_events/, 'the request path must not scan the event log');
  });

  test('the seeds are bound once and used twice: looked up, and excluded from the answer', () => {
    const { sql, params } = build(spec({ covisitIds: [5, 6] }));
    const bound = params.findIndex((p) => Array.isArray(p) && p.join() === '5,6') + 1;
    const uses = sql.split(`$${bound}::bigint[]`).length - 1;
    assert.equal(uses, 2);
    assert.match(sql, /related_product_id <> ALL\(/);
  });

  test('the component is scaled by full_score and capped at 1', () => {
    const { sql } = build(spec({ covisitIds: [5], covisitFullScore: 0.25 }));
    assert.match(sql, /LEAST\(1, COALESCE\(cv\.s, 0\) \/ 0\.25\)/);
    assert.match(sql, /\(2 \* \(LEAST\(1, COALESCE\(cv\.s/);
  });

  test('no seeds: no join, no parameter, no component', () => {
    const { sql, params } = build(spec());
    assert.doesNotMatch(sql, /product_covisits/);
    assert.doesNotMatch(sql, /'covisited'/);
    assert.equal(params.some(Array.isArray), false);
  });

  test('weight 0 switches the signal off completely - nothing joined, nothing bound', () => {
    const w = { ...reco.DEFAULT_WEIGHTS, covisited: 0 };
    const { sql, params } = build(spec({ covisitIds: [5], weights: w }));
    assert.doesNotMatch(sql, /product_covisits/);
    assert.equal(params.some(Array.isArray), false, 'an unused bound parameter would make Postgres reject the statement');
  });

  test('every bound parameter is referenced', () => {
    const { sql, params } = build(spec({ covisitIds: [5], viewedIds: [5], categoryIds: [3], purchasedIds: [8] }));
    for (let i = 1; i <= params.length; i++) assert.ok(sql.includes(`$${i}`), `$${i} is bound but unused`);
  });

  test('a hostile full_score is not injected', () => {
    const { sql } = build(spec({ covisitIds: [5], covisitFullScore: "1); DROP TABLE products;--" }));
    assert.doesNotMatch(sql, /DROP TABLE/);
  });

  test('the score reads as the existing "What others are looking for" badge', () => {
    assert.equal(reco.reasonFromComponents({ covisited: 1.4, quality: 1.5 }), 'crowd');
    // ...but a weak co-visit does not claim the placement.
    assert.equal(reco.reasonFromComponents({ covisited: 0.2, quality: 1.5 }), 'explore');
  });
});

// ── 4. Ranking spec ─────────────────────────────────────────────────────────────────────────────
describe('Co-visitation — ranking spec', () => {
  const cfg = { weights: { ...reco.DEFAULT_WEIGHTS }, tuning: { ...reco.DEFAULT_TUNING }, covisit: { ...covisit.DEFAULT_COVISIT } };
  const history = () =>
    makeDb([
      { match: (s) => s.includes("event_type IN ('CLICK'"), reply: () => ({ rows: [{ product_id: '5' }, { product_id: '6' }] }) },
      { match: (s) => s.includes('FROM order_items'), reply: () => ({ rows: [{ product_id: '7' }] }) },
    ]);

  test('seeds come from the shopper\'s own recent products and purchases', async () => {
    const s = await reco.buildRankingSpec(history(), { userId: 7, config: cfg });
    assert.deepEqual(s.covisitIds, [5, 6, 7]);
    assert.equal(s.covisitFullScore, covisit.DEFAULT_COVISIT.full_score);
  });

  test('an opted-out shopper has no seeds and nothing about them is read', async () => {
    const db = history();
    const s = await reco.buildRankingSpec(db, { userId: 7, personalize: false, config: cfg });
    assert.deepEqual(s.covisitIds, []);
    assert.equal(db.calls.length, 0);
  });

  test('a shopper with no identity has no seeds', async () => {
    const s = await reco.buildRankingSpec(makeDb(), { config: cfg });
    assert.deepEqual(s.covisitIds, []);
  });

  test('co-visitation switched off in settings: no seeds, so no join', async () => {
    const off = { ...cfg, covisit: { ...cfg.covisit, enabled: false } };
    const s = await reco.buildRankingSpec(history(), { userId: 7, config: off });
    assert.deepEqual(s.covisitIds, []);
  });

  test('a weight of 0: no seeds', async () => {
    const zero = { ...cfg, weights: { ...cfg.weights, covisited: 0 } };
    const s = await reco.buildRankingSpec(history(), { userId: 7, config: zero });
    assert.deepEqual(s.covisitIds, []);
  });

  test('a config without a covisit block (older caller) still ranks', async () => {
    const s = await reco.buildRankingSpec(history(), { userId: 7, config: { weights: cfg.weights, tuning: cfg.tuning } });
    assert.deepEqual(s.covisitIds, [5, 6, 7]);
  });

  test('the seed_limit setting bounds the lookup array', async () => {
    const tight = { ...cfg, covisit: { ...cfg.covisit, seed_limit: 2 } };
    const s = await reco.buildRankingSpec(history(), { userId: 7, config: tight });
    assert.deepEqual(s.covisitIds, [5, 6]);
  });
});

// ── 5. Rebuild ──────────────────────────────────────────────────────────────────────────────────
describe('Co-visitation — rebuild', () => {
  test('the aggregate is replaced inside one transaction: delete, insert, commit', async () => {
    const { pool, client } = makePool();
    const out = await covisit.rebuildCovisits(pool, { config: covisit.DEFAULT_COVISIT });
    assert.deepEqual(out, { pairs: 9, products: 4 });
    const seq = client.calls.map((c) => c.sql.split(' ').slice(0, 2).join(' '));
    assert.equal(seq[0], 'BEGIN');
    assert.ok(seq.indexOf('DELETE FROM') < seq.findIndex((s) => s.startsWith('WITH touched')));
    assert.equal(seq.at(-1), 'COMMIT');
    assert.equal(client.released, true);
  });

  test('a failure rolls back, so the old aggregate stays and the client is released', async () => {
    const { pool, client } = makePool({ failOn: 'WITH touched' });
    await assert.rejects(() => covisit.rebuildCovisits(pool, { config: covisit.DEFAULT_COVISIT }), /boom/);
    const seq = client.calls.map((c) => c.sql);
    assert.ok(seq.includes('ROLLBACK'));
    assert.equal(seq.includes('COMMIT'), false);
    assert.equal(client.released, true);
  });

  test('given a checked-out client it joins the caller\'s transaction instead of opening one', async () => {
    const { client } = makePool();
    await covisit.rebuildCovisits(client, { config: covisit.DEFAULT_COVISIT });
    const sqls = client.calls.map((c) => c.sql);
    assert.equal(sqls.includes('BEGIN'), false);
    assert.equal(sqls.includes('COMMIT'), false);
  });

  test('disabled in settings: nothing is touched', async () => {
    const { pool, client } = makePool();
    const out = await covisit.rebuildCovisits(pool, { config: { ...covisit.DEFAULT_COVISIT, enabled: false } });
    assert.equal(out.skipped, true);
    assert.equal(client.calls.length, 0);
  });

  test('the config drives the query parameters', async () => {
    const { client } = makePool();
    await covisitRepo.replaceCovisits(client, { window_days: 14, max_products_per_actor: 10, min_actors: 4, max_related: 6 });
    const insert = client.calls.find((c) => c.sql.startsWith('WITH touched'));
    assert.deepEqual(insert.params, [14, 10, 4, 6]);
  });

  const sqlOf = async () => {
    const { client } = makePool();
    await covisitRepo.replaceCovisits(client, covisit.DEFAULT_COVISIT);
    return client.calls.find((c) => c.sql.startsWith('WITH touched')).sql;
  };

  test('only product-opening intent counts: impressions and store follows do not', async () => {
    const sql = await sqlOf();
    const list = sql.match(/e\.event_type IN \(([^)]*)\)/)[1];
    assert.doesNotMatch(list, /'VIEW'/);
    assert.doesNotMatch(list, /FOLLOW_STORE/);
    for (const wanted of ['CLICK', 'SEARCH_CLICK', 'ADD_CART', 'PURCHASE']) assert.match(list, new RegExp(`'${wanted}'`));
  });

  test('shoppers only: the saler sourcing audience is not mixed in', async () => {
    assert.match(await sqlOf(), /e\.audience = 'customer'/);
  });

  test('only live products can be related to each other', async () => {
    assert.match(await sqlOf(), /pr\.status = 'ACTIVE' AND pr\.deleted_at IS NULL/);
  });

  test('one actor counts once per product however many events they produced', async () => {
    assert.match(await sqlOf(), /GROUP BY 1, 2/);
  });

  test('the score is cosine similarity, so a best seller does not relate to everything', async () => {
    assert.match(await sqlOf(), /pairs\.together \/ SQRT\(ap\.n \* aq\.n\)/);
  });

  test('a pair needs min_actors distinct actors, and an actor\'s basket is capped before the self-join', async () => {
    const sql = await sqlOf();
    assert.match(sql, /HAVING COUNT\(\*\) >= \$3/);
    assert.match(sql, /WHERE rn <= \$2/);
  });

  test('the stored columns carry no actor identity', async () => {
    const sql = await sqlOf();
    assert.match(sql, /INSERT INTO product_covisits \(product_id, related_product_id, actors, score\)/);
  });

  test('the job reports the rebuild to the scheduler', async () => {
    const { pool } = makePool();
    const logs = [];
    const logger = { info: (m) => logs.push(m) };
    const settings = makeDb();
    pool.query = settings.query.bind(settings); // no settings row -> shipped defaults -> enabled
    const out = await runCovisitRebuild(pool, null, logger);
    assert.equal(out.errorCount, 0);
    assert.equal(out.metadata.pairs, 9);
    assert.match(logs[0], /9 related pairs across 4 products/);
  });

  test('the job skips quietly, touching no table, when settings turn it off', async () => {
    const { pool, client } = makePool();
    const off = makeDb([
      {
        match: (s) => s.includes('FROM platform_settings'),
        reply: () => ({ rows: [{ key: 'recommendation.covisit', value_json: { enabled: false } }] }),
      },
    ]);
    pool.query = off.query.bind(off);
    const logs = [];
    const out = await runCovisitRebuild(pool, null, { info: (m) => logs.push(m) });
    assert.equal(out.metadata.skipped, true);
    assert.equal(client.calls.length, 0);
    assert.match(logs[0], /disabled/);
  });
});

// ── 6. Migration ────────────────────────────────────────────────────────────────────────────────
describe('Co-visitation — migration 059', () => {
  const table = migration.match(/CREATE TABLE IF NOT EXISTS product_covisits \(([\s\S]*?)\n\);/)[1];

  test('the aggregate is keyed by product pair and stores no actor', () => {
    assert.match(table, /PRIMARY KEY \(product_id, related_product_id\)/);
    assert.doesNotMatch(table, /user_id|session_id|actor_id/);
  });

  test('a product is never related to itself, and the score is bounded to 0..1', () => {
    assert.match(table, /CHECK \(product_id <> related_product_id\)/);
    assert.match(table, /CHECK \(score > 0 AND score <= 1\)/);
  });

  test('rows go with their product', () => {
    assert.equal((table.match(/ON DELETE CASCADE/g) || []).length, 2);
  });

  test('re-running cannot stamp a tuned value back to the default', () => {
    assert.match(migration, /'recommendation\.covisit'[\s\S]*?ON CONFLICT \(key\) DO NOTHING/);
    assert.match(migration, /'\{"covisited": 2\}'::jsonb \|\| value_json/, 'the existing value is on the right, so it wins');
    assert.match(migration, /AND NOT EXISTS \([\s\S]*?r ->> 'key' = 'also_viewed'/, 'the rail is added once');
  });
});
