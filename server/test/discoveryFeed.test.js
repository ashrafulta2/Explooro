/**
 * discoveryFeed.test.js — Invariants for the interest-based discovery feed (/discover).
 *
 * The feed's job is to (a) record behavioral signals honestly and (b) rank the catalog by a
 * recency-decayed affinity profile while degrading cleanly to popularity for a shopper with no
 * history. Each suite below pins one of those guarantees so a regression fails the build:
 *
 *   1. recordEvents (service) — validation, normalization, weighting, actor scoping.
 *   2. recordEvents (repository) — parameterized multi-row INSERT shaping.
 *   3. getAffinity (repository) — actor scoping, audience/window binding, result coercion.
 *   4. resolveFeedSettings — admin-tunable page size / window, clamped, with safe fallbacks.
 *   5. getFeed — over-fetch-by-one pagination meta and the `personalized` flag.
 *   6. `recommended` ranking — the score the ORDER BY encodes (mirrored), pinning its intent.
 *   7. Migration contract — the DB CHECK constraints agree with the code's accepted values.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as discoveryService from '../src/services/discoveryFeed.service.js';
import * as feedRepo from '../src/repositories/discoveryFeed.repository.js';

// ── A configurable mock db. Each test wires only the queries it needs; anything unrecognized
// returns { rows: [] } so pricing enrichment falls to its documented defaults rather than throwing.
function makeDb(routes = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      for (const r of routes) {
        if (r.match(sql)) return r.reply(sql, params);
      }
      return { rows: [] };
    },
  };
}

describe('Discovery feed — recordEvents (service validation)', () => {
  test('assigns the intended weight per event type and normalizes camel/snake case', async () => {
    let inserted = null;
    const db = makeDb([
      { match: (s) => s.includes('INSERT INTO product_interaction_events'), reply: () => ({ rows: [] }) },
    ]);
    // Capture the normalized rows the service hands the repository.
    const origQuery = db.query.bind(db);
    db.query = async (sql, params) => {
      if (sql.includes('INSERT INTO product_interaction_events')) inserted = params;
      return origQuery(sql, params);
    };

    const res = await discoveryService.recordEvents(db, {
      userId: 7,
      audience: 'customer',
      events: [
        { event_type: 'view', product_id: '11', category_id: '3' },
        { eventType: 'ADD_CART', productId: 12, supplierId: 99, dwell_ms: '250' },
      ],
    });

    assert.equal(res.recorded, 2);
    // 9 columns per row, in this order: user_id(0), session_id(1), product_id(2), category_id(3),
    // supplier_id(4), event_type(5), dwell_ms(6), weight(7), audience(8). Row 1 starts at index 9.
    assert.equal(inserted.length, 18);
    assert.equal(inserted[5], 'VIEW'); // event_type coerced upper
    assert.equal(inserted[7], 1); // VIEW weight
    assert.equal(inserted[14], 'ADD_CART'); // 9 + 5
    assert.equal(inserted[16], 4); // 9 + 7 → ADD_CART weight
  });

  test('a signed-in user is tracked by user_id, never their session_id', async () => {
    let inserted = null;
    const db = makeDb();
    db.query = async (sql, params) => {
      if (sql.includes('INSERT INTO product_interaction_events')) inserted = params;
      return { rows: [] };
    };
    await discoveryService.recordEvents(db, {
      userId: 42,
      sessionId: 'sess-abc',
      events: [{ event_type: 'CLICK', product_id: 5 }],
    });
    assert.equal(inserted[0], 42, 'user_id set');
    assert.equal(inserted[1], null, 'session_id nulled when a user is present');
  });

  test('rejects an unknown event type instead of silently dropping it', async () => {
    const db = makeDb();
    await assert.rejects(
      () => discoveryService.recordEvents(db, { userId: 1, events: [{ event_type: 'HOVER', product_id: 3 }] }),
      /Unknown discovery event type/
    );
  });

  test('rejects an event with no numeric product_id', async () => {
    const db = makeDb();
    await assert.rejects(
      () => discoveryService.recordEvents(db, { userId: 1, events: [{ event_type: 'VIEW' }] }),
      /numeric product_id/
    );
  });

  test('a guest with neither user_id nor session_id is refused', async () => {
    const db = makeDb();
    await assert.rejects(
      () => discoveryService.recordEvents(db, { events: [{ event_type: 'VIEW', product_id: 3 }] }),
      /session_id is required/
    );
  });

  test('caps the batch size so one call cannot flood the table', async () => {
    const db = makeDb();
    const flood = Array.from({ length: 51 }, () => ({ event_type: 'VIEW', product_id: 1 }));
    await assert.rejects(
      () => discoveryService.recordEvents(db, { userId: 1, events: flood }),
      /Too many events/
    );
  });

  test('an empty batch is a no-op that never touches the db', async () => {
    const db = makeDb();
    const res = await discoveryService.recordEvents(db, { userId: 1, events: [] });
    assert.deepEqual(res, { recorded: 0 });
    assert.equal(db.calls.length, 0);
  });

  test('an invalid audience is coerced to customer, not persisted verbatim', async () => {
    let inserted = null;
    const db = makeDb();
    db.query = async (sql, params) => {
      if (sql.includes('INSERT INTO product_interaction_events')) inserted = params;
      return { rows: [] };
    };
    await discoveryService.recordEvents(db, {
      sessionId: 'g1',
      audience: 'hacker',
      events: [{ event_type: 'VIEW', product_id: 3 }],
    });
    assert.equal(inserted[8], 'customer');
  });
});

describe('Discovery feed — recordEvents (repository SQL shaping)', () => {
  test('emits one placeholder group per event with all nine columns bound', async () => {
    let captured = null;
    const db = {
      async query(sql, params) {
        captured = { sql: sql.replace(/\s+/g, ' ').trim(), params };
        return { rows: [] };
      },
    };
    const n = await feedRepo.recordEvents(db, [
      { userId: 1, sessionId: null, productId: 2, categoryId: 3, supplierId: 4, eventType: 'VIEW', dwellMs: 0, weight: 1, audience: 'customer' },
      { userId: 1, sessionId: null, productId: 5, categoryId: null, supplierId: null, eventType: 'CLICK', dwellMs: 900, weight: 2, audience: 'customer' },
    ]);
    assert.equal(n, 2);
    assert.equal(captured.params.length, 18, 'two rows × nine columns');
    assert.match(captured.sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9\), \(\$10, \$11, \$12, \$13, \$14, \$15, \$16, \$17, \$18\)/);
    // Nulls survive as nulls (not the string "null"), weight defaults hold.
    assert.equal(captured.params[10], null); // second row category_id
    assert.equal(captured.params[16], 2); // second row weight
  });

  test('an empty list is a no-op with no query', async () => {
    let called = false;
    const db = { async query() { called = true; return { rows: [] }; } };
    const n = await feedRepo.recordEvents(db, []);
    assert.equal(n, 0);
    assert.equal(called, false);
  });
});

describe('Discovery feed — getAffinity (repository)', () => {
  test('an actor-less call short-circuits without querying', async () => {
    let called = false;
    const db = { async query() { called = true; return { rows: [] }; } };
    const res = await feedRepo.getAffinity(db, {});
    assert.deepEqual(res, { categoryIds: [], brands: [], supplierIds: [] });
    assert.equal(called, false);
  });

  test('a signed-in user is scoped by user_id; the audience and window are bound', async () => {
    const seen = [];
    const db = {
      async query(sql, params) {
        seen.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        if (sql.includes('e.category_id AS dim')) return { rows: [{ dim: '3' }, { dim: '8' }] };
        if (sql.includes('p.brand AS dim')) return { rows: [{ dim: 'Aarong' }, { dim: null }] };
        if (sql.includes('e.supplier_id AS dim')) return { rows: [{ dim: '101' }] };
        return { rows: [] };
      },
    };
    const res = await feedRepo.getAffinity(db, { userId: 7, audience: 'saler', windowDays: 14 });

    // Each of the three dimension queries scopes by user_id and carries audience + window params.
    for (const c of seen) {
      assert.match(c.sql, /user_id = \$1/, 'user actor clause first');
      assert.ok(c.params.includes('saler'), 'audience bound');
      assert.ok(c.params.includes(14), 'window bound');
    }
    assert.deepEqual(res.categoryIds, [3, 8], 'ids coerced to numbers');
    assert.deepEqual(res.brands, ['Aarong'], 'null brand dropped');
    assert.deepEqual(res.supplierIds, [101]);
  });

  test('a guest is scoped by session_id', async () => {
    const seen = [];
    const db = {
      async query(sql, params) {
        seen.push(params);
        return { rows: [] };
      },
    };
    await feedRepo.getAffinity(db, { sessionId: 'sess-xyz' });
    assert.ok(seen.every((p) => p.includes('sess-xyz')), 'session id is the actor');
  });
});

describe('Discovery feed — resolveFeedSettings', () => {
  const settingsRoute = (json) => [{
    match: (s) => s.includes("FROM platform_modules WHERE key = 'discovery_feed'"),
    reply: () => ({ rows: [{ settings_json: json }] }),
  }];

  test('reads admin overrides and floors fractional values', async () => {
    const db = makeDb(settingsRoute({ affinity_window_days: 45.9, page_size: 12.7 }));
    const s = await discoveryService.resolveFeedSettings(db);
    assert.equal(s.affinityWindowDays, 45);
    assert.equal(s.pageSize, 12);
  });

  test('clamps an over-large page size to the ceiling', async () => {
    const db = makeDb(settingsRoute({ page_size: 500 }));
    const s = await discoveryService.resolveFeedSettings(db);
    assert.equal(s.pageSize, 30, 'MAX_PAGE_SIZE caps a runaway admin value');
  });

  test('falls back to defaults when the row or its JSON is unusable', async () => {
    const missing = makeDb([]); // no discovery_feed row → { rows: [] }
    assert.deepEqual(await discoveryService.resolveFeedSettings(missing), {
      affinityWindowDays: 30,
      pageSize: 10,
    });

    const garbage = makeDb(settingsRoute('{ not json'));
    const s = await discoveryService.resolveFeedSettings(garbage);
    assert.equal(s.affinityWindowDays, 30);
    assert.equal(s.pageSize, 10);
  });

  test('a JSON string (not just an object) is parsed', async () => {
    const db = makeDb(settingsRoute(JSON.stringify({ page_size: 6, affinity_window_days: 20 })));
    const s = await discoveryService.resolveFeedSettings(db);
    assert.equal(s.pageSize, 6);
    assert.equal(s.affinityWindowDays, 20);
  });
});

describe('Discovery feed — getFeed pagination & personalization', () => {
  // A mock db that serves: the settings row, the three affinity queries, the catalog SELECT
  // (honoring the trailing LIMIT/OFFSET params), and empty commission rows so pricing uses the
  // 40/60 default. Ordering is Postgres's job, so this suite verifies plumbing, not rank order.
  function feedDb({ settings = { page_size: 10 }, affinity = {}, total = 0 } = {}) {
    const catalog = Array.from({ length: total }, (_, i) => ({
      id: i + 1,
      ref: `PRD-${i + 1}`,
      slug: `p-${i + 1}`,
      title_en: `Product ${i + 1}`,
      title_bn: `পণ্য ${i + 1}`,
      category_id: 3,
      supplier_id: 101,
      brand: 'Aarong',
      base_cost: '100.00',
      wholesale_margin: '0.00',
      default_retail_price: '150.00',
      price: '150.00',
      stock_qty: 5,
      status: 'ACTIVE',
      sold_count: 10,
      rating_avg: '4.5',
    }));
    return makeDb([
      { match: (s) => s.includes("FROM platform_modules WHERE key = 'discovery_feed'"),
        reply: () => ({ rows: [{ settings_json: settings }] }) },
      { match: (s) => s.includes('e.category_id AS dim'),
        reply: () => ({ rows: (affinity.categoryIds || []).map((d) => ({ dim: String(d) })) }) },
      { match: (s) => s.includes('p.brand AS dim'),
        reply: () => ({ rows: (affinity.brands || []).map((d) => ({ dim: d })) }) },
      { match: (s) => s.includes('e.supplier_id AS dim'),
        reply: () => ({ rows: (affinity.supplierIds || []).map((d) => ({ dim: String(d) })) }) },
      { match: (s) => s.includes('FROM products p'),
        reply: (_s, params) => {
          const offset = params[params.length - 1];
          const limit = params[params.length - 2];
          return { rows: catalog.slice(offset, offset + limit) };
        } },
    ]);
  }

  test('over-fetches by one so has_more/next_offset are known without a COUNT', async () => {
    const db = feedDb({ settings: { page_size: 10 }, total: 25 });
    const res = await discoveryService.getFeed(db, { userId: 7, offset: 0 });
    assert.equal(res.products.length, 10, 'page trimmed back to the page size');
    assert.equal(res.meta.count, 10);
    assert.equal(res.meta.has_more, true);
    assert.equal(res.meta.next_offset, 10);
  });

  test('the last page reports no more and a null next offset', async () => {
    const db = feedDb({ settings: { page_size: 10 }, total: 25 });
    const res = await discoveryService.getFeed(db, { userId: 7, offset: 20 });
    assert.equal(res.products.length, 5);
    assert.equal(res.meta.has_more, false);
    assert.equal(res.meta.next_offset, null);
  });

  test('an explicit limit is honored but clamped to the ceiling', async () => {
    const db = feedDb({ settings: { page_size: 10 }, total: 60 });
    const res = await discoveryService.getFeed(db, { userId: 7, limit: 999 });
    assert.equal(res.products.length, 30, 'MAX_PAGE_SIZE bounds a caller-supplied limit');
  });

  test('personalized is true only when the actor has some affinity history', async () => {
    const cold = feedDb({ total: 5, affinity: {} });
    assert.equal((await discoveryService.getFeed(cold, { userId: 7 })).meta.personalized, false);

    const warm = feedDb({ total: 5, affinity: { categoryIds: [3] } });
    assert.equal((await discoveryService.getFeed(warm, { userId: 7 })).meta.personalized, true);
  });
});

describe('Discovery feed — `recommended` ranking intent', () => {
  // Mirrors the ORDER BY that product.repository.js builds for sortBy === 'recommended':
  //   score = Σ (weight[dim] when the row matches that affinity dimension)
  //   tiebreak: sold_count DESC, rating DESC, created_at DESC
  // Weights mirror AFFINITY_WEIGHTS in discoveryFeed.service.js.
  const W = { category: 3, brand: 2, supplier: 2 };
  const score = (p, aff) =>
    (aff.categoryIds.includes(p.category_id) ? W.category : 0) +
    (aff.brands.includes(String(p.brand).toLowerCase()) ? W.brand : 0) +
    (aff.supplierIds.includes(p.supplier_id) ? W.supplier : 0);

  const rank = (products, aff) =>
    [...products].sort((a, b) => {
      const d = score(b, aff) - score(a, aff);
      if (d) return d;
      if (b.sold_count !== a.sold_count) return b.sold_count - a.sold_count;
      return (b.rating_avg ?? 0) - (a.rating_avg ?? 0);
    });

  const catalog = [
    { id: 1, category_id: 1, brand: 'Generic', supplier_id: 10, sold_count: 500, rating_avg: 4.9 }, // popular, off-affinity
    { id: 2, category_id: 3, brand: 'Aarong', supplier_id: 20, sold_count: 5, rating_avg: 4.0 }, // on-affinity, unpopular
    { id: 3, category_id: 3, brand: 'Other', supplier_id: 30, sold_count: 50, rating_avg: 4.2 }, // category match only
  ];

  test('an on-affinity product outranks a merely popular one', () => {
    const aff = { categoryIds: [3], brands: ['aarong'], supplierIds: [20] };
    const order = rank(catalog, aff).map((p) => p.id);
    assert.equal(order[0], 2, 'category+brand+supplier match (score 7) beats sold_count 500');
  });

  test('with no history the order degrades to popularity, then rating', () => {
    const aff = { categoryIds: [], brands: [], supplierIds: [] };
    const order = rank(catalog, aff).map((p) => p.id);
    assert.deepEqual(order, [1, 3, 2], 'all scores 0 → sold_count DESC');
  });

  test('the affinity dimensions compose additively', () => {
    const aff = { categoryIds: [3], brands: [], supplierIds: [] };
    assert.equal(score(catalog[1], aff), 3, 'category only');
    const aff2 = { categoryIds: [3], brands: ['aarong'], supplierIds: [20] };
    assert.equal(score(catalog[1], aff2), 7, 'category + brand + supplier');
  });

  test('brand matching is case-insensitive, mirroring lower(p.brand)', () => {
    const aff = { categoryIds: [], brands: ['aarong'], supplierIds: [] };
    assert.equal(score({ category_id: 9, brand: 'AARONG', supplier_id: 99 }, aff), 2);
  });
});

describe('Discovery feed — migration ⇄ code contract', () => {
  const migration = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/db/migrations/047_discovery_feed.sql'),
    'utf8'
  );

  test('every event type the service accepts is allowed by the table CHECK', () => {
    // The service's EVENT_WEIGHTS keys are the accepted set; each must appear in the SQL CHECK, or
    // a valid event would be rejected at write time on the live DB.
    const svc = fs.readFileSync(path.resolve(import.meta.dirname, '../src/services/discoveryFeed.service.js'), 'utf8');
    const weightBlock = svc.slice(svc.indexOf('EVENT_WEIGHTS = {'), svc.indexOf('};', svc.indexOf('EVENT_WEIGHTS = {')));
    const types = [...weightBlock.matchAll(/^\s*([A-Z_]+):/gm)].map((m) => m[1]);
    assert.ok(types.length >= 6, 'sanity: found the event weight table');
    const checkClause = migration.slice(migration.indexOf('event_type IN ('), migration.indexOf(')', migration.indexOf('event_type IN (')));
    for (const type of types) {
      assert.ok(checkClause.includes(`'${type}'`), `migration CHECK must permit event_type ${type}`);
    }
  });

  test('the audience CHECK matches the two audiences the code writes', () => {
    assert.match(migration, /audience IN \('customer', 'saler'\)/);
  });

  test('an event must carry at least one actor, matching the service guard', () => {
    assert.match(migration, /user_id IS NOT NULL OR session_id IS NOT NULL/);
  });
});
