/**
 * payoutProtection.js — Mock handlers for Fast Payout and Return Protection (supplier attraction, step 5).
 *
 * Same shapes as the real endpoints (services/fastPayout.service.js, services/returnProtection.service.js).
 * An entry can only be taken once and a refused entry stays refused, as on the server. It does NOT move
 * money - the mock has no ledger - so no balance changes here.
 */

const RULES = { fee_pct_by_grade: { A: 1, B: 1.5, C: 2.5 }, ungraded_fee_pct: 2, min_amount: 100, max_per_request: 50000, max_outstanding: 100000, min_days_saved: 2, blocked_grades: ['D'] };
const PROTECTION_RULES = { enabled: true, premium_pct: 10, max_claim_amount: 5000, max_claims_per_saler_30d: 5, blocked_grades: ['D'], premium_batch: 200 };

const iso = (days = 0) => new Date(Date.now() + days * 86400000).toISOString();
const money = (n) => Number(n).toFixed(2);
const bad = (code, message_en) => ({ status: code === 'NOT_FOUND' ? 404 : code === 'VALIDATION_FAILED' ? 400 : 409, body: { error: { code, message_en, message_bn: message_en } } });

function quote(entry, pct) {
  const fee = Math.round(entry.amount * pct) / 100;
  return { fee_pct: pct, fee: money(fee), net: money(entry.amount - fee) };
}

function makeSide(role, seed) {
  return {
    role,
    entries: seed.map((e, i) => ({
      entry_id: 100 + i + (role === 'SALER' ? 50 : 0),
      sub_order_id: 900 + i + (role === 'SALER' ? 50 : 0),
      sub_order_ref: `SUB-${900 + i + (role === 'SALER' ? 50 : 0)}`,
      role,
      hold_until: iso(e.days),
      taken: false,
      ...e,
    })),
    history: [],
  };
}

const sides = {
  supplier: makeSide('SUPPLIER', [
    { amount: 1000, days: 5, reason: null },
    { amount: 2400, days: 6, reason: null },
    { amount: 800, days: 4, reason: 'NOT_DELIVERED' },
    { amount: 1500, days: 3, reason: 'OPEN_CLAIM' },
    { amount: 90, days: 6, reason: 'TOO_SMALL' },
  ]),
  saler: makeSide('SALER', [
    { amount: 250, days: 5, reason: null },
    { amount: 180, days: 1, reason: 'TOO_SOON' },
  ]),
};

function viewOf(side) {
  const open = side.entries.filter((e) => !e.taken);
  const outstanding = side.history.reduce((sum, h) => sum + Number(h.gross_amount), 0);
  return {
    rules: RULES,
    outstanding: money(outstanding),
    headroom: money(Math.max(0, RULES.max_outstanding - outstanding)),
    entries: open.map((e) => {
      const eligible = !e.reason;
      return {
        entry_id: e.entry_id, amount: money(e.amount), grade: null, eligible, reason: e.reason,
        ...(eligible ? { ...quote(e, RULES.ungraded_fee_pct), days_saved: e.days } : { fee_pct: null, fee: null, net: null, days_saved: 0 }),
        sub_order_id: e.sub_order_id, sub_order_ref: e.sub_order_ref, role: e.role, hold_until: e.hold_until,
      };
    }),
    history: side.history,
  };
}

function take(side, body) {
  const e = side.entries.find((x) => String(x.entry_id) === String(body?.escrow_entry_id));
  if (!e) return bad('NOT_FOUND', 'That amount was not found.');
  if (e.taken) return bad('FAST_PAYOUT_NOT_ELIGIBLE', 'This amount is no longer held in escrow.');
  if (e.reason) return bad('FAST_PAYOUT_NOT_ELIGIBLE', 'This amount cannot be taken early.');
  const q = quote(e, RULES.ungraded_fee_pct);
  e.taken = true;
  const record = {
    id: side.history.length + 1, sub_order_id: e.sub_order_id, sub_order_ref: e.sub_order_ref, beneficiary_role: e.role,
    gross_amount: money(e.amount), fee_pct: q.fee_pct, fee_amount: q.fee, net_amount: q.net, grade: null, days_saved: e.days,
    created_at: new Date().toISOString(),
  };
  side.history.unshift(record);
  return { status: 200, body: { data: record } };
}

