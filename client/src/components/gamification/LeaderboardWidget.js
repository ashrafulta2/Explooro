/**
 * LeaderboardWidget.js — Saler & Earner Monthly Performance Leaderboard (Prompt 9.4).
 *
 * Implements:
 * 1. Top 3 podium layout with Gold, Silver, and Bronze badges.
 * 2. Ranked listings with revenue metrics and prize share estimates.
 * 3. Logged-in user rank highlight card.
 * 4. Monthly prize pool banner.
 */

import { api } from '../../core/api.js';
import { getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

export class LeaderboardWidget {
  constructor({ category = 'SALER_REVENUE', limit = 20 } = {}) {
    this.category = category;
    this.limit = limit;
    this.data = null;
    this.loading = true;
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'leaderboard-widget space-y-4';
    this.fetchAndRender();
  }

  async fetchAndRender() {
    this.loading = true;
    this.render();
    try {
      this.data = await api.get(`/leaderboard?category=${this.category}&limit=${this.limit}`);
    } catch (err) {
      toast.error(err.message || 'Failed to load leaderboard');
    } finally {
      this.loading = false;
      this.render();
    }
  }

  render() {
    const isBn = getLanguage() === 'bn';

    if (this.loading) {
      this.rootEl.innerHTML = `
        <div class="card p-8 text-center text-muted bg-surface border border-border rounded-xl">
          ${isBn ? 'লিডারবোর্ড লোড হচ্ছে…' : 'Loading leaderboard rankings…'}
        </div>
      `;
      return this.rootEl;
    }

    const rankings = this.data?.rankings || [];
    const userRank = this.data?.current_user_rank;
    const top3 = rankings.slice(0, 3);
    const restRankings = rankings.slice(3);

    this.rootEl.innerHTML = `
      <div class="space-y-4">
        <!-- Header & Category Switcher -->
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-gradient-to-r from-primary/10 via-surface to-warning/10 p-4 border border-primary/20 rounded-xl">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xl">🏆</span>
              <h3 class="font-bold text-base text-foreground">
                ${isBn ? 'মাসিক সুপার সেলার লিডারবোর্ড' : 'Monthly Super Seller Leaderboard'}
              </h3>
            </div>
            <p class="text-xs text-muted mt-0.5">
              ${isBn ? 'শীর্ষ ১০ জন সেলার পাবেন বিশেষ নগদ প্রাইজ মানি বোনাস' : 'Top 10 monthly performers receive cash prize pool bonuses'}
            </p>
          </div>
          <div class="flex gap-1 bg-surface p-1 rounded-lg border border-border text-xs">
            <button class="btn-cat px-3 py-1 rounded font-semibold ${this.category === 'SALER_REVENUE' ? 'bg-primary text-white' : 'text-muted hover:text-foreground'}" data-cat="SALER_REVENUE">
              💰 ${isBn ? 'বিক্রয় মূল্য' : 'Revenue'}
            </button>
            <button class="btn-cat px-3 py-1 rounded font-semibold ${this.category === 'SALER_ORDERS' ? 'bg-primary text-white' : 'text-muted hover:text-foreground'}" data-cat="SALER_ORDERS">
              📦 ${isBn ? 'অর্ডার সংখ্যা' : 'Orders'}
            </button>
          </div>
        </div>

        <!-- Top 3 Podium -->
        ${top3.length > 0 ? `
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            ${top3.map((node, idx) => {
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
              const borderCol = idx === 0 ? 'border-warning/50 bg-warning/5' : idx === 1 ? 'border-slate-400/40 bg-slate-400/5' : 'border-amber-600/40 bg-amber-600/5';
              return `
                <div class="card p-4 border ${borderCol} rounded-xl text-center space-y-2 relative overflow-hidden">
                  <div class="text-3xl">${medal}</div>
                  <span class="badge badge-neutral text-xs font-bold font-mono">Rank #${node.rank}</span>
                  <h4 class="font-bold text-sm text-foreground truncate">${node.user_name || 'Top Earner'}</h4>
                  <div class="font-mono font-bold text-base text-primary">
                    ${this.category === 'SALER_REVENUE' ? `৳${Number(node.metric_value).toFixed(2)}` : `${Number(node.metric_value)} orders`}
                  </div>
                  <span class="text-[11px] text-success font-semibold block">
                    🎁 ${idx === 0 ? '40% Pool Prize' : idx === 1 ? '25% Pool Prize' : '15% Pool Prize'}
                  </span>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        <!-- Current User Rank Pill (if available) -->
        ${userRank ? `
          <div class="p-3 bg-primary/10 border border-primary/30 rounded-xl flex items-center justify-between text-xs">
            <div class="flex items-center gap-2">
              <span class="font-bold text-primary">⭐ ${isBn ? 'আপনার বর্তমান র‍্যাংক' : 'Your Current Rank'}:</span>
              <span class="badge badge-primary font-mono font-bold">#${userRank.rank}</span>
            </div>
            <div class="font-mono font-bold text-foreground">
              ${this.category === 'SALER_REVENUE' ? `৳${Number(userRank.metric_value).toFixed(2)}` : `${Number(userRank.metric_value)} orders`}
            </div>
          </div>
        ` : ''}

        <!-- Rest of the Table -->
        ${restRankings.length > 0 ? `
          <div class="card p-4 bg-surface border border-border rounded-xl">
            <div class="overflow-x-auto">
              <table class="table w-full text-left text-xs">
                <thead>
                  <tr class="border-b border-border text-muted uppercase">
                    <th class="py-2.5 px-3">#</th>
                    <th class="py-2.5 px-3">${isBn ? 'সেলার নাম' : 'Seller Name'}</th>
                    <th class="py-2.5 px-3 text-right">${this.category === 'SALER_REVENUE' ? (isBn ? 'মোট বিক্রয়' : 'Total Revenue') : (isBn ? 'মোট অর্ডার' : 'Total Orders')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${restRankings.map(r => `
                    <tr class="border-b border-border hover:bg-muted/5">
                      <td class="py-2.5 px-3 font-mono font-bold text-muted">#${r.rank}</td>
                      <td class="py-2.5 px-3 font-semibold">${r.user_name || 'Seller'}</td>
                      <td class="py-2.5 px-3 text-right font-mono font-bold text-primary">
                        ${this.category === 'SALER_REVENUE' ? `৳${Number(r.metric_value).toFixed(2)}` : `${Number(r.metric_value)} orders`}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : rankings.length === 0 ? `
          <div class="card p-8 text-center text-muted bg-surface border border-border rounded-xl">
            <p>${isBn ? 'এই মাসের লিডারবোর্ড স্ন্যাপশট শীঘ্রই তৈরি হবে।' : 'No ranking snapshots available for this month yet.'}</p>
          </div>
        ` : ''}
      </div>
    `;

    this._attachEvents();
    return this.rootEl;
  }

  _attachEvents() {
    this.rootEl.querySelectorAll('.btn-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        this.category = btn.dataset.cat;
        this.fetchAndRender();
      });
    });
  }

  getElement() {
    return this.rootEl;
  }
}
