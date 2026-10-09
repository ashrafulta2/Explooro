/**
 * DeliveryChargePage.js — the delivery charge a normal checkout adds per supplier parcel
 * (/admin/platform/delivery).
 *
 * It used to be ৳60 written into the code. The super admin now sets it here; the cart, Quick Buy and
 * checkout all read the same value (GET /delivery/policy, server/src/services/deliveryCharge.service.js).
 *
 * `platform.delivery.view` (LOW) opens the page; `platform.delivery.update` (CRITICAL, super admin
 * only) enables Save. Every save needs a reason and writes an audit row, listed at the bottom.
 *
 * Team purchase has its own charge at /admin/growth/group-buy, because each team keeps the charge
 * it started with. The page links there so nobody looks for it here.
 *
 * WHY the bounds come from the API (`limits`): the server refuses out-of-range values, and the page
 * must never offer one it would refuse.
 */

import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.js';
import { api } from '../../core/api.js';
import { can } from '../../services/permissions.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency, formatRelativeTime } from '../../services/format.js';
import { escapeHtml } from '../../services/html.js';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.js';

const MIN_REASON_LENGTH = 10;

export default function DeliveryChargePage(root, { navigate } = {}) {
  loadSystemHealthStyles();
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page delivery-charge-page';

  let data = null;
  let loadError = null;
  let isLoading = true;

  async function loadData() {
    isLoading = true;
    render();
    try {
      data = await api.get('/admin/platform/delivery');
      loadError = null;
    } catch (err) {
      loadError = err?.message || t('common.error_generic');
    } finally {
      isLoading = false;
      render();
    }
  }

  function chargeCard() {
    const { policy, limits } = data;
    const canUpdate = data.can_update !== false && can('platform.delivery.update');

    const panel = document.createElement('section');
    panel.className = 'admin-panel group-buy-settings';
    panel.innerHTML = `
      <h2 class="admin-panel__title">${escapeHtml(t('admin.delivery.card_title'))}</h2>
      <p class="text-sm text-secondary">${escapeHtml(t('admin.delivery.card_desc'))}</p>
    `;

    const grid = document.createElement('div');
    grid.className = 'group-buy-settings__grid';

    const charge = Input({
      label: t('admin.delivery.per_parcel'),
      hint: t('admin.delivery.per_parcel_hint', { min: limits.min, max: limits.max }),
      type: 'number',
      name: 'per_parcel_charge',
      prefix: '৳',
      value: String(policy.per_parcel_charge),
      inputmode: 'decimal',
      required: true,
    });
    charge.input.min = String(limits.min);
    charge.input.max = String(limits.max);
    charge.input.step = '0.01';
    charge.input.disabled = !canUpdate;

    const reason = Input({
      label: t('admin.delivery.reason'),
      hint: t('admin.delivery.reason_hint', { min: MIN_REASON_LENGTH }),
      type: 'text',
      name: 'reason',
      maxLength: 500,
      required: true,
    });
    reason.input.disabled = !canUpdate;

    grid.append(charge, reason);

    const example = document.createElement('p');
    example.className = 'text-xs text-muted';
    const renderExample = () => {
      const n = Number(charge.value);
      example.textContent = Number.isFinite(n)
        ? t('admin.delivery.example', { one: formatCurrency(n), two: formatCurrency(n * 2) })
        : '';
    };
    charge.input.addEventListener('input', renderExample);
    renderExample();

    const save = Button({
      label: t('common.save_changes'),
      variant: 'primary',
      size: 'sm',
      disabled: !canUpdate,
      onClick: async () => {
        const value = Number(charge.value);
        if (!Number.isFinite(value) || value < limits.min || value > limits.max) {
          toast.error(t('admin.delivery.per_parcel_hint', { min: limits.min, max: limits.max }));
          charge.input.focus();
          return;
        }
        if (reason.value.trim().length < MIN_REASON_LENGTH) {
          toast.error(t('admin.delivery.reason_hint', { min: MIN_REASON_LENGTH }));
          reason.input.focus();
          return;
        }
        save.disabled = true;
        try {
          const res = await api.put('/admin/platform/delivery', {
            per_parcel_charge: value,
            reason: reason.value.trim(),
          });
          toast.success((isBn ? res?.message_bn : res?.message_en) || t('admin.delivery.saved'));
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

    if (!canUpdate) {
      const note = document.createElement('p');
      note.className = 'text-xs text-muted mt-2';
      note.textContent = t('admin.delivery.super_admin_only');
      panel.append(note);
    }

    const teamNote = document.createElement('p');
    teamNote.className = 'text-xs text-secondary mt-2';
    const link = document.createElement('a');
    link.href = '/admin/growth/group-buy';
    link.textContent = t('admin.delivery.team_link');
    teamNote.append(`${t('admin.delivery.team_note')} `, link);
    panel.append(teamNote);

    return panel;
  }

  function kpis() {
    const { policy } = data;
    const grid = document.createElement('div');
    grid.className = 'admin-kpi-grid';
    const updated = policy.updated_at
      ? formatRelativeTime(new Date(policy.updated_at).getTime(), { lang: isBn ? 'bn' : 'en' })
      : t('admin.delivery.never_changed');
    grid.innerHTML = `
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(t('admin.delivery.kpi_current'))}</div>
        <div class="admin-kpi-card__val font-mono">${escapeHtml(formatCurrency(policy.per_parcel_charge))}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(t('admin.delivery.kpi_current_hint'))}</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(t('admin.delivery.kpi_updated'))}</div>
        <div class="admin-kpi-card__val">${escapeHtml(updated)}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(t('admin.delivery.kpi_updated_hint'))}</div>
      </div>`;
    return grid;
  }

  function historyPanel() {
    const panel = document.createElement('section');
    panel.className = 'admin-panel mt-4';
    const rows = (data.history || []).map((row) => {
      const before = row.before_json?.per_parcel_charge;
      const after = row.after_json?.per_parcel_charge;
      const reason = row.meta_json?.reason || row.meta?.reason || row.after_json?.meta?.reason || '';
      const when = row.created_at
        ? formatRelativeTime(new Date(row.created_at).getTime(), { lang: isBn ? 'bn' : 'en' })
        : '—';
      return `
        <tr>
          <td class="text-xs">${escapeHtml(when)}</td>
          <td class="text-xs font-mono">${escapeHtml(row.actor_ref || row.actor_id || '—')}</td>
          <td class="font-mono">${before == null ? '—' : escapeHtml(formatCurrency(before))} → <strong>${after == null ? '—' : escapeHtml(formatCurrency(after))}</strong></td>
          <td class="text-xs text-secondary">${escapeHtml(reason)}</td>
        </tr>`;
    }).join('');

    panel.innerHTML = `<h2 class="admin-panel__title">${escapeHtml(t('admin.delivery.history_title'))}</h2>` + (rows
      ? `<div class="system-table-wrap">
          <table class="system-table">
            <thead><tr>
              <th>${escapeHtml(t('admin.delivery.col_when'))}</th>
              <th>${escapeHtml(t('admin.delivery.col_who'))}</th>
              <th>${escapeHtml(t('admin.delivery.col_change'))}</th>
              <th>${escapeHtml(t('admin.delivery.col_reason'))}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
      : `<p class="p-6 text-center text-sm text-muted">${escapeHtml(t('admin.delivery.history_empty'))}</p>`);
    return panel;
  }

  function render() {
    root.innerHTML = '';
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'admin-page-header';
    header.innerHTML = `
      <div>
        <h1 class="admin-page-title">${escapeHtml(t('admin.delivery.title'))}</h1>
        <p class="admin-page-subtitle">${escapeHtml(t('admin.delivery.subtitle'))}</p>
      </div>
    `;
    container.append(header, PlatformSubnav({ activeKey: 'delivery', navigate }));

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
      container.append(kpis(), chargeCard(), historyPanel());
    }

    root.appendChild(container);
  }

  loadData();
}
