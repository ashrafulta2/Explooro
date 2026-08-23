/**
 * CampaignManagerPage.js — Admin Growth Campaign & Promotion Manager (Prompt 9.2).
 *
 * Provides:
 * - Tab 1: Flash Sales Oversight (Active/Scheduled deals, live stock counters, countdown timer, deal scheduler, emergency stop).
 * - Tab 2: Coupons & Vouchers Catalog (Spend vs budget cap tracking, cost attribution, multi-dimensional scope rules, creation modal).
 * - Real-time spend tracking and bilingual English / Bengali localization.
 */

import { api } from '../../core/api.js';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog.js';

export default class CampaignManagerPage {
  constructor() {
    this.activeTab = 'flash_sales'; // 'flash_sales' | 'coupons'
    this.flashSales = [];
    this.coupons = [];
    this.loading = true;
    this.rootEl = null;
    this.unsubscribeLang = null;
    this.countdownTimer = null;
  }

  async mount(outlet) {
    this.rootEl = outlet;
    this.unsubscribeLang = subscribeLang(() => this.render());
    await this.fetchData();
    this.render();
    this._startLiveCountdown();
  }

  unmount() {
    if (this.unsubscribeLang) {
      this.unsubscribeLang();
      this.unsubscribeLang = null;
    }
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  async fetchData() {
    this.loading = true;
    try {
      const [fsRes, cRes] = await Promise.all([
        api.get('/admin/growth/campaigns/flash-sales').catch(() => ({ flash_sales: [] })),
        api.get('/admin/growth/coupons').catch(() => ({ coupons: [] })),
      ]);
      this.flashSales = fsRes.flash_sales || [];
      this.coupons = cRes.coupons || [];
    } catch (err) {
      toast.error(err.message || 'Failed to load promotion campaigns');
    } finally {
      this.loading = false;
    }
  }

  _startLiveCountdown() {
    this.countdownTimer = setInterval(() => {
      const liveTimerEls = this.rootEl?.querySelectorAll('.live-countdown');
      if (!liveTimerEls || liveTimerEls.length === 0) return;

      const now = Date.now();
      liveTimerEls.forEach(el => {
        const targetMs = Number(el.dataset.targetMs);
        const diff = Math.max(0, targetMs - now);
        el.textContent = this._formatDuration(diff);
      });
    }, 1000);
  }

  render() {
    if (!this.rootEl) return;
    const lang = getLanguage();
    const isBn = lang === 'bn';

    this.rootEl.innerHTML = `
      <div class="campaign-manager-container p-6 space-y-6 max-w-7xl mx-auto">
        <!-- Page Header -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              ${isBn ? 'ক্যাম্পেইন ও প্রমোশন ম্যানেজার' : 'Campaign & Promotion Manager'}
            </h1>
            <p class="text-sm text-muted mt-1">
              ${isBn ? 'ফ্ল্যাশ সেল, কুপন ভাউচার ও ডিসকাউন্ট বাজেট নিয়ন্ত্রণ করুন' : 'Manage flash sales, coupon vouchers, budget caps, and emergency stops'}
            </p>
          </div>
          <div class="flex gap-2">
            <button id="btn-create-action" class="btn btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-1">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              ${this.activeTab === 'flash_sales'
                ? (isBn ? 'নতুন ফ্ল্যাশ সেল চালু করুন' : 'Schedule Flash Sale')
                : (isBn ? 'নতুন কুপন তৈরি করুন' : 'Create Coupon')}
            </button>
            <button id="btn-refresh-campaigns" class="btn btn-outline">
              🔄 ${isBn ? 'রিফ্রেশ' : 'Refresh'}
            </button>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="flex border-b border-border gap-4">
          <button
            class="tab-btn pb-3 px-2 font-semibold text-sm transition-colors border-b-2 ${this.activeTab === 'flash_sales' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-white'}"
            data-tab="flash_sales">
            ⚡ ${isBn ? 'ফ্ল্যাশ সেল ক্যাম্পেইন' : 'Flash Sale Campaigns'} (${this.flashSales.length})
          </button>
          <button
            class="tab-btn pb-3 px-2 font-semibold text-sm transition-colors border-b-2 ${this.activeTab === 'coupons' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-white'}"
            data-tab="coupons">
            🎟️ ${isBn ? 'কুপন ও ভাউচার' : 'Coupons & Vouchers'} (${this.coupons.length})
          </button>
        </div>

        <!-- Main Content Pane -->
        ${this.loading ? `
          <div class="p-12 text-center text-muted">${isBn ? 'লোড হচ্ছে…' : 'Loading campaign data…'}</div>
        ` : this.activeTab === 'flash_sales'
          ? this._renderFlashSalesTab(isBn)
          : this._renderCouponsTab(isBn)}
      </div>
    `;

    this._attachEvents();
  }

  _renderFlashSalesTab(isBn) {
    const activeCount = this.flashSales.filter(s => s.status === 'ACTIVE').length;
    const totalAllocated = this.flashSales.reduce((sum, s) => sum + (Number(s.allocated_qty) || 0), 0);
    const totalSold = this.flashSales.reduce((sum, s) => sum + (Number(s.sold_qty) || 0), 0);
    const clearanceRate = totalAllocated > 0 ? Math.round((totalSold / totalAllocated) * 100) : 0;

    return `
      <!-- KPI Metrics -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="p-4 bg-surface border border-border rounded-xl">
          <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'সক্রিয় ফ্ল্যাশ সেল' : 'Active Flash Deals'}</span>
          <div class="text-2xl font-bold text-accent mt-1">${activeCount}</div>
        </div>
        <div class="p-4 bg-surface border border-border rounded-xl">
          <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'বরাদ্দকৃত স্টক' : 'Allocated Stock'}</span>
          <div class="text-2xl font-bold mt-1">${totalAllocated.toLocaleString('en-US')}</div>
        </div>
        <div class="p-4 bg-surface border border-border rounded-xl">
          <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'বিক্রি হওয়া ইউনিট' : 'Units Claimed'}</span>
          <div class="text-2xl font-bold text-success mt-1">${totalSold.toLocaleString('en-US')}</div>
        </div>
        <div class="p-4 bg-surface border border-border rounded-xl">
          <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'স্টক ক্লিয়ারেন্স হার' : 'Clearance Rate'}</span>
          <div class="text-2xl font-bold text-primary mt-1">${clearanceRate}%</div>
        </div>
      </div>

      <!-- Flash Sales Table -->
      <div class="card p-5 bg-surface border border-border rounded-xl">
        ${this.flashSales.length === 0 ? `
          <div class="p-8 text-center text-muted">
            <div class="text-4xl mb-2">⚡</div>
            <p>${isBn ? 'কোনো ফ্ল্যাশ সেল পাওয়া যায়নি।' : 'No flash sales found. Click schedule to create one.'}</p>
          </div>
        ` : `
          <div class="overflow-x-auto">
            <table class="table w-full text-left text-sm">
              <thead>
                <tr class="border-b border-border text-xs uppercase text-muted">
                  <th class="py-3 px-4">${isBn ? 'ডিল ও রেফারেন্স' : 'Deal & Ref'}</th>
                  <th class="py-3 px-4">${isBn ? 'পণ্য' : 'Product'}</th>
                  <th class="py-3 px-4">${isBn ? 'মূল্য (মূল ➔ অফার)' : 'Price (Old ➔ New)'}</th>
                  <th class="py-3 px-4">${isBn ? 'স্টক অগ্রগতি' : 'Stock Claimed'}</th>
                  <th class="py-3 px-4">${isBn ? 'কাউন্টডাউন' : 'Timer'}</th>
                  <th class="py-3 px-4">${isBn ? 'অবস্থা' : 'Status'}</th>
                  <th class="py-3 px-4 text-right">${isBn ? 'অ্যাকশন' : 'Action'}</th>
                </tr>
              </thead>
              <tbody>
                ${this.flashSales.map(fs => this._renderFlashSaleRow(fs, isBn)).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  _renderFlashSaleRow(fs, isBn) {
    const allocated = Number(fs.allocated_qty) || 1;
    const sold = Number(fs.sold_qty) || 0;
    const pct = Math.min(100, Math.round((sold / allocated) * 100));
    const now = Date.now();
    const endsMs = new Date(fs.ends_at).getTime();
    const startsMs = new Date(fs.starts_at).getTime();
    const isLive = startsMs <= now && now <= endsMs;
    const targetMs = isLive ? endsMs : startsMs;

    return `
      <tr class="border-b border-border hover:bg-muted/5 transition-colors">
        <td class="py-4 px-4">
          <div class="font-semibold">${this._escapeHtml(fs.title)}</div>
          <div class="text-xs text-muted font-mono">${fs.ref}</div>
        </td>
        <td class="py-4 px-4">
          <div class="font-medium">${this._escapeHtml(fs.product_title_en || `Product #${fs.product_id}`)}</div>
        </td>
        <td class="py-4 px-4 font-mono">
          <span class="line-through text-muted text-xs">৳${Number(fs.original_price).toFixed(2)}</span>
          <span class="text-success font-bold ml-1">৳${Number(fs.discount_price).toFixed(2)}</span>
        </td>
        <td class="py-4 px-4">
          <div class="flex justify-between text-xs mb-1">
            <span>${sold} / ${allocated}</span>
            <span class="font-bold">${pct}%</span>
          </div>
          <div class="w-full bg-border rounded-full h-1.5 overflow-hidden">
            <div class="bg-primary h-1.5 rounded-full" style="width: ${pct}%"></div>
          </div>
        </td>
        <td class="py-4 px-4 font-mono text-xs">
          ${fs.status === 'CANCELLED' ? `<span class="text-danger">Cancelled</span>` : `
            <span class="text-muted">${isLive ? (isBn ? 'শেষ হবে:' : 'Ends:') : (isBn ? 'শুরু হবে:' : 'Starts:')}</span>
            <div class="live-countdown text-accent font-bold" data-target-ms="${targetMs}">
              ${this._formatDuration(Math.max(0, targetMs - now))}
            </div>
          `}
        </td>
        <td class="py-4 px-4">
          ${this._renderStatusBadge(fs.status, isBn)}
        </td>
        <td class="py-4 px-4 text-right">
          ${fs.status === 'ACTIVE' || fs.status === 'SCHEDULED' ? `
            <button
              class="btn btn-xs btn-danger btn-emergency-stop"
              data-id="${fs.id}"
              data-title="${this._escapeHtml(fs.title)}">
              🚨 ${isBn ? 'জরুরি বন্ধ' : 'Emergency Stop'}
            </button>
          ` : '-'}
        </td>
      </tr>
    `;
  }

  _renderCouponsTab(isBn) {
    const activeCoupons = this.coupons.filter(c => c.is_active).length;
    const totalBudget = this.coupons.reduce((sum, c) => sum + (Number(c.budget_cap) || 0), 0);
    const totalUsed = this.coupons.reduce((sum, c) => sum + (Number(c.budget_used) || 0), 0);
    const totalRedemptions = this.coupons.reduce((sum, c) => sum + (Number(c.usage_count) || 0), 0);

    return `
      <!-- KPI Metrics -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="p-4 bg-surface border border-border rounded-xl">
          <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'সক্রিয় কুপন' : 'Active Coupons'}</span>
          <div class="text-2xl font-bold text-accent mt-1">${activeCoupons}</div>
        </div>
        <div class="p-4 bg-surface border border-border rounded-xl">
          <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'মোট বাজেট বরাদ্দ' : 'Total Budget Allocated'}</span>
          <div class="text-2xl font-bold mt-1">৳${totalBudget.toLocaleString('en-US')}</div>
        </div>
        <div class="p-4 bg-surface border border-border rounded-xl">
          <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'ব্যবহৃত বাজেট' : 'Budget Spent'}</span>
          <div class="text-2xl font-bold text-danger mt-1">৳${totalUsed.toFixed(2)}</div>
        </div>
        <div class="p-4 bg-surface border border-border rounded-xl">
          <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'মোট রিডেম্পশন' : 'Total Redemptions'}</span>
          <div class="text-2xl font-bold text-success mt-1">${totalRedemptions.toLocaleString('en-US')}</div>
        </div>
      </div>

