/**
 * StoreStatusPage.js — Supplier Physical Factory Showroom & Walk-In Status (Prompt 11.1).
 *
 * Route: /supplier/store-status
 * Implements:
 * 1. Hero Live Status Banner with 1-Click Instant Open/Close and Storefront Visibility switches.
 * 2. Real-time KPI summary strip reflecting active state and schedule.
 * 3. Master Operating Hours tool with "⚡ Apply to All Open Days" and 1-Click Regional Presets.
 * 4. Interactive 7-Day Week Card Deck with individual day toggles and custom hours.
 * 5. Showroom location address, district origin, concierge phone, and customer self-pickup desk config.
 * 6. Live API synchronization with toast notifications and full bilingual i18n (EN/BN).
 */

import { supplierApi } from '../../services/supplier.api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';

const DAYS_OF_WEEK = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const TIME_OPTIONS = [
  '06:00 AM', '06:30 AM', '07:00 AM', '07:30 AM', '08:00 AM', '08:30 AM',
  '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM', '01:00 PM', '01:30 PM', '02:00 PM', '02:30 PM',
  '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM', '05:00 PM', '05:30 PM',
  '06:00 PM', '06:30 PM', '07:00 PM', '07:30 PM', '08:00 PM', '08:30 PM',
  '09:00 PM', '09:30 PM', '10:00 PM', '10:30 PM', '11:00 PM', '11:30 PM',
];

const DISTRICT_OPTIONS = [
  'Dhaka', 'Chattogram', 'Sylhet', 'Rajshahi', 'Khulna',
  'Barisal', 'Rangpur', 'Mymensingh', 'Bogura', 'Gazipur', 'Narayanganj'
];

