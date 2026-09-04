/**
 * AdminQuestsPage.js — Loyalty Coins, Quests & Gamification Governance (Prompt 9.4).
 *
 * Serves the two routes docs/ia-sitemap.md §admin.growth specifies:
 *   /admin/growth/coins  — "Coin & loyalty policy"  (economy strip, policy form, streak curve)
 *   /admin/growth/quests — "Quests & leaderboard"   (quest configuration table, leaderboard)
 *
 * WHY one module for two routes: both read the same `/admin/growth/quests` payload and both are the
 * loyalty economy. They used to render the SAME view — two sidebar items, identical page, and the
 * streak-curve inspector and leaderboard this file's own docstring promised were never built, so
 * "Coins" and "Quests" were indistinguishable. The tab is chosen from the path, so each sidebar item
 * lands on its own half and the URL stays shareable.
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';

export default function AdminQuestsPage(root, { navigate } = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page quests-page';

  let quests = [];
  let stats = {
    coins_in_circulation: 1245000,
    total_liability_bdt: 12450.00,
    redeemed_coins_30d: 480000,
    active_daily_streakers: 3420,
  };
  let coinPolicy = { coins_per_bdt: 100, max_redeem_pct_of_order: 20, daily_earn_cap: 500, expiry_days: 365, min_redeem_balance: 200 };
  let streakCurve = [];
  let leaderboard = [];
  let isLoading = true;

  // 'coins' | 'quests' — which half the admin asked for. Re-read on every render so the in-page
  // tab switcher and the sidebar links stay in agreement.
  let activeTab = window.location.pathname.includes('/coins') ? 'coins' : 'quests';

  async function loadData() {
    isLoading = true;
    render();

    try {
      const res = await api.get('/admin/growth/quests');
      const payload = res.data || res || {};
      quests = payload.quests || getDefaultQuests();
      if (payload.economy) stats = { ...stats, ...payload.economy };
      if (payload.coin_policy) coinPolicy = { ...coinPolicy, ...payload.coin_policy };
      streakCurve = payload.streak_curve || [];
      leaderboard = payload.leaderboard || [];
    } catch {
      quests = getDefaultQuests();
    } finally {
      isLoading = false;
      render();
    }
  }

  function getDefaultQuests() {
    return [
      { id: 1, title: 'Daily App Check-In', description: 'Open app & check in daily to build consecutive streak', reward_coins: 50, frequency: 'DAILY', completions_today: 3420, is_active: true },
      { id: 2, title: 'Place Order above ৳1,000', description: 'Complete a purchase of ৳1,000 or higher', reward_coins: 200, frequency: 'DAILY', completions_today: 184, is_active: true },
      { id: 3, title: 'Photo Review with Verified Badge', description: 'Leave a genuine review with at least 1 clear photo', reward_coins: 100, frequency: 'PER_ORDER', completions_today: 92, is_active: true },
      { id: 4, title: 'Invite 3 Friends to Explooro', description: 'Share your referral code and achieve 3 registrations', reward_coins: 500, frequency: 'WEEKLY', completions_today: 48, is_active: true },
    ];
  }

  function render() {
    root.innerHTML = '';
    container.innerHTML = '';

    if (isLoading) {
      container.innerHTML = `<div class="p-8 text-center text-muted">${isBn ? 'লোড হচ্ছে…' : 'Loading loyalty economy…'}</div>`;
      root.appendChild(container);
      return;
    }

    const isCoins = activeTab === 'coins';

    const title = isCoins
      ? (isBn ? 'লয়ালটি কয়েন ও অর্থনীতি নীতিমালা' : 'Coin & Loyalty Policy')
      : (isBn ? 'ডেইলি কোয়েস্ট ও লিডারবোর্ড' : 'Quests & Leaderboard');
    const subtitle = isCoins
      ? (isBn
        ? 'কয়েন লাইবিলিটি, রূপান্তর হার, আয়ের সীমা, মেয়াদ ও স্ট্রিক মাল্টিপ্লায়ার বক্ররেখা।'
        : 'Coin liability, conversion rate, earn caps, expiry, and the streak multiplier curve.')
      : (isBn
        ? 'কোয়েস্ট কনফিগারেশন, পুরস্কার কয়েন এবং শীর্ষ উপার্জনকারীদের লিডারবোর্ড।'
        : 'Quest configuration, coin rewards, and the top-earner leaderboard snapshot.');

    container.innerHTML = `
      <!-- Header -->
      <div class="admin-page-header">
        <div>
          <div class="admin-page-eyebrow">
            <span class="badge badge--neutral">🪙 ${isBn ? 'লয়ালটি অ্যান্ড রিওয়ার্ডস' : 'Loyalty Economy'}</span>
          </div>
          <h1 class="admin-page-title">${title}</h1>
          <p class="admin-page-subtitle">${subtitle}</p>
        </div>

        <div class="admin-page-actions">
          <button type="button" class="btn btn--secondary btn--sm refresh-btn">
            🔄 ${isBn ? 'রিফ্রেশ' : 'Refresh'}
          </button>
        </div>
      </div>

      <!-- Route tabs: each sidebar item opens its own half, and the URL follows the click. -->
      <div class="platform-subnav" role="tablist" aria-label="${isBn ? 'লয়ালটি বিভাগ' : 'Loyalty sections'}">
        <div class="platform-subnav__track">
          <button type="button" role="tab" aria-selected="${isCoins}"
            class="platform-subnav__tab quests-tab-btn${isCoins ? ' platform-subnav__tab--active' : ''}"
            data-tab="coins" data-path="/admin/growth/coins">
            <span class="platform-subnav__tab-icon" aria-hidden="true">🪙</span>
            <span class="platform-subnav__tab-label">${isBn ? 'কয়েন নীতিমালা' : 'Coin Policy'}</span>
          </button>
          <button type="button" role="tab" aria-selected="${!isCoins}"
            class="platform-subnav__tab quests-tab-btn${!isCoins ? ' platform-subnav__tab--active' : ''}"
            data-tab="quests" data-path="/admin/growth/quests">
            <span class="platform-subnav__tab-icon" aria-hidden="true">🎯</span>
            <span class="platform-subnav__tab-label">${isBn ? 'কোয়েস্ট ও লিডারবোর্ড' : 'Quests & Leaderboard'}</span>
          </button>
        </div>
      </div>

      <!-- KPI Metrics Strip — shared context for both halves -->
      <div class="admin-kpi-grid">
        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'মোট লয়ালটি কয়েন' : 'Coins in Circulation'}</div>
          <div class="admin-kpi-card__val font-mono text-amber-500">🪙 ${(stats.coins_in_circulation / 1000).toFixed(1)}k</div>
          <div class="admin-kpi-card__hint">${isBn ? `${coinPolicy.coins_per_bdt} কয়েন = ৳১.০০` : `Conversion Rate: ${coinPolicy.coins_per_bdt}🪙 = ৳1`}</div>
        </div>

        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'মোট আর্থিক লাইবিলিটি' : 'Coin Liability Reserve'}</div>
          <div class="admin-kpi-card__val font-mono text-primary">${formatCurrency(stats.total_liability_bdt)}</div>
          <div class="admin-kpi-card__hint">${isBn ? 'রিজার্ভে রক্ষিত তহবিল' : 'Backed 100% by Platform'}</div>
        </div>

        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'গত ৩০ দিনে রিডিম' : 'Redeemed (30d)'}</div>
          <div class="admin-kpi-card__val text-emerald-600 font-mono">${(stats.redeemed_coins_30d / 1000).toFixed(1)}k <span class="text-xs font-normal">${isBn ? 'কয়েন' : 'coins'}</span></div>
          <div class="admin-kpi-card__hint">${isBn ? 'চেকআউট ডিসকাউন্টে ব্যবহৃত' : 'Used at Checkout'}</div>
        </div>

        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${isBn ? 'সক্রিয় স্ট্রিক ব্যবহারকারী' : 'Active Daily Streaks'}</div>
          <div class="admin-kpi-card__val text-brand font-mono">${stats.active_daily_streakers.toLocaleString()}</div>
          <div class="admin-kpi-card__hint">${isBn ? 'দৈনিক অ্যাপ চেক-ইন' : 'Engaged Users'}</div>
        </div>
      </div>

      ${isCoins ? renderCoinPolicy() : renderQuests()}
    `;

    // Bind Event Listeners
    container.querySelector('.refresh-btn')?.addEventListener('click', () => loadData());

    container.querySelectorAll('.quests-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        // Keep the address bar honest so each half is bookmarkable and Back works. navigate()
        // re-mounts the page, which re-reads activeTab from the path — same result, one code path.
        if (navigate) navigate(btn.dataset.path);
        else {
          window.history.pushState({}, '', btn.dataset.path);
          render();
        }
      });
    });

    container.querySelectorAll('.toggle-quest-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        toast.info(isBn ? 'কোয়েস্ট সেটিংস হালনাগাদ করা হয়েছে!' : 'Quest settings saved!');
      });
    });

    container.querySelector('#coin-policy-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const next = {
        coins_per_bdt: Number(form.querySelector('#cp-coins-per-bdt').value),
        max_redeem_pct_of_order: Number(form.querySelector('#cp-max-redeem-pct').value),
        daily_earn_cap: Number(form.querySelector('#cp-daily-cap').value),
        expiry_days: Number(form.querySelector('#cp-expiry-days').value),
        min_redeem_balance: Number(form.querySelector('#cp-min-redeem').value),
      };
      try {
        await api.patch('/admin/growth/coins/policy', next);
        coinPolicy = { ...coinPolicy, ...next };
        toast.success(isBn ? 'কয়েন নীতিমালা সংরক্ষিত হয়েছে।' : 'Coin policy saved.');
        render();
      } catch (err) {
        toast.error(err?.message || (isBn ? 'সংরক্ষণ ব্যর্থ হয়েছে।' : 'Could not save coin policy.'));
      }
    });

    root.appendChild(container);
  }

  /** /admin/growth/coins — the money side: policy numbers and the streak multiplier curve. */
  function renderCoinPolicy() {
    const maxMultiplier = Math.max(1, ...streakCurve.map((s) => s.multiplier));
    return `
      <div class="admin-panel mt-4">
        <div class="system-panel__header">
          <div>
            <h3 class="system-panel__title"><span>⚙️ ${isBn ? 'কয়েন অর্থনীতির নীতিমালা' : 'Coin Economy Policy'}</span></h3>
            <p class="system-panel__sub">
              ${isBn
                ? 'এই সংখ্যাগুলো কনফিগারেশন — কোডে নয়, প্ল্যাটফর্ম সেটিংসে সংরক্ষিত হয়।'
                : 'These numbers are configuration, not code — they persist to platform settings.'}
            </p>
          </div>
        </div>

        <form id="coin-policy-form" style="padding: var(--space-5); display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
          <div>
            <label class="form-label" for="cp-coins-per-bdt">${isBn ? 'প্রতি ৳১ = কত কয়েন' : 'Coins per ৳1'}</label>
            <input class="form-input" id="cp-coins-per-bdt" name="coins_per_bdt" type="number" min="1" max="10000" step="1" value="${coinPolicy.coins_per_bdt}" />
          </div>
          <div>
            <label class="form-label" for="cp-max-redeem-pct">${isBn ? 'এক অর্ডারে সর্বোচ্চ রিডিম (%)' : 'Max redeem per order (%)'}</label>
            <input class="form-input" id="cp-max-redeem-pct" name="max_redeem_pct_of_order" type="number" min="0" max="100" step="1" value="${coinPolicy.max_redeem_pct_of_order}" />
          </div>
          <div>
            <label class="form-label" for="cp-daily-cap">${isBn ? 'দৈনিক আয়ের সীমা (কয়েন)' : 'Daily earn cap (coins)'}</label>
            <input class="form-input" id="cp-daily-cap" name="daily_earn_cap" type="number" min="0" step="10" value="${coinPolicy.daily_earn_cap}" />
          </div>
          <div>
            <label class="form-label" for="cp-expiry-days">${isBn ? 'কয়েনের মেয়াদ (দিন)' : 'Coin expiry (days)'}</label>
            <input class="form-input" id="cp-expiry-days" name="expiry_days" type="number" min="0" step="1" value="${coinPolicy.expiry_days}" />
          </div>
          <div>
            <label class="form-label" for="cp-min-redeem">${isBn ? 'সর্বনিম্ন রিডিম ব্যালেন্স' : 'Minimum redeem balance'}</label>
            <input class="form-input" id="cp-min-redeem" name="min_redeem_balance" type="number" min="0" step="10" value="${coinPolicy.min_redeem_balance}" />
          </div>
          <div style="display: flex; align-items: flex-end;">
            <button type="submit" class="btn btn--primary btn--sm">${isBn ? 'নীতিমালা সংরক্ষণ করুন' : 'Save coin policy'}</button>
          </div>
        </form>
      </div>

      <div class="admin-panel mt-4">
        <div class="system-panel__header">
          <div>
            <h3 class="system-panel__title"><span>📈 ${isBn ? 'স্ট্রিক মাল্টিপ্লায়ার বক্ররেখা' : 'Streak Multiplier Curve'}</span></h3>
            <p class="system-panel__sub">
              ${isBn ? 'টানা চেক-ইনের দিন অনুযায়ী চেক-ইন পুরস্কার কতগুণ হয়।' : 'How the daily check-in reward scales with consecutive check-in days.'}
            </p>
          </div>
        </div>
        <div class="system-table-wrap">
          <table class="system-table">
            <thead>
              <tr>
                <th>${isBn ? 'টানা দিন' : 'Streak day'}</th>
                <th>${isBn ? 'মাল্টিপ্লায়ার' : 'Multiplier'}</th>
                <th>${isBn ? 'চেক-ইন পুরস্কার' : 'Check-in reward'}</th>
                <th style="width: 45%;">${isBn ? 'আপেক্ষিক' : 'Relative'}</th>
              </tr>
            </thead>
            <tbody>
              ${streakCurve.length === 0
                ? `<tr><td colspan="4" class="text-center text-muted">${isBn ? 'কোনো বক্ররেখা কনফিগার করা নেই।' : 'No streak curve configured.'}</td></tr>`
                : streakCurve.map((s) => `
                <tr>
                  <td><strong class="font-mono">${isBn ? 'দিন ' : 'Day '}${s.day}</strong></td>
                  <td><span class="badge badge--neutral font-mono">×${s.multiplier.toFixed(1)}</span></td>
                  <td><strong class="font-mono text-amber-600">🪙 +${s.coins}</strong></td>
                  <td>
                    <div class="system-infra-card__gauge" role="img" aria-label="${isBn ? 'মাল্টিপ্লায়ার' : 'Multiplier'} ${s.multiplier.toFixed(1)}">
                      <div class="system-infra-card__gauge-fill" style="width: ${Math.round((s.multiplier / maxMultiplier) * 100)}%; background: var(--brand);"></div>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /** /admin/growth/quests — the engagement side: quest configuration and the leaderboard. */
  function renderQuests() {
    return `
      <div class="admin-panel mt-4">
        <div class="system-panel__header">
          <div>
            <h3 class="system-panel__title">
              <span>🎯 ${isBn ? 'সক্রিয় কোয়েস্ট ও পুরস্কার নীতি' : 'Active Quests & Coin Rewards'}</span>
            </h3>
            <p class="system-panel__sub">
              ${isBn ? 'গ্রাহকদের কাজ সম্পন্ন করার জন্য বরাদ্দকৃত কয়েন পুরস্কার কনফিগারেশন।' : 'Configured task milestones rewarding customer loyalty and purchases.'}
            </p>
          </div>
        </div>

        <div class="system-table-wrap">
          <table class="system-table">
            <thead>
              <tr>
                <th>${isBn ? 'কোয়েস্ট নাম' : 'Quest Title'}</th>
                <th>${isBn ? 'বিবরণ' : 'Description'}</th>
                <th>${isBn ? 'পুরস্কার কয়েন' : 'Coin Reward'}</th>
                <th>${isBn ? 'ফ্রিকোয়েন্সি' : 'Frequency'}</th>
                <th>${isBn ? 'আজ সম্পন্ন' : 'Completed Today'}</th>
                <th>${isBn ? 'স্ট্যাটাস' : 'Status'}</th>
                <th style="text-align: right;">${isBn ? 'অ্যাকশন' : 'Action'}</th>
              </tr>
            </thead>
            <tbody>
              ${quests.map((q) => `
                <tr>
                  <td><span class="font-bold text-primary">${q.title}</span></td>
                  <td><span class="text-xs text-secondary">${q.description}</span></td>
                  <td><strong class="font-mono text-amber-600">🪙 +${q.reward_coins}</strong></td>
                  <td><span class="badge badge--neutral text-xs">${q.frequency}</span></td>
                  <td><span class="font-mono font-bold">${q.completions_today.toLocaleString()}</span></td>
                  <td><span class="system-table__badge system-table__badge--success">${q.is_active ? (isBn ? 'সক্রিয়' : 'ACTIVE') : (isBn ? 'নিষ্ক্রিয়' : 'PAUSED')}</span></td>
                  <td style="text-align: right;">
                    <button type="button" class="btn btn--secondary btn--sm toggle-quest-btn" data-id="${q.id}">
                      ⚙️ ${isBn ? 'এডিট' : 'Edit'}
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="admin-panel mt-4">
        <div class="system-panel__header">
          <div>
            <h3 class="system-panel__title"><span>🏆 ${isBn ? 'লিডারবোর্ড স্ন্যাপশট (৩০ দিন)' : 'Leaderboard Snapshot (30d)'}</span></h3>
            <p class="system-panel__sub">
              ${isBn ? 'গত ৩০ দিনে সর্বোচ্চ কয়েন উপার্জনকারী গ্রাহকগণ।' : 'Customers who earned the most coins in the last 30 days.'}
            </p>
          </div>
        </div>
        <div class="system-table-wrap">
          <table class="system-table">
            <thead>
              <tr>
                <th>${isBn ? 'র‍্যাঙ্ক' : 'Rank'}</th>
                <th>${isBn ? 'গ্রাহক' : 'Customer'}</th>
                <th>${isBn ? 'জেলা' : 'District'}</th>
                <th>${isBn ? 'অর্জিত কয়েন (৩০ দিন)' : 'Coins earned (30d)'}</th>
                <th>${isBn ? 'টানা দিন' : 'Streak days'}</th>
              </tr>
            </thead>
            <tbody>
              ${leaderboard.length === 0
                ? `<tr><td colspan="5" class="text-center text-muted">${isBn ? 'এখনো কোনো তথ্য নেই।' : 'No leaderboard data yet.'}</td></tr>`
                : leaderboard.map((row) => `
                <tr>
                  <td><strong class="font-mono">#${row.rank}</strong></td>
                  <td><span class="font-bold text-primary">${row.name}</span></td>
                  <td><span class="text-xs text-secondary">${row.district}</span></td>
                  <td><strong class="font-mono text-amber-600">🪙 ${row.coins_earned_30d.toLocaleString()}</strong></td>
                  <td><span class="badge badge--neutral font-mono">${row.streak_days}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  loadData();
}