      <!-- Coupons Table -->
      <div class="card p-5 bg-surface border border-border rounded-xl">
        ${this.coupons.length === 0 ? `
          <div class="p-8 text-center text-muted">
            <div class="text-4xl mb-2">🎟️</div>
            <p>${isBn ? 'কোনো কুপন পাওয়া যায়নি।' : 'No coupons found. Click Create Coupon to launch one.'}</p>
          </div>
        ` : `
          <div class="overflow-x-auto">
            <table class="table w-full text-left text-sm">
              <thead>
                <tr class="border-b border-border text-xs uppercase text-muted">
                  <th class="py-3 px-4">${isBn ? 'কোড' : 'Code'}</th>
                  <th class="py-3 px-4">${isBn ? 'ছাড়ের ধরণ ও মান' : 'Discount'}</th>
                  <th class="py-3 px-4">${isBn ? 'খরচ বহনকারী' : 'Funded By'}</th>
                  <th class="py-3 px-4">${isBn ? 'বাজেট ও খরচ' : 'Budget Cap & Spent'}</th>
                  <th class="py-3 px-4">${isBn ? 'স্কোপ ও নিয়ম' : 'Scope & Constraints'}</th>
                  <th class="py-3 px-4">${isBn ? 'মেয়াদ' : 'Validity'}</th>
                  <th class="py-3 px-4 text-right">${isBn ? 'সক্রিয়?' : 'Active?'}</th>
                </tr>
              </thead>
              <tbody>
                ${this.coupons.map(c => this._renderCouponRow(c, isBn)).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  _renderCouponRow(c, isBn) {
    const budgetCap = c.budget_cap != null ? Number(c.budget_cap) : null;
    const budgetUsed = Number(c.budget_used) || 0;
    const pct = budgetCap != null && budgetCap > 0 ? Math.min(100, Math.round((budgetUsed / budgetCap) * 100)) : 0;

    return `
      <tr class="border-b border-border hover:bg-muted/5 transition-colors">
        <td class="py-4 px-4">
          <span class="font-mono font-bold text-primary bg-primary/10 px-2 py-1 rounded text-xs">${c.code}</span>
          ${c.first_order_only ? `<span class="badge badge-warning text-[10px] ml-1">1st Order</span>` : ''}
        </td>
        <td class="py-4 px-4">
          <div class="font-semibold">${this._formatDiscount(c, isBn)}</div>
          ${c.max_discount ? `<div class="text-xs text-muted">${isBn ? 'সর্বোচ্চ ছাড়' : 'Max'}: ৳${Number(c.max_discount).toFixed(2)}</div>` : ''}
        </td>
        <td class="py-4 px-4">
          <span class="badge badge-${c.funded_by === 'PLATFORM' ? 'info' : 'secondary'} text-xs font-semibold">
            ${c.funded_by}
          </span>
        </td>
        <td class="py-4 px-4">
          <div class="text-xs font-mono font-semibold">৳${budgetUsed.toFixed(2)} / ${budgetCap != null ? `৳${budgetCap.toFixed(2)}` : '∞'}</div>
          ${budgetCap != null ? `
            <div class="w-full bg-border rounded-full h-1.5 mt-1 overflow-hidden">
              <div class="bg-${pct >= 90 ? 'danger' : 'primary'} h-1.5 rounded-full" style="width: ${pct}%"></div>
            </div>
          ` : ''}
          <div class="text-[11px] text-muted mt-0.5">${c.usage_count} ${isBn ? 'বার ব্যবহৃত' : 'uses'}</div>
        </td>
        <td class="py-4 px-4 text-xs">
          <div><strong class="text-muted">Scope:</strong> ${c.scope_type} ${c.scope_ref ? `(#${c.scope_ref})` : ''}</div>
          <div><strong class="text-muted">Min Spend:</strong> ৳${Number(c.min_spend).toFixed(2)}</div>
        </td>
        <td class="py-4 px-4 text-xs text-muted">
          <div>${new Date(c.starts_at).toLocaleDateString()} ➔</div>
          <div>${new Date(c.expires_at).toLocaleDateString()}</div>
        </td>
        <td class="py-4 px-4 text-right">
          <input
            type="checkbox"
            class="toggle-coupon-active checkbox"
            data-id="${c.id}"
            ${c.is_active ? 'checked' : ''} />
        </td>
      </tr>
    `;
  }

  _formatDiscount(c, isBn) {
    if (c.discount_type === 'PERCENT') return `${Number(c.discount_value)}% ${isBn ? 'ছাড়' : 'OFF'}`;
    if (c.discount_type === 'FIXED') return `৳${Number(c.discount_value).toFixed(2)} ${isBn ? 'ছাড়' : 'OFF'}`;
    if (c.discount_type === 'FREE_SHIPPING') return isBn ? 'ফ্রি শিপিং' : 'Free Shipping';
    if (c.discount_type === 'BUY_X_GET_Y') return isBn ? 'বাই-এক্স-গেট-ওয়াই' : 'Buy X Get Y Free';
    return `${c.discount_value}`;
  }

  _renderStatusBadge(status, isBn) {
    const map = {
      ACTIVE: { text: isBn ? 'লাইভ' : 'Live', color: 'success' },
      SCHEDULED: { text: isBn ? 'নির্ধারিত' : 'Scheduled', color: 'warning' },
      COMPLETED: { text: isBn ? 'সম্পন্ন' : 'Completed', color: 'neutral' },
      CANCELLED: { text: isBn ? 'বন্ধ' : 'Stopped', color: 'danger' },
    };
    const s = map[status] || { text: status, color: 'neutral' };
    return `<span class="badge badge-${s.color} text-xs font-semibold">${s.text}</span>`;
  }

  _formatDuration(ms) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor((ms / 1000) % 60);
    const m = Math.floor((ms / (1000 * 60)) % 60);
    const h = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const d = Math.floor(ms / (1000 * 60 * 60 * 24));

    const pad = (n) => String(n).padStart(2, '0');
    if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  _attachEvents() {
    // Tab switching
    this.rootEl.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab;
        this.render();
      });
    });

    // Refresh button
    const btnRefresh = this.rootEl.querySelector('#btn-refresh-campaigns');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', async () => {
        await this.fetchData();
        this.render();
      });
    }

    // Create Action Button
    const btnCreate = this.rootEl.querySelector('#btn-create-action');
    if (btnCreate) {
      btnCreate.addEventListener('click', () => {
        if (this.activeTab === 'flash_sales') {
          this._openCreateFlashSaleModal();
        } else {
          this._openCreateCouponModal();
        }
      });
    }

    // Emergency Stop
    this.rootEl.querySelectorAll('.btn-emergency-stop').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const title = btn.dataset.title;
        const isBn = getLanguage() === 'bn';

        const confirmed = await confirmDialog({
          title: isBn ? `জরুরি বন্ধ: ${title}` : `Emergency Stop: ${title}`,
          description: isBn
            ? 'আপনি কি নিশ্চিত যে এই চলমান ফ্ল্যাশ সেলটি সঙ্গে সঙ্গে বন্ধ করতে চান? এটি সাথে সাথে সব ডিসকাউন্ট প্রত্যাহার করবে।'
            : 'Are you sure you want to immediately halt this flash sale campaign? All promotions on this deal will stop instantly.',
          confirmLabel: isBn ? 'হ্যাঁ, এখনই বন্ধ করুন' : 'Yes, Stop Immediately',
          danger: true,
        });

        if (confirmed) {
          try {
            await api.post(`/admin/growth/campaigns/flash-sales/${id}/emergency-stop`, {
              reason: 'Admin triggered emergency stop from campaign manager',
            });
            toast.success(isBn ? 'ফ্ল্যাশ সেল সফলভাবে বন্ধ করা হয়েছে।' : 'Flash sale stopped successfully.');
            await this.fetchData();
            this.render();
          } catch (err) {
            toast.error(err.message || 'Action failed');
          }
        }
      });
    });

    // Toggle coupon active state
    this.rootEl.querySelectorAll('.toggle-coupon-active').forEach(input => {
      input.addEventListener('change', async () => {
        const id = input.dataset.id;
        const isActive = input.checked;
        try {
          await api.post(`/admin/growth/coupons/${id}/toggle`, { is_active: isActive });
          toast.success(isActive ? 'Coupon activated' : 'Coupon deactivated');
        } catch (err) {
          toast.error(err.message || 'Failed to update coupon state');
          input.checked = !isActive;
        }
      });
    });
  }

  _openCreateFlashSaleModal() {
    const isBn = getLanguage() === 'bn';
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog bg-surface border border-border rounded-xl max-w-xl w-full p-6 my-8 shadow-2xl">
        <div class="flex justify-between items-center border-b border-border pb-3 mb-4">
          <h2 class="text-xl font-bold">${isBn ? 'নতুন ফ্ল্যাশ সেল তৈরি করুন' : 'Schedule New Flash Sale'}</h2>
          <button type="button" class="btn-close text-muted hover:text-white text-xl font-bold">×</button>
        </div>

        <form id="form-create-flash-sale" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'ক্যাম্পেইনের শিরোনাম' : 'Deal Title'} *</label>
            <input type="text" name="title" required placeholder="e.g. Eid Mega Flash Sale" class="input w-full" />
          </div>

          <div>
            <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'পণ্য আইডি (Product ID)' : 'Product ID'} *</label>
            <input type="number" name="product_id" required placeholder="1" class="input w-full font-mono" />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'ফ্ল্যাশ সেল মূল্য (৳)' : 'Flash Sale Price (৳)'} *</label>
              <input type="number" name="discount_price" min="1" step="0.5" required placeholder="990" class="input w-full font-mono" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'বরাদ্দকৃত স্টক পরিমাণ' : 'Allocated Stock Qty'} *</label>
              <input type="number" name="allocated_qty" min="1" required value="20" class="input w-full font-mono" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'শুরুর সময়' : 'Starts At'} *</label>
              <input type="datetime-local" name="starts_at" required class="input w-full text-xs" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'শেষের সময়' : 'Ends At'} *</label>
              <input type="datetime-local" name="ends_at" required class="input w-full text-xs" />
            </div>
          </div>

          <div>
            <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'প্রতি ব্যবহারকারীর ক্রয়ের সীমা' : 'Per User Purchase Limit'}</label>
            <input type="number" name="per_user_limit" min="1" value="1" class="input w-full font-mono" />
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-border">
            <button type="button" class="btn btn-outline btn-cancel">${isBn ? 'বাতিল' : 'Cancel'}</button>
            <button type="submit" class="btn btn-primary">${isBn ? 'ফ্ল্যাশ সেল প্রকাশ করুন' : 'Publish Flash Sale'}</button>
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

    const form = modalBackdrop.querySelector('#form-create-flash-sale');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);

      const payload = {
        title: fd.get('title'),
        product_id: parseInt(fd.get('product_id'), 10),
        discount_price: parseFloat(fd.get('discount_price')),
        allocated_qty: parseInt(fd.get('allocated_qty'), 10),
        per_user_limit: parseInt(fd.get('per_user_limit') || 1, 10),
        starts_at: new Date(fd.get('starts_at')).toISOString(),
        ends_at: new Date(fd.get('ends_at')).toISOString(),
      };

      try {
        await api.post('/admin/growth/campaigns/flash-sales', payload);
        toast.success(isBn ? 'ফ্ল্যাশ সেল সফলভাবে নির্ধারিত হয়েছে!' : 'Flash sale scheduled successfully!');
        closeModal();
        await this.fetchData();
        this.render();
      } catch (err) {
        toast.error(err.message || 'Failed to create flash sale');
      }
    });
  }

  _openCreateCouponModal() {
    const isBn = getLanguage() === 'bn';
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog bg-surface border border-border rounded-xl max-w-xl w-full p-6 my-8 shadow-2xl">
        <div class="flex justify-between items-center border-b border-border pb-3 mb-4">
          <h2 class="text-xl font-bold">${isBn ? 'নতুন কুপন কোড তৈরি করুন' : 'Create New Coupon Voucher'}</h2>
          <button type="button" class="btn-close text-muted hover:text-white text-xl font-bold">×</button>
        </div>

        <form id="form-create-coupon" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'কুপন কোড' : 'Coupon Code'} *</label>
            <input type="text" name="code" required placeholder="e.g. EID2026" class="input w-full uppercase font-mono font-bold" />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'ছাড়ের ধরণ' : 'Discount Type'}</label>
              <select name="discount_type" class="select w-full">
                <option value="PERCENT">${isBn ? 'শতাংশ ছাড় (Percent)' : 'Percentage (%)'}</option>
                <option value="FIXED">${isBn ? 'নির্দিষ্ট টাকা ছাড় (Fixed BDT)' : 'Fixed Amount (৳)'}</option>
                <option value="FREE_SHIPPING">${isBn ? 'ফ্রি শিপিং (Free Shipping)' : 'Free Shipping'}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'ছাড়ের মান' : 'Discount Value'} *</label>
              <input type="number" name="discount_value" min="1" step="0.5" required placeholder="10" class="input w-full font-mono" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'খরচ বহনকারী (Cost Attribution)' : 'Funded By'} *</label>
              <select name="funded_by" class="select w-full">
                <option value="PLATFORM">${isBn ? 'প্ল্যাটফর্ম (Platform Treasury)' : 'Platform'}</option>
                <option value="SUPPLIER">${isBn ? 'সরবরাহকারী (Supplier Margin)' : 'Supplier'}</option>
                <option value="SALER">${isBn ? 'সেলার (Saler Commission)' : 'Saler'}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'বাজেট ক্যাপ (৳)' : 'Budget Cap (৳)'}</label>
              <input type="number" name="budget_cap" min="100" placeholder="10000" class="input w-full font-mono" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'সর্বনিম্ন খরচ (Min Spend ৳)' : 'Min Spend (৳)'}</label>
              <input type="number" name="min_spend" min="0" value="500" class="input w-full font-mono" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-muted uppercase mb-1">${isBn ? 'সর্বোচ্চ ছাড় (Max Discount ৳)' : 'Max Discount (৳)'}</label>
              <input type="number" name="max_discount" min="1" placeholder="500" class="input w-full font-mono" />
            </div>
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-border">
            <button type="button" class="btn btn-outline btn-cancel">${isBn ? 'বাতিল' : 'Cancel'}</button>
            <button type="submit" class="btn btn-primary">${isBn ? 'কুপন তৈরি করুন' : 'Create Coupon'}</button>
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

    const form = modalBackdrop.querySelector('#form-create-coupon');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);

      const payload = {
        code: fd.get('code'),
        discount_type: fd.get('discount_type'),
        discount_value: parseFloat(fd.get('discount_value')),
        funded_by: fd.get('funded_by'),
        budget_cap: fd.get('budget_cap') ? parseFloat(fd.get('budget_cap')) : null,
        min_spend: parseFloat(fd.get('min_spend') || 0),
        max_discount: fd.get('max_discount') ? parseFloat(fd.get('max_discount')) : null,
        scope_type: 'PLATFORM',
      };

      try {
        await api.post('/promotions/coupons', payload);
        toast.success(isBn ? 'কুপন সফলভাবে তৈরি হয়েছে!' : 'Coupon created successfully!');
        closeModal();
        await this.fetchData();
        this.render();
      } catch (err) {
        toast.error(err.message || 'Failed to create coupon');
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
