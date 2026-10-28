/**
 * AdminAttributionPage.js — how long a storefront visit or link click credits a Shop Partner with the
 * sale (/admin/growth/attribution).
 *
 * The shopper's last touch (a partner's storefront or tracked short link) travels with every
 * add-to-cart; server/src/services/attribution.service.ts honours it only while it is younger than
 * this window. A longer window credits more sales to partners, so the partner share of those orders
 * moves from the platform to them.
 *
 * `growth.attribution.view` (LOW) opens the page; `growth.attribution.update` (CRITICAL, super
 * admin only) enables Save. Every save needs a reason and writes an audit row, listed at the bottom.
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

const MIN_REASON_LENGTH = 10;

export default function AdminAttributionPage(root) {
  loadSystemHealthStyles();
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page attribution-page';

  let data = null;
  let loadError = null;
  let isLoading = true;

  async function loadData() {
    isLoading = true;
    render();
    try {
      data = await api.get('/admin/growth/attribution');
      loadError = null;
    } catch (err) {
      loadError = err?.message || t('common.error_generic');
    } finally {
      isLoading = false;
      render();
    }
  }

  const relative = (iso) => formatRelativeTime(new Date(iso).getTime(), { lang: isBn ? 'bn' : 'en' });

  function kpis() {
    const { policy, stats } = data;
    const card = (label, value, hint) => `
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(label)}</div>
        <div class="admin-kpi-card__val font-mono">${escapeHtml(value)}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(hint)}</div>
      </div>`;
    const parcels = (s) => t('admin.attribution.kpi_parcels', {
      count: formatNumber(s?.parcels ?? 0),
      amount: formatCurrency(Number(s?.commission ?? 0)),
    });
    const grid = document.createElement('div');
    grid.className = 'admin-kpi-grid';
    grid.innerHTML =
      card(t('admin.attribution.kpi_window'), t('admin.attribution.days', { n: formatNumber(policy.window_days) }),
        policy.updated_at ? t('admin.attribution.kpi_window_changed', { when: relative(policy.updated_at) }) : t('admin.attribution.never_changed')) +
      card(t('admin.attribution.kpi_storefront'), formatNumber(stats?.storefront?.parcels ?? 0), parcels(stats?.storefront)) +
      card(t('admin.attribution.kpi_short_link'), formatNumber(stats?.short_link?.parcels ?? 0), parcels(stats?.short_link)) +
      card(t('admin.attribution.kpi_unattributed'), formatNumber(stats?.unattributed?.parcels ?? 0), t('admin.attribution.kpi_unattributed_hint'));
    return grid;
  }

  function settingsCard() {
    const { policy, limits } = data;
    const canUpdate = data.can_update !== false && can('growth.attribution.update');

    const panel = document.createElement('section');
    panel.className = 'admin-panel group-buy-settings mt-4';
    panel.innerHTML = `
      <h2 class="admin-panel__title">${escapeHtml(t('admin.attribution.card_title'))}</h2>
      <p class="text-sm text-secondary">${escapeHtml(t('admin.attribution.card_desc'))}</p>
    `;

    const grid = document.createElement('div');
    grid.className = 'group-buy-settings__grid';

    const days = Input({
      label: t('admin.attribution.window_label'),
      hint: t('admin.attribution.window_hint', { min: limits.min, max: limits.max }),
      type: 'number',
      name: 'window_days',
      value: String(policy.window_days),
      inputmode: 'numeric',
      required: true,
    });
    days.input.min = String(limits.min);
    days.input.max = String(limits.max);
    days.input.step = '1';
    days.input.disabled = !canUpdate;

    const reason = Input({
      label: t('admin.attribution.reason'),
      hint: t('admin.attribution.reason_hint', { min: MIN_REASON_LENGTH }),
      type: 'text',
      name: 'reason',
      maxLength: 500,
      required: true,
    });
    reason.input.disabled = !canUpdate;
    grid.append(days, reason);

    const example = document.createElement('p');
    example.className = 'text-xs text-muted';
    const renderExample = () => {
      const n = Number(days.value);
      example.textContent = Number.isInteger(n) && n >= limits.min && n <= limits.max
        ? t('admin.attribution.example', { n: formatNumber(n) })
        : '';
    };
    days.input.addEventListener('input', renderExample);
    renderExample();

    const save = Button({
      label: t('common.save_changes'),
      variant: 'primary',
      size: 'sm',
      disabled: !canUpdate,
      onClick: async () => {
        const value = Number(days.value);
        if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
          toast.error(t('admin.attribution.window_hint', { min: limits.min, max: limits.max }));
          days.input.focus();
          return;
        }
        if (reason.value.trim().length < MIN_REASON_LENGTH) {
          toast.error(t('admin.attribution.reason_hint', { min: MIN_REASON_LENGTH }));
          reason.input.focus();
          return;
        }
        save.disabled = true;
        try {
          const res = await api.put('/admin/growth/attribution', { window_days: value, reason: reason.value.trim() });
          toast.success((isBn ? res?.message_bn : res?.message_en) || t('admin.attribution.saved'));
          await loadData();
        } catch (err) {
          toast.error(err?.message || t('common.error_generic'));
        } finally {
          save.disabled = false;
        }
      },
    });

    const actions = document.createElement('div');
    actions.className = 'group-buy-settings__actions';
    actions.append(example, save);
    panel.append(grid, actions);

    const rules = document.createElement('ul');
    rules.className = 'text-xs text-secondary mt-2';
    for (const key of ['rule_sells', 'rule_self', 'rule_last']) {
      const li = document.createElement('li');
      li.textContent = t(`admin.attribution.${key}`);
      rules.append(li);
    }
    panel.append(rules);

    if (!canUpdate) {
      const note = document.createElement('p');
      note.className = 'text-xs text-muted mt-2';
      note.textContent = t('admin.attribution.super_admin_only');
      panel.append(note);
    }
    return panel;
  }

  function historyPanel() {
    const panel = document.createElement('section');
    panel.className = 'admin-panel mt-4';
    const rows = (data.history || []).map((row) => {
      const before = row.before_json?.window_days;
      const after = row.after_json?.window_days;
      const reason = row.meta_json?.reason || row.meta?.reason || '';
      return `
        <tr>
          <td class="text-xs">${escapeHtml(row.created_at ? relative(row.created_at) : '—')}</td>
          <td class="text-xs font-mono">${escapeHtml(row.actor_ref || row.actor_id || '—')}</td>
          <td class="font-mono">${before == null ? '—' : escapeHtml(formatNumber(before))} → <strong>${after == null ? '—' : escapeHtml(formatNumber(after))}</strong></td>
          <td class="text-xs text-secondary">${escapeHtml(reason)}</td>
        </tr>`;
    }).join('');

    panel.innerHTML = `<h2 class="admin-panel__title">${escapeHtml(t('admin.attribution.history_title'))}</h2>` + (rows
      ? `<div class="system-table-wrap">
          <table class="system-table">
            <thead><tr>
              <th>${escapeHtml(t('admin.attribution.col_when'))}</th>
              <th>${escapeHtml(t('admin.attribution.col_who'))}</th>
              <th>${escapeHtml(t('admin.attribution.col_change'))}</th>
              <th>${escapeHtml(t('admin.attribution.col_reason'))}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
      : `<p class="p-6 text-center text-sm text-muted">${escapeHtml(t('admin.attribution.history_empty'))}</p>`);
    return panel;
  }

  function render() {
    root.innerHTML = '';
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'admin-page-header';
    header.innerHTML = `
      <div>
        <h1 class="admin-page-title">${escapeHtml(t('admin.attribution.title'))}</h1>
        <p class="admin-page-subtitle">${escapeHtml(t('admin.attribution.subtitle'))}</p>
      </div>
    `;
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
      container.append(kpis(), settingsCard(), historyPanel());
    }

    root.appendChild(container);
  }

  loadData();
}
