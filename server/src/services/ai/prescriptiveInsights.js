/**
 * prescriptiveInsights.js — Per-Role Next-Action Recommendations (Prompt 10.3 / `idea proposition.md` §I).
 *
 * "Actionable next-step recommendations per role, grounded in that user's real metrics." This
 * platform doesn't track page views (no analytics_events/product_views table exists yet), so
 * conversion-rate comparisons aren't groundable — instead, every number here comes from real
 * `order_items`/`saler_store_items` sales history. Claude only turns the already-computed numbers
 * into a short recommendation sentence; it never invents a metric.
 */

import * as provider from './provider.js';
import * as demandForecast from './demandForecast.js';

const FEATURE_KEY = 'insights';
const SALES_WINDOW_DAYS = 30;

/** Real per-product sold-unit counts for this saler's store, plus the platform-wide best price
 * point for the same product across all salers who carry it — a genuine, groundable comparison. */
async function loadSalerMetrics(db, userId) {
  const { rows } = await db.query(
    `SELECT ssi.product_id, ssi.custom_retail_price, p.title_en, p.title_bn, p.default_retail_price,
            COALESCE(sold.qty, 0)::int AS units_sold,
            best.min_price AS best_peer_price, best.max_qty AS best_peer_units_sold
     FROM saler_store_items ssi
     JOIN products p ON p.id = ssi.product_id
     LEFT JOIN LATERAL (
       SELECT SUM(oi.qty)::int AS qty
       FROM order_items oi
       JOIN sub_orders so ON so.id = oi.sub_order_id
       WHERE so.saler_id = ssi.saler_id AND oi.product_id = ssi.product_id
         AND oi.created_at >= now() - ($2 || ' days')::interval
         AND so.status NOT IN ('CANCELLED', 'REFUNDED')
     ) sold ON true
     LEFT JOIN LATERAL (
       SELECT MIN(other.custom_retail_price) AS min_price, MAX(peer_sold.qty) AS max_qty
       FROM saler_store_items other
       LEFT JOIN LATERAL (
         SELECT SUM(oi.qty)::int AS qty
         FROM order_items oi
         JOIN sub_orders so ON so.id = oi.sub_order_id
         WHERE so.saler_id = other.saler_id AND oi.product_id = other.product_id
           AND oi.created_at >= now() - ($2 || ' days')::interval
           AND so.status NOT IN ('CANCELLED', 'REFUNDED')
       ) peer_sold ON true
       WHERE other.product_id = ssi.product_id AND other.saler_id <> ssi.saler_id
     ) best ON true
     WHERE ssi.saler_id = $1 AND ssi.is_active = true`,
    [userId, SALES_WINDOW_DAYS]
  );
  return rows;
}

/** Which of the supplier's own products are at real stockout risk, using the same statistical
 * baseline demandForecast.js uses elsewhere — never a separately-invented number. */
async function loadSupplierMetrics(db, userId, deps = {}) {
  const { rows: products } = await db.query(
    `SELECT id, title_en, title_bn, stock_qty FROM products
     WHERE supplier_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
     ORDER BY id LIMIT 20`,
    [userId]
  );

  const forecastFn = deps.runForecastQuiet || runForecastQuiet;
  const withForecast = await Promise.all(
    products.map(async (p) => ({ ...p, forecast: await forecastFn(db, p.id) }))
  );
  return withForecast;
}

/** Statistical-only forecast (no model call, no usage recorded) — insights only needs the numbers. */
async function runForecastQuiet(db, productId) {
  const { rows } = await db.query(
    `SELECT date_trunc('day', oi.created_at) AS day, SUM(oi.qty)::int AS qty
     FROM order_items oi
     JOIN sub_orders so ON so.id = oi.sub_order_id
     WHERE oi.product_id = $1
       AND oi.created_at >= now() - interval '90 days'
       AND so.status NOT IN ('CANCELLED', 'REFUNDED')
     GROUP BY 1`,
    [productId]
  );
  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r.qty]));
  const history = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    history.push({ date: key, dayOfWeek: d.getUTCDay(), qty: byDay.get(key) || 0 });
  }
  const { rows: stockRows } = await db.query(`SELECT stock_qty FROM products WHERE id = $1`, [productId]);
  return demandForecast.computeStatisticalForecast({
    history,
    currentStock: stockRows[0]?.stock_qty ?? 0,
    horizonDays: 14,
  });
}

