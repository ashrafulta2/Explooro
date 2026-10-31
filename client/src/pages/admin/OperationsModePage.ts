/**
 * OperationsModePage.ts — run payouts and parcels by hand or automatically (/admin/platform/operations).
 *
 * At launch no MFS merchant, card gateway or courier API signs with a new platform, so the owner
 * sends withdrawals from their own bKash/Nagad and hands parcels to a contracted courier. Two
 * switches say which (server/src/services/manualOperations.service.ts, migration 097):
 *   payout_mode  MANUAL  → the payout queue offers "Mark as paid" with a TrxID; GATEWAY → Approve
 *                          sends through the bKash B2C gateway.
 *   courier_mode MANUAL  → the supplier records "Sent by hand" with the courier's tracking number and
 *                          marks the parcel delivered; INTEGRATED → 1-click courier booking + webhooks.
 *
 * `platform.operations.view` (LOW) opens the page; `platform.operations.update` (CRITICAL, super
 * admin only) enables Save. Every save needs a reason and writes an audit row, listed at the bottom.
 * WHY the options come from the API: the server refuses any other value, and the page must never
 * offer one it would refuse.
 */

import { Button } from '../../components/ui/Button.ts';
import { Input } from '../../components/ui/Input.ts';
import { Select } from '../../components/ui/Select.ts';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.ts';
import { api } from '../../core/api.ts';
import { can } from '../../services/permissions.ts';
import { toast } from '../../services/toast.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { formatRelativeTime } from '../../services/format.ts';
import { escapeHtml } from '../../services/html.ts';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.ts';
import type { PageContext } from '../types.ts';

const MIN_REASON_LENGTH = 10;

/** `admin.operations.mode.<value>` for a mode value the API sent. */
const modeLabel = (value) => t(`admin.operations.mode.${String(value).toLowerCase()}`);

