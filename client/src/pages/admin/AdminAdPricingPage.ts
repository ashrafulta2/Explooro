/**
 * AdminAdPricingPage.ts — Ad pricing governance (/admin/growth/ad-pricing).
 *
 * This is where the price of every ad format on the platform is set. Guarded by
 * `growth.ad.govern`, which is HIGH risk and delegable — so a Super Admin can hand ad pricing to a
 * named staff member without handing over anything else, and every change they make lands in
 * audit_logs with a before/after pair.
 *
 * Each card is one row of `ad_products`. What you change here is what shop partners see in their Ad
 * Store the moment they reload — there is no deploy, and no price constant anywhere in the code.
 * Campaigns already bought keep the quote they were sold at (frozen in ad_campaigns.quote_json),
 * so raising a rate never re-bills someone retroactively.
 */

import { api } from '../../core/api.ts';
import { toast } from '../../services/toast.ts';
import { getLanguage } from '../../services/i18n.ts';
import { formatCurrency } from '../../services/format.ts';
import { loadAdStoreStyles } from '../../styles/loadAdStoreStyles.ts';

/**
 * Which rate-card fields each pricing model actually uses, and how to label them.
 * Mirrors RATE_CARD_FIELDS in server/src/services/adPricing.ts — the server re-validates every
 * value on write, so this map controls what is offered, never what is allowed.
 */
const MODEL_FIELDS = {
  CPC: ['floor_cpc', 'suggested_cpc', 'min_budget'],
  CPM: ['cpm_rate', 'min_budget'],
  FLAT_DAILY: ['daily_rate', 'min_days', 'max_days', 'slots_per_period'],
  FLAT_SLOT: ['slot_rate', 'min_quantity', 'max_quantity', 'slots_per_period'],
  CPS: ['cps_rate', 'min_quantity', 'max_quantity'],
  CPA: ['cpa_percent'],
};

const SHARED_FIELDS = ['service_fee_percent', 'vat_percent'];

const FIELD_LABELS = {
  floor_cpc: { en: 'Minimum bid per click (৳)', bn: 'প্রতি ক্লিকে সর্বনিম্ন বিড (৳)', step: '0.25' },
  suggested_cpc: { en: 'Suggested bid (৳)', bn: 'প্রস্তাবিত বিড (৳)', step: '0.25' },
  cpm_rate: { en: 'Price per 1,000 views (৳)', bn: 'প্রতি ১,০০০ ভিউয়ের দাম (৳)', step: '5' },
  daily_rate: { en: 'Price per day (৳)', bn: 'দৈনিক দাম (৳)', step: '10' },
  slot_rate: { en: 'Price per slot (৳)', bn: 'প্রতি স্লটের দাম (৳)', step: '50' },
  cps_rate: { en: 'Price per recipient (৳)', bn: 'প্রতি প্রাপকের দাম (৳)', step: '0.05' },
  cpa_percent: { en: 'Commission per sale (%)', bn: 'প্রতি বিক্রয়ে কমিশন (%)', step: '0.5' },
  min_budget: { en: 'Minimum budget (৳)', bn: 'সর্বনিম্ন বাজেট (৳)', step: '50' },
  min_days: { en: 'Minimum days', bn: 'সর্বনিম্ন দিন', step: '1' },
  max_days: { en: 'Maximum days', bn: 'সর্বোচ্চ দিন', step: '1' },
  min_quantity: { en: 'Minimum quantity', bn: 'সর্বনিম্ন পরিমাণ', step: '1' },
  max_quantity: { en: 'Maximum quantity', bn: 'সর্বোচ্চ পরিমাণ', step: '1' },
  slots_per_period: { en: 'Positions available per day', bn: 'প্রতিদিন কয়টি জায়গা', step: '1' },
  service_fee_percent: { en: 'Service fee (%)', bn: 'সার্ভিস ফি (%)', step: '0.5' },
  vat_percent: { en: 'VAT (%)', bn: 'ভ্যাট (%)', step: '0.5' },
};

