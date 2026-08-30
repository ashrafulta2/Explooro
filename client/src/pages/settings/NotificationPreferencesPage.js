/**
 * NotificationPreferencesPage.js — User Notification & Channel Preferences (Prompt 8.2 §6).
 *
 * Per-category, per-channel opt-in/out plus a quiet-hours window, saved in one PUT.
 *
 * Route: /account/settings (aliases: /account/settings/notifications, /settings/notifications)
 */

import { Switch } from '../../components/ui/Switch.js';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { api } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { bindBackControl } from '../../core/navBack.js';

// WHY the channel list is data, not markup: every category renders the same four toggles, and a
// fifth channel (WhatsApp, Prompt 8.3) should be one row here rather than four edits per card.
const CHANNELS = [
  { key: 'inapp_enabled', i18n: 'notifications.channel_inapp', fallback: 'In-App' },
  { key: 'sms_enabled', i18n: 'notifications.channel_sms', fallback: 'SMS' },
  { key: 'push_enabled', i18n: 'notifications.channel_push', fallback: 'Push' },
  { key: 'email_enabled', i18n: 'notifications.channel_email', fallback: 'Email' },
];

const CATEGORIES = [
  {
    key: 'ORDER',
    icon: '📦',
    i18n: 'notifications.cat_order',
    fallbackTitle: 'Order Updates',
    fallbackDesc: 'Order placed, status changes, delivery tracking.',
  },
  {
    key: 'FINANCE',
    icon: '💰',
    i18n: 'notifications.cat_finance',
    fallbackTitle: 'Wallet & Payouts',
    fallbackDesc: 'Escrow releases, earnings, and payout disbursements.',
  },
  {
    key: 'SECURITY',
    icon: '🔒',
    i18n: 'notifications.cat_security',
    fallbackTitle: 'Security & Login',
    fallbackDesc: 'Password resets, OTP codes, and login alerts.',
  },
  {
    key: 'MARKETING',
    icon: '🎁',
    i18n: 'notifications.cat_marketing',
    fallbackTitle: 'Promotions & Discounts',
    fallbackDesc: 'Flash sales, campaign bonuses, and special offers.',
  },
  {
    key: 'SYSTEM',
    icon: '⚙️',
    i18n: 'notifications.cat_system',
    fallbackTitle: 'System & Policy',
    fallbackDesc: 'Terms updates, maintenance notices, and compliance.',
  },
];

// §8.2 requirement 2: a critical notification overrides preferences, so the server refuses to
// store a SECURITY opt-out. The UI has to say so rather than offer a toggle that silently no-ops.
const LOCKED_CATEGORIES = new Set(['SECURITY']);

const defaultPref = (category) => ({
  category,
  inapp_enabled: true,
  sms_enabled: true,
  push_enabled: true,
  email_enabled: true,
  quiet_hours_start: null,
  quiet_hours_end: null,
});

