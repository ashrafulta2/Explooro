/**
 * moderatorTools.js — Mock API for the Prompt 7.7 moderator/supplier tooling surfaces so they are
 * fully usable with VITE_API_MODE=mock, before the live 3-tier backend for these features exists:
 *
 *   • MyAccessPage         → /me/grants, /me/grants/pending, /me/grants/history, DELETE /me/grants/:id
 *   • PenaltiesPage        → /moderation/penalties (+ POST create, POST :id/lift)
 *   • ReportsPage          → /moderation/reports (+ POST :id/:action, POST bulk-dismiss)
 *   • ReviewsModerationPage→ /moderation/reviews (+ POST :id/decide)
 *   • UgcModerationPage    → /moderation/ugc (+ POST :id/decide, POST bulk-approve)
 *   • SupplierForecasting  → /supplier/forecasting
 *
 * Unlike the pages' inline SEED_* fallbacks, this module holds mutable in-memory state, so filters
 * narrow the list and every action (apply penalty, dismiss report, approve UGC, revoke grant)
 * actually changes what the next fetch returns — the same feel the live API will give.
 *
 * WHY separate from moderator.js: that file mocks the Prompt 7.4/7.6 unified queue. Keeping the 7.7
 * surfaces here keeps each prompt's mock contract isolated and independently testable, and avoids a
 * duplicate-route clash (moderatorPages.test.js guards against those).
 *
 * NOTE (traceability): the live server exposes none of these paths yet except /me/permissions
 * (auth.js) — see docs/prompt.md row 80. `/supplier/forecasting` in particular has no live route;
 * the live AI endpoint is the per-product GET /ai/forecast/:productId (server/src/routes/ai.routes.js).
 */

const HOUR = 3600 * 1000;
const now = () => Date.now();
const iso = (ms) => new Date(ms).toISOString();

// ─── Seed factories (called by reset so each test run starts from a known state) ────────────────

function seedGrants() {
  return [
    {
      id: 'g1',
      permission_key: 'orders.dispute.arbitrate',
      permission_label: 'Dispute Arbitration',
      issued_by: 'Super Admin',
      expires_at: iso(now() + 3 * HOUR),
      reason: 'Assigned to high-priority B2B dispute resolution shift',
    },
  ];
}

function seedPendingGrants() {
  return [
    {
      id: 'pg1',
      permission_key: 'users.kyc.approve',
      permission_label: 'KYC / Identity Verification',
      submitted_at: iso(now() - 40 * 60 * 1000),
      reason: 'Covering KYC backlog while the verification lead is on leave',
    },
  ];
}

function seedGrantHistory() {
  return [
    { event_type: 'granted', permission_key: 'orders.dispute.arbitrate', permission_label: 'Dispute Arbitration', actor: 'Super Admin', created_at: iso(now() - 3 * HOUR) },
    { event_type: 'requested', permission_key: 'users.kyc.approve', permission_label: 'KYC / Identity Verification', actor: 'You', created_at: iso(now() - 40 * 60 * 1000) },
    { event_type: 'expired', permission_key: 'moderation.live.handle', permission_label: 'Live Stream Moderation', actor: 'System', created_at: iso(now() - 26 * HOUR) },
  ];
}

function seedPenalties() {
  return [
    { id: 'p1', user_id: 4821, user_name: 'User #4821', penalty_type: 'TEMP_BAN', status: 'ACTIVE', reason: 'Repeated abusive messages after order disputes', duration_days: 7, created_at: iso(now() - 12 * HOUR), issued_by_name: 'Moderator Rahim' },
    { id: 'p2', user_id: 91, user_name: 'Quick Shop BD', penalty_type: 'WARNING', status: 'ACTIVE', reason: 'First offence: misleading listing title', duration_days: null, created_at: iso(now() - 30 * HOUR), issued_by_name: 'Moderator Rahim' },
    { id: 'p3', user_id: 512, user_name: 'GadgetZone', penalty_type: 'PERM_BAN', status: 'LIFTED', reason: 'Counterfeit goods — overturned on appeal', duration_days: null, created_at: iso(now() - 6 * 24 * HOUR), issued_by_name: 'Admin Karim' },
  ];
}

