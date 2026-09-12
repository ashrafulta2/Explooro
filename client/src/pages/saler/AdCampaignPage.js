/**
 * AdCampaignPage.js — Saler Ad Store & Campaign Manager.
 *
 * Two tabs, one job: let a seller buy advertising without understanding advertising.
 *
 *   Ad Store      — every format the platform sells, as a card with its real price on it.
 *                   Prices come from the admin's rate cards (/admin/growth/ad-pricing), so what a
 *                   seller sees here is whatever the Super Admin — or whoever they delegated
 *                   `growth.ad.govern` to — decided this format is worth today.
 *   My Campaigns  — what is running, what it cost, and one-click pause / resume / cancel.
 *
 * The buying flow is a three-step wizard, and every step asks one question:
 *   1. What are you promoting?
 *   2. How big and how long?
 *   3. Here is the exact price — confirm.
 *
 * WHY the price always comes from the server: the wizard never multiplies a rate itself. Every
 * keystroke re-quotes through POST /ads/quote, so the number on the confirm button is the same
 * number the purchase will charge, computed by one engine (server/src/services/adPricing.js).
 */

import { api } from '../../core/api.js';
import { getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { loadAdStoreStyles } from '../../styles/loadAdStoreStyles.js';

/** Budget presets, so most sellers never type a number at all. */
const BUDGET_PRESETS = [500, 1000, 2500, 5000];
const RECIPIENT_PRESETS = [1000, 5000, 10000, 25000];

const BADGE_LABELS = {
  POPULAR: { en: 'Most popular', bn: 'সবচেয়ে জনপ্রিয়' },
  PREMIUM: { en: 'Premium', bn: 'প্রিমিয়াম' },
  NEW: { en: 'New', bn: 'নতুন' },
  BEST_VALUE: { en: 'Best value', bn: 'সেরা মূল্য' },
};

const STATUS_LABELS = {
  ACTIVE: { en: 'Active', bn: 'সক্রিয়', color: 'success' },
  SCHEDULED: { en: 'Scheduled', bn: 'নির্ধারিত', color: 'info' },
  PENDING_REVIEW: { en: 'Under review', bn: 'পর্যালোচনায়', color: 'warning' },
  PAUSED: { en: 'Paused', bn: 'স্থগিত', color: 'neutral' },
  COMPLETED: { en: 'Finished', bn: 'সম্পন্ন', color: 'info' },
  REJECTED: { en: 'Rejected', bn: 'প্রত্যাখ্যাত', color: 'danger' },
  DRAFT: { en: 'Draft', bn: 'খসড়া', color: 'neutral' },
};

const PRICING_MODEL_LABELS = {
  CPC: { en: 'Pay per click', bn: 'প্রতি ক্লিকে খরচ' },
  CPM: { en: 'Pay per 1,000 views', bn: 'প্রতি ১,০০০ ভিউতে খরচ' },
  FLAT_DAILY: { en: 'Fixed price per day', bn: 'দৈনিক নির্দিষ্ট দাম' },
  FLAT_SLOT: { en: 'Fixed price per slot', bn: 'প্রতি স্লটে নির্দিষ্ট দাম' },
  CPS: { en: 'Pay per recipient', bn: 'প্রতি প্রাপকে খরচ' },
  CPA: { en: 'Pay per sale', bn: 'প্রতি বিক্রয়ে খরচ' },
};

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const money = (n) => `৳${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const count = (n) => Number(n || 0).toLocaleString('en-US');
const todayISO = () => new Date().toISOString().slice(0, 10);

export class AdCampaignPage {
  constructor() {
    this.tab = 'store';
    this.products = [];
    this.categories = [];
    this.campaigns = [];
    this.tier = 'STARTER';
    this.loading = true;
    this.statusFilter = 'ALL';
    this.rootEl = null;
    this.unsubscribeLang = null;
    this.wizard = null;
    this.quoteTimer = null;
  }

  async mount(outlet) {
    loadAdStoreStyles();
    this.rootEl = outlet;
    this.unsubscribeLang = subscribeLang(() => this.render());
    await this.loadAll();
    this.render();
  }

  unmount() {
    if (this.unsubscribeLang) {
      this.unsubscribeLang();
      this.unsubscribeLang = null;
    }
    if (this.quoteTimer) clearTimeout(this.quoteTimer);
    this.closeWizard();
  }

  get isBn() {
    return getLanguage() === 'bn';
  }

  async loadAll() {
    this.loading = true;
    const [catalog, campaigns, cats] = await Promise.allSettled([
      api.get('/ads/products'),
      api.get('/ads/campaigns'),
      api.get('/ads/target-categories'),
    ]);

    if (catalog.status === 'fulfilled') {
      this.products = catalog.value?.products || [];
      this.tier = catalog.value?.tier || 'STARTER';
    } else {
      this.products = [];
      toast.error(catalog.reason?.message || 'Failed to load ad formats');
    }

    this.campaigns = campaigns.status === 'fulfilled' ? (campaigns.value?.campaigns || []) : [];
    this.categories = cats.status === 'fulfilled' ? (cats.value?.categories || []) : [];
    this.loading = false;
  }

  /* ------------------------------------------------------------------------------------- *
   * Render
   * ------------------------------------------------------------------------------------- */

  render() {
    if (!this.rootEl) return;
    const isBn = this.isBn;

    const totalImpressions = this.campaigns.reduce((a, c) => a + (Number(c.impressions_count) || 0), 0);
    const totalClicks = this.campaigns.reduce((a, c) => a + (Number(c.clicks_count) || 0), 0);
    const totalSpend = this.campaigns.reduce((a, c) => a + (Number(c.spent_amount) || 0), 0);
    const activeCount = this.campaigns.filter((c) => c.status === 'ACTIVE' || c.status === 'SCHEDULED').length;
    const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00';

    this.rootEl.innerHTML = `
      <div class="saler-page-container">
        <div class="saler-header-row">
          <div class="saler-header-row__titles">
            <div class="saler-header-row__breadcrumb">
              <a href="/saler">← ${isBn ? 'ড্যাশবোর্ড' : 'Dashboard'}</a>
              <span>/</span>
              <span class="font-bold text-primary">${isBn ? 'বিজ্ঞাপন' : 'Advertising'}</span>
            </div>
            <h1 class="saler-header-row__title">
              <span>📣</span>
              <span>${isBn ? 'বিজ্ঞাপন কেন্দ্র' : 'Ad Centre'}</span>
            </h1>
            <p class="saler-header-row__subtitle">
              ${isBn
                ? 'আপনার পণ্য, দোকান বা লাইভ শো প্রচারের জন্য একটি ফরম্যাট বেছে নিন — দাম আগেই দেখানো হবে, কোনো লুকানো খরচ নেই।'
                : 'Pick a format to promote your product, shop or live show. You see the exact price before you pay — nothing hidden.'}
            </p>
          </div>
          <div class="saler-header-row__actions">
            <button type="button" id="btn-refresh" class="btn btn--secondary btn--sm font-bold">
              🔄 ${isBn ? 'রিফ্রেশ' : 'Refresh'}
            </button>
          </div>
        </div>

        <div class="saler-kpi-grid">
          ${this._kpiCard(isBn ? 'চলমান বিজ্ঞাপন' : 'Running ads', '🟢', String(activeCount),
            isBn ? 'সক্রিয় ও নির্ধারিত' : 'Active and scheduled', 'saler-kpi-card__value--profit')}
          ${this._kpiCard(isBn ? 'মোট ইমপ্রেশন' : 'Impressions', '👁️', count(totalImpressions),
            isBn ? 'কতজন দেখেছে' : 'Times shoppers saw you')}
          ${this._kpiCard(isBn ? 'মোট ক্লিক' : 'Clicks', '🖱️', count(totalClicks),
            isBn ? 'সরাসরি ভিজিট' : 'Visits to your listings')}
          ${this._kpiCard(isBn ? 'গড় সিটিআর' : 'Avg. CTR', '🎯', `${ctr}%`,
            isBn ? 'প্রতি ১০০ ভিউতে ক্লিক' : 'Clicks per 100 views')}
          ${this._kpiCard(isBn ? 'মোট খরচ' : 'Total spend', '💸', money(totalSpend),
            isBn ? 'ভল্ট থেকে কাটা' : 'Billed from your vault')}
        </div>

        <div class="ad-tabs" role="tablist">
          <button type="button" role="tab" aria-selected="${this.tab === 'store'}"
                  class="ad-tabs__tab ${this.tab === 'store' ? 'ad-tabs__tab--active' : ''}" data-tab="store">
            🛍️ ${isBn ? 'বিজ্ঞাপন স্টোর' : 'Ad Store'}
          </button>
          <button type="button" role="tab" aria-selected="${this.tab === 'campaigns'}"
                  class="ad-tabs__tab ${this.tab === 'campaigns' ? 'ad-tabs__tab--active' : ''}" data-tab="campaigns">
            📊 ${isBn ? 'আমার ক্যাম্পেইন' : 'My Campaigns'}
            <span class="ad-tabs__count">${this.campaigns.length}</span>
          </button>
        </div>

        ${this.loading
          ? `<div class="saler-card text-center p-8 text-muted">${isBn ? 'লোড হচ্ছে…' : 'Loading…'}</div>`
          : this.tab === 'store' ? this._renderStore() : this._renderCampaigns()}
      </div>
    `;

    this._attachEvents();
  }

  _kpiCard(label, icon, value, hint, valueClass = '') {
    return `
      <div class="saler-kpi-card">
        <div class="saler-kpi-card__header"><span>${label}</span><span aria-hidden="true">${icon}</span></div>
        <div class="saler-kpi-card__value ${valueClass}">${value}</div>
        <div class="saler-kpi-card__subtext">${hint}</div>
      </div>
    `;
  }

  _renderStore() {
    const isBn = this.isBn;

    if (!this.products.length) {
      return `
        <div class="saler-card text-center p-8">
          <div class="text-4xl mb-3">🛍️</div>
          <h3 class="saler-card__title justify-center">${isBn ? 'এখন কোনো বিজ্ঞাপন ফরম্যাট বিক্রি হচ্ছে না' : 'No ad formats are on sale right now'}</h3>
          <p class="saler-card__subtitle mt-1">${isBn ? 'অ্যাডমিন ফরম্যাট চালু করলে সেগুলো এখানে দেখা যাবে।' : 'Formats appear here once an administrator puts them on sale.'}</p>
        </div>
      `;
    }

    const discount = Number(this.products[0]?.your_discount_percent || 0);

    return `
      ${discount > 0 ? `
        <div class="ad-tier-note">
          <span aria-hidden="true">🏅</span>
          <span>${isBn
            ? `আপনার <strong>${this._tierLabel()}</strong> স্ট্যাটাসের জন্য প্রতিটি বিজ্ঞাপনে <strong>${discount}% ছাড়</strong> প্রযোজ্য।`
            : `Your <strong>${this._tierLabel()}</strong> status earns <strong>${discount}% off</strong> every ad below.`}</span>
        </div>
      ` : ''}

      <div class="ad-format-grid">
        ${this.products.map((p) => this._renderFormatCard(p)).join('')}
      </div>
    `;
  }

  _tierLabel() {
    const map = {
      STARTER: { en: 'Starter', bn: 'স্টার্টার' },
      VERIFIED_TRADER: { en: 'Verified Trader', bn: 'ভেরিফাইড ট্রেডার' },
      ELITE_PARTNER: { en: 'Elite Partner', bn: 'এলিট পার্টনার' },
    };
    const entry = map[this.tier] || map.STARTER;
    return this.isBn ? entry.bn : entry.en;
  }

  _renderFormatCard(p) {
    const isBn = this.isBn;
    const badge = p.badge_key ? BADGE_LABELS[p.badge_key] : null;
    const model = PRICING_MODEL_LABELS[p.pricing_model] || { en: p.pricing_model, bn: p.pricing_model };
    const prepaid = p.billing_mode === 'PREPAID';
    // A prepaid format that rents a position also holds inventory; a one-off send does not, and
    // promising a seller a "reserved slot" for a push blast would be a lie.
    const reservesSlot = p.pricing_model === 'FLAT_DAILY' || p.pricing_model === 'FLAT_SLOT';

    return `
      <article class="ad-format-card ${badge ? 'ad-format-card--badged' : ''}">
        ${badge ? `<span class="ad-format-card__badge ad-format-card__badge--${p.badge_key.toLowerCase()}">${isBn ? badge.bn : badge.en}</span>` : ''}
        <div class="ad-format-card__icon" aria-hidden="true">${p.icon || '📢'}</div>
        <h3 class="ad-format-card__name">${escapeHtml(isBn ? p.name_bn : p.name_en)}</h3>
        <p class="ad-format-card__tagline">${escapeHtml(isBn ? p.tagline_bn : p.tagline_en)}</p>
        <p class="ad-format-card__desc">${escapeHtml(isBn ? p.description_bn : p.description_en)}</p>

        <div class="ad-format-card__price">
          <span class="ad-format-card__price-amount">${escapeHtml(isBn ? p.price_label_bn : p.price_label_en)}</span>
          <span class="ad-format-card__price-model">${isBn ? model.bn : model.en}</span>
        </div>

        <div class="ad-format-card__meta">
          <span class="ad-chip ${prepaid ? 'ad-chip--prepaid' : 'ad-chip--metered'}">
            ${!prepaid
              ? (isBn ? '📈 ফল অনুযায়ী খরচ' : '📈 Charged as results come in')
              : reservesSlot
                ? (isBn ? '💳 আগে পরিশোধ, জায়গা সংরক্ষিত' : '💳 Paid upfront, slot reserved')
                : (isBn ? '💳 একবারে আগে পরিশোধ' : '💳 Paid upfront, one send')}
          </span>
          ${p.requires_product ? `<span class="ad-chip">${isBn ? '📦 একটি পণ্য লাগবে' : '📦 Needs a product'}</span>` : ''}
        </div>

        <button type="button" class="btn btn--primary ad-format-card__cta font-bold" data-choose="${escapeHtml(p.key)}">
          ${isBn ? 'এটি বেছে নিন' : 'Choose this'}
        </button>
      </article>
    `;
  }

  _renderCampaigns() {
    const isBn = this.isBn;
    const filtered = this.statusFilter === 'ALL'
      ? this.campaigns
      : this.campaigns.filter((c) => c.status === this.statusFilter);

    const filters = ['ALL', 'ACTIVE', 'SCHEDULED', 'PENDING_REVIEW', 'PAUSED', 'COMPLETED'];

    return `
      <div class="saler-toolbar">
        <div class="saler-toolbar__filters">
          ${filters.map((key) => `
            <button type="button"
              class="btn btn--xs ${this.statusFilter === key ? 'btn--primary font-bold' : 'btn--neutral'}"
              data-filter="${key}">
              ${key === 'ALL' ? (isBn ? 'সব' : 'All') : (isBn ? STATUS_LABELS[key].bn : STATUS_LABELS[key].en)}
            </button>
          `).join('')}
        </div>
        <button type="button" class="btn btn--primary btn--xs font-bold" data-tab="store">
          + ${isBn ? 'নতুন বিজ্ঞাপন' : 'New ad'}
        </button>
      </div>

      ${filtered.length === 0 ? `
        <div class="saler-card text-center p-8">
          <div class="text-4xl mb-3">📢</div>
          <h3 class="saler-card__title justify-center">${isBn ? 'কোনো ক্যাম্পেইন নেই' : 'No campaigns here yet'}</h3>
          <p class="saler-card__subtitle mt-1">${isBn ? 'বিজ্ঞাপন স্টোর থেকে একটি ফরম্যাট বেছে নিয়ে শুরু করুন।' : 'Pick a format from the Ad Store to get started.'}</p>
        </div>
      ` : `
        <div class="saler-table-wrap">
          <table class="saler-table">
            <thead>
              <tr>
                <th>${isBn ? 'ক্যাম্পেইন' : 'Campaign'}</th>
                <th>${isBn ? 'ফরম্যাট' : 'Format'}</th>
                <th>${isBn ? 'অবস্থা' : 'Status'}</th>
                <th>${isBn ? 'খরচ' : 'Cost'}</th>
                <th>${isBn ? 'ফলাফল' : 'Results'}</th>
                <th style="text-align:right;">${isBn ? 'অ্যাকশন' : 'Action'}</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map((c) => this._renderCampaignRow(c)).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
  }

  _renderCampaignRow(c) {
    const isBn = this.isBn;
    const status = STATUS_LABELS[c.status] || { en: c.status, bn: c.status, color: 'neutral' };
    const prepaid = c.billing_mode === 'PREPAID';
    const spent = Number(c.spent_amount) || 0;
    const budget = Number(c.total_budget) || 0;
    const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
    const ctrValue = c.ctr_percentage != null ? c.ctr_percentage : '0.00';

    return `
      <tr>
        <td>
          <div class="font-semibold">${escapeHtml(c.title)}</div>
          <div class="text-xs text-muted font-mono mt-0.5">${escapeHtml(c.ref || '')}</div>
          ${c.status === 'REJECTED' && c.rejection_reason
            ? `<div class="text-xs text-danger mt-1">${escapeHtml(c.rejection_reason)}</div>` : ''}
        </td>
        <td>
          <div class="ad-cell-format">
            <span aria-hidden="true">${c.ad_product_icon || '📢'}</span>
            <span>${escapeHtml(isBn ? (c.ad_product_name_bn || '') : (c.ad_product_name_en || '')) || escapeHtml(c.placement)}</span>
          </div>
          <div class="text-xs text-muted">${isBn
            ? (PRICING_MODEL_LABELS[c.pricing_model]?.bn || '')
            : (PRICING_MODEL_LABELS[c.pricing_model]?.en || '')}</div>
        </td>
        <td><span class="badge badge-${status.color} text-xs font-semibold">${isBn ? status.bn : status.en}</span></td>
        <td>
          ${prepaid ? `
            <div class="font-semibold">${money(c.prepaid_amount || c.total_budget)}</div>
            <div class="text-xs text-muted">${isBn ? 'আগেই পরিশোধিত' : 'Paid upfront'}${c.duration_days ? ` · ${c.duration_days} ${isBn ? 'দিন' : 'days'}` : ''}</div>
          ` : `
            <div class="font-semibold">${money(spent)} <span class="text-xs font-normal text-muted">/ ${money(budget)}</span></div>
            <div class="ad-progress"><div class="ad-progress__fill" style="width:${pct}%"></div></div>
            <div class="text-xs text-muted mt-1">${isBn ? 'বাজেটের' : 'of budget'} ${pct}%</div>
          `}
        </td>
        <td class="text-sm">
          <div>${count(c.impressions_count)} <span class="text-xs text-muted">${isBn ? 'ভিউ' : 'views'}</span></div>
          <div class="text-xs text-muted">${count(c.clicks_count)} ${isBn ? 'ক্লিক' : 'clicks'} (${ctrValue}%)</div>
        </td>
        <td style="text-align:right;">
          <div class="ad-row-actions">
            ${c.status === 'ACTIVE' ? `
              <button type="button" class="btn btn--neutral btn--xs" data-pause="${c.id}">⏸ ${isBn ? 'স্থগিত' : 'Pause'}</button>
            ` : c.status === 'PAUSED' ? `
              <button type="button" class="btn btn--primary btn--xs" data-resume="${c.id}">▶ ${isBn ? 'চালু' : 'Resume'}</button>
            ` : ''}
            ${['ACTIVE', 'PAUSED', 'SCHEDULED', 'PENDING_REVIEW'].includes(c.status) ? `
              <button type="button" class="btn btn--ghost btn--xs" data-cancel="${c.id}">${isBn ? 'বাতিল' : 'Cancel'}</button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }

  _attachEvents() {
    const root = this.rootEl;

    root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.tab;
        this.render();
      });
    });

    root.querySelector('#btn-refresh')?.addEventListener('click', async () => {
      await this.loadAll();
      this.render();
    });

    root.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.statusFilter = btn.dataset.filter;
        this.render();
      });
    });

    root.querySelectorAll('[data-choose]').forEach((btn) => {
      btn.addEventListener('click', () => this.openWizard(btn.dataset.choose));
    });

    root.querySelectorAll('[data-pause]').forEach((btn) => {
      btn.addEventListener('click', () => this._campaignAction(btn.dataset.pause, 'pause'));
    });
    root.querySelectorAll('[data-resume]').forEach((btn) => {
      btn.addEventListener('click', () => this._campaignAction(btn.dataset.resume, 'resume'));
    });
    root.querySelectorAll('[data-cancel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ok = window.confirm(this.isBn
          ? 'এই ক্যাম্পেইন বাতিল করবেন? সংরক্ষিত জায়গা ছেড়ে দেওয়া হবে এবং এটি আর দেখানো হবে না।'
          : 'Cancel this campaign? Its reserved placement is released and it stops showing.');
        if (ok) this._campaignAction(btn.dataset.cancel, 'cancel');
      });
    });
  }

  async _campaignAction(id, action) {
    try {
      await api.post(`/ads/campaigns/${id}/${action}`);
      const messages = {
        pause: { en: 'Campaign paused', bn: 'ক্যাম্পেইন স্থগিত করা হয়েছে' },
        resume: { en: 'Campaign resumed', bn: 'ক্যাম্পেইন চালু করা হয়েছে' },
        cancel: { en: 'Campaign cancelled', bn: 'ক্যাম্পেইন বাতিল করা হয়েছে' },
      };
      toast.success(this.isBn ? messages[action].bn : messages[action].en);
      await this.loadAll();
      this.render();
    } catch (err) {
      toast.error(err.message || 'Action failed');
    }
  }

  /* ------------------------------------------------------------------------------------- *
   * Purchase wizard
   * ------------------------------------------------------------------------------------- */

  openWizard(productKey) {
    const product = this.products.find((p) => p.key === productKey);
    if (!product) return;

    const limits = product.limits || {};
    this.wizard = {
      product,
      step: 1,
      quote: null,
      quoteError: null,
      quoting: false,
      submitting: false,
      form: {
        title: '',
        headline: '',
        description: '',
        banner_image_url: '',
        call_to_action: 'SHOP_NOW',
        keywords: '',
        category_id: this.categories[0]?.id || '',
        total_budget: Math.max(BUDGET_PRESETS[1], Number(limits.min_budget) || 0),
        bid_amount: Number(limits.suggested_cpc) || 2.5,
        duration_days: Number(limits.min_days) || 1,
        quantity: Number(limits.min_quantity) || 1,
        start_date: todayISO(),
      },
    };

    const backdrop = document.createElement('div');
    backdrop.className = 'ad-wizard-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', this.isBn ? 'বিজ্ঞাপন তৈরি করুন' : 'Create an ad');
    document.body.appendChild(backdrop);
    this.wizardEl = backdrop;

    this._onWizardKeydown = (e) => { if (e.key === 'Escape') this.closeWizard(); };
    document.addEventListener('keydown', this._onWizardKeydown);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this.closeWizard(); });

    this.renderWizard();
    this.requestQuote();
  }

  closeWizard() {
    if (this._onWizardKeydown) {
      document.removeEventListener('keydown', this._onWizardKeydown);
      this._onWizardKeydown = null;
    }
    if (this.wizardEl && document.body.contains(this.wizardEl)) {
      document.body.removeChild(this.wizardEl);
    }
    this.wizardEl = null;
    this.wizard = null;
  }

  /** Re-prices the wizard's current input on the server, debounced against typing. */
  requestQuote() {
    if (!this.wizard) return;
    const w = this.wizard;

    if (this.quoteTimer) clearTimeout(this.quoteTimer);
    w.quoting = true;
    this._paintQuote();

    this.quoteTimer = setTimeout(async () => {
      if (!this.wizard) return;
      const f = w.form;
      try {
        const res = await api.post('/ads/quote', {
          ad_product_key: w.product.key,
          total_budget: Number(f.total_budget),
          daily_budget: Number(f.total_budget),
          bid_amount: Number(f.bid_amount),
          duration_days: Number(f.duration_days),
          quantity: Number(f.quantity),
          category_id: f.category_id ? Number(f.category_id) : null,
          start_date: f.start_date,
        });
        if (!this.wizard) return;
        w.quote = res.quote || null;
        w.quoteError = null;
      } catch (err) {
        if (!this.wizard) return;
        w.quote = null;
        w.quoteError = err.message || 'Could not price this campaign';
      } finally {
        if (this.wizard) {
          w.quoting = false;
          this._paintQuote();
        }
      }
    }, 250);
  }

  /** Updates only the price panel, so re-quoting never steals focus from the field being typed in. */
  _paintQuote() {
    const panel = this.wizardEl?.querySelector('#ad-quote-panel');
    if (panel) panel.innerHTML = this._quotePanelHtml();
    const cta = this.wizardEl?.querySelector('#ad-wizard-submit');
    if (cta) {
      cta.innerHTML = this._submitLabel();
      cta.disabled = !this.wizard?.quote || this.wizard.quoting || this.wizard.submitting;
    }
  }

  renderWizard() {
    if (!this.wizard || !this.wizardEl) return;
    const isBn = this.isBn;
    const w = this.wizard;
    const p = w.product;

    const stepTitles = [
      { en: 'What are you promoting?', bn: 'আপনি কী প্রচার করতে চান?' },
      { en: 'How big and how long?', bn: 'কত বড় এবং কত দিন?' },
      { en: 'Confirm and pay', bn: 'নিশ্চিত করুন ও পরিশোধ করুন' },
    ];

    this.wizardEl.innerHTML = `
      <div class="ad-wizard">
        <header class="ad-wizard__head">
          <div class="ad-wizard__head-main">
            <span class="ad-wizard__icon" aria-hidden="true">${p.icon || '📢'}</span>
            <div>
              <h2 class="ad-wizard__title">${escapeHtml(isBn ? p.name_bn : p.name_en)}</h2>
              <p class="ad-wizard__subtitle">${escapeHtml(isBn ? p.price_label_bn : p.price_label_en)}</p>
            </div>
          </div>
          <button type="button" class="ad-wizard__close" data-close aria-label="${isBn ? 'বন্ধ করুন' : 'Close'}">×</button>
        </header>

        <ol class="ad-wizard__steps">
          ${stepTitles.map((s, i) => `
            <li class="ad-wizard__step ${w.step === i + 1 ? 'ad-wizard__step--active' : ''} ${w.step > i + 1 ? 'ad-wizard__step--done' : ''}">
              <span class="ad-wizard__step-num">${w.step > i + 1 ? '✓' : i + 1}</span>
              <span class="ad-wizard__step-label">${isBn ? s.bn : s.en}</span>
            </li>
          `).join('')}
        </ol>

        <div class="ad-wizard__body">
          <div class="ad-wizard__form">
            ${w.step === 1 ? this._stepCreative() : w.step === 2 ? this._stepReach() : this._stepReview()}
          </div>
          <aside class="ad-wizard__side" id="ad-quote-panel">
            ${this._quotePanelHtml()}
          </aside>
        </div>

        <footer class="ad-wizard__foot">
          <button type="button" class="btn btn--neutral" data-back>
            ${w.step === 1 ? (isBn ? 'বাতিল' : 'Cancel') : (isBn ? '← পেছনে' : '← Back')}
          </button>
          ${w.step < 3 ? `
            <button type="button" class="btn btn--primary font-bold" data-next>
              ${isBn ? 'পরবর্তী →' : 'Next →'}
            </button>
          ` : `
            <button type="button" class="btn btn--primary font-bold" id="ad-wizard-submit" ${w.quote ? '' : 'disabled'}>
              ${this._submitLabel()}
            </button>
          `}
        </footer>
      </div>
    `;

    this._attachWizardEvents();
  }

  _submitLabel() {
    const isBn = this.isBn;
    const w = this.wizard;
    if (!w) return '';
    if (w.submitting) return isBn ? 'প্রক্রিয়াধীন…' : 'Working…';
    if (!w.quote) return isBn ? 'দাম হিসাব হচ্ছে…' : 'Pricing…';
    if (w.quote.billing_mode === 'PREPAID') {
      return isBn
        ? `ভল্ট থেকে ${money(w.quote.charge_now)} পরিশোধ করুন`
        : `Pay ${money(w.quote.charge_now)} from vault`;
    }
    return isBn
      ? `ক্যাম্পেইন চালু করুন (সীমা ${money(w.quote.budget_cap)})`
      : `Start campaign (cap ${money(w.quote.budget_cap)})`;
  }

  _stepCreative() {
    const isBn = this.isBn;
    const f = this.wizard.form;
    const p = this.wizard.product;

    return `
      <p class="ad-wizard__hint">${escapeHtml(isBn ? p.description_bn : p.description_en)}</p>

      <div class="field">
        <label class="field__label" for="ad-f-title">${isBn ? 'ক্যাম্পেইনের নাম' : 'Campaign name'} <span class="field__required">*</span></label>
        <div class="field__control">
          <input id="ad-f-title" class="input" type="text" data-field="title" value="${escapeHtml(f.title)}"
                 placeholder="${isBn ? 'যেমন: ঈদ জামদানি প্রচার' : 'e.g. Eid Jamdani promotion'}" />
        </div>
        <p class="field__help">${isBn ? 'শুধু আপনি দেখবেন — ক্যাম্পেইন চেনার জন্য।' : 'Only you see this — it is how you will recognise the campaign.'}</p>
      </div>

      <div class="field">
        <label class="field__label" for="ad-f-headline">${isBn ? 'বিজ্ঞাপনের শিরোনাম' : 'Ad headline'} <span class="field__required">*</span></label>
        <div class="field__control">
          <input id="ad-f-headline" class="input" type="text" data-field="headline" value="${escapeHtml(f.headline)}"
                 maxlength="70"
                 placeholder="${isBn ? 'খাঁটি তাঁতের জামদানি — ২০% ছাড়' : 'Authentic handloom Jamdani — 20% off'}" />
        </div>
        <p class="field__help">${isBn ? 'ক্রেতা এটিই প্রথমে পড়বে। ৭০ অক্ষরের মধ্যে রাখুন।' : 'This is what shoppers read first. Keep it under 70 characters.'}</p>
      </div>

      <div class="field">
        <label class="field__label" for="ad-f-desc">${isBn ? 'সংক্ষিপ্ত বিবরণ' : 'Short description'}</label>
        <div class="field__control field__control--textarea">
          <textarea id="ad-f-desc" class="textarea" rows="2" data-field="description"
                    placeholder="${isBn ? 'সীমিত সময়ের ঐতিহ্যবাহী কালেকশন, দ্রুত ডেলিভারি' : 'Limited-time heritage collection, fast delivery'}">${escapeHtml(f.description)}</textarea>
        </div>
      </div>

      ${p.pricing_model === 'CPC' ? `
        <div class="field">
          <label class="field__label" for="ad-f-keywords">${isBn ? 'কোন শব্দ খুঁজলে দেখাবে?' : 'Which searches should show your ad?'}</label>
          <div class="field__control">
            <input id="ad-f-keywords" class="input" type="text" data-field="keywords" value="${escapeHtml(f.keywords)}"
                   placeholder="${isBn ? 'শাড়ি, জামদানি, লাল শাড়ি' : 'saree, jamdani, red saree'}" />
          </div>
          <p class="field__help">${isBn ? 'কমা দিয়ে আলাদা করুন। খালি রাখলে আমরা আপনার পণ্য থেকে বেছে নেব।' : 'Separate with commas. Leave blank and we will pick from your product details.'}</p>
        </div>
      ` : ''}

      ${p.placement === 'CATEGORY_BANNER' ? `
        <div class="field">
          <label class="field__label" for="ad-f-category">${isBn ? 'কোন ক্যাটেগরির ব্যানার?' : 'Which category banner?'} <span class="field__required">*</span></label>
          <div class="field__control field__control--select">
            <select id="ad-f-category" class="select" data-field="category_id">
              ${this.categories.map((c) => `
                <option value="${c.id}" ${String(f.category_id) === String(c.id) ? 'selected' : ''}>
                  ${escapeHtml(this.isBn ? c.name_bn : c.name_en)}
                </option>
              `).join('')}
            </select>
          </div>
        </div>
      ` : ''}

      <div class="field">
        <label class="field__label" for="ad-f-banner">${isBn ? 'ব্যানার ছবির লিংক' : 'Banner image URL'}</label>
        <div class="field__control">
          <input id="ad-f-banner" class="input" type="url" data-field="banner_image_url" value="${escapeHtml(f.banner_image_url)}" placeholder="https://…" />
        </div>
        <p class="field__help">${isBn ? 'ঐচ্ছিক। না দিলে আপনার পণ্যের ছবি ব্যবহার করা হবে।' : 'Optional. Without one we use your product photo.'}</p>
      </div>
    `;
  }

  _stepReach() {
    const isBn = this.isBn;
    const w = this.wizard;
    const p = w.product;
    const f = w.form;
    const limits = p.limits || {};

    if (p.pricing_model === 'CPC' || p.pricing_model === 'CPM') {
      return `
        <div class="field">
          <span class="field__label">${isBn ? 'মোট বাজেট' : 'Total budget'}</span>
          <div class="ad-presets">
            ${BUDGET_PRESETS.map((v) => `
              <button type="button" class="ad-preset ${Number(f.total_budget) === v ? 'ad-preset--active' : ''}" data-preset-budget="${v}">
                ${money(v)}
              </button>
            `).join('')}
          </div>
          <div class="field__control mt-2">
            <input class="input" type="number" min="${limits.min_budget || 0}" step="100"
                   data-field="total_budget" value="${f.total_budget}" aria-label="${isBn ? 'কাস্টম বাজেট' : 'Custom budget'}" />
          </div>
          <p class="field__help">${isBn
            ? `এটি সর্বোচ্চ সীমা — এর বেশি কখনো কাটা হবে না। সর্বনিম্ন ${money(limits.min_budget)}।`
            : `This is a hard ceiling — you are never charged more. Minimum ${money(limits.min_budget)}.`}</p>
        </div>

        ${p.pricing_model === 'CPC' ? `
          <div class="field">
            <label class="field__label" for="ad-f-bid">${isBn ? 'প্রতি ক্লিকে সর্বোচ্চ কত দেবেন?' : 'Most you will pay per click'}</label>
            <div class="ad-bid-row">
              <input id="ad-f-bid" class="ad-bid-slider" type="range"
                     min="${limits.floor_cpc}" max="${(Number(limits.suggested_cpc) * 3).toFixed(2)}" step="0.25"
                     data-field="bid_amount" value="${f.bid_amount}" />
              <output class="ad-bid-value">${money(f.bid_amount)}</output>
            </div>
            <p class="field__help">${isBn
              ? `সর্বনিম্ন ${money(limits.floor_cpc)}. বেশি দিলে আপনার বিজ্ঞাপন উপরে দেখানোর সম্ভাবনা বাড়ে — তবে নিলামে আপনি সাধারণত এর চেয়ে কমই দেন।`
              : `Minimum ${money(limits.floor_cpc)}. A higher bid wins better positions — and the auction usually charges you less than your maximum.`}</p>
          </div>
        ` : `
          <div class="ad-callout">
            ${isBn
              ? `প্রতি ১,০০০ ভিউতে নির্দিষ্ট দাম। কোনো বিড লাগবে না — বাজেট শেষ হলে বিজ্ঞাপন থেমে যাবে।`
              : 'A fixed price per 1,000 views. No bidding needed — the ad simply stops when the budget runs out.'}
          </div>
        `}
      `;
    }

    if (p.pricing_model === 'FLAT_DAILY') {
      const minD = Number(limits.min_days) || 1;
      const maxD = Number(limits.max_days) || 30;
      const dayChoices = [minD, minD * 2, 7, 14, 30].filter((d, i, arr) => d >= minD && d <= maxD && arr.indexOf(d) === i);

      return `
        <div class="field">
          <span class="field__label">${isBn ? 'কত দিনের জন্য?' : 'For how many days?'}</span>
          <div class="ad-presets">
            ${dayChoices.map((d) => `
              <button type="button" class="ad-preset ${Number(f.duration_days) === d ? 'ad-preset--active' : ''}" data-preset-days="${d}">
                ${d} ${isBn ? 'দিন' : d === 1 ? 'day' : 'days'}
              </button>
            `).join('')}
          </div>
          <div class="field__control mt-2">
            <input class="input" type="number" min="${minD}" max="${maxD}" step="1"
                   data-field="duration_days" value="${f.duration_days}" aria-label="${isBn ? 'দিনের সংখ্যা' : 'Number of days'}" />
          </div>
          <p class="field__help">${isBn ? `সর্বনিম্ন ${minD} দিন, সর্বোচ্চ ${maxD} দিন।` : `Minimum ${minD} day(s), maximum ${maxD}.`}</p>
        </div>

        <div class="field">
          <label class="field__label" for="ad-f-start">${isBn ? 'কবে থেকে শুরু?' : 'Starting when?'}</label>
          <div class="field__control">
            <input id="ad-f-start" class="input" type="date" min="${todayISO()}" data-field="start_date" value="${f.start_date}" />
          </div>
        </div>
      `;
    }

    if (p.pricing_model === 'FLAT_SLOT') {
      const maxQ = Number(limits.max_quantity) || 10;
      const slotChoices = [1, 2, 3, 5].filter((q) => q <= maxQ);
      return `
        <div class="field">
          <span class="field__label">${isBn ? 'কয়টি স্লট নেবেন?' : 'How many slots?'}</span>
          <div class="ad-presets">
            ${slotChoices.map((q) => `
              <button type="button" class="ad-preset ${Number(f.quantity) === q ? 'ad-preset--active' : ''}" data-preset-qty="${q}">
                ${q} ${isBn ? 'স্লট' : q === 1 ? 'slot' : 'slots'}
              </button>
            `).join('')}
          </div>
          <div class="field__control mt-2">
            <input class="input" type="number" min="${limits.min_quantity || 1}" max="${maxQ}" step="1"
                   data-field="quantity" value="${f.quantity}" aria-label="${isBn ? 'স্লট সংখ্যা' : 'Number of slots'}" />
          </div>
        </div>

        <div class="field">
          <label class="field__label" for="ad-f-start">${isBn ? 'প্রথম স্লট কবে?' : 'First slot on'}</label>
          <div class="field__control">
            <input id="ad-f-start" class="input" type="date" min="${todayISO()}" data-field="start_date" value="${f.start_date}" />
          </div>
        </div>
      `;
    }

    // CPS — notification blast
    const minQ = Number(limits.min_quantity) || 1000;
    const maxQ = Number(limits.max_quantity) || 200000;
    return `
      <div class="field">
        <span class="field__label">${isBn ? 'কতজনের কাছে পাঠাবেন?' : 'How many shoppers should get it?'}</span>
        <div class="ad-presets">
          ${RECIPIENT_PRESETS.filter((v) => v >= minQ && v <= maxQ).map((v) => `
            <button type="button" class="ad-preset ${Number(f.quantity) === v ? 'ad-preset--active' : ''}" data-preset-qty="${v}">
              ${count(v)}
            </button>
          `).join('')}
        </div>
        <div class="field__control mt-2">
          <input class="input" type="number" min="${minQ}" max="${maxQ}" step="500"
                 data-field="quantity" value="${f.quantity}" aria-label="${isBn ? 'প্রাপকের সংখ্যা' : 'Number of recipients'}" />
        </div>
        <p class="field__help">${isBn
          ? `শুধু সম্মতি দেওয়া ক্রেতাদের কাছেই যাবে। সর্বনিম্ন ${count(minQ)} জন।`
          : `Only shoppers who opted in receive it. Minimum ${count(minQ)} recipients.`}</p>
      </div>
    `;
  }

  _stepReview() {
    const isBn = this.isBn;
    const w = this.wizard;
    const f = w.form;
    const p = w.product;

    const rows = [
      [isBn ? 'ফরম্যাট' : 'Format', escapeHtml(isBn ? p.name_bn : p.name_en)],
      [isBn ? 'ক্যাম্পেইন' : 'Campaign', escapeHtml(f.title || (isBn ? p.name_bn : p.name_en))],
      [isBn ? 'শিরোনাম' : 'Headline', escapeHtml(f.headline || '—')],
    ];

    if (p.pricing_model === 'FLAT_DAILY') {
      rows.push([isBn ? 'সময়কাল' : 'Duration', `${f.duration_days} ${isBn ? 'দিন' : 'days'} ${isBn ? 'থেকে' : 'from'} ${f.start_date}`]);
    }
    if (p.pricing_model === 'FLAT_SLOT') {
      rows.push([isBn ? 'স্লট' : 'Slots', `${f.quantity} ${isBn ? 'থেকে' : 'from'} ${f.start_date}`]);
    }
    if (p.pricing_model === 'CPS') {
      rows.push([isBn ? 'প্রাপক' : 'Recipients', count(f.quantity)]);
    }
    if (p.pricing_model === 'CPC') {
      rows.push([isBn ? 'সর্বোচ্চ বিড' : 'Max bid', money(f.bid_amount)]);
    }
    if (p.placement === 'CATEGORY_BANNER') {
      const cat = this.categories.find((c) => String(c.id) === String(f.category_id));
      rows.push([isBn ? 'ক্যাটেগরি' : 'Category', escapeHtml(cat ? (isBn ? cat.name_bn : cat.name_en) : '—')]);
    }

    const reviewNote = p.requires_review
      ? (isBn
        ? 'প্রকাশের আগে আমাদের টিম বিজ্ঞাপনটি দেখে অনুমোদন করবে — সাধারণত কয়েক ঘণ্টার মধ্যে।'
        : 'Our team checks the ad before it goes live — usually within a few hours.')
      : (isBn ? 'আপনার বিজ্ঞাপন সঙ্গে সঙ্গেই চালু হবে।' : 'Your ad goes live immediately.');

    return `
      <table class="ad-review-table">
        <tbody>
          ${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}
        </tbody>
      </table>
      <div class="ad-callout ad-callout--info">${reviewNote}</div>
    `;
  }

  _quotePanelHtml() {
    const isBn = this.isBn;
    const w = this.wizard;
    if (!w) return '';

    if (w.quoteError) {
      return `
        <div class="ad-quote">
          <h3 class="ad-quote__title">${isBn ? 'দাম' : 'Your price'}</h3>
          <p class="ad-quote__error">${escapeHtml(w.quoteError)}</p>
        </div>
      `;
    }

    if (!w.quote) {
      return `
        <div class="ad-quote">
          <h3 class="ad-quote__title">${isBn ? 'দাম' : 'Your price'}</h3>
          <p class="ad-quote__muted">${isBn ? 'হিসাব করা হচ্ছে…' : 'Calculating…'}</p>
        </div>
      `;
    }

    const q = w.quote;
    const est = q.estimate || {};
    const prepaid = q.billing_mode === 'PREPAID';

    return `
      <div class="ad-quote ${w.quoting ? 'ad-quote--stale' : ''}">
        <h3 class="ad-quote__title">${isBn ? 'দাম' : 'Your price'}</h3>

        <dl class="ad-quote__lines">
          ${q.lines.map((l) => `
            <div class="ad-quote__line">
              <dt>${escapeHtml(isBn ? l.label_bn : l.label_en)}${l.qty > 1 ? ` <span class="ad-quote__qty">× ${count(l.qty)}</span>` : ''}</dt>
              <dd>${money(l.amount)}</dd>
            </div>
          `).join('')}

          ${Number(q.discount_amount) > 0 ? `
            <div class="ad-quote__line ad-quote__line--credit">
              <dt>${isBn ? `${this._tierLabel()} ছাড় (${q.discount_percent}%)` : `${this._tierLabel()} discount (${q.discount_percent}%)`}</dt>
              <dd>− ${money(q.discount_amount)}</dd>
            </div>
          ` : ''}
          ${Number(q.service_fee) > 0 ? `
            <div class="ad-quote__line">
              <dt>${isBn ? `সার্ভিস ফি (${q.service_fee_percent}%)` : `Service fee (${q.service_fee_percent}%)`}</dt>
              <dd>${money(q.service_fee)}</dd>
            </div>
          ` : ''}
          ${Number(q.vat) > 0 ? `
            <div class="ad-quote__line">
              <dt>${isBn ? `ভ্যাট (${q.vat_percent}%)` : `VAT (${q.vat_percent}%)`}</dt>
              <dd>${money(q.vat)}</dd>
            </div>
          ` : ''}
        </dl>

        <div class="ad-quote__total">
          <span>${prepaid ? (isBn ? 'এখন পরিশোধ' : 'Pay now') : (isBn ? 'সর্বোচ্চ খরচ' : 'Spend limit')}</span>
          <strong>${money(prepaid ? q.charge_now : q.budget_cap)}</strong>
        </div>

        <p class="ad-quote__note">
          ${prepaid
            ? (isBn ? 'আপনার ভল্ট থেকে একবারেই কাটা হবে এবং জায়গা সংরক্ষিত হবে।' : 'Taken from your vault once, and the placement is reserved for you.')
            : (isBn ? 'আগে কিছু কাটা হবে না — ফল আসার সাথে সাথে এই সীমা পর্যন্ত কাটা হবে।' : 'Nothing is taken upfront — you are charged as results arrive, never past this limit.')}
        </p>

        ${est.clicks ? `<p class="ad-quote__est">${isBn ? `আনুমানিক ${count(est.clicks)} ক্লিক` : `Around ${count(est.clicks)} clicks`}</p>` : ''}
        ${est.impressions ? `<p class="ad-quote__est">${isBn ? `আনুমানিক ${count(est.impressions)} ভিউ` : `Around ${count(est.impressions)} views`}</p>` : ''}
        ${est.reach ? `<p class="ad-quote__est">${isBn ? `${count(est.reach)} জনের কাছে পৌঁছাবে` : `Reaches ${count(est.reach)} shoppers`}</p>` : ''}

        ${q.availability ? `
          <p class="ad-quote__est ${q.availability.available ? '' : 'ad-quote__error'}">
            ${q.availability.available
              ? (isBn
                ? `এই সময়ে ${q.availability.slots_left}/${q.availability.slots_per_period} জায়গা খালি আছে`
                : `${q.availability.slots_left} of ${q.availability.slots_per_period} positions free for these dates`)
              : (isBn ? 'এই তারিখগুলোতে সব জায়গা বুক হয়ে গেছে' : 'Every position is booked for these dates')}
          </p>
        ` : ''}
      </div>
    `;
  }

  _attachWizardEvents() {
    const el = this.wizardEl;
    const w = this.wizard;
    if (!el || !w) return;

    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeWizard());

    el.querySelector('[data-back]')?.addEventListener('click', () => {
      if (w.step === 1) {
        this.closeWizard();
      } else {
        w.step -= 1;
        this.renderWizard();
      }
    });

    el.querySelector('[data-next]')?.addEventListener('click', () => {
      if (w.step === 1 && !this._validateStepOne()) return;
      w.step += 1;
      this.renderWizard();
      this.requestQuote();
    });

    el.querySelector('#ad-wizard-submit')?.addEventListener('click', () => this._submitCampaign());

    el.querySelectorAll('[data-field]').forEach((input) => {
      const evt = input.type === 'range' ? 'input' : 'change';
      input.addEventListener(evt, () => {
        w.form[input.dataset.field] = input.value;
        if (input.type === 'range') {
          const out = el.querySelector('.ad-bid-value');
          if (out) out.textContent = money(input.value);
        }
        if (['total_budget', 'bid_amount', 'duration_days', 'quantity', 'start_date', 'category_id'].includes(input.dataset.field)) {
          this.requestQuote();
        }
      });
      if (input.type === 'number') {
        input.addEventListener('input', () => {
          w.form[input.dataset.field] = input.value;
          this.requestQuote();
        });
      }
    });

    el.querySelectorAll('[data-preset-budget]').forEach((btn) => {
      btn.addEventListener('click', () => {
        w.form.total_budget = Number(btn.dataset.presetBudget);
        this.renderWizard();
        this.requestQuote();
      });
    });
    el.querySelectorAll('[data-preset-days]').forEach((btn) => {
      btn.addEventListener('click', () => {
        w.form.duration_days = Number(btn.dataset.presetDays);
        this.renderWizard();
        this.requestQuote();
      });
    });
    el.querySelectorAll('[data-preset-qty]').forEach((btn) => {
      btn.addEventListener('click', () => {
        w.form.quantity = Number(btn.dataset.presetQty);
        this.renderWizard();
        this.requestQuote();
      });
    });
  }

  _validateStepOne() {
    const isBn = this.isBn;
    const f = this.wizard.form;
    if (!f.title.trim()) {
      toast.error(isBn ? 'ক্যাম্পেইনের নাম দিন' : 'Give your campaign a name');
      return false;
    }
    if (!f.headline.trim()) {
      toast.error(isBn ? 'বিজ্ঞাপনের শিরোনাম দিন' : 'Write an ad headline');
      return false;
    }
    return true;
  }

  async _submitCampaign() {
    const isBn = this.isBn;
    const w = this.wizard;
    if (!w || !w.quote || w.submitting) return;

    w.submitting = true;
    this._paintQuote();

    const f = w.form;
    const payload = {
      ad_product_key: w.product.key,
      title: f.title,
      objective: 'TRAFFIC',
      total_budget: Number(f.total_budget),
      daily_budget: Number(f.total_budget),
      bid_amount: Number(f.bid_amount),
      duration_days: Number(f.duration_days),
      quantity: Number(f.quantity),
      category_id: f.category_id ? Number(f.category_id) : null,
      start_date: f.start_date,
      targeting: {
        keywords: f.keywords.split(',').map((k) => k.trim()).filter(Boolean),
        categories: f.category_id ? [Number(f.category_id)] : [],
        districts: [],
      },
      creative: {
        headline: f.headline,
        description: f.description,
        banner_image_url: f.banner_image_url || null,
        call_to_action: f.call_to_action,
      },
    };

    try {
      await api.post('/ads/campaigns', payload);
      toast.success(isBn ? 'বিজ্ঞাপন তৈরি হয়েছে!' : 'Your ad is created!');
      this.closeWizard();
      this.tab = 'campaigns';
      await this.loadAll();
      this.render();
    } catch (err) {
      if (w) {
        w.submitting = false;
        this._paintQuote();
      }
      toast.error(err.message || (isBn ? 'বিজ্ঞাপন তৈরি করা যায়নি' : 'Could not create the ad'));
    }
  }
}

// WHY: this page is written as a class, but the router page contract (core/router.js) is a
// plain function `(container, ctx) => cleanup?`. Calling a class without `new` throws, so the
// default export adapts the two — mount() is fire-and-forget async, unmount() is the cleanup.
export default function mountAdCampaignPage(root, ctx = {}) {
  const page = new AdCampaignPage();
  page.mount(root);
  return () => page.unmount();
}
