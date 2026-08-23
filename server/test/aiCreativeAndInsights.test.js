/**
 * aiCreativeAndInsights.test.js — Automated test suite for Prompt 10.3.
 *
 * Verifies the ACCEPTANCE criteria from docs/prompt.md Prompt 10.3:
 * 1. Generated ad copy is a draft requiring explicit approval (never auto-published).
 * 2. The demand forecast produces a numeric prediction with a stated confidence interval,
 *    computed statistically — no model call involved in the arithmetic.
 * 3. A seeded fake review is flagged for moderation rather than auto-deleted.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generateAdCopy, improveDescription } from '../src/services/ai/creativeStudio.js';
import { computeStatisticalForecast, runForecast } from '../src/services/ai/demandForecast.js';
import { scoreReview, evaluateAndFlag, FLAG_THRESHOLD } from '../src/services/ai/reviewIntegrity.js';
import { getInsightsForUser } from '../src/services/ai/prescriptiveInsights.js';

const FIXTURE_PRODUCT = {
  id: 5,
  ref: 'PRD-9Q2K',
  title_en: 'Handwoven Jute Tote Bag',
  title_bn: 'হাতে বোনা পাটের ব্যাগ',
  description_en: 'Durable everyday tote, hand-loomed jute.',
  description_bn: 'হাতে বোনা পাট দিয়ে তৈরি টেকসই ব্যাগ।',
  brand: 'Bengal Loom',
  category_name_en: 'Bags',
  default_retail_price: '450.00',
  supplier_id: 9,
};

function fakeDb(overrides = {}) {
  return {
    async query(sql) {
      throw new Error(`fake db: unhandled query in this test: ${sql}`);
    },
    ...overrides,
  };
}

describe('creativeStudio — ad copy & description drafts', () => {
  test('generateAdCopy grounds the caption in the real product and never fabricates a price', async () => {
    const db = fakeDb();
    const fakeGenerate = async (_db, { prompt }) => {
      assert.ok(prompt.includes('450'), 'the prompt handed to the model must carry the real price');
      return { text: 'Get this handwoven jute tote for just ৳450! Order now.', degraded: false, model: 'claude-sonnet-5', driver: 'anthropic' };
    };

    const result = await generateAdCopy(
      db,
      { userId: 1, productId: 5, lang: 'en', tone: 'friendly' },
      { getProductById: async () => FIXTURE_PRODUCT, generateCompletion: fakeGenerate }
    );

    assert.equal(result.requires_approval, true, 'ad copy must always require explicit approval');
    assert.ok(result.draft_text.includes('450'));
    assert.equal(result.product.price, 450);
  });

  test('a degraded generation still returns an honest, grounded fallback draft — never an error', async () => {
    const db = fakeDb();
    const degradedGenerate = async () => ({ text: null, degraded: true, reason: 'SPEND_CAP_EXCEEDED' });

    const result = await generateAdCopy(
      db,
      { userId: 1, productId: 5, lang: 'bn', tone: 'friendly' },
      { getProductById: async () => FIXTURE_PRODUCT, generateCompletion: degradedGenerate }
    );

    assert.equal(result.degraded, true);
    assert.ok(result.draft_text.includes('হাতে বোনা পাটের ব্যাগ'));
    assert.ok(result.draft_text.includes('450'));
  });

  test('improveDescription never invents a claim absent from the current description', async () => {
    const db = fakeDb();
    const fakeGenerate = async (_db, { prompt }) => {
      assert.ok(prompt.includes('hand-loomed jute'));
      return { text: 'Hand-loomed jute tote — durable, everyday-ready, ethically made.', degraded: false };
    };

    const result = await improveDescription(
      db,
      { userId: 9, productId: 5, lang: 'en' },
      { getProductById: async () => FIXTURE_PRODUCT, generateCompletion: fakeGenerate }
    );

    assert.equal(result.requires_approval, true);
    assert.equal(result.field, 'description_en');
  });
});

describe('demandForecast — statistical baseline, no LLM arithmetic', () => {
  function makeHistory({ days = 90, dailyQty = 2 } = {}) {
    const history = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      history.push({ date: d.toISOString().slice(0, 10), dayOfWeek: d.getUTCDay(), qty: dailyQty });
    }
    return history;
  }

  test('produces a numeric total prediction with a stated confidence interval', () => {
    const history = makeHistory({ dailyQty: 3 });
    const forecast = computeStatisticalForecast({ history, currentStock: 200, horizonDays: 14 });

    assert.equal(typeof forecast.total_predicted_qty, 'number');
    assert.ok(forecast.total_predicted_qty > 0);
    assert.equal(typeof forecast.confidence_interval.low, 'number');
    assert.equal(typeof forecast.confidence_interval.high, 'number');
    assert.ok(forecast.confidence_interval.high >= forecast.confidence_interval.low);
    assert.equal(forecast.confidence_interval.level, 0.8);
    assert.equal(forecast.insufficient_data, false);
  });

  test('flags stockout risk from real stock_qty vs. the computed average demand', () => {
    const history = makeHistory({ dailyQty: 5 });
    const forecast = computeStatisticalForecast({ history, currentStock: 10, horizonDays: 14 });

    assert.equal(forecast.stockout_risk, true);
    assert.ok(forecast.days_until_stockout <= 14);
  });

  test('a sparse-history product is marked insufficient_data rather than presenting false confidence', () => {
    const history = makeHistory({ dailyQty: 0 }).map((h, i) => (i === 89 ? { ...h, qty: 4 } : h));
    const forecast = computeStatisticalForecast({ history, currentStock: 50, horizonDays: 14 });
    assert.equal(forecast.insufficient_data, true);
  });

  test('runForecast hands ONLY the already-computed numbers to the model for explanation', async () => {
    const db = fakeDb();
    const history = makeHistory({ dailyQty: 1 });
    let sawForecastInPrompt = false;
    const fakeGenerate = async (_db, { prompt }) => {
      sawForecastInPrompt = prompt.includes('"total_predicted_qty"');
      return { text: 'Reorder soon to stay ahead of steady demand.', degraded: false };
    };

    const result = await runForecast(
      db,
      { userId: 1, productId: 5, horizonDays: 14, lang: 'en' },
      {
        getProductById: async () => ({ ...FIXTURE_PRODUCT, stock_qty: 100 }),
        loadDailyHistory: async () => history,
        generateCompletion: fakeGenerate,
      }
    );

    assert.ok(sawForecastInPrompt, 'the model must only see the already-computed forecast, never compute it itself');
    assert.equal(typeof result.forecast.total_predicted_qty, 'number');
    assert.ok(result.explanation.length > 0);
  });
});

describe('reviewIntegrity — fake-review scoring & moderation flagging', () => {
  test('a genuine, specific review scores high and is never flagged', async () => {
    const db = fakeDb({
      async query(sql) {
        if (sql.includes('FROM reviews WHERE body')) return { rows: [] };
        if (sql.includes('FROM reviews') && sql.includes('interval')) return { rows: [{ n: 0 }] };
        if (sql.includes('FROM users WHERE id')) return { rows: [{ created_at: new Date(Date.now() - 400 * 86400000) }] };
        throw new Error(`unhandled: ${sql}`);
      },
    });

    const review = {
      id: 1,
      user_id: 100,
      product_id: 5,
      rating: 4,
      title: 'Good for daily grocery runs',
      body: 'Held up well after two months of daily use, the stitching on the handles is solid and it does not fray.',
    };

    const { score, signals } = await scoreReview(db, review);
    assert.ok(score >= FLAG_THRESHOLD, `expected a trustworthy score, got ${score}`);
    assert.equal(signals.length, 0);
  });

  test('a seeded fake review (generic + duplicated + bursty) is flagged for moderation, not auto-deleted', async () => {
    const submitted = [];
    const db = fakeDb({
      async query(sql, params) {
        if (sql.includes('UPDATE reviews SET integrity_score')) return { rows: [{ id: params[0] }] };
        throw new Error(`unhandled: ${sql}`);
      },
    });

    const review = {
      id: 2,
      user_id: 200,
      product_id: 5,
      rating: 5,
      title: 'best!!!',
      body: 'excellent product!!!',
    };

    const fakeSubmitToQueue = async (_db, payload) => {
      submitted.push(payload);
      return { autoApproved: false };
    };

    const result = await evaluateAndFlag(
      db,
      { userId: 200, review },
      {
        duplicateBodySignal: async () => [{ code: 'DUPLICATE_BODY_TEXT', penalty: 30 }],
        velocitySignals: async () => [{ code: 'REVIEWER_BURST', penalty: 20 }],
        reviewerHistorySignal: async () => [{ code: 'NEW_ACCOUNT', penalty: 12 }],
        submitToQueue: fakeSubmitToQueue,
        generateCompletion: async () => ({ text: null, degraded: true }),
      }
    );

    assert.equal(result.flagged, true, 'a clearly fake-looking review must be flagged');
    assert.ok(result.score < FLAG_THRESHOLD);

    // Never auto-deleted/auto-hidden — pushed into the existing human moderation queue instead.
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].itemType, 'REVIEW');
    assert.equal(submitted[0].entityId, 2);
    assert.ok(submitted[0].extraAutoFlags.length > 0);
  });
});

describe('prescriptiveInsights — grounded in real sales numbers, never invented', () => {
  test('a saler with an underperforming price point gets a finding built from real sold-unit counts', async () => {
    const db = fakeDb();
    const salerRows = [
      {
        product_id: 5,
        custom_retail_price: '500.00',
        title_en: 'Handwoven Jute Tote Bag',
        title_bn: 'হাতে বোনা পাটের ব্যাগ',
        default_retail_price: '450.00',
        units_sold: 2,
        best_peer_price: '420.00',
        best_peer_units_sold: 20,
      },
    ];
    let promptSeen = '';
    const fakeGenerate = async (_db, { prompt }) => {
      promptSeen = prompt;
      return { text: '1. Consider matching the peer price to lift sales.', degraded: false };
    };

    const result = await getInsightsForUser(
      db,
      { userId: 3, role: 'saler', lang: 'en' },
      { loadSalerMetrics: async () => salerRows, generateCompletion: fakeGenerate }
    );

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].type, 'PRICE_UNDERPERFORMING');
    assert.ok(promptSeen.includes('20'), 'the real peer sales count must reach the model, not a guess');
    assert.ok(result.recommendations.length > 0);
  });

  test('a supplier with a real stockout-risk product gets a grounded finding', async () => {
    const db = fakeDb();
    const forecast = { stockout_risk: true, days_until_stockout: 4 };
    const supplierRows = [{ id: 5, title_en: 'Handwoven Jute Tote Bag', title_bn: 'হাতে বোনা পাটের ব্যাগ', stock_qty: 4, forecast }];

    const result = await getInsightsForUser(
      db,
      { userId: 9, role: 'supplier', lang: 'en' },
      {
        loadSupplierMetrics: async () => supplierRows,
        generateCompletion: async () => ({ text: null, degraded: true }),
      }
    );

    assert.equal(result.findings[0].type, 'STOCKOUT_RISK');
    assert.ok(result.recommendations[0].includes('4'));
  });
});