const TIERS = [
  { key: 'STARTER', en: 'Starter', bn: 'স্টার্টার' },
  { key: 'VERIFIED_TRADER', en: 'Verified Trader', bn: 'ভেরিফাইড ট্রেডার' },
  { key: 'ELITE_PARTNER', en: 'Elite Partner', bn: 'এলিট পার্টনার' },
];

const MODEL_LABELS = {
  CPC: { en: 'Cost per click', bn: 'প্রতি ক্লিকে খরচ' },
  CPM: { en: 'Cost per 1,000 views', bn: 'প্রতি ১,০০০ ভিউতে খরচ' },
  FLAT_DAILY: { en: 'Flat daily rental', bn: 'দৈনিক নির্দিষ্ট ভাড়া' },
  FLAT_SLOT: { en: 'Flat per slot', bn: 'প্রতি স্লটে নির্দিষ্ট' },
  CPS: { en: 'Cost per send', bn: 'প্রতি প্রেরণে খরচ' },
  CPA: { en: 'Commission per sale', bn: 'প্রতি বিক্রয়ে কমিশন' },
};

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default function AdminAdPricingPage(root: HTMLElement) {
  loadAdStoreStyles();
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page ad-pricing-page';

  let products = [];
  let windowDays = 30;
  let isLoading = true;
  // Sponsored card density (GET /admin/ads/density). null = not loaded, so the section is left out.
  let density = null;

  async function loadData() {
    isLoading = true;
    render();
    const densityReq = api.get('/admin/ads/density').catch(() => null);
    try {
      const res = await api.get('/admin/ads/products');
      products = res.products || [];
      windowDays = res.window_days || 30;
    } catch (err) {
      products = [];
      toast.error(err.message || 'Failed to load ad pricing');
    } finally {
      density = await densityReq;
      isLoading = false;
      render();
    }
  }

  /** The first 24 cards of a grid, ad or organic, for the preview. Same rule as adBefore() in adPlacement.ts. */
  function previewCells(firstAt, every) {
    const cells = [];
    for (let i = 0; cells.length < 24; i += 1) {
      if (i >= firstAt && every >= 1 && (i - firstAt) % every === 0) cells.push(true);
      if (cells.length < 24) cells.push(false);
    }
    return cells.map((ad) => `<span class="ad-density__cell${ad ? ' ad-density__cell--ad' : ''}"></span>`).join('');
  }

  function renderDensity() {
    if (!density?.density) return '';
    const lim = density.limits || { first_at: { min: 0, max: 12 }, every: { min: 4, max: 40 } };
    const PLACES = [
      { key: 'SEARCH_RESULTS', en: 'Search results', bn: 'সার্চ ফলাফল' },
      { key: 'FEED', en: 'Home feed', bn: 'হোম ফিড' },
    ];
    return `
      <section class="ad-rate-card ad-density" data-density>
        <div class="ad-rate-card__head">
          <span class="ad-rate-card__icon" aria-hidden="true">🧭</span>
          <div>
            <h3 class="ad-rate-card__name">${isBn ? 'স্পন্সর্ড কার্ড কতবার দেখাবে' : 'How often sponsored cards appear'}</h3>
            <span class="ad-rate-card__model">ads.density</span>
          </div>
        </div>
        <p class="ad-density__hint" style="margin-bottom: var(--space-3);">
          ${isBn
            ? `বেশি ঘন ঘন ad দেখালে ক্রেতা বিরক্ত হন, কম হলে আয় কমে। প্রতি ${lim.every.min}টার কম card এ একটা ad রাখা যায় না, তাই দুটো ad কখনো পাশাপাশি বসে না। নতুন নিয়ম ক্রেতার পরের page load থেকে কাজ করবে।`
            : `Too often and shoppers tune out; too rarely and ad revenue drops. An ad can't appear more than once per ${lim.every.min} cards, so two never sit side by side. Shoppers get the change on their next page load.`}
        </p>
        <div class="ad-density__rows">
          ${PLACES.map((pl) => {
            const row = density.density[pl.key];
            return `
              <div>
                <strong>${isBn ? pl.bn : pl.en}</strong>
                <div class="ad-density__preview" data-preview="${pl.key}" aria-hidden="true">${previewCells(row.first_at, row.every)}</div>
                <div class="ad-rate-card__fields">
                  <div class="field">
                    <label class="field__label" for="den-${pl.key}-first">${isBn ? 'প্রথম ad কোন card এর আগে (০ = একদম প্রথম)' : 'First ad before card (0 = very first)'}</label>
                    <div class="field__control">
                      <input class="input" id="den-${pl.key}-first" type="number" step="1" min="${lim.first_at.min}" max="${lim.first_at.max}"
                             data-den="${pl.key}" data-den-field="first_at" value="${row.first_at}" />
                    </div>
                  </div>
                  <div class="field">
                    <label class="field__label" for="den-${pl.key}-every">${isBn ? 'এরপর প্রতি কয়টা card এ একটা ad' : 'Then one ad every N cards'}</label>
                    <div class="field__control">
                      <input class="input" id="den-${pl.key}-every" type="number" step="1" min="${lim.every.min}" max="${lim.every.max}"
                             data-den="${pl.key}" data-den-field="every" value="${row.every}" />
                    </div>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <div class="field">
          <label class="field__label" for="den-reason">${isBn ? 'পরিবর্তনের কারণ (অডিট লগে যাবে)' : 'Reason for the change (goes to the audit log)'}</label>
          <div class="field__control">
            <textarea class="input ad-density__reason" id="den-reason" maxlength="500"></textarea>
          </div>
        </div>
        <div class="ad-rate-card__foot">
          <p class="ad-density__hint">${isBn ? 'ঘর গুলো ক্রেতার প্রথম ২৪টা card; হলুদ ঘর = ad।' : 'Squares are the first 24 cards a shopper sees; amber = ad.'}</p>
          <button type="button" class="btn btn--primary btn--sm font-bold" data-save-density>
            ${isBn ? 'ঘনত্ব সংরক্ষণ করুন' : 'Save density'}
          </button>
        </div>
      </section>
    `;
  }

  function wireDensity() {
    const section = container.querySelector('[data-density]');
    if (!section) return;
    const read = () => {
      const out = {};
      section.querySelectorAll<HTMLInputElement>('[data-den]').forEach((input) => {
        out[input.dataset.den] ??= {};
        out[input.dataset.den][input.dataset.denField] = input.value === '' ? null : Number(input.value);
      });
      return out;
    };
    section.addEventListener('input', () => {
      const next = read();
      for (const [key, row] of Object.entries<Record<string, number>>(next)) {
        const box = section.querySelector(`[data-preview="${key}"]`);
        if (box && Number.isInteger(row.first_at) && Number.isInteger(row.every)) box.innerHTML = previewCells(row.first_at, row.every);
      }
    });
    section.querySelector<HTMLButtonElement>('[data-save-density]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const reason = section.querySelector<HTMLTextAreaElement>('#den-reason')?.value.trim() || '';
      if (reason.length < 10) {
        toast.error(isBn ? 'অন্তত ১০ অক্ষরের একটি কারণ লিখুন।' : 'Give a reason of at least 10 characters.');
        return;
      }
      btn.disabled = true;
      try {
        const res = await api.put('/admin/ads/density', { density: read(), reason, expected_updated_at: density.updated_at });
        density = { ...density, density: res.density, updated_at: res.updated_at };
        toast.success(isBn ? 'নতুন ঘনত্ব সংরক্ষিত হয়েছে' : 'New density saved');
        render();
      } catch (err) {
        // The server's message names the field and its range, or says the form is stale (409).
        toast.error((isBn && err.message_bn) || err.message || (isBn ? 'সংরক্ষণ করা যায়নি' : 'Could not save'));
        btn.disabled = false;
      }
    });
  }

  function renderField(product, field) {
    const label = FIELD_LABELS[field];
    if (!label) return '';
    const value = product.rate_card?.[field];
    return `
      <div class="field">
        <label class="field__label" for="rc-${product.id}-${field}">${isBn ? label.bn : label.en}</label>
        <div class="field__control">
          <input class="input" id="rc-${product.id}-${field}" type="number" step="${label.step}" min="0"
                 data-product="${product.id}" data-rate="${field}" value="${value != null ? value : ''}" />
        </div>
      </div>
    `;
  }

  function renderCard(p) {
    const fields = [...(MODEL_FIELDS[p.pricing_model] || []), ...SHARED_FIELDS];
    const model = MODEL_LABELS[p.pricing_model] || { en: p.pricing_model, bn: p.pricing_model };
    const stats = p.stats || {};
    const discounts = p.rate_card?.tier_discounts || {};

    return `
      <section class="ad-rate-card ${p.is_enabled ? '' : 'ad-rate-card--off'}" data-card="${p.id}">
        <div class="ad-rate-card__head">
          <span class="ad-rate-card__icon" aria-hidden="true">${p.icon || '📢'}</span>
          <div>
            <h3 class="ad-rate-card__name">${escapeHtml(isBn ? p.name_bn : p.name_en)}</h3>
            <span class="ad-rate-card__model">${isBn ? model.bn : model.en} · ${escapeHtml(p.placement)}</span>
          </div>
        </div>

        <div class="ad-rate-card__stats">
          <div>
            <span class="ad-rate-stat__label">${isBn ? `${windowDays} দিনের আয়` : `Revenue (${windowDays}d)`}</span>
            <span class="ad-rate-stat__value">${formatCurrency(Number(stats.revenue || 0))}</span>
          </div>
          <div>
            <span class="ad-rate-stat__label">${isBn ? 'ক্যাম্পেইন' : 'Campaigns'}</span>
            <span class="ad-rate-stat__value">${Number(stats.campaigns || 0)}</span>
          </div>
          <div>
            <span class="ad-rate-stat__label">${isBn ? 'ক্লিক' : 'Clicks'}</span>
            <span class="ad-rate-stat__value">${Number(stats.clicks || 0).toLocaleString('en-US')}</span>
          </div>
        </div>

        <div class="ad-rate-card__fields">
          ${fields.map((f) => renderField(p, f)).join('')}
        </div>

        <div class="ad-rate-card__fields">
          ${TIERS.map((t) => `
            <div class="field">
              <label class="field__label" for="rc-${p.id}-tier-${t.key}">
                ${isBn ? `${t.bn} ছাড় (%)` : `${t.en} discount (%)`}
              </label>
              <div class="field__control">
                <input class="input" id="rc-${p.id}-tier-${t.key}" type="number" step="1" min="0" max="50"
                       data-product="${p.id}" data-tier="${t.key}" value="${discounts[t.key] != null ? discounts[t.key] : 0}" />
              </div>
            </div>
          `).join('')}
        </div>

        <div class="ad-rate-card__foot">
          <div style="display:flex; flex-direction:column; gap:0.25rem;">
            <label class="ad-toggle">
              <input type="checkbox" data-product="${p.id}" data-flag="is_enabled" ${p.is_enabled ? 'checked' : ''} />
              <span>${isBn ? 'বিক্রির জন্য চালু' : 'On sale'}</span>
            </label>
            <label class="ad-toggle">
              <input type="checkbox" data-product="${p.id}" data-flag="requires_review" ${p.requires_review ? 'checked' : ''} />
              <span>${isBn ? 'অনুমোদন লাগবে' : 'Needs review'}</span>
            </label>
          </div>
          <button type="button" class="btn btn--primary btn--sm font-bold" data-save="${p.id}">
            ${isBn ? 'দাম সংরক্ষণ করুন' : 'Save pricing'}
          </button>
        </div>
      </section>
    `;
  }

  function render() {
    root.innerHTML = '';

    if (isLoading) {
      container.innerHTML = `<div class="p-8 text-center text-muted">${isBn ? 'লোড হচ্ছে…' : 'Loading…'}</div>`;
      root.appendChild(container);
      return;
    }

    const totalRevenue = products.reduce((a, p) => a + Number(p.stats?.revenue || 0), 0);
    const liveFormats = products.filter((p) => p.is_enabled).length;
    const topFormat = [...products].sort((a, b) => Number(b.stats?.revenue || 0) - Number(a.stats?.revenue || 0))[0];

    container.innerHTML = `
      <div class="admin-page-header">
        <div>
          <div class="admin-page-eyebrow">
            <span class="badge badge--neutral">💰 ${isBn ? 'বিজ্ঞাপন মূল্য নির্ধারণ' : 'Ad pricing'}</span>
          </div>
          <h1 class="admin-page-title">${isBn ? 'বিজ্ঞাপনের রেট কার্ড' : 'Ad Format Rate Cards'}</h1>
          <p class="admin-page-subtitle">
            ${isBn
              ? 'প্রতিটি বিজ্ঞাপন ফরম্যাটের দাম এখানেই ঠিক হয়। পরিবর্তন সঙ্গে সঙ্গে বিক্রেতাদের বিজ্ঞাপন স্টোরে দেখা যাবে, আর প্রতিটি পরিবর্তন অডিট লগে লেখা হবে।'
              : 'Every ad format’s price is set here. Changes reach the shop partners’ Ad Store immediately, and each one is written to the audit log with a before/after pair.'}
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
          <div class="admin-kpi-card__label">${isBn ? `বিজ্ঞাপন থেকে আয় (${windowDays} দিন)` : `Ad revenue (${windowDays}d)`}</div>
          <div class="admin-kpi-card__val font-mono">${formatCurrency(totalRevenue)}</div>
          <div class="admin-kpi-card__hint">${isBn ? 'সব ফরম্যাট মিলিয়ে' : 'Across every format'}</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'বিক্রির জন্য চালু ফরম্যাট' : 'Formats on sale'}</div>
          <div class="admin-kpi-card__val font-mono">${liveFormats} / ${products.length}</div>
          <div class="admin-kpi-card__hint">${isBn ? 'বন্ধ করলে শপ পার্টনাররা কিনতে পারবে না' : 'Switching one off hides it from shop partners'}</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'সর্বোচ্চ আয়ের ফরম্যাট' : 'Top earning format'}</div>
          <div class="admin-kpi-card__val text-brand">${topFormat ? escapeHtml(isBn ? topFormat.name_bn : topFormat.name_en) : '—'}</div>
          <div class="admin-kpi-card__hint">${topFormat ? formatCurrency(Number(topFormat.stats?.revenue || 0)) : ''}</div>
        </div>
      </div>

      <div class="mt-4">${renderDensity()}</div>

      <div class="ad-pricing-grid">
        ${products.map((p) => renderCard(p)).join('')}
      </div>
    `;

    container.querySelector('.refresh-btn')?.addEventListener('click', () => loadData());
    wireDensity();

    container.querySelectorAll<HTMLElement>('[data-save]').forEach((btn) => {
      btn.addEventListener('click', () => savePricing(Number(btn.dataset.save), btn));
    });

    root.appendChild(container);
  }

  async function savePricing(productId, btn) {
    const card = container.querySelector(`[data-card="${productId}"]`);
    if (!card) return;

    const rateCard: Record<string, any> = {};
    card.querySelectorAll<HTMLInputElement>('[data-rate]').forEach((input) => {
      if (input.value !== '') rateCard[input.dataset.rate] = Number(input.value);
    });

    const tierDiscounts: Record<string, number> = {};
    card.querySelectorAll<HTMLInputElement>('[data-tier]').forEach((input) => {
      tierDiscounts[input.dataset.tier] = Number(input.value || 0);
    });
    rateCard.tier_discounts = tierDiscounts;

    const flags: Record<string, boolean> = {};
    card.querySelectorAll<HTMLInputElement>('[data-flag]').forEach((input) => {
      flags[input.dataset.flag] = input.checked;
    });

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = isBn ? 'সংরক্ষণ হচ্ছে…' : 'Saving…';

    try {
      const res = await api.patch(`/admin/ads/products/${productId}`, { rate_card: rateCard, ...flags });
      const updated = res.product;
      const idx = products.findIndex((p) => p.id === productId);
      if (idx >= 0 && updated) {
        // Keep the revenue rollup — the PATCH response carries pricing, not statistics.
        products[idx] = { ...updated, stats: products[idx].stats };
      }
      toast.success(isBn ? 'নতুন দাম সংরক্ষিত হয়েছে' : 'New pricing saved');
      render();
    } catch (err) {
      toast.error(err.message || (isBn ? 'দাম সংরক্ষণ করা যায়নি' : 'Could not save pricing'));
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  loadData();
}