function buildSalerFindings(rows, lang) {
  const findings = [];
  for (const r of rows) {
    const title = lang === 'bn' ? r.title_bn : r.title_en;
    const myPrice = parseFloat(r.custom_retail_price ?? r.default_retail_price);
    if (r.best_peer_price != null && r.best_peer_units_sold != null) {
      const peerPrice = parseFloat(r.best_peer_price);
      if (r.best_peer_units_sold > r.units_sold && peerPrice < myPrice) {
        findings.push({
          type: 'PRICE_UNDERPERFORMING',
          product_id: r.product_id,
          title,
          message:
            lang === 'bn'
              ? `আপনার "${title}" ৳${myPrice} এ ${r.units_sold}টি বিক্রি হয়েছে; অন্য সেলার ৳${peerPrice} এ ${r.best_peer_units_sold}টি বিক্রি করেছেন।`
              : `Your "${title}" sold ${r.units_sold} at ৳${myPrice}; a peer seller sold ${r.best_peer_units_sold} at ৳${peerPrice}.`,
        });
      }
    }
    if (r.units_sold === 0) {
      findings.push({
        type: 'NO_SALES',
        product_id: r.product_id,
        title,
        message:
          lang === 'bn'
            ? `"${title}" গত ${SALES_WINDOW_DAYS} দিনে বিক্রি হয়নি।`
            : `"${title}" had no sales in the last ${SALES_WINDOW_DAYS} days.`,
      });
    }
  }
  return findings.slice(0, 5);
}

function buildSupplierFindings(rows, lang) {
  const findings = [];
  for (const p of rows) {
    const title = lang === 'bn' ? p.title_bn : p.title_en;
    if (p.forecast.stockout_risk) {
      findings.push({
        type: 'STOCKOUT_RISK',
        product_id: p.id,
        title,
        message:
          lang === 'bn'
            ? `"${title}" আনুমানিক ${p.forecast.days_until_stockout} দিনে স্টক আউট হতে পারে।`
            : `"${title}" may stock out in about ${p.forecast.days_until_stockout} days.`,
      });
    }
  }
  return findings.slice(0, 5);
}

function insightsSystemPrompt(lang) {
  return `You are Explooro's growth advisor. Given a list of ALREADY-COMPUTED findings (each with a
message grounded in real numbers), write ONE short, encouraging next-step recommendation per finding.
Never add a number that isn't in the given findings. Reply in ${lang === 'bn' ? 'Bengali' : 'English'}
as a numbered list, one line per finding, same order as given.`;
}

function fallbackRecommendations(findings) {
  return findings.map((f) => f.message);
}

/** Real, grounded next-step recommendations for the given user's role. `deps` is a test seam. */
export async function getInsightsForUser(db, { userId, role, lang = 'en' }, deps = {}) {
  const generate = deps.generateCompletion || provider.generateCompletion;

  let findings = [];
  if (role === 'saler') {
    const salerFn = deps.loadSalerMetrics || loadSalerMetrics;
    findings = buildSalerFindings(await salerFn(db, userId), lang);
  } else if (role === 'supplier') {
    const supplierFn = deps.loadSupplierMetrics || loadSupplierMetrics;
    findings = buildSupplierFindings(await supplierFn(db, userId, deps), lang);
  }

  if (findings.length === 0) {
    return { findings: [], recommendations: [], degraded: false };
  }

  const result = await generate(db, {
    userId,
    featureKey: FEATURE_KEY,
    system: insightsSystemPrompt(lang),
    prompt: findings.map((f, i) => `${i + 1}. ${f.message}`).join('\n'),
    maxTokens: 300,
  });

  const recommendationText = result.text && !result.degraded ? result.text : null;
  const recommendations = recommendationText
    ? recommendationText
        .split('\n')
        .map((l) => l.replace(/^\d+[.)]\s*/, '').trim())
        .filter(Boolean)
    : fallbackRecommendations(findings);

  return { findings, recommendations, degraded: result.degraded };
}

export { runForecastQuiet, loadSalerMetrics, loadSupplierMetrics };
