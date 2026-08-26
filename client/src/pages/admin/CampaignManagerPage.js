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
import { confirmDialog } from '../../components/ui/ConfirmDialog.js';

export class CampaignManagerPage {
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
      this.flashSales = fsRes.data?.flash_sales || fsRes.flash_sales || [];
      this.coupons = cRes.data?.coupons || cRes.coupons || [];
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
      liveTimerEls.forEach((el) => {
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
      <div class="campaign-manager-container" style="
        max-width: 1280px;
        margin: 0 auto;
        padding: 24px 20px 48px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        color: var(--text-primary, #0f172a);
        background: var(--surface-0, transparent);
        font-family: inherit;
      ">
        <!-- Page Header -->
        <div style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 20px;
          border-bottom: 1px solid var(--border-subtle, #e2e8f0);
          flex-wrap: wrap;
          gap: 16px;
        ">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 26px;">⚡</span>
              <h1 style="font-size: 22px; font-weight: 800; margin: 0; color: var(--text-primary, #0f172a); letter-spacing: -0.02em;">
                ${isBn ? 'ক্যাম্পেইন ও প্রমোশন ম্যানেজার' : 'Campaign & Promotion Manager'}
              </h1>
            </div>
            <p style="font-size: 13px; color: var(--text-muted, #64748b); margin: 4px 0 0 0;">
              ${isBn ? 'ফ্ল্যাশ সেল, কুপন ভাউচার ও ডিসকাউন্ট বাজেট নিয়ন্ত্রণ করুন' : 'Manage flash sales, coupon vouchers, budget caps, and emergency stops'}
            </p>
          </div>

          <div style="display: flex; align-items: center; gap: 10px;">
            <button id="btn-create-action" style="
              padding: 8px 18px;
              font-size: 12px;
              font-weight: 700;
              border-radius: var(--radius-md, 8px);
              border: none;
              background: var(--brand, #4f46e5);
              color: #ffffff;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 6px;
              box-shadow: var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05));
            ">
              + ${this.activeTab === 'flash_sales'
                ? (isBn ? 'নতুন ফ্ল্যাশ সেল চালু করুন' : 'Schedule Flash Sale')
                : (isBn ? 'নতুন কুপন তৈরি করুন' : 'Create Coupon')}
            </button>
            <button id="btn-refresh-campaigns" style="
              padding: 8px 16px;
              font-size: 12px;
              font-weight: 600;
              border-radius: var(--radius-md, 8px);
              border: 1px solid var(--border-subtle, #e2e8f0);
              background: var(--surface-1, #ffffff);
              color: var(--text-primary, #0f172a);
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 6px;
              box-shadow: var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05));
            ">
              🔄 ${isBn ? 'রিফ্রেশ' : 'Refresh'}
            </button>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div style="
          background: var(--surface-1, #ffffff);
          border: 1px solid var(--border-subtle, #e2e8f0);
          border-radius: var(--radius-lg, 12px);
          padding: 8px 12px;
          display: flex;
          gap: 8px;
          box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));
        ">
          <button
            class="tab-btn"
            data-tab="flash_sales"
            style="
              padding: 6px 16px;
              font-size: 12px;
              font-weight: 700;
              border-radius: var(--radius-md, 8px);
              border: 1px solid ${this.activeTab === 'flash_sales' ? 'var(--brand, #4f46e5)' : 'transparent'};
              background: ${this.activeTab === 'flash_sales' ? 'var(--brand, #4f46e5)' : 'transparent'};
              color: ${this.activeTab === 'flash_sales' ? 'var(--brand-contrast, #ffffff)' : 'var(--text-secondary, #475569)'};
              cursor: pointer;
              transition: all 0.15s ease;
            ">
            ⚡ ${isBn ? 'ফ্ল্যাশ সেল ক্যাম্পেইন' : 'Flash Sale Campaigns'} (${this.flashSales.length})
          </button>
          <button
            class="tab-btn"
            data-tab="coupons"
            style="
              padding: 6px 16px;
              font-size: 12px;
              font-weight: 700;
              border-radius: var(--radius-md, 8px);
              border: 1px solid ${this.activeTab === 'coupons' ? 'var(--brand, #4f46e5)' : 'transparent'};
              background: ${this.activeTab === 'coupons' ? 'var(--brand, #4f46e5)' : 'transparent'};
              color: ${this.activeTab === 'coupons' ? 'var(--brand-contrast, #ffffff)' : 'var(--text-secondary, #475569)'};
              cursor: pointer;
              transition: all 0.15s ease;
            ">
            🎟️ ${isBn ? 'কুপন ও ভাউচার' : 'Coupons & Vouchers'} (${this.coupons.length})
          </button>
        </div>

        <!-- Main Content Pane -->
        ${this.loading ? `
          <div style="padding: 60px; text-align: center; color: var(--text-muted, #64748b);">
            <div style="display: inline-block; width: 32px; height: 32px; border: 3px solid var(--border-subtle, #e2e8f0); border-top-color: var(--brand, #4f46e5); border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px;"></div>
            <div>${isBn ? 'লোড হচ্ছে…' : 'Loading campaign data…'}</div>
          </div>
        ` : this.activeTab === 'flash_sales'
          ? this._renderFlashSalesTab(isBn)
          : this._renderCouponsTab(isBn)}
      </div>
    `;

    this._attachEvents();
  }

  _renderFlashSalesTab(isBn) {
    const activeCount = this.flashSales.filter((s) => s.status === 'ACTIVE').length;
    const totalAllocated = this.flashSales.reduce((sum, s) => sum + (Number(s.allocated_qty) || 0), 0);
    const totalSold = this.flashSales.reduce((sum, s) => sum + (Number(s.sold_qty) || 0), 0);
    const clearanceRate = totalAllocated > 0 ? Math.round((totalSold / totalAllocated) * 100) : 0;

    return `
      <!-- KPI Metrics Grid -->
      <div style="
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 14px;
      ">
        <div style="padding: 14px 18px; border-radius: var(--radius-lg, 12px); background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); border-left: 4px solid var(--warning, #d97706); box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));">
          <span style="font-size: 11px; font-weight: 600; color: var(--text-muted, #64748b); display: block; margin-bottom: 2px;">${isBn ? 'সক্রিয় ফ্ল্যাশ সেল' : 'Active Flash Deals'}</span>
          <div style="font-size: 24px; font-weight: 800; color: var(--warning, #d97706);">${activeCount}</div>
        </div>
        <div style="padding: 14px 18px; border-radius: var(--radius-lg, 12px); background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); border-left: 4px solid var(--brand, #4f46e5); box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));">
          <span style="font-size: 11px; font-weight: 600; color: var(--text-muted, #64748b); display: block; margin-bottom: 2px;">${isBn ? 'বরাদ্দকৃত স্টক' : 'Allocated Stock'}</span>
          <div style="font-size: 24px; font-weight: 800; color: var(--text-brand, #4f46e5);">${totalAllocated.toLocaleString('en-US')}</div>
        </div>
        <div style="padding: 14px 18px; border-radius: var(--radius-lg, 12px); background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); border-left: 4px solid var(--success, #059669); box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));">
          <span style="font-size: 11px; font-weight: 600; color: var(--text-muted, #64748b); display: block; margin-bottom: 2px;">${isBn ? 'বিক্রি হওয়া ইউনিট' : 'Units Claimed'}</span>
          <div style="font-size: 24px; font-weight: 800; color: var(--success, #059669);">${totalSold.toLocaleString('en-US')}</div>
        </div>
        <div style="padding: 14px 18px; border-radius: var(--radius-lg, 12px); background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); border-left: 4px solid var(--text-muted, #64748b); box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));">
          <span style="font-size: 11px; font-weight: 600; color: var(--text-muted, #64748b); display: block; margin-bottom: 2px;">${isBn ? 'স্টক ক্লিয়ারেন্স হার' : 'Clearance Rate'}</span>
          <div style="font-size: 24px; font-weight: 800; color: var(--text-primary, #0f172a);">${clearanceRate}%</div>
        </div>
      </div>

      <!-- Flash Sales Table Card -->
      <div style="
        background: var(--surface-1, #ffffff);
        border: 1px solid var(--border-subtle, #e2e8f0);
        border-radius: var(--radius-lg, 12px);
        box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));
        overflow: hidden;
      ">
        ${this.flashSales.length === 0 ? `
          <div style="padding: 60px 20px; text-align: center; color: var(--text-muted, #64748b);">
            <div style="font-size: 32px; margin-bottom: 8px;">⚡</div>
            <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary, #0f172a);">${isBn ? 'কোনো ফ্ল্যাশ সেল পাওয়া যায়নি।' : 'No Flash Sales Scheduled'}</h3>
            <p style="margin: 4px 0 0 0; font-size: 13px;">${isBn ? 'নতুন ডিল চালু করতে উপরের বাটনে ক্লিক করুন।' : 'Click Schedule Flash Sale to launch deals.'}</p>
          </div>
        ` : `
          <div style="overflow-x: auto;">
            <table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 13px;">
              <thead>
                <tr style="background: var(--surface-2, #f8fafc); border-bottom: 1px solid var(--border-subtle, #e2e8f0); font-size: 11px; font-weight: 700; color: var(--text-muted, #64748b); text-transform: uppercase;">
                  <th style="padding: 12px 16px;">${isBn ? 'ডিল ও রেফারেন্স' : 'Deal & Ref'}</th>
                  <th style="padding: 12px 16px;">${isBn ? 'পণ্য' : 'Product'}</th>
                  <th style="padding: 12px 16px;">${isBn ? 'মূল্য (মূল ➔ অফার)' : 'Price (Old ➔ New)'}</th>
                  <th style="padding: 12px 16px;">${isBn ? 'স্টক অগ্রগতি' : 'Stock Claimed'}</th>
                  <th style="padding: 12px 16px;">${isBn ? 'কাউন্টডাউন' : 'Timer'}</th>
                  <th style="padding: 12px 16px;">${isBn ? 'অবস্থা' : 'Status'}</th>
                  <th style="padding: 12px 16px; text-align: right;">${isBn ? 'অ্যাকশন' : 'Action'}</th>
                </tr>
              </thead>
              <tbody>
                ${this.flashSales.map((fs) => this._renderFlashSaleRow(fs, isBn)).join('')}
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
      <tr style="border-bottom: 1px solid var(--border-subtle, #e2e8f0); transition: background 0.15s ease;">
        <td style="padding: 14px 16px;">
          <div style="font-weight: 700; color: var(--text-primary, #0f172a);">${this._escapeHtml(fs.title || fs.product_title_en || 'Flash Deal')}</div>
          <div style="font-family: monospace; font-size: 11px; color: var(--text-brand, #4f46e5); margin-top: 2px;">${fs.ref}</div>
        </td>
        <td style="padding: 14px 16px;">
          <div style="font-weight: 500; color: var(--text-primary, #0f172a);">${this._escapeHtml(fs.product_title_en || `Product #${fs.product_id}`)}</div>
        </td>
        <td style="padding: 14px 16px; font-family: monospace;">
          <span style="text-decoration: line-through; color: var(--text-muted, #64748b); font-size: 12px;">৳${Number(fs.original_price || 0).toFixed(2)}</span>
          <span style="color: var(--success, #059669); font-weight: 800; margin-left: 6px;">৳${Number(fs.discount_price || 0).toFixed(2)}</span>
        </td>
        <td style="padding: 14px 16px; min-width: 140px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
            <span style="color: var(--text-muted, #64748b);">${sold} / ${allocated}</span>
            <strong style="color: var(--text-primary, #0f172a);">${pct}%</strong>
          </div>
          <div style="width: 100%; height: 6px; background: var(--surface-2, #e2e8f0); border-radius: 99px; overflow: hidden;">
            <div style="width: ${pct}%; height: 100%; background: var(--brand, #4f46e5); border-radius: 99px;"></div>
          </div>
        </td>
        <td style="padding: 14px 16px; font-family: monospace; font-size: 12px;">
          ${fs.status === 'EMERGENCY_STOPPED' || fs.status === 'CANCELLED' ? `<span style="color: var(--danger, #e11d48); font-weight: 700;">Stopped</span>` : `
            <span style="color: var(--text-muted, #64748b); font-size: 11px;">${isLive ? (isBn ? 'শেষ হবে:' : 'Ends in:') : (isBn ? 'শুরু হবে:' : 'Starts in:')}</span>
            <div class="live-countdown" data-target-ms="${targetMs}" style="font-weight: 700; color: var(--warning, #d97706); margin-top: 2px;">
              ${this._formatDuration(Math.max(0, targetMs - now))}
            </div>
          `}
        </td>
        <td style="padding: 14px 16px;">
          ${this._renderStatusBadge(fs.status, isBn)}
        </td>
        <td style="padding: 14px 16px; text-align: right;">
          ${fs.status === 'ACTIVE' || fs.status === 'SCHEDULED' ? `
            <button
              class="btn-emergency-stop"
              data-id="${fs.id}"
              data-title="${this._escapeHtml(fs.title || fs.product_title_en || 'Deal')}"
              style="padding: 5px 12px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid var(--danger-border, #e11d48); background: var(--danger-bg, rgba(225, 29, 72, 0.08)); color: var(--danger, #e11d48); cursor: pointer;">
              🚨 ${isBn ? 'জরুরি বন্ধ' : 'Emergency Stop'}
            </button>
          ` : '-'}
        </td>
      </tr>
    `;
  }

  _renderCouponsTab(isBn) {
    const activeCoupons = this.coupons.filter((c) => c.is_active).length;
    const totalBudget = this.coupons.reduce((sum, c) => sum + (Number(c.budget_cap) || 0), 0);
    const totalUsed = this.coupons.reduce((sum, c) => sum + (Number(c.spent_amount || c.budget_used) || 0), 0);
    const totalRedemptions = this.coupons.reduce((sum, c) => sum + (Number(c.redemption_count || c.usage_count) || 0), 0);

    return `
      <!-- KPI Metrics Grid -->
      <div style="
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 14px;
      ">
        <div style="padding: 14px 18px; border-radius: var(--radius-lg, 12px); background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); border-left: 4px solid var(--brand, #4f46e5); box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));">
          <span style="font-size: 11px; font-weight: 600; color: var(--text-muted, #64748b); display: block; margin-bottom: 2px;">${isBn ? 'সক্রিয় কুপন' : 'Active Coupons'}</span>
          <div style="font-size: 24px; font-weight: 800; color: var(--text-brand, #4f46e5);">${activeCoupons}</div>
        </div>
        <div style="padding: 14px 18px; border-radius: var(--radius-lg, 12px); background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); border-left: 4px solid var(--warning, #d97706); box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));">
          <span style="font-size: 11px; font-weight: 600; color: var(--text-muted, #64748b); display: block; margin-bottom: 2px;">${isBn ? 'মোট বাজেট বরাদ্দ' : 'Total Budget Allocated'}</span>
          <div style="font-size: 24px; font-weight: 800; color: var(--warning, #d97706);">৳${totalBudget.toLocaleString('en-US')}</div>
        </div>
        <div style="padding: 14px 18px; border-radius: var(--radius-lg, 12px); background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); border-left: 4px solid var(--danger, #e11d48); box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));">
          <span style="font-size: 11px; font-weight: 600; color: var(--text-muted, #64748b); display: block; margin-bottom: 2px;">${isBn ? 'ব্যবহৃত বাজেট' : 'Budget Spent'}</span>
          <div style="font-size: 24px; font-weight: 800; color: var(--danger, #e11d48);">৳${totalUsed.toFixed(2)}</div>
        </div>
        <div style="padding: 14px 18px; border-radius: var(--radius-lg, 12px); background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); border-left: 4px solid var(--success, #059669); box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));">
          <span style="font-size: 11px; font-weight: 600; color: var(--text-muted, #64748b); display: block; margin-bottom: 2px;">${isBn ? 'মোট রিডেম্পশন' : 'Total Redemptions'}</span>
          <div style="font-size: 24px; font-weight: 800; color: var(--success, #059669);">${totalRedemptions.toLocaleString('en-US')}</div>
        </div>
      </div>

      <!-- Coupons Table Card -->
      <div style="
        background: var(--surface-1, #ffffff);
        border: 1px solid var(--border-subtle, #e2e8f0);
        border-radius: var(--radius-lg, 12px);
        box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));
        overflow: hidden;
      ">
        ${this.coupons.length === 0 ? `
          <div style="padding: 60px 20px; text-align: center; color: var(--text-muted, #64748b);">
            <div style="font-size: 32px; margin-bottom: 8px;">🎟️</div>
            <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary, #0f172a);">${isBn ? 'কোনো কুপন পাওয়া যায়নি।' : 'No Coupons Created'}</h3>
            <p style="margin: 4px 0 0 0; font-size: 13px;">${isBn ? 'নতুন কুপন ভাউচার তৈরি করতে Create Coupon বাটনে ক্লিক করুন।' : 'Click Create Coupon to launch a voucher.'}</p>
          </div>
        ` : `
          <div style="overflow-x: auto;">
            <table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 13px;">
              <thead>
                <tr style="background: var(--surface-2, #f8fafc); border-bottom: 1px solid var(--border-subtle, #e2e8f0); font-size: 11px; font-weight: 700; color: var(--text-muted, #64748b); text-transform: uppercase;">
                  <th style="padding: 12px 16px;">${isBn ? 'কোড' : 'Code'}</th>
                  <th style="padding: 12px 16px;">${isBn ? 'ছাড়ের ধরণ ও মান' : 'Discount'}</th>
                  <th style="padding: 12px 16px;">${isBn ? 'খরচ বহনকারী' : 'Funded By'}</th>
                  <th style="padding: 12px 16px;">${isBn ? 'বাজেট ও খরচ' : 'Budget Cap & Spent'}</th>
                  <th style="padding: 12px 16px;">${isBn ? 'স্কোপ ও নিয়ম' : 'Scope & Constraints'}</th>
                  <th style="padding: 12px 16px;">${isBn ? 'মেয়াদ' : 'Validity'}</th>
                  <th style="padding: 12px 16px; text-align: right;">${isBn ? 'সক্রিয়?' : 'Active?'}</th>
                </tr>
              </thead>
              <tbody>
                ${this.coupons.map((c) => this._renderCouponRow(c, isBn)).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  _renderCouponRow(c, isBn) {
    const budgetCap = c.budget_cap != null ? Number(c.budget_cap) : null;
    const budgetUsed = Number(c.spent_amount || c.budget_used) || 0;
    const pct = budgetCap != null && budgetCap > 0 ? Math.min(100, Math.round((budgetUsed / budgetCap) * 100)) : 0;

    return `
      <tr style="border-bottom: 1px solid var(--border-subtle, #e2e8f0); transition: background 0.15s ease;">
        <td style="padding: 14px 16px;">
          <span style="font-family: monospace; font-weight: 800; color: var(--text-brand, #4f46e5); background: var(--info-bg, rgba(79, 70, 229, 0.1)); padding: 3px 8px; border-radius: 4px; font-size: 12px; border: 1px solid var(--info-border, rgba(79, 70, 229, 0.25));">${c.code}</span>
          ${c.first_order_only ? `<span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: var(--warning-bg, rgba(217, 119, 6, 0.1)); color: var(--warning, #d97706); margin-left: 4px;">1st Order</span>` : ''}
        </td>
        <td style="padding: 14px 16px;">
          <div style="font-weight: 700; color: var(--text-primary, #0f172a);">${this._formatDiscount(c, isBn)}</div>
          ${c.max_discount_amount ? `<div style="font-size: 11px; color: var(--text-muted, #64748b); margin-top: 2px;">${isBn ? 'সর্বোচ্চ ছাড়' : 'Max'}: ৳${Number(c.max_discount_amount).toFixed(2)}</div>` : ''}
        </td>
        <td style="padding: 14px 16px;">
          <span style="font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; background: var(--surface-2, #e2e8f0); color: var(--text-secondary, #475569);">
            ${c.scope_type || 'PLATFORM'}
          </span>
        </td>
        <td style="padding: 14px 16px; min-width: 140px;">
          <div style="font-size: 12px; font-family: monospace; font-weight: 700; color: var(--text-primary, #0f172a);">৳${budgetUsed.toFixed(2)} / ${budgetCap != null ? `৳${budgetCap.toFixed(2)}` : '∞'}</div>
          ${budgetCap != null ? `
            <div style="width: 100%; height: 6px; background: var(--surface-2, #e2e8f0); border-radius: 99px; overflow: hidden; margin-top: 4px;">
              <div style="width: ${pct}%; height: 100%; background: ${pct >= 90 ? 'var(--danger, #e11d48)' : 'var(--brand, #4f46e5)'}; border-radius: 99px;"></div>
            </div>
          ` : ''}
          <div style="font-size: 11px; color: var(--text-muted, #64748b); margin-top: 2px;">${c.redemption_count || 0} ${isBn ? 'বার ব্যবহৃত' : 'uses'}</div>
        </td>
        <td style="padding: 14px 16px; font-size: 12px;">
          <div style="color: var(--text-muted, #64748b);">Min Spend: <strong style="color: var(--text-primary, #0f172a);">৳${Number(c.min_spend_amount || 0).toFixed(2)}</strong></div>
        </td>
        <td style="padding: 14px 16px; font-size: 11px; color: var(--text-muted, #64748b);">
          <div>${new Date(c.starts_at).toLocaleDateString()} ➔</div>
          <div>${new Date(c.expires_at).toLocaleDateString()}</div>
        </td>
        <td style="padding: 14px 16px; text-align: right;">
          <input
            type="checkbox"
            class="toggle-coupon-active"
            data-id="${c.id}"
            style="width: 16px; height: 16px; cursor: pointer;"
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
      ACTIVE: { text: isBn ? 'লাইভ' : 'Live', color: 'var(--success, #059669)', bg: 'var(--success-bg, rgba(5, 150, 105, 0.1))' },
      SCHEDULED: { text: isBn ? 'নির্ধারিত' : 'Scheduled', color: 'var(--warning, #d97706)', bg: 'var(--warning-bg, rgba(217, 119, 6, 0.1))' },
      COMPLETED: { text: isBn ? 'সম্পন্ন' : 'Completed', color: 'var(--text-muted, #64748b)', bg: 'var(--surface-2, #e2e8f0)' },
      EMERGENCY_STOPPED: { text: isBn ? 'জরুরি বন্ধ' : 'Emergency Stopped', color: 'var(--danger, #e11d48)', bg: 'var(--danger-bg, rgba(225, 29, 72, 0.1))' },
      CANCELLED: { text: isBn ? 'বাতিল' : 'Cancelled', color: 'var(--danger, #e11d48)', bg: 'var(--danger-bg, rgba(225, 29, 72, 0.1))' },
    };
    const s = map[status] || { text: status, color: 'var(--text-muted, #64748b)', bg: 'var(--surface-2, #e2e8f0)' };
    return `<span style="font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 700; background: ${s.bg}; color: ${s.color};">${s.text}</span>`;
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
    this.rootEl.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab;
        this.render();
      });
    });

    const btnRefresh = this.rootEl.querySelector('#btn-refresh-campaigns');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', async () => {
        await this.fetchData();
        this.render();
      });
    }

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

    this.rootEl.querySelectorAll('.btn-emergency-stop').forEach((btn) => {
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

    this.rootEl.querySelectorAll('.toggle-coupon-active').forEach((input) => {
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
    modalBackdrop.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      backdrop-filter: blur(2px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    `;

    modalBackdrop.innerHTML = `
      <div style="
        background: var(--surface-1, #ffffff);
        border: 1px solid var(--border-subtle, #e2e8f0);
        border-radius: var(--radius-lg, 12px);
        max-width: 520px;
        width: 100%;
        padding: 24px;
        box-shadow: var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.15));
        display: flex;
        flex-direction: column;
        gap: 16px;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-subtle, #e2e8f0); padding-bottom: 12px;">
          <h2 style="margin: 0; font-size: 16px; font-weight: 800; color: var(--text-primary, #0f172a);">${isBn ? 'নতুন ফ্ল্যাশ সেল তৈরি করুন' : 'Schedule New Flash Sale'}</h2>
          <button type="button" class="btn-close" style="background: none; border: none; font-size: 20px; cursor: pointer; color: var(--text-muted, #64748b);">×</button>
        </div>

        <form id="form-create-flash-sale" style="display: flex; flex-direction: column; gap: 12px; font-size: 12px;">
          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px; color: var(--text-primary, #0f172a);">${isBn ? 'ক্যাম্পেইনের শিরোনাম' : 'Deal Title'} *</label>
            <input type="text" name="title" required placeholder="e.g. Eid Mega Flash Sale" style="width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); font-size: 12px;" />
          </div>

          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px; color: var(--text-primary, #0f172a);">${isBn ? 'পণ্য আইডি (Product ID)' : 'Product ID'} *</label>
            <input type="number" name="product_id" required placeholder="101" style="width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); font-size: 12px; font-family: monospace;" />
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 4px; color: var(--text-primary, #0f172a);">${isBn ? 'ফ্ল্যাশ সেল মূল্য (৳)' : 'Flash Sale Price (৳)'} *</label>
              <input type="number" name="discount_price" min="1" step="0.5" required placeholder="990" style="width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); font-size: 12px; font-family: monospace;" />
            </div>
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 4px; color: var(--text-primary, #0f172a);">${isBn ? 'বরাদ্দকৃত স্টক পরিমাণ' : 'Allocated Stock Qty'} *</label>
              <input type="number" name="allocated_qty" min="1" required value="20" style="width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); font-size: 12px; font-family: monospace;" />
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
            <button type="button" class="btn-cancel" style="padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-muted, #64748b); font-size: 12px; font-weight: 600; cursor: pointer;">${isBn ? 'বাতিল' : 'Cancel'}</button>
            <button type="submit" style="padding: 8px 18px; border-radius: 6px; border: none; background: var(--brand, #4f46e5); color: #ffffff; font-size: 12px; font-weight: 700; cursor: pointer;">${isBn ? 'তৈরি করুন' : 'Schedule Deal'}</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    const closeModal = () => modalBackdrop.remove();
    modalBackdrop.querySelector('.btn-close').addEventListener('click', closeModal);
    modalBackdrop.querySelector('.btn-cancel').addEventListener('click', closeModal);

    modalBackdrop.querySelector('#form-create-flash-sale').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = {
        title: form.title.value,
        product_id: parseInt(form.product_id.value, 10),
        discount_price: parseFloat(form.discount_price.value),
        allocated_qty: parseInt(form.allocated_qty.value, 10),
      };

      try {
        await api.post('/admin/growth/campaigns/flash-sales', data);
        toast.success(isBn ? 'ফ্ল্যাশ সেল সফলভাবে নির্ধারিত হয়েছে।' : 'Flash sale scheduled successfully.');
        closeModal();
        await this.fetchData();
        this.render();
      } catch (err) {
        toast.error(err.message || 'Creation failed');
      }
    });
  }

  _openCreateCouponModal() {
    const isBn = getLanguage() === 'bn';
    const modalBackdrop = document.createElement('div');
    modalBackdrop.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      backdrop-filter: blur(2px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    `;

    modalBackdrop.innerHTML = `
      <div style="
        background: var(--surface-1, #ffffff);
        border: 1px solid var(--border-subtle, #e2e8f0);
        border-radius: var(--radius-lg, 12px);
        max-width: 520px;
        width: 100%;
        padding: 24px;
        box-shadow: var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.15));
        display: flex;
        flex-direction: column;
        gap: 16px;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-subtle, #e2e8f0); padding-bottom: 12px;">
          <h2 style="margin: 0; font-size: 16px; font-weight: 800; color: var(--text-primary, #0f172a);">${isBn ? 'নতুন কুপন তৈরি করুন' : 'Create New Coupon Voucher'}</h2>
          <button type="button" class="btn-close" style="background: none; border: none; font-size: 20px; cursor: pointer; color: var(--text-muted, #64748b);">×</button>
        </div>

        <form id="form-create-coupon" style="display: flex; flex-direction: column; gap: 12px; font-size: 12px;">
          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 4px; color: var(--text-primary, #0f172a);">${isBn ? 'কুপন কোড' : 'Coupon Code'} *</label>
            <input type="text" name="code" required placeholder="e.g. MEGA2026" style="width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); font-size: 12px; font-family: monospace;" />
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 4px; color: var(--text-primary, #0f172a);">${isBn ? 'ছাড়ের ধরণ' : 'Discount Type'} *</label>
              <select name="discount_type" style="width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); font-size: 12px;">
                <option value="PERCENT">Percentage (%)</option>
                <option value="FIXED">Fixed Amount (৳)</option>
                <option value="FREE_SHIPPING">Free Shipping</option>
              </select>
            </div>
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 4px; color: var(--text-primary, #0f172a);">${isBn ? 'ছাড়ের মান' : 'Discount Value'} *</label>
              <input type="number" name="discount_value" required min="1" step="0.5" value="10" style="width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); font-size: 12px; font-family: monospace;" />
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 4px; color: var(--text-primary, #0f172a);">${isBn ? 'বাজেট ক্যাপ (৳)' : 'Budget Cap (৳)'} *</label>
              <input type="number" name="budget_cap" required value="20000" style="width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); font-size: 12px; font-family: monospace;" />
            </div>
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 4px; color: var(--text-primary, #0f172a);">${isBn ? 'সর্বনিম্ন খরচ (৳)' : 'Min Spend (৳)'} *</label>
              <input type="number" name="min_spend_amount" required value="1000" style="width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); font-size: 12px; font-family: monospace;" />
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
            <button type="button" class="btn-cancel" style="padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-muted, #64748b); font-size: 12px; font-weight: 600; cursor: pointer;">${isBn ? 'বাতিল' : 'Cancel'}</button>
            <button type="submit" style="padding: 8px 18px; border-radius: 6px; border: none; background: var(--brand, #4f46e5); color: #ffffff; font-size: 12px; font-weight: 700; cursor: pointer;">${isBn ? 'তৈরি করুন' : 'Create Coupon'}</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    const closeModal = () => modalBackdrop.remove();
    modalBackdrop.querySelector('.btn-close').addEventListener('click', closeModal);
    modalBackdrop.querySelector('.btn-cancel').addEventListener('click', closeModal);

    modalBackdrop.querySelector('#form-create-coupon').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = {
        code: form.code.value.trim().toUpperCase(),
        discount_type: form.discount_type.value,
        discount_value: parseFloat(form.discount_value.value),
        budget_cap: parseFloat(form.budget_cap.value),
        min_spend_amount: parseFloat(form.min_spend_amount.value),
      };

      try {
        await api.post('/admin/growth/coupons', data);
        toast.success(isBn ? 'কুপন সফলভাবে তৈরি হয়েছে।' : 'Coupon created successfully.');
        closeModal();
        await this.fetchData();
        this.render();
      } catch (err) {
        toast.error(err.message || 'Creation failed');
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

export default function mountCampaignManagerPage(root) {
  const page = new CampaignManagerPage();
  page.mount(root);
  return () => page.unmount();
}