export default function StoreStatusPage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-page-container';

  let store = {
    is_open: true,
    show_public_status: true,
    name: 'Rahim Textiles Factory Outlet & Showroom',
    address: 'Plot 12, Road 4, BSCIC Industrial Area, Tejgaon',
    district: 'Dhaka',
    phone: '01711223344',
    open_time: '09:00 AM',
    close_time: '08:00 PM',
    pickup_enabled: true,
    pickup_notes: 'Buyers must present their Order ID and OTP verification code at the front dispatch desk to claim orders.',
    closed_days: ['Friday'],
    weekly_schedule: {
      Saturday: { is_open: true, open_time: '09:00 AM', close_time: '08:00 PM' },
      Sunday: { is_open: true, open_time: '09:00 AM', close_time: '08:00 PM' },
      Monday: { is_open: true, open_time: '09:00 AM', close_time: '08:00 PM' },
      Tuesday: { is_open: true, open_time: '09:00 AM', close_time: '08:00 PM' },
      Wednesday: { is_open: true, open_time: '09:00 AM', close_time: '08:00 PM' },
      Thursday: { is_open: true, open_time: '09:00 AM', close_time: '08:00 PM' },
      Friday: { is_open: false, open_time: '09:00 AM', close_time: '08:00 PM' },
    },
  };

  let isSaving = false;

  async function loadStoreStatus() {
    try {
      const res = await supplierApi.getStoreStatus();
      const data = res?.data || res;
      if (data && typeof data === 'object') {
        store = {
          ...store,
          ...data,
          weekly_schedule: data.weekly_schedule || data.weeklySchedule || store.weekly_schedule,
          closed_days: data.closed_days || data.closedDays || store.closed_days,
        };
      }
    } catch (err) {
      console.error('Failed to load store status:', err);
    } finally {
      render();
    }
  }

  function getActiveScheduleSummary() {
    if (!store.weekly_schedule) return `${store.open_time} - ${store.close_time}`;
    let openDaysCount = 0;
    DAYS_OF_WEEK.forEach((d) => {
      if (store.weekly_schedule[d]?.is_open) openDaysCount++;
    });

    if (openDaysCount === 7) {
      return t('supplier.open_all_week', 'All 7 Days Open');
    }
    const closedCount = 7 - openDaysCount;
    return t('supplier.days_open_count', `${openDaysCount} Days Open / ${closedCount} Days Off`)
      .replace('{{open}}', openDaysCount)
      .replace('{{closed}}', closedCount);
  }

  async function saveAllSettings(saveBtn = null) {
    if (saveBtn) saveBtn.setLoading?.(true);
    isSaving = true;
    try {
      const closedDays = DAYS_OF_WEEK.filter((d) => !store.weekly_schedule[d]?.is_open);
      store.closed_days = closedDays;

      const payload = {
        is_open: store.is_open,
        isOpen: store.is_open,
        show_public_status: store.show_public_status,
        showPublicStatus: store.show_public_status,
        name: store.name,
        address: store.address,
        district: store.district,
        phone: store.phone,
        open_time: store.open_time,
        close_time: store.close_time,
        opening_time: store.open_time,
        closing_time: store.close_time,
        pickup_enabled: store.pickup_enabled,
        pickup_notes: store.pickup_notes,
        closed_days: closedDays,
        weekly_schedule: store.weekly_schedule,
      };

      await supplierApi.updateStoreStatus(payload);
      toast.success(t('supplier.store_settings_saved_success', 'Physical showroom status and operating schedule saved successfully.'));
    } catch (err) {
      toast.error(err.message || 'Failed to save store status settings.');
    } finally {
      isSaving = false;
      if (saveBtn) saveBtn.setLoading?.(false);
      render();
    }
  }

  function applyPreset(presetType) {
    if (presetType === 'standard') {
      DAYS_OF_WEEK.forEach((d) => {
        store.weekly_schedule[d] = {
          is_open: d !== 'Friday',
          open_time: store.open_time,
          close_time: store.close_time,
        };
      });
      store.closed_days = ['Friday'];
    } else if (presetType === 'weekend') {
      DAYS_OF_WEEK.forEach((d) => {
        store.weekly_schedule[d] = {
          is_open: d !== 'Friday' && d !== 'Saturday',
          open_time: store.open_time,
          close_time: store.close_time,
        };
      });
      store.closed_days = ['Friday', 'Saturday'];
    } else if (presetType === 'all') {
      DAYS_OF_WEEK.forEach((d) => {
        store.weekly_schedule[d] = {
          is_open: true,
          open_time: store.open_time,
          close_time: store.close_time,
        };
      });
      store.closed_days = [];
    } else if (presetType === 'vacation') {
      DAYS_OF_WEEK.forEach((d) => {
        store.weekly_schedule[d] = {
          is_open: false,
          open_time: store.open_time,
          close_time: store.close_time,
        };
      });
      store.closed_days = [...DAYS_OF_WEEK];
    }
    toast.success('Schedule preset applied.');
    render();
  }

  function applyGeneralHoursToAllOpenDays() {
    DAYS_OF_WEEK.forEach((d) => {
      if (store.weekly_schedule[d]?.is_open) {
        store.weekly_schedule[d].open_time = store.open_time;
        store.weekly_schedule[d].close_time = store.close_time;
      }
    });
    toast.success(`Applied ${store.open_time} – ${store.close_time} to all open days.`);
    render();
  }

  function render() {
    container.innerHTML = '';

    // -------------------------------------------------------------------------
    // 1. Header with Breadcrumb and Actions
    // -------------------------------------------------------------------------
    const header = document.createElement('header');
    header.className = 'supplier-header';

    const titles = document.createElement('div');
    titles.className = 'supplier-header__titles';
    titles.innerHTML = `
      <div class="supplier-header__badge-row">
        <a href="/supplier" class="text-xs font-bold text-muted hover:text-primary">← ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
        <span class="text-muted">/</span>
        <span class="text-xs text-muted font-mono">${t('supplier.physical_store_status', 'Physical Store Status')}</span>
      </div>
      <h1 class="supplier-header__title">
        <span>🏬</span> ${t('supplier.store_status_title', 'Physical Factory & Showroom Status')}
      </h1>
      <p class="supplier-header__subtitle">
        ${t('supplier.store_status_subtitle', 'Manage real-time walk-in open/closed status, operating schedules, and warehouse customer pickups.')}
      </p>
    `;

    const headerActions = document.createElement('div');
    headerActions.className = 'supplier-header__actions';

    const refreshBtn = Button({
      label: `🔄 ${t('common.refresh', 'Refresh')}`,
      variant: 'secondary',
      size: 'sm',
      onClick: () => loadStoreStatus(),
    });

    const saveHeaderBtn = Button({
      label: `💾 ${t('supplier.save_store_settings', 'Save Status & Schedule')}`,
      variant: 'primary',
      size: 'sm',
      loading: isSaving,
      onClick: () => saveAllSettings(saveHeaderBtn),
    });

    headerActions.append(refreshBtn, saveHeaderBtn);
    header.append(titles, headerActions);
    container.appendChild(header);

    // -------------------------------------------------------------------------
    // 2. Hero Live Status Banner with 1-Click Interactive Switches
    // -------------------------------------------------------------------------
    const heroBanner = document.createElement('div');
    heroBanner.className = 'supplier-store-hero';

    let heroBadgeHtml = '';
    if (!store.show_public_status) {
      heroBadgeHtml = `<span class="badge badge--secondary font-bold text-xs" style="padding: 6px 12px;">🙈 ${t('supplier.hidden_status', 'Hidden from Public')}</span>`;
    } else if (store.is_open) {
      heroBadgeHtml = `<span class="badge badge--success font-bold text-xs" style="padding: 6px 12px;">🟢 ${t('supplier.open_for_visitors', 'Open for Visitors')}</span>`;
    } else {
      heroBadgeHtml = `<span class="badge badge--danger font-bold text-xs" style="padding: 6px 12px;">🔴 ${t('supplier.closed_for_visitors', 'Closed Today')}</span>`;
    }

    const heroLeft = document.createElement('div');
    heroLeft.style.display = 'flex';
    heroLeft.style.flexDirection = 'column';
    heroLeft.style.gap = '6px';
    heroLeft.style.maxWidth = '550px';
    heroLeft.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        ${heroBadgeHtml}
        <span class="text-xs font-mono font-bold text-muted">${getActiveScheduleSummary()}</span>
      </div>
      <h2 style="font-size: 1.25rem; font-weight: 800; color: var(--text-primary); margin: 4px 0 0 0;">
        ${store.name}
      </h2>
      <p style="font-size: var(--font-size-xs); color: var(--text-secondary); margin: 0; line-height: 1.4;">
        📍 ${store.address}, ${store.district} • 🕒 ${store.open_time} – ${store.close_time}
      </p>
    `;

    const heroRight = document.createElement('div');
    heroRight.style.display = 'flex';
    heroRight.style.alignItems = 'center';
    heroRight.style.gap = '10px';
    heroRight.style.flexWrap = 'wrap';

    const instantToggleBtn = Button({
      label: store.is_open ? `🔴 ${t('supplier.set_to_closed', 'Set to Closed')}` : `🟢 ${t('supplier.set_to_open', 'Open Showroom Now')}`,
      variant: store.is_open ? 'danger' : 'success',
      size: 'md',
      onClick: async () => {
        const nextState = !store.is_open;
        try {
          await supplierApi.updateStoreStatus({ isOpen: nextState, is_open: nextState });
          store.is_open = nextState;
          toast.success(`Showroom is now ${nextState ? 'OPEN for visitors' : 'CLOSED'}.`);
          render();
        } catch (err) {
          toast.error('Failed to update showroom status.');
        }
      },
    });

    const visibilityToggleBtn = Button({
      label: store.show_public_status
        ? `🙈 ${t('supplier.visibility_hidden', 'Hide from Storefront')}`
        : `👁️ ${t('supplier.visibility_shown', 'Show on Storefront')}`,
      variant: store.show_public_status ? 'secondary' : 'primary',
      size: 'md',
      onClick: async () => {
        const nextVis = !store.show_public_status;
        try {
          await supplierApi.updateStoreStatus({ show_public_status: nextVis, showPublicStatus: nextVis });
          store.show_public_status = nextVis;
          toast.success(nextVis ? 'Showroom walk-in status is now visible on storefront.' : 'Showroom status is now hidden from storefront.');
          render();
        } catch (err) {
          toast.error('Failed to update visibility settings.');
        }
      },
    });

    heroRight.append(instantToggleBtn, visibilityToggleBtn);
    heroBanner.append(heroLeft, heroRight);
    container.appendChild(heroBanner);

    // -------------------------------------------------------------------------
    // 3. KPI Summary Strip
    // -------------------------------------------------------------------------
    const summaryStrip = document.createElement('div');
    summaryStrip.className = 'supplier-kpi-grid';

    summaryStrip.innerHTML = `
      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.walkin_status', 'Walk-in Status')}</span>
        <div class="supplier-kpi-card__value ${store.is_open && store.show_public_status ? 'supplier-kpi-card__value--success' : (store.show_public_status ? 'supplier-kpi-card__value--danger' : 'text-muted')}" style="font-size: 1.3rem; margin: 4px 0;">
          ${!store.show_public_status ? '⚪ ' + t('supplier.hidden_status', 'Hidden') : (store.is_open ? '🟢 ' + t('supplier.day_open', 'Open') : '🔴 ' + t('supplier.closed_for_visitors', 'Closed Today'))}
        </div>
        <span class="text-xs text-muted">${store.show_public_status ? 'Live on storefront' : 'Private / Hidden'}</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.operating_hours', 'Operating Hours')}</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.3rem; margin: 4px 0;">
          ${store.open_time} – ${store.close_time}
        </div>
        <span class="text-xs text-muted">${getActiveScheduleSummary()}</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.showroom_location', 'Showroom Location')}</span>
        <div class="supplier-kpi-card__value text-primary" style="font-size: 1.3rem; margin: 4px 0;">
          📍 ${store.district}
        </div>
        <span class="text-xs text-muted text-truncate" style="max-width: 200px;" title="${store.address}">${store.address}</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.self_pickup_desk', 'Self-Pickup Desk')}</span>
        <div class="supplier-kpi-card__value ${store.pickup_enabled ? 'supplier-kpi-card__value--success' : 'text-muted'}" style="font-size: 1.3rem; margin: 4px 0;">
          ${store.pickup_enabled ? '🟢 ' + t('supplier.active', 'Active') : '⚪ ' + t('supplier.disabled', 'Disabled')}
        </div>
        <span class="text-xs text-muted">Direct warehouse handovers</span>
      </div>
    `;
    container.appendChild(summaryStrip);

    // -------------------------------------------------------------------------
    // 4. Master Operating Hours & Quick Schedule Presets Card
    // -------------------------------------------------------------------------
    const hoursCard = document.createElement('div');
    hoursCard.className = 'supplier-store-status-card';
    hoursCard.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 12px;">
        <div>
          <h3 style="font-size: var(--font-size-base); font-weight: 800; color: var(--text-primary); margin: 0;">
            🕒 ${t('supplier.general_hours_title', 'General Operating Hours & 1-Click Presets')}
          </h3>
          <p style="font-size: var(--font-size-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
            Set your standard daily business hours and instantly apply preset schedules for Bangladesh.
          </p>
        </div>

        <div class="supplier-preset-chips">
          <button type="button" class="supplier-preset-chip" id="preset-std-chip">
            🇧🇩 ${t('supplier.preset_standard', 'Sat – Thu Open (Fri Holiday)')}
          </button>
          <button type="button" class="supplier-preset-chip" id="preset-weekend-chip">
            🏢 ${t('supplier.preset_weekend', 'Sun – Thu Open (Fri & Sat Off)')}
          </button>
          <button type="button" class="supplier-preset-chip" id="preset-all-chip">
            🛍️ ${t('supplier.preset_all_days', '7 Days Open (All Week)')}
          </button>
        </div>
      </div>

      <div style="display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap;">
        <div class="supplier-form-field" style="flex: 1; min-width: 160px;">
          <label for="general-open-time">${t('supplier.opening_time', 'Opening Time')} *</label>
          <select id="general-open-time" class="form-select">
            ${TIME_OPTIONS.map((time) => `<option value="${time}" ${time === store.open_time ? 'selected' : ''}>${time}</option>`).join('')}
          </select>
        </div>

        <div class="supplier-form-field" style="flex: 1; min-width: 160px;">
          <label for="general-close-time">${t('supplier.closing_time', 'Closing Time')} *</label>
          <select id="general-close-time" class="form-select">
            ${TIME_OPTIONS.map((time) => `<option value="${time}" ${time === store.close_time ? 'selected' : ''}>${time}</option>`).join('')}
          </select>
        </div>

        <button type="button" class="btn btn--sm btn--secondary" id="apply-hours-all-btn" style="height: 38px; white-space: nowrap;">
          ⚡ Apply Hours to All Open Days
        </button>
      </div>
    `;

    hoursCard.querySelector('#preset-std-chip').onclick = () => applyPreset('standard');
    hoursCard.querySelector('#preset-weekend-chip').onclick = () => applyPreset('weekend');
    hoursCard.querySelector('#preset-all-chip').onclick = () => applyPreset('all');

    hoursCard.querySelector('#general-open-time').onchange = (e) => {
      store.open_time = e.target.value;
    };

    hoursCard.querySelector('#general-close-time').onchange = (e) => {
      store.close_time = e.target.value;
    };

    hoursCard.querySelector('#apply-hours-all-btn').onclick = applyGeneralHoursToAllOpenDays;

    container.appendChild(hoursCard);

    // -------------------------------------------------------------------------
    // 5. Interactive 7-Day Week Card Deck (Easy 1-Tap Toggle for Owner)
    // -------------------------------------------------------------------------
    const deckCard = document.createElement('div');
    deckCard.className = 'supplier-store-status-card';

    const deckHeader = document.createElement('div');
    deckHeader.style.display = 'flex';
    deckHeader.style.alignItems = 'center';
    deckHeader.style.justifyContent = 'space-between';
    deckHeader.style.borderBottom = '1px solid var(--border-subtle)';
    deckHeader.style.paddingBottom = '12px';
    deckHeader.innerHTML = `
      <div>
        <h3 style="font-size: var(--font-size-base); font-weight: 800; color: var(--text-primary); margin: 0;">
          📅 ${t('supplier.weekly_schedule_title', 'Weekly Operating Schedule (Day by Day Matrix)')}
        </h3>
        <p style="font-size: var(--font-size-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
          Click on any day card button below to toggle it OPEN 🟢 or CLOSED (Holiday) 🏖️, and customize hours per day.
        </p>
      </div>
      <span class="badge badge--secondary text-xs font-mono font-bold">
        ${getActiveScheduleSummary()}
      </span>
    `;
    deckCard.appendChild(deckHeader);

    const weekDeck = document.createElement('div');
    weekDeck.className = 'supplier-week-deck';

    DAYS_OF_WEEK.forEach((dayName) => {
      const dayData = store.weekly_schedule[dayName] || {
        is_open: dayName !== 'Friday',
        open_time: store.open_time,
        close_time: store.close_time,
      };

      const dayCard = document.createElement('div');
      dayCard.className = `supplier-day-card ${dayData.is_open ? 'supplier-day-card--open' : 'supplier-day-card--closed'}`;

      const cardHeader = document.createElement('div');
      cardHeader.className = 'supplier-day-card__header';
      cardHeader.innerHTML = `
        <span class="supplier-day-card__title">${t(`supplier.days.${dayName}`, dayName)}</span>
        <span style="font-size: 14px;">${dayData.is_open ? '🏬' : '🏖️'}</span>
      `;

      // 1-Click Interactive Toggle Button
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = `supplier-day-card__toggle ${dayData.is_open ? 'supplier-day-card__toggle--open' : 'supplier-day-card__toggle--closed'}`;
      toggleBtn.innerHTML = dayData.is_open
        ? `🟢 <strong>${t('supplier.day_open', 'OPEN')}</strong>`
        : `🏖️ <strong>${t('supplier.day_closed', 'OFF (Holiday)')}</strong>`;

      toggleBtn.title = dayData.is_open ? 'Click to mark as holiday/closed' : 'Click to mark as open';
      toggleBtn.onclick = () => {
        dayData.is_open = !dayData.is_open;
        if (dayData.is_open) {
          dayData.open_time = dayData.open_time || store.open_time;
          dayData.close_time = dayData.close_time || store.close_time;
        }
        store.weekly_schedule[dayName] = dayData;
        render();
      };

      const hoursBox = document.createElement('div');
      hoursBox.className = 'supplier-day-card__hours-box';

      if (dayData.is_open) {
        const openSelect = document.createElement('select');
        openSelect.className = 'supplier-day-card__time-select';
        openSelect.innerHTML = TIME_OPTIONS.map((time) => `
          <option value="${time}" ${time === dayData.open_time ? 'selected' : ''}>${time}</option>
        `).join('');
        openSelect.onchange = (e) => {
          dayData.open_time = e.target.value;
          store.weekly_schedule[dayName] = dayData;
        };

        const closeSelect = document.createElement('select');
        closeSelect.className = 'supplier-day-card__time-select';
        closeSelect.innerHTML = TIME_OPTIONS.map((time) => `
          <option value="${time}" ${time === dayData.close_time ? 'selected' : ''}>${time}</option>
        `).join('');
        closeSelect.onchange = (e) => {
          dayData.close_time = e.target.value;
          store.weekly_schedule[dayName] = dayData;
        };

        hoursBox.append(openSelect, closeSelect);
      } else {
        const closedText = document.createElement('div');
        closedText.style.fontSize = '11px';
        closedText.style.color = 'var(--text-danger)';
        closedText.style.fontWeight = '700';
        closedText.style.textAlign = 'center';
        closedText.style.padding = '8px 0';
        closedText.textContent = 'Weekly Holiday';
        hoursBox.append(closedText);
      }

      dayCard.append(cardHeader, toggleBtn, hoursBox);
      weekDeck.appendChild(dayCard);
    });

    deckCard.appendChild(weekDeck);
    container.appendChild(deckCard);

    // -------------------------------------------------------------------------
    // 6. Showroom Address, Contact & Self-Pickup Configuration
    // -------------------------------------------------------------------------
    const addressCard = document.createElement('div');
    addressCard.className = 'supplier-store-status-card';
    addressCard.innerHTML = `
      <div style="border-bottom: 1px solid var(--border-subtle); padding-bottom: 12px;">
        <h3 style="font-size: var(--font-size-base); font-weight: 800; color: var(--text-primary); margin: 0;">
          📍 ${t('supplier.address_contact_title', 'Showroom Address & Self-Pickup Configuration')}
        </h3>
        <p style="font-size: var(--font-size-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
          Ensure your street address and customer pickup notes are accurate for walk-in buyers and consignments.
        </p>
      </div>

      <div class="supplier-settings-grid">
        <div class="supplier-form-field">
          <label for="store-outlet-name">${t('supplier.outlet_name', 'Showroom / Outlet Name')} *</label>
          <input type="text" id="store-outlet-name" value="${store.name}" placeholder="e.g. Rahim Textiles Factory Outlet" required />
        </div>

        <div class="supplier-form-field">
          <label for="store-phone">${t('supplier.concierge_phone', 'Concierge / Helpdesk Phone')} *</label>
          <input type="tel" id="store-phone" value="${store.phone}" placeholder="e.g. 01711223344" required />
        </div>

        <div class="supplier-form-field" style="grid-column: 1 / -1;">
          <label for="store-address">${t('supplier.street_address', 'Street Address / Factory Unit')} *</label>
          <input type="text" id="store-address" value="${store.address}" placeholder="e.g. Plot 12, Road 4, BSCIC Industrial Area, Tejgaon" required />
        </div>

        <div class="supplier-form-field">
          <label for="store-district">${t('supplier.district', 'District')} *</label>
          <select id="store-district" class="form-select">
            ${DISTRICT_OPTIONS.map((dist) => `<option value="${dist}" ${dist === store.district ? 'selected' : ''}>${dist}</option>`).join('')}
          </select>
        </div>

        <div class="supplier-form-field" style="grid-column: 1 / -1; background: var(--surface-1); padding: 14px 18px; border-radius: var(--radius-lg); border: 1px solid var(--border-subtle);">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; text-transform: none; font-size: var(--font-size-sm); color: var(--text-primary);">
            <input type="checkbox" id="store-pickup-toggle" ${store.pickup_enabled ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--color-primary);" />
            <strong>${t('supplier.pickup_desk_toggle', 'Enable Direct Customer & Reseller Self-Pickup at Showroom')}</strong>
          </label>
        </div>

        <div class="supplier-form-field" style="grid-column: 1 / -1;">
          <label for="store-pickup-notes">${t('supplier.pickup_instructions', 'Self-Pickup Instructions for Buyers')}</label>
          <textarea id="store-pickup-notes" rows="2" placeholder="e.g. Buyers must present their Order ID and OTP verification code at the front dispatch desk...">${store.pickup_notes || ''}</textarea>
        </div>
      </div>
    `;

    addressCard.querySelector('#store-outlet-name').oninput = (e) => {
      store.name = e.target.value.trim();
    };

    addressCard.querySelector('#store-phone').oninput = (e) => {
      store.phone = e.target.value.trim();
    };

    addressCard.querySelector('#store-address').oninput = (e) => {
      store.address = e.target.value.trim();
    };

    addressCard.querySelector('#store-district').onchange = (e) => {
      store.district = e.target.value;
      render();
    };

    addressCard.querySelector('#store-pickup-toggle').onchange = (e) => {
      store.pickup_enabled = e.target.checked;
      render();
    };

    addressCard.querySelector('#store-pickup-notes').oninput = (e) => {
      store.pickup_notes = e.target.value;
    };

    container.appendChild(addressCard);

    // -------------------------------------------------------------------------
    // 7. Footer Action Bar
    // -------------------------------------------------------------------------
    const footerBar = document.createElement('div');
    footerBar.style.display = 'flex';
    footerBar.style.alignItems = 'center';
    footerBar.style.justifyContent = 'flex-end';
    footerBar.style.gap = '12px';
    footerBar.style.padding = '16px 0 32px 0';

    const saveBottomBtn = Button({
      label: `💾 ${t('supplier.save_store_settings', 'Save Status & Schedule')}`,
      variant: 'primary',
      size: 'md',
      loading: isSaving,
      onClick: () => saveAllSettings(saveBottomBtn),
    });

    footerBar.appendChild(saveBottomBtn);
    container.appendChild(footerBar);
  }

  loadStoreStatus();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
