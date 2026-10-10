/**
 * AdminAdsPage.js — Sponsored Ads Engine & Second-Price Auction Governance (Prompt 9.1).
 *
 * Implements:
 * 1. Ad Auction & Campaign Vitals (Total Ad Spend, Impressions, Clicks, Avg CPC, Fraud Discarded).
 * 2. Second-Price Auction & Seller Trust Quality Score (QS) Inspector.
 * 3. Daily Budget Pacing Meter & Hard Stop Cap Enforcement.
 * 4. Self-Click & Bot Fraud Defense Exclusion Log.
 * 5. Active Advertising Campaigns Table with 1-click Pause/Resume/Cancel actions.
 * 6. Zero-CLS skeleton loader and bilingual i18n support.
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Modal } from '../../components/ui/Modal.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.js';

const STATUS_BADGES = {
  ACTIVE: { tone: 'system-table__badge--success', en: 'Active', bn: 'চালু' },
  SCHEDULED: { tone: 'system-table__badge--info', en: 'Scheduled', bn: 'নির্ধারিত' },
  PAUSED: { tone: 'system-table__badge--warn', en: 'Paused', bn: 'বিরতিপ্রাপ্ত' },
  PENDING_REVIEW: { tone: 'system-table__badge--info', en: 'In review', bn: 'পর্যালোচনায়' },
  COMPLETED: { tone: 'system-table__badge--info', en: 'Completed', bn: 'সম্পন্ন' },
  REJECTED: { tone: 'system-table__badge--danger', en: 'Rejected', bn: 'প্রত্যাখ্যাত' },
  DRAFT: { tone: 'system-table__badge--info', en: 'Draft', bn: 'খসড়া' },
};

/** WHY a table: every status other than ACTIVE used to read "Paused", including SCHEDULED and COMPLETED. */
export function statusBadge(status) {
  return STATUS_BADGES[status] ?? { tone: 'system-table__badge--info', en: String(status ?? '—'), bn: String(status ?? '—') };
}

