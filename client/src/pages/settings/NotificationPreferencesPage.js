/**
 * NotificationPreferencesPage.js — User Notification & Channel Preferences (Prompt 8.2).
 */

import { Switch } from '../../components/ui/Switch.js';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { api } from '../../core/api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

export default function NotificationPreferencesPage() {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'page-container notification-preferences-page';

  container.innerHTML = `
    <div class="page-header">
      <h2>${t('notifications.pref_page_title') || 'Notification Preferences'}</h2>
      <p class="page-subtitle">${t('notifications.pref_page_subtitle') || 'Manage channels and quiet hours across notification categories.'}</p>
    </div>
    <div class="preferences-grid" id="pref-grid">
      <div class="loading-spinner">Loading preferences...</div>
    </div>
  `;

  const categories = [
    { key: 'ORDER', title: 'Order Updates', desc: 'Order placed, status changes, delivery tracking' },
    { key: 'FINANCE', title: 'Wallet & Payouts', desc: 'Escrow releases, earnings, and payout disbursements' },
    { key: 'SECURITY', title: 'Security & Login', desc: 'Password resets, 2FA codes, login alerts (Always Enabled)' },
    { key: 'MARKETING', title: 'Promotions & Discounts', desc: 'Flash sales, campaign bonuses, and special offers' },
    { key: 'SYSTEM', title: 'System & Policy', desc: 'Terms updates, maintenance notices, and compliance' },
  ];

  let currentPrefs = {};

  async function loadPreferences() {
    const grid = container.querySelector('#pref-grid');
    try {
      const res = await api.get('/api/v1/notifications/preferences');
      const items = res?.data || [];
      items.forEach((p) => {
        currentPrefs[p.category] = p;
      });

      renderGrid();
    } catch (err) {
      grid.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  }

  function renderGrid() {
    const grid = container.querySelector('#pref-grid');
    grid.innerHTML = '';

    categories.forEach((cat) => {
      const userPref = currentPrefs[cat.key] || {
        inapp_enabled: true,
        sms_enabled: true,
        push_enabled: true,
        email_enabled: true,
      };

      const isSecurity = cat.key === 'SECURITY';

      const card = Card({
        title: cat.title,
        subtitle: cat.desc,
        content: `
          <div class="pref-channels-row" id="pref-cat-${cat.key}">
            <div class="pref-channel-item">
              <span>In-App</span>
              <div id="switch-inapp-${cat.key}"></div>
            </div>
            <div class="pref-channel-item">
              <span>SMS</span>
              <div id="switch-sms-${cat.key}"></div>
            </div>
            <div class="pref-channel-item">
              <span>Push</span>
              <div id="switch-push-${cat.key}"></div>
            </div>
            <div class="pref-channel-item">
              <span>Email</span>
              <div id="switch-email-${cat.key}"></div>
            </div>
          </div>
        `,
      });

      grid.appendChild(card);

      // Mount switches
      const inappSwitch = Switch({
        checked: userPref.inapp_enabled !== false,
        disabled: isSecurity,
        onChange: (checked) => {
          userPref.inapp_enabled = checked;
        },
      });
      card.querySelector(`#switch-inapp-${cat.key}`).appendChild(inappSwitch);

      const smsSwitch = Switch({
        checked: userPref.sms_enabled !== false,
        disabled: isSecurity,
        onChange: (checked) => {
          userPref.sms_enabled = checked;
        },
      });
      card.querySelector(`#switch-sms-${cat.key}`).appendChild(smsSwitch);

      const pushSwitch = Switch({
        checked: userPref.push_enabled !== false,
        disabled: isSecurity,
        onChange: (checked) => {
          userPref.push_enabled = checked;
        },
      });
      card.querySelector(`#switch-push-${cat.key}`).appendChild(pushSwitch);

      const emailSwitch = Switch({
        checked: userPref.email_enabled !== false,
        disabled: isSecurity,
        onChange: (checked) => {
          userPref.email_enabled = checked;
        },
      });
      card.querySelector(`#switch-email-${cat.key}`).appendChild(emailSwitch);

      currentPrefs[cat.key] = userPref;
    });

    // Save Button
    const actionsBar = document.createElement('div');
    actionsBar.className = 'pref-actions-bar';
    const saveBtn = Button({
      label: t('notifications.btn_save_preferences') || 'Save Notification Preferences',
      variant: 'primary',
      onClick: async () => {
        try {
          const payload = Object.entries(currentPrefs).map(([category, p]) => ({
            category,
            inapp_enabled: p.inapp_enabled,
            sms_enabled: p.sms_enabled,
            push_enabled: p.push_enabled,
            email_enabled: p.email_enabled,
          }));

          await api.put('/api/v1/notifications/preferences', { preferences: payload });
          toast.success(t('notifications.pref_saved_success') || 'Preferences saved successfully.');
        } catch (err) {
          toast.error(err.message);
        }
      },
    });
    actionsBar.appendChild(saveBtn);
    grid.appendChild(actionsBar);
  }

  loadPreferences();
  return container;
}
