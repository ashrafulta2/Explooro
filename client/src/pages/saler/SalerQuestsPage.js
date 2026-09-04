/**
 * SalerQuestsPage.js — Saler Daily Quests, Milestone Rewards & National Leaderboard (Prompt 9.4 / §AL.2).
 *
 * Routes: /saler/quests, /saler/leaderboard
 * Implements:
 * 1. Reseller Daily & Weekly Quests (Sourcing, WhatsApp Sharing, Order Milestones, Live Streaming).
 * 2. 1-Click Interactive Reward Claiming with instant coin balance ledger updates.
 * 3. Monthly National Merchant Podium (Top 3 Gold/Silver/Bronze Champion Cards).
 * 4. Top 50 Ranked Seller Leaderboard with status badges & personal rank highlight.
 * 5. 100% Bilingual localization (English & Bengali).
 */

import { salerApi } from '../../services/saler.api.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';

export default function SalerQuestsPage(root, { navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'saler-page-container';

  let activeTab = window.location.pathname.includes('/leaderboard') ? 'leaderboard' : 'quests';
  let quests = [];
  let coinBalance = 1450;
  let streakDays = 4;
  let leaderboard = [];
  let currentUserRank = 4;
  let loading = true;
  let unsubscribeLang = null;

  async function loadData() {
    loading = true;
    render();
    try {
      const [questsRes, lbRes] = await Promise.all([
        salerApi.getQuests(),
        salerApi.getLeaderboard(),
      ]);
      quests = questsRes?.data?.quests || [];
      coinBalance = questsRes?.data?.coin_balance || 1450;
      streakDays = questsRes?.data?.daily_streak_days || 4;
      leaderboard = lbRes?.data?.leaderboard || [];
      currentUserRank = lbRes?.data?.current_user_rank || 4;
    } catch (err) {
      toast.error(err.message || 'Failed to load quests data');
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    container.innerHTML = '';
    const isBn = getLanguage() === 'bn';

    // 1. Header
    const header = document.createElement('div');
    header.className = 'saler-header-row';
    header.innerHTML = `
      <div class="saler-header-row__titles">
        <div class="saler-header-row__breadcrumb">
          <a href="/saler" class="hover:text-primary">← ${t('saler.dashboard.title', 'Dashboard')}</a>
          <span>/</span>
          <span class="text-primary font-bold">${t('saler_quests.title')}</span>
        </div>
        <h1 class="saler-header-row__title">
          <span>🎯</span>
          <span>${t('saler_quests.title')}</span>
        </h1>
        <p class="saler-header-row__subtitle">
          ${t('saler_quests.subtitle')}
        </p>
      </div>
      <div class="saler-header-row__actions">
        <div class="flex items-center gap-3 bg-surface-0 border border-subtle p-2 px-4 rounded-xl shadow-xs">
          <div class="flex items-center gap-1.5 font-bold font-mono text-foreground text-sm">
            <span>🪙</span>
            <span>${coinBalance.toLocaleString()}</span>
            <span class="text-xs text-muted font-normal">${isBn ? 'কয়েন' : 'Coins'}</span>
          </div>
          <div class="h-4 w-px bg-subtle"></div>
          <div class="flex items-center gap-1.5 font-bold text-amber-600 text-xs">
            <span>🔥</span>
            <span>${streakDays} ${t('saler_quests.streak_badge')}</span>
          </div>
        </div>
      </div>
    `;
    container.append(header);

    // 2. Tab Navigation
    const tabsBar = document.createElement('div');
    tabsBar.className = 'flex gap-2 border-b border-subtle pb-2';
    tabsBar.innerHTML = `
      <button class="btn btn--sm ${activeTab === 'quests' ? 'btn--primary font-bold' : 'btn--neutral'} tab-btn" data-tab="quests">
        ${t('saler_quests.tab_quests')}
      </button>
      <button class="btn btn--sm ${activeTab === 'leaderboard' ? 'btn--primary font-bold' : 'btn--neutral'} tab-btn" data-tab="leaderboard">
        ${t('saler_quests.tab_leaderboard')}
      </button>
    `;

    tabsBar.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.onclick = () => {
        activeTab = btn.getAttribute('data-tab');
        if (activeTab === 'leaderboard') {
          history.replaceState({}, '', '/saler/leaderboard');
        } else {
          history.replaceState({}, '', '/saler/quests');
        }
        render();
      };
    });

    container.append(tabsBar);

    // 3. Tab Content Slot
    const contentSlot = document.createElement('div');
    contentSlot.className = 'saler-stack--lg';

    if (loading) {
      contentSlot.append(
        Skeleton({ width: '100%', height: '100px' }),
        Skeleton({ width: '100%', height: '100px' }),
        Skeleton({ width: '100%', height: '100px' })
      );
    } else if (activeTab === 'quests') {
      renderQuestsTab(contentSlot, isBn);
    } else {
      renderLeaderboardTab(contentSlot, isBn);
    }

    container.append(contentSlot);
  }

  function renderQuestsTab(slot, isBn) {
    const list = document.createElement('div');
    list.className = 'saler-stack--sm';

    quests.forEach((q) => {
      const card = document.createElement('div');
      card.className = `saler-quest-card ${q.is_completed ? 'saler-quest-card--completed' : ''}`;

      const progressPct = Math.min(100, Math.round((q.current_count / q.target_count) * 100));
      const title = isBn ? (q.title_bn || q.title_en) : q.title_en;
      const desc = isBn ? (q.desc_bn || q.desc_en) : q.desc_en;

      card.innerHTML = `
        <div class="saler-row" style="gap: 16px;">
          <div class="saler-quest-card__icon">${q.icon || '🎯'}</div>
          <div class="saler-stack--xs">
            <div class="saler-row" style="gap: 8px;">
              <span style="font-weight: 700; font-size: 14px; color: var(--text-primary);">${title}</span>
              <span class="badge badge--neutral text-[10px] uppercase font-mono font-bold">${q.category}</span>
            </div>
            <p class="text-xs text-muted leading-relaxed" style="margin: 0;">${desc}</p>
            <div class="saler-row pt-1" style="gap: 12px;">
              <div style="width: 128px; height: 6px; border-radius: 9999px; background: var(--surface-2); overflow: hidden;">
                <div style="background: var(--brand-500, #ecae00); height: 100%; border-radius: 9999px; transition: width 0.3s ease; width: ${progressPct}%;"></div>
              </div>
              <span class="text-[10px] font-mono font-bold text-muted">${q.current_count}/${q.target_count}</span>
            </div>
          </div>
        </div>

        <div class="saler-row shrink-0" style="gap: 12px;">
          <div style="text-align: right;">
            <div style="font-size: 13px; font-weight: 900; font-family: var(--font-mono); color: var(--brand-700, #b48300);">+${q.reward_coins} 🪙</div>
            <div class="text-[10px] text-muted uppercase">Reward</div>
          </div>
          <div>
            ${
              q.is_claimed
                ? `<span class="badge badge--success text-xs font-bold">${t('saler_quests.claimed_badge')}</span>`
                : q.is_completed
                ? `<button class="btn-claim btn btn--primary btn--sm font-bold" data-id="${q.id}">
                     ${t('saler_quests.btn_claim_reward', { coins: q.reward_coins })}
                   </button>`
                : `<span class="badge badge--neutral text-xs font-mono font-bold">In Progress</span>`
            }
          </div>
        </div>
      `;

      const claimBtn = card.querySelector('.btn-claim');
      if (claimBtn) {
        claimBtn.onclick = async () => {
          try {
            await salerApi.claimQuest(q.id);
            q.is_claimed = true;
            coinBalance += q.reward_coins;
            toast.success(t('saler_quests.toast_claimed', { coins: q.reward_coins }));
            render();
          } catch (err) {
            toast.error(err.message || 'Failed to claim reward');
          }
        };
      }

      list.append(card);
    });

    slot.append(list);

    // Rules Card
    const rulesCard = document.createElement('div');
    rulesCard.className = 'saler-card';
    rulesCard.innerHTML = `
      <h4 class="saler-card__title">💡 ${t('saler_quests.rules_title')}</h4>
      <ul class="text-xs text-muted saler-stack--xs list-disc list-inside">
        <li>${t('saler_quests.rule_1')}</li>
        <li>${t('saler_quests.rule_2')}</li>
        <li>${t('saler_quests.rule_3')}</li>
      </ul>
    `;
    slot.append(rulesCard);
  }

  function renderLeaderboardTab(slot, isBn) {
    // 1. Top 3 Podium Cards
    const podiumWrap = document.createElement('div');
    podiumWrap.className = 'saler-leaderboard-podium';

    const top1 = leaderboard[0];
    const top2 = leaderboard[1];
    const top3 = leaderboard[2];

    if (top1 && top2 && top3) {
      podiumWrap.innerHTML = `
        <!-- 2nd Place Silver -->
        <div class="saler-podium-card saler-podium-card--silver">
          <div class="text-3xl mb-1">${top2.avatar || '🥈'}</div>
          <span class="badge badge--neutral text-[10px] font-bold uppercase">${t('saler_quests.podium_silver_title')}</span>
          <div class="font-black text-base text-foreground mt-1">${top2.saler_name}</div>
          <div class="text-xs text-muted font-mono">@${top2.store_slug}</div>
          <div class="text-sm font-extrabold text-foreground font-mono mt-2">${top2.sales_count} Sales · ৳${formatNumber(top2.gmv)}</div>
          <div class="text-xs font-bold text-emerald-600 font-mono">+৳${formatNumber(top2.net_profit)} profit</div>
        </div>

        <!-- 1st Place Gold -->
        <div class="saler-podium-card saler-podium-card--gold">
          <div class="text-4xl mb-1 animate-pulse">${top1.avatar || '👑'}</div>
          <span class="badge badge--warning text-[10px] font-bold uppercase">${t('saler_quests.podium_gold_title')}</span>
          <div class="font-black text-lg text-foreground mt-1">${top1.saler_name}</div>
          <div class="text-xs text-muted font-mono">@${top1.store_slug}</div>
          <div class="text-base font-extrabold text-foreground font-mono mt-2">${top1.sales_count} Sales · ৳${formatNumber(top1.gmv)}</div>
          <div class="text-sm font-bold text-emerald-600 font-mono">+৳${formatNumber(top1.net_profit)} profit</div>
        </div>

        <!-- 3rd Place Bronze -->
        <div class="saler-podium-card saler-podium-card--bronze">
          <div class="text-3xl mb-1">${top3.avatar || '🥉'}</div>
          <span class="badge badge--neutral text-[10px] font-bold uppercase">${t('saler_quests.podium_bronze_title')}</span>
          <div class="font-black text-base text-foreground mt-1">${top3.saler_name}</div>
          <div class="text-xs text-muted font-mono">@${top3.store_slug}</div>
          <div class="text-sm font-extrabold text-foreground font-mono mt-2">${top3.sales_count} Sales · ৳${formatNumber(top3.gmv)}</div>
          <div class="text-xs font-bold text-emerald-600 font-mono">+৳${formatNumber(top3.net_profit)} profit</div>
        </div>
      `;
    }

    slot.append(podiumWrap);

    // 2. Full Leaderboard Table
    const tableWrap = document.createElement('div');
    tableWrap.className = 'saler-table-wrap';

    const table = document.createElement('table');
    table.className = 'saler-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>${t('saler_quests.th_rank')}</th>
          <th>${t('saler_quests.th_merchant')}</th>
          <th>${t('saler_quests.th_sales')}</th>
          <th>${t('saler_quests.th_gmv')}</th>
          <th>${t('saler_quests.th_net_profit')}</th>
          <th class="text-right">${t('saler_quests.th_tier')}</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    leaderboard.forEach((item) => {
      const tr = document.createElement('tr');
      if (item.is_current_user) {
        tr.className = 'bg-primary-50/50 font-semibold border-l-4 border-l-primary';
      }

      tr.innerHTML = `
        <td class="font-bold font-mono text-sm">
          ${item.rank === 1 ? '🥇 #1' : item.rank === 2 ? '🥈 #2' : item.rank === 3 ? '🥉 #3' : `#${item.rank}`}
        </td>
        <td>
          <div class="flex items-center gap-2">
            <span class="text-base">${item.avatar || '👤'}</span>
            <div>
              <div class="font-bold text-foreground text-sm flex items-center gap-1.5">
                <span>${item.saler_name}</span>
                ${item.is_current_user ? '<span class="badge badge--primary text-[10px]">YOU</span>' : ''}
              </div>
              <div class="text-xs text-muted font-mono">@${item.store_slug}</div>
            </div>
          </div>
        </td>
        <td class="font-mono text-sm text-foreground">${item.sales_count}</td>
        <td class="font-mono text-sm font-bold text-foreground">${formatCurrency(item.gmv)}</td>
        <td class="font-mono text-sm font-bold text-emerald-600">+${formatCurrency(item.net_profit)}</td>
        <td class="text-right">
          <span class="badge ${item.tier_badge.includes('PLATINUM') ? 'badge--primary' : item.tier_badge.includes('GOLD') ? 'badge--warning' : 'badge--neutral'} text-xs font-mono">
            ${item.tier_badge}
          </span>
        </td>
      `;

      tbody.appendChild(tr);
    });

    tableWrap.appendChild(table);
    slot.append(tableWrap);
  }

  unsubscribeLang = subscribeLang(() => render());

  loadData();
  root.append(container);

  return () => {
    if (unsubscribeLang) unsubscribeLang();
    container.remove();
  };
}