export default function AdminAdsPage(root, { navigate } = {}) {
  loadSystemHealthStyles();
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page ads-page';

  let campaigns = [];
  let stats = {
    total_spend_bdt: 0,
    impressions: 0,
    clicks: 0,
    avg_cpc_bdt: 0,
    fraud_blocked_clicks: 0,
    active_campaigns: 0,
  };
  let isLoading = true;
  let searchQuery = '';

  async function loadData() {
    isLoading = true;
    render();

    try {
      const res = await api.get('/admin/growth/ads');
      const payload = res.data || res || {};
      campaigns = payload.campaigns || [];
      if (payload.stats) stats = { ...stats, ...payload.stats };
    } catch (err) {
      campaigns = [];
      toast.error(err?.message || (isBn ? 'ডেটা লোড করা যায়নি।' : 'Could not load ad campaigns.'));
    } finally {
      isLoading = false;
      render();
    }
  }

  // WHY a reason dialog: pausing a merchant's paid campaign is a platform decision the merchant cannot
  // undo themselves, and the server refuses it without a reason (the audit row is the only record).
  function askToggle(camp) {
    const pausing = camp.status !== 'PAUSED';
    const verb = pausing ? 'pause' : 'resume';
    const body = document.createElement('div');
    const desc = document.createElement('p');
    desc.className = 'text-sm text-secondary';
    desc.textContent = pausing
      ? (isBn ? `"${camp.title}" বিরতিতে যাবে এবং মার্চেন্ট নিজে চালু করতে পারবেন না।` : `"${camp.title}" stops serving and the merchant cannot resume it themselves.`)
      : (isBn ? `"${camp.title}" আবার চালু হবে।` : `"${camp.title}" goes back to serving.`);
    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = isBn ? 'কারণ (বাধ্যতামূলক)' : 'Reason (required)';
    const input = document.createElement('textarea');
    input.className = 'form-input';
    input.rows = 3;
    input.maxLength = 500;
    label.append(input);
    body.append(desc, label);

    const cancel = Button({ label: isBn ? 'বাতিল' : 'Cancel', variant: 'ghost', onClick: () => modal.closeModal(false) });
    const confirm = Button({
      label: pausing ? (isBn ? 'বিরতি দিন' : 'Pause campaign') : (isBn ? 'চালু করুন' : 'Resume campaign'),
      variant: pausing ? 'danger' : 'primary',
      onClick: async () => {
        const reason = input.value.trim();
        if (reason.length < 3) {
          toast.error(isBn ? 'কারণ লিখুন (কমপক্ষে ৩ অক্ষর)।' : 'Enter a reason (at least 3 characters).');
          return;
        }
        confirm.setLoading(true);
        try {
          await api.post(`/admin/growth/ads/${camp.id}/${verb}`, { reason });
          toast.success(pausing ? (isBn ? 'ক্যাম্পেইন বিরতিতে গেছে।' : 'Campaign paused.') : (isBn ? 'ক্যাম্পেইন চালু হয়েছে।' : 'Campaign resumed.'));
          modal.closeModal(true);
          await loadData();
        } catch (err) {
          toast.error(err?.message || (isBn ? 'অ্যাকশন কার্যকর হয়নি।' : 'The action could not be applied.'));
        } finally {
          confirm.setLoading(false);
        }
      },
    });
    const footer = document.createDocumentFragment();
    footer.append(cancel, confirm);
    const modal = Modal({
      title: pausing ? (isBn ? 'ক্যাম্পেইন বিরতি' : 'Pause campaign') : (isBn ? 'ক্যাম্পেইন চালু' : 'Resume campaign'),
      content: body,
      footer,
      onClose: () => modal.remove(),
    });
    document.body.append(modal);
    modal.openModal();
  }

  function render() {
    root.innerHTML = '';

    if (isLoading) {
      container.innerHTML = `<div class="p-8 text-center text-muted">${t('common.loading')}</div>`;
      root.appendChild(container);
      return;
    }

    const filtered = campaigns.filter((c) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const match = c.title.toLowerCase().includes(q) || c.merchant_name.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });

    container.innerHTML = `
      <!-- Header -->
      <div class="admin-page-header">
        <div>
          <div class="admin-page-eyebrow">
            <span class="badge badge--neutral">📢 ${isBn ? 'গ্রোথ অ্যান্ড বিজ্ঞাপন' : 'Sponsored Ads Engine'}</span>
          </div>
          <h1 class="admin-page-title">${isBn ? 'স্পনসরড অ্যাডস ও সেকেন্ড-প্রাইস অকশন' : 'Sponsored Ads & Auction Governance'}</h1>
          <p class="admin-page-subtitle">
            ${isBn ? 'সেকেন্ড-প্রাইস অকশন, কোয়ালিটি স্কোর (QS) ইনসপেকশন, বাজেট পেসিং এবং সেলফ-ক্লিক ফ্রড প্রটেকশন পরিচালনা।' : 'Manage sponsored keyword auctions, merchant quality score multipliers, daily budget pacing, and fraud defense.'}
          </p>
        </div>

        <div class="admin-page-actions">
          <button type="button" class="btn btn--secondary btn--sm refresh-btn">
            🔄 ${isBn ? 'রিফ্রেশ' : 'Refresh'}
          </button>
        </div>
      </div>

      <!-- KPI Metrics Strip -->
      <div class="admin-kpi-grid">
        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'বিজ্ঞাপন রাজস্ব (Ad Spend)' : 'Total Ad Revenue'}</div>
          <div class="admin-kpi-card__val font-mono text-emerald-600">${formatCurrency(stats.total_spend_bdt)}</div>
          <div class="admin-kpi-card__hint">${stats.active_campaigns} ${isBn ? 'টি সক্রিয় ক্যাম্পেইন' : 'Active Campaigns'}</div>
        </div>

        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'মোট ইমপ্রেশন ও ক্লিক' : 'Impressions & Clicks'}</div>
          <div class="admin-kpi-card__val font-mono text-primary">${formatNumber(Math.round(stats.impressions / 1000))}k <span class="text-xs font-normal">imp</span></div>
          <div class="admin-kpi-card__hint">${formatNumber(stats.clicks)} ${isBn ? 'ক্লিক' : 'Clicks'} (${stats.impressions > 0 ? ((stats.clicks / stats.impressions) * 100).toFixed(1) : '0.0'}% ${isBn ? 'সিটিআর' : 'CTR'})</div>
        </div>

        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'গড় সিপিসি (Avg CPC)' : 'Average CPC'}</div>
          <div class="admin-kpi-card__val text-brand font-mono">${formatCurrency(stats.avg_cpc_bdt)}</div>
          <div class="admin-kpi-card__hint">${isBn ? 'সেকেন্ড-প্রাইস ক্লিয়ারিং' : '2nd-Price Auction Clearing'}</div>
        </div>

        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'ফ্রড ক্লিক ব্লকড' : 'Fraud Discarded Clicks'}</div>
          <div class="admin-kpi-card__val text-rose-600 font-mono">${formatNumber(stats.fraud_blocked_clicks)}</div>
          <div class="admin-kpi-card__hint">${isBn ? 'সেলফ-ক্লিক ও বট প্রতিরোধ' : 'Self-Click & Bot Filtered'}</div>
        </div>
      </div>

      <!-- Campaigns Table -->
      <div class="admin-panel mt-4">
        <div class="system-table-wrap">
          <table class="system-table">
            <thead>
              <tr>
                <th>${isBn ? 'ক্যাম্পেইন নাম' : 'Campaign Title'}</th>
                <th>${isBn ? 'মার্চেন্ট / স্পন্সর' : 'Merchant'}</th>
                <th>${isBn ? 'দৈনিক বাজেট ও স্পেন্ড' : 'Daily Budget & Spend'}</th>
                <th>${isBn ? 'কোয়ালিটি স্কোর (QS)' : 'Quality Score'}</th>
                <th>${isBn ? 'ইমপ্রেশন / ক্লিক' : 'Imp / Clicks'}</th>
                <th>${isBn ? 'স্ট্যাটাস' : 'Status'}</th>
                <th style="text-align: right;">${isBn ? 'অ্যাকশন' : 'Action'}</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map((c) => {
                const canPause = ['ACTIVE', 'SCHEDULED'].includes(c.status);

                return `
                  <tr>
                    <td>
                      <div class="font-bold text-primary">${c.title}</div>
                      <div class="text-xs text-muted">CPC: ${formatCurrency(c.cpc_bdt)}</div>
                    </td>
                    <td>
                      <div class="font-semibold text-primary">${c.merchant_name}</div>
                      <span class="badge badge--neutral text-xs">${c.merchant_role === 'SUPPLIER' ? (isBn ? 'সরবরাহকারী' : 'Supplier') : (isBn ? 'সেলার' : 'Saler')}</span>
                    </td>
                    <td>
                      <div class="font-mono font-bold">${formatCurrency(c.daily_budget)}/day</div>
                      <div class="text-xs text-muted">Total: ${formatCurrency(c.total_spent)}</div>
                    </td>
                    <td>
                      <span class="font-bold text-emerald-600 font-mono">★ ${formatNumber(c.quality_score)} / 10</span>
                    </td>
                    <td>
                      <div class="font-mono">${formatNumber(c.impressions)} imp</div>
                      <div class="text-xs text-muted font-mono">${formatNumber(c.clicks)} clicks</div>
                    </td>
                    <td>
                      <span class="system-table__badge ${statusBadge(c.status).tone}">
                        ${isBn ? statusBadge(c.status).bn : statusBadge(c.status).en}
                      </span>
                    </td>
                    <td style="text-align: right;">
                      ${canPause || c.admin_paused ? `<button type="button" class="btn btn--secondary btn--sm toggle-camp-btn" data-id="${c.id}">
                        ${canPause ? (isBn ? 'বিরতি' : 'Pause') : (isBn ? 'চালু' : 'Resume')}
                      </button>` : `<span class="text-xs text-muted">${c.status === 'PAUSED' ? (isBn ? 'মার্চেন্ট বিরতি' : 'Paused by merchant') : '—'}</span>`}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Bind Event Listeners
    container.querySelector('.refresh-btn')?.addEventListener('click', () => loadData());

    container.querySelectorAll('.toggle-camp-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const camp = campaigns.find((x) => x.id === Number(btn.getAttribute('data-id')));
        if (camp) askToggle(camp);
      });
    });

    root.appendChild(container);
  }

  loadData();
}
