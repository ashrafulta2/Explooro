/**
 * AdCampaignPage.js — Saler Sponsored Ads Campaign Manager (Prompt 9.1).
 *
 * Provides:
 * - KPI Metrics Overview: Active campaigns, impressions, clicks, CTR, and total spend.
 * - Campaign Creation Wizard: Objective, placement, multi-dimensional targeting, budget, bid, and creative builder.
 * - Live Campaign Monitoring: Status badges, budget progress bars, spend tracking, pause/resume actions.
 * - Complete English / Bengali localization.
 */

import { api } from '../../core/api.js';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Modal } from '../../components/ui/Modal.js';

export default class AdCampaignPage {
  constructor() {
    this.campaigns = [];
    this.loading = true;
    this.activeFilter = 'ALL';
    this.rootEl = null;
    this.unsubscribeLang = null;
  }

  async mount(outlet) {
    this.rootEl = outlet;
    this.unsubscribeLang = subscribeLang(() => this.render());
    await this.fetchCampaigns();
    this.render();
  }

  unmount() {
    if (this.unsubscribeLang) {
      this.unsubscribeLang();
      this.unsubscribeLang = null;
    }
  }

  async fetchCampaigns() {
    this.loading = true;
    try {
      const res = await api.get('/ads/campaigns');
      this.campaigns = res.campaigns || [];
    } catch (err) {
      toast.error(err.message || 'Failed to load campaigns');
      this.campaigns = [];
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (!this.rootEl) return;
    const lang = getLanguage();
    const isBn = lang === 'bn';

    // Calculate aggregated metrics
    const totalImpressions = this.campaigns.reduce((acc, c) => acc + (Number(c.impressions_count) || 0), 0);
    const totalClicks = this.campaigns.reduce((acc, c) => acc + (Number(c.clicks_count) || 0), 0);
    const totalSpend = this.campaigns.reduce((acc, c) => acc + (Number(c.spent_amount) || 0), 0);
    const activeCount = this.campaigns.filter(c => c.status === 'ACTIVE').length;
    const overallCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00';

    const filteredCampaigns = this.activeFilter === 'ALL'
      ? this.campaigns
      : this.campaigns.filter(c => c.status === this.activeFilter);

    this.rootEl.innerHTML = `
      <div class="ads-page-container">
        <!-- Header -->
        <div class="page-header flex justify-between items-center mb-6">
          <div>
            <h1 class="page-title text-2xl font-bold text-gray-900 dark:text-white">
              ${isBn ? 'স্পন্সর্ড বিজ্ঞাপন ক্যাম্পেইন' : 'Sponsored Ad Campaigns'}
            </h1>
            <p class="page-subtitle text-sm text-gray-600 dark:text-gray-400 mt-1">
              ${isBn ? 'সার্চ, ক্যাটেগরি ব্যানার ও ফিডে আপনার পণ্য প্রচার করে বিক্রি বাড়ান' : 'Boost your products across search results, category banners, and feed'}
            </p>
          </div>
          <div>
            <button id="btn-create-campaign" class="btn btn-primary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-1">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              ${isBn ? 'নতুন ক্যাম্পেইন তৈরি করুন' : 'Create Campaign'}
            </button>
          </div>
        </div>

        <!-- KPI Metrics Grid -->
        <div class="metrics-grid grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div class="metric-card p-4 rounded-lg bg-surface border border-border">
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">${isBn ? 'সক্রিয় ক্যাম্পেইন' : 'Active Ads'}</span>
            <div class="text-2xl font-bold text-primary mt-1">${activeCount}</div>
          </div>
          <div class="metric-card p-4 rounded-lg bg-surface border border-border">
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">${isBn ? 'মোট ইমপ্রেশন' : 'Impressions'}</span>
            <div class="text-2xl font-bold mt-1">${totalImpressions.toLocaleString('en-US')}</div>
          </div>
          <div class="metric-card p-4 rounded-lg bg-surface border border-border">
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">${isBn ? 'মোট ক্লিক' : 'Clicks'}</span>
            <div class="text-2xl font-bold mt-1">${totalClicks.toLocaleString('en-US')}</div>
          </div>
          <div class="metric-card p-4 rounded-lg bg-surface border border-border">
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">${isBn ? 'গড় সিটিআর (CTR)' : 'Avg. CTR'}</span>
            <div class="text-2xl font-bold text-accent mt-1">${overallCtr}%</div>
          </div>
          <div class="metric-card p-4 rounded-lg bg-surface border border-border col-span-2 md:col-span-1">
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">${isBn ? 'মোট খরচ' : 'Total Spend'}</span>
            <div class="text-2xl font-bold text-danger mt-1">৳${totalSpend.toFixed(2)}</div>
          </div>
        </div>

        <!-- Filters & Table Section -->
        <div class="card p-5 bg-surface border border-border rounded-xl">
          <div class="flex justify-between items-center border-b border-border pb-4 mb-4">
            <div class="flex gap-2 filter-tabs">
              ${['ALL', 'ACTIVE', 'PENDING_REVIEW', 'PAUSED', 'COMPLETED'].map(statusKey => `
                <button
                  class="btn btn-sm ${this.activeFilter === statusKey ? 'btn-primary' : 'btn-ghost'}"
                  data-filter="${statusKey}">
                  ${this._formatFilterLabel(statusKey, isBn)}
                </button>
              `).join('')}
            </div>
            <button id="btn-refresh" class="btn btn-sm btn-outline">
              🔄 ${isBn ? 'রিফ্রেশ' : 'Refresh'}
            </button>
          </div>

          <!-- Campaigns Table -->
          ${this.loading ? `
            <div class="p-8 text-center text-muted">${isBn ? 'লোড হচ্ছে…' : 'Loading campaigns…'}</div>
          ` : filteredCampaigns.length === 0 ? `
            <div class="empty-state p-8 text-center">
              <div class="text-4xl mb-3">📢</div>
              <h3 class="text-lg font-semibold">${isBn ? 'কোনো ক্যাম্পেইন পাওয়া যায়নি' : 'No ad campaigns found'}</h3>
              <p class="text-sm text-muted mt-1">${isBn ? 'নতুন প্রচার শুরু করতে উপরে "নতুন ক্যাম্পেইন তৈরি করুন" বাটনে চাপুন।' : 'Create your first campaign to boost product reach.'}</p>
            </div>
          ` : `
            <div class="table-responsive overflow-x-auto">
              <table class="table w-full text-left">
                <thead>
                  <tr class="border-b border-border text-xs uppercase text-muted">
                    <th class="py-3 px-4">${isBn ? 'ক্যাম্পেইন' : 'Campaign'}</th>
                    <th class="py-3 px-4">${isBn ? 'প্লেসমেন্ট' : 'Placement'}</th>
                    <th class="py-3 px-4">${isBn ? 'অবস্থা' : 'Status'}</th>
                    <th class="py-3 px-4">${isBn ? 'বাজেট ও খরচ' : 'Budget & Spend'}</th>
                    <th class="py-3 px-4">${isBn ? 'সিপিসি বিড' : 'Max Bid'}</th>
                    <th class="py-3 px-4">${isBn ? 'ফলাফল (Imp/Click)' : 'Results'}</th>
                    <th class="py-3 px-4 text-right">${isBn ? 'অ্যাকশন' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  ${filteredCampaigns.map(c => this._renderCampaignRow(c, isBn)).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;

    this._attachEvents();
  }

  _renderCampaignRow(c, isBn) {
    const totalBudget = Number(c.total_budget) || 1;
    const spent = Number(c.spent_amount) || 0;
    const todaySpent = Number(c.today_spent_amount) || 0;
    const dailyBudget = Number(c.daily_budget) || 1;
    const pct = Math.min(100, Math.round((spent / totalBudget) * 100));

    return `
      <tr class="border-b border-border hover:bg-muted/10 transition-colors">
        <td class="py-4 px-4">
          <div class="font-semibold text-gray-900 dark:text-white">${this._escapeHtml(c.title)}</div>
          <div class="text-xs text-muted font-mono mt-0.5">${c.ref}</div>
        </td>
        <td class="py-4 px-4">
          <span class="badge badge-subtle text-xs">${this._formatPlacement(c.placement, isBn)}</span>
        </td>
        <td class="py-4 px-4">
          ${this._renderStatusBadge(c.status, isBn)}
          ${c.status === 'REJECTED' && c.rejection_reason ? `
            <div class="text-xs text-danger mt-1">${this._escapeHtml(c.rejection_reason)}</div>
          ` : ''}
        </td>
        <td class="py-4 px-4">
          <div class="text-sm font-semibold">৳${spent.toFixed(2)} <span class="text-xs font-normal text-muted">/ ৳${totalBudget.toFixed(2)}</span></div>
          <div class="w-full bg-border rounded-full h-1.5 mt-1.5 overflow-hidden">
            <div class="bg-primary h-1.5 rounded-full" style="width: ${pct}%"></div>
          </div>
          <div class="text-[11px] text-muted mt-1">${isBn ? 'আজকের খরচ' : 'Today'}: ৳${todaySpent.toFixed(2)} / ৳${dailyBudget.toFixed(2)}</div>
        </td>
        <td class="py-4 px-4 font-mono text-sm">
          ৳${Number(c.bid_amount).toFixed(2)}
        </td>
        <td class="py-4 px-4 text-sm">
          <div>${Number(c.impressions_count).toLocaleString('en-US')} <span class="text-xs text-muted">${isBn ? 'ইমপ্রেশন' : 'views'}</span></div>
          <div class="text-xs text-muted">${Number(c.clicks_count).toLocaleString('en-US')} ${isBn ? 'ক্লিক' : 'clicks'} (${c.ctr_percentage || '0.00'}%)</div>
        </td>
        <td class="py-4 px-4 text-right">
          ${c.status === 'ACTIVE' ? `
            <button class="btn btn-xs btn-outline btn-pause" data-id="${c.id}">
              ⏸ ${isBn ? 'স্থগিত' : 'Pause'}
            </button>
          ` : c.status === 'PAUSED' ? `
            <button class="btn btn-xs btn-primary btn-resume" data-id="${c.id}">
              ▶ ${isBn ? 'চালু' : 'Resume'}
            </button>
          ` : '-'}
        </td>
      </tr>
    `;
  }

  _renderStatusBadge(status, isBn) {
    const statusMap = {
      ACTIVE: { text: isBn ? 'সক্রিয়' : 'Active', color: 'success' },
      PENDING_REVIEW: { text: isBn ? 'পর্যালোচনায়' : 'Under Review', color: 'warning' },
      PAUSED: { text: isBn ? 'স্থগিত' : 'Paused', color: 'neutral' },
      COMPLETED: { text: isBn ? 'সম্পন্ন' : 'Completed', color: 'info' },
      REJECTED: { text: isBn ? 'প্রত্যাখ্যাত' : 'Rejected', color: 'danger' },
    };
    const s = statusMap[status] || { text: status, color: 'neutral' };
    return `<span class="badge badge-${s.color} text-xs font-semibold">${s.text}</span>`;
  }

  _formatPlacement(placement, isBn) {
    const map = {
      SEARCH_RESULTS: isBn ? 'সার্চ ফলাফল' : 'Search Results',
      CATEGORY_BANNER: isBn ? 'ক্যাটেগরি ব্যানার' : 'Category Banner',
      FEED: isBn ? 'হোম ফিড' : 'Home Feed',
      PRODUCT_PAGE: isBn ? 'পণ্য পেজ' : 'Product Page',
    };
    return map[placement] || placement;
  }

  _formatFilterLabel(key, isBn) {
    const map = {
      ALL: isBn ? 'সব' : 'All',
      ACTIVE: isBn ? 'সক্রিয়' : 'Active',
      PENDING_REVIEW: isBn ? 'পর্যালোচনায়' : 'Pending',
      PAUSED: isBn ? 'স্থগিত' : 'Paused',
      COMPLETED: isBn ? 'সম্পন্ন' : 'Completed',
    };
    return map[key] || key;
  }

  _attachEvents() {
    // Create Campaign button
    const btnCreate = this.rootEl.querySelector('#btn-create-campaign');
    if (btnCreate) {
      btnCreate.addEventListener('click', () => this._openCreateModal());
    }

    // Filter tabs
    this.rootEl.querySelectorAll('.filter-tabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeFilter = btn.dataset.filter;
        this.render();
      });
    });

    // Refresh button
    const btnRefresh = this.rootEl.querySelector('#btn-refresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', async () => {
        await this.fetchCampaigns();
        this.render();
      });
    }

