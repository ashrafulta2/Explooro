/**
 * demandForecast.js — Statistical Demand Forecasting (Prompt 10.3 / `idea proposition.md` §AB).
 *
 * docs/prompt.md REQUIREMENT 2: "Start with a deterministic statistical baseline (moving average
 * plus seasonality); use the model only for explanation and recommendation. Do not make a language
 * model the arithmetic engine." `computeStatisticalForecast` is pure arithmetic over real
 * `order_items` history — no model call. `explainForecast` hands the ALREADY-COMPUTED numbers to
 * Claude and asks only for a one-paragraph human explanation; it cannot change the prediction.
 */

import * as provider from './provider.js';
import * as productRepo from '../../repositories/product.repository.js';
import { AppError } from '../../plugins/errorHandler.js';

const FEATURE_KEY = 'forecast';
const HISTORY_WINDOW_DAYS = 90;
const MIN_ACTIVE_DAYS_FOR_CONFIDENCE = 5;
const Z80 = 1.28; // one-sided 80% z-score, used for a simple normal-approximation confidence band

/** Real daily sold-qty history for this product, zero-filled for days with no sales, oldest first. */
async function loadDailyHistory(db, productId, windowDays) {
  const { rows } = await db.query(
    `SELECT date_trunc('day', oi.created_at) AS day, SUM(oi.qty)::int AS qty
     FROM order_items oi
     JOIN sub_orders so ON so.id = oi.sub_order_id
     WHERE oi.product_id = $1
       AND oi.created_at >= now() - ($2 || ' days')::interval
       AND so.status NOT IN ('CANCELLED', 'REFUNDED')
     GROUP BY 1`,
    [productId, windowDays]
  );

  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r.qty]));
  const series = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, dayOfWeek: d.getUTCDay(), qty: byDay.get(key) || 0 });
  }
  return series;
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values, avg) {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Pure statistical baseline: overall mean daily demand, a day-of-week seasonality multiplier, a
 * horizon-day forecast with an 80% confidence band, and a stockout day-count. No model call.
 */
export function computeStatisticalForecast({ history, currentStock, horizonDays = 14 }) {
  const activeDays = history.filter((h) => h.qty > 0).length;
  const qtys = history.map((h) => h.qty);
  const overallMean = mean(qtys);
  const overallStd = stddev(qtys, overallMean);

  const byWeekday = Array.from({ length: 7 }, () => []);
  for (const h of history) byWeekday[h.dayOfWeek].push(h.qty);
  const seasonality = byWeekday.map((vals) => {
    if (vals.length === 0 || overallMean === 0) return 1;
    return mean(vals) / overallMean;
  });

  const dailyForecast = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 1; i <= horizonDays; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    const predicted = Math.max(0, overallMean * seasonality[d.getUTCDay()]);
    dailyForecast.push({ date: d.toISOString().slice(0, 10), predicted_qty: Math.round(predicted * 100) / 100 });
  }

  const totalPredicted = dailyForecast.reduce((sum, d) => sum + d.predicted_qty, 0);
  const bandWidth = Z80 * overallStd * Math.sqrt(horizonDays);
  const confidenceInterval = {
    low: Math.max(0, Math.round((totalPredicted - bandWidth) * 100) / 100),
    high: Math.round((totalPredicted + bandWidth) * 100) / 100,
    level: 0.8,
  };

  const avgDailyDemand = overallMean;
  const daysUntilStockout = avgDailyDemand > 0 ? Math.floor(currentStock / avgDailyDemand) : null;
  const stockoutRisk = daysUntilStockout !== null && daysUntilStockout <= horizonDays;

  return {
    history_days_used: history.length,
    active_sales_days: activeDays,
    // Sparse-history guard: don't present a confident-looking forecast off a handful of sales
    // days — a naive "count of zero-filled calendar days" would look full even for a brand-new
    // listing (loadDailyHistory zero-fills the whole calendar window), so the count of days that
    // actually had a sale is what gates confidence here, independent of `minHistoryDays`.
    insufficient_data: activeDays < MIN_ACTIVE_DAYS_FOR_CONFIDENCE,
    avg_daily_demand: Math.round(avgDailyDemand * 100) / 100,
    horizon_days: horizonDays,
    total_predicted_qty: Math.round(totalPredicted * 100) / 100,
    confidence_interval: confidenceInterval,
    daily_forecast: dailyForecast,
    current_stock: currentStock,
    days_until_stockout: daysUntilStockout,
    stockout_risk: stockoutRisk,
  };
}

function explainSystemPrompt(lang) {
  return `You are Explooro's inventory analyst. You are given an ALREADY-COMPUTED statistical
forecast (mean demand, confidence interval, stockout day-count). Write a 2-3 sentence recommendation
for the supplier based ONLY on these numbers — never invent a different number, never contradict the
given prediction. Reply in ${lang === 'bn' ? 'Bengali' : 'English'}. Plain text only.`;
}

function fallbackExplanation(forecast, lang) {
  if (forecast.insufficient_data) {
    return lang === 'bn'
      ? 'নির্ভরযোগ্য পূর্বাভাসের জন্য যথেষ্ট বিক্রয় ইতিহাস এখনো নেই।'
      : 'Not enough sales history yet for a reliable forecast.';
  }
  if (forecast.stockout_risk) {
    return lang === 'bn'
      ? `বর্তমান স্টক দিয়ে আনুমানিক ${forecast.days_until_stockout} দিনের মধ্যে স্টক শেষ হতে পারে। পুনরায় অর্ডার বিবেচনা করুন।`
      : `At the current pace, stock may run out in about ${forecast.days_until_stockout} days. Consider reordering.`;
  }
  return lang === 'bn'
    ? `পরবর্তী ${forecast.horizon_days} দিনে আনুমানিক ${forecast.total_predicted_qty} ইউনিট বিক্রি হতে পারে।`
    : `Expect roughly ${forecast.total_predicted_qty} units sold over the next ${forecast.horizon_days} days.`;
}

/**
 * Full forecast for one product: real statistical baseline + a grounded, non-arithmetic
 * explanation. `deps` is an injection seam for tests.
 */
export async function runForecast(db, { userId, productId, horizonDays = 14, lang = 'en' }, deps = {}) {
  const getProduct = deps.getProductById || productRepo.getProductById;
  const loadHistory = deps.loadDailyHistory || loadDailyHistory;
  const generate = deps.generateCompletion || provider.generateCompletion;

  const product = await getProduct(db, productId);
  if (!product) {
    throw new AppError('NOT_FOUND', 'Product not found.', 'প্রোডাক্ট পাওয়া যায়নি।');
  }

  const history = await loadHistory(db, productId, HISTORY_WINDOW_DAYS);
  const forecast = computeStatisticalForecast({
    history,
    currentStock: product.stock_qty,
    horizonDays,
  });

  const result = await generate(db, {
    userId,
    featureKey: FEATURE_KEY,
    system: explainSystemPrompt(lang),
    prompt: `Product: ${lang === 'bn' ? product.title_bn : product.title_en}\nForecast JSON: ${JSON.stringify(forecast)}`,
    maxTokens: 180,
  });

  return {
    product: { id: product.id, ref: product.ref, title: lang === 'bn' ? product.title_bn : product.title_en },
    forecast,
    explanation: (result.text || fallbackExplanation(forecast, lang)).trim(),
    degraded: result.degraded,
  };
}
