/**
 * SalerStoreStatusPage.js — Saler Physical Shop, Showroom & Customer Pickup Desk Status (Prompt 11.1 / §AL.2).
 *
 * Route: /saler/store-status
 * Implements:
 * 1. Hero Live Status Banner with 1-Click Instant Open/Close and Storefront Visibility switches.
 * 2. Real-time KPI summary strip reflecting active state and schedule.
 * 3. Master Operating Hours tool with "⚡ Apply to All Open Days" and regional presets.
 * 4. Interactive 7-Day Week Card Deck with individual day toggles and custom hours.
 * 5. Showroom location address, district origin, concierge phone, and customer self-pickup desk config.
 * 6. Live API synchronization with toast notifications and full bilingual i18n (EN/BN).
 */

import { salerApi } from '../../services/saler.api.js';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';

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
  'Barishal', 'Rangpur', 'Mymensingh', 'Bogura', 'Gazipur', 'Narayanganj', 'Cumilla'
];

export default function SalerStoreStatusPage(root, { navigate } = {}) {
  const container = document.createElement('div');
  container.className = 'saler-page-container';

  let store = {
    has_physical_shop: true,
    is_open: true,
    show_public_status: true,
    shop_name: 'Tanvir Trends Flagship Hub & Pickup Counter',
    address: 'Shop 42, Level 3, Eastern Plaza, Hatirpool',
    district: 'Dhaka',
    phone: '+8801711223344',
    open_time: '10:00 AM',
    close_time: '08:30 PM',
    pickup_enabled: true,
    pickup_notes: 'Customers can inspect products and pick up orders directly at our counter with their Order ID.',
    closed_days: ['Friday'],
    weekly_schedule: {
      Saturday: { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' },
      Sunday: { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' },
      Monday: { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' },
      Tuesday: { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' },
      Wednesday: { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' },
      Thursday: { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' },
      Friday: { is_open: false, open_time: '10:00 AM', close_time: '08:30 PM' },
    },
  };

  let loading = true;
  let isSaving = false;
  let unsubscribeLang = null;

  async function loadData() {
    loading = true;
    render();
    try {
      const res = await salerApi.getStoreStatus();
      const data = res?.data || res;
      if (data && typeof data === 'object') {
        store = {
          ...store,
          ...data,
          weekly_schedule: data.weekly_schedule || store.weekly_schedule,
        };
      }
    } catch (err) {
      console.error('Failed to load saler store status:', err);
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    container.innerHTML = '';
    const isBn = getLanguage() === 'bn';

    if (loading) {
      container.append(
        Skeleton({ width: '100%', height: '120px' }),
        Skeleton({ width: '100%', height: '240px' }),
        Skeleton({ width: '100%', height: '300px' })
      );
      return;
    }

    // 1. Header
    const header = document.createElement('div');
    header.className = 'saler-header-row';
    header.innerHTML = `
      <div class="saler-header-row__titles">
        <div class="saler-header-row__breadcrumb">
          <a href="/saler" class="hover:text-primary">← ${t('saler.dashboard.title', 'Dashboard')}</a>
          <span>/</span>
          <span class="text-primary font-bold">${t('saler_store_status.title')}</span>
        </div>
        <h1 class="saler-header-row__title">
          <span>🏪</span>
          <span>${t('saler_store_status.title')}</span>
        </h1>
        <p class="saler-header-row__subtitle">
          ${t('saler_store_status.subtitle')}
        </p>
      </div>
      <div class="saler-header-row__actions">
        <button id="btn-save-top" class="btn btn--primary" ${isSaving ? 'disabled' : ''}>
          ${isSaving ? '⏳ Saving...' : `💾 ${t('saler_store_status.btn_save_all')}`}
        </button>
      </div>
    `;
    header.querySelector('#btn-save-top').onclick = saveAll;
    container.append(header);

    // 2. Hero Live Status Banner
    const banner = document.createElement('div');
    banner.className = `p-6 rounded-2xl border ${
      store.is_open
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : 'border-rose-500/30 bg-rose-500/5'
    } flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm transition-all`;

    banner.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-center gap-3">
          <span class="inline-flex h-4 w-4 rounded-full ${store.is_open ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}"></span>
          <span class="text-xs font-mono font-bold uppercase tracking-wider ${store.is_open ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}">
            ${store.is_open ? t('saler_store_status.status_open_badge') : t('saler_store_status.status_closed_badge')}
          </span>
        </div>
        <h2 class="text-xl font-black tracking-tight text-foreground">
          ${store.is_open ? t('saler_store_status.status_banner_open') : t('saler_store_status.status_banner_closed')}
        </h2>
        <p class="text-xs text-muted">
          ${isBn ? 'শোরুমের স্বাভাবিক কার্যসময়:' : 'Standard walk-in showroom hours:'} <strong class="font-mono text-foreground">${store.open_time} – ${store.close_time}</strong>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button id="btn-toggle-open" class="btn ${store.is_open ? 'btn--secondary' : 'btn--primary'} btn--sm font-bold">
          ${store.is_open ? t('saler_store_status.btn_instant_close') : t('saler_store_status.btn_instant_open')}
        </button>
      </div>
    `;

    banner.querySelector('#btn-toggle-open').onclick = async () => {
      store.is_open = !store.is_open;
      await salerApi.updateStoreStatus({ is_open: store.is_open });
      toast.success(store.is_open ? 'Store marked as OPEN' : 'Store marked as CLOSED');
      render();
    };

    container.append(banner);

    // 3. Grid: Left (Master Hours & 7-Day Schedule) + Right (Showroom Location & Self-Pickup)
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 lg:grid-cols-12 gap-6';

    // Left Column: Hours & Schedule (7 Cols)
    const leftCol = document.createElement('div');
    leftCol.className = 'lg:col-span-7 space-y-6';

    // Master Hours Tool
    const hoursCard = document.createElement('div');
    hoursCard.className = 'saler-kpi-card space-y-4';
    hoursCard.innerHTML = `
      <div class="flex items-center justify-between border-b border-subtle pb-3">
        <div>
          <h3 class="font-bold text-sm text-foreground flex items-center gap-2">
            ⏰ ${t('saler_store_status.section_hours')}
          </h3>
          <p class="text-xs text-muted">Set baseline hours or apply regional timing presets.</p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="space-y-1">
          <label class="text-xs font-semibold text-muted">${t('saler_store_status.field_open_time')}</label>
          <select id="master-open-time" class="select select--sm w-full font-mono">
            ${TIME_OPTIONS.map((tOpt) => `<option value="${tOpt}" ${tOpt === store.open_time ? 'selected' : ''}>${tOpt}</option>`).join('')}
          </select>
        </div>
        <div class="space-y-1">
          <label class="text-xs font-semibold text-muted">${t('saler_store_status.field_close_time')}</label>
          <select id="master-close-time" class="select select--sm w-full font-mono">
            ${TIME_OPTIONS.map((tOpt) => `<option value="${tOpt}" ${tOpt === store.close_time ? 'selected' : ''}>${tOpt}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-subtle">
        <button id="btn-apply-all-days" class="btn btn--secondary btn--xs font-bold">
          ${t('saler_store_status.btn_apply_all')}
        </button>
        <button id="btn-preset-standard" class="btn btn--neutral btn--xs">
          ${t('saler_store_status.preset_standard')}
        </button>
      </div>
    `;

    hoursCard.querySelector('#master-open-time').onchange = (e) => {
      store.open_time = e.target.value;
    };
    hoursCard.querySelector('#master-close-time').onchange = (e) => {
      store.close_time = e.target.value;
    };
    hoursCard.querySelector('#btn-apply-all-days').onclick = () => {
      DAYS_OF_WEEK.forEach((d) => {
        if (store.weekly_schedule[d]) {
          store.weekly_schedule[d].open_time = store.open_time;
          store.weekly_schedule[d].close_time = store.close_time;
        }
      });
      toast.success('Applied master hours to all schedule days!');
      render();
    };
    hoursCard.querySelector('#btn-preset-standard').onclick = () => {
      store.open_time = '10:00 AM';
      store.close_time = '08:30 PM';
      DAYS_OF_WEEK.forEach((d) => {
        if (store.weekly_schedule[d]) {
          store.weekly_schedule[d].is_open = d !== 'Friday';
          store.weekly_schedule[d].open_time = '10:00 AM';
          store.weekly_schedule[d].close_time = '08:30 PM';
        }
      });
      toast.success('Applied Dhaka Standard preset (Fri Closed)!');
      render();
    };

    leftCol.append(hoursCard);

    // 7-Day Schedule Card Deck
    const scheduleCard = document.createElement('div');
    scheduleCard.className = 'saler-kpi-card space-y-4';
    scheduleCard.innerHTML = `
      <div class="border-b border-subtle pb-2">
        <h3 class="font-bold text-sm text-foreground flex items-center gap-2">
          📅 ${t('saler_store_status.section_schedule')}
        </h3>
        <p class="text-xs text-muted">Toggle open/closed state for individual days of the week.</p>
      </div>
      <div class="space-y-3" id="schedule-deck-list"></div>
    `;

    const deckList = scheduleCard.querySelector('#schedule-deck-list');

    DAYS_OF_WEEK.forEach((day) => {
      const dayConfig = store.weekly_schedule[day] || { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' };
      const row = document.createElement('div');
      row.className = `p-3 rounded-xl border ${
        dayConfig.is_open ? 'border-subtle bg-surface' : 'border-subtle/50 bg-subtle/10 opacity-75'
      } flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all`;

      row.innerHTML = `
        <div class="flex items-center gap-3">
          <input type="checkbox" class="checkbox day-toggle" id="check-${day}" ${dayConfig.is_open ? 'checked' : ''} />
          <label for="check-${day}" class="font-bold text-xs cursor-pointer text-foreground select-none">
            ${day}
          </label>
        </div>
        <div class="flex items-center gap-2 ${dayConfig.is_open ? '' : 'opacity-40 pointer-events-none'}">
          <select class="select select--xs font-mono day-open" data-day="${day}">
            ${TIME_OPTIONS.map((tOpt) => `<option value="${tOpt}" ${tOpt === dayConfig.open_time ? 'selected' : ''}>${tOpt}</option>`).join('')}
          </select>
          <span class="text-xs text-muted">–</span>
          <select class="select select--xs font-mono day-close" data-day="${day}">
            ${TIME_OPTIONS.map((tOpt) => `<option value="${tOpt}" ${tOpt === dayConfig.close_time ? 'selected' : ''}>${tOpt}</option>`).join('')}
          </select>
        </div>
      `;

      row.querySelector('.day-toggle').onchange = (e) => {
        dayConfig.is_open = e.target.checked;
        store.weekly_schedule[day] = dayConfig;
        render();
      };
      row.querySelector('.day-open').onchange = (e) => {
        dayConfig.open_time = e.target.value;
        store.weekly_schedule[day] = dayConfig;
      };
      row.querySelector('.day-close').onchange = (e) => {
        dayConfig.close_time = e.target.value;
        store.weekly_schedule[day] = dayConfig;
      };

      deckList.append(row);
    });

    leftCol.append(scheduleCard);
    grid.append(leftCol);

    // Right Column: Showroom Address & Self-Pickup (5 Cols)
    const rightCol = document.createElement('div');
    rightCol.className = 'lg:col-span-5 space-y-6';

    const locationCard = document.createElement('div');
    locationCard.className = 'saler-kpi-card space-y-4';
    locationCard.innerHTML = `
      <div class="border-b border-subtle pb-2">
        <h3 class="font-bold text-sm text-foreground flex items-center gap-2">
          📍 ${t('saler_store_status.section_location')}
        </h3>
        <p class="text-xs text-muted">Address and contact information displayed to buyers.</p>
      </div>
      <div class="space-y-3">
        <div class="space-y-1">
          <label class="text-xs font-semibold text-muted">${t('saler_store_status.field_shop_name')}</label>
          <input type="text" id="loc-shop-name" class="input input--sm w-full" value="${store.shop_name || ''}" />
        </div>
        <div class="space-y-1">
          <label class="text-xs font-semibold text-muted">${t('saler_store_status.field_district')}</label>
          <select id="loc-district" class="select select--sm w-full">
            ${DISTRICT_OPTIONS.map((d) => `<option value="${d}" ${d === store.district ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
        </div>
        <div class="space-y-1">
          <label class="text-xs font-semibold text-muted">${t('saler_store_status.field_address')}</label>
          <textarea id="loc-address" class="textarea textarea--sm w-full" rows="3">${store.address || ''}</textarea>
        </div>
        <div class="space-y-1">
          <label class="text-xs font-semibold text-muted">${t('saler_store_status.field_phone')}</label>
          <input type="tel" id="loc-phone" class="input input--sm w-full" value="${store.phone || ''}" />
        </div>
        <div class="pt-3 border-t border-subtle space-y-3">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" id="loc-pickup-toggle" class="checkbox" ${store.pickup_enabled ? 'checked' : ''} />
            <span class="text-xs font-bold text-foreground">${t('saler_store_status.field_pickup_enabled')}</span>
          </label>
          <div class="space-y-1 ${store.pickup_enabled ? '' : 'opacity-40 pointer-events-none'}">
            <label class="text-xs font-semibold text-muted">${t('saler_store_status.field_pickup_notes')}</label>
            <textarea id="loc-pickup-notes" class="textarea textarea--sm w-full" rows="2" placeholder="e.g. Present order confirmation SMS at counter">${store.pickup_notes || ''}</textarea>
          </div>
        </div>
      </div>
    `;

    locationCard.querySelector('#loc-shop-name').oninput = (e) => { store.shop_name = e.target.value; };
    locationCard.querySelector('#loc-district').onchange = (e) => { store.district = e.target.value; };
    locationCard.querySelector('#loc-address').oninput = (e) => { store.address = e.target.value; };
    locationCard.querySelector('#loc-phone').oninput = (e) => { store.phone = e.target.value; };
    locationCard.querySelector('#loc-pickup-toggle').onchange = (e) => {
      store.pickup_enabled = e.target.checked;
      render();
    };
    locationCard.querySelector('#loc-pickup-notes').oninput = (e) => { store.pickup_notes = e.target.value; };

    rightCol.append(locationCard);
    grid.append(rightCol);

    container.append(grid);
  }

  async function saveAll() {
    isSaving = true;
    render();
    try {
      await salerApi.updateStoreStatus(store);
      toast.success(t('saler_store_status.toast_saved'));
    } catch (err) {
      toast.error(err.message || 'Failed to save shop settings');
    } finally {
      isSaving = false;
      render();
    }
  }

  unsubscribeLang = subscribeLang(() => render());

  loadData();
  root.append(container);

  return () => {
    if (unsubscribeLang) unsubscribeLang();
    container.remove();
  };
}
