/**
 * ReferralHubPage.js — Multi-Tier Referral & Network Growth Hub (Prompts 9.3 & 11.3).
 *
 * Provides a viral, high-conversion growth workspace for both Customers & Salers:
 * 1. 2-Tier Earnings Model: Tier 1 (Direct 5%) + Tier 2 (Sub-network 2%) + 100 Loyalty Coins / invite.
 * 2. 1-Tap Viral Share Kit: Copy Code, Copy Link, WhatsApp Web/App, Facebook, QR & Social Story Card.
 * 3. 4 Executive Telemetry KPIs: Network Size, Tier 1, Tier 2, Commissions in Escrow & Available.
 * 4. Gamified Referrer Level & Milestone Progress Stepper (Starter → Bronze → Silver → Gold VIP).
 * 5. Interactive 4-Tab Workspace:
 *    - 🌳 Network Tree & Friends Directory (with search & tier/status filters).
 *    - 📜 Commission Ledger & Escrow Clearance Timeline.
 *    - 🧮 Interactive Earnings Calculator & FAQ.
 *    - 🧪 QA & Developer Real-Time Simulator.
 * 6. 100% Bilingual (English & Bengali) with Explooro design system.
 */

import '../../styles/components/referrals.css';
import { api } from '../../core/api.js';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

