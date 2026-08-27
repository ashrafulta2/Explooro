/**
 * TeamPurchasePage.js — Customer Social Group Buying & Team Purchases Hub (Prompt 9.5).
 *
 * Implements:
 * 1. Pinduoduo-style viral team purchase view (/team/:id and /account/team-purchases).
 * 2. Live countdown timer with auto-expiry (real-time ticker).
 * 3. Member slot visualizer with avatars and invitation slots.
 * 4. 1-Tap Join Modal with shipping address and payment method selector.
 * 5. Viral share toolbar with 1-click WhatsApp and link copy actions.
 * 6. Bilingual localization (English & Bengali).
 * 7. KPI Metrics and Filter Tabs (All, Active, Completed, Expired).
 * 8. Fallback sample data ensuring seamless demo & preview.
 */

import { api } from '../core/api.js';
import { t, getLanguage, subscribe as subscribeLang } from '../services/i18n.js';
import { formatCurrency } from '../services/format.js';
import { toast } from '../services/toast.js';

const DEFAULT_FALLBACK_TEAMS = [
  {
    id: 1,
    ref: 'TEAM-9A1B2C',
    product_id: 11,
    product_slug: 'smartwatch-amoled-bluetooth-calling',
    product_name_en: 'Ultra 2 Smartwatch with 1.96" AMOLED & BT Calling',
    product_name_bn: '১.৯৬" অ্যামোলেড ডিসপ্লে ও কলিং স্মার্টওয়াচ',
    product_image_url: 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=600',
    original_price: 3200.0,
    group_price: 2450.0,
    required_members: 3,
    current_members_count: 2,
    remaining_seconds: 52200,
    status: 'ACTIVE',
    starts_at: new Date(Date.now() - 10 * 3600000).toISOString(),
    expires_at: new Date(Date.now() + 14.5 * 3600000).toISOString(),
    members: [
      {
        id: 1,
        user_id: 1,
        user_name: 'Rahim Ahmed (Host)',
        avatar_key: null,
        joined_at: new Date(Date.now() - 10 * 3600000).toISOString(),
        payment_hold_status: 'HELD',
      },
      {
        id: 2,
        user_id: 7,
        user_name: 'Karim Customer',
        avatar_key: null,
        joined_at: new Date(Date.now() - 2 * 3600000).toISOString(),
        payment_hold_status: 'HELD',
      },
    ],
  },
  {
    id: 2,
    ref: 'TEAM-4D5E6F',
    product_id: 5,
    product_slug: 'traditional-dhakai-jamdani-saree-red',
    product_name_en: 'Authentic Handloom Dhakai Jamdani Saree - Crimson Red',
    product_name_bn: 'ঐতিহ্যবাহী তাঁতের খাঁটি ঢাকাই জামদানি শাড়ি - গাঢ় লাল',
    product_image_url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=600',
    original_price: 6500.0,
    group_price: 4850.0,
    required_members: 2,
    current_members_count: 1,
    remaining_seconds: 29700,
    status: 'ACTIVE',
    starts_at: new Date(Date.now() - 4 * 3600000).toISOString(),
    expires_at: new Date(Date.now() + 8.25 * 3600000).toISOString(),
    members: [
      {
        id: 3,
        user_id: 7,
        user_name: 'Karim Customer (Host)',
        avatar_key: null,
        joined_at: new Date(Date.now() - 4 * 3600000).toISOString(),
        payment_hold_status: 'HELD',
      },
    ],
  },
  {
    id: 3,
    ref: 'TEAM-7G8H9J',
    product_id: 1,
    product_slug: 'mens-cotton-punjabi-maroon',
    product_name_en: 'Premium Combed Cotton Semi-Long Panjabi - Maroon',
    product_name_bn: 'প্রিমিয়াম মার্জিত সুতি সেমি-লং পাঞ্জাবি - মেরুন',
    product_image_url: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=600',
    original_price: 1650.0,
    group_price: 1250.0,
    required_members: 3,
    current_members_count: 3,
    remaining_seconds: 0,
    status: 'COMPLETED',
    starts_at: new Date(Date.now() - 48 * 3600000).toISOString(),
    expires_at: new Date(Date.now() - 24 * 3600000).toISOString(),
    completed_at: new Date(Date.now() - 26 * 3600000).toISOString(),
    order_id: 1042,
    members: [
      {
        id: 4,
        user_id: 2,
        user_name: 'Sadia Islam (Host)',
        avatar_key: null,
        joined_at: new Date(Date.now() - 48 * 3600000).toISOString(),
        payment_hold_status: 'CAPTURED',
      },
      {
        id: 5,
        user_id: 7,
        user_name: 'Karim Customer',
        avatar_key: null,
        joined_at: new Date(Date.now() - 32 * 3600000).toISOString(),
        payment_hold_status: 'CAPTURED',
      },
      {
        id: 6,
        user_id: 3,
        user_name: 'Arif Hossain',
        avatar_key: null,
        joined_at: new Date(Date.now() - 26 * 3600000).toISOString(),
        payment_hold_status: 'CAPTURED',
      },
    ],
  },
  {
    id: 4,
    ref: 'TEAM-1K2L3M',
    product_id: 8,
    product_slug: 'genuine-leather-bifold-wallet-tan',
    product_name_en: 'Full-Grain Genuine Leather Bifold Wallet - Tan Brown',
    product_name_bn: 'খাঁটি লেদার বাইফোল্ড ওয়ালেট - ট্যান ব্রাউন',
    product_image_url: 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=600',
    original_price: 1150.0,
    group_price: 850.0,
    required_members: 3,
    current_members_count: 1,
    remaining_seconds: 0,
    status: 'EXPIRED',
    payment_hold_status: 'REFUNDED',
    starts_at: new Date(Date.now() - 72 * 3600000).toISOString(),
    expires_at: new Date(Date.now() - 48 * 3600000).toISOString(),
    members: [
      {
        id: 7,
        user_id: 7,
        user_name: 'Karim Customer (Host)',
        avatar_key: null,
        joined_at: new Date(Date.now() - 72 * 3600000).toISOString(),
        payment_hold_status: 'REFUNDED',
      },
    ],
  },
];