// ---- return protection ------------------------------------------------------------------------------------

const protection = {
  enrolled: false,
  covers: [
    { id: 1, sub_order_ref: 'SUB-410', insured_amount: '120.00', premium_pct: '10.00', premium_amount: '12.00', premium_charged_at: iso(-6), status: 'ACTIVE', claim_amount: null, claimed_at: null, denied_reason: null, created_at: iso(-9) },
    { id: 2, sub_order_ref: 'SUB-405', insured_amount: '300.00', premium_pct: '10.00', premium_amount: '30.00', premium_charged_at: null, status: 'CLAIMED', claim_amount: '300.00', claimed_at: iso(-3), denied_reason: null, created_at: iso(-12) },
    { id: 3, sub_order_ref: 'SUB-401', insured_amount: '90.00', premium_pct: '10.00', premium_amount: '9.00', premium_charged_at: null, status: 'DENIED', claim_amount: null, claimed_at: null, denied_reason: 'CLAIM_LIMIT', created_at: iso(-20) },
  ],
};

function supplierProtectionView() {
  const claimed = protection.covers.filter((c) => c.status === 'CLAIMED');
  return {
    rules: PROTECTION_RULES, grade: 'B', blocked: false, enrolled: protection.enrolled,
    enrolled_since: protection.enrolled ? iso(-1) : null,
    stats: {
      covers: protection.covers.length, claims: claimed.length,
      claimed_total: money(claimed.reduce((s, c) => s + Number(c.claim_amount), 0)),
      premiums_paid: money(protection.covers.filter((c) => c.premium_charged_at).reduce((s, c) => s + Number(c.premium_amount), 0)),
    },
    covers: protection.covers,
  };
}

const fastPayoutHandlers = [
  { method: 'GET', path: '/supplier/fast-payout', handler: () => ({ status: 200, body: { data: viewOf(sides.supplier) } }) },
  { method: 'POST', path: '/supplier/fast-payout', handler: ({ body }) => take(sides.supplier, body) },
  { method: 'GET', path: '/sourcing/fast-payout', handler: () => ({ status: 200, body: { data: viewOf(sides.saler) } }) },
  { method: 'POST', path: '/sourcing/fast-payout', handler: ({ body }) => take(sides.saler, body) },

  { method: 'GET', path: '/supplier/return-protection', handler: () => ({ status: 200, body: { data: supplierProtectionView() } }) },
  {
    method: 'PUT',
    path: '/supplier/return-protection',
    handler: ({ body }) => {
      if (typeof body?.enrolled !== 'boolean') return bad('VALIDATION_FAILED', 'Say whether to enrol or withdraw.');
      protection.enrolled = body.enrolled;
      return { status: 200, body: { data: supplierProtectionView() } };
    },
  },
  {
    method: 'GET',
    path: '/sourcing/return-protection',
    handler: () => ({
      status: 200,
      body: {
        data: {
          rules: { max_claim_amount: PROTECTION_RULES.max_claim_amount, max_claims_per_saler_30d: PROTECTION_RULES.max_claims_per_saler_30d },
          suppliers: [{ supplier_id: 7, supplier_name: 'Rahman Traders', started_at: iso(-30) }, { supplier_id: 8, supplier_name: 'Dhaka Home Goods', started_at: iso(-10) }],
          covers: protection.covers.map(({ premium_pct, premium_amount, premium_charged_at, ...c }) => c),
        },
      },
    }),
  },
];

export default fastPayoutHandlers;
