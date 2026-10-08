/**
 * pricingPreload.test.js — Phase F: pricing a page of products in three queries instead of about 3N.
 *
 * The commission hierarchy (product override -> category rule -> global default -> hard fallback) is
 * decided in exactly one place, resolveBaseSplit. loadSplitRules only changes WHERE its data comes
 * from, so the guarantee under test is equivalence: for every product, resolving from the preloaded
 * rules gives the same split as resolving it with its own queries — in every branch of the hierarchy,
 * and when a lookup fails.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSplitRules, resolveSplitPercentages } from '../src/services/pricing.service.js';
import { listCatalog } from '../src/services/product.service.js';

/**
 * A db that implements both query shapes against one rule table, the way Postgres would:
 * `scope_ref = $1 ... ORDER BY id DESC LIMIT 1` and the batch `DISTINCT ON (scope_ref) ... ANY($2)`.
 */
function rulesDb({ rules = [], globalValue, failBatch = false, failSingle = false, failGlobal = false } = {}) {
  const calls = [];
  const live = (r) => r.active !== false;
  return {
    calls,
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, params });
      if (flat.includes('FROM commission_rules')) {
        if (flat.includes('DISTINCT ON')) {
          if (failBatch) throw new Error('batch failed');
          const [type, refs] = params;
          const best = new Map();
          for (const r of rules.filter((x) => live(x) && x.scope_type === type && refs.includes(x.scope_ref))) {
            if (!best.has(r.scope_ref) || r.id > best.get(r.scope_ref).id) best.set(r.scope_ref, r);
          }
          return { rows: [...best.values()].sort((a, b) => a.scope_ref.localeCompare(b.scope_ref)) };
        }
        if (failSingle) throw new Error('single failed');
        const type = flat.includes("scope_type = 'PRODUCT'") ? 'PRODUCT' : 'CATEGORY';
        const hits = rules.filter((x) => live(x) && x.scope_type === type && x.scope_ref === params[0]).sort((a, b) => b.id - a.id);
        return { rows: hits.slice(0, 1) };
      }
      if (flat.includes("key = 'commission.default_splits'")) {
        if (failGlobal) throw new Error('settings failed');
        return { rows: globalValue === undefined ? [] : [{ value_json: globalValue }] };
      }
      return { rows: [] };
    },
  };
}

const rule = (id, scope_type, scope_ref, saler, platform, extra = {}) => ({
  id, scope_type, scope_ref: String(scope_ref), saler_split_pct: String(saler), platform_split_pct: String(platform), ...extra,
});

const products = [
  { id: 1, category_id: 10 }, // has its own product override
  { id: 2, category_id: 10 }, // category rule
  { id: 3, category_id: 11 }, // no rule: global default
  { id: 4, category_id: null }, // no category at all
  { id: 5, category_id: 10 }, // two product overrides: the newer wins
];

const fixture = () =>
  rulesDb({
    rules: [
      rule(1, 'PRODUCT', 1, 55, 45),
      rule(2, 'CATEGORY', 10, 30, 70),
      rule(3, 'PRODUCT', 5, 10, 90),
      rule(4, 'PRODUCT', 5, 12, 88), // newer than id 3
      rule(5, 'PRODUCT', 2, 99, 1, { active: false }), // expired: must be ignored by both paths
    ],
    globalValue: { saler_split_pct: 35, platform_split_pct: 65 },
  });

const single = (db, p) => resolveSplitPercentages(db, { productId: p.id, categoryId: p.category_id });
const batched = (db, p, preloaded) => resolveSplitPercentages(db, { productId: p.id, categoryId: p.category_id, preloaded });