function seedReports() {
  const base = now();
  return [
    { id: 'r1', report_type: 'SPAM', status: 'OPEN', reporter_name: 'Rafi Islam', reported_name: 'Quick Shop BD', subject: 'Repeated spam listings in electronics category', description: 'The same three listings are re-posted every few hours to stay at the top of search.', created_at: iso(base - 1 * HOUR) },
    { id: 'r2', report_type: 'COUNTERFEIT', status: 'OPEN', reporter_name: 'Nusrat Jahan', reported_name: 'GadgetZone', subject: 'Selling fake Apple AirPods as genuine', description: 'Serial numbers do not validate on Apple’s checker; packaging misspells "Airpods".', created_at: iso(base - 2 * HOUR) },
    { id: 'r3', report_type: 'HARASSMENT', status: 'OPEN', reporter_name: 'Karim Hossain', reported_name: 'User #4821', subject: 'Abusive messages after order dispute', description: 'Received threatening DMs after opening a return request.', created_at: iso(base - 3 * HOUR) },
    { id: 'r4', report_type: 'FRAUD', status: 'OPEN', reporter_name: 'Sadia Begum', reported_name: 'TechMart Official', subject: 'Took payment but never shipped — 3 orders affected', description: 'Three prepaid orders, none dispatched in 14 days, seller unresponsive.', created_at: iso(base - 4 * HOUR) },
    { id: 'r5', report_type: 'INAPPROPRIATE', status: 'OPEN', reporter_name: 'Farhan Ahmed', reported_name: 'Fashion Hub BD', subject: 'Product images contain nudity', description: 'Two listing images breach the content policy.', created_at: iso(base - 5 * HOUR) },
    { id: 'r6', report_type: 'SPAM', status: 'RESOLVED', reporter_name: 'Imran Ali', reported_name: 'Deal Master', subject: 'Coupon-code spam in reviews', description: 'Resolved earlier today.', created_at: iso(base - 20 * HOUR) },
  ];
}

function seedReviews() {
  const base = now();
  return [
    { id: 'rv1', flag_reason: 'FAKE_REVIEW', status: 'PENDING', reviewer_name: 'Ahmed K.', product_name: 'Samsung Galaxy A35', rating: 5, body: 'Best phone ever! Perfect in every way, no issues at all. 100% recommend!!!', created_at: iso(base - 30 * 60 * 1000) },
    { id: 'rv2', flag_reason: 'OFFENSIVE', status: 'PENDING', reviewer_name: 'User #3291', product_name: 'Nike Air Max 270', rating: 1, body: 'This seller is a [offensive content removed]. Total scam and waste of money.', created_at: iso(base - 1 * HOUR) },
    { id: 'rv3', flag_reason: 'COMPETITOR_ATTACK', status: 'PENDING', reviewer_name: 'Shafiq R.', product_name: 'Realme C65', rating: 1, body: 'Terrible. Go buy [competitor brand] instead — much better quality and price.', created_at: iso(base - 2 * HOUR) },
    { id: 'rv4', flag_reason: 'SPAM', status: 'PENDING', reviewer_name: 'ProShopper', product_name: 'HP Laptop 15s', rating: 5, body: 'Visit my channel for discount codes! Best deals at [external link]. Subscribe now!', created_at: iso(base - 3 * HOUR) },
    { id: 'rv5', flag_reason: 'UNVERIFIED_PURCHASE', status: 'PENDING', reviewer_name: 'Rubel M.', product_name: 'Xiaomi Smart TV 43"', rating: 2, body: 'Poor build quality and display issues after 2 weeks.', created_at: iso(base - 4 * HOUR) },
  ];
}

function seedUgc() {
  const base = now();
  return [
    { id: 'u1', content_type: 'PRODUCT_REVIEW', ai_score: 'SAFE', status: 'PENDING', uploader_name: 'TechWithRafi', title: 'Samsung Galaxy A35 — Honest 30-day review', duration: '8:24', views: 342, created_at: iso(base - 30 * 60 * 1000) },
    { id: 'u2', content_type: 'UNBOXING', ai_score: 'SAFE', status: 'PENDING', uploader_name: 'ShopWithNusrat', title: 'Nike Air Max 270 unboxing & first look', duration: '5:12', views: 1204, created_at: iso(base - 1 * HOUR) },
    { id: 'u3', content_type: 'TUTORIAL', ai_score: 'FLAGGED', status: 'PENDING', uploader_name: 'GadgetGuru BD', title: 'How to unlock any phone — full tutorial', duration: '12:45', views: 891, created_at: iso(base - 2 * HOUR) },
    { id: 'u4', content_type: 'LIFESTYLE', ai_score: 'EXPLICIT', status: 'PENDING', uploader_name: 'User #7821', title: 'Summer outfits haul — clothing review', duration: '6:30', views: 215, created_at: iso(base - 3 * HOUR) },
    { id: 'u5', content_type: 'LIVE_REPLAY', ai_score: 'SAFE', status: 'PENDING', uploader_name: 'TechMart Live', title: 'Flash Sale Live Stream — 14 Sep 2026', duration: '1:12:44', views: 4521, created_at: iso(base - 4 * HOUR) },
    { id: 'u6', content_type: 'PRODUCT_REVIEW', ai_score: 'FLAGGED', status: 'PENDING', uploader_name: 'ReviewKing BD', title: 'Honest review: worst product I ever bought!', duration: '9:18', views: 673, created_at: iso(base - 5 * HOUR) },
  ];
}