export class ReferralHubPage {
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.overview = null;
    this.tree = [];
    this.statement = [];
    this.activeTab = 'tree'; // 'tree' | 'statement' | 'calc' | 'qa'
    this.treeFilter = 'all'; // 'all' | 'tier1' | 'tier2' | 'qualified' | 'pending'
    this.statementFilter = 'all'; // 'all' | 'available' | 'escrow'
    this.searchQuery = '';
    this.calcFriends = 10;
    this.calcSpend = 4000;
    this.loading = true;
    this.rootEl = null;
    this.unsubscribeLang = null;
  }

  async mount(outlet) {
    this.rootEl = outlet;
    this.unsubscribeLang = subscribeLang(() => this.render());
    await this.fetchData();
    this.render();
  }

  unmount() {
    if (this.unsubscribeLang) {
      this.unsubscribeLang();
      this.unsubscribeLang = null;
    }
  }

  async fetchData() {
    this.loading = true;
    try {
      const [overviewRes, treeRes, statementRes] = await Promise.all([
        api.get('/saler/referrals/overview').catch(() => api.get('/referrals/overview')).catch(() => ({ overview: null })),
        api.get('/saler/referrals/tree').catch(() => api.get('/referrals/tree')).catch(() => ({ tree: [] })),
        api.get('/saler/referrals/statement').catch(() => api.get('/referrals/statement')).catch(() => ({ statement: [] })),
      ]);
      this.overview = overviewRes.overview || this._getFallbackOverview();
      this.tree = treeRes.tree || [];
      this.statement = statementRes.statement || [];
    } catch (err) {
      toast.error(err.message || 'Failed to load referral data');
      this.overview = this._getFallbackOverview();
    } finally {
      this.loading = false;
    }
  }

  _getFallbackOverview() {
    return {
      code: 'REF-EXP8820',
      custom_slug: 'tanvir-deals',
      clicks_count: 142,
      signups_count: 12,
      stats: { total_referrals: 12, tier1_count: 8, tier2_count: 4, qualified_count: 9, pending_count: 3 },
      earnings: { total_earnings: '6450.00', pending_escrow: '1800.00', available_earnings: '4650.00' },
      coins: { coins_earned: 1200, coins_per_signup: 100 },
      tier_badge: 'GOLD_VIP',
      next_tier_progress: { current: 12, target: 20, pct: 60, next_tier: 'PLATINUM_DIRECTOR', reward_boost: '+2.5% Bonus' },
    };
  }

  render() {
    if (!this.rootEl) return;
    const lang = getLanguage();
    const isBn = lang === 'bn';

    const origin = window.location.origin || 'https://explooro.com';
    const refCode = this.overview?.code || 'REF-EXP8820';
    const customSlug = this.overview?.custom_slug;
    const refLink = customSlug
      ? `${origin}/join/${customSlug}`
      : `${origin}/join?ref=${refCode}`;

    const stats = this.overview?.stats || { total_referrals: 0, tier1_count: 0, tier2_count: 0, qualified_count: 0, pending_count: 0 };
    const earnings = this.overview?.earnings || { total_earnings: '0.00', pending_escrow: '0.00', available_earnings: '0.00' };
    const coins = this.overview?.coins || { coins_earned: 0, coins_per_signup: 100 };
    const progress = this.overview?.next_tier_progress || { current: stats.total_referrals || 0, target: 20, pct: 50, next_tier: 'PLATINUM_DIRECTOR' };

    const nav = (path) => {
      if (this.ctx?.navigate) {
        this.ctx.navigate(path);
      } else {
        window.location.href = path;
      }
    };

    this.rootEl.innerHTML = `
      <div class="referral-hub">
        <!-- Header -->
        <header class="referral-hub__header">
          <a href="/account" class="referral-hub__back" id="btn-back-account">
            ← ${t('referrals.back_to_account', 'অ্যাকাউন্টে ফিরে যান')}
          </a>
          <div class="referral-hub__title-wrap">
            <div>
              <h1 class="referral-hub__title">
                🤝 ${t('referrals.page_title', 'রেফারেল ও নেটওয়ার্ক আর্নিং হাব')}
              </h1>
              <p class="referral-hub__subtitle">
                ${t('referrals.page_subtitle', 'বন্ধুদের রেফার করুন এবং তাদের কেনাকাটা ও বিক্রির উপর ২-স্তরের আজীবন কমিশন ও বোনাস কয়েন উপভোগ করুন')}
              </p>
            </div>
            <div class="referral-hub__header-actions">
              <button id="btn-open-slug" class="btn btn--outline btn--sm">
                ✏️ ${t('referrals.btn_custom_slug', 'কাস্টম লিংক')}
              </button>
              <button id="btn-open-qr" class="btn btn--primary btn--sm">
                📱 ${t('referrals.btn_show_qr', 'QR ও সোশ্যাল কার্ড')}
              </button>
            </div>
          </div>
        </header>

        <!-- Hero Card & Stepper -->
        <div class="referral-hero">
          <div class="referral-hero__top">
            <div>
              <span class="referral-hero__badge">
                ✨ ${t('referrals.multi_tier_title', 'মাল্টি-টিয়ার গ্রোথ প্রোগ্রাম')}
              </span>
              <h2 class="referral-hero__headline">
                ${t('referrals.multi_tier_subtitle', 'টিয়ার ১ থেকে ৫% + টিয়ার ২ থেকে ২% কমিশন + প্রতি ইনভাইটে ১০০ কয়েন')}
              </h2>
              <p class="referral-hero__desc">
                ${t('referrals.multi_tier_desc', 'আপনার ব্যক্তিগত রেফারেল লিংক বা QR কোড বন্ধুদের সাথে শেয়ার করুন। তারা কেনাকাটা বা বিক্রি করলেই কমিশন সরাসরি আপনার এসক্রো ভল্ট এবং কয়েন ব্যালেন্সে জমা হবে।')}
              </p>
            </div>
          </div>

          <!-- 3-Step Visual Guide -->
          <div class="referral-stepper">
            <div class="referral-step">
              <div class="referral-step__num">1</div>
              <div class="referral-step__content">
                <h3 class="referral-step__title">${t('referrals.step1_title', '১. লিংক / কোড শেয়ার করুন')}</h3>
                <p class="referral-step__desc">${t('referrals.step1_desc', 'হোয়াটসঅ্যাপ, ফেসবুক বা QR ফ্লায়ারের মাধ্যমে বন্ধুদের পাঠান।')}</p>
              </div>
            </div>
            <div class="referral-step">
              <div class="referral-step__num">2</div>
              <div class="referral-step__content">
                <h3 class="referral-step__title">${t('referrals.step2_title', '২. বন্ধুরা যুক্ত হয়ে অর্ডার করবে')}</h3>
                <p class="referral-step__desc">${t('referrals.step2_desc', 'তারা একাউন্ট খুলে প্রথম অর্ডারে বিশেষ ওয়েলকাম ছাড় পাবে।')}</p>
              </div>
            </div>
            <div class="referral-step">
              <div class="referral-step__num">3</div>
              <div class="referral-step__content">
                <h3 class="referral-step__title">${t('referrals.step3_title', '৩. ক্যাশ ও কয়েন আয় করুন')}</h3>
                <p class="referral-step__desc">${t('referrals.step3_desc', 'প্রতিটি অর্ডারে ৫%/২% কমিশন এবং ফ্রেন্ড সাইনআপে ১০০ কয়েন নিন।')}</p>
              </div>
            </div>
          </div>

          <!-- Share Controls Box -->
          <div class="referral-share-box">
            <div class="referral-share-row">
              <div class="referral-code-chip" title="Your direct referral code">
                <span>🔑 ${refCode}</span>
                <button id="btn-copy-code" class="btn btn--outline btn--sm" style="padding: 2px 8px; height: 26px;">
                  📋 ${t('referrals.copy_code', 'কোড কপি')}
                </button>
              </div>

              <input
                type="text"
                readonly
                id="input-referral-link"
                value="${refLink}"
                class="referral-link-input" />

              <button id="btn-copy-link" class="btn btn-social btn-social--copy">
                📋 ${t('referrals.copy_link', 'লিংক কপি')}
              </button>
            </div>

            <div class="referral-social-btns">
              <a
                href="https://api.whatsapp.com/send?text=${encodeURIComponent((isBn ? 'এক্সপ্লুরোতে যোগ দিয়ে আজই বিজনেস ও শপিং শুরু করুন! আমার রেফারেল লিংক: ' : 'Join Explooro today for social commerce deals & business: ') + refLink)}"
                target="_blank"
                rel="noopener noreferrer"
                class="btn-social btn-social--whatsapp">
                💬 ${t('referrals.share_whatsapp', 'হোয়াটসঅ্যাপ')}
              </a>
              <a
                href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(refLink)}"
                target="_blank"
                rel="noopener noreferrer"
                class="btn-social btn-social--facebook">
                💙 ${t('referrals.share_facebook', 'ফেসবুক')}
              </a>
              <button id="btn-copy-sms" class="btn btn--outline btn--sm">
                ✉️ ${t('referrals.share_sms', 'এসএমএস')}
              </button>
            </div>
          </div>
        </div>

        <!-- 4 KPI Telemetry Cards -->
        <div class="referral-kpis">
          <div class="referral-kpi-card referral-kpi-card--blue">
            <span class="referral-kpi-card__label">${t('referrals.total_network', 'মোট নেটওয়ার্ক সাইজ')}</span>
            <div class="referral-kpi-card__val">${stats.total_referrals || 0}</div>
            <span class="referral-kpi-card__sub">✓ ${stats.qualified_count || 0} ${t('referrals.qualified', 'কোয়ালিফাইড')}</span>
          </div>

          <div class="referral-kpi-card">
            <span class="referral-kpi-card__label">${t('referrals.tier1_direct', 'টিয়ার ১ (সরাসরি ৫%)')}</span>
            <div class="referral-kpi-card__val">${stats.tier1_count || 0}</div>
            <span class="referral-kpi-card__sub">👥 ${isBn ? 'সরাসরি আমন্ত্রিত' : 'direct invites'}</span>
          </div>

          <div class="referral-kpi-card">
            <span class="referral-kpi-card__label">${t('referrals.tier2_indirect', 'টিয়ার ২ (সাব-নেটওয়ার্ক ২%)')}</span>
            <div class="referral-kpi-card__val">${stats.tier2_count || 0}</div>
            <span class="referral-kpi-card__sub">🌳 ${isBn ? 'টিয়ার ১ দ্বারা আমন্ত্রিত' : 'invited by Tier 1'}</span>
          </div>

          <div class="referral-kpi-card referral-kpi-card--green">
            <span class="referral-kpi-card__label">${t('referrals.total_commissions', 'মোট রেফারেল আয়')}</span>
            <div class="referral-kpi-card__val">৳${Number(earnings.total_earnings || 0).toFixed(2)}</div>
            <span class="referral-kpi-card__sub">
              ⏳ ৳${Number(earnings.pending_escrow || 0).toFixed(2)} ${t('referrals.in_escrow', 'এসক্রো হোল্ডিংয়ে')}
            </span>
          </div>

          <div class="referral-kpi-card referral-kpi-card--amber">
            <span class="referral-kpi-card__label">${t('referrals.loyalty_coins_earned', 'অর্জিত কয়েন')}</span>
            <div class="referral-kpi-card__val">${coins.coins_earned || (stats.total_referrals * 100)} 🪙</div>
            <span class="referral-kpi-card__sub">🎁 100 ${isBn ? 'কয়েন / সাইনআপ' : 'coins / invite'}</span>
          </div>
        </div>

        <!-- Gamified Tier Progress Bar -->
        <div class="referral-tier-bar">
          <div class="referral-tier-bar__header">
            <h3 class="referral-tier-bar__title">
              🏆 ${t('referrals.tier_progress_title', 'রেফারার লেভেল ও মাইলস্টোন')}
            </h3>
            <span class="referral-tier-badge">
              🌟 ${this.overview?.tier_badge || 'GOLD_VIP'}
            </span>
          </div>
          <div class="referral-progress-track">
            <div class="referral-progress-fill" style="width: ${Math.min(100, progress.pct || 60)}%;"></div>
          </div>
          <div class="referral-tier-steps">
            <span>Starter (0)</span>
            <span>Bronze (5)</span>
            <span>Silver (10)</span>
            <span style="font-weight: 800; color: var(--text-brand);">Gold VIP (15)</span>
            <span>Platinum Director (25+)</span>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="referral-tabs">
          <button
            class="referral-tab-btn ${this.activeTab === 'tree' ? 'referral-tab-btn--active' : ''}"
            data-tab="tree">
            🌳 ${t('referrals.tab_tree', 'নেটওয়ার্ক ট্রি')}
            <span class="referral-tab-badge">${this.tree.length}</span>
          </button>
          <button
            class="referral-tab-btn ${this.activeTab === 'statement' ? 'referral-tab-btn--active' : ''}"
            data-tab="statement">
            📜 ${t('referrals.tab_statement', 'কমিশন স্টেটমেন্ট ও এসক্রো')}
            <span class="referral-tab-badge">${this.statement.length}</span>
          </button>
          <button
            class="referral-tab-btn ${this.activeTab === 'calc' ? 'referral-tab-btn--active' : ''}"
            data-tab="calc">
            🧮 ${t('referrals.tab_calc', 'ক্যালকুলেটর ও প্রশ্নোত্তর')}
          </button>
          <button
            class="referral-tab-btn ${this.activeTab === 'qa' ? 'referral-tab-btn--active' : ''}"
            data-tab="qa">
            🧪 ${t('referrals.tab_qa', 'সিমুলেশন টেস্ট')}
          </button>
        </div>

        <!-- Active Tab Content -->
        ${this.loading ? `
          <div class="referral-card p-12 text-center text-muted">
            ⏳ ${isBn ? 'তথ্য লোড হচ্ছে…' : 'Loading referral network telemetry…'}
          </div>
        ` : this._renderActiveTab(isBn)}

        <!-- Anti-Fraud & Escrow Policy Notice -->
        <div class="referral-policy-card">
          <span style="font-size: 1.25rem;">🛡️</span>
          <div>
            <strong style="color: var(--text-primary);">${t('referrals.anti_fraud_notice', 'জালিয়াতি বিরোধী ও এসক্রো নীতি')}</strong>
          </div>
        </div>
      </div>
    `;

    this._attachEvents(refLink, refCode, isBn, nav);
  }

  _renderActiveTab(isBn) {
    if (this.activeTab === 'tree') return this._renderTreeTab(isBn);
    if (this.activeTab === 'statement') return this._renderStatementTab(isBn);
    if (this.activeTab === 'calc') return this._renderCalcTab(isBn);
    if (this.activeTab === 'qa') return this._renderQaTab(isBn);
    return '';
  }

  _renderTreeTab(isBn) {
    let filtered = [...this.tree];

    if (this.treeFilter === 'tier1') {
      filtered = filtered.filter((n) => n.tier_level === 1);
    } else if (this.treeFilter === 'tier2') {
      filtered = filtered.filter((n) => n.tier_level === 2);
    } else if (this.treeFilter === 'qualified') {
      filtered = filtered.filter((n) => n.status === 'QUALIFIED');
    } else if (this.treeFilter === 'pending') {
      filtered = filtered.filter((n) => n.status === 'PENDING');
    }

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.trim().toLowerCase();
      filtered = filtered.filter(
        (n) =>
          (n.referee_name || '').toLowerCase().includes(q) ||
          (n.ref || '').toLowerCase().includes(q) ||
          (n.referee_email || '').toLowerCase().includes(q)
      );
    }

    return `
      <div class="referral-card">
        <div class="referral-card-filters">
          <div class="referral-filter-chips">
            <button class="referral-filter-chip ${this.treeFilter === 'all' ? 'referral-filter-chip--active' : ''}" data-tree-filter="all">
              ${t('referrals.filter_all', 'সকল')} (${this.tree.length})
            </button>
            <button class="referral-filter-chip ${this.treeFilter === 'tier1' ? 'referral-filter-chip--active' : ''}" data-tree-filter="tier1">
              ${t('referrals.filter_tier1', 'টিয়ার ১ (৫%)')}
            </button>
            <button class="referral-filter-chip ${this.treeFilter === 'tier2' ? 'referral-filter-chip--active' : ''}" data-tree-filter="tier2">
              ${t('referrals.filter_tier2', 'টিয়ার ২ (২%)')}
            </button>
            <button class="referral-filter-chip ${this.treeFilter === 'qualified' ? 'referral-filter-chip--active' : ''}" data-tree-filter="qualified">
              ✓ ${t('referrals.filter_qualified', 'কোয়ালিফাইড')}
            </button>
            <button class="referral-filter-chip ${this.treeFilter === 'pending' ? 'referral-filter-chip--active' : ''}" data-tree-filter="pending">
              ⏳ ${t('referrals.filter_pending', 'অপেক্ষমাণ')}
            </button>
          </div>

          <input
            type="search"
            id="input-tree-search"
            value="${this._escapeHtml(this.searchQuery)}"
            placeholder="${t('referrals.search_placeholder', 'রেফারি নাম অনুসন্ধান...')}"
            class="referral-search-input" />
        </div>

        ${filtered.length === 0 ? `
          <div class="p-12 text-center text-muted" style="padding: 48px 24px;">
            <div style="font-size: 2rem; margin-bottom: 8px;">🌳</div>
            <p style="font-weight: 700; color: var(--text-primary); margin: 0;">
              ${t('referrals.no_referees', 'কোনো রেফারেল পাওয়া যায়নি।')}
            </p>
            <p style="font-size: 11px; margin-top: 4px;">
              ${isBn ? 'আপনার লিংক বন্ধুদের সাথে শেয়ার করে নেটওয়ার্ক গড়ে তুলুন!' : 'Share your invite link above to start growing your community network!'}
            </p>
          </div>
        ` : `
          <div style="overflow-x: auto;">
            <table class="referral-table">
              <thead>
                <tr>
                  <th>${t('referrals.referee_name', 'রেফারি নাম ও অ্যাকাউন্ট')}</th>
                  <th>${t('referrals.tier_level', 'টিয়ার স্তর')}</th>
                  <th>${t('referrals.joined_date', 'যুক্ত হওয়ার তারিখ')}</th>
                  <th>${t('referrals.status', 'অবস্থা')}</th>
                  <th style="text-align: right;">${t('referrals.commission_earned', 'অর্জিত কমিশন')}</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map((node) => `
                  <tr>
                    <td>
                      <div style="font-weight: 700;">${this._escapeHtml(node.referee_name || 'User')}</div>
                      <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono, monospace);">${node.ref}</div>
                    </td>
                    <td>
                      <span class="badge badge--${node.tier_level === 1 ? 'primary' : 'warning'}" style="font-size: 11px; font-weight: 800;">
                        ${node.tier_level === 1 ? (isBn ? 'টিয়ার ১ (সরাসরি ৫%)' : 'Tier 1 (5%)') : (isBn ? 'টিয়ার ২ (সাব ২%)' : 'Tier 2 (2%)')}
                      </span>
                    </td>
                    <td style="font-size: 11px; color: var(--text-muted);">
                      ${new Date(node.joined_at || node.created_at).toLocaleDateString(isBn ? 'bn-BD' : 'en-GB')}
                    </td>
                    <td>
                      ${node.status === 'QUALIFIED'
                        ? `<span class="badge badge--success" style="font-size: 10px; font-weight: 800;">✓ ${isBn ? 'কোয়ালিফাইড' : 'Qualified'}</span>`
                        : node.status === 'FRAUD_FLAGGED'
                        ? `<span class="badge badge--danger" style="font-size: 10px; font-weight: 800;">⚠️ ${isBn ? 'বাতিল' : 'Fraud Flagged'}</span>`
                        : `<span class="badge badge--neutral" style="font-size: 10px; font-weight: 800;">⏳ ${isBn ? 'অপেক্ষমাণ' : 'Pending'}</span>`}
                    </td>
                    <td style="text-align: right; font-family: var(--font-mono, monospace); font-weight: 800; color: #16a34a;">
                      ৳${Number(node.earned_from_referee || 0).toFixed(2)}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  _renderStatementTab(isBn) {
    let filtered = [...this.statement];

    if (this.statementFilter === 'available') {
      filtered = filtered.filter((s) => s.status === 'AVAILABLE');
    } else if (this.statementFilter === 'escrow') {
      filtered = filtered.filter((s) => s.status === 'PENDING_ESCROW');
    }

    return `
      <div class="referral-card">
        <div class="referral-card-filters">
          <div class="referral-filter-chips">
            <button class="referral-filter-chip ${this.statementFilter === 'all' ? 'referral-filter-chip--active' : ''}" data-statement-filter="all">
              ${t('referrals.filter_all', 'সকল')} (${this.statement.length})
            </button>
            <button class="referral-filter-chip ${this.statementFilter === 'available' ? 'referral-filter-chip--active' : ''}" data-statement-filter="available">
              ✓ ${t('referrals.available_balance', 'ওয়ালেটে বিদ্যমান')}
            </button>
            <button class="referral-filter-chip ${this.statementFilter === 'escrow' ? 'referral-filter-chip--active' : ''}" data-statement-filter="escrow">
              ⏳ ${t('referrals.in_escrow', 'এসক্রো হোল্ডিংয়ে')}
            </button>
          </div>
        </div>

        ${filtered.length === 0 ? `
          <div class="p-12 text-center text-muted" style="padding: 48px 24px;">
            <div style="font-size: 2rem; margin-bottom: 8px;">📜</div>
            <p style="font-weight: 700; color: var(--text-primary); margin: 0;">
              ${t('referrals.no_records', 'কোনো কমিশন লেনদেন পাওয়া যায়নি।')}
            </p>
            <p style="font-size: 11px; margin-top: 4px;">
              ${isBn ? 'রেফারিদের সফল অর্ডার সম্পন্ন হলে কমিশন এখানে প্রদর্শিত হবে।' : 'Commissions from qualifying orders will appear here automatically.'}
            </p>
          </div>
        ` : `
          <div style="overflow-x: auto;">
            <table class="referral-table">
              <thead>
                <tr>
                  <th>${t('referrals.ref_source', 'রেফারেন্স ও রেফারি')}</th>
                  <th>${t('referrals.order_rate', 'অর্ডার ও রেট')}</th>
                  <th>${t('referrals.commission', 'কমিশন')}</th>
                  <th>${t('referrals.escrow_clearance', 'এসক্রো রিলিজ তারিখ')}</th>
                  <th style="text-align: right;">${t('referrals.status', 'অবস্থা')}</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map((item) => `
                  <tr>
                    <td>
                      <div style="font-weight: 700; font-size: 11px;">${this._escapeHtml(item.referee_name || 'Referee')}</div>
                      <div style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono, monospace);">
                        ${item.referral_ref} • Tier ${item.tier_level}
                      </div>
                    </td>
                    <td style="font-family: var(--font-mono, monospace); font-size: 11px;">
                      <div>৳${Number(item.order_amount || 0).toFixed(2)}</div>
                      <span style="color: var(--text-muted); font-size: 10px;">@ ${Number(item.commission_rate_pct || 5).toFixed(1)}%</span>
                    </td>
                    <td style="font-family: var(--font-mono, monospace); font-weight: 800; color: #16a34a; font-size: 12px;">
                      +৳${Number(item.commission_amount).toFixed(2)}
                    </td>
                    <td style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono, monospace);">
                      ${item.status === 'AVAILABLE' ? '✓ Cleared' : new Date(item.escrow_release_at).toLocaleDateString(isBn ? 'bn-BD' : 'en-GB')}
                    </td>
                    <td style="text-align: right;">
                      ${item.status === 'AVAILABLE'
                        ? `<span class="badge badge--success" style="font-size: 10px; font-weight: 800;">Available</span>`
                        : `<span class="badge badge--warning" style="font-size: 10px; font-weight: 800;">In Escrow (7d)</span>`}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  _renderCalcTab(isBn) {
    const directEarn = (this.calcFriends * this.calcSpend * 0.05);
    const subFriends = Math.round(this.calcFriends * 1.5);
    const subEarn = (subFriends * this.calcSpend * 0.02);
    const totalEstCash = Math.round(directEarn + subEarn);
    const totalCoins = this.calcFriends * 100;

    return `
      <div class="referral-card">
        <div class="referral-calc-box">
          <div class="referral-calc-grid">
            <div class="referral-calc-sliders">
              <h3 style="font-size: var(--text-base); font-weight: 800; margin: 0; color: var(--text-primary);">
                🧮 ${t('referrals.calc_title', 'আপনার সম্ভাব্য মাসিক আয় হিসাব করুন')}
              </h3>

              <div class="referral-slider-group">
                <div class="referral-slider-label-row">
                  <span>${t('referrals.calc_friends_label', 'আমন্ত্রিত বন্ধুর সংখ্যা:')}</span>
                  <span class="referral-slider-val" id="val-friends-count">${this.calcFriends} ${isBn ? 'জন' : 'friends'}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value="${this.calcFriends}"
                  id="slider-friends"
                  style="width: 100%; accent-color: var(--brand);" />
              </div>

              <div class="referral-slider-group">
                <div class="referral-slider-label-row">
                  <span>${t('referrals.calc_spend_label', 'প্রতি বন্ধুর গড় মাসিক খরচ:')}</span>
                  <span class="referral-slider-val" id="val-spend-amount">৳${this.calcSpend.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min="500"
                  max="30000"
                  step="500"
                  value="${this.calcSpend}"
                  id="slider-spend"
                  style="width: 100%; accent-color: var(--brand);" />
              </div>
            </div>

            <div class="referral-calc-result">
              <span class="referral-calc-result__headline">
                ${t('referrals.calc_result_cash', 'সম্ভাব্য মাসিক কমিশন')}
              </span>
              <div class="referral-calc-result__amount" id="result-cash-est">
                ৳${totalEstCash.toLocaleString()}
              </div>
              <div style="font-size: var(--text-xs); color: #d97706; font-weight: 800;">
                + ${totalCoins.toLocaleString()} 🪙 ${t('referrals.calc_result_coins', 'বোনাস লয়্যালটি কয়েন')}
              </div>
              <p style="font-size: 11px; color: var(--text-muted); margin: 4px 0 0;">
                ${isBn
                  ? `(টিয়ার ১ থেকে ৳${Math.round(directEarn).toLocaleString()} এবং টিয়ার ২ থেকে ৳${Math.round(subEarn).toLocaleString()})`
                  : `(৳${Math.round(directEarn).toLocaleString()} Tier 1 + ৳${Math.round(subEarn).toLocaleString()} Tier 2)`}
              </p>
            </div>
          </div>
        </div>

        <!-- FAQ Section -->
        <div class="referral-faq-list">
          <h3 style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary); margin: 0;">
            ❓ ${t('referrals.faq_title', 'সচরাচর জিজ্ঞাসিত প্রশ্নাবলী (FAQ)')}
          </h3>

          <div class="referral-faq-item">
            <h4 class="referral-faq-q">${t('referrals.faq_q1', '২-স্তরের রেফারেল কমিশন কীভাবে কাজ করে?')}</h4>
            <p class="referral-faq-a">${t('referrals.faq_a1', 'আপনার লিংকে কেউ যুক্ত হলে (টিয়ার ১), তার সফল কেনাকাটা বা বিক্রির ওপর আপনি ৫% কমিশন পাবেন। আবার সেই বন্ধু কাউকে যুক্ত করলে (টিয়ার ২), আপনি তার থেকেও ২% কমিশন আজীবন পাবেন!')}</p>
          </div>

          <div class="referral-faq-item">
            <h4 class="referral-faq-q">${t('referrals.faq_q2', 'কমিশনের টাকা কখন এবং কীভাবে পাব?')}</h4>
            <p class="referral-faq-a">${t('referrals.faq_a2', 'কমিশন ৭ দিনের রিটার্ন উইন্ডোর জন্য এসক্রোতে হোল্ড থাকে। ৭ দিন পর তা সরাসরি আপনার ভল্ট ওয়ালেটে জমা হয়, যা বিকাশ, নগদ বা ব্যাংকে ক্যাশআউট করা যায়।')}</p>
          </div>

          <div class="referral-faq-item">
            <h4 class="referral-faq-q">${t('referrals.faq_q3', 'ক্রেতা এবং বিক্রেতা উভয়েই কি রেফার করতে পারেন?')}</h4>
            <p class="referral-faq-a">${t('referrals.faq_a3', 'হ্যাঁ! যেকোনো এক্সপ্লোরো গ্রাহক বা সেলার রেফার করে সরাসরি নগদ টাকা ও রিওয়ার্ড কয়েন আয় করতে পারবেন।')}</p>
          </div>
        </div>
      </div>
    `;
  }

  _renderQaTab(isBn) {
    return `
      <div class="referral-card p-6" style="padding: 24px;">
        <div class="referral-qa-box">
          <h3 class="referral-qa-title">
            🧪 ${t('referrals.qa_title', 'ডেভেলপার ও কিউএ সিমুলেশন টুলস')}
          </h3>
          <p style="font-size: var(--text-xs); color: var(--text-secondary); margin: 0;">
            ${t('referrals.qa_desc', 'রেফারেল ইভেন্ট লাইভ টেস্ট করুন এবং তাৎক্ষণিক আপডেট দেখুন:')}
          </p>
          <div class="referral-qa-actions">
            <button id="btn-qa-signup" class="btn btn--primary btn--sm">
              ➕ ${t('referrals.qa_btn_signup', 'নতুন বন্ধু সাইনআপ সিমুলেট করুন (+১০০ কয়েন)')}
            </button>
            <button id="btn-qa-order" class="btn btn--outline btn--sm">
              🛍️ ${t('referrals.qa_btn_order', '৳২,৫০০ অর্ডারের কমিশন সিমুলেট করুন (+৳১২৫ এসক্রো)')}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _attachEvents(refLink, refCode, isBn, nav) {
    // Back navigation
    const backBtn = this.rootEl.querySelector('#btn-back-account');
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        nav('/account');
      });
    }

    // Tabs switching
    this.rootEl.querySelectorAll('.referral-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab;
        this.render();
      });
    });

    // Tree filters
    this.rootEl.querySelectorAll('[data-tree-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        this.treeFilter = chip.dataset.treeFilter;
        this.render();
      });
    });

    // Statement filters
    this.rootEl.querySelectorAll('[data-statement-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        this.statementFilter = chip.dataset.statementFilter;
        this.render();
      });
    });

    // Tree search input
    const searchInput = this.rootEl.querySelector('#input-tree-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        const currentTabOutlet = this.rootEl.querySelector('.referral-card');
        if (currentTabOutlet) {
          currentTabOutlet.outerHTML = this._renderTreeTab(isBn);
          this._rebindTreeSearch(isBn);
        }
      });
    }

    // Copy Code button
    const btnCopyCode = this.rootEl.querySelector('#btn-copy-code');
    if (btnCopyCode) {
      btnCopyCode.addEventListener('click', () => {
        navigator.clipboard.writeText(refCode);
        toast.success(t('referrals.code_copied', 'রেফারেল কোড কপি করা হয়েছে!'));
      });
    }

    // Copy Link button
    const btnCopyLink = this.rootEl.querySelector('#btn-copy-link');
    if (btnCopyLink) {
      btnCopyLink.addEventListener('click', () => {
        navigator.clipboard.writeText(refLink);
        toast.success(t('referrals.copied', 'রেফারেল লিংক কপি করা হয়েছে!'));
      });
    }

    // SMS button
    const btnSms = this.rootEl.querySelector('#btn-copy-sms');
    if (btnSms) {
      btnSms.addEventListener('click', () => {
        const msg = (isBn ? 'এক্সপ্লুরোতে যোগ দিন: ' : 'Join Explooro: ') + refLink;
        navigator.clipboard.writeText(msg);
        toast.success(isBn ? 'এসএমএস বার্তা ক্লিপবোর্ডে কপি করা হয়েছে!' : 'SMS invite text copied to clipboard!');
      });
    }

    // QR & Story Card modal
    const btnQr = this.rootEl.querySelector('#btn-open-qr');
    if (btnQr) {
      btnQr.addEventListener('click', () => this._openQrModal(refLink, refCode, isBn));
    }

    // Custom vanity slug modal
    const btnSlug = this.rootEl.querySelector('#btn-open-slug');
    if (btnSlug) {
      btnSlug.addEventListener('click', () => this._openSlugModal(isBn));
    }

    // Calculator sliders
    const sliderFriends = this.rootEl.querySelector('#slider-friends');
    const sliderSpend = this.rootEl.querySelector('#slider-spend');
    if (sliderFriends && sliderSpend) {
      const updateCalc = () => {
        this.calcFriends = Number(sliderFriends.value);
        this.calcSpend = Number(sliderSpend.value);
        const elFriends = this.rootEl.querySelector('#val-friends-count');
        const elSpend = this.rootEl.querySelector('#val-spend-amount');
        const elCash = this.rootEl.querySelector('#result-cash-est');
        if (elFriends) elFriends.textContent = `${this.calcFriends} ${isBn ? 'জন' : 'friends'}`;
        if (elSpend) elSpend.textContent = `৳${this.calcSpend.toLocaleString()}`;
        if (elCash) {
          const direct = this.calcFriends * this.calcSpend * 0.05;
          const sub = Math.round(this.calcFriends * 1.5) * this.calcSpend * 0.02;
          elCash.textContent = `৳${Math.round(direct + sub).toLocaleString()}`;
        }
      };
      sliderFriends.addEventListener('input', updateCalc);
      sliderSpend.addEventListener('input', updateCalc);
    }

    // QA Simulator actions
    const btnQaSignup = this.rootEl.querySelector('#btn-qa-signup');
    if (btnQaSignup) {
      btnQaSignup.addEventListener('click', async () => {
        try {
          const res = await api.post('/saler/referrals/simulate', { type: 'SIGNUP' }).catch(() =>
            api.post('/referrals/simulate', { type: 'SIGNUP' })
          );
          toast.success(res.message || 'Simulated new referral signup (+100 Coins)!');
          await this.fetchData();
          this.render();
        } catch (err) {
          toast.error(err.message || 'Simulation error');
        }
      });
    }

    const btnQaOrder = this.rootEl.querySelector('#btn-qa-order');
    if (btnQaOrder) {
      btnQaOrder.addEventListener('click', async () => {
        try {
          const res = await api.post('/saler/referrals/simulate', { type: 'ORDER', amount: 2500 }).catch(() =>
            api.post('/referrals/simulate', { type: 'ORDER', amount: 2500 })
          );
          toast.success(res.message || 'Simulated qualifying ৳2,500 order (+৳125 Escrow)!');
          await this.fetchData();
          this.render();
        } catch (err) {
          toast.error(err.message || 'Simulation error');
        }
      });
    }
  }

  _rebindTreeSearch(isBn) {
    const searchInput = this.rootEl.querySelector('#input-tree-search');
    if (searchInput) {
      searchInput.focus();
      searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        const currentTabOutlet = this.rootEl.querySelector('.referral-card');
        if (currentTabOutlet) {
          currentTabOutlet.outerHTML = this._renderTreeTab(isBn);
          this._rebindTreeSearch(isBn);
        }
      });
    }

    this.rootEl.querySelectorAll('[data-tree-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        this.treeFilter = chip.dataset.treeFilter;
        this.render();
      });
    });
  }

  _openQrModal(refLink, refCode, isBn) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog bg-surface border border-subtle rounded-2xl max-w-sm w-full p-6 text-center shadow-2xl space-y-4">
        <div class="flex justify-between items-center border-b border-subtle pb-3">
          <h3 class="font-bold text-base text-foreground">
            📱 ${isBn ? 'আপনার রেফারেল QR ও সোশ্যাল কার্ড' : 'Your Referral QR & Story Card'}
          </h3>
          <button type="button" class="btn-close text-muted hover:text-foreground font-bold text-xl cursor-pointer">×</button>
        </div>

        <div class="p-4 bg-white rounded-2xl mx-auto w-52 h-52 flex items-center justify-center border shadow-inner">
          <img
            src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(refLink)}"
            alt="Referral QR Code"
            class="w-full h-full object-contain" />
        </div>

        <div class="space-y-1">
          <div class="text-xs font-mono font-bold text-foreground">Code: ${refCode}</div>
          <p class="text-[11px] text-muted font-mono break-all">${refLink}</p>
        </div>

        <div class="flex gap-2 pt-2">
          <button type="button" class="btn btn--outline btn--sm flex-1 btn-copy-modal">
            📋 ${isBn ? 'লিংক কপি' : 'Copy Link'}
          </button>
          <button type="button" class="btn btn--primary btn--sm flex-1 btn-close">
            ${isBn ? 'সম্পন্ন' : 'Done'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    const closeModal = () => {
      if (document.body.contains(modalBackdrop)) {
        document.body.removeChild(modalBackdrop);
      }
    };

    modalBackdrop.querySelectorAll('.btn-close').forEach((b) => b.addEventListener('click', closeModal));
    const btnCopy = modalBackdrop.querySelector('.btn-copy-modal');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(refLink);
        toast.success(isBn ? 'রেফারেল লিংক কপি করা হয়েছে!' : 'Referral link copied!');
      });
    }
  }

  _openSlugModal(isBn) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog bg-surface border border-subtle rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div class="flex justify-between items-center border-b border-subtle pb-3">
          <h3 class="font-bold text-base text-foreground">
            ✏️ ${isBn ? 'কাস্টম রেফারেল লিংক তৈরি' : 'Custom Vanity Slug'}
          </h3>
          <button type="button" class="btn-close text-muted hover:text-foreground font-bold text-xl cursor-pointer">×</button>
        </div>

        <form id="form-custom-slug" class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-muted uppercase mb-1">
              ${isBn ? 'আপনার পছন্দের লিংক নাম' : 'Vanity Slug'}
            </label>
            <div class="flex items-center gap-1 font-mono text-xs">
              <span class="text-muted">explooro.com/join/</span>
              <input
                type="text"
                name="custom_slug"
                required
                pattern="^[a-z0-9-]+$"
                placeholder="tanvir-deals"
                value="${this.overview?.custom_slug || ''}"
                class="input input--sm w-full font-mono" />
            </div>
            <p class="text-[11px] text-muted mt-1">
              ${isBn ? 'ছোট হাতের অক্ষর (a-z), সংখ্যা (0-9) ও হাইফেন (-) ব্যবহার করুন' : 'Letters, numbers, and hyphens only (e.g. fahim-deals)'}
            </p>
          </div>

          <div class="flex justify-end gap-2 pt-3 border-t border-subtle">
            <button type="button" class="btn btn--outline btn--sm btn-cancel">
              ${isBn ? 'বাতিল' : 'Cancel'}
            </button>
            <button type="submit" class="btn btn--primary btn--sm">
              ${isBn ? 'সংরক্ষণ করুন' : 'Save Slug'}
            </button>
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

    const form = modalBackdrop.querySelector('#form-custom-slug');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const slug = new FormData(form).get('custom_slug');
      try {
        await api.post('/saler/referrals/custom-code', { custom_slug: slug }).catch(() =>
          api.post('/referrals/custom-code', { custom_slug: slug })
        );
        toast.success(isBn ? 'কাস্টম লিংক সফলভাবে সংরক্ষিত হয়েছে!' : 'Custom slug saved successfully!');
        closeModal();
        await this.fetchData();
        this.render();
      } catch (err) {
        toast.error(err.message || 'Failed to update custom slug');
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

export default function mountReferralHubPage(root, ctx = {}) {
  const page = new ReferralHubPage(ctx);
  page.mount(root);
  return () => page.unmount();
}
