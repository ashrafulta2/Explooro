/**
 * AdminPartnerRewardsPage.js — the monthly shop partner reward pool (/admin/growth/partner-rewards).
 *
 * A shop partner earns nothing per sale. Every month the pool (the supplier-set partner share of
 * every partner-brought sale, plus a share of ad revenue) is split by score: store sales > social
 * shares > community posts > activity. server/src/services/partnerReward.service.ts does all of it;
 * this page shows the month so far, the closed months, and the rules.
 *
 * `growth.partner_reward.view` (LOW) opens the page; `.update` (CRITICAL) enables Save and `.run`
 * (CRITICAL) enables "Close now". Every save needs a reason and writes an audit row.
 *
 * WHY the bounds come from the API (`limits`): the server refuses out-of-range values, and the page
 * must never offer one it would refuse.
 */

import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.ts';
import { api } from '../../core/api.js';
import { can } from '../../services/permissions.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency, formatNumber, formatRelativeTime } from '../../services/format.js';
import { escapeHtml } from '../../services/html.ts';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.js';
import { FACTOR_ORDER, monthLabel } from '../../components/saler/PartnerRewardCard.ts';

const MIN_REASON_LENGTH = 10;
const COMMUNITY_KEYS = ['post', 'like', 'comment', 'save'];

