/**
 * CoinsPage.js — Customer Loyalty Coins, Streak Calendar & Quests Hub (Prompt 9.4).
 *
 * Implements:
 * 1. Loyalty Coins Balance with BDT conversion (100 coins = ৳10).
 * 2. Interactive 7-Day Streak Calendar with dynamic claim action.
 * 3. Daily & Weekly Quests progress panel.
 * 4. Double-Entry coin ledger history.
 * 5. Bilingual localization.
 */

import { api } from '../../core/api.js';
import { getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { QuestPanel } from '../../components/gamification/QuestPanel.js';

export default class CoinsPage {
  constructor() {
    this.coinBalance = null;
    this.history = [];
    this.quests = [];
    this.activeTab = 'quests'; // 'quests' | 'history'
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
        api.get('/coins/balance').catch(() => ({ coin_balance: null })),
        api.get('/coins/history').catch(() => ({ history: [] })),
        api.get('/quests').catch(() => ({ quests: [] })),
      ]);
      this.coinBalance = balanceRes.coin_balance || { balance: 0, lifetime_earned: 0, lifetime_spent: 0, current_streak_days: 0 };
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
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastCheckIn = this.coinBalance?.last_check_in_date
      ? new Date(this.coinBalance.last_check_in_date).toISOString().slice(0, 10)
      : null;
    const hasCheckedInToday = lastCheckIn === todayStr;

    // 7-day streak definitions: Day 1 (+10) to Day 7 (+50)
    const streakRewards = [10, 15, 20, 25, 30, 35, 50];

    this.rootEl.innerHTML = `
      <div class="coins-page-container p-6 space-y-6 max-w-6xl mx-auto">
        <!-- Page Header -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
              <span>🪙</span>
              <span>${isBn ? 'লয়্যালটি কয়েন ও দৈনিক রিওয়ার্ড' : 'Loyalty Coins & Rewards'}</span>
            </h1>
            <p class="text-sm text-muted mt-1">
              ${isBn ? 'প্রতিদিন চেক-ইন করুন, কোয়েস্ট পূরণ করুন এবং চেকআউটে সরাসরি নগদ ছাড় পান' : 'Check in daily, complete quests, and redeem coins for instant discounts at checkout'}
            </p>
          </div>
        </div>

        <!-- Hero Balance Banner -->
        <div class="card p-6 bg-gradient-to-r from-amber-500/15 via-surface to-warning/10 border border-warning/30 rounded-2xl shadow-sm">
          <div class="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div class="flex items-center gap-4 text-center sm:text-left">
              <div class="w-16 h-16 rounded-2xl bg-warning/20 border border-warning/40 flex items-center justify-center text-4xl shadow-inner animate-pulse">
                🪙
              </div>
              <div>
                <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'আপনার কয়েন ব্যালেন্স' : 'Available Coins'}</span>
                <div class="text-3xl font-black text-warning font-mono mt-0.5">${balance} <span class="text-base font-normal text-muted">${isBn ? 'কয়েন' : 'Coins'}</span></div>
                <div class="text-xs font-semibold text-success mt-0.5">
                  ≈ ৳${bdtEquivalent} ${isBn ? 'নগদ মূল্য (১০০ কয়েন = ৳১০)' : 'BDT value (100 coins = ৳10)'}
                </div>
              </div>
            </div>

            <!-- Lifetime Stats -->
            <div class="flex gap-4 border-t sm:border-t-0 sm:border-l border-border pt-4 sm:pt-0 sm:pl-6 w-full sm:w-auto justify-around sm:justify-start">
              <div class="text-center sm:text-left">
                <span class="text-[11px] text-muted uppercase font-bold">${isBn ? 'মোট অর্জিত' : 'Total Earned'}</span>
                <div class="font-mono font-bold text-base text-foreground mt-0.5">+${this.coinBalance?.lifetime_earned || 0}</div>
              </div>
              <div class="text-center sm:text-left">
                <span class="text-[11px] text-muted uppercase font-bold">${isBn ? 'মোট খরচ' : 'Total Spent'}</span>
                <div class="font-mono font-bold text-base text-muted mt-0.5">-${this.coinBalance?.lifetime_spent || 0}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 7-Day Streak Calendar Card -->
        <div class="card p-6 bg-surface border border-border rounded-2xl space-y-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="text-lg">🔥</span>
                <h3 class="font-bold text-base text-foreground">
                  ${isBn ? '৭ দিনের ধারাবাহিক চেক-ইন বোনাস' : '7-Day Daily Streak Calendar'}
                </h3>
              </div>
              <p class="text-xs text-muted mt-0.5">
                ${isBn ? 'প্রতিদিন ধারাবাহিকভাবে চেক-ইন করলে কয়েন বোনাস বাড়তে থাকে' : 'Maintain your daily check-in streak to unlock maximum multiplier coins'}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge badge-warning text-xs font-bold font-mono">
                🔥 ${streak} ${isBn ? 'দিনের স্ট্রিক' : 'Day Streak'}
              </span>
              <button
                id="btn-daily-checkin"
                class="btn btn-sm ${hasCheckedInToday ? 'btn-outline text-success border-success/30' : 'btn-primary font-bold shadow-md'}"
                ${hasCheckedInToday ? 'disabled' : ''}>
                ${hasCheckedInToday ? `✓ ${isBn ? 'আজ সম্পন্ন হয়েছে' : 'Checked In Today'}` : `✨ ${isBn ? 'আজকের কয়েন নিন' : 'Claim Daily Coins'}`}
              </button>
            </div>
          </div>

          <!-- Streak Day Nodes -->
          <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 pt-2">
            ${streakRewards.map((reward, idx) => {
              const dayNum = idx + 1;
              const isPastOrToday = streak >= dayNum;
              const isToday = streak === dayNum && hasCheckedInToday;

              return `
                <div class="p-3 rounded-xl border text-center transition-all ${isToday ? 'bg-primary/10 border-primary shadow-sm' : isPastOrToday ? 'bg-surface border-success/40 text-success' : 'bg-muted/5 border-border opacity-70'}">
                  <span class="text-[11px] font-bold uppercase text-muted block mb-1">Day ${dayNum}</span>
                  <div class="text-xl mb-1">${isPastOrToday ? '✓' : '🪙'}</div>
                  <span class="font-mono font-bold text-xs ${isPastOrToday ? 'text-success' : 'text-warning'}">+${reward}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="flex border-b border-border gap-4">
          <button
            class="tab-btn pb-3 px-2 font-semibold text-sm transition-colors border-b-2 ${this.activeTab === 'quests' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-white'}"
            data-tab="quests">
            🎯 ${isBn ? 'দৈনিক ও সাপ্তাহিক মিশন' : 'Quests & Missions'} (${this.quests.length})
          </button>
          <button
            class="tab-btn pb-3 px-2 font-semibold text-sm transition-colors border-b-2 ${this.activeTab === 'history' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-white'}"
            data-tab="history">
            📜 ${isBn ? 'কয়েন লেনদেন ইতিহাস' : 'Coin Ledger History'} (${this.history.length})
          </button>
        </div>

        <!-- Content Area -->
        <div id="tab-content">
          ${this.activeTab === 'quests'
            ? `<div id="quest-panel-container"></div>`
            : this._renderHistoryTab(isBn)}
        </div>
      </div>
    `;

    this._attachEvents(isBn);

    // Mount QuestPanel
    if (this.activeTab === 'quests') {
      const container = this.rootEl.querySelector('#quest-panel-container');
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
    if (this.history.length === 0) {
      return `
        <div class="card p-12 text-center text-muted bg-surface border border-border rounded-xl">
          <div class="text-4xl mb-2">📜</div>
          <p class="font-semibold">${isBn ? 'কোনো কয়েন লেনদেন পাওয়া যায়নি।' : 'No coin transactions found.'}</p>
        </div>
      `;
    }

    return `
      <div class="card p-5 bg-surface border border-border rounded-xl">
        <div class="overflow-x-auto">
          <table class="table w-full text-left text-xs">
            <thead>
              <tr class="border-b border-border text-muted uppercase">
                <th class="py-3 px-4">${isBn ? 'বিবরণ ও উৎস' : 'Activity & Source'}</th>
                <th class="py-3 px-4">${isBn ? 'ধরণ' : 'Type'}</th>
                <th class="py-3 px-4">${isBn ? 'পরিমাণ' : 'Amount'}</th>
                <th class="py-3 px-4">${isBn ? 'ব্যালেন্স পর' : 'Balance After'}</th>
                <th class="py-3 px-4 text-right">${isBn ? 'তারিখ' : 'Date'}</th>
              </tr>
            </thead>
            <tbody>
              ${this.history.map(item => `
                <tr class="border-b border-border hover:bg-muted/5">
                  <td class="py-3 px-4">
                    <div class="font-semibold text-foreground">${this._escapeHtml(item.memo || item.source_category)}</div>
                    <div class="text-[11px] text-muted font-mono">${item.source_category}</div>
                  </td>
                  <td class="py-3 px-4">
                    <span class="badge badge-${item.entry_type === 'CREDIT' ? 'success' : 'danger'} font-mono font-bold">
                      ${item.entry_type}
                    </span>
                  </td>
                  <td class="py-3 px-4 font-mono font-bold ${item.entry_type === 'CREDIT' ? 'text-success' : 'text-danger'}">
                    ${item.entry_type === 'CREDIT' ? '+' : '-'}${item.amount}
                  </td>
                  <td class="py-3 px-4 font-mono font-semibold text-muted">
                    ${item.balance_after}
                  </td>
                  <td class="py-3 px-4 text-right text-muted">
                    ${new Date(item.created_at).toLocaleString()}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _attachEvents(isBn) {
    this.rootEl.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab;
        this.render();
      });
    });

    const btnCheckIn = this.rootEl.querySelector('#btn-daily-checkin');
    if (btnCheckIn) {
      btnCheckIn.addEventListener('click', async () => {
        btnCheckIn.disabled = true;
        btnCheckIn.innerHTML = '⏳…';

        try {
          const res = await api.post('/coins/check-in');
          toast.success(
            isBn
              ? `অভিনন্দন! দৈনিক চেক-ইনে +${res.check_in.coinsAwarded} কয়েন পেয়েছেন!`
              : `Awesome! Day ${res.check_in.streakDays} check-in: +${res.check_in.coinsAwarded} coins!`
          );
          await this.fetchData();
          this.render();
        } catch (err) {
          toast.error(err.message || 'Check-in failed');
          btnCheckIn.disabled = false;
          btnCheckIn.innerHTML = `✨ ${isBn ? 'আজকের কয়েন নিন' : 'Claim Daily Coins'}`;
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
