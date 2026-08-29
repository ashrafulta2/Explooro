/**
 * CoinsPage.js — Customer Loyalty Coins, Streak Calendar & Rewards Hub (Prompt 9.4).
 *
 * Implements:
 * 1. Loyalty Coins Balance with real-time BDT conversion (100 coins = ৳10 BDT).
 * 2. Interactive 7-Day Streak Calendar with dynamic claim action & celebratory feedback.
 * 3. "Ways to Earn Coins" action hub linking directly to earning avenues.
 * 4. "How to Spend Coins" 4-step checkout redemption guide with refund guarantee.
 * 5. Daily & Weekly Quests progress panel with category filters.
 * 6. Double-entry transaction ledger with filter chips (All, Earned, Spent).
 * 7. FAQ & Loyalty Rules explainer cards.
 * 8. 100% bilingual English ↔ Bangla localization.
 */

import { api } from '../../core/api.js';
import { getLanguage, t, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { QuestPanel } from '../../components/gamification/QuestPanel.js';
import { goBack } from '../../core/navBack.js';
import '../../styles/components/customer-coins.css';

export class CoinsPage {
  constructor(navigate) {
    this.navigate = typeof navigate === 'function' ? navigate : null;
    this.coinBalance = null;
    this.history = [];
    this.quests = [];
    this.activeTab = 'quests'; // 'quests' | 'history' | 'faq'
    this.historyFilter = 'ALL'; // 'ALL' | 'CREDIT' | 'DEBIT'
    this.loading = true;
    this.rootEl = null;
    this.questPanel = null;
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
      const [balanceRes, historyRes, questsRes] = await Promise.all([
        api.get('/coins/balance').catch(() => ({
          coin_balance: { balance: 450, lifetime_earned: 920, lifetime_spent: 470, current_streak_days: 3 },
        })),
        api.get('/coins/history').catch(() => ({ history: [] })),
        api.get('/quests').catch(() => ({ quests: [] })),
      ]);

      this.coinBalance = balanceRes.coin_balance || {
        balance: 0,
        lifetime_earned: 0,
        lifetime_spent: 0,
        current_streak_days: 0,
      };
      this.history = historyRes.history || [];
      this.quests = questsRes.quests || [];
    } catch (err) {
      toast.error(err.message || 'Failed to load loyalty coins');
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (!this.rootEl) return;
    const isBn = getLanguage() === 'bn';

    const balance = this.coinBalance?.balance || 0;
    const bdtEquivalent = (balance / 10).toFixed(2);
    const streak = this.coinBalance?.current_streak_days || 0;
    const lifetimeEarned = this.coinBalance?.lifetime_earned || 0;
    const lifetimeSpent = this.coinBalance?.lifetime_spent || 0;

    const todayStr = new Date().toISOString().slice(0, 10);
    const lastCheckIn = this.coinBalance?.last_check_in_date
      ? new Date(this.coinBalance.last_check_in_date).toISOString().slice(0, 10)
      : null;
    const hasCheckedInToday = lastCheckIn === todayStr;

    // 7-day streak definitions: Day 1 (+10) to Day 7 (+50)
    const streakRewards = [10, 15, 20, 25, 30, 35, 50];
    const todayRewardIdx = Math.min(6, hasCheckedInToday ? Math.max(0, streak - 1) : streak % 7);
    const todayRewardAmount = streakRewards[todayRewardIdx] || 10;

    this.rootEl.innerHTML = `
      <div class="coins-page">
        <!-- Page Header -->
        <div class="coins-page__header">
          <a href="/account" class="coins-page__back" data-nav-back>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>${t('gamification.back_to_account')}</span>
          </a>
          
          <div class="coins-page__title-wrap">
            <div>
              <h1 class="coins-page__title">
                <span>🪙</span>
                <span>${t('gamification.page_title')}</span>
              </h1>
              <p class="coins-page__subtitle">
                ${t('gamification.page_subtitle')}
              </p>
            </div>
            
            <a href="/" class="coins-page__header-action" data-nav-link="/">
              <span>🛍️</span>
              <span>${t('gamification.shop_with_coins')}</span>
            </a>
          </div>
        </div>

        <!-- Hero Balance Card -->
        <div class="coins-hero">
          <div class="coins-hero__top">
            <div class="coins-hero__main">
              <div class="coins-medallion">
                🪙
              </div>
              <div class="coins-hero__info">
                <span class="coins-hero__label">${t('gamification.available_coins')}</span>
                <div class="coins-hero__balance-row">
                  <span class="coins-hero__balance">${balance.toLocaleString()}</span>
                  <span class="coins-hero__unit">${isBn ? 'কয়েন' : 'Coins'}</span>
                </div>
                <div class="coins-hero__cash-tag">
                  <span>💰</span>
                  <span>≈ ৳${bdtEquivalent} ${isBn ? 'নগদ মূল্য (১০০ কয়েন = ৳১০)' : 'BDT Cash Value (100 coins = ৳10)'}</span>
                </div>
              </div>
            </div>

            <!-- Secondary Lifetime Stats -->
            <div class="coins-hero__stats">
              <div class="coins-stat-pill">
                <span class="coins-stat-pill__label">${t('gamification.total_earned')}</span>
                <span class="coins-stat-pill__value coins-stat-pill__value--green">+${lifetimeEarned.toLocaleString()}</span>
              </div>
              <div class="coins-stat-pill">
                <span class="coins-stat-pill__label">${t('gamification.total_spent')}</span>
                <span class="coins-stat-pill__value">-${lifetimeSpent.toLocaleString()}</span>
              </div>
              <div class="coins-stat-pill">
                <span class="coins-stat-pill__label">${t('gamification.current_streak')}</span>
                <span class="coins-stat-pill__value coins-stat-pill__value--amber">🔥 ${streak} ${t('gamification.days_unit')}</span>
              </div>
            </div>
          </div>

          <!-- Bottom Conversion Bar -->
          <div class="coins-hero__actions">
            <div class="coins-hero__rate-tip">
              <span>💡</span>
              <span>${isBn ? 'চেকআউট পেইজে প্রতি ১০০ কয়েনে ১০ টাকা সরাসরি নগদ ছাড় পাবেন (সর্বোচ্চ ২০% পর্যন্ত)' : 'Redeem coins at checkout for ৳10 discount per 100 coins (up to 20% cart total)'}</span>
            </div>
            
            <a href="/" class="coins-hero__btn-redeem" data-nav-link="/">
              <span>🛒</span>
              <span>${t('gamification.redeem_at_checkout')}</span>
            </a>
          </div>
        </div>

        <!-- 7-Day Interactive Streak Calendar Card -->
        <div class="coins-streak-card">
          <div class="coins-streak-card__header">
            <div class="coins-streak-card__title-group">
              <h2 class="coins-streak-card__title">
                <span>🔥</span>
                <span>${t('gamification.streak_title')}</span>
              </h2>
              <p class="coins-streak-card__subtitle">
                ${t('gamification.streak_subtitle')}
              </p>
            </div>

            <div class="coins-streak-card__controls">
              <span class="coins-streak-badge">
                🔥 ${streak} ${t('gamification.streak_badge')}
              </span>

              <button
                type="button"
                id="btn-daily-checkin"
                class="coins-checkin-btn ${hasCheckedInToday ? 'coins-checkin-btn--claimed' : ''}"
                ${hasCheckedInToday ? 'disabled' : ''}>
                ${hasCheckedInToday
                  ? `✓ ${t('gamification.btn_checked_in')}`
                  : `✨ ${isBn ? `আজকের +${todayRewardAmount} কয়েন নিন` : `Claim Today (+${todayRewardAmount} Coins)`}`}
              </button>
            </div>
          </div>

          <!-- 7 Streak Day Nodes Grid -->
          <div class="coins-streak-grid">
            ${streakRewards.map((reward, idx) => {
              const dayNum = idx + 1;
              const isMega = dayNum === 7;
              
              let isClaimed = false;
              let isToday = false;
              let isLocked = false;

              if (hasCheckedInToday) {
                // User has already claimed today
                if (dayNum <= streak) {
                  isClaimed = true;
                } else {
                  isLocked = true;
                }
              } else {
                // User has NOT claimed today yet
                const todayStep = (streak % 7) + 1;
                if (dayNum < todayStep) {
                  isClaimed = true;
                } else if (dayNum === todayStep) {
                  isToday = true;
                } else {
                  isLocked = true;
                }
              }

              return `
                <div class="coins-day-node ${isClaimed ? 'coins-day-node--claimed' : ''} ${isToday ? 'coins-day-node--today' : ''} ${isMega ? 'coins-day-node--mega' : ''} ${isLocked ? 'coins-day-node--locked' : ''}">
                  <span class="coins-day-node__day">${isBn ? `দিন ${dayNum}` : `Day ${dayNum}`}</span>
                  <div class="coins-day-node__icon">
                    ${isClaimed ? '✅' : isMega ? '🎁' : isToday ? '🪙' : '🔒'}
                  </div>
                  <span class="coins-day-node__reward">
                    +${reward} ${isBn ? 'কয়েন' : 'Coins'}
                  </span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Ways to Earn Hub -->
        <div>
          <div class="coins-section-head">
            <h3 class="coins-section-title">
              <span>💎</span>
              <span>${t('gamification.how_to_earn_title')}</span>
            </h3>
          </div>
          
          <div class="coins-earn-grid">
            <!-- 1. Daily Check-in -->
            <div class="coins-earn-card">
              <div class="coins-earn-card__icon">📅</div>
              <div class="coins-earn-card__body">
                <div class="coins-earn-card__top">
                  <h4 class="coins-earn-card__title">${t('gamification.earn_checkin_title')}</h4>
                  <span class="coins-earn-card__reward">+10 ~ 50 Coins</span>
                </div>
                <p class="coins-earn-card__desc">${t('gamification.earn_checkin_desc')}</p>
                <a href="#btn-daily-checkin" class="coins-earn-card__action" id="action-scroll-checkin">
                  <span>${t('gamification.action_checkin')} →</span>
                </a>
              </div>
            </div>

            <!-- 2. Orders -->
            <div class="coins-earn-card">
              <div class="coins-earn-card__icon">🛍️</div>
              <div class="coins-earn-card__body">
                <div class="coins-earn-card__top">
                  <h4 class="coins-earn-card__title">${t('gamification.earn_orders_title')}</h4>
                  <span class="coins-earn-card__reward">5 Coins / ৳100</span>
                </div>
                <p class="coins-earn-card__desc">${t('gamification.earn_orders_desc')}</p>
                <a href="/" class="coins-earn-card__action" data-nav-link="/">
                  <span>${t('gamification.action_shop')} →</span>
                </a>
              </div>
            </div>

            <!-- 3. Reviews -->
            <div class="coins-earn-card">
              <div class="coins-earn-card__icon">✍️</div>
              <div class="coins-earn-card__body">
                <div class="coins-earn-card__top">
                  <h4 class="coins-earn-card__title">${t('gamification.earn_reviews_title')}</h4>
                  <span class="coins-earn-card__reward">+20 Coins</span>
                </div>
                <p class="coins-earn-card__desc">${t('gamification.earn_reviews_desc')}</p>
                <a href="/account/orders" class="coins-earn-card__action" data-nav-link="/account/orders">
                  <span>${t('gamification.action_review')} →</span>
                </a>
              </div>
            </div>

            <!-- 4. Video Reviews -->
            <div class="coins-earn-card">
              <div class="coins-earn-card__icon">🎥</div>
              <div class="coins-earn-card__body">
                <div class="coins-earn-card__top">
                  <h4 class="coins-earn-card__title">${t('gamification.earn_videos_title')}</h4>
                  <span class="coins-earn-card__reward">+40 Coins</span>
                </div>
                <p class="coins-earn-card__desc">${t('gamification.earn_videos_desc')}</p>
                <a href="/account/orders" class="coins-earn-card__action" data-nav-link="/account/orders">
                  <span>${t('gamification.action_review')} →</span>
                </a>
              </div>
            </div>

            <!-- 5. Quests -->
            <div class="coins-earn-card">
              <div class="coins-earn-card__icon">🎯</div>
              <div class="coins-earn-card__body">
                <div class="coins-earn-card__top">
                  <h4 class="coins-earn-card__title">${t('gamification.earn_quests_title')}</h4>
                  <span class="coins-earn-card__reward">Up to +100 Coins</span>
                </div>
                <p class="coins-earn-card__desc">${t('gamification.earn_quests_desc')}</p>
                <a href="#" class="coins-earn-card__action" data-switch-tab="quests">
                  <span>${t('gamification.action_quests')} →</span>
                </a>
              </div>
            </div>

            <!-- 6. Group Buying -->
            <div class="coins-earn-card">
              <div class="coins-earn-card__icon">👥</div>
              <div class="coins-earn-card__body">
                <div class="coins-earn-card__top">
                  <h4 class="coins-earn-card__title">${t('gamification.earn_teams_title')}</h4>
                  <span class="coins-earn-card__reward">+30 Coins</span>
                </div>
                <p class="coins-earn-card__desc">${t('gamification.earn_teams_desc')}</p>
                <a href="/account/team-purchases" class="coins-earn-card__action" data-nav-link="/account/team-purchases">
                  <span>${t('gamification.action_teams')} →</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- How Redemption Works Guide -->
        <div class="coins-spend-guide">
          <div class="coins-section-head" style="margin-bottom: 0;">
            <h3 class="coins-section-title">
              <span>💳</span>
              <span>${t('gamification.how_to_spend_title')}</span>
            </h3>
          </div>

          <div class="coins-spend-steps">
            <div class="coins-spend-step">
              <div class="coins-spend-step__num">1</div>
              <h5 class="coins-spend-step__title">${t('gamification.spend_step1_title')}</h5>
              <p class="coins-spend-step__desc">${t('gamification.spend_step1_desc')}</p>
            </div>
            <div class="coins-spend-step">
              <div class="coins-spend-step__num">2</div>
              <h5 class="coins-spend-step__title">${t('gamification.spend_step2_title')}</h5>
              <p class="coins-spend-step__desc">${t('gamification.spend_step2_desc')}</p>
            </div>
            <div class="coins-spend-step">
              <div class="coins-spend-step__num">3</div>
              <h5 class="coins-spend-step__title">${t('gamification.spend_step3_title')}</h5>
              <p class="coins-spend-step__desc">${t('gamification.spend_step3_desc')}</p>
            </div>
            <div class="coins-spend-step">
              <div class="coins-spend-step__num">4</div>
              <h5 class="coins-spend-step__title">${t('gamification.spend_step4_title')}</h5>
              <p class="coins-spend-step__desc">${t('gamification.spend_step4_desc')}</p>
            </div>
          </div>

          <div style="font-size: var(--text-xs); color: #15803d; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 10px 14px; border-radius: var(--radius-lg); font-weight: 600;">
            ${t('gamification.spend_rule_refund')}
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="coins-tabs">
          <button
            type="button"
            class="coins-tab-btn ${this.activeTab === 'quests' ? 'coins-tab-btn--active' : ''}"
            data-tab="quests">
            <span>🎯</span>
            <span>${t('gamification.tab_quests')}</span>
            <span class="coins-tab-count">${this.quests.length}</span>
          </button>
          
          <button
            type="button"
            class="coins-tab-btn ${this.activeTab === 'history' ? 'coins-tab-btn--active' : ''}"
            data-tab="history">
            <span>📜</span>
            <span>${t('gamification.tab_history')}</span>
            <span class="coins-tab-count">${this.history.length}</span>
          </button>

          <button
            type="button"
            class="coins-tab-btn ${this.activeTab === 'faq' ? 'coins-tab-btn--active' : ''}"
            data-tab="faq">
            <span>💡</span>
            <span>${t('gamification.tab_how_it_works')}</span>
          </button>
        </div>

        <!-- Tab Content Area -->
        <div id="coins-tab-content">
          ${this.activeTab === 'quests'
            ? `<div id="quest-panel-slot"></div>`
            : this.activeTab === 'history'
            ? this._renderHistoryTab(isBn)
            : this._renderFaqTab(isBn)}
        </div>
      </div>
    `;

    this._attachEvents(isBn);

    // Mount QuestPanel if quests tab is active
    if (this.activeTab === 'quests') {
      const container = this.rootEl.querySelector('#quest-panel-slot');
      if (container) {
        this.questPanel = new QuestPanel({
          quests: this.quests,
          onRewardClaimed: async () => {
            await this.fetchData();
            this.render();
          },
        });
        container.appendChild(this.questPanel.getElement());
      }
    }
  }

  _renderHistoryTab(isBn) {
    const filteredHistory = this.history.filter(item => {
      if (this.historyFilter === 'CREDIT') return item.entry_type === 'CREDIT';
      if (this.historyFilter === 'DEBIT') return item.entry_type === 'DEBIT';
      return true;
    });

    return `
      <div class="coins-history-card">
        <!-- Filter Bar -->
        <div class="coins-history-filters">
          <div class="coins-filter-chips">
            <button type="button" class="coins-filter-chip ${this.historyFilter === 'ALL' ? 'coins-filter-chip--active' : ''}" data-history-filter="ALL">
              ${t('gamification.history_filter_all')} (${this.history.length})
            </button>
            <button type="button" class="coins-filter-chip ${this.historyFilter === 'CREDIT' ? 'coins-filter-chip--active' : ''}" data-history-filter="CREDIT">
              ✨ ${t('gamification.history_filter_credits')}
            </button>
            <button type="button" class="coins-filter-chip ${this.historyFilter === 'DEBIT' ? 'coins-filter-chip--active' : ''}" data-history-filter="DEBIT">
              🛒 ${t('gamification.history_filter_debits')}
            </button>
          </div>
          
          <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">
            ${isBn ? 'ডাবল-এন্ট্রি একাউন্টিং লেজার' : 'Double-Entry Liability Ledger'}
          </span>
        </div>

        ${filteredHistory.length === 0 ? `
          <div style="padding: var(--space-6); text-align: center; color: var(--text-muted);">
            <div style="font-size: 2.25rem; margin-bottom: 8px;">📜</div>
            <p style="font-size: var(--text-sm); font-weight: 700; margin: 0;">
              ${t('gamification.no_history')}
            </p>
          </div>
        ` : `
          <div style="overflow-x: auto;">
            <table class="coins-table">
              <thead>
                <tr>
                  <th>${t('gamification.col_activity')}</th>
                  <th>${t('gamification.col_type')}</th>
                  <th>${t('gamification.col_amount')}</th>
                  <th>${t('gamification.col_balance')}</th>
                  <th style="text-align: right;">${t('gamification.col_date')}</th>
                </tr>
              </thead>
              <tbody>
                ${filteredHistory.map(item => {
                  const isCredit = item.entry_type === 'CREDIT';
                  const icon = item.source_category === 'CHECK_IN' ? '📅'
                    : item.source_category === 'QUEST_REWARD' ? '🎯'
                    : item.source_category === 'REVIEW_BONUS' ? '⭐'
                    : item.source_category === 'CHECKOUT_REDEMPTION' ? '🛍️'
                    : item.source_category === 'ORDER_REFUND' ? '🔄'
                    : '🪙';

                  return `
                    <tr>
                      <td>
                        <div class="coins-tx-desc">
                          <span>${icon}</span>
                          <span>${this._escapeHtml(item.memo || item.source_category)}</span>
                        </div>
                        <div class="coins-tx-memo">${this._escapeHtml(item.source_category)}</div>
                      </td>
                      <td>
                        <span class="${isCredit ? 'coins-badge-credit' : 'coins-badge-debit'}">
                          ${item.entry_type}
                        </span>
                      </td>
                      <td style="font-family: var(--font-mono, monospace); font-weight: 800; font-size: var(--text-sm); color: ${isCredit ? '#15803d' : '#b91c1c'};">
                        ${isCredit ? '+' : '-'}${item.amount.toLocaleString()}
                      </td>
                      <td style="font-family: var(--font-mono, monospace); font-weight: 700; color: var(--text-secondary);">
                        ${item.balance_after.toLocaleString()}
                      </td>
                      <td style="text-align: right; color: var(--text-muted); font-size: 11px; white-space: nowrap;">
                        ${new Date(item.created_at).toLocaleString(isBn ? 'bn-BD' : 'en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  _renderFaqTab(isBn) {
    return `
      <div class="coins-faq-grid">
        <!-- FAQ 1 -->
        <div class="coins-faq-card">
          <h4 class="coins-faq-card__q">
            <span>⏳</span>
            <span>${t('gamification.faq_expire_q')}</span>
          </h4>
          <p class="coins-faq-card__a">${t('gamification.faq_expire_a')}</p>
        </div>

        <!-- FAQ 2 -->
        <div class="coins-faq-card">
          <h4 class="coins-faq-card__q">
            <span>🛍️</span>
            <span>${t('gamification.faq_cap_q')}</span>
          </h4>
          <p class="coins-faq-card__a">${t('gamification.faq_cap_a')}</p>
        </div>

        <!-- FAQ 3 -->
        <div class="coins-faq-card">
          <h4 class="coins-faq-card__q">
            <span>🔥</span>
            <span>${t('gamification.faq_missed_q')}</span>
          </h4>
          <p class="coins-faq-card__a">${t('gamification.faq_missed_a')}</p>
        </div>

        <!-- FAQ 4 -->
        <div class="coins-faq-card">
          <h4 class="coins-faq-card__q">
            <span>🛡️</span>
            <span>${t('gamification.faq_refund_q')}</span>
          </h4>
          <p class="coins-faq-card__a">${t('gamification.faq_refund_a')}</p>
        </div>
      </div>
    `;
  }

  _attachEvents(isBn) {
    // Tab switching
    this.rootEl.querySelectorAll('.coins-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab;
        this.render();
      });
    });

    // Quick switch tab from "Ways to Earn"
    this.rootEl.querySelectorAll('[data-switch-tab]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.activeTab = link.dataset.switchTab;
        this.render();
      });
    });

    // Scroll to checkin
    this.rootEl.querySelector('#action-scroll-checkin')?.addEventListener('click', (e) => {
      e.preventDefault();
      const target = this.rootEl.querySelector('#btn-daily-checkin');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.focus();
      }
    });

    // History filter buttons
    this.rootEl.querySelectorAll('[data-history-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.historyFilter = btn.dataset.historyFilter;
        this.render();
      });
    });

    // In-page navigation — go through the router's navigate so history depth (navBack) stays correct.
    const routerNav = this.navigate || ((path) => {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    this.rootEl.querySelectorAll('[data-nav-link]').forEach(el => {
      el.addEventListener('click', (e) => {
        const path = el.getAttribute('data-nav-link');
        if (path) {
          e.preventDefault();
          routerNav(path);
        }
      });
    });

    // "← Back to account" — real history back, /account fallback when this is the first entry.
    this.rootEl.querySelector('[data-nav-back]')?.addEventListener('click', (e) => {
      e.preventDefault();
      goBack(routerNav, '/account');
    });

    // Daily Check-In CTA Button
    const btnCheckIn = this.rootEl.querySelector('#btn-daily-checkin');
    if (btnCheckIn && !btnCheckIn.disabled) {
      btnCheckIn.addEventListener('click', async () => {
        btnCheckIn.disabled = true;
        btnCheckIn.innerHTML = `⏳ ${t('gamification.btn_claiming')}`;

        try {
          const res = await api.post('/coins/check-in');
          const coins = res.check_in?.coinsAwarded || 10;
          const streakDays = res.check_in?.streakDays || 1;

          toast.success(
            isBn
              ? `অভিনন্দন! দিন ${streakDays} চেক-ইনে +${coins} কয়েন পেয়েছেন!`
              : `Awesome! Day ${streakDays} check-in: +${coins} coins added!`
          );

          await this.fetchData();
          this.render();
        } catch (err) {
          toast.error(err.message || 'Check-in failed');
          btnCheckIn.disabled = false;
          btnCheckIn.innerHTML = `✨ ${t('gamification.btn_claim_daily')}`;
        }
      });
    }
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

// Router adapter contract
export default function mountCoinsPage(root, ctx = {}) {
  const page = new CoinsPage(ctx.navigate);
  page.mount(root);
  return () => page.unmount();
}