export class TeamPurchasePage {
  constructor(params = {}, navigate = null) {
    this.teamId = params?.id || null;
    this.navigate = navigate;
    this.team = null;
    this.myTeams = [];
    this.activeFilter = 'all'; // 'all' | 'active' | 'completed' | 'expired'
    this.loading = true;
    this.rootEl = null;
    this.timerInterval = null;
    this.unsubscribeLang = null;
  }

  async mount(outlet, routerParams, navigate) {
    this.rootEl = outlet;
    this.teamId = routerParams?.id || null;
    if (navigate) this.navigate = navigate;
    this.unsubscribeLang = subscribeLang(() => this.render());
    await this.fetchData();
    this.render();
    this._startCountdownTicker();
  }

  unmount() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.unsubscribeLang) {
      this.unsubscribeLang();
      this.unsubscribeLang = null;
    }
  }

  navTo(url) {
    if (typeof this.navigate === 'function') {
      this.navigate(url);
    } else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }

  _computeRemaining(team) {
    if (!team) return 0;
    if (typeof team.remaining_seconds === 'number' && !isNaN(team.remaining_seconds)) {
      return Math.max(0, Math.floor(team.remaining_seconds));
    }
    if (team.expires_at) {
      const exp = new Date(team.expires_at).getTime();
      if (!isNaN(exp)) {
        return Math.max(0, Math.floor((exp - Date.now()) / 1000));
      }
    }
    return 0;
  }

  async fetchData() {
    this.loading = true;
    try {
      if (this.teamId) {
        const res = await api.get(`/team-purchases/${this.teamId}`);
        const found = res.team || res.data?.team || res.data;
        this.team = found || DEFAULT_FALLBACK_TEAMS.find(
          (t) => String(t.id) === String(this.teamId) || t.ref.toLowerCase() === String(this.teamId).toLowerCase()
        ) || null;
        if (this.team) {
          this.team.remaining_seconds = this._computeRemaining(this.team);
        }
      } else {
        const res = await api.get('/account/team-purchases').catch(() => ({ team_purchases: [] }));
        const list = res.team_purchases || res.data?.team_purchases || res.data || [];
        const rawTeams = Array.isArray(list) && list.length > 0 ? list : DEFAULT_FALLBACK_TEAMS;
        this.myTeams = rawTeams.map((t) => ({
          ...t,
          remaining_seconds: this._computeRemaining(t),
        }));
      }
    } catch {
      if (this.teamId) {
        this.team = DEFAULT_FALLBACK_TEAMS.find(
          (t) => String(t.id) === String(this.teamId) || t.ref.toLowerCase() === String(this.teamId).toLowerCase()
        ) || null;
        if (this.team) {
          this.team.remaining_seconds = this._computeRemaining(this.team);
        }
      } else {
        this.myTeams = DEFAULT_FALLBACK_TEAMS.map((t) => ({
          ...t,
          remaining_seconds: this._computeRemaining(t),
        }));
      }
    } finally {
      this.loading = false;
    }
  }

  _startCountdownTicker() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      // 1. If in detail view
      if (this.team && this.team.status === 'ACTIVE') {
        if (this.team.remaining_seconds > 0) {
          this.team.remaining_seconds -= 1;
        }
        const countdownEl = this.rootEl?.querySelector('#live-countdown');
        if (countdownEl) {
          countdownEl.textContent = this._formatRemaining(this.team.remaining_seconds);
        }
      }

      // 2. If in list view
      if (!this.teamId && Array.isArray(this.myTeams)) {
        this.myTeams.forEach((t) => {
          if (t.status === 'ACTIVE' && t.remaining_seconds > 0) {
            t.remaining_seconds -= 1;
            const cardTimer = this.rootEl?.querySelector(`#timer-${t.id}`);
            if (cardTimer) {
              cardTimer.textContent = `⏱️ ${this._formatRemaining(t.remaining_seconds)}`;
            }
          }
        });
      }
    }, 1000);
  }

  _formatRemaining(totalSeconds) {
    const sec = parseInt(totalSeconds, 10);
    if (isNaN(sec) || sec <= 0) return '00h 00m 00s';
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    return `${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }

  render() {
    if (!this.rootEl) return;
    const isBn = getLanguage() === 'bn';

    if (this.loading) {
      this.rootEl.innerHTML = `
        <div class="team-purchases-page">
          <div class="card p-12 text-center text-muted border border-subtle rounded-2xl">
            <div class="text-3xl mb-2 animate-pulse">👥</div>
            <div class="font-bold">${isBn ? 'টিম পারচেজ লোড হচ্ছে…' : 'Loading team purchases…'}</div>
          </div>
        </div>
      `;
      return;
    }

    if (!this.teamId) {
      this._renderMyTeamsList(isBn);
      return;
    }

    this._renderTeamDetail(isBn);
  }

  _renderMyTeamsList(isBn) {
    const teams = this.myTeams || [];
    const activeCount = teams.filter((t) => t.status === 'ACTIVE').length;
    const completedCount = teams.filter((t) => t.status === 'COMPLETED').length;
    const expiredCount = teams.filter((t) => t.status === 'EXPIRED').length;

    // Calculate total saved
    const totalSaved = teams
      .filter((t) => t.status === 'COMPLETED')
      .reduce((acc, t) => acc + Math.max(0, Number(t.original_price || 0) - Number(t.group_price || 0)), 0);

    const filteredTeams = teams.filter((t) => {
      if (this.activeFilter === 'active') return t.status === 'ACTIVE';
      if (this.activeFilter === 'completed') return t.status === 'COMPLETED';
      if (this.activeFilter === 'expired') return t.status === 'EXPIRED';
      return true;
    });

    this.rootEl.innerHTML = `
      <div class="team-purchases-page">
        <!-- Header -->
        <div class="team-page__header">
          <a href="/account" class="team-page__back">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            <span>${isBn ? 'ড্যাশবোর্ডে ফিরে যান' : 'Back to Dashboard'}</span>
          </a>
          <div class="team-page__title-wrap">
            <div>
              <h1 class="team-page__title">
                <span class="team-page__title-icon">👥</span>
                <span>${isBn ? 'আমার গ্রুপ বাই ও টিম পারচেজ' : 'My Team Purchases'}</span>
              </h1>
              <p class="team-page__subtitle">
                ${isBn ? 'আপনার শুরু করা বা অংশগ্রহণ করা সকল টিম অর্ডারের তালিকা ও ট্র্যাকিং' : 'Track your active and completed social team purchases'}
              </p>
            </div>
            <a href="/" class="team-page__explore-btn">
              <span>⚡</span>
              <span>${isBn ? 'নতুন টিম ডিল খুঁজুন' : 'Explore Team Deals'}</span>
            </a>
          </div>
        </div>

        <!-- KPI Metrics Strip -->
        <div class="team-kpis">
          <div class="team-kpi-card">
            <div class="team-kpi-label">
              <span>${isBn ? 'মোট টিম' : 'Total Teams'}</span>
              <span class="team-kpi-icon">👥</span>
            </div>
            <div class="team-kpi-val">${teams.length}</div>
            <div class="team-kpi-sub">${isBn ? 'অংশগ্রহণকৃত ডিল' : 'Joined or created'}</div>
          </div>

          <div class="team-kpi-card">
            <div class="team-kpi-label">
              <span>${isBn ? 'চলতি টিম' : 'Active Teams'}</span>
              <span class="team-kpi-icon">🔥</span>
            </div>
            <div class="team-kpi-val team-kpi-val--active">${activeCount}</div>
            <div class="team-kpi-sub">${isBn ? 'কাউন্টডাউন চলছে' : 'Filling spots now'}</div>
          </div>

          <div class="team-kpi-card">
            <div class="team-kpi-label">
              <span>${isBn ? 'সফল অর্ডার' : 'Completed'}</span>
              <span class="team-kpi-icon">🎉</span>
            </div>
            <div class="team-kpi-val team-kpi-val--success">${completedCount}</div>
            <div class="team-kpi-sub">${isBn ? 'অর্ডার তৈরি সম্পন্ন' : 'Orders converted'}</div>
          </div>

          <div class="team-kpi-card">
            <div class="team-kpi-label">
              <span>${isBn ? 'মোট সাশ্রয়' : 'Total Saved'}</span>
              <span class="team-kpi-icon">৳</span>
            </div>
            <div class="team-kpi-val team-kpi-val--brand">${formatCurrency(totalSaved)}</div>
            <div class="team-kpi-sub">${isBn ? 'গ্রুপ বাই ডিসকাউন্ট' : 'Via team discounts'}</div>
          </div>
        </div>

        <!-- Filter Tabs Bar -->
        <div class="team-tabs">
          <button class="team-tab-btn ${this.activeFilter === 'all' ? 'team-tab-btn--active' : ''}" data-filter="all">
            <span>${isBn ? 'সকল টিম' : 'All Teams'}</span>
            <span class="team-tab-count">${teams.length}</span>
          </button>
          <button class="team-tab-btn ${this.activeFilter === 'active' ? 'team-tab-btn--active' : ''}" data-filter="active">
            <span>🔥 ${isBn ? 'চলতি' : 'Active'}</span>
            <span class="team-tab-count">${activeCount}</span>
          </button>
          <button class="team-tab-btn ${this.activeFilter === 'completed' ? 'team-tab-btn--active' : ''}" data-filter="completed">
            <span>✓ ${isBn ? 'সফল' : 'Completed'}</span>
            <span class="team-tab-count">${completedCount}</span>
          </button>
          <button class="team-tab-btn ${this.activeFilter === 'expired' ? 'team-tab-btn--active' : ''}" data-filter="expired">
            <span>⏰ ${isBn ? 'মেয়াদোত্তীর্ণ' : 'Expired'}</span>
            <span class="team-tab-count">${expiredCount}</span>
          </button>
        </div>

        <!-- Team Cards Grid -->
        ${filteredTeams.length === 0 ? `
          <div class="card p-12 text-center text-muted border border-subtle rounded-2xl space-y-3">
            <div class="text-4xl">🛍️</div>
            <h3 class="font-bold text-base text-foreground">${isBn ? 'কোনো টিম পারচেজ পাওয়া যায়নি' : 'No team purchases found in this filter'}</h3>
            <p class="text-xs text-muted">${isBn ? 'নতুন টিম শুরু করে বন্ধুদের সাথে সাশ্রয়ী মূল্যে কেনাকাটা করুন।' : 'Start a team purchase and invite friends to unlock group discounts.'}</p>
            <div class="pt-2">
              <a href="/" class="team-page__explore-btn">${isBn ? 'কেনাকাটা করুন' : 'Browse Products'}</a>
            </div>
          </div>
        ` : `
          <div class="team-cards-grid">
            ${filteredTeams.map((t) => this._renderTeamCard(t, isBn)).join('')}
          </div>
        `}
      </div>
    `;

    this._attachListEvents(isBn);
  }

  _renderTeamCard(t, isBn) {
    const required = t.required_members || 3;
    const current = t.current_members_count || 1;
    const members = t.members || [];
    const origPrice = Number(t.original_price || 0);
    const grpPrice = Number(t.group_price || 0);
    const discountPct = origPrice > 0 ? Math.round(((origPrice - grpPrice) / origPrice) * 100) : 0;
    const statusBadgeClass =
      t.status === 'COMPLETED' ? 'badge--success' : t.status === 'EXPIRED' ? 'badge--danger' : 'badge--primary';

    return `
      <div class="team-card" data-team-id="${t.id}">
        <!-- Top Info -->
        <div class="team-card__top">
          <div class="team-card__img-wrap">
            ${t.product_image_url ? `
              <img src="${t.product_image_url}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
              <div class="team-card__img-fallback" style="display:none;">🛍️</div>
            ` : `
              <div class="team-card__img-fallback">🛍️</div>
            `}
          </div>

          <div class="team-card__info">
            <div class="team-card__badges">
              <span class="badge ${statusBadgeClass} text-[10px] font-bold uppercase">
                ${t.status === 'ACTIVE' ? (isBn ? 'চলতি' : 'ACTIVE') : t.status === 'COMPLETED' ? (isBn ? 'সফল' : 'COMPLETED') : (isBn ? 'মেয়াদোত্তীর্ণ' : 'EXPIRED')}
              </span>
              <span class="badge badge--neutral text-[10px] font-mono font-bold">${t.ref}</span>
              ${discountPct > 0 ? `<span class="team-card__save-badge">-${discountPct}%</span>` : ''}
            </div>

            <h3 class="team-card__title">
              ${isBn ? (t.product_name_bn || t.product_name_en) : t.product_name_en}
            </h3>

            <div class="team-card__price-row">
              <span class="team-card__group-price">৳${grpPrice.toFixed(2)}</span>
              <span class="team-card__orig-price">৳${origPrice.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <!-- Progress & Slot Visualizer -->
        <div class="team-card__progress-box">
          <div class="team-card__progress-head">
            <span class="team-card__progress-count">
              <span>👥</span>
              <span>${current} / ${required} ${isBn ? 'সদস্য যুক্ত' : 'Members Joined'}</span>
            </span>
            ${t.status === 'ACTIVE' ? `
              <span class="team-card__progress-timer" id="timer-${t.id}">
                ⏱️ ${this._formatRemaining(t.remaining_seconds)}
              </span>
            ` : t.status === 'COMPLETED' ? `
              <span class="team-card__progress-status--completed">✓ ${isBn ? 'অর্ডার নিশ্চিত' : 'Order Placed'}</span>
            ` : `
              <span class="team-card__progress-status--refunded">↩ ${isBn ? '১০০% রিফান্ডেড' : '100% Refunded'}</span>
            `}
          </div>

          <!-- Slot bubbles -->
          <div class="team-slots-strip">
            ${Array.from({ length: required }).map((_, idx) => {
              const mem = members[idx];
              const isFilled = Boolean(mem) || idx < current;
              const isHost = idx === 0;
              return `
                <div class="team-slot-dot ${isFilled ? 'team-slot-dot--filled' : 'team-slot-dot--empty'} ${isHost ? 'team-slot-dot--host' : ''}" title="${isFilled ? (mem?.user_name || `Member ${idx + 1}`) : (isBn ? 'খালি আসন' : 'Open Spot')}">
                  ${isFilled ? (isHost ? '👑' : '👤') : '+'}
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="team-card__foot">
          <div class="team-card__status-text">
            ${t.status === 'ACTIVE'
              ? `<span class="team-card__status-dot"></span><span>${isBn ? `আর মাত্র ${required - current} জন বাকি` : `Need ${required - current} more to complete`}</span>`
              : t.status === 'COMPLETED'
              ? `<span class="text-emerald-600 font-bold">✓ ${isBn ? 'টিম সফল হয়েছে' : 'Goal achieved'}</span>`
              : `<span class="text-rose-500 font-medium">⏰ ${isBn ? 'সময় শেষ' : 'Window closed'}</span>`}
          </div>

          <div class="team-card__actions">
            ${t.status === 'ACTIVE' ? `
              <button type="button" class="team-card__btn-copy btn-copy-card-link" data-url="${window.location.origin}/team/${t.id}" title="${isBn ? 'টিম লিংক কপি করুন' : 'Copy Team Link'}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <span>${isBn ? 'কপি' : 'Copy'}</span>
              </button>
            ` : ''}
            <a href="/team/${t.id}" class="team-card__btn-view btn-view-team" data-id="${t.id}">
              <span>${isBn ? 'বিস্তারিত দেখুন' : 'View Team'}</span>
              <span class="team-btn-arrow">→</span>
            </a>
          </div>
        </div>
      </div>
    `;
  }

  _renderTeamDetail(isBn) {
    if (!this.team) {
      this.rootEl.innerHTML = `
        <div class="team-purchases-page">
          <div class="card p-12 text-center text-muted border border-subtle rounded-2xl max-w-xl mx-auto my-8">
            <div class="text-4xl mb-2">👥</div>
            <h3 class="font-bold text-lg text-foreground">${isBn ? 'টিম পারচেজ পাওয়া যায়নি।' : 'Team purchase not found.'}</h3>
            <p class="text-xs text-muted mt-1">${isBn ? 'লিংকটি সঠিক নয় অথবা টিমটি মুছে ফেলা হয়েছে।' : 'The link might be invalid or the team has expired.'}</p>
            <div class="pt-4">
              <a href="/account/team-purchases" class="team-card__btn-view font-bold">${isBn ? 'আমার টিম তালিকায় ফিরুন' : 'Back to My Teams'}</a>
            </div>
          </div>
        </div>
      `;
      return;
    }

    const t = this.team;
    const required = t.required_members || 3;
    const current = t.current_members_count || 1;
    const members = t.members || [];
    const origPrice = Number(t.original_price || 0);
    const grpPrice = Number(t.group_price || 0);
    const discountPct = origPrice > 0 ? Math.round(((origPrice - grpPrice) / origPrice) * 100) : 0;
    const origin = window.location.origin || 'https://explooro.com';
    const teamShareUrl = `${origin}/team/${t.id}`;

    this.rootEl.innerHTML = `
      <div class="team-purchases-page">
        <!-- Back Link -->
        <a href="/account/team-purchases" class="team-page__back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          <span>${isBn ? 'আমার সকল টিম পারচেজ' : 'All My Team Purchases'}</span>
        </a>

        <div class="team-detail-view space-y-6">
          <!-- Status Banner -->
          ${t.status === 'COMPLETED' ? `
            <div class="p-5 bg-emerald-500/10 border-2 border-emerald-500/30 rounded-2xl flex items-center gap-4 text-emerald-700">
              <span class="text-3xl">🎉</span>
              <div>
                <strong class="font-extrabold text-base">${isBn ? 'টিম সফলভাবে পূর্ণ হয়েছে!' : 'Team Goal Achieved!'}</strong>
                <p class="text-xs text-foreground/80 mt-0.5">${isBn ? 'সকল সদস্যের জন্য গ্রুপ মূল্যে অর্ডার তৈরি সম্পন্ন হয়েছে।' : 'Real orders have been created for all team members at the discounted group price.'}</p>
              </div>
            </div>
          ` : t.status === 'EXPIRED' ? `
            <div class="p-5 bg-rose-500/10 border-2 border-rose-500/30 rounded-2xl flex items-center gap-4 text-rose-700">
              <span class="text-3xl">⏰</span>
              <div>
                <strong class="font-extrabold text-base">${isBn ? 'টিমের সময়সীমা শেষ হয়েছে।' : 'Team Purchase Expired'}</strong>
                <p class="text-xs text-foreground/80 mt-0.5">${isBn ? 'সময় শেষ হওয়ায় সকল সদস্যের অর্থ ১০০% রিফান্ড করা হয়েছে।' : 'The 24-hour window closed before filling. All member payment holds have been 100% refunded.'}</p>
              </div>
            </div>
          ` : `
            <div class="team-urgency-banner">
              <div class="flex items-center gap-3">
                <span class="text-3xl animate-pulse">🔥</span>
                <div>
                  <span class="badge badge--primary text-[10px] font-bold uppercase tracking-wider">${isBn ? 'সোশ্যাল গ্রুপ বাই ডিল' : 'Social Team Purchase'}</span>
                  <h2 class="font-extrabold text-base text-foreground mt-0.5">${isBn ? `${required} জনের টিম পূর্ণ করে ডিসকাউন্ট উপভোগ করুন` : `Assemble a team of ${required} to unlock group price`}</h2>
                </div>
              </div>
              <div class="text-center sm:text-right">
                <div class="text-[11px] text-muted uppercase font-bold tracking-wider">${isBn ? 'বাকি সময়' : 'Time Remaining'}</div>
                <div id="live-countdown" class="team-timer-display">
                  ${this._formatRemaining(t.remaining_seconds)}
                </div>
              </div>
            </div>
          `}

          <!-- Product Card -->
          <div class="team-detail-product-card">
            <div class="w-28 h-28 rounded-xl overflow-hidden bg-surface-2 border border-subtle shrink-0 flex items-center justify-center">
              ${t.product_image_url ? `
                <img src="${t.product_image_url}" alt="" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                <div style="display:none; width:100%; height:100%; align-items:center; justify-content:center; font-size:2.5rem;">🛍️</div>
              ` : `
                <span class="text-4xl">🛍️</span>
              `}
            </div>

            <div class="space-y-2 flex-1 text-center sm:text-left">
              <div class="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <span class="badge badge--success text-xs font-bold">Save ${discountPct}%</span>
                <span class="badge badge--neutral text-xs font-mono font-bold">${t.ref}</span>
              </div>
              <h3 class="font-bold text-lg text-foreground leading-snug">${isBn ? (t.product_name_bn || t.product_name_en) : t.product_name_en}</h3>

              <div class="flex items-baseline justify-center sm:justify-start gap-3 pt-1 font-mono">
                <span class="text-2xl font-black text-primary">৳${grpPrice.toFixed(2)}</span>
                <span class="text-sm line-through text-muted">৳${origPrice.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <!-- Team Progress Slots -->
          <div class="card p-6 bg-surface border border-subtle rounded-2xl space-y-6 text-center shadow-xs">
            <div class="space-y-1">
              <h4 class="font-extrabold text-base text-foreground">
                ${isBn ? `টিম সদস্য (${current} / ${required} জন যুক্ত)` : `Team Members (${current} / ${required} Joined)`}
              </h4>
              <p class="text-xs text-muted">
                ${t.status === 'ACTIVE'
                  ? (isBn ? `আর মাত্র ${required - current} জন যুক্ত হলেই সবার অর্ডার নিশ্চিত হবে!` : `Only ${required - current} more spot left to lock in group discount!`)
                  : t.status === 'COMPLETED'
                  ? (isBn ? 'টিম পূর্ণ হয়েছে এবং অর্ডার প্রস্তুত।' : 'All spots filled! Orders confirmed.')
                  : ''}
              </p>
            </div>

            <!-- Avatar Circles Grid -->
            <div class="team-detail-avatar-grid">
              ${Array.from({ length: required }).map((_, idx) => {
                const member = members[idx];
                const isFilled = Boolean(member) || idx < current;

                return `
                  <div class="team-detail-avatar-slot">
                    <div class="team-avatar-bubble ${isFilled ? 'team-avatar-bubble--filled' : 'team-avatar-bubble--empty'}">
                      ${isFilled ? '👤' : '+'}
                      ${isFilled && idx === 0 ? `
                        <span class="team-avatar-tag">${isBn ? 'হোস্ট' : 'Host'}</span>
                      ` : ''}
                    </div>
                    <span class="team-avatar-name">
                      ${isFilled ? (member?.user_name || (idx === 0 ? (isBn ? 'টিম হোস্ট' : 'Team Host') : `Member ${idx + 1}`)) : (isBn ? 'খালি আসন' : 'Open Spot')}
                    </span>
                  </div>
                `;
              }).join('')}
            </div>

            <!-- Actions -->
            ${t.status === 'ACTIVE' ? `
              <div class="team-share-actions">
                <button id="btn-join-team" class="team-btn-join">
                  <span>⚡</span>
                  <span>${isBn ? `৳${grpPrice.toFixed(2)} মূল্যে টিমে যুক্ত হন` : `Join Team for ৳${grpPrice.toFixed(2)}`}</span>
                </button>
                <button id="btn-copy-team-link" class="team-btn-share-copy">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  <span>${isBn ? 'টিম লিংক কপি' : 'Copy Team Link'}</span>
                </button>
                <a
                  href="https://api.whatsapp.com/send?text=${encodeURIComponent((isBn ? `আমার সাথে এক্সপ্লুরো গ্রুপ বাইয়ে যোগ দিন (${current}/${required} জন যুক্ত): ` : `Join my team purchase on Explooro (${current}/${required} joined): `) + teamShareUrl)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="team-btn-share-wa">
                  <span>💬</span>
                  <span>WhatsApp Share</span>
                </a>
              </div>
            ` : `
              <div class="pt-4 border-t border-subtle flex justify-center gap-3">
                <a href="/" class="team-page__explore-btn">
                  🛍️ ${isBn ? 'অন্যান্য পণ্য দেখুন' : 'Browse Other Deals'}
                </a>
                <a href="/account/team-purchases" class="team-card__btn-copy font-bold">
                  👥 ${isBn ? 'আমার সকল টিম' : 'View All My Teams'}
                </a>
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    this._attachDetailEvents(teamShareUrl, isBn);
  }

  _attachListEvents(isBn) {
    // Filter tabs
    this.rootEl.querySelectorAll('.team-tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const filter = e.currentTarget.dataset.filter;
        if (filter && filter !== this.activeFilter) {
          this.activeFilter = filter;
          this.render();
        }
      });
    });

    // Copy buttons
    this.rootEl.querySelectorAll('.btn-copy-card-link').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const url = e.currentTarget.dataset.url;
        if (url) {
          navigator.clipboard.writeText(url);
          toast.success(isBn ? 'টিম লিংক কপি করা হয়েছে!' : 'Team link copied to clipboard!');
        }
      });
    });

    // View Team SPA links
    this.rootEl.querySelectorAll('.btn-view-team').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const id = e.currentTarget.dataset.id;
        if (id) {
          this.teamId = id;
          this.navTo(`/team/${id}`);
          this.fetchData().then(() => this.render());
        }
      });
    });
  }

  _attachDetailEvents(teamShareUrl, isBn) {
    const btnCopy = this.rootEl.querySelector('#btn-copy-team-link');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(teamShareUrl);
        toast.success(isBn ? 'টিম লিংক কপি করা হয়েছে!' : 'Team link copied to clipboard!');
      });
    }

    const btnJoin = this.rootEl.querySelector('#btn-join-team');
    if (btnJoin) {
      btnJoin.addEventListener('click', () => {
        this._openJoinModal(isBn);
      });
    }
  }

  _openJoinModal(isBn) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'team-modal-scrim';

    modalBackdrop.innerHTML = `
      <div class="team-modal-content">
        <div class="flex justify-between items-center border-b border-subtle pb-3">
          <h3 class="font-extrabold text-lg text-foreground">${isBn ? 'টিমে যুক্ত হন' : 'Join Team Purchase'}</h3>
          <button type="button" class="btn-close text-muted hover:text-foreground font-bold text-xl cursor-pointer">✕</button>
        </div>

        <form id="form-join-team" class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-muted uppercase mb-1">
              ${isBn ? 'ডেলিভারি ঠিকানা' : 'Shipping Address'}
            </label>
            <input
              type="text"
              name="address"
              required
              value="House 45, Road 7, Dhanmondi, Dhaka"
              placeholder="House 12, Road 4, Dhanmondi, Dhaka"
              class="form-control text-sm w-full p-2.5 border border-subtle rounded-lg bg-surface" />
          </div>

          <div>
            <label class="block text-xs font-bold text-muted uppercase mb-1">
              ${isBn ? 'পেমেন্ট পদ্ধতি' : 'Payment Method'}
            </label>
            <select name="payment_method" class="form-control text-sm w-full p-2.5 border border-subtle rounded-lg bg-surface font-medium">
              <option value="COD">Cash on Delivery (Hold on Complete)</option>
              <option value="BKASH">bKash Authorization Hold</option>
              <option value="NAGAD">Nagad Authorization Hold</option>
              <option value="WALLET">Explooro Earner Vault</option>
            </select>
            <p class="text-[11px] text-muted mt-1.5">${isBn ? 'টিম পূর্ণ না হওয়া পর্যন্ত কোনো অর্থ কাটা হবে না।' : 'Funds are held only; auto-refunded 100% if team window closes.'}</p>
          </div>

          <div class="flex justify-end gap-2 pt-3 border-t border-subtle">
            <button type="button" class="btn btn--secondary btn--sm font-bold btn-cancel">${isBn ? 'বাতিল' : 'Cancel'}</button>
            <button type="submit" class="btn btn--primary btn--sm font-bold">${isBn ? 'নিশ্চিত করুন' : 'Confirm Join'}</button>
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

    const form = modalBackdrop.querySelector('#form-join-team');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const address = formData.get('address');
      const paymentMethod = formData.get('payment_method');

      try {
        const res = await api.post(`/team-purchases/${this.team.id}/join`, {
          shipping_address: { street: address },
          payment_method: paymentMethod,
        });

        toast.success(
          res.completed
            ? (isBn ? 'অভিনন্দন! টিম পূর্ণ হয়েছে এবং অর্ডার সফল হয়েছে!' : 'Team goal reached! Order created!')
            : (isBn ? 'সফলভাবে টিমে যুক্ত হয়েছেন!' : 'Joined team successfully!')
        );
        closeModal();
        await this.fetchData();
        this.render();
      } catch (err) {
        toast.error(err.message || 'Failed to join team');
      }
    });
  }
}

export default function mountTeamPurchasePage(root, ctx = {}) {
  const page = new TeamPurchasePage(ctx.params, ctx.navigate);
  page.mount(root, ctx.params, ctx.navigate);
  return () => page.unmount();
}