export default function NotificationPreferencesPage(root, { navigate } = {}) {
  const nav = (url, opts = {}) => {
    if (typeof navigate === 'function') navigate(url, opts);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  /** category -> preference row. Mutated in place by the toggles, read by Save. */
  const prefs = new Map();

  const container = document.createElement('div');
  container.className = 'notif-prefs-page';

  const header = document.createElement('div');
  header.className = 'notif-prefs-page__header';
  header.innerHTML = `
    <a href="/account" class="notif-prefs-page__back">
      ← ${t('common.back', 'Back')} · ${t('nav.shared.settings', 'Settings')}
    </a>
    <div class="notif-prefs-page__badge">🔔 ${t('notifications.pref_badge', 'Preference Centre')}</div>
    <h1 class="notif-prefs-page__title">${t('notifications.pref_page_title', 'Notification Preferences')}</h1>
    <p class="notif-prefs-page__subtitle">
      ${t('notifications.pref_page_subtitle', 'Manage channels and quiet hours across notification categories.')}
    </p>
  `;
  container.append(header);
  bindBackControl(header.querySelector('.notif-prefs-page__back'), nav, '/account');

  const grid = document.createElement('div');
  grid.className = 'notif-prefs-grid';
  container.append(grid);

  const actionsBar = document.createElement('div');
  actionsBar.className = 'notif-prefs-actions';
  container.append(actionsBar);

  const saveBtn = Button({
    label: t('notifications.btn_save_preferences', 'Save Notification Preferences'),
    variant: 'primary',
    size: 'md',
    onClick: savePreferences,
  });
  actionsBar.append(saveBtn);
  actionsBar.hidden = true;

  function showSkeleton() {
    grid.replaceChildren();
    for (let i = 0; i < CATEGORIES.length; i += 1) {
      const shell = document.createElement('div');
      shell.className = 'notif-prefs-card notif-prefs-card--loading';
      shell.append(Skeleton({ variant: 'text', lines: 2 }), Skeleton({ variant: 'block', height: 72 }));
      grid.append(shell);
    }
  }

  function showError(message, onRetry) {
    grid.replaceChildren();
    actionsBar.hidden = true;
    const box = document.createElement('div');
    box.className = 'notif-prefs-error';
    box.setAttribute('role', 'alert');
    const text = document.createElement('p');
    text.textContent = message;
    box.append(text);
    box.append(
      Button({
        label: t('common.retry', 'Retry'),
        variant: 'secondary',
        size: 'sm',
        onClick: onRetry,
      })
    );
    grid.append(box);
  }

  /** Builds the body node for one category card. Card `append`s this — a string would be escaped. */
  function buildCardBody(cat, pref) {
    const locked = LOCKED_CATEGORIES.has(cat.key);
    const body = document.createElement('div');
    body.className = 'notif-prefs-card__body';

    const channelRow = document.createElement('div');
    channelRow.className = 'notif-prefs-channels';

    CHANNELS.forEach((channel) => {
      const cell = document.createElement('div');
      cell.className = 'notif-prefs-channel';
      cell.append(
        Switch({
          label: t(channel.i18n, channel.fallback),
          checked: pref[channel.key] !== false,
          disabled: locked,
          onChange: (checked) => {
            pref[channel.key] = checked;
          },
        })
      );
      channelRow.append(cell);
    });

    body.append(channelRow);

    if (locked) {
      const note = document.createElement('p');
      note.className = 'notif-prefs-locked-note';
      note.textContent = t(
        'notifications.locked_note',
        'Security alerts are always delivered on every channel and cannot be turned off.'
      );
      body.append(note);
      return body;
    }

    const quiet = document.createElement('div');
    quiet.className = 'notif-prefs-quiet';
    quiet.innerHTML = `
      <span class="notif-prefs-quiet__label">
        🌙 ${t('notifications.quiet_hours', 'Quiet hours')}
      </span>
    `;

    const startInput = document.createElement('input');
    startInput.type = 'time';
    startInput.className = 'input notif-prefs-quiet__input';
    startInput.value = pref.quiet_hours_start || '';
    startInput.setAttribute(
      'aria-label',
      `${t('notifications.quiet_hours_from', 'Quiet hours from')} — ${t(`${cat.i18n}_title`, cat.fallbackTitle)}`
    );

    const endInput = document.createElement('input');
    endInput.type = 'time';
    endInput.className = 'input notif-prefs-quiet__input';
    endInput.value = pref.quiet_hours_end || '';
    endInput.setAttribute(
      'aria-label',
      `${t('notifications.quiet_hours_to', 'Quiet hours until')} — ${t(`${cat.i18n}_title`, cat.fallbackTitle)}`
    );

    startInput.addEventListener('change', () => {
      pref.quiet_hours_start = startInput.value || null;
    });
    endInput.addEventListener('change', () => {
      pref.quiet_hours_end = endInput.value || null;
    });

    const sep = document.createElement('span');
    sep.className = 'notif-prefs-quiet__sep';
    sep.textContent = t('notifications.quiet_hours_to_short', 'to');

    quiet.append(startInput, sep, endInput);
    body.append(quiet);
    return body;
  }

  function renderGrid() {
    grid.replaceChildren();

    CATEGORIES.forEach((cat) => {
      const pref = prefs.get(cat.key);
      const card = Card({
        title: `${cat.icon}  ${t(`${cat.i18n}_title`, cat.fallbackTitle)}`,
        subtitle: t(`${cat.i18n}_desc`, cat.fallbackDesc),
        body: buildCardBody(cat, pref),
      });
      card.classList.add('notif-prefs-card');
      if (LOCKED_CATEGORIES.has(cat.key)) card.classList.add('notif-prefs-card--locked');
      grid.append(card);
    });

    actionsBar.hidden = false;
  }

  async function loadPreferences() {
    showSkeleton();
    try {
      const res = await api.get('/notifications/preferences');
      const rows = Array.isArray(res?.data) ? res.data : [];

      prefs.clear();
      CATEGORIES.forEach((cat) => {
        const row = rows.find((r) => r.category === cat.key);
        prefs.set(cat.key, { ...defaultPref(cat.key), ...(row || {}) });
      });

      renderGrid();
    } catch (err) {
      showError(err.message || String(err), loadPreferences);
    }
  }

  async function savePreferences() {
    // setLoading already makes the button inert (Button syncs disabled from both flags), so
    // touching `.disabled` directly here would just fight that sync point.
    saveBtn.setLoading(true);
    try {
      const preferences = CATEGORIES.filter((cat) => !LOCKED_CATEGORIES.has(cat.key)).map((cat) => {
        const p = prefs.get(cat.key);
        return {
          category: cat.key,
          inapp_enabled: p.inapp_enabled !== false,
          sms_enabled: p.sms_enabled !== false,
          push_enabled: p.push_enabled !== false,
          email_enabled: p.email_enabled !== false,
          quiet_hours_start: p.quiet_hours_start || undefined,
          quiet_hours_end: p.quiet_hours_end || undefined,
        };
      });

      await api.put('/notifications/preferences', { preferences });
      toast.success(t('notifications.pref_saved_success', 'Notification preferences updated successfully.'));
    } catch (err) {
      toast.error(err.message || String(err));
    } finally {
      saveBtn.setLoading(false);
    }
  }

  root.append(container);
  loadPreferences();
}
