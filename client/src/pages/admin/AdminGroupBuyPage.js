/**
 * AdminGroupBuyPage.js — Team Purchase settings and pools (/admin/growth/group-buy, Prompt 9.5).
 *
 * 1. Settings a super admin sets: the shipping charge every team member pays, the discount for a
 *    2- and a 3-member team, and how long a team stays open. Saved through
 *    PUT /admin/growth/group-buy/settings (growth.groupbuy.govern, HIGH: a super admin's save applies
 *    at once, anyone else's goes for approval and the page says so).
 * 2. Real counts and the latest teams from GET /admin/growth/group-buy.
 * 3. "Expire overdue teams" runs the same sweep the 5-minute job runs, releasing wallet holds.
 *
 * WHY the bounds shown in the form come from the API (`limits`): the server refuses out-of-range
 * values, and the page must never offer a value it would refuse.
 */

import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { escapeHtml } from '../../services/html.js';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.js';

const STATUS_BADGE = {
  ACTIVE: 'system-table__badge--info',
  COMPLETED: 'system-table__badge--success',
  EXPIRED: 'system-table__badge--danger',
  CANCELLED: 'system-table__badge--danger',
};

export default function AdminGroupBuyPage(root) {
  loadSystemHealthStyles();
  const container = document.createElement('div');
  container.className = 'admin-page group-buy-page';

  let overview = null;
  let loadError = null;
  let isLoading = true;

  async function loadData() {
    isLoading = true;
    render();
    try {
      overview = await api.get('/admin/growth/group-buy');
      loadError = null;
    } catch (err) {
      loadError = err?.message || t('common.error_generic');
    } finally {
      isLoading = false;
      render();
    }
  }

  function settingsPanel() {
    const { settings, limits } = overview;
    const panel = document.createElement('section');
    panel.className = 'admin-panel group-buy-settings';
    panel.innerHTML = `
      <h2 class="admin-panel__title">${escapeHtml(t('admin.group_buy.settings_title'))}</h2>
      <p class="text-sm text-secondary">${escapeHtml(t('admin.group_buy.settings_desc'))}</p>
    `;

    const grid = document.createElement('div');
    grid.className = 'group-buy-settings__grid';

    const shipping = Input({
      label: t('admin.group_buy.shipping_charge'),
      hint: t('admin.group_buy.shipping_charge_hint', { min: limits.shipping_charge.min, max: limits.shipping_charge.max }),
      type: 'number',
      name: 'shipping_charge',
      prefix: '৳',
      value: String(settings.shipping_charge),
      inputmode: 'decimal',
      required: true,
    });
    shipping.input.min = String(limits.shipping_charge.min);
    shipping.input.max = String(limits.shipping_charge.max);
    shipping.input.step = '0.01';

    const pctInput = (name, label) => {
      const field = Input({
        label,
        hint: t('admin.group_buy.discount_hint', { min: limits.discount_pct.min, max: limits.discount_pct.max }),
        type: 'number',
        name,
        suffix: '%',
        value: String(settings[name]),
        inputmode: 'numeric',
        required: true,
      });
      field.input.min = String(limits.discount_pct.min);
      field.input.max = String(limits.discount_pct.max);
      field.input.step = '1';
      return field;
    };
    const discount2 = pctInput('discount_pct_2', t('admin.group_buy.discount_2'));
    const discount3 = pctInput('discount_pct_3', t('admin.group_buy.discount_3'));

    const windowHours = Input({
      label: t('admin.group_buy.window_hours'),
      hint: t('admin.group_buy.window_hours_hint', { min: limits.window_hours.min, max: limits.window_hours.max }),
      type: 'number',
      name: 'window_hours',
      suffix: t('admin.group_buy.hours_suffix'),
      value: String(settings.window_hours),
      inputmode: 'numeric',
      required: true,
    });
    windowHours.input.min = String(limits.window_hours.min);
    windowHours.input.max = String(limits.window_hours.max);
    windowHours.input.step = '1';

    grid.append(shipping, discount2, discount3, windowHours);

    const note = document.createElement('p');
    note.className = 'text-xs text-muted';
    note.textContent = t('admin.group_buy.snapshot_note');

    const save = Button({
      label: t('common.save_changes'),
      variant: 'primary',
      size: 'sm',
      onClick: async () => {
        const payload = {
          shipping_charge: Number(shipping.value),
          discount_pct_2: Number(discount2.value),
          discount_pct_3: Number(discount3.value),
          window_hours: Number(windowHours.value),
        };
        save.disabled = true;
        try {
          const res = await api.put('/admin/growth/group-buy/settings', payload);
          if (res?.deferred) {
            toast.info(t('admin.group_buy.sent_for_approval'));
          } else {
            toast.success(t('admin.group_buy.saved'));
            await loadData();
          }
        } catch (err) {
          toast.error(err?.message || t('common.error_generic'));
        } finally {
          save.disabled = false;
        }
      },
    });

    const actions = document.createElement('div');
    actions.className = 'group-buy-settings__actions';
    actions.append(note, save);

    panel.append(grid, actions);
    return panel;
  }

  function kpis() {
    const s = overview.stats;
    const grid = document.createElement('div');
    grid.className = 'admin-kpi-grid';
    const card = (label, value, hint) => `
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(label)}</div>
        <div class="admin-kpi-card__val font-mono">${escapeHtml(value)}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(hint)}</div>
      </div>`;
    grid.innerHTML = [
      card(t('admin.group_buy.kpi_total'), String(s.total_teams), t('admin.group_buy.kpi_active', { count: s.active_pools })),
      card(t('admin.group_buy.kpi_conversion'), s.conversion_rate_pct == null ? '—' : `${s.conversion_rate_pct}%`,
        t('admin.group_buy.kpi_conversion_hint', { completed: s.completed_teams, expired: s.expired_teams })),
      card(t('admin.group_buy.kpi_gmv'), formatCurrency(s.gross_team_gmv_bdt), t('admin.group_buy.kpi_gmv_hint')),
      card(t('admin.group_buy.kpi_shipping'), formatCurrency(overview.settings.shipping_charge), t('admin.group_buy.kpi_shipping_hint')),
    ].join('');
    return grid;
  }

  function teamsTable() {
    const panel = document.createElement('section');
    panel.className = 'admin-panel mt-4';
    const now = Date.now();
    const rows = overview.teams.map((tm) => {
      const hoursLeft = Math.max(0, Math.ceil((new Date(tm.expires_at).getTime() - now) / 3600000));
      const statusLabel = t(`admin.group_buy.status_${String(tm.status).toLowerCase()}`);
      return `
        <tr>
          <td><code class="font-mono font-bold text-xs">${escapeHtml(tm.team_code)}</code></td>
          <td>${escapeHtml(tm.product_title)}</td>
          <td class="text-xs text-secondary">${escapeHtml(tm.initiator_name || '—')}</td>
          <td class="font-mono">${Number(tm.joined_members)} / ${Number(tm.target_members)}</td>
          <td class="font-mono">
            <div>${formatCurrency(tm.group_price)}</div>
            <div class="text-xs text-muted">+ ${formatCurrency(tm.shipping_charge)} ${escapeHtml(t('admin.group_buy.shipping_short'))}</div>
          </td>
          <td class="text-xs font-mono">${tm.status === 'ACTIVE' ? escapeHtml(t('admin.group_buy.hours_left', { hours: hoursLeft })) : '—'}</td>
          <td><span class="system-table__badge ${STATUS_BADGE[tm.status] || ''}">${escapeHtml(statusLabel)}</span></td>
        </tr>`;
    }).join('');

    panel.innerHTML = overview.teams.length === 0
      ? `<p class="p-6 text-center text-sm text-muted">${escapeHtml(t('admin.group_buy.empty'))}</p>`
      : `<div class="system-table-wrap">
          <table class="system-table">
            <thead><tr>
              <th>${escapeHtml(t('admin.group_buy.col_team'))}</th>
              <th>${escapeHtml(t('admin.group_buy.col_product'))}</th>
              <th>${escapeHtml(t('admin.group_buy.col_initiator'))}</th>
              <th>${escapeHtml(t('admin.group_buy.col_members'))}</th>
              <th>${escapeHtml(t('admin.group_buy.col_price'))}</th>
              <th>${escapeHtml(t('admin.group_buy.col_time'))}</th>
              <th>${escapeHtml(t('admin.group_buy.col_status'))}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    return panel;
  }

  function render() {
    root.innerHTML = '';
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'admin-page-header';
    header.innerHTML = `
      <div>
        <h1 class="admin-page-title">${escapeHtml(t('admin.group_buy.title'))}</h1>
        <p class="admin-page-subtitle">${escapeHtml(t('admin.group_buy.subtitle'))}</p>
      </div>
      <div class="admin-page-actions"></div>
    `;
    const actions = header.querySelector('.admin-page-actions');
    actions.append(
      Button({ label: t('common.refresh'), variant: 'secondary', size: 'sm', onClick: () => loadData() }),
      Button({
        label: t('admin.group_buy.sweep'),
        variant: 'secondary',
        size: 'sm',
        onClick: async () => {
          try {
            const res = await api.post('/admin/growth/group-buy/sweep', {});
            if (res?.deferred) {
              toast.info(t('admin.group_buy.sent_for_approval'));
              return;
            }
            toast.success(t('admin.group_buy.sweep_done', { count: res?.expiredCount ?? 0 }));
            await loadData();
          } catch (err) {
            toast.error(err?.message || t('common.error_generic'));
          }
        },
      })
    );
    container.append(header);

    if (isLoading && !overview) {
      const loading = document.createElement('div');
      loading.className = 'p-8 text-center text-muted';
      loading.textContent = t('common.loading');
      container.append(loading);
    } else if (loadError && !overview) {
      const error = document.createElement('div');
      error.className = 'admin-panel p-6 text-center text-sm';
      error.textContent = loadError;
      container.append(error);
    } else if (overview) {
      container.append(kpis(), settingsPanel(), teamsTable());
    }

    root.appendChild(container);
  }

  loadData();
}
