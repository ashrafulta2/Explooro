/**
 * QuestPanel.ts — Daily & Weekly Quest Progress Widget (Prompt 9.4).
 *
 * Implements:
 * 1. Progress cards for active role quests with cadence categorization.
 * 2. Visual completion progress bars with target counters.
 * 3. Filter chips (All, Daily, Weekly).
 * 4. Atomic reward claiming triggers with instant toast notifications.
 * 5. Bilingual English ↔ Bangla localization.
 */

import { api } from '../../core/api.ts';
import { getLanguage, t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { questClaimMessage } from './questClaimMessage.ts';

/** A daily or weekly quest with its progress, as GET /quests sends it. */
export interface Quest {
  id: number | string;
  cadence: 'DAILY' | 'WEEKLY' | string;
  title?: string;
  title_en?: string;
  title_bn?: string;
  description?: string;
  description_en?: string;
  description_bn?: string;
  current_count?: number;
  target_count?: number;
  is_completed?: boolean;
  is_claimed?: boolean;
  reward_coins: number;
}

type QuestFilter = 'ALL' | 'DAILY' | 'WEEKLY';

export interface QuestPanelOptions {
  quests?: Quest[] | null;
  /** Called with the server's claim record after a reward is taken. */
  onRewardClaimed?: ((claim: unknown) => void | Promise<void>) | null;
}

export class QuestPanel {
  quests: Quest[];
  onRewardClaimed: QuestPanelOptions['onRewardClaimed'];
  filter: QuestFilter;
  rootEl: HTMLDivElement;

  constructor({ quests = [], onRewardClaimed = null }: QuestPanelOptions = {}) {
    this.quests = quests || [];
    this.onRewardClaimed = onRewardClaimed;
    this.filter = 'ALL'; // 'ALL' | 'DAILY' | 'WEEKLY'
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'quest-panel';
    this.render();
  }

  setQuests(quests: Quest[] | null) {
    this.quests = quests || [];
    this.render();
  }

  render() {
    const isBn = getLanguage() === 'bn';

    const filtered = this.quests.filter(q => {
      if (this.filter === 'DAILY') return q.cadence === 'DAILY';
      if (this.filter === 'WEEKLY') return q.cadence === 'WEEKLY';
      return true;
    });

    const dailyCount = this.quests.filter(q => q.cadence === 'DAILY').length;
    const weeklyCount = this.quests.filter(q => q.cadence === 'WEEKLY').length;
    const claimableCount = this.quests.filter(q => (q.is_completed || q.current_count >= q.target_count) && !q.is_claimed).length;

    this.rootEl.innerHTML = `
      <div class="quest-panel-wrap" style="display: flex; flex-direction: column; gap: var(--space-4);">
        <!-- Filter Header -->
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3);">
          <div class="coins-filter-chips">
            <button type="button" class="coins-filter-chip ${this.filter === 'ALL' ? 'coins-filter-chip--active' : ''}" data-filter="ALL">
              ${isBn ? 'সকল মিশন' : 'All Missions'} (${this.quests.length})
            </button>
            <button type="button" class="coins-filter-chip ${this.filter === 'DAILY' ? 'coins-filter-chip--active' : ''}" data-filter="DAILY">
              ⚡ ${isBn ? 'দৈনিক' : 'Daily'} (${dailyCount})
            </button>
            <button type="button" class="coins-filter-chip ${this.filter === 'WEEKLY' ? 'coins-filter-chip--active' : ''}" data-filter="WEEKLY">
              🏆 ${isBn ? 'সাপ্তাহিক' : 'Weekly'} (${weeklyCount})
            </button>
          </div>

          ${claimableCount > 0 ? `
            <span style="font-size: 11px; font-weight: 800; color: #b45309; background: #fef3c7; border: 1px solid #fde68a; padding: 3px 10px; border-radius: var(--radius-full);">
              🎁 ${claimableCount} ${isBn ? 'টি রিওয়ার্ড সংগ্রহযোগ্য' : 'Reward(s) ready to claim!'}
            </span>
          ` : ''}
        </div>

        <!-- Quests List -->
        ${filtered.length === 0 ? `
          <div style="background: var(--surface-0); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); padding: var(--space-6); text-align: center; color: var(--text-muted);">
            <div style="font-size: 2rem; margin-bottom: 6px;">🎯</div>
            <p style="font-size: var(--text-sm); font-weight: 700; margin: 0;">
              ${isBn ? 'এই ক্যাটাগরিতে কোনো সক্রিয় মিশন নেই।' : 'No active quests in this category.'}
            </p>
          </div>
        ` : `
          <div style="display: flex; flex-direction: column; gap: var(--space-3);">
            ${filtered.map(q => {
              const title = (isBn && q.title_bn) ? q.title_bn : (q.title_en || q.title || 'Quest');
              const desc = (isBn && q.description_bn) ? q.description_bn : (q.description_en || q.description || '');
              const currentCount = q.current_count ?? 0;
              const targetCount = q.target_count ?? 1;
              const isCompleted = q.is_completed || currentCount >= targetCount;
              const isClaimed = q.is_claimed;
              const pct = Math.min(100, Math.round((currentCount / targetCount) * 100));

              return `
                <div class="quest-item-card">
                  <div class="quest-item-card__main">
                    <div class="quest-item-card__header">
                      <span class="quest-cadence-badge quest-cadence-badge--${q.cadence === 'DAILY' ? 'daily' : 'weekly'}">
                        ${q.cadence === 'DAILY' ? (isBn ? 'দৈনিক' : 'Daily') : (isBn ? 'সাপ্তাহিক' : 'Weekly')}
                      </span>
                      <h4 class="quest-item-card__title">${this._escapeHtml(title)}</h4>
                    </div>

                    ${desc ? `<p class="quest-item-card__desc">${this._escapeHtml(desc)}</p>` : ''}

                    <!-- Progress Bar -->
                    <div class="quest-progress-wrap">
                      <div class="quest-progress-head">
                        <span>${isBn ? 'অগ্রগতি' : 'Progress'}: ${currentCount}/${targetCount}</span>
                        <span>${pct}%</span>
                      </div>
                      <div class="quest-progress-bar">
                        <div class="quest-progress-fill" style="width: ${pct}%;"></div>
                      </div>
                    </div>
                  </div>

                  <!-- Reward & Claim CTA -->
                  <div class="quest-item-card__side">
                    <div class="quest-reward-pill">
                      <span>🪙</span>
                      <span>+${q.reward_coins} ${isBn ? 'কয়েন' : 'Coins'}</span>
                    </div>

                    ${isClaimed ? `
                      <span class="quest-btn-claimed">
                        ✓ ${isBn ? 'দাবি করা হয়েছে' : 'Claimed'}
                      </span>
                    ` : isCompleted ? `
                      <button type="button" class="quest-btn-claim btn-claim-quest" data-id="${q.id}">
                        🎁 ${isBn ? 'রিওয়ার্ড নিন' : 'Claim Reward'}
                      </button>
                    ` : `
                      <span class="quest-btn-pending">
                        ⏳ ${isBn ? 'চলছে' : 'In Progress'}
                      </span>
                    `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    this._attachEvents(isBn);
    return this.rootEl;
  }

  _attachEvents(isBn: boolean) {
    // Filter click
    this.rootEl.querySelectorAll<HTMLElement>('.coins-filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filter = btn.dataset.filter as QuestFilter;
        this.render();
      });
    });

    // Claim reward button
    this.rootEl.querySelectorAll<HTMLButtonElement>('.btn-claim-quest').forEach(btn => {
      btn.addEventListener('click', async () => {
        const questId = btn.dataset.id;
        btn.disabled = true;
        btn.innerHTML = '⏳…';

        try {
          const res = await api.post(`/quests/${questId}/claim`);
          const message = questClaimMessage(res.claim, isBn);
          if (res.claim?.capped) toast.info(message);
          else toast.success(message);
          if (this.onRewardClaimed) {
            await this.onRewardClaimed(res.claim);
          }
        } catch (err) {
          toast.error(err.message || 'Failed to claim quest');
          btn.disabled = false;
          btn.innerHTML = `🎁 ${isBn ? 'রিওয়ার্ড নিন' : 'Claim Reward'}`;
        }
      });
    });
  }

  _escapeHtml(str?: string | null): string {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  getElement(): HTMLDivElement {
    return this.rootEl;
  }
}
