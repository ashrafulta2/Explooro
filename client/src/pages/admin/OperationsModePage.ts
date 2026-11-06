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
 * The returns address card (migration 105) says where a courier takes returned products when
 * couriers are automatic; it is saved on its own, with its own reason.
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
import { formatRelativeTime, formatCurrency } from '../../services/format.ts';
import { Modal } from '../../components/ui/Modal.ts';
import { escapeHtml } from '../../services/html.ts';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.ts';
import { getDivisions, getDistrictsByDivision } from '../../data/bangladeshGeo.ts';
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
  // Courier pickup charges vs what couriers quote and bill (migration 107). Loaded on its own so
  // the rest of the page works if it fails. WHY these periods: a report window, not a business rule.
  const PICKUP_PERIODS = [30, 90, 365];
  let pickupDays = PICKUP_PERIODS[0];
  let pickupCharges = null;

  async function loadPickupCharges() {
    try {
      pickupCharges = await api.get(`/admin/platform/operations/pickup-charges?days=${pickupDays}`);
    } catch {
      pickupCharges = null;
    }
    render();
  }

  async function loadData() {
    isLoading = true;
    render();
    try {
      data = await api.get('/admin/platform/operations');
      loadError = null;
      loadPickupCharges();
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

  /**
   * Where a courier takes returned products once couriers are INTEGRATED (migration 105). It ships
   * empty, and the server refuses to book a return pickup until it is filled; the warning says so
   * while the courier mode is automatic. Division and district are the checkout form's ids, which
   * the server checks against its own copy (server/src/config/bdDistricts.ts).
   */
  function returnAddressCard() {
    const address = data.return_address || {};
    const missing = data.return_address_missing || [];
    const canUpdate = data.can_update !== false && can('platform.operations.update');
    const nameOf = (item) => (isBn ? item.name_bn : item.name_en);

    const panel = document.createElement('section');
    panel.className = 'admin-panel group-buy-settings mt-4';
    panel.innerHTML = `
      <h2 class="admin-panel__title">${escapeHtml(t('admin.operations.return_address.title'))}</h2>
      <p data-page-info class="text-sm text-secondary">${escapeHtml(t('admin.operations.return_address.desc'))}</p>
    `;
    if (missing.length > 0) {
      const warn = document.createElement('p');
      warn.className = 'text-sm mt-2';
      warn.setAttribute('role', 'status');
      warn.dataset.returnAddressMissing = '';
      warn.textContent = data.modes?.courier_mode === 'INTEGRATED'
        ? t('admin.operations.return_address.missing_integrated')
        : t('admin.operations.return_address.missing_manual');
      panel.append(warn);
    }

    const grid = document.createElement('div');
    grid.className = 'group-buy-settings__grid';

    const text = (name, label, value, maxLength, required = true) => {
      const field = Input({ label, type: name === 'phone' ? 'tel' : 'text', name, value: value || '', maxLength, required });
      field.input.disabled = !canUpdate;
      return field;
    };
    const name = text('name', t('admin.operations.return_address.name'), address.name, 80);
    const phone = text('phone', t('admin.operations.return_address.phone'), address.phone, 20);
    const division = Select({
      label: t('admin.operations.return_address.division'),
      name: 'division',
      placeholder: t('admin.operations.return_address.choose'),
      options: getDivisions().map((d) => ({ value: d.id, label: nameOf(d) })),
      value: address.division || '',
      disabled: !canUpdate,
      required: true,
    });
    const district = Select({
      label: t('admin.operations.return_address.district'),
      name: 'district',
      placeholder: t('admin.operations.return_address.choose'),
      options: getDistrictsByDivision(address.division).map((d) => ({ value: d.id, label: nameOf(d) })),
      value: address.district || '',
      disabled: !canUpdate,
      required: true,
    });
    // A district belongs to one division, so a new division resets the district list.
    division.input.addEventListener('change', () => {
      const select = district.input;
      select.querySelectorAll('option:not([value=""])').forEach((o) => o.remove());
      for (const d of getDistrictsByDivision(division.value)) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = nameOf(d);
        select.append(opt);
      }
      select.value = '';
    });
    const upazila = text('upazila', t('admin.operations.return_address.upazila'), address.upazila, 60, false);
    const line = text('address_line', t('admin.operations.return_address.address_line'), address.address_line, 200);
    const reason = text('reason', t('admin.operations.reason'), '', 500);

    grid.append(name, phone, division, district, upazila, line, reason);

    const save = Button({
      label: t('admin.operations.return_address.save'),
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
          const res = await api.put('/admin/platform/operations/return-address', {
            name: name.value.trim(),
            phone: phone.value.trim(),
            division: division.value,
            district: district.value,
            upazila: upazila.value.trim(),
            address_line: line.value.trim(),
            reason: reason.value.trim(),
            // WHY: the server refuses a save made on top of someone else's newer one.
            base_updated_at: address.updated_at ?? null,
          });
          toast.success((isBn ? res?.message_bn : res?.message_en) || t('admin.operations.return_address.saved'));
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
    return panel;
  }

  /**
   * Who pays to send a return back (migration 106, server/src/services/returnShipping.service.ts).
   * The supplier pays for the reasons ticked; every other reason is the customer's choice. The
   * reasons and the bounds come from the API, so the form never offers a value the server refuses.
   */
  function returnShippingCard() {
    const policy = data.return_shipping;
    const options = data.return_shipping_options;
    if (!policy || !options) return document.createDocumentFragment();
    const canUpdate = data.can_update !== false && can('platform.operations.update');

    const panel = document.createElement('section');
    panel.className = 'admin-panel group-buy-settings mt-4';
    panel.innerHTML = `
      <h2 class="admin-panel__title">${escapeHtml(t('admin.operations.return_shipping.title'))}</h2>
      <p data-page-info class="text-sm text-secondary">${escapeHtml(t('admin.operations.return_shipping.desc'))}</p>
    `;

    const reasons = document.createElement('fieldset');
    reasons.className = 'return-shipping-reasons mt-3';
    reasons.innerHTML = `
      <legend class="text-sm font-semibold">${escapeHtml(t('admin.operations.return_shipping.reasons_label'))}</legend>
      <p class="text-xs text-secondary">${escapeHtml(t('admin.operations.return_shipping.reasons_hint'))}</p>`;
    const boxes = options.reasons.map((code) => {
      const label = document.createElement('label');
      label.className = 'flex items-center gap-2 text-sm mt-1';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = code;
      box.checked = policy.supplier_fault_reasons.includes(code);
      box.disabled = !canUpdate;
      label.append(box, document.createTextNode(t(`returns.reasons.${code.toLowerCase()}`)));
      reasons.append(label);
      return box;
    });

    const grid = document.createElement('div');
    grid.className = 'group-buy-settings__grid mt-3';
    const money = (name, label, hint, value) => {
      const field = Input({ label, hint, type: 'number', name, value: String(value) });
      field.input.min = String(options.limits[name].min);
      field.input.max = String(options.limits[name].max);
      field.input.step = '1';
      field.input.disabled = !canUpdate;
      return field;
    };
    const max = money('max_courier_refund', t('admin.operations.return_shipping.max_label'), t('admin.operations.return_shipping.max_hint'), policy.max_courier_refund);
    const fee = money('pickup_fee', t('admin.operations.return_shipping.fee_label'), t('admin.operations.return_shipping.fee_hint'), policy.pickup_fee);
    const reason = Input({ label: t('admin.operations.reason'), hint: t('admin.operations.reason_hint', { min: MIN_REASON_LENGTH }), type: 'text', name: 'reason', maxLength: 500, required: true });
    reason.input.disabled = !canUpdate;
    grid.append(max, fee, reason);

    const save = Button({
      label: t('admin.operations.return_shipping.save'),
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
          const res = await api.put('/admin/platform/operations/return-shipping', {
            supplier_fault_reasons: boxes.filter((b) => b.checked).map((b) => b.value),
            max_courier_refund: Number(max.value),
            pickup_fee: Number(fee.value),
            reason: reason.value.trim(),
            base_updated_at: policy.updated_at ?? null,
          });
          toast.success((isBn ? res?.message_bn : res?.message_en) || t('admin.operations.return_shipping.saved'));
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
    panel.append(reasons, grid, actions);
    return panel;
  }

  /** Records what a courier's bill said for one pickup, with a reason (CRITICAL, audited). */
  function openBillDialog(row) {
    const amount = Input({ label: t('admin.operations.pickup_charges.bill_label'), hint: t('admin.operations.pickup_charges.bill_hint'), type: 'number', name: 'amount', value: row.courier_billed ?? row.courier_charge ?? '' });
    amount.input.min = '0';
    amount.input.step = '0.01';
    const reason = Input({ label: t('admin.operations.reason'), hint: t('admin.operations.reason_hint', { min: MIN_REASON_LENGTH }), type: 'text', name: 'reason', maxLength: 500, required: true });
    const body = document.createElement('div');
    body.className = 'flex flex-col gap-3';
    body.append(amount, reason);
    const footer = document.createElement('div');
    footer.className = 'flex justify-end gap-2';
    const save = Button({
      label: t('admin.operations.pickup_charges.bill_save'),
      variant: 'primary',
      onClick: async () => {
        if (reason.value.trim().length < MIN_REASON_LENGTH) {
          toast.error(t('admin.operations.reason_hint', { min: MIN_REASON_LENGTH }));
          reason.input.focus();
          return;
        }
        save.disabled = true;
        try {
          const res = await api.put(`/admin/platform/operations/pickup-charges/${row.id}/bill`, { amount: Number(amount.value), reason: reason.value.trim() });
          toast.success((isBn ? res?.message_bn : res?.message_en) || t('admin.operations.pickup_charges.bill_saved'));
          modal.closeModal(true);
          loadPickupCharges();
        } catch (err) {
          toast.error(err?.message || t('common.error_generic'));
        } finally {
          save.disabled = false;
        }
      },
    });
    footer.append(Button({ label: t('common.cancel'), variant: 'ghost', onClick: () => modal.closeModal(false) }), save);
    const modal = Modal({ title: t('admin.operations.pickup_charges.bill_title', { ref: row.return_ref || row.claim_ref || row.ref }), content: body, footer, size: 'sm' });
    modal.open();
  }

  /**
   * What courier pickups collected (from the supplier or the customer, returnShipping.service)
   * against what the courier quoted at booking and, once staff record it, what its bill said.
   * A negative gap means the pickup charge no longer covers what couriers charge.
   */
  function pickupChargesCard() {
    const panel = document.createElement('section');
    panel.className = 'admin-panel mt-4';
    panel.dataset.pickupCharges = '';
    const canUpdate = data.can_update !== false && can('platform.operations.update');
    const r = pickupCharges;
    const money = (v) => (v === null || v === undefined ? '—' : formatCurrency(Number(v)));
    const head = `
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <h2 class="admin-panel__title">${escapeHtml(t('admin.operations.pickup_charges.title'))}</h2>
      </div>
      <p class="text-sm text-secondary">${escapeHtml(t('admin.operations.pickup_charges.desc'))}</p>`;
    panel.innerHTML = head;

    const period = Select({
      label: t('admin.operations.pickup_charges.period'),
      name: 'pickup_days',
      options: PICKUP_PERIODS.map((d) => ({ value: d, label: t('admin.operations.pickup_charges.days', { days: d }) })),
      value: pickupDays,
      onChange: () => {
        pickupDays = Number(period.value);
        loadPickupCharges();
      },
    });
    panel.append(period);

    if (!r) {
      const empty = document.createElement('p');
      empty.className = 'p-6 text-center text-sm text-muted';
      empty.textContent = t('common.loading');
      panel.append(empty);
      return panel;
    }

    const gap = Number(r.totals.gap);
    const kpi = document.createElement('div');
    kpi.className = 'admin-kpi-grid mt-3';
    kpi.innerHTML = `
      <div class="admin-kpi-card"><div class="admin-kpi-card__label">${escapeHtml(t('admin.operations.pickup_charges.kpi_pickups'))}</div><div class="admin-kpi-card__val">${escapeHtml(String(r.totals.pickups))}</div><div class="admin-kpi-card__hint">${escapeHtml(t('admin.operations.pickup_charges.kpi_unbilled', { count: r.totals.unbilled }))}</div></div>
      <div class="admin-kpi-card"><div class="admin-kpi-card__label">${escapeHtml(t('admin.operations.pickup_charges.kpi_collected'))}</div><div class="admin-kpi-card__val">${escapeHtml(money(r.totals.collected))}</div></div>
      <div class="admin-kpi-card"><div class="admin-kpi-card__label">${escapeHtml(t('admin.operations.pickup_charges.kpi_cost'))}</div><div class="admin-kpi-card__val">${escapeHtml(money(r.totals.cost))}</div></div>
      <div class="admin-kpi-card" data-pickup-gap="${gap < 0 ? 'short' : 'ok'}"><div class="admin-kpi-card__label">${escapeHtml(t('admin.operations.pickup_charges.kpi_gap'))}</div><div class="admin-kpi-card__val">${escapeHtml(money(r.totals.gap))}</div><div class="admin-kpi-card__hint">${escapeHtml(t(gap < 0 ? 'admin.operations.pickup_charges.gap_short' : 'admin.operations.pickup_charges.gap_ok'))}</div></div>`;
    panel.append(kpi);

    if (r.pickups.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'p-6 text-center text-sm text-muted';
      empty.textContent = t('admin.operations.pickup_charges.empty');
      panel.append(empty);
      return panel;
    }

    const wrap = document.createElement('div');
    wrap.className = 'system-table-wrap mt-3';
    const from = (v) => (v ? t(`admin.operations.pickup_charges.from_${String(v).toLowerCase()}`) : '—');
    wrap.innerHTML = `
      <table class="system-table">
        <thead><tr>
          <th>${escapeHtml(t('admin.operations.pickup_charges.col_pickup'))}</th>
          <th>${escapeHtml(t('admin.operations.pickup_charges.col_collected'))}</th>
          <th>${escapeHtml(t('admin.operations.pickup_charges.col_quote'))}</th>
          <th>${escapeHtml(t('admin.operations.pickup_charges.col_bill'))}</th>
          <th>${escapeHtml(t('admin.operations.pickup_charges.col_gap'))}</th>
          <th></th>
        </tr></thead>
        <tbody>${r.pickups.map((p) => `
          <tr>
            <td class="text-xs"><strong class="font-mono">${escapeHtml(p.return_ref || p.claim_ref || p.ref)}</strong><br>${escapeHtml(p.carrier)} · <span class="font-mono">${escapeHtml(p.tracking_number || '')}</span></td>
            <td>${escapeHtml(money(p.fee_charged))}<br><span class="text-xs text-secondary">${escapeHtml(from(p.fee_charged_from))}</span></td>
            <td>${escapeHtml(money(p.courier_charge))}</td>
            <td>${escapeHtml(money(p.courier_billed))}</td>
            <td>${escapeHtml(money(p.gap))}</td>
            <td>${canUpdate ? `<button type="button" class="btn btn--ghost btn--sm" data-record-bill="${escapeHtml(String(p.id))}">${escapeHtml(t('admin.operations.pickup_charges.record_bill'))}</button>` : ''}</td>
          </tr>`).join('')}</tbody>
      </table>`;
    wrap.querySelectorAll<HTMLElement>('[data-record-bill]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = r.pickups.find((p) => String(p.id) === btn.dataset.recordBill);
        if (row) openBillDialog(row);
      });
    });
    panel.append(wrap);
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
      container.append(kpis(), modesCard(), returnAddressCard(), returnShippingCard(), pickupChargesCard(), historyPanel());
    }

    root.appendChild(container);
  }

  loadData();
}
