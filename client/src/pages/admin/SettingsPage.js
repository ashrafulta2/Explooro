/**
 * SettingsPage.js — Super Admin Platform Governance & Global Master Settings Engine.
 *
 * Implements /admin/platform/settings & /admin/settings:
 * 1. General & regional configuration (Platform name, support contacts, base currency, timezone).
 * 2. Escrow & settlement rules (Holding periods, auto-sweep schedule, dispute freezes).
 * 3. Vault & payout governance (Min/max payout thresholds, fee coverage, cutoff windows).
 * 4. Marketplace commission guardrails (Baseline take rate, seller margin floor, free listing quotas).
 * 5. Security & staff access policies (Mandatory 2FA enforcement, inactivity timeouts, login lockouts).
 * 6. Emergency killswitches (Live platform maintenance mode & read-only mutation freeze).
 * 7. Change justification audit log drawer tracking historical revisions.
 * 8. Shared PlatformSubnav interconnecting all 5 platform governance surfaces.
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Modal } from '../../components/ui/Modal.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog.js';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.js';
import { adminApi } from '../../services/admin.api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate } from '../../services/format.js';

export default function SettingsPage(root, { navigate } = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page settings-page';

  let settingsData = null;
  let historyData = [];
  let isLoading = true;
  let isSaving = false;
  let hasUnsavedChanges = false;
  let formState = {};

  // Drawer state
  let showHistoryDrawer = false;

  async function loadData() {
    isLoading = true;
    render();
    try {
      const res = await adminApi.getPlatformSettings();
      settingsData = res?.settings || {};
      historyData = res?.history || [];
      formState = { ...settingsData };
      hasUnsavedChanges = false;
    } catch (err) {
      toast.error(err?.message || 'Failed to load platform settings');
      settingsData = {};
      formState = {};
    } finally {
      isLoading = false;
      render();
    }
  }

  function handleFieldChange(key, value) {
    formState[key] = value;
    hasUnsavedChanges = true;
    updateSaveButtonState();
  }

  function updateSaveButtonState() {
    const saveBtn = container.querySelector('#save-settings-btn');
    if (saveBtn) {
      saveBtn.disabled = !hasUnsavedChanges || isSaving;
      if (hasUnsavedChanges) {
        saveBtn.classList.add('pulse');
      } else {
        saveBtn.classList.remove('pulse');
      }
    }
  }

  async function handleResetDefaults() {
    const confirmed = await confirmDialog({
      title: t('platform_settings.btn_reset_defaults', 'Reset to Defaults'),
      message: isBn
        ? 'আপনি কি নিশ্চিতভাবে সমস্ত প্ল্যাটফর্ম সেটিংস সিস্টেমের প্রাথমিক ফ্যাক্টরি মানে রিসেট করতে চান?'
        : 'Are you sure you want to reset all global platform governance parameters to factory baseline?',
      confirmLabel: isBn ? 'রিসেট করুন' : 'Reset Defaults',
      variant: 'danger',
    });

    if (!confirmed) return;

    try {
      const res = await adminApi.resetPlatformSettings('Manual administrative reset to system baseline');
      settingsData = res?.settings || {};
      formState = { ...settingsData };
      hasUnsavedChanges = false;
      toast.success(t('platform_settings.toast_reset', 'Platform settings reset to system baseline.'));
      render();
    } catch (err) {
      toast.error(err?.message || 'Failed to reset settings');
    }
  }

  function openSaveConfirmModal() {
    const modalContent = document.createElement('div');
    modalContent.className = 'space-y-4';

    modalContent.innerHTML = `
      <p class="text-xs text-secondary leading-relaxed">
        ${t('platform_settings.modal_save_desc', 'Applying changes to global platform parameters alters core escrow, payout, and security behaviors across all accounts.')}
      </p>

      <div class="form-group">
        <label class="form-label font-semibold">
          ${t('platform_settings.modal_save_reason_label', 'Change Reason / Compliance Justification')}
        </label>
        <textarea
          id="save-audit-reason"
          class="input w-full"
          rows="3"
          placeholder="${isBn ? 'এই পরিবর্তনের সুনির্দিষ্ট কারণ বা নীতি উল্লেখ করুন...' : 'e.g. Approved quarterly policy update for Q4 micro-merchant incentives'}"
        ></textarea>
      </div>

      <div class="flex justify-end gap-2 pt-3 border-t">
        <button type="button" class="btn btn--secondary btn--sm cancel-save-btn">
          ${t('common.cancel', 'Cancel')}
        </button>
        <button type="button" class="btn btn--primary btn--sm confirm-save-btn">
          ${isBn ? 'প্রয়োগ ও সংরক্ষণ করুন' : 'Confirm & Deploy Changes'}
        </button>
      </div>
    `;

    const modal = Modal({
      title: t('platform_settings.modal_save_title', 'Confirm Platform Settings Revision'),
      content: modalContent,
    });

    modalContent.querySelector('.cancel-save-btn')?.addEventListener('click', () => modal.close());

    modalContent.querySelector('.confirm-save-btn')?.addEventListener('click', async () => {
      const reason = modalContent.querySelector('#save-audit-reason')?.value.trim();
      modal.close();
      await executeSave(reason);
    });
  }

  async function executeSave(reason) {
    isSaving = true;
    render();
    try {
      const res = await adminApi.updatePlatformSettings(formState, reason || 'Administrative settings update');
      settingsData = res?.settings || formState;
      formState = { ...settingsData };
      hasUnsavedChanges = false;
      toast.success(t('platform_settings.toast_saved', 'Platform settings saved and deployed.'));
    } catch (err) {
      toast.error(err?.message || 'Failed to save platform settings');
    } finally {
      isSaving = false;
      render();
    }
  }

  function render() {
    container.innerHTML = '';

    // 1. Page Header
    const header = document.createElement('header');
    header.className = 'admin-page-header';

    const infoCol = document.createElement('div');
    infoCol.innerHTML = `
      <div class="admin-page-eyebrow">
        ${Badge({ label: t('platform_settings.badge_governance', 'GLOBAL GOVERNANCE'), variant: 'primary' })}
        <span class="text-xs text-secondary font-mono">Policy Cluster: BD-CORE</span>
      </div>
      <h1 class="admin-page-title">${t('platform_settings.title', 'Platform Governance & Global Settings')}</h1>
      <p class="admin-page-subtitle">
        ${t('platform_settings.subtitle', 'Master configuration engine governing escrow settlement rules, payout thresholds, commission guardrails, and emergency killswitches')}
      </p>
    `;

    const actionsCol = document.createElement('div');
    actionsCol.className = 'admin-page-actions';

    const historyBtn = Button({
      label: `📜 ${t('platform_settings.btn_history', 'Settings Change Audit')}`,
      variant: 'secondary',
      onClick: () => {
        showHistoryDrawer = true;
        render();
      },
    });

    const resetBtn = Button({
      label: `↩️ ${t('platform_settings.btn_reset_defaults', 'Reset to Defaults')}`,
      variant: 'secondary',
      onClick: handleResetDefaults,
    });

    const saveBtn = Button({
      id: 'save-settings-btn',
      label: `💾 ${t('platform_settings.btn_save_changes', 'Save Platform Settings')}`,
      variant: 'primary',
      disabled: !hasUnsavedChanges || isSaving,
      onClick: openSaveConfirmModal,
    });

    actionsCol.append(historyBtn, resetBtn, saveBtn);
    header.append(infoCol, actionsCol);
    container.append(header);

    // 2. Shared Platform Subnav
    container.append(PlatformSubnav({ activeKey: 'settings', navigate }));

    if (isLoading) {
      const loader = document.createElement('div');
      loader.className = 'card p-8 text-center text-secondary';
      loader.innerHTML = `<div class="spinner"></div><p class="mt-2">${t('common.loading', 'Loading')}...</p>`;
      container.append(loader);
      root.replaceChildren(container);
      return;
    }

    // 3. Emergency Status Banner (if maintenance or read-only is active)
    if (formState.maintenance_mode || formState.read_only_mode) {
      const banner = document.createElement('div');
      banner.className = 'p-4 rounded-xl border border-warning bg-warning-soft flex items-center justify-between gap-4';
      banner.innerHTML = `
        <div class="flex items-center gap-3">
          <span class="text-2xl">⚠️</span>
          <div>
            <span class="font-bold text-sm block">
              ${formState.maintenance_mode ? 'Platform Maintenance Mode is ACTIVE' : 'Platform Read-Only Mode is ACTIVE'}
            </span>
            <span class="text-xs text-secondary">
              ${formState.maintenance_mode ? 'Customer storefronts and checkouts are paused with maintenance announcement.' : 'Data mutations and catalog updates are frozen.'}
            </span>
          </div>
        </div>
        <span class="badge badge-warning text-xs font-mono">EMERGENCY KILLSWITCH</span>
      `;
      container.append(banner);
    }

    // 4. Form Layout: 6 Structured Section Cards
    const formGrid = document.createElement('div');
    formGrid.className = 'space-y-6';

    // SECTION 1: General & Regional
    const sec1 = document.createElement('div');
    sec1.className = 'settings-section-card';
    sec1.innerHTML = `
      <div class="settings-section-card__header">
        <div>
          <h2 class="settings-section-title">🏢 ${t('platform_settings.sec_general', 'General & Regional Parameters')}</h2>
          <p class="settings-section-desc">Marketplace brand identity, customer support hotlines, currency, and locale defaults.</p>
        </div>
        ${Badge({ label: 'Core Info', variant: 'neutral' })}
      </div>
      <div class="settings-fields-grid">
        <div class="settings-field">
          <label class="settings-field__label" for="set-platform-name">${t('platform_settings.field_platform_name', 'Platform Name')}</label>
          <input type="text" class="input input--sm" id="set-platform-name" value="${formState.platform_name || ''}" />
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-support-email">${t('platform_settings.field_support_email', 'Official Support Email')}</label>
          <input type="email" class="input input--sm" id="set-support-email" value="${formState.support_email || ''}" />
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-support-phone">${t('platform_settings.field_support_phone', 'Support Hotline Number')}</label>
          <input type="text" class="input input--sm" id="set-support-phone" value="${formState.support_phone || ''}" />
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-default-currency">${t('platform_settings.field_default_currency', 'Base Platform Currency')}</label>
          <input type="text" class="input input--sm font-mono" id="set-default-currency" value="${formState.default_currency || 'BDT'} (৳)" readonly />
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-default-lang">${t('platform_settings.field_default_lang', 'Default Portal Language')}</label>
          <select class="input input--sm" id="set-default-lang">
            <option value="bn" ${formState.default_language === 'bn' ? 'selected' : ''}>বাংলা (Bengali - Default)</option>
            <option value="en" ${formState.default_language === 'en' ? 'selected' : ''}>English (EN)</option>
          </select>
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-timezone">${t('platform_settings.field_timezone', 'Operational Timezone')}</label>
          <input type="text" class="input input--sm font-mono" id="set-timezone" value="${formState.timezone || 'Asia/Dhaka'}" readonly />
        </div>
      </div>
    `;

    // SECTION 2: Escrow & Settlement Governance
    const sec2 = document.createElement('div');
    sec2.className = 'settings-section-card';
    sec2.innerHTML = `
      <div class="settings-section-card__header">
        <div>
          <h2 class="settings-section-title">⏳ ${t('platform_settings.sec_escrow', 'Escrow & Settlement Governance')}</h2>
          <p class="settings-section-desc">Safety escrow holding rules protecting buyer deliveries and B2B wholesale milestones.</p>
        </div>
        ${Badge({ label: 'CRITICAL AUDITED', variant: 'danger' })}
      </div>
      <div class="settings-fields-grid">
        <div class="settings-field">
          <label class="settings-field__label" for="set-escrow-days">${t('platform_settings.field_escrow_period_days', 'Customer Escrow Holding Period (Days)')}</label>
          <input type="number" min="1" max="30" class="input input--sm font-mono" id="set-escrow-days" value="${formState.escrow_period_days || 7}" />
          <span class="settings-field__helper">Days after verified courier delivery before earner wallet credit.</span>
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-b2b-escrow-days">${t('platform_settings.field_b2b_escrow_days', 'B2B Milestone Escrow Holding Period (Days)')}</label>
          <input type="number" min="1" max="60" class="input input--sm font-mono" id="set-b2b-escrow-days" value="${formState.b2b_escrow_days || 14}" />
          <span class="settings-field__helper">Holding window for manufacturer batch procurement contracts.</span>
        </div>
        <div class="settings-field--full">
          <div class="settings-toggle-row">
            <div class="settings-toggle-info">
              <label class="settings-toggle-title" for="set-auto-sweep">${t('platform_settings.field_auto_sweep', 'Automated Daily Escrow Sweep')}</label>
              <span class="settings-toggle-desc">Automatically executes scheduled midnight cron job to mature eligible escrow entries.</span>
            </div>
            <input type="checkbox" id="set-auto-sweep" ${formState.auto_sweep_enabled ? 'checked' : ''} />
          </div>
        </div>
        <div class="settings-field--full">
          <div class="settings-toggle-row">
            <div class="settings-toggle-info">
              <label class="settings-toggle-title" for="set-dispute-freeze">${t('platform_settings.field_dispute_freeze', 'Auto-Freeze Escrow on Active Buyer Dispute')}</label>
              <span class="settings-toggle-desc">Instantly locks payout disbursement if a customer raises a formal return or damage claim.</span>
            </div>
            <input type="checkbox" id="set-dispute-freeze" ${formState.dispute_auto_freeze ? 'checked' : ''} />
          </div>
        </div>
      </div>
    `;

    // SECTION 3: Vault & Payout Thresholds
    const sec3 = document.createElement('div');
    sec3.className = 'settings-section-card';
    sec3.innerHTML = `
      <div class="settings-section-card__header">
        <div>
          <h2 class="settings-section-title">💸 ${t('platform_settings.sec_payout', 'Vault & Payout Thresholds')}</h2>
          <p class="settings-section-desc">Earner withdrawal minimums, maximum batch caps, and cutoff windows for bKash/Nagad/Bank.</p>
        </div>
        ${Badge({ label: 'Vault Policy', variant: 'warning' })}
      </div>
      <div class="settings-fields-grid">
        <div class="settings-field">
          <label class="settings-field__label" for="set-min-saler-payout">${t('platform_settings.field_min_saler_payout', 'Minimum Saler Payout Threshold (৳)')}</label>
          <input type="number" min="100" step="50" class="input input--sm font-mono" id="set-min-saler-payout" value="${formState.min_saler_payout_bdt || 500}" />
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-min-sup-payout">${t('platform_settings.field_min_supplier_payout', 'Minimum Supplier Payout Threshold (৳)')}</label>
          <input type="number" min="500" step="100" class="input input--sm font-mono" id="set-min-sup-payout" value="${formState.min_supplier_payout_bdt || 1000}" />
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-max-payout">${t('platform_settings.field_max_payout', 'Maximum Single Payout Cap (৳)')}</label>
          <input type="number" min="5000" step="5000" class="input input--sm font-mono" id="set-max-payout" value="${formState.max_single_payout_bdt || 100000}" />
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-cutoff-time">${t('platform_settings.field_cutoff_time', 'Daily Payout Batch Cutoff Time')}</label>
          <input type="time" class="input input--sm font-mono" id="set-cutoff-time" value="${formState.payout_cutoff_time || '17:00'}" />
        </div>
        <div class="settings-field--full">
          <div class="settings-toggle-row">
            <div class="settings-toggle-info">
              <label class="settings-toggle-title" for="set-payout-fee">${t('platform_settings.field_payout_fee_covered', 'Platform Absorbs Payout Disbursement Fees')}</label>
              <span class="settings-toggle-desc">Platform covers 1.5% bKash/Nagad B2C merchant cash-out fee so earners receive 100% of requested amount.</span>
            </div>
            <input type="checkbox" id="set-payout-fee" ${formState.payout_fee_covered ? 'checked' : ''} />
          </div>
        </div>
      </div>
    `;

    // SECTION 4: Commission & Guardrails
    const sec4 = document.createElement('div');
    sec4.className = 'settings-section-card';
    sec4.innerHTML = `
      <div class="settings-section-card__header">
        <div>
          <h2 class="settings-section-title">🛍️ ${t('platform_settings.sec_commission', 'Commission & Margin Guardrails')}</h2>
          <p class="settings-section-desc">Baseline platform take rates and minimum merchant profit protections.</p>
        </div>
        ${Badge({ label: 'Margin Engine', variant: 'neutral' })}
      </div>
      <div class="settings-fields-grid">
        <div class="settings-field">
          <label class="settings-field__label" for="set-platform-take">${t('platform_settings.field_platform_take_pct', 'Baseline Platform Take Rate (%)')}</label>
          <input type="number" min="0" max="100" step="0.5" class="input input--sm font-mono" id="set-platform-take" value="${formState.platform_take_pct || 10.0}" />
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-min-seller-margin">${t('platform_settings.field_min_seller_margin', 'Minimum Seller Margin Floor (%)')}</label>
          <input type="number" min="1" max="50" step="0.5" class="input input--sm font-mono" id="set-min-seller-margin" value="${formState.min_seller_margin_pct || 5.0}" />
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-free-quota">${t('platform_settings.field_free_quota', 'Merchant Free Product Listing Quota')}</label>
          <input type="number" min="10" max="1000" step="10" class="input input--sm font-mono" id="set-free-quota" value="${formState.merchant_free_quota || 100}" />
        </div>
      </div>
    `;

    // SECTION 5: Security & Access Policies
    const sec5 = document.createElement('div');
    sec5.className = 'settings-section-card';
    sec5.innerHTML = `
      <div class="settings-section-card__header">
        <div>
          <h2 class="settings-section-title">🛡️ ${t('platform_settings.sec_security', 'Security & Staff Access Policies')}</h2>
          <p class="settings-section-desc">Administrative credential protection, 2FA mandates, and session security.</p>
        </div>
        ${Badge({ label: 'Security Core', variant: 'primary' })}
      </div>
      <div class="settings-fields-grid">
        <div class="settings-field--full">
          <div class="settings-toggle-row">
            <div class="settings-toggle-info">
              <label class="settings-toggle-title" for="set-staff-2fa">${t('platform_settings.field_staff_2fa_enforced', 'Mandatory Staff 2FA (Super Admin & Admin)')}</label>
              <span class="settings-toggle-desc">Blocks login without TOTP authenticator code verification for all administrative accounts.</span>
            </div>
            <input type="checkbox" id="set-staff-2fa" ${formState.staff_2fa_enforced ? 'checked' : ''} />
          </div>
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-session-timeout">${t('platform_settings.field_session_timeout', 'Session Inactivity Timeout (Minutes)')}</label>
          <input type="number" min="15" max="480" step="15" class="input input--sm font-mono" id="set-session-timeout" value="${formState.session_timeout_minutes || 60}" />
        </div>
        <div class="settings-field">
          <label class="settings-field__label" for="set-max-login-attempts">${t('platform_settings.field_max_login_attempts', 'Max Failed Password Attempts Before Lockout')}</label>
          <input type="number" min="3" max="10" class="input input--sm font-mono" id="set-max-login-attempts" value="${formState.max_login_attempts || 5}" />
        </div>
      </div>
    `;

    // SECTION 6: Emergency Controls & Maintenance Mode
    const sec6 = document.createElement('div');
    sec6.className = 'settings-section-card';
    sec6.style.border = '1px solid rgba(239, 68, 68, 0.4)';
    sec6.innerHTML = `
      <div class="settings-section-card__header">
        <div>
          <h2 class="settings-section-title text-danger">🚨 ${t('platform_settings.sec_emergency', 'Emergency Controls & Killswitches')}</h2>
          <p class="settings-section-desc">Emergency platform pause and database read-only mutation freeze.</p>
        </div>
        ${Badge({ label: 'KILLSWITCH', variant: 'danger' })}
      </div>
      <div class="settings-fields-grid">
        <div class="settings-field--full">
          <div class="settings-toggle-row">
            <div class="settings-toggle-info">
              <label class="settings-toggle-title text-danger" for="set-maintenance-mode">${t('platform_settings.field_maintenance_mode', 'Platform Maintenance Mode')}</label>
              <span class="settings-toggle-desc">Pauses customer shopping, cart, and order placement while displaying maintenance announcement banner.</span>
            </div>
            <input type="checkbox" id="set-maintenance-mode" ${formState.maintenance_mode ? 'checked' : ''} />
          </div>
        </div>
        <div class="settings-field--full">
          <div class="settings-toggle-row">
            <div class="settings-toggle-info">
              <label class="settings-toggle-title text-danger" for="set-read-only-mode">${t('platform_settings.field_read_only_mode', 'Read-Only Mode (Freeze Mutations)')}</label>
              <span class="settings-toggle-desc">Freezes all catalog creation, store edits, and payouts during major system upgrades.</span>
            </div>
            <input type="checkbox" id="set-read-only-mode" ${formState.read_only_mode ? 'checked' : ''} />
          </div>
        </div>
        <div class="settings-field--full">
          <label class="settings-field__label" for="set-maint-msg-en">${t('platform_settings.field_maintenance_msg_en', 'Maintenance Banner Message (English)')}</label>
          <input type="text" class="input input--sm w-full" id="set-maint-msg-en" value="${formState.maintenance_message_en || ''}" />
        </div>
        <div class="settings-field--full">
          <label class="settings-field__label" for="set-maint-msg-bn">${t('platform_settings.field_maintenance_msg_bn', 'Maintenance Banner Message (Bengali)')}</label>
          <input type="text" class="input input--sm w-full" id="set-maint-msg-bn" value="${formState.maintenance_message_bn || ''}" />
        </div>
      </div>
    `;

    formGrid.append(sec1, sec2, sec3, sec4, sec5, sec6);
    container.append(formGrid);

    // Bind Change Listeners for all inputs
    sec1.querySelector('#set-platform-name')?.addEventListener('input', (e) => handleFieldChange('platform_name', e.target.value));
    sec1.querySelector('#set-support-email')?.addEventListener('input', (e) => handleFieldChange('support_email', e.target.value));
    sec1.querySelector('#set-support-phone')?.addEventListener('input', (e) => handleFieldChange('support_phone', e.target.value));
    sec1.querySelector('#set-default-lang')?.addEventListener('change', (e) => handleFieldChange('default_language', e.target.value));

    sec2.querySelector('#set-escrow-days')?.addEventListener('input', (e) => handleFieldChange('escrow_period_days', parseInt(e.target.value || 7, 10)));
    sec2.querySelector('#set-b2b-escrow-days')?.addEventListener('input', (e) => handleFieldChange('b2b_escrow_days', parseInt(e.target.value || 14, 10)));
    sec2.querySelector('#set-auto-sweep')?.addEventListener('change', (e) => handleFieldChange('auto_sweep_enabled', e.target.checked));
    sec2.querySelector('#set-dispute-freeze')?.addEventListener('change', (e) => handleFieldChange('dispute_auto_freeze', e.target.checked));

    sec3.querySelector('#set-min-saler-payout')?.addEventListener('input', (e) => handleFieldChange('min_saler_payout_bdt', parseFloat(e.target.value || 500)));
    sec3.querySelector('#set-min-sup-payout')?.addEventListener('input', (e) => handleFieldChange('min_supplier_payout_bdt', parseFloat(e.target.value || 1000)));
    sec3.querySelector('#set-max-payout')?.addEventListener('input', (e) => handleFieldChange('max_single_payout_bdt', parseFloat(e.target.value || 100000)));
    sec3.querySelector('#set-cutoff-time')?.addEventListener('input', (e) => handleFieldChange('payout_cutoff_time', e.target.value));
    sec3.querySelector('#set-payout-fee')?.addEventListener('change', (e) => handleFieldChange('payout_fee_covered', e.target.checked));

    sec4.querySelector('#set-platform-take')?.addEventListener('input', (e) => handleFieldChange('platform_take_pct', parseFloat(e.target.value || 10.0)));
    sec4.querySelector('#set-min-seller-margin')?.addEventListener('input', (e) => handleFieldChange('min_seller_margin_pct', parseFloat(e.target.value || 5.0)));
    sec4.querySelector('#set-free-quota')?.addEventListener('input', (e) => handleFieldChange('merchant_free_quota', parseInt(e.target.value || 100, 10)));

    sec5.querySelector('#set-staff-2fa')?.addEventListener('change', (e) => handleFieldChange('staff_2fa_enforced', e.target.checked));
    sec5.querySelector('#set-session-timeout')?.addEventListener('input', (e) => handleFieldChange('session_timeout_minutes', parseInt(e.target.value || 60, 10)));
    sec5.querySelector('#set-max-login-attempts')?.addEventListener('input', (e) => handleFieldChange('max_login_attempts', parseInt(e.target.value || 5, 10)));

    sec6.querySelector('#set-maintenance-mode')?.addEventListener('change', (e) => handleFieldChange('maintenance_mode', e.target.checked));
    sec6.querySelector('#set-read-only-mode')?.addEventListener('change', (e) => handleFieldChange('read_only_mode', e.target.checked));
    sec6.querySelector('#set-maint-msg-en')?.addEventListener('input', (e) => handleFieldChange('maintenance_message_en', e.target.value));
    sec6.querySelector('#set-maint-msg-bn')?.addEventListener('input', (e) => handleFieldChange('maintenance_message_bn', e.target.value));

    // 5. Change History Drawer
    if (showHistoryDrawer) {
      renderHistoryDrawer();
    }

    root.replaceChildren(container);
  }

  function renderHistoryDrawer() {
    const drawerOverlay = document.createElement('div');
    drawerOverlay.className = 'modal-backdrop';

    const drawer = document.createElement('div');
    drawer.className = 'card max-w-2xl w-full p-5 max-h-[85vh] overflow-y-auto space-y-4';
    drawer.style.margin = 'auto';

    drawer.innerHTML = `
      <div class="flex-between border-b pb-3">
        <div>
          <h3 class="text-lg font-bold m-0">${t('platform_settings.audit_drawer_title', 'Platform Settings Modification History')}</h3>
          <p class="text-xs text-muted m-0">Immutable record of governance parameter changes</p>
        </div>
        <button class="btn btn--secondary btn--sm close-history-btn">✕</button>
      </div>

      <div class="space-y-3">
        ${historyData.map((item) => `
          <div class="p-3 border rounded-lg bg-surface-2 text-xs space-y-2">
            <div class="flex-between">
              <span class="font-bold text-primary">${item.actor}</span>
              <span class="text-muted font-mono text-xxs">${formatDate(item.timestamp)}</span>
            </div>
            <p class="text-secondary italic m-0">"${item.reason}"</p>
            <div class="space-y-1 pt-1 border-t">
              ${(item.changes || []).map((ch) => `
                <div class="flex items-center gap-2 font-mono text-xxs">
                  <span class="text-brand font-semibold">${ch.key}:</span>
                  <span class="line-through text-muted">${JSON.stringify(ch.old_value)}</span>
                  <span>→</span>
                  <span class="text-success font-semibold">${JSON.stringify(ch.new_value)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>

      <div class="flex justify-end pt-3 border-t">
        <button class="btn btn--secondary btn--sm close-history-btn">${t('common.close', 'Close')}</button>
      </div>
    `;

    drawer.querySelectorAll('.close-history-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        showHistoryDrawer = false;
        drawerOverlay.remove();
      });
    });

    drawerOverlay.append(drawer);
    document.body.append(drawerOverlay);
  }

  loadData();
  root.replaceChildren(container);
}