export default function AdminPartnerRewardsPage(root) {
  loadSystemHealthStyles();
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page partner-rewards-page';

  let data = null;
  let loadError = null;
  let isLoading = true;
  let page = 1;

  async function loadData() {
    isLoading = true;
    render();
    try {
      data = await api.get('/admin/growth/partner-rewards', { query: { page } });
      loadError = null;
    } catch (err) {
      loadError = err?.message || t('common.error_generic');
    } finally {
      isLoading = false;
      render();
    }
  }

  const relative = (iso) => formatRelativeTime(new Date(iso).getTime(), { lang: isBn ? 'bn' : 'en' });
  const money = (v) => formatCurrency(Number(v) || 0);
  const factorName = (k) => t(`admin.partner_rewards.factor_${k}`);

  function kpis() {
    const { preview, policy } = data;
    const card = (label, value, hint) => `
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(label)}</div>
        <div class="admin-kpi-card__val font-mono">${escapeHtml(value)}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(hint)}</div>
      </div>`;
    const grid = document.createElement('div');
    grid.className = 'admin-kpi-grid';
    grid.innerHTML =
      card(t('admin.partner_rewards.kpi_pool'), money(preview.pool.estimated), t('admin.partner_rewards.kpi_pool_hint', { month: monthLabel(preview.period.start) })) +
      card(t('admin.partner_rewards.kpi_released'), money(preview.pool.available), t('admin.partner_rewards.kpi_pending', { amount: money(preview.pool.pending) })) +
      card(t('admin.partner_rewards.kpi_ad_share'), money(preview.pool.ad_share), t('admin.partner_rewards.kpi_ad_share_hint', { pct: formatNumber(policy.ad_revenue_share_pct), revenue: money(preview.pool.ad_revenue) })) +
      card(t('admin.partner_rewards.kpi_partners'), formatNumber(preview.partners_scored), t('admin.partner_rewards.kpi_closes', { date: preview.closes_on }));
    return grid;
  }

  function closePanel() {
    const canRun = data.can_run !== false && can('growth.partner_reward.run');
    const periods = data.closable_periods || [];
    const panel = document.createElement('section');
    panel.className = 'admin-panel mt-4';
    panel.innerHTML = `
      <h2 class="admin-panel__title">${escapeHtml(t('admin.partner_rewards.close_title'))}</h2>
      <p class="text-sm text-secondary">${escapeHtml(t('admin.partner_rewards.close_desc', { days: formatNumber(data.policy.settle_lag_days) }))}</p>
    `;
    const note = document.createElement('p');
    note.className = 'text-xs text-muted mt-2';
    if (!periods.length) {
      note.textContent = t('admin.partner_rewards.close_none', { month: monthLabel(data.preview.period.start), date: data.preview.closes_on });
      panel.append(note);
      return panel;
    }
    const btn = Button({
      label: t('admin.partner_rewards.close_btn', { months: periods.map(monthLabel).join(', ') }),
      variant: 'primary',
      size: 'sm',
      disabled: !canRun,
      onClick: async () => {
        if (!window.confirm(t('admin.partner_rewards.close_confirm'))) return;
        btn.disabled = true;
        try {
          const res = await api.post('/admin/growth/partner-rewards/close', {}, { headers: { 'Idempotency-Key': `partner-reward-close-${periods.join('-')}` } });
          toast.success((isBn ? res?.message_bn : res?.message_en) || t('admin.partner_rewards.closed'));
          await loadData();
        } catch (err) {
          toast.error(err?.message || t('common.error_generic'));
          btn.disabled = false;
        }
      },
    });
    panel.append(btn);
    if (!canRun) {
      note.textContent = t('admin.partner_rewards.super_admin_only');
      panel.append(note);
    }
    return panel;
  }

  function topPanel() {
    const { preview } = data;
    const panel = document.createElement('section');
    panel.className = 'admin-panel mt-4';
    const head = FACTOR_ORDER.map((f) => `<th class="text-right">${escapeHtml(factorName(f))}</th>`).join('');
    const rows = (preview.top || []).map((r) => `
      <tr>
        <td>${escapeHtml(r.name || `#${r.saler_id}`)}</td>
        ${FACTOR_ORDER.map((f) => `<td class="text-right font-mono">${escapeHtml(formatNumber(r.values?.[f] ?? 0))} <span class="text-xs text-muted">(${escapeHtml(formatNumber(r.points?.[f] ?? 0))})</span></td>`).join('')}
        <td class="text-right font-mono">${escapeHtml(formatNumber(r.score))}</td>
        <td class="text-right font-mono">${escapeHtml(formatNumber(r.share_pct))}%</td>
        <td class="text-right font-mono"><strong>${escapeHtml(money(r.estimated_amount))}</strong></td>
      </tr>`).join('');
    panel.innerHTML = `
      <h2 class="admin-panel__title">${escapeHtml(t('admin.partner_rewards.top_title', { month: monthLabel(preview.period.start) }))}</h2>
      <p class="text-xs text-muted">${escapeHtml(t('admin.partner_rewards.top_desc'))}</p>` + (rows
      ? `<div class="system-table-wrap"><table class="system-table">
          <thead><tr><th>${escapeHtml(t('admin.partner_rewards.col_partner'))}</th>${head}
            <th class="text-right">${escapeHtml(t('admin.partner_rewards.col_score'))}</th>
            <th class="text-right">${escapeHtml(t('admin.partner_rewards.col_share'))}</th>
            <th class="text-right">${escapeHtml(t('admin.partner_rewards.col_estimate'))}</th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
      : `<p class="p-6 text-center text-sm text-muted">${escapeHtml(t('admin.partner_rewards.top_empty'))}</p>`);
    return panel;
  }

  function settingsCard() {
    const { policy, limits } = data;
    const canUpdate = data.can_update !== false && can('growth.partner_reward.update');
    const panel = document.createElement('section');
    panel.className = 'admin-panel group-buy-settings mt-4';
    panel.innerHTML = `
      <h2 class="admin-panel__title">${escapeHtml(t('admin.partner_rewards.rules_title'))}</h2>
      <p class="text-sm text-secondary">${escapeHtml(t('admin.partner_rewards.rules_desc'))}</p>
    `;

    const numberInput = (label, hint, name, value, { min, max, step = '1' }) => {
      const field = Input({ label, hint, type: 'number', name, value: String(value), inputmode: 'decimal', required: true });
      field.input.min = String(min);
      field.input.max = String(max);
      field.input.step = step;
      field.input.disabled = !canUpdate;
      return field;
    };

    const weightGrid = document.createElement('div');
    weightGrid.className = 'group-buy-settings__grid';
    const weights = Object.fromEntries(FACTOR_ORDER.map((f) => [f, numberInput(
      factorName(f), t('admin.partner_rewards.weight_hint'), `weight_${f}`, policy.weights[f], limits.weight,
    )]));
    FACTOR_ORDER.forEach((f) => weightGrid.append(weights[f]));
    const sumLine = document.createElement('p');
    sumLine.className = 'text-xs text-muted';
    const renderSum = () => {
      const sum = FACTOR_ORDER.reduce((s, f) => s + (Number(weights[f].value) || 0), 0);
      sumLine.textContent = t('admin.partner_rewards.weight_sum', { sum: formatNumber(sum), total: formatNumber(limits.weight.total) });
    };
    FACTOR_ORDER.forEach((f) => weights[f].input.addEventListener('input', renderSum));
    renderSum();

    const otherGrid = document.createElement('div');
    otherGrid.className = 'group-buy-settings__grid';
    const adShare = numberInput(t('admin.partner_rewards.ad_share_label'), t('admin.partner_rewards.ad_share_hint'),
      'ad_revenue_share_pct', policy.ad_revenue_share_pct, { ...limits.ad_revenue_share_pct, step: '0.01' });
    const maxPosts = numberInput(t('admin.partner_rewards.max_posts_label'), t('admin.partner_rewards.max_posts_hint'),
      'max_posts_per_day', policy.max_posts_per_day, limits.max_posts_per_day);
    const lag = numberInput(t('admin.partner_rewards.lag_label'), t('admin.partner_rewards.lag_hint'),
      'settle_lag_days', policy.settle_lag_days, limits.settle_lag_days);
    otherGrid.append(adShare, maxPosts, lag);

    const communityGrid = document.createElement('div');
    communityGrid.className = 'group-buy-settings__grid';
    const points = Object.fromEntries(COMMUNITY_KEYS.map((k) => [k, numberInput(
      t(`admin.partner_rewards.points_${k}`), t('admin.partner_rewards.points_hint'), `points_${k}`, policy.community_points[k], limits.community_point,
    )]));
    COMMUNITY_KEYS.forEach((k) => communityGrid.append(points[k]));

    const reason = Input({
      label: t('admin.partner_rewards.reason'),
      hint: t('admin.partner_rewards.reason_hint', { min: MIN_REASON_LENGTH }),
      type: 'text',
      name: 'reason',
      maxLength: 500,
      required: true,
    });
    reason.input.disabled = !canUpdate;

    const subhead = (key) => {
      const h = document.createElement('h3');
      h.className = 'text-sm font-semibold mt-4';
      h.textContent = t(key);
      return h;
    };

    const save = Button({
      label: t('common.save_changes'),
      variant: 'primary',
      size: 'sm',
      disabled: !canUpdate,
      onClick: async () => {
        if (reason.value.trim().length < MIN_REASON_LENGTH) {
          toast.error(t('admin.partner_rewards.reason_hint', { min: MIN_REASON_LENGTH }));
          reason.input.focus();
          return;
        }
        const int = (field) => Number(field.value);
        const body = {
          weights: Object.fromEntries(FACTOR_ORDER.map((f) => [f, int(weights[f])])),
          ad_revenue_share_pct: Number(adShare.value),
          community_points: Object.fromEntries(COMMUNITY_KEYS.map((k) => [k, int(points[k])])),
          max_posts_per_day: int(maxPosts),
          settle_lag_days: int(lag),
          expected_updated_at: policy.updated_at ?? null,
          reason: reason.value.trim(),
        };
        save.disabled = true;
        try {
          const res = await api.put('/admin/growth/partner-rewards', body);
          toast.success((isBn ? res?.message_bn : res?.message_en) || t('admin.partner_rewards.saved'));
          await loadData();
        } catch (err) {
          toast.error(err?.message || t('common.error_generic'));
          save.disabled = false;
        }
      },
    });

    const actions = document.createElement('div');
    actions.className = 'group-buy-settings__actions';
    actions.append(sumLine, save);
    panel.append(subhead('admin.partner_rewards.weights_title'), weightGrid, subhead('admin.partner_rewards.pool_title'), otherGrid,
      subhead('admin.partner_rewards.points_title'), communityGrid, reason, actions);

    const rules = document.createElement('ul');
    rules.className = 'text-xs text-secondary mt-2';
    for (const key of ['rule_split', 'rule_order', 'rule_carry', 'rule_first']) {
      const li = document.createElement('li');
      li.textContent = t(`admin.partner_rewards.${key}`, { month: policy.first_month ? monthLabel(policy.first_month) : '—' });
      rules.append(li);
    }
    panel.append(rules);

    if (!canUpdate) {
      const note = document.createElement('p');
      note.className = 'text-xs text-muted mt-2';
      note.textContent = t('admin.partner_rewards.super_admin_only');
      panel.append(note);
    }
    return panel;
  }

  function runsPanel() {
    const { runs } = data;
    const panel = document.createElement('section');
    panel.className = 'admin-panel mt-4';
    panel.innerHTML = `<h2 class="admin-panel__title">${escapeHtml(t('admin.partner_rewards.runs_title'))}</h2>`;
    if (!runs.items.length) {
      panel.insertAdjacentHTML('beforeend', `<p class="p-6 text-center text-sm text-muted">${escapeHtml(t('admin.partner_rewards.runs_empty'))}</p>`);
      return panel;
    }
    const wrap = document.createElement('div');
    wrap.className = 'system-table-wrap';
    const table = document.createElement('table');
    table.className = 'system-table';
    table.innerHTML = `<thead><tr>
      <th>${escapeHtml(t('admin.partner_rewards.col_month'))}</th>
      <th class="text-right">${escapeHtml(t('admin.partner_rewards.col_ad_share'))}</th>
      <th class="text-right">${escapeHtml(t('admin.partner_rewards.col_pool'))}</th>
      <th class="text-right">${escapeHtml(t('admin.partner_rewards.col_paid'))}</th>
      <th class="text-right">${escapeHtml(t('admin.partner_rewards.col_carried'))}</th>
      <th class="text-right">${escapeHtml(t('admin.partner_rewards.col_partners'))}</th>
      <th></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const run of runs.items) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(monthLabel(run.period_start))}</td>
        <td class="text-right font-mono">${escapeHtml(money(run.ad_share))}</td>
        <td class="text-right font-mono">${escapeHtml(money(run.pool_amount))}</td>
        <td class="text-right font-mono"><strong>${escapeHtml(money(run.paid_amount))}</strong></td>
        <td class="text-right font-mono">${escapeHtml(money(run.carried_amount))}</td>
        <td class="text-right font-mono">${escapeHtml(formatNumber(run.partners_scored))}</td>
        <td class="text-right"></td>`;
      const detailRow = document.createElement('tr');
      detailRow.hidden = true;
      const detailCell = document.createElement('td');
      detailCell.colSpan = 7;
      detailRow.append(detailCell);
      const toggle = Button({
        label: t('admin.partner_rewards.view_payouts'),
        variant: 'secondary',
        size: 'sm',
        onClick: async () => {
          if (!detailRow.hidden) {
            detailRow.hidden = true;
            return;
          }
          detailRow.hidden = false;
          detailCell.textContent = t('common.loading');
          try {
            const res = await api.get(`/admin/growth/partner-rewards/runs/${run.id}/payouts`);
            detailCell.innerHTML = (res.items || []).length
              ? `<table class="system-table"><tbody>${res.items.map((p) => `
                  <tr><td>${escapeHtml(p.partner_name || `#${p.saler_id}`)}</td>
                  <td class="text-right font-mono">${escapeHtml(formatNumber(Number(p.score)))}</td>
                  <td class="text-right font-mono">${escapeHtml(formatNumber(Number(p.share_pct)))}%</td>
                  <td class="text-right font-mono"><strong>${escapeHtml(money(p.amount))}</strong></td></tr>`).join('')}</tbody></table>`
              : escapeHtml(t('admin.partner_rewards.payouts_empty'));
          } catch (err) {
            detailCell.textContent = err?.message || t('common.error_generic');
          }
        },
      });
      tr.lastElementChild.append(toggle);
      tbody.append(tr, detailRow);
    }
    table.append(tbody);
    wrap.append(table);
    panel.append(wrap);

    const pages = Math.max(1, Math.ceil(runs.total / runs.limit));
    if (pages > 1) {
      const nav = document.createElement('div');
      nav.className = 'group-buy-settings__actions';
      const prev = Button({ label: t('admin.partner_rewards.prev'), variant: 'secondary', size: 'sm', disabled: page <= 1, onClick: () => { page -= 1; loadData(); } });
      const next = Button({ label: t('admin.partner_rewards.next'), variant: 'secondary', size: 'sm', disabled: page >= pages, onClick: () => { page += 1; loadData(); } });
      nav.append(prev, next);
      panel.append(nav);
    }
    return panel;
  }

  function historyPanel() {
    const panel = document.createElement('section');
    panel.className = 'admin-panel mt-4';
    const summary = (j) => j?.weights ? FACTOR_ORDER.map((f) => j.weights[f]).join('/') + ` · ${j.ad_revenue_share_pct}%` : '—';
    const rows = (data.history || []).map((row) => `
      <tr>
        <td class="text-xs">${escapeHtml(row.created_at ? relative(row.created_at) : '—')}</td>
        <td class="text-xs font-mono">${escapeHtml(row.actor_ref || row.actor_id || '—')}</td>
        <td class="font-mono text-xs">${escapeHtml(summary(row.before_json))} → <strong>${escapeHtml(summary(row.after_json))}</strong></td>
        <td class="text-xs text-secondary">${escapeHtml(row.after_json?.meta?.reason || row.meta_json?.reason || '')}</td>
      </tr>`).join('');
    panel.innerHTML = `<h2 class="admin-panel__title">${escapeHtml(t('admin.partner_rewards.history_title'))}</h2>` + (rows
      ? `<div class="system-table-wrap"><table class="system-table"><thead><tr>
          <th>${escapeHtml(t('admin.partner_rewards.col_when'))}</th>
          <th>${escapeHtml(t('admin.partner_rewards.col_who'))}</th>
          <th>${escapeHtml(t('admin.partner_rewards.col_change'))}</th>
          <th>${escapeHtml(t('admin.partner_rewards.col_reason'))}</th>
        </tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="p-6 text-center text-sm text-muted">${escapeHtml(t('admin.partner_rewards.history_empty'))}</p>`);
    return panel;
  }

  function render() {
    root.innerHTML = '';
    container.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'admin-page-header';
    header.innerHTML = `
      <div>
        <h1 class="admin-page-title">${escapeHtml(t('admin.partner_rewards.title'))}</h1>
        <p class="admin-page-subtitle">${escapeHtml(t('admin.partner_rewards.subtitle'))}</p>
      </div>`;
    container.append(header);

    if (isLoading && !data) {
      const loading = document.createElement('div');
      loading.className = 'p-8 text-center text-muted';
      loading.textContent = t('common.loading');
      container.append(loading);
    } else if (loadError && !data) {
      const error = document.createElement('div');
      error.className = 'admin-panel p-6 text-center text-sm';
      error.textContent = loadError;
      container.append(error);
    } else if (data) {
      container.append(kpis(), topPanel(), closePanel(), settingsCard(), runsPanel(), historyPanel());
    }
    root.appendChild(container);
  }

  loadData();
}