export default function OperationsModePage(root: HTMLElement, { navigate }: PageContext = {}) {
  loadSystemHealthStyles();
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page operations-mode-page';

  let data = null;
  let loadError = null;
  let isLoading = true;

  async function loadData() {
    isLoading = true;
    render();
    try {
      data = await api.get('/admin/platform/operations');
      loadError = null;
    } catch (err) {
      loadError = err?.message || t('common.error_generic');
    } finally {
      isLoading = false;
      render();
    }
  }

  function modesCard() {
    const { modes, options } = data;
    const canUpdate = data.can_update !== false && can('platform.operations.update');

    const panel = document.createElement('section');
    panel.className = 'admin-panel group-buy-settings';
    panel.innerHTML = `
      <h2 class="admin-panel__title">${escapeHtml(t('admin.operations.card_title'))}</h2>
      <p data-page-info class="text-sm text-secondary">${escapeHtml(t('admin.operations.card_desc'))}</p>
    `;

    const grid = document.createElement('div');
    grid.className = 'group-buy-settings__grid';

    const payout = Select({
      label: t('admin.operations.payout_label'),
      hint: t('admin.operations.payout_hint'),
      name: 'payout_mode',
      options: options.payout_mode.map((value) => ({ value, label: modeLabel(value) })),
      value: modes.payout_mode,
      disabled: !canUpdate,
      required: true,
    });
    const courier = Select({
      label: t('admin.operations.courier_label'),
      hint: t('admin.operations.courier_hint'),
      name: 'courier_mode',
      options: options.courier_mode.map((value) => ({ value, label: modeLabel(value) })),
      value: modes.courier_mode,
      disabled: !canUpdate,
      required: true,
    });
    const reason = Input({
      label: t('admin.operations.reason'),
      hint: t('admin.operations.reason_hint', { min: MIN_REASON_LENGTH }),
      type: 'text',
      name: 'reason',
      maxLength: 500,
      required: true,
    });
    reason.input.disabled = !canUpdate;

    grid.append(payout, courier, reason);

    const save = Button({
      label: t('common.save_changes'),
      variant: 'primary',
      size: 'sm',
      disabled: !canUpdate,
      onClick: async () => {
        if (reason.value.trim().length < MIN_REASON_LENGTH) {
          toast.error(t('admin.operations.reason_hint', { min: MIN_REASON_LENGTH }));
          reason.input.focus();
          return;
        }
        save.disabled = true;
        try {
          const res = await api.put('/admin/platform/operations', {
            payout_mode: payout.value,
            courier_mode: courier.value,
            reason: reason.value.trim(),
          });
          toast.success((isBn ? res?.message_bn : res?.message_en) || t('admin.operations.saved'));
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
    actions.append(save);
    panel.append(grid, actions);

    if (!canUpdate) {
      const note = document.createElement('p');
      note.className = 'text-xs text-muted mt-2';
      note.textContent = t('admin.operations.super_admin_only');
      panel.append(note);
    }
    return panel;
  }

  function kpis() {
    const { modes } = data;
    const grid = document.createElement('div');
    grid.className = 'admin-kpi-grid';
    const updated = modes.updated_at
      ? formatRelativeTime(new Date(modes.updated_at).getTime(), { lang: isBn ? 'bn' : 'en' })
      : t('admin.operations.never_changed');
    grid.innerHTML = `
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(t('admin.operations.payout_label'))}</div>
        <div class="admin-kpi-card__val">${escapeHtml(modeLabel(modes.payout_mode))}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(t(`admin.operations.effect.payout_${modes.payout_mode.toLowerCase()}`))}</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(t('admin.operations.courier_label'))}</div>
        <div class="admin-kpi-card__val">${escapeHtml(modeLabel(modes.courier_mode))}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(t(`admin.operations.effect.courier_${modes.courier_mode.toLowerCase()}`))}</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(t('admin.operations.kpi_updated'))}</div>
        <div class="admin-kpi-card__val">${escapeHtml(updated)}</div>
      </div>`;
    return grid;
  }

  function historyPanel() {
    const panel = document.createElement('section');
    panel.className = 'admin-panel mt-4';
    const describe = (json) => (json
      ? `${modeLabel(json.payout_mode)} / ${modeLabel(json.courier_mode)}`
      : '—');
    const rows = (data.history || []).map((row) => {
      const reason = row.meta_json?.reason || row.meta?.reason || row.after_json?.meta?.reason || '';
      const when = row.created_at
        ? formatRelativeTime(new Date(row.created_at).getTime(), { lang: isBn ? 'bn' : 'en' })
        : '—';
      return `
        <tr>
          <td class="text-xs">${escapeHtml(when)}</td>
          <td class="text-xs font-mono">${escapeHtml(row.actor_ref || row.actor_id || '—')}</td>
          <td>${escapeHtml(describe(row.before_json))} → <strong>${escapeHtml(describe(row.after_json))}</strong></td>
          <td class="text-xs text-secondary">${escapeHtml(reason)}</td>
        </tr>`;
    }).join('');

    panel.innerHTML = `<h2 class="admin-panel__title">${escapeHtml(t('admin.operations.history_title'))}</h2>` + (rows
      ? `<div class="system-table-wrap">
          <table class="system-table">
            <thead><tr>
              <th>${escapeHtml(t('admin.operations.col_when'))}</th>
              <th>${escapeHtml(t('admin.operations.col_who'))}</th>
              <th>${escapeHtml(t('admin.operations.col_change'))}</th>
              <th>${escapeHtml(t('admin.operations.col_reason'))}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
      : `<p class="p-6 text-center text-sm text-muted">${escapeHtml(t('admin.operations.history_empty'))}</p>`);
    return panel;
  }

  function render() {
    root.innerHTML = '';
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'admin-page-header';
    header.innerHTML = `
      <div>
        <h1 class="admin-page-title">${escapeHtml(t('admin.operations.title'))}</h1>
        <p class="admin-page-subtitle">${escapeHtml(t('admin.operations.subtitle'))}</p>
      </div>
    `;
    container.append(header, PlatformSubnav({ activeKey: 'operations', navigate }));

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
      container.append(kpis(), modesCard(), historyPanel());
    }

    root.appendChild(container);
  }

  loadData();
}
