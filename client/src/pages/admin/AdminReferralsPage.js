/**
 * AdminReferralsPage.js — Referral Programme Governance (Prompt 9.3, docs/ia-sitemap.md §admin.growth).
 *
 * `/admin/growth/referrals` is specified as "Referral rules" and gated on `growth.referral.govern`,
 * but the route used to load pages/saler/ReferralHubPage.js — the SALER's personal earnings hub. A
 * super admin clicking "Referrals" in the sidebar landed on a page offering them their own referral
 * link and network tree, with no way to see or change the programme they govern. This is the
 * governance surface that route promised:
 *
 *   1. Programme health strip (referrals, qualified, active referrers, commission paid, flagged).
 *   2. Tier rules — depth, per-tier rates, attribution window, qualification event, payout caps.
 *      Business numbers, so they are settings the admin edits, never constants in code.
 *   3. Fraud controls — the self-referral / circular-referral switches Prompt 9.3 calls mandatory.
 *   4. Flagged referrals queue with release / void decisions on held commission.
 */

import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { getLanguage } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.js';

// WHY these are read-only: the engine always applies them (referral.service.js recordReferralAttribution).
// Only the daily velocity cap is a number an admin can change, so only that is a form field.
const ALWAYS_ON_CHECKS = [
  { en: 'Self-referral (same account, phone or NID)', bn: 'নিজেকে রেফার (একই অ্যাকাউন্ট, ফোন বা এনআইডি)' },
  { en: 'Same device fingerprint', bn: 'একই ডিভাইস ফিঙ্গারপ্রিন্ট' },
  { en: 'Circular referral (A→B→A)', bn: 'চক্রাকার রেফারেল (A→B→A)' },
];

const QUALIFY_EVENTS = [
  { value: 'SIGNUP', en: 'On signup', bn: 'সাইন-আপে' },
  { value: 'FIRST_ORDER', en: 'On first order', bn: 'প্রথম অর্ডারে' },
  { value: 'FIRST_SALE', en: 'On first sale', bn: 'প্রথম বিক্রয়ে' },
  { value: 'KYC_VERIFIED', en: 'On KYC verified', bn: 'কেওয়াইসি যাচাই হলে' },
];

