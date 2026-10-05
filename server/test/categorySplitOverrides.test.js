/**
 * categorySplitOverrides.test.js — Finance category split overrides must land in
 * commission_rules (scope CATEGORY), the table pricing.service.js resolves against.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getProfitSplits,
  updateCategorySplit,
  deleteCategorySplit,
} from '../src/controllers/finance.controller.js';
import { resolveSplitPercentages } from '../src/services/pricing.service.js';

// Minimal in-memory commission_rules that understands only the statements these paths issue.
function createDb() {
  const rules = [];
  const isLive = (r) => !r.effective_to;
  const db = {
    rules,
    async query(sql, params = []) {
      if (/WITH closed AS/.test(sql)) {
        const [ref, saler, platform] = params;
        for (const r of rules) if (r.scope_ref === ref && isLive(r)) r.effective_to = new Date();
        rules.push({ scope_type: 'CATEGORY', scope_ref: ref, saler_split_pct: saler, platform_split_pct: platform, effective_to: null });
        return { rows: [] };
      }
      if (/UPDATE commission_rules SET effective_to/.test(sql)) {
        for (const r of rules) if (r.scope_ref === params[0] && isLive(r)) r.effective_to = new Date();
        return { rows: [] };
      }
      if (/FROM categories c/.test(sql)) {
        const live = (id) => rules.filter((r) => r.scope_ref === String(id) && isLive(r)).slice(-1)[0];
        return {
          rows: [1, 2].map((id) => ({
            id, name_en: `Cat ${id}`, name_bn: `ক্যাট ${id}`, slug: `cat-${id}`,
            saler_split_pct: live(id)?.saler_split_pct ?? null,
            platform_split_pct: live(id)?.platform_split_pct ?? null,
            override_at: null,
          })),
        };
      }
      if (/FROM commission_rules\s+WHERE scope_type = 'CATEGORY'/.test(sql)) {
        const live = rules.filter((r) => r.scope_ref === params[0] && isLive(r)).slice(-1);
        return { rows: live };
      }
      return { rows: [] }; // settings, audit_logs, anything else
    },
  };
  return db;
}

function call(fn, db, { params = {}, body = {} } = {}) {
  const out = { status: 200, payload: null };
  const reply = {
    status(c) { out.status = c; return reply; },
    send(p) { out.payload = p; return reply; },
  };
  return fn({ server: { db }, params, body, user: { id: 1 }, ip: '127.0.0.1' }, reply).then(() => out);
}

describe('Finance category split overrides', () => {
  test('a saved override is what pricing resolves, and shows in the Finance list', async () => {
    const db = createDb();
    await call(updateCategorySplit, db, { params: { id: '2' }, body: { saler_split_pct: 30, platform_split_pct: 70 } });

    const resolved = await resolveSplitPercentages(db, { categoryId: 2 });
    assert.equal(resolved.salerSplitPct, 30);
    assert.equal(resolved.ruleSource, 'CATEGORY_RULE');

    const { payload } = await call(getProfitSplits, db);
    const cat = payload.data.categories.find((c) => c.id === 2);
    assert.equal(cat.is_override, true);
    assert.equal(cat.saler_split_pct, 30);
    assert.equal(payload.data.categories.find((c) => c.id === 1).is_override, false);
  });

  test('re-saving replaces the override: exactly one live rule per category', async () => {
    const db = createDb();
    await call(updateCategorySplit, db, { params: { id: '2' }, body: { saler_split_pct: 30, platform_split_pct: 70 } });
    await call(updateCategorySplit, db, { params: { id: '2' }, body: { saler_split_pct: 50, platform_split_pct: 50 } });

    assert.equal(db.rules.filter((r) => !r.effective_to).length, 1);
    assert.equal((await resolveSplitPercentages(db, { categoryId: 2 })).salerSplitPct, 50);
  });

  test('deleting an override falls back to the platform default', async () => {
    const db = createDb();
    await call(updateCategorySplit, db, { params: { id: '2' }, body: { saler_split_pct: 30, platform_split_pct: 70 } });
    await call(deleteCategorySplit, db, { params: { id: '2' } });

    const resolved = await resolveSplitPercentages(db, { categoryId: 2 });
    assert.notEqual(resolved.ruleSource, 'CATEGORY_RULE');
    const { payload } = await call(getProfitSplits, db);
    assert.equal(payload.data.categories.find((c) => c.id === 2).is_override, false);
  });

  test('a split that does not sum to 100 is rejected before touching the database', async () => {
    const db = createDb();
    const res = await call(updateCategorySplit, db, { params: { id: '2' }, body: { saler_split_pct: 30, platform_split_pct: 60 } });
    assert.equal(res.status, 400);
    assert.equal(res.payload.error.code, 'SPLIT_SUM_INVALID');
    assert.equal(db.rules.length, 0);
  });
});
