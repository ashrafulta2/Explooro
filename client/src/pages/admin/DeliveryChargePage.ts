/**
 * DeliveryChargePage.ts — the delivery charge a normal checkout adds per supplier parcel, by delivery
 * zone (/admin/platform/delivery).
 *
 * One number could not price Bangladesh: couriers charge one rate inside Dhaka and another outside.
 * The super admin keeps a list of ZONES here — each with a name, a per-parcel charge and the districts
 * it covers — and marks one as the default for every district no zone lists. Checkout, Quick Buy and
 * the live-stream drawer charge the zone of the district the shopper picks; the cart estimates with the
 * default zone (server/src/services/deliveryCharge.service.ts is the one resolver).
 *
 * `platform.delivery.view` (LOW) opens the page; `platform.delivery.update` (CRITICAL, super admin
 * only) enables Save. Every save needs a reason, is stale-checked, and writes an audit row (listed at
 * the bottom).
 *
 * Team purchase has its own charge at /admin/growth/group-buy, because each team keeps the charge
 * it started with. The page links there so nobody looks for it here.
 *
 * WHY the bounds and the district list come from the API (`limits`, `districts_by_division`): the
 * server refuses anything else, and the page must never offer a value it would refuse.
 */

import { Button } from '../../components/ui/Button.ts';
import { Input } from '../../components/ui/Input.ts';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.ts';
import { api } from '../../core/api.ts';
import { can } from '../../services/permissions.ts';
import { toast } from '../../services/toast.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { formatCurrency, formatRelativeTime } from '../../services/format.ts';
import { escapeHtml } from '../../services/html.ts';
import { resolveZone, zoneName } from '../../services/deliveryZones.ts';
import type { DeliveryPolicy, DeliveryZone } from '../../services/deliveryZones.ts';
import { BANGLADESH_DIVISIONS } from '../../data/bangladeshGeo.ts';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.ts';
import '../../styles/components/delivery-zones.css';
import type { PageContext } from '../types.ts';

const MIN_REASON_LENGTH = 10;

interface Limits { min: number; max: number; minZones: number; maxZones: number; nameMaxLength: number }

const clonePolicy = (p: DeliveryPolicy): DeliveryPolicy => ({
  default_zone: p.default_zone,
  zones: p.zones.map((z) => ({ ...z, districts: [...z.districts] })),
});

const isCharge = (n: number, limits: Limits) =>
  Number.isFinite(n) && n >= limits.min && n <= limits.max && Math.round(n * 100) === n * 100;