// Deterministic 30/60/90-day projections; the page picks the horizon column it needs.
function seedForecasts() {
  return [
    { sku: 'SKU-001', name: 'Samsung Galaxy A35 (128GB Blue)', category: 'Smartphones', current_stock: 42, reorder_point: 20, avg_daily_sales: 3.2, forecast_30: 96, forecast_60: 192, forecast_90: 288, confidence: 92, risk: 'HIGH', trend: 'UP', revenue_at_risk: 480000 },
    { sku: 'SKU-002', name: 'Nike Air Max 270 (Size 42)', category: 'Footwear', current_stock: 8, reorder_point: 15, avg_daily_sales: 1.1, forecast_30: 33, forecast_60: 66, forecast_90: 99, confidence: 87, risk: 'CRITICAL', trend: 'STABLE', revenue_at_risk: 66000 },
    { sku: 'SKU-003', name: 'HP Laptop 15s (i5 / 8GB)', category: 'Computers', current_stock: 15, reorder_point: 10, avg_daily_sales: 0.8, forecast_30: 24, forecast_60: 48, forecast_90: 72, confidence: 78, risk: 'MEDIUM', trend: 'UP', revenue_at_risk: 192000 },
    { sku: 'SKU-004', name: 'Xiaomi Smart TV 43" (2026)', category: 'Electronics', current_stock: 31, reorder_point: 12, avg_daily_sales: 1.5, forecast_30: 45, forecast_60: 90, forecast_90: 135, confidence: 85, risk: 'LOW', trend: 'STABLE', revenue_at_risk: 0 },
    { sku: 'SKU-005', name: 'Mamaearth Face Wash (200ml)', category: 'Beauty & Skincare', current_stock: 180, reorder_point: 50, avg_daily_sales: 7.4, forecast_30: 222, forecast_60: 444, forecast_90: 666, confidence: 94, risk: 'LOW', trend: 'UP', revenue_at_risk: 0 },
    { sku: 'SKU-006', name: 'Realme C65 (4G / 128GB)', category: 'Smartphones', current_stock: 4, reorder_point: 20, avg_daily_sales: 2.3, forecast_30: 69, forecast_60: 138, forecast_90: 207, confidence: 91, risk: 'CRITICAL', trend: 'UP', revenue_at_risk: 345000 },
  ];
}

// ─── Mutable state + counters ───────────────────────────────────────────────────────────────────

let grants, pendingGrants, grantHistory, penalties, reports, reviews, ugc, forecasts;
let counters;

export function resetModeratorToolsState() {
  grants = seedGrants();
  pendingGrants = seedPendingGrants();
  grantHistory = seedGrantHistory();
  penalties = seedPenalties();
  reports = seedReports();
  reviews = seedReviews();
  ugc = seedUgc();
  forecasts = seedForecasts();
  counters = {
    reports_resolved_today: 0,
    reports_escalated: 0,
    reviews_approved_today: 0,
    reviews_rejected_today: 0,
    ugc_approved_today: 0,
    ugc_rejected_today: 0,
  };
}
resetModeratorToolsState();

