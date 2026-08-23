/**
 * QuestPanel.js — Daily & Weekly Quest Progress Widget (Prompt 9.4).
 *
 * Implements:
 * 1. Progress cards for active role quests.
 * 2. Visual completion progress bars.
 * 3. Atomic reward claiming triggers with instant toast notifications.
 * 4. Bilingual localization.
 */

import { api } from '../../core/api.js';
import { getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

export class QuestPanel {
  constructor({ quests = [], onRewardClaimed = null } = {}) {
    this.quests = quests;
    this.onRewardClaimed = onRewardClaimed;
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'quest-panel space-y-4';
    this.render();
  }

  setQuests(quests) {
    this.quests = quests || [];
    this.render();
  }

  render() {
    const isBn = getLanguage() === 'bn';

    if (this.quests.length === 0) {
      this.rootEl.innerHTML = `
        <div class="card p-6 text-center text-muted bg-surface border border-border rounded-xl">
          <span class="text-2xl block mb-1">🎯</span>
          <p class="text-sm font-semibold">${isBn ? 'বর্তমানে কোনো সক্রিয় কোয়েস্ট নেই।' : 'No active quests right now.'}</p>
        </div>
      `;
      return this.rootEl;
    }

    this.rootEl.innerHTML = `
      <div class="space-y-3">
        ${this.quests.map(q => {
          const title = isBn ? q.title_bn : q.title_en;
          const desc = isBn ? q.description_bn : q.description_en;
          const isCompleted = q.is_completed || q.current_count >= q.target_count;
          const isClaimed = q.is_claimed;

          return `
            <div class="card p-4 bg-surface border border-border rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all hover:border-primary/30">
              <div class="space-y-1.5 flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="badge badge-${q.cadence === 'DAILY' ? 'accent' : 'warning'} text-[10px] uppercase font-bold">
                    ${q.cadence === 'DAILY' ? (isBn ? 'দৈনিক' : 'Daily') : (isBn ? 'সাপ্তাহিক' : 'Weekly')}
                  </span>
                  <h4 class="font-bold text-sm text-foreground truncate">${title}</h4>
                </div>
                ${desc ? `<p class="text-xs text-muted truncate">${desc}</p>` : ''}

                <!-- Progress Bar -->
                <div class="space-y-1 pt-1">
                  <div class="flex justify-between text-[11px] font-mono text-muted">
                    <span>${isBn ? 'অগ্রগতি' : 'Progress'}: ${q.current_count} / ${q.target_count}</span>
                    <span>${q.progress_pct}%</span>
                  </div>
                  <div class="w-full bg-border rounded-full h-1.5 overflow-hidden">
                    <div class="bg-primary h-1.5 rounded-full transition-all duration-300" style="width: ${q.progress_pct}%"></div>
                  </div>
                </div>
              </div>

              <!-- Reward & Action CTA -->
              <div class="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-border">
                <div class="flex items-center gap-1 font-bold text-xs text-warning bg-warning/10 px-2.5 py-1 rounded-full whitespace-nowrap">
                  <span>🪙</span>
                  <span>+${q.reward_coins} ${isBn ? 'কয়েন' : 'Coins'}</span>
                </div>

                ${isClaimed ? `
                  <button class="btn btn-sm btn-outline text-xs text-success border-success/30 cursor-default" disabled>
                    ✓ ${isBn ? 'দাবি করা হয়েছে' : 'Claimed'}
                  </button>
                ` : isCompleted ? `
                  <button class="btn btn-sm btn-primary text-xs font-bold whitespace-nowrap btn-claim animate-bounce" data-id="${q.id}">
                    🎁 ${isBn ? 'রিওয়ার্ড নিন' : 'Claim'}
                  </button>
                ` : `
                  <button class="btn btn-sm btn-neutral text-xs text-muted" disabled>
                    ⏳ ${isBn ? 'চলছে' : 'In Progress'}
                  </button>
                `}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    this._attachEvents(isBn);
    return this.rootEl;
  }

  _attachEvents(isBn) {
    this.rootEl.querySelectorAll('.btn-claim').forEach(btn => {
      btn.addEventListener('click', async () => {
        const questId = btn.dataset.id;
        btn.disabled = true;
        btn.innerHTML = '⏳…';

        try {
          const res = await api.post(`/quests/${questId}/claim`);
          toast.success(isBn ? `অভিনন্দন! +${res.claim.rewardCoins} কয়েন যুক্ত হয়েছে!` : `Reward claimed! +${res.claim.rewardCoins} coins added!`);
          if (this.onRewardClaimed) {
            this.onRewardClaimed(res.claim);
          }
        } catch (err) {
          toast.error(err.message || 'Failed to claim quest');
          btn.disabled = false;
          btn.innerHTML = `🎁 ${isBn ? 'রিওয়ার্ড নিন' : 'Claim'}`;
        }
      });
    });
  }

  getElement() {
    return this.rootEl;
  }
}
