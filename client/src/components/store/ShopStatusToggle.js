/**
 * ShopStatusToggle.js — Physical store Open 🟢 / Closed 🔴 / Auto ⏰ toggle with business hours scheduler (Prompt 4.8).
 */

import { t, getLanguage } from '../../services/i18n.js';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { Checkbox } from '../ui/Checkbox.js';
import { Input } from '../ui/Input.js';

const DAYS_OF_WEEK = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

export function ShopStatusToggle({
  initialStatus = 'CLOSED',
  initialHours = null,
  hasPhysicalShop = true,
  editable = true,
  onChange = null,
} = {}) {
  const container = document.createElement('div');
  container.className = 'shop-status-toggle';

  let currentMode = initialStatus || 'CLOSED';
  let businessHours = initialHours || {
    saturday: { open: '09:00', close: '21:00', is_closed: false },
    sunday: { open: '09:00', close: '21:00', is_closed: false },
    monday: { open: '09:00', close: '21:00', is_closed: false },
    tuesday: { open: '09:00', close: '21:00', is_closed: false },
    wednesday: { open: '09:00', close: '21:00', is_closed: false },
    thursday: { open: '09:00', close: '21:00', is_closed: false },
    friday: { open: '15:00', close: '21:00', is_closed: false },
  };

  // Header row
  const header = document.createElement('div');
  header.className = 'shop-status-toggle__header';

  const title = document.createElement('h4');
  title.className = 'shop-status-toggle__title';
  title.textContent = t('shop_status.title');

  const indicator = document.createElement('span');
  indicator.className = 'badge badge--sm';
  updateIndicator(indicator, currentMode, businessHours);

  header.append(title, indicator);
  container.append(header);

  if (editable) {
    // Mode Buttons: OPEN / CLOSED / AUTO
    const modesWrap = document.createElement('div');
    modesWrap.className = 'shop-status-toggle__modes';

    const modes = [
      { key: 'OPEN', label: t('shop_status.open'), icon: '🟢' },
      { key: 'CLOSED', label: t('shop_status.closed'), icon: '🔴' },
      { key: 'AUTO', label: t('shop_status.auto'), icon: '⏰' },
    ];

    const modeButtons = {};

    modes.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `shop-status-toggle__mode-btn ${currentMode === m.key ? 'shop-status-toggle__mode-btn--active' : ''}`;
      btn.innerHTML = `<span>${m.icon}</span> <span>${m.label}</span>`;

      btn.addEventListener('click', () => {
        currentMode = m.key;
        Object.values(modeButtons).forEach((b) => b.classList.remove('shop-status-toggle__mode-btn--active'));
        btn.classList.add('shop-status-toggle__mode-btn--active');
        updateIndicator(indicator, currentMode, businessHours);
        if (onChange) onChange({ physicalOpenStatus: currentMode, businessHours });
      });

      modeButtons[m.key] = btn;
      modesWrap.append(btn);
    });

    container.append(modesWrap);

    // Business hours config trigger
    const hoursLink = document.createElement('button');
    hoursLink.type = 'button';
    hoursLink.className = 'shop-status-toggle__schedule-link';
    hoursLink.textContent = `⚙️ ${t('shop_status.configure_hours')}`;

    hoursLink.addEventListener('click', () => {
      openHoursModal(businessHours, (updatedHours) => {
        businessHours = updatedHours;
        updateIndicator(indicator, currentMode, businessHours);
        if (onChange) onChange({ physicalOpenStatus: currentMode, businessHours });
      });
    });

    container.append(hoursLink);
  }

  return container;
}

function updateIndicator(badgeEl, mode, hours) {
  if (mode === 'OPEN') {
    badgeEl.textContent = '🟢 ' + t('shop_status.open_now');
    badgeEl.className = 'badge badge--success badge--sm';
  } else if (mode === 'CLOSED') {
    badgeEl.textContent = '🔴 ' + t('shop_status.closed_now');
    badgeEl.className = 'badge badge--danger badge--sm';
  } else {
    // AUTO evaluation
    const isOpen = evaluateAutoStatus(hours);
    badgeEl.textContent = isOpen ? '🟢 ' + t('shop_status.auto_open') : '🔴 ' + t('shop_status.auto_closed');
    badgeEl.className = isOpen ? 'badge badge--success badge--sm' : 'badge badge--muted badge--sm';
  }
}

function evaluateAutoStatus(hours) {
  if (!hours) return false;
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const bdTime = new Date(utc + 6 * 3600000);

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[bdTime.getDay()];
  const currentMinutes = bdTime.getHours() * 60 + bdTime.getMinutes();

  const schedule = hours[dayName];
  if (!schedule || schedule.is_closed) return false;

  const [openH, openM] = (schedule.open || '09:00').split(':').map(Number);
  const [closeH, closeM] = (schedule.close || '21:00').split(':').map(Number);

  return currentMinutes >= (openH * 60 + openM) && currentMinutes <= (closeH * 60 + closeM);
}

function openHoursModal(currentHours, onSave) {
  const content = document.createElement('div');
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.gap = 'var(--space-3)';

  const tempHours = JSON.parse(JSON.stringify(currentHours));

  DAYS_OF_WEEK.forEach((day) => {
    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '110px 100px 100px 80px';
    row.style.gap = 'var(--space-2)';
    row.style.alignItems = 'center';
    row.style.padding = 'var(--space-2) 0';
    row.style.borderBottom = '1px solid var(--border-subtle)';

    const dayLabel = document.createElement('span');
    dayLabel.style.fontWeight = 'var(--weight-semibold)';
    dayLabel.style.fontSize = 'var(--text-xs)';
    dayLabel.textContent = t(`days.${day}`) || day.toUpperCase();

    const openInput = document.createElement('input');
    openInput.type = 'time';
    openInput.value = tempHours[day]?.open || '09:00';
    openInput.disabled = !!tempHours[day]?.is_closed;
    openInput.style.padding = 'var(--space-1) var(--space-2)';
    openInput.style.border = '1px solid var(--border-default)';
    openInput.style.borderRadius = 'var(--radius-sm)';
    openInput.addEventListener('change', (e) => {
      if (!tempHours[day]) tempHours[day] = {};
      tempHours[day].open = e.target.value;
    });

    const closeInput = document.createElement('input');
    closeInput.type = 'time';
    closeInput.value = tempHours[day]?.close || '21:00';
    closeInput.disabled = !!tempHours[day]?.is_closed;
    closeInput.style.padding = 'var(--space-1) var(--space-2)';
    closeInput.style.border = '1px solid var(--border-default)';
    closeInput.style.borderRadius = 'var(--radius-sm)';
    closeInput.addEventListener('change', (e) => {
      if (!tempHours[day]) tempHours[day] = {};
      tempHours[day].close = e.target.value;
    });

    const closedCheckbox = Checkbox({
      label: t('shop_status.off_day'),
      checked: !!tempHours[day]?.is_closed,
      onChange: (isChecked) => {
        if (!tempHours[day]) tempHours[day] = {};
        tempHours[day].is_closed = isChecked;
        openInput.disabled = isChecked;
        closeInput.disabled = isChecked;
      },
    });

    row.append(dayLabel, openInput, closeInput, closedCheckbox);
    content.append(row);
  });

  const modal = Modal({
    title: t('shop_status.business_hours_schedule'),
    content,
    primaryAction: {
      label: t('common.save'),
      onClick: () => {
        onSave(tempHours);
        modal.close();
      },
    },
    secondaryAction: {
      label: t('common.cancel'),
      onClick: () => modal.close(),
    },
  });

  modal.open();
}