export default function AdminReferralsPage(root) {
  loadSystemHealthStyles();
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page admin-referrals';

  let stats = { total_referrals: 0, qualified_count: 0, fraud_flagged_count: 0, active_referrers_count: 0 };
  let commissionsPaid = 0;
  let rules = {
    tier_depth: 2,
    tier_1_rate_pct: 5,
    tier_2_rate_pct: 2,
    holding_period_days: 7,
    qualify_on: 'FIRST_ORDER',
    velocity_cap_per_day: 20,
    is_active: true,
  };
  let flagged = [];
  let loadFailed = false;
  let isLoading = true;

  async function loadData() {
    isLoading = true;
    render();
    try {
      const res = await api.get('/admin/growth/referrals');
      const payload = res.data || res || {};
      stats = { ...stats, ...(payload.stats || {}) };
      commissionsPaid = Number(payload.total_commissions_paid || 0);
      if (payload.rules) rules = { ...rules, ...payload.rules };
      flagged = payload.flagged_referrals || [];
      loadFailed = false;
    } catch (err) {
      // WHY the form is disabled on failure: the defaults above are placeholders, not what is
      // stored. Saving them would silently overwrite the real rules.
      loadFailed = true;
      toast.error(err?.message || (isBn ? 'ডেটা লোড করা যায়নি।' : 'Could not load the referral programme.'));
    } finally {
      isLoading = false;
      render();
    }
  }

  async function saveRules(form) {
    const next = {
      tier_depth: Number(form.querySelector('#ref-tier-depth').value),
      tier_1_rate_pct: Number(form.querySelector('#ref-tier1').value),
      tier_2_rate_pct: Number(form.querySelector('#ref-tier2').value),
      holding_period_days: Number(form.querySelector('#ref-holding').value),
      qualify_on: form.querySelector('#ref-qualify-on').value,
    };

    // WHY validate here: a tier-2 rate above tier 1 inverts the incentive and a combined rate above
    // the platform's own take makes every referred order lose money. Both are cheap to typo and
    // expensive to discover in the ledger a month later.
    if (next.tier_depth >= 2 && next.tier_2_rate_pct > next.tier_1_rate_pct) {
      toast.error(isBn ? 'টিয়ার-২ হার টিয়ার-১ এর চেয়ে বেশি হতে পারে না।' : 'Tier-2 rate cannot exceed the tier-1 rate.');
      return;
    }
    if (next.tier_1_rate_pct + (next.tier_depth >= 2 ? next.tier_2_rate_pct : 0) > 50) {
      toast.error(isBn ? 'মোট রেফারেল কমিশন ৫০% ছাড়াতে পারে না।' : 'Combined referral commission cannot exceed 50%.');
      return;
    }

    try {
      const res = await api.patch('/admin/growth/referrals/rules', next);
      rules = { ...rules, ...((res.data || res).rules || next) };
      toast.success(isBn ? 'রেফারেল নীতিমালা সংরক্ষিত হয়েছে।' : 'Referral rules saved.');
      render();
    } catch (err) {
      toast.error(err?.message || (isBn ? 'সংরক্ষণ ব্যর্থ হয়েছে।' : 'Could not save referral rules.'));
    }
  }

  async function saveFraudControls(form) {
    const next = { velocity_cap_per_day: Number(form.querySelector('#ref-velocity').value) };
    try {
      const res = await api.patch('/admin/growth/referrals/rules', next);
      rules = { ...rules, ...((res.data || res).rules || next) };
      toast.success(isBn ? 'জালিয়াতি নিয়ন্ত্রণ সংরক্ষিত হয়েছে।' : 'Fraud controls saved.');
      render();
    } catch (err) {
      toast.error(err?.message || (isBn ? 'সংরক্ষণ ব্যর্থ হয়েছে।' : 'Could not save fraud controls.'));
    }
  }

  function reasonLabel(reason) {
    const map = {
      SAME_DEVICE_FINGERPRINT: { en: 'Same device fingerprint', bn: 'একই ডিভাইস ফিঙ্গারপ্রিন্ট' },
      SAME_IP: { en: 'Same IP address', bn: 'একই আইপি ঠিকানা' },
      SAME_NID: { en: 'Same National ID', bn: 'একই এনআইডি' },
      CIRCULAR_REFERRAL: { en: 'Circular referral', bn: 'চক্রাকার রেফারেল' },
      VELOCITY_SPIKE: { en: 'Velocity spike', bn: 'অস্বাভাবিক গতি' },
    };
    const hit = map[reason];
    return hit ? (isBn ? hit.bn : hit.en) : reason;
  }

  function render() {
    root.innerHTML = '';
    container.innerHTML = '';

    if (isLoading) {
      container.innerHTML = `<div class="p-8 text-center text-muted">${isBn ? 'লোড হচ্ছে…' : 'Loading referral programme…'}</div>`;
      root.appendChild(container);
      return;
    }

    const heldTotal = flagged.reduce((sum, f) => sum + Number(f.amount_held_bdt || 0), 0);

    container.innerHTML = `
      <div class="admin-page-header">
        <div>
          <div class="admin-page-eyebrow">
            <span class="badge badge--neutral">🤝 ${isBn ? 'গ্রোথ গভর্নেন্স' : 'Growth Governance'}</span>
            <span class="badge ${rules.is_active ? 'badge--success' : 'badge--danger'}">
              ${rules.is_active ? (isBn ? 'প্রোগ্রাম সক্রিয়' : 'Programme live') : (isBn ? 'প্রোগ্রাম বন্ধ (মডিউল বন্ধ)' : 'Programme off (module disabled)')}
            </span>
          </div>
          <h1 class="admin-page-title">${isBn ? 'রেফারেল প্রোগ্রাম নীতিমালা' : 'Referral Programme Rules'}</h1>
          <p class="admin-page-subtitle">
            ${isBn
              ? 'টিয়ার হার, অ্যাট্রিবিউশন উইন্ডো, পেআউট সীমা ও জালিয়াতি নিয়ন্ত্রণ — এবং আটকে থাকা কমিশনের সিদ্ধান্ত।'
              : 'Tier rates, attribution window, payout caps and fraud controls — plus decisions on held commission.'}
          </p>
        </div>
        <div class="admin-page-actions">
          <button type="button" class="btn btn--secondary btn--sm refresh-btn">
            🔄 ${isBn ? 'রিফ্রেশ' : 'Refresh'}
          </button>
        </div>
      </div>

      <div class="admin-kpi-grid">
        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'মোট রেফারেল' : 'Total referrals'}</div>
          <div class="admin-kpi-card__val font-mono">${formatNumber(stats.total_referrals || 0)}</div>
          <div class="admin-kpi-card__hint">${isBn ? 'সব সময়ের হিসাব' : 'All time'}</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'যোগ্য রেফারেল' : 'Qualified'}</div>
          <div class="admin-kpi-card__val font-mono text-emerald-600">${formatNumber(stats.qualified_count || 0)}</div>
          <div class="admin-kpi-card__hint">
            ${formatNumber(stats.total_referrals ? Math.round((stats.qualified_count / stats.total_referrals) * 100) : 0)}% ${isBn ? 'রূপান্তর' : 'conversion'}
          </div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'সক্রিয় রেফারার' : 'Active referrers'}</div>
          <div class="admin-kpi-card__val font-mono">${formatNumber(stats.active_referrers_count || 0)}</div>
          <div class="admin-kpi-card__hint">${isBn ? 'গত ৩০ দিনে' : 'Last 30 days'}</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'প্রদত্ত কমিশন' : 'Commission paid'}</div>
          <div class="admin-kpi-card__val font-mono">${formatCurrency(commissionsPaid)}</div>
          <div class="admin-kpi-card__hint">${isBn ? 'রেফারেল প্রোগ্রাম মোট ব্যয়' : 'Total programme cost'}</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'জালিয়াতি চিহ্নিত' : 'Flagged for fraud'}</div>
          <div class="admin-kpi-card__val font-mono text-danger">${flagged.length}</div>
          <div class="admin-kpi-card__hint">${formatCurrency(heldTotal)} ${isBn ? 'আটকে আছে' : 'held'}</div>
        </div>
      </div>

      <!-- Tier rules -->
      <div class="admin-panel mt-4">
        <div class="system-panel__header">
          <div>
            <h3 class="system-panel__title"><span>⚙️ ${isBn ? 'টিয়ার ও অ্যাট্রিবিউশন নীতিমালা' : 'Tier & Attribution Rules'}</span></h3>
            <p class="system-panel__sub">
              ${isBn
                ? 'এগুলো কনফিগারেশন — কোডে হার্ডকোড নয়। পরিবর্তন অডিট লগে রেকর্ড হয়।'
                : 'Configuration, not hardcoded constants. Every change is written to the audit log.'}
            </p>
          </div>
        </div>

        <form id="ref-rules-form" style="padding: var(--space-5); display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr));">
          <div>
            <label class="form-label" for="ref-tier-depth">${isBn ? 'টিয়ার গভীরতা' : 'Tier depth'}</label>
            <select class="form-select" id="ref-tier-depth">
              <option value="1" ${rules.tier_depth === 1 ? 'selected' : ''}>1 ${isBn ? 'স্তর' : 'tier'}</option>
              <option value="2" ${rules.tier_depth === 2 ? 'selected' : ''}>2 ${isBn ? 'স্তর' : 'tiers'}</option>
            </select>
          </div>
          <div>
            <label class="form-label" for="ref-tier1">${isBn ? 'টিয়ার-১ হার (%)' : 'Tier-1 rate (%)'}</label>
            <input class="form-input" id="ref-tier1" type="number" min="0" max="50" step="0.5" value="${rules.tier_1_rate_pct}" />
          </div>
          <div>
            <label class="form-label" for="ref-tier2">${isBn ? 'টিয়ার-২ হার (%)' : 'Tier-2 rate (%)'}</label>
            <input class="form-input" id="ref-tier2" type="number" min="0" max="50" step="0.5" value="${rules.tier_2_rate_pct}" />
          </div>
          <div>
            <label class="form-label" for="ref-holding">${isBn ? 'হোল্ডিং পিরিয়ড (দিন)' : 'Holding period (days)'}</label>
            <input class="form-input" id="ref-holding" type="number" min="0" max="90" step="1" value="${rules.holding_period_days}" />
          </div>
          <div>
            <label class="form-label" for="ref-qualify-on">${isBn ? 'কখন যোগ্য হবে' : 'Qualifies on'}</label>
            <select class="form-select" id="ref-qualify-on">
              ${QUALIFY_EVENTS.map((e) => `
                <option value="${e.value}" ${rules.qualify_on === e.value ? 'selected' : ''}>${isBn ? e.bn : e.en}</option>
              `).join('')}
            </select>
          </div>
          <div style="display: flex; align-items: flex-end;">
            <button type="submit" class="btn btn--primary btn--sm" ${loadFailed ? 'disabled' : ''}>${isBn ? 'নীতিমালা সংরক্ষণ করুন' : 'Save rules'}</button>
          </div>
        </form>
      </div>

      <!-- Fraud controls -->
      <div class="admin-panel mt-4">
        <div class="system-panel__header">
          <div>
            <h3 class="system-panel__title"><span>🛡️ ${isBn ? 'জালিয়াতি নিয়ন্ত্রণ' : 'Fraud Controls'}</span></h3>
            <p class="system-panel__sub">
              ${isBn
                ? 'এই যাচাইগুলো সবসময় চালু — বন্ধ করা যায় না। শুধু দৈনিক সীমা পরিবর্তনযোগ্য।'
                : 'These checks always run and cannot be switched off. Only the daily cap is adjustable.'}
            </p>
          </div>
        </div>

        <form id="ref-fraud-form" style="padding: var(--space-5); display: grid; gap: var(--space-3);">
          <ul style="margin: 0; padding-left: var(--space-5);">
            ${ALWAYS_ON_CHECKS.map((c) => `<li>✅ ${isBn ? c.bn : c.en}</li>`).join('')}
          </ul>
          <div style="max-width: 280px;">
            <label class="form-label" for="ref-velocity">${isBn ? 'দৈনিক রেফারেল সীমা (প্রতি রেফারার)' : 'Daily referral cap (per referrer)'}</label>
            <input class="form-input" id="ref-velocity" type="number" min="1" max="500" step="1" value="${rules.velocity_cap_per_day}" />
          </div>
          <div>
            <button type="submit" class="btn btn--primary btn--sm" ${loadFailed ? 'disabled' : ''}>${isBn ? 'সীমা সংরক্ষণ করুন' : 'Save daily cap'}</button>
          </div>
        </form>
      </div>

      <!-- Flagged queue -->
      <div class="admin-panel mt-4">
        <div class="system-panel__header">
          <div>
            <h3 class="system-panel__title"><span>🚩 ${isBn ? 'চিহ্নিত রেফারেল কিউ' : 'Flagged Referral Queue'}</span></h3>
            <p class="system-panel__sub">
              ${isBn
                ? 'শুধু দেখা যায়। রিলিজ/বাতিলের সিদ্ধান্ত এখনও এই পেজ থেকে নেওয়া যায় না।'
                : 'Read-only. Release / void decisions cannot be taken from this page yet.'}
            </p>
          </div>
        </div>

        <div class="system-table-wrap">
          <table class="system-table">
            <thead>
              <tr>
                <th>${isBn ? 'রেফারেন্স' : 'Reference'}</th>
                <th>${isBn ? 'রেফারার' : 'Referrer'}</th>
                <th>${isBn ? 'রেফারি' : 'Referee'}</th>
                <th>${isBn ? 'কারণ' : 'Reason'}</th>
                <th>${isBn ? 'আটকে থাকা কমিশন' : 'Held commission'}</th>
              </tr>
            </thead>
            <tbody>
              ${flagged.length === 0
                ? `<tr><td colspan="5" class="text-center text-muted">${isBn ? '🎉 কোনো চিহ্নিত রেফারেল নেই।' : '🎉 Nothing flagged — the queue is clear.'}</td></tr>`
                : flagged.map((f) => `
                <tr>
                  <td><strong class="font-mono">${f.id}</strong></td>
                  <td>${f.referrer_name}</td>
                  <td>${f.referee_name}</td>
                  <td><span class="system-table__badge system-table__badge--warning">${reasonLabel(f.reason)}</span></td>
                  <td><strong class="font-mono">${formatCurrency(f.amount_held_bdt)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelector('.refresh-btn')?.addEventListener('click', () => loadData());
    container.querySelector('#ref-rules-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      saveRules(e.currentTarget);
    });
    container.querySelector('#ref-fraud-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      saveFraudControls(e.currentTarget);
    });
    root.appendChild(container);
  }

  loadData();

  return () => {
    container.remove();
  };
}