export default function DeliveryChargePage(root: HTMLElement, { navigate }: PageContext = {}) {
  loadSystemHealthStyles();
  const lang = getLanguage();
  const isBn = lang === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page delivery-charge-page';

  let data = null;
  let draft: DeliveryPolicy | null = null;
  let loadError = null;
  let isLoading = true;
  let reasonText = '';
  let testerDistrict = 'dhaka_city';
  // Which zones have their district list open, so a re-render does not fold them shut.
  const openZones = new Set<string>();

  async function loadData() {
    isLoading = true;
    render();
    try {
      data = await api.get('/admin/platform/delivery');
      draft = clonePolicy(data.policy);
      loadError = null;
    } catch (err) {
      loadError = err?.message || t('common.error_generic');
    } finally {
      isLoading = false;
      render();
    }
  }

  /** The district ids the server accepts, in the address form's order, with their display names. */
  function divisionsWithDistricts() {
    const allowed = data?.districts_by_division || {};
    return BANGLADESH_DIVISIONS
      .map((div) => ({
        id: div.id,
        name: isBn ? div.name_bn : div.name_en,
        districts: div.districts
          .filter((d) => (allowed[div.id] || []).includes(d.id))
          .map((d) => ({ id: d.id, name: isBn ? d.name_bn : d.name_en })),
      }))
      .filter((div) => div.districts.length > 0);
  }

  function districtName(id: string) {
    for (const div of BANGLADESH_DIVISIONS) {
      const d = div.districts.find((x) => x.id === id);
      if (d) return isBn ? d.name_bn : d.name_en;
    }
    return id;
  }

  function ownerOf(districtId: string): DeliveryZone | null {
    return draft.zones.find((z) => z.districts.includes(districtId)) || null;
  }

  function canUpdate() {
    return data.can_update !== false && can('platform.delivery.update');
  }

  // ── Zone cards ─────────────────────────────────────────────────────────────

  function zoneCard(zone: DeliveryZone, index: number, limits: Limits, editable: boolean) {
    const isDefault = zone.key === draft.default_zone;
    const card = document.createElement('section');
    card.className = `delivery-zone${isDefault ? ' delivery-zone--default' : ''}`;
    card.dataset.zoneKey = zone.key;

    const head = document.createElement('div');
    head.className = 'delivery-zone__head';
    head.innerHTML = `
      <h3 class="delivery-zone__title">${escapeHtml(zoneName(zone, lang) || t('admin.delivery.zone_label', { n: index + 1 }))}
        ${isDefault ? `<span class="delivery-zone__badge">${escapeHtml(t('admin.delivery.default_badge'))}</span>` : ''}
      </h3>`;
    const remove = Button({
      label: t('admin.delivery.remove_zone'),
      variant: 'ghost',
      size: 'sm',
      disabled: !editable || draft.zones.length <= limits.minZones,
      onClick: () => {
        draft.zones.splice(index, 1);
        // WHY: the default must always name a zone that exists, or the save is refused.
        if (isDefault) draft.default_zone = draft.zones[0].key;
        renderZones();
      },
    });
    head.append(remove);
    card.append(head);

    const grid = document.createElement('div');
    grid.className = 'delivery-zone__grid';

    const nameEn = Input({ label: t('admin.delivery.name_en'), name: `name_en_${zone.key}`, value: zone.name_en, maxLength: limits.nameMaxLength, required: true });
    nameEn.input.disabled = !editable;
    nameEn.input.addEventListener('input', () => { zone.name_en = nameEn.value; refreshTester(); });

    const nameBn = Input({ label: t('admin.delivery.name_bn'), name: `name_bn_${zone.key}`, value: zone.name_bn, maxLength: limits.nameMaxLength, required: true });
    nameBn.input.disabled = !editable;
    nameBn.input.addEventListener('input', () => { zone.name_bn = nameBn.value; refreshTester(); });

    const charge = Input({
      label: t('admin.delivery.per_parcel'),
      hint: t('admin.delivery.per_parcel_hint', { min: limits.min, max: limits.max }),
      type: 'number',
      name: `charge_${zone.key}`,
      prefix: '৳',
      value: String(zone.charge),
      inputmode: 'decimal',
      required: true,
    });
    charge.input.min = String(limits.min);
    charge.input.max = String(limits.max);
    charge.input.step = '0.01';
    charge.input.disabled = !editable;
    charge.input.addEventListener('input', () => {
      zone.charge = charge.value === '' ? Number.NaN : Number(charge.value);
      refreshTester();
    });

    grid.append(nameEn, nameBn, charge);
    card.append(grid);

    const defaultLabel = document.createElement('label');
    defaultLabel.className = 'delivery-zone__default';
    defaultLabel.innerHTML = `
      <input type="radio" name="default_zone" value="${escapeHtml(zone.key)}" ${isDefault ? 'checked' : ''} ${editable ? '' : 'disabled'} />
      <span>${escapeHtml(t('admin.delivery.default_zone'))}</span>
      <span class="text-xs text-muted">${escapeHtml(t('admin.delivery.default_hint'))}</span>`;
    defaultLabel.querySelector('input').addEventListener('change', () => {
      draft.default_zone = zone.key;
      renderZones();
    });
    card.append(defaultLabel);

    card.append(districtPicker(zone, isDefault, editable));
    return card;
  }

  function districtPicker(zone: DeliveryZone, isDefault: boolean, editable: boolean) {
    const details = document.createElement('details');
    details.className = 'delivery-zone__districts';
    details.open = openZones.has(zone.key);
    details.addEventListener('toggle', () => {
      if (details.open) openZones.add(zone.key);
      else openZones.delete(zone.key);
    });

    const summary = document.createElement('summary');
    summary.textContent = t('admin.delivery.districts_summary', { count: zone.districts.length });
    details.append(summary);

    if (isDefault && zone.districts.length === 0) {
      const note = document.createElement('p');
      note.className = 'text-xs text-muted mt-2';
      note.textContent = t('admin.delivery.districts_none_default');
      details.append(note);
    } else if (zone.districts.length > 0) {
      const picked = document.createElement('p');
      picked.className = 'text-xs text-secondary mt-2';
      picked.textContent = zone.districts.map(districtName).join(', ');
      details.append(picked);
    }

    const divisions = document.createElement('div');
    divisions.className = 'delivery-zone__divisions';

    for (const div of divisionsWithDistricts()) {
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'delivery-zone__division';
      const legend = document.createElement('legend');
      legend.textContent = div.name;
      fieldset.append(legend);

      const free = div.districts.filter((d) => {
        const owner = ownerOf(d.id);
        return !owner || owner.key === zone.key;
      });
      const allMine = free.length > 0 && free.every((d) => zone.districts.includes(d.id));

      const all = document.createElement('label');
      all.className = 'delivery-zone__check delivery-zone__check--all';
      all.innerHTML = `<input type="checkbox" ${allMine ? 'checked' : ''} ${editable && free.length ? '' : 'disabled'} />
        <span>${escapeHtml(t('admin.delivery.select_all', { division: div.name }))}</span>`;
      all.querySelector('input').addEventListener('change', (e) => {
        const on = (e.target as HTMLInputElement).checked;
        for (const d of free) {
          const has = zone.districts.includes(d.id);
          if (on && !has) zone.districts.push(d.id);
          if (!on && has) zone.districts.splice(zone.districts.indexOf(d.id), 1);
        }
        renderZones();
      });
      fieldset.append(all);

      for (const d of div.districts) {
        const owner = ownerOf(d.id);
        const takenElsewhere = owner && owner.key !== zone.key;
        const row = document.createElement('label');
        row.className = `delivery-zone__check${takenElsewhere ? ' is-taken' : ''}`;
        row.innerHTML = `<input type="checkbox" value="${escapeHtml(d.id)}" ${owner?.key === zone.key ? 'checked' : ''} ${editable && !takenElsewhere ? '' : 'disabled'} />
          <span>${escapeHtml(d.name)}</span>
          ${takenElsewhere ? `<span class="delivery-zone__taken">${escapeHtml(t('admin.delivery.taken_by', { zone: zoneName(owner, lang) }))}</span>` : ''}`;
        row.querySelector('input').addEventListener('change', (e) => {
          const on = (e.target as HTMLInputElement).checked;
          const has = zone.districts.includes(d.id);
          if (on && !has) zone.districts.push(d.id);
          if (!on && has) zone.districts.splice(zone.districts.indexOf(d.id), 1);
          renderZones();
        });
        fieldset.append(row);
      }
      divisions.append(fieldset);
    }
    details.append(divisions);
    return details;
  }

  // ── The zones panel ───────────────────────────────────────────────────────

  let zonesHost: HTMLElement | null = null;
  let testerResult: HTMLElement | null = null;

  function refreshTester() {
    if (!testerResult || !draft) return;
    const zone = resolveZone(draft, testerDistrict);
    testerResult.textContent = Number.isFinite(zone.charge)
      ? t('admin.delivery.tester_result', { zone: zoneName(zone, lang) || zone.key, charge: formatCurrency(zone.charge) })
      : zoneName(zone, lang);
  }

  function renderZones() {
    if (!zonesHost) return;
    const limits: Limits = data.limits;
    const editable = canUpdate();
    zonesHost.innerHTML = '';
    draft.zones.forEach((zone, i) => zonesHost.append(zoneCard(zone, i, limits, editable)));
    refreshTester();
  }

  function zonesPanel() {
    const limits: Limits = data.limits;
    const editable = canUpdate();

    const panel = document.createElement('section');
    panel.className = 'admin-panel';
    panel.innerHTML = `
      <h2 class="admin-panel__title">${escapeHtml(t('admin.delivery.card_title'))}</h2>
      <p data-page-info class="text-sm text-secondary">${escapeHtml(t('admin.delivery.card_desc'))}</p>
    `;

    const wrap = document.createElement('div');
    wrap.className = 'delivery-zones';

    zonesHost = document.createElement('div');
    zonesHost.className = 'delivery-zones';
    zonesHost.style.marginTop = '0';

    const toolbar = document.createElement('div');
    toolbar.className = 'delivery-zones__toolbar';
    const add = Button({
      label: t('admin.delivery.add_zone'),
      variant: 'secondary',
      size: 'sm',
      disabled: !editable,
      onClick: () => {
        if (draft.zones.length >= limits.maxZones) {
          toast.error(t('admin.delivery.max_zones', { max: limits.maxZones }));
          return;
        }
        const key = `zone_${Date.now().toString(36)}`;
        draft.zones.push({ key, name_en: t('admin.delivery.new_zone_en'), name_bn: t('admin.delivery.new_zone_bn'), charge: limits.min, districts: [] });
        openZones.add(key);
        renderZones();
      },
    });
    const maxNote = document.createElement('span');
    maxNote.className = 'text-xs text-muted';
    maxNote.textContent = t('admin.delivery.max_zones', { max: limits.maxZones });
    toolbar.append(add, maxNote);

    // "Where does Gazipur land?" answered from the unsaved form, before anyone saves.
    const tester = document.createElement('div');
    tester.className = 'delivery-zones__tester';
    const testerLabel = document.createElement('label');
    testerLabel.htmlFor = 'delivery-zone-tester';
    testerLabel.textContent = t('admin.delivery.tester_label');
    const select = document.createElement('select');
    select.id = 'delivery-zone-tester';
    select.className = 'form-select';
    for (const div of divisionsWithDistricts()) {
      const group = document.createElement('optgroup');
      group.label = div.name;
      for (const d of div.districts) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        if (d.id === testerDistrict) opt.selected = true;
        group.append(opt);
      }
      select.append(group);
    }
    select.addEventListener('change', () => { testerDistrict = select.value; refreshTester(); });
    testerResult = document.createElement('span');
    testerResult.className = 'delivery-zones__tester-result';
    tester.append(testerLabel, select, testerResult);

    const reason = Input({
      label: t('admin.delivery.reason'),
      hint: t('admin.delivery.reason_hint', { min: MIN_REASON_LENGTH }),
      type: 'text',
      name: 'reason',
      value: reasonText,
      maxLength: 500,
      required: true,
    });
    reason.input.disabled = !editable;
    reason.input.addEventListener('input', () => { reasonText = reason.value; });

    const save = Button({
      label: t('common.save_changes'),
      variant: 'primary',
      size: 'sm',
      disabled: !editable,
      onClick: async () => {
        for (const zone of draft.zones) {
          if (!zone.name_en.trim() || !zone.name_bn.trim()) {
            toast.error(t('admin.delivery.name_required'));
            return;
          }
          if (!isCharge(zone.charge, limits)) {
            toast.error(t('admin.delivery.per_parcel_hint', { min: limits.min, max: limits.max }));
            return;
          }
        }
        if (reasonText.trim().length < MIN_REASON_LENGTH) {
          toast.error(t('admin.delivery.reason_hint', { min: MIN_REASON_LENGTH }));
          reason.input.focus();
          return;
        }
        save.disabled = true;
        try {
          const res = await api.put('/admin/platform/delivery', {
            zones: draft.zones.map((z) => ({ key: z.key, name_en: z.name_en.trim(), name_bn: z.name_bn.trim(), charge: z.charge, districts: z.districts })),
            default_zone: draft.default_zone,
            expected_updated_at: data.policy.updated_at ?? null,
            reason: reasonText.trim(),
          });
          toast.success((isBn ? res?.message_bn : res?.message_en) || t('admin.delivery.saved'));
          reasonText = '';
          await loadData();
        } catch (err) {
          toast.error((isBn && err?.messageBn) || err?.message || t('common.error_generic'));
        } finally {
          save.disabled = false;
        }
      },
    });

    const actions = document.createElement('div');
    actions.className = 'delivery-zones__actions';
    actions.append(reason, save);

    wrap.append(zonesHost, toolbar, tester, actions);
    panel.append(wrap);

    if (!editable) {
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

    renderZones();
    return panel;
  }

  // ── KPIs and history ──────────────────────────────────────────────────────

  function kpis() {
    const policy: DeliveryPolicy & { updated_at?: string } = data.policy;
    const charges = policy.zones.map((z) => z.charge);
    const low = Math.min(...charges);
    const high = Math.max(...charges);
    const range = low === high ? formatCurrency(low) : `${formatCurrency(low)} – ${formatCurrency(high)}`;
    const defaultName = zoneName(policy.zones.find((z) => z.key === policy.default_zone), lang);
    const updated = policy.updated_at
      ? formatRelativeTime(new Date(policy.updated_at).getTime(), { lang: isBn ? 'bn' : 'en' })
      : t('admin.delivery.never_changed');

    const grid = document.createElement('div');
    grid.className = 'admin-kpi-grid';
    grid.innerHTML = `
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(t('admin.delivery.kpi_zones'))}</div>
        <div class="admin-kpi-card__val font-mono">${policy.zones.length}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(t('admin.delivery.kpi_zones_hint', { zone: defaultName }))}</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(t('admin.delivery.kpi_range'))}</div>
        <div class="admin-kpi-card__val font-mono">${escapeHtml(range)}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(t('admin.delivery.kpi_range_hint'))}</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(t('admin.delivery.kpi_updated'))}</div>
        <div class="admin-kpi-card__val">${escapeHtml(updated)}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(t('admin.delivery.kpi_updated_hint'))}</div>
      </div>`;
    return grid;
  }

  /** One audit side as text: zones (since migration 098) or the single number before it. */
  function summarizeAudit(json): string {
    if (!json) return '—';
    if (Array.isArray(json.zones)) {
      return json.zones.map((z) => `${zoneName(z, lang) || z.key} ${formatCurrency(z.charge)}`).join(' · ');
    }
    if (json.per_parcel_charge != null) return formatCurrency(json.per_parcel_charge);
    return '—';
  }

  function historyPanel() {
    const panel = document.createElement('section');
    panel.className = 'admin-panel mt-4';
    const rows = (data.history || []).map((row) => {
      const reason = row.meta_json?.reason || row.meta?.reason || row.after_json?.meta?.reason || '';
      const when = row.created_at
        ? formatRelativeTime(new Date(row.created_at).getTime(), { lang: isBn ? 'bn' : 'en' })
        : '—';
      return `
        <tr>
          <td class="text-xs">${escapeHtml(when)}</td>
          <td class="text-xs font-mono">${escapeHtml(row.actor_ref || row.actor_id || '—')}</td>
          <td class="text-xs">${escapeHtml(summarizeAudit(row.before_json))} → <strong>${escapeHtml(summarizeAudit(row.after_json))}</strong></td>
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
    zonesHost = null;
    testerResult = null;

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
    } else if (data && draft) {
      container.append(kpis(), zonesPanel(), historyPanel());
    }

    root.appendChild(container);
  }

  loadData();
}