describe('Pricing preload — equivalence with the per-product lookups', () => {
  test('every branch of the hierarchy resolves identically', async () => {
    const db = fixture();
    const preloaded = await loadSplitRules(db, products);
    for (const p of products) {
      assert.deepEqual(await batched(fixture(), p, preloaded), await single(fixture(), p), `product ${p.id}`);
    }
  });

  test('the sources are the ones the hierarchy names', async () => {
    const preloaded = await loadSplitRules(fixture(), products);
    const source = async (p) => (await batched(fixture(), p, preloaded)).ruleSource;
    assert.equal(await source(products[0]), 'PRODUCT_OVERRIDE');
    assert.equal(await source(products[1]), 'CATEGORY_RULE', 'an expired product rule is skipped');
    assert.equal(await source(products[2]), 'PLATFORM_SETTINGS');
    assert.equal(await source(products[3]), 'PLATFORM_SETTINGS');
    const newest = await batched(fixture(), products[4], preloaded);
    assert.equal(newest.salerSplitPct, 12, 'the newest product rule wins, as ORDER BY id DESC does');
  });

  test('with no global setting the hard fallback applies on both paths', async () => {
    const db = rulesDb({ rules: [] });
    const preloaded = await loadSplitRules(db, products);
    for (const p of products) {
      const a = await batched(rulesDb({ rules: [] }), p, preloaded);
      assert.deepEqual(a, await single(rulesDb({ rules: [] }), p));
      assert.equal(a.ruleSource, 'DEFAULT_FALLBACK');
    }
  });

  test('a failing batch falls through to the next level, as a failing single lookup does', async () => {
    const mk = (over) => rulesDb({ rules: [rule(1, 'PRODUCT', 1, 55, 45), rule(2, 'CATEGORY', 10, 30, 70)], globalValue: { saler_split_pct: 35, platform_split_pct: 65 }, ...over });
    const preloaded = await loadSplitRules(mk({ failBatch: true }), products);
    for (const p of products) {
      assert.deepEqual(await batched(mk({ failBatch: true }), p, preloaded), await single(mk({ failSingle: true }), p), `product ${p.id}`);
    }
    const g = await loadSplitRules(mk({ failGlobal: true }), products);
    for (const p of products) {
      assert.deepEqual(await batched(mk({ failGlobal: true }), p, g), await single(mk({ failGlobal: true }), p), `product ${p.id}`);
    }
  });

  test('a product that was not part of the load still resolves, by its own query', async () => {
    const preloaded = await loadSplitRules(fixture(), [{ id: 3, category_id: 11 }]);
    const stranger = { id: 1, category_id: 10 };
    const db = fixture();
    assert.deepEqual(await batched(db, stranger, preloaded), await single(fixture(), stranger));
    assert.ok(db.calls.some((c) => c.sql.includes("scope_type = 'PRODUCT'")), 'fell back to a live query');
  });

  test('a null db or an empty list loads nothing and changes nothing', async () => {
    const empty = await loadSplitRules(null, products);
    assert.equal(empty.productRules.size, 0);
    const none = await loadSplitRules(fixture(), []);
    assert.equal(none.productKeys.size + none.categoryKeys.size, 0);
  });
});

describe('Pricing preload — cost', () => {
  test('a page of any size is three queries to load and none to resolve', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, category_id: (i % 4) + 10 }));
    const db = fixture();
    const preloaded = await loadSplitRules(db, many);
    assert.equal(db.calls.length, 3);
    const before = db.calls.length;
    for (const p of many) await batched(db, p, preloaded);
    assert.equal(db.calls.length, before, 'resolving from the preload touches the database not at all');
  });

  test('no rule table queries for an empty category list (a page of uncategorised products)', async () => {
    const db = fixture();
    await loadSplitRules(db, [{ id: 4, category_id: null }]);
    assert.equal(db.calls.filter((c) => c.sql.includes("= $1") || c.sql.includes('DISTINCT ON')).length, 1, 'product rules only');
  });

  test('ids and categories are de-duplicated before they are sent', async () => {
    const db = fixture();
    await loadSplitRules(db, [{ id: 1, category_id: 10 }, { id: 1, category_id: 10 }, { id: 2, category_id: 10 }]);
    const batch = db.calls.filter((c) => c.sql.includes('DISTINCT ON'));
    assert.deepEqual(batch.find((c) => c.params[0] === 'CATEGORY').params[1], ['10']);
    assert.deepEqual(batch.find((c) => c.params[0] === 'PRODUCT').params[1].sort(), ['1', '2']);
  });
});

describe('Pricing preload — the catalog list uses it', () => {
  const row = (id) => ({ id, category_id: 10, base_cost: '100.00', wholesale_margin: '0.00', default_retail_price: '150.00', stock_qty: 3, status: 'ACTIVE' });

  test('listing a catalog page costs one rule load, not three queries per product', async () => {
    const calls = [];
    const inner = fixture();
    const db = {
      async query(sql, params) {
        const flat = sql.replace(/\s+/g, ' ');
        calls.push(flat);
        if (flat.includes('FROM products p')) return { rows: [1, 2, 3, 4, 5, 6, 7, 8].map(row) };
        return inner.query(sql, params);
      },
    };
    const out = await listCatalog(db, { status: 'ACTIVE' });
    assert.equal(out.length, 8);
    const ruleQueries = calls.filter((s) => s.includes('commission_rules') || s.includes('commission.default_splits'));
    assert.equal(ruleQueries.length, 3);
    assert.ok(out.every((p) => p.pricing), 'every product still has its pricing');
  });

  test('the priced result is the same as before', async () => {
    const mkDb = () => {
      const inner = fixture();
      return { async query(sql, params) { return sql.includes('FROM products p') ? { rows: [row(1), row(2), row(3)] } : inner.query(sql, params); } };
    };
    const out = await listCatalog(mkDb(), { status: 'ACTIVE' });
    const expected = [];
    for (const p of [row(1), row(2), row(3)]) {
      expected.push((await single(fixture(), p)).ruleSource);
    }
    assert.deepEqual(out.map((p) => p.pricing.rule_source ?? p.pricing.ruleSource), expected);
  });
});