const ok = (data) => ({ status: 200, body: { data } });
const clamp = (q, fallback) => {
  const n = Number(q);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const moderatorToolsHandlers = [
  // ─── My Access: elevated grants ────────────────────────────────────────────────────────────
  { method: 'GET', path: '/me/grants', handler: () => ok(grants) },
  { method: 'GET', path: '/me/grants/pending', handler: () => ok(pendingGrants) },
  {
    method: 'GET',
    path: '/me/grants/history',
    handler: ({ query }) => ok(grantHistory.slice(0, clamp(query?.limit, 20))),
  },
  {
    method: 'DELETE',
    path: '/me/grants/:id',
    handler: ({ params }) => {
      const idx = grants.findIndex((g) => String(g.id) === String(params.id));
      if (idx === -1) {
        return { status: 404, body: { error: { code: 'NOT_FOUND', message_en: 'Grant not found.', message_bn: 'গ্রান্ট পাওয়া যায়নি।' } } };
      }
      const [removed] = grants.splice(idx, 1);
      grantHistory.unshift({
        event_type: 'revoked',
        permission_key: removed.permission_key,
        permission_label: removed.permission_label,
        actor: 'You',
        created_at: iso(now()),
      });
      return ok({ revoked: true });
    },
  },

  // ─── Penalties ──────────────────────────────────────────────────────────────────────────────
  {
    method: 'GET',
    path: '/moderation/penalties',
    handler: ({ query }) => {
      let rows = [...penalties];
      if (query?.status && query.status !== 'ALL') rows = rows.filter((p) => p.status === query.status);
      rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return ok(rows.slice(0, clamp(query?.limit, 30)));
    },
  },
  {
    method: 'POST',
    path: '/moderation/penalties',
    handler: ({ body }) => {
      const b = body || {};
      if (!b.user_id) return { status: 422, body: { error: { code: 'VALIDATION_FAILED', message_en: 'A user is required.', message_bn: 'একজন ব্যবহারকারী নির্বাচন করুন।' } } };
      if (!b.reason || !String(b.reason).trim()) return { status: 422, body: { error: { code: 'VALIDATION_FAILED', message_en: 'A reason is required.', message_bn: 'কারণ আবশ্যক।' } } };
      const row = {
        id: 'p' + (penalties.length + 1) + '-' + now().toString(36),
        user_id: b.user_id,
        user_name: b.user_name || 'User #' + b.user_id,
        penalty_type: b.penalty_type || 'WARNING',
        status: 'ACTIVE',
        reason: String(b.reason).trim(),
        duration_days: b.duration_days ?? null,
        created_at: iso(now()),
        issued_by_name: 'You',
      };
      penalties.unshift(row);
      return { status: 201, body: { data: row } };
    },
  },
  {
    method: 'POST',
    path: '/moderation/penalties/:id/lift',
    handler: ({ params }) => {
      const row = penalties.find((p) => String(p.id) === String(params.id));
      if (!row) return { status: 404, body: { error: { code: 'NOT_FOUND', message_en: 'Penalty not found.', message_bn: 'পেনাল্টি পাওয়া যায়নি।' } } };
      row.status = 'LIFTED';
      row.lifted_at = iso(now());
      return ok(row);
    },
  },

  // ─── User reports ─────────────────────────────────────────────────────────────────────────
  {
    method: 'GET',
    path: '/moderation/reports',
    handler: ({ query }) => {
      let rows = [...reports];
      if (query?.status && query.status !== 'ALL') rows = rows.filter((r) => r.status === query.status);
      if (query?.report_type && query.report_type !== 'ALL') rows = rows.filter((r) => r.report_type === query.report_type);
      rows = rows.slice(0, clamp(query?.limit, 40));
      const stats = {
        open: reports.filter((r) => r.status === 'OPEN').length,
        resolved_today: counters.reports_resolved_today,
        escalated: counters.reports_escalated,
      };
      return ok({ items: rows, stats });
    },
  },
  {
    method: 'POST',
    path: '/moderation/reports/bulk-dismiss',
    handler: ({ body }) => {
      const ids = new Set((body?.ids || []).map(String));
      let n = 0;
      for (const r of reports) if (ids.has(String(r.id)) && r.status === 'OPEN') { r.status = 'DISMISSED'; n++; }
      return ok({ dismissed: n });
    },
  },
  {
    method: 'POST',
    path: '/moderation/reports/:id/:action',
    handler: ({ params }) => {
      const row = reports.find((r) => String(r.id) === String(params.id));
      if (!row) return { status: 404, body: { error: { code: 'NOT_FOUND', message_en: 'Report not found.', message_bn: 'রিপোর্ট পাওয়া যায়নি।' } } };
      const action = String(params.action).toLowerCase();
      const map = { resolve: 'RESOLVED', dismiss: 'DISMISSED', escalate: 'ESCALATED', penalise: 'RESOLVED' };
      const next = map[action];
      if (!next) return { status: 422, body: { error: { code: 'VALIDATION_FAILED', message_en: `Unknown report action "${action}".`, message_bn: `অজানা অ্যাকশন "${action}"।` } } };
      row.status = next;
      if (action === 'resolve' || action === 'penalise') counters.reports_resolved_today++;
      if (action === 'escalate') counters.reports_escalated++;
      return ok(row);
    },
  },

  // ─── Review integrity ─────────────────────────────────────────────────────────────────────
  {
    method: 'GET',
    path: '/moderation/reviews',
    handler: ({ query }) => {
      let rows = reviews.filter((r) => r.status === (query?.status || 'PENDING'));
      if (query?.flag_reason && query.flag_reason !== 'ALL') rows = rows.filter((r) => r.flag_reason === query.flag_reason);
      rows = rows.slice(0, clamp(query?.limit, 40));
      const stats = {
        pending: reviews.filter((r) => r.status === 'PENDING').length,
        approved_today: counters.reviews_approved_today,
        rejected_today: counters.reviews_rejected_today,
      };
      return ok({ items: rows, stats });
    },
  },
  {
    method: 'POST',
    path: '/moderation/reviews/:id/decide',
    handler: ({ params, body }) => {
      const row = reviews.find((r) => String(r.id) === String(params.id));
      if (!row) return { status: 404, body: { error: { code: 'NOT_FOUND', message_en: 'Review not found.', message_bn: 'রিভিউ পাওয়া যায়নি।' } } };
      const decision = String(body?.decision || '').toUpperCase();
      if (!['APPROVED', 'REJECTED', 'SHADOW_HIDDEN'].includes(decision)) {
        return { status: 422, body: { error: { code: 'VALIDATION_FAILED', message_en: `Unknown decision "${decision}".`, message_bn: `অজানা সিদ্ধান্ত "${decision}"।` } } };
      }
      row.status = decision;
      row.decision_reason = body?.reason || null;
      if (decision === 'APPROVED') counters.reviews_approved_today++;
      else counters.reviews_rejected_today++;
      return ok(row);
    },
  },

  // ─── UGC video / content ────────────────────────────────────────────────────────────────────
  {
    method: 'GET',
    path: '/moderation/ugc',
    handler: ({ query }) => {
      let rows = ugc.filter((u) => u.status === (query?.status || 'PENDING'));
      if (query?.content_type && query.content_type !== 'ALL') rows = rows.filter((u) => u.content_type === query.content_type);
      if (query?.ai_score && query.ai_score !== 'ALL') rows = rows.filter((u) => u.ai_score === query.ai_score);
      rows = rows.slice(0, clamp(query?.limit, 40));
      const pending = ugc.filter((u) => u.status === 'PENDING');
      const stats = {
        pending: pending.length,
        ai_flagged: pending.filter((u) => u.ai_score !== 'SAFE').length,
        approved_today: counters.ugc_approved_today,
        rejected_today: counters.ugc_rejected_today,
      };
      return ok({ items: rows, stats });
    },
  },
  {
    method: 'POST',
    path: '/moderation/ugc/bulk-approve',
    handler: ({ body }) => {
      const ids = new Set((body?.ids || []).map(String));
      let n = 0;
      for (const u of ugc) if (ids.has(String(u.id)) && u.status === 'PENDING') { u.status = 'APPROVED'; counters.ugc_approved_today++; n++; }
      return ok({ approved: n });
    },
  },
  {
    method: 'POST',
    path: '/moderation/ugc/:id/decide',
    handler: ({ params, body }) => {
      const row = ugc.find((u) => String(u.id) === String(params.id));
      if (!row) return { status: 404, body: { error: { code: 'NOT_FOUND', message_en: 'Content not found.', message_bn: 'কন্টেন্ট পাওয়া যায়নি।' } } };
      const decision = String(body?.decision || '').toUpperCase();
      if (!['APPROVED', 'REJECTED', 'AGE_GATED', 'REQUEST_REUPLOAD'].includes(decision)) {
        return { status: 422, body: { error: { code: 'VALIDATION_FAILED', message_en: `Unknown decision "${decision}".`, message_bn: `অজানা সিদ্ধান্ত "${decision}"।` } } };
      }
      row.status = decision;
      row.decision_reason = body?.reason || null;
      if (decision === 'APPROVED' || decision === 'AGE_GATED') counters.ugc_approved_today++;
      else counters.ugc_rejected_today++;
      return ok(row);
    },
  },

  // ─── Supplier demand forecasting ────────────────────────────────────────────────────────────
  {
    method: 'GET',
    path: '/supplier/forecasting',
    handler: ({ query }) => {
      const horizon = [30, 60, 90].includes(Number(query?.horizon)) ? Number(query.horizon) : 30;
      const items = forecasts.map((f) => ({ ...f, horizon, forecast: f['forecast_' + horizon] }));
      return ok({ items, horizon });
    },
  },
];

export default moderatorToolsHandlers;