    // Pause actions
    this.rootEl.querySelectorAll('.btn-pause').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        try {
          await api.post(`/ads/campaigns/${id}/pause`);
          toast.success(getLanguage() === 'bn' ? 'ক্যাম্পেইন স্থগিত করা হয়েছে' : 'Campaign paused');
          await this.fetchCampaigns();
          this.render();
        } catch (err) {
          toast.error(err.message || 'Action failed');
        }
      });
    });

    // Resume actions
    this.rootEl.querySelectorAll('.btn-resume').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        try {
          await api.post(`/ads/campaigns/${id}/resume`);
          toast.success(getLanguage() === 'bn' ? 'ক্যাম্পেইন চালু করা হয়েছে' : 'Campaign resumed');
          await this.fetchCampaigns();
          this.render();
        } catch (err) {
          toast.error(err.message || 'Action failed');
        }
      });
    });
  }

  _openCreateModal() {
    const isBn = getLanguage() === 'bn';

    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog bg-surface border border-border rounded-xl max-w-2xl w-full p-6 my-8 shadow-2xl">
        <div class="flex justify-between items-center border-b border-border pb-3 mb-4">
          <h2 class="text-xl font-bold">${isBn ? 'নতুন বিজ্ঞাপন ক্যাম্পেইন তৈরি করুন' : 'Create New Ad Campaign'}</h2>
          <button type="button" class="btn-close text-muted hover:text-white text-xl font-bold">×</button>
        </div>

        <form id="form-create-ad" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'ক্যাম্পেইনের নাম' : 'Campaign Title'} *</label>
            <input type="text" name="title" required placeholder="${isBn ? 'যেমন: ঈদ স্পেশাল জামদানি অফার' : 'e.g. Eid Handloom Jamdani Promotion'}" class="input w-full" />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'উদ্দেশ্য' : 'Objective'}</label>
              <select name="objective" class="select w-full">
                <option value="TRAFFIC">${isBn ? 'ট্রাফিক বৃদ্ধি (Traffic)' : 'Drive Traffic'}</option>
                <option value="SALES">${isBn ? 'বিক্রি বৃদ্ধি (Sales)' : 'Increase Sales'}</option>
                <option value="AWARENESS">${isBn ? 'ব্র্যান্ড পরিচিতি (Awareness)' : 'Brand Awareness'}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'প্লেসমেন্ট' : 'Placement'}</label>
              <select name="placement" class="select w-full">
                <option value="SEARCH_RESULTS">${isBn ? 'সার্চ ফলাফল (Search Results)' : 'Search Results'}</option>
                <option value="CATEGORY_BANNER">${isBn ? 'ক্যাটেগরি ব্যানার (Category Banner)' : 'Category Banner'}</option>
                <option value="FEED">${isBn ? 'হোম ফিড (Home Feed)' : 'Home Feed'}</option>
                <option value="PRODUCT_PAGE">${isBn ? 'পণ্য পেজ (Product Page)' : 'Product Page'}</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-4">
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'দৈনিক বাজেট (৳)' : 'Daily Budget (৳)'} *</label>
              <input type="number" name="daily_budget" min="10" step="10" value="50" required class="input w-full font-mono" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'মোট বাজেট (৳)' : 'Total Budget (৳)'} *</label>
              <input type="number" name="total_budget" min="50" step="50" value="500" required class="input w-full font-mono" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'সর্বোচ্চ সিপিসি বিড (৳)' : 'Max CPC Bid (৳)'} *</label>
              <input type="number" name="bid_amount" min="1" step="0.5" value="2.50" required class="input w-full font-mono" />
            </div>
          </div>

          <!-- Targeting -->
          <div class="p-4 bg-muted/10 rounded-lg border border-border space-y-3">
            <h4 class="text-xs font-bold uppercase text-primary">${isBn ? 'টার্গেটিং (Targeting)' : 'Targeting'}</h4>
            <div>
              <label class="block text-xs text-muted mb-1">${isBn ? 'টার্গেটেড কিওয়ার্ডসমূহ (কমা দিয়ে আলাদা করুন)' : 'Target Keywords (comma-separated)'}</label>
              <input type="text" name="keywords" placeholder="${isBn ? 'শাড়ি, জামদানি, পোশাক, লাল' : 'saree, jamdani, clothing, red'}" class="input w-full" />
            </div>
          </div>

          <!-- Creative Builder -->
          <div class="p-4 bg-muted/10 rounded-lg border border-border space-y-3">
            <h4 class="text-xs font-bold uppercase text-primary">${isBn ? 'ক্রিয়েটিভ ও ব্যানার' : 'Creative & Content'}</h4>
            <div>
              <label class="block text-xs text-muted mb-1">${isBn ? 'বিজ্ঞাপনের হেডলাইন' : 'Ad Headline'} *</label>
              <input type="text" name="headline" required placeholder="${isBn ? 'খাঁটি তাঁতের ঢাকাই জামদানি — বিশেষ ২০% ছাড়' : 'Authentic Handloom Jamdani — 20% Off'}" class="input w-full" />
            </div>
            <div>
              <label class="block text-xs text-muted mb-1">${isBn ? 'বিবরণ' : 'Description'}</label>
              <textarea name="description" rows="2" placeholder="${isBn ? 'সীমিত সময়ের সেরা ঐতিহ্যবাহী পোশাক কালেকশন' : 'Premium hand-woven collection ready for fast delivery'}" class="textarea w-full"></textarea>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs text-muted mb-1">${isBn ? 'ব্যানার ছবির লিংক (ঐচ্ছিক)' : 'Banner Image URL'}</label>
                <input type="url" name="banner_image_url" placeholder="https://..." class="input w-full" />
              </div>
              <div>
                <label class="block text-xs text-muted mb-1">${isBn ? 'কল-টু-অ্যাকশন (CTA)' : 'Call To Action'}</label>
                <select name="call_to_action" class="select w-full">
                  <option value="SHOP_NOW">${isBn ? 'এখনই কিনুন (Shop Now)' : 'Shop Now'}</option>
                  <option value="LEARN_MORE">${isBn ? 'বিস্তারিত দেখুন (Learn More)' : 'Learn More'}</option>
                  <option value="GET_OFFER">${isBn ? 'অফার নিন (Get Offer)' : 'Get Offer'}</option>
                </select>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-border">
            <button type="button" class="btn btn-outline btn-cancel">${isBn ? 'বাতিল' : 'Cancel'}</button>
            <button type="submit" class="btn btn-primary">${isBn ? 'ক্যাম্পেইন প্রকাশ করুন' : 'Publish Campaign'}</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    const closeModal = () => {
      if (document.body.contains(modalBackdrop)) {
        document.body.removeChild(modalBackdrop);
      }
    };

    modalBackdrop.querySelector('.btn-close').addEventListener('click', closeModal);
    modalBackdrop.querySelector('.btn-cancel').addEventListener('click', closeModal);

    const form = modalBackdrop.querySelector('#form-create-ad');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);

      const rawKeywords = fd.get('keywords') || '';
      const keywords = rawKeywords.split(',').map(k => k.trim()).filter(Boolean);

      const payload = {
        title: fd.get('title'),
        objective: fd.get('objective'),
        placement: fd.get('placement'),
        daily_budget: parseFloat(fd.get('daily_budget')),
        total_budget: parseFloat(fd.get('total_budget')),
        bid_amount: parseFloat(fd.get('bid_amount')),
        targeting: {
          keywords,
          categories: [],
          districts: [],
        },
        creative: {
          headline: fd.get('headline'),
          description: fd.get('description'),
          banner_image_url: fd.get('banner_image_url') || null,
          call_to_action: fd.get('call_to_action'),
        },
      };

      try {
        await api.post('/ads/campaigns', payload);
        toast.success(isBn ? 'বিজ্ঞাপন ক্যাম্পেইন সফলভাবে তৈরি হয়েছে!' : 'Campaign created successfully!');
        closeModal();
        await this.fetchCampaigns();
        this.render();
      } catch (err) {
        toast.error(err.message || 'Failed to create campaign');
      }
    });
  }

  _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
