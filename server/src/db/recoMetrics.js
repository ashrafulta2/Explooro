/**
 * recoMetrics.js — prints the per-surface funnel of the personalized feed (Phase F).
 *
 *   npm run reco:metrics                       last 7 days, 7-day attribution
 *   npm run reco:metrics -- --days 30 --attribution 14
 *   npm run reco:metrics -- --audience saler
 *
 * Read-only. The admin screen for the same numbers is Phase G; until then this is how an owner (or the
 * next developer) answers "is the Trending rail earning its place?".
 */

import '../config/loadEnvFile.js';
import { loadEnv } from '../config/env.js';
import { createDbPool } from '../config/db.js';
import { getFunnel } from '../services/recoFunnel.service.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const pct = (v) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);

const pool = createDbPool(loadEnv());
try {
  const { window, surfaces } = await getFunnel(pool, {
    audience: arg('audience'),
    days: arg('days'),
    attributionDays: arg('attribution'),
  });
  console.log(`Feed funnel - last ${window.days} days, conversions attributed within ${window.attribution_days} days of the click\n`);
  if (!surfaces.length) {
    console.log('No tagged events in this window. Surfaces report their source from the client (rails, feed, grid, search);');
    console.log('events recorded before migration 060 or by an older client carry no tag.');
  } else {
    console.table(
      surfaces.map((s) => ({
        surface: s.source,
        shoppers: s.actors,
        impressions: s.impressions,
        clicks: s.clicks,
        ctr: pct(s.ctr),
        carts: s.add_carts,
        'cart/click': pct(s.cart_rate),
        bought: s.purchases,
        'buy/click': pct(s.purchase_rate),
      }))
    );
  }
} finally {
  await pool.end();
}
