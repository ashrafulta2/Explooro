/**
 * IntegrationsPage.ts — gateway credentials and pause switches (/admin/platform/integrations).
 *
 * Everything shown comes from the server (server/src/services/integration.service.ts, migration 108):
 *  - which driver each service runs (the .env switch: Live / Mock / Off),
 *  - where each credential comes from (saved here, encrypted · from .env · not set),
 *  - pause state (payments and couriers only) and the last Test Connection result.
 *
 * A saved secret never comes back to the browser: the page only ever sees its last four characters.
 * An empty box on save leaves a value as it is; "remove the saved value" falls back to .env.
 */

import { Button } from '../../components/ui/Button.ts';
import { Badge } from '../../components/ui/Badge.ts';
import { Modal } from '../../components/ui/Modal.ts';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.ts';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.ts';
import { adminApi } from '../../services/admin.api.ts';
import { toast } from '../../services/toast.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { formatNumber, formatDate } from '../../services/format.ts';
import { escapeHtml } from '../../services/html.ts';
import type { PageContext } from '../types.ts';

const REASON_MIN = 10;
const TYPE_ICON = { PAYMENTS: '💳', LOGISTICS: '🚚', MESSAGING: '💬' };

const tx = (key: string, fallback: string, vars: Record<string, unknown> = {}) =>
  Object.entries(vars).reduce(
    (s, [k, v]) => s.split(`{${k}}`).join(String(v)),
    t(`platform_integrations.${key}`, fallback)
  );

export default function IntegrationsPage(root: HTMLElement, { navigate }: PageContext = {}) {
  const isBn = getLanguage() === 'bn';
  const pick = (obj, base) => (isBn && obj?.[`${base}_bn`] ? obj[`${base}_bn`] : obj?.[`${base}_en`]) ?? '';
  const container = document.createElement('div');
  container.className = 'admin-page integrations-page';

  let data = null;
  let canManage = false;
  let isLoading = true;
  let activeCategory = 'ALL'; // ALL | PAYMENTS | LOGISTICS | MESSAGING
  let searchQuery = '';
  let testingKey = null;

  let logsModal = null;
  let logsData = [];
  let isLoadingLogs = false;

  // `quiet` re-reads after a save or pause without flashing the loading card.
  async function loadData({ quiet = false } = {}) {
    if (!quiet) {
      isLoading = true;
      render();
    }
    try {
      const res = await adminApi.getIntegrations();
      data = res || { metrics: {}, integrations: [] };
      canManage = Boolean(res?.can_manage);
    } catch (err) {
      toast.error(err?.message || tx('toast_load_error', 'Could not load integrations.'));
      if (!quiet) data = { metrics: {}, integrations: [] };
    } finally {
      isLoading = false;
      render();
    }
  }

  function replaceIntegration(next) {
    if (!next || !data?.integrations) return;
    const i = data.integrations.findIndex((x) => x.key === next.key);
    if (i >= 0) data.integrations[i] = next;
  }

  async function handleTest(gateway) {
    testingKey = gateway.key;
    renderGridOnly();
    try {
      const res = await adminApi.testIntegration(gateway.key);
      replaceIntegration(res?.integration);
      const message = isBn ? res?.message_bn || res?.message_en : res?.message_en;
      if (res?.ok) toast.success(message);
      else toast.error(message);
    } catch (err) {
      toast.error(err?.message || tx('test_failed', 'Failed'));
    } finally {
      testingKey = null;
      renderGridOnly();
    }
  }

  async function handleToggle(gateway, trigger) {
    const nextState = !gateway.is_enabled;
    const { confirmed, reason } = await confirmDialogWithReason({
      title: nextState
        ? tx('confirm_resume_title', 'Resume {name}?', { name: gateway.name })
        : tx('confirm_pause_title', 'Pause {name}?', { name: gateway.name }),
      description: nextState ? tx('confirm_resume_desc', 'It goes back to normal use straight away.') : pick(gateway, 'pause_effect'),
      confirmLabel: nextState ? tx('btn_resume', 'Resume') : tx('btn_pause', 'Pause'),
      variant: nextState ? 'primary' : 'danger',
      reasonRequired: true,
      reasonLabel: tx('reason_label', 'Reason (at least 10 characters)'),
      reasonMinLength: REASON_MIN,
      reasonTooShortMessage: tx('reason_short', 'Enter at least 10 characters.'),
      trigger,
    });
    if (!confirmed) return;

    try {
      const res = await adminApi.setIntegrationStatus(gateway.key, { enabled: nextState, reason });
      replaceIntegration(res?.integration);
      toast.success(
        nextState
          ? tx('toast_enabled', '{name} is switched on.', { name: gateway.name })
          : tx('toast_paused', '{name} is paused.', { name: gateway.name })
      );
      render();
      loadData({ quiet: true });
    } catch (err) {
      toast.error(err?.message || tx('toast_load_error', 'Could not load integrations.'));
    }
  }

  async function openLogs(trigger) {
    isLoadingLogs = true;
    renderLogs(trigger);
    try {
      const res = await adminApi.getIntegrationLogs(30);
      logsData = res?.logs || [];
    } catch (err) {
      toast.error(err?.message || tx('logs_empty', 'No recent webhook events found.'));
      logsData = [];
    } finally {
      isLoadingLogs = false;
      renderLogs(trigger);
    }
  }

  function modeBadge(gateway) {
    const map = {
      LIVE: { label: tx('mode_live', 'Live'), variant: 'success' },
      MOCK: { label: tx('mode_mock', 'Mock'), variant: 'warning' },
      OFF: { label: tx('mode_off', 'Off'), variant: 'neutral' },
    };
    return Badge(map[gateway.driver_mode] || map.OFF).outerHTML;
  }

  function sourceBadge(source) {
    const map = {
      SAVED: { label: tx('source_saved', 'Saved here'), variant: 'success' },
      ENV: { label: tx('source_env', 'From .env'), variant: 'neutral' },
      MISSING: { label: tx('source_missing', 'Not set'), variant: 'warning' },
    };
    return Badge(map[source] || map.MISSING).outerHTML;
  }

  function render() {
    container.innerHTML = '';

    const header = document.createElement('header');
    header.className = 'admin-page-header';
    const infoCol = document.createElement('div');
    infoCol.innerHTML = `
      <div class="admin-page-eyebrow">
        ${Badge({ label: t('platform_integrations.badge_critical', 'CRITICAL CREDENTIALS'), variant: 'danger' }).outerHTML}
      </div>
      <h1 class="admin-page-title">${t('platform_integrations.title', 'Gateway & Service Integrations')}</h1>
      <p class="admin-page-subtitle">${t('platform_integrations.subtitle', 'Manage payment gateways, couriers, SMS gateways and messaging credentials')}</p>
    `;
    const actionsCol = document.createElement('div');
    actionsCol.className = 'admin-page-actions';
    const logsBtn = Button({ label: `📡 ${tx('btn_logs', 'Webhook Logs')}`, variant: 'secondary', onClick: (e) => openLogs(e?.currentTarget) });
    const refreshBtn = Button({ label: `🔄 ${t('common.refresh', 'Refresh')}`, variant: 'secondary', onClick: () => loadData() });
    actionsCol.append(logsBtn, refreshBtn);
    header.append(infoCol, actionsCol);
    container.append(header);

    container.append(PlatformSubnav({ activeKey: 'integrations', navigate }));

    if (isLoading) {
      const loader = document.createElement('div');
      loader.className = 'card p-8 text-center text-secondary';
      loader.innerHTML = `<div class="spinner"></div><p class="mt-2">${t('common.loading', 'Loading')}...</p>`;
      container.append(loader);
      root.replaceChildren(container);
      return;
    }

    const m = data?.metrics || {};
    const kpi = document.createElement('div');
    kpi.className = 'admin-kpi-grid';
    kpi.innerHTML = `
      <div class="admin-kpi-card">
        <span class="admin-kpi-card__label">${tx('kpi_services', 'Services')}</span>
        <span class="admin-kpi-card__value">${formatNumber(m.total || 0)}</span>
        <span class="admin-kpi-card__subtext">${tx('kpi_services_sub', '{live} live · {mock} mock · {off} off', { live: m.live || 0, mock: m.mock || 0, off: m.off || 0 })}</span>
      </div>
      <div class="admin-kpi-card">
        <span class="admin-kpi-card__label">${tx('kpi_attention', 'Needs attention')}</span>
        <span class="admin-kpi-card__value ${m.needs_attention ? 'text-danger' : 'text-success'}">${formatNumber(m.needs_attention || 0)}</span>
        <span class="admin-kpi-card__subtext">${tx('kpi_attention_sub', 'Live but missing a credential')}</span>
      </div>
      <div class="admin-kpi-card">
        <span class="admin-kpi-card__label">${tx('kpi_paused', 'Paused')}</span>
        <span class="admin-kpi-card__value">${formatNumber(m.paused || 0)}</span>
        <span class="admin-kpi-card__subtext">${tx('kpi_paused_sub', 'Payments and couriers only')}</span>
      </div>
      <div class="admin-kpi-card">
        <span class="admin-kpi-card__label">${tx('kpi_webhooks_24h', 'Webhooks (24h)')}</span>
        <span class="admin-kpi-card__value">${formatNumber(m.webhooks_24h || 0)}</span>
        <span class="admin-kpi-card__subtext">${tx('kpi_webhooks_sub', '{valid} with a valid signature', { valid: formatNumber(m.webhooks_24h_valid || 0) })}</span>
      </div>
    `;
    container.append(kpi);

    if (!canManage) {
      const note = document.createElement('p');
      note.className = 'text-xs text-secondary';
      note.textContent = tx('read_only_note', 'You can view this page. Changing credentials needs super admin access.');
      container.append(note);
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'admin-filter-toolbar';
    const categories = [
      { key: 'ALL', label: tx('tab_all', 'All Integrations') },
      { key: 'PAYMENTS', label: tx('tab_payments', 'Payments & MFS') },
      { key: 'LOGISTICS', label: tx('tab_logistics', 'Logistics & Couriers') },
      { key: 'MESSAGING', label: tx('tab_messaging', 'SMS & Communication') },
    ];
    const tabsWrap = document.createElement('div');
    tabsWrap.className = 'admin-filter-tabs';
    categories.forEach((cat) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `admin-filter-tab ${activeCategory === cat.key ? 'admin-filter-tab--active' : ''}`;
      btn.textContent = cat.label;
      btn.addEventListener('click', () => {
        activeCategory = cat.key;
        render();
      });
      tabsWrap.append(btn);
    });
    const searchBox = document.createElement('div');
    searchBox.className = 'admin-search-box';
    searchBox.innerHTML = `
      <input type="text" class="input input--sm" id="integration-search"
        aria-label="${escapeHtml(tx('search_label', 'Search integrations'))}"
        placeholder="${escapeHtml(tx('search_placeholder', 'Search by name or category...'))}"
        value="${escapeHtml(searchQuery)}" />
    `;
    toolbar.append(tabsWrap, searchBox);
    container.append(toolbar);
    searchBox.querySelector('#integration-search').addEventListener('input', (e) => {
      searchQuery = (e.target as HTMLInputElement).value.toLowerCase().trim();
      renderGridOnly();
    });

    const gridMount = document.createElement('div');
    gridMount.id = 'integrations-grid-mount';
    container.append(gridMount);
    renderGridContent(gridMount);

    root.replaceChildren(container);
  }

  function renderGridOnly() {
    const gridMount = container.querySelector('#integrations-grid-mount');
    if (gridMount) renderGridContent(gridMount);
  }

  function renderGridContent(gridMount) {
    gridMount.innerHTML = '';
    let items = data?.integrations || [];
    if (activeCategory !== 'ALL') items = items.filter((i) => i.type === activeCategory);
    if (searchQuery) {
      items = items.filter((i) =>
        [i.name, i.category_en, i.category_bn, i.driver_env].some((s) => String(s || '').toLowerCase().includes(searchQuery))
      );
    }

    if (!items.length) {
      gridMount.innerHTML = `
        <div class="card p-8 text-center text-secondary">
          <p class="text-base font-semibold">${tx('empty_filter', 'No integrations match your filters.')}</p>
          <p class="text-xs mt-1 text-muted">${tx('empty_filter_hint', 'Choose another category or clear the search.')}</p>
        </div>`;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'integrations-grid';

    items.forEach((g) => {
      const card = document.createElement('div');
      card.className = `integration-card ${!g.is_enabled ? 'integration-card--disconnected' : ''}`;
      const counts = { SAVED: 0, ENV: 0, MISSING: 0 };
      for (const f of g.fields || []) counts[f.source] = (counts[f.source] || 0) + 1;
      const isTesting = testingKey === g.key;
      const test = g.last_test;
      const testText = test
        ? `${test.ok ? tx('test_passed', 'Passed') : tx('test_failed', 'Failed')} · ${escapeHtml(formatDate(test.at, { dateStyle: 'medium', timeStyle: 'short' }))}`
        : tx('never_tested', 'Not tested yet');

      card.innerHTML = `
        <div class="integration-card__header">
          <div class="integration-card__brand">
            <div class="integration-card__icon" aria-hidden="true">${TYPE_ICON[g.type] || '🔌'}</div>
            <div>
              <h3 class="integration-card__title">${escapeHtml(g.name)}</h3>
              <span class="integration-card__type">${escapeHtml(pick(g, 'category'))}</span>
            </div>
          </div>
          <div class="integration-card__badges">
            ${modeBadge(g)}
            ${g.is_enabled ? '' : Badge({ label: tx('status_paused', 'Paused'), variant: 'danger' }).outerHTML}
            ${g.live_driver === 'NOT_BUILT' ? Badge({ label: tx('live_not_built', 'Live driver not built'), variant: 'neutral' }).outerHTML : ''}
          </div>
        </div>
        <p class="integration-card__desc">${escapeHtml(pick(g, 'description'))}</p>
        <div class="integration-card__meta-box">
          <div class="integration-card__meta-item">
            <span class="integration-card__meta-label">${tx('driver_label', 'Driver switch')}:</span>
            <span class="integration-card__meta-value">${escapeHtml(g.driver_env)}</span>
          </div>
          <div class="integration-card__meta-item">
            <span class="integration-card__meta-label">${tx('credentials_label', 'Credentials')}:</span>
            <span class="integration-card__meta-value">${tx('credentials_summary', '{saved} saved · {env} .env · {missing} not set', { saved: counts.SAVED, env: counts.ENV, missing: counts.MISSING })}</span>
          </div>
          <div class="integration-card__meta-item">
            <span class="integration-card__meta-label">${tx('last_test_label', 'Last test')}:</span>
            <span class="test-latency-pill ${test?.ok ? 'test-latency-pill--success' : ''}">${testText}</span>
          </div>
        </div>
        <div class="integration-card__footer"></div>
      `;

      const footer = card.querySelector('.integration-card__footer');
      const configBtn = document.createElement('button');
      configBtn.type = 'button';
      configBtn.className = 'btn btn--secondary btn--sm config-btn';
      configBtn.textContent = `⚙️ ${canManage ? tx('btn_configure', 'Configure') : tx('btn_view', 'View')}`;
      configBtn.addEventListener('click', (e) => openConfigModal(g, e.currentTarget));
      footer.append(configBtn);

      if (canManage) {
        const testBtn = document.createElement('button');
        testBtn.type = 'button';
        testBtn.className = 'btn btn--secondary btn--sm test-btn';
        testBtn.disabled = isTesting;
        testBtn.textContent = isTesting ? `⏳ ${tx('btn_testing', 'Checking...')}` : `🧪 ${tx('btn_test', 'Test Connection')}`;
        testBtn.addEventListener('click', () => handleTest(g));
        footer.append(testBtn);

        if (g.pausable) {
          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = `btn btn--sm ${g.is_enabled ? 'btn--secondary' : 'btn--primary'} toggle-btn`;
          toggleBtn.textContent = g.is_enabled ? tx('btn_pause', 'Pause') : tx('btn_resume', 'Resume');
          toggleBtn.addEventListener('click', (e) => handleToggle(g, e.currentTarget));
          footer.append(toggleBtn);
        }
      }

      grid.append(card);
    });

    gridMount.append(grid);
  }

  function openConfigModal(g, trigger = null) {
    let isSaving = false;
    const content = document.createElement('div');
    content.className = 'space-y-4';

    const fieldRows = (g.fields || [])
      .map((f) => {
        const id = `integration-field-${escapeHtml(f.key)}`;
        const placeholder = f.hint
          ? tx('placeholder_keep', 'Leave empty to keep {hint}', { hint: f.hint })
          : tx('placeholder_new', 'Type a value');
        return `
        <div class="form-group">
          <label for="${id}" class="form-label integration-config__label">
            <span>${escapeHtml(pick(f, 'label'))}${f.required ? '' : ` (${tx('field_optional', 'optional')})`}</span>
            ${sourceBadge(f.source)}
          </label>
          <div class="integration-config__row">
            <input id="${id}" data-field="${escapeHtml(f.key)}" type="${f.secret ? 'password' : 'text'}"
              class="input input--sm font-mono" autocomplete="off" spellcheck="false"
              placeholder="${escapeHtml(placeholder)}" ${canManage ? '' : 'disabled'} />
            ${f.secret && canManage ? `<button type="button" class="btn btn--secondary btn--sm reveal-btn" data-for="${id}" aria-label="${escapeHtml(tx('toggle_secret', 'Show or hide'))}">👁️</button>` : ''}
          </div>
          <p class="text-xs text-muted mt-1 font-mono">${escapeHtml(f.env)}</p>
          ${f.source === 'SAVED' && canManage
            ? `<label class="flex items-center gap-2 text-xs mt-1"><input type="checkbox" data-clear="${escapeHtml(f.key)}" /> ${tx('clear_saved', 'Remove the saved value (use .env again)')}</label>`
            : ''}
        </div>`;
      })
      .join('');

    content.innerHTML = `
      <div class="p-3 bg-surface-2 border rounded-lg text-xs flex-between">
        <div>
          <span class="font-bold block text-sm">${escapeHtml(g.name)}</span>
          <span class="text-secondary">${escapeHtml(pick(g, 'category'))} · ${escapeHtml(g.driver_env)}</span>
        </div>
        ${modeBadge(g)}
      </div>
      ${g.live_driver === 'NOT_BUILT' ? `<p class="text-xs text-secondary">⚠️ ${tx('live_not_built_note', 'The live driver for this service is not built yet. You can save its credentials now; keep its .env switch on mock or none until the driver exists.')}</p>` : ''}
      <p class="text-xs text-secondary">${tx('security_note', 'Values are encrypted before they are stored. A saved secret is never shown again, only its last four characters.')}</p>
      ${g.webhook_url ? `
      <div class="form-group">
        <label for="integration-webhook-url" class="form-label">${tx('field_callback_url', 'Webhook URL to give the provider')}</label>
        <div class="integration-config__row">
          <input type="text" id="integration-webhook-url" class="input input--sm font-mono text-muted" value="${escapeHtml(g.webhook_url)}" readonly />
          <button type="button" id="copy-webhook-btn" class="btn btn--secondary btn--sm" aria-label="${escapeHtml(tx('copy_url', 'Copy webhook URL'))}">📋</button>
        </div>
      </div>` : ''}
      ${fieldRows}
      ${canManage ? `
      <div class="form-group">
        <label for="integration-reason" class="form-label">${tx('field_audit_reason', 'Reason for this change')}</label>
        <input type="text" id="integration-reason" class="input input--sm w-full" maxlength="500"
          placeholder="${escapeHtml(tx('reason_placeholder', 'e.g. Rotating the bKash key this quarter'))}" />
      </div>` : ''}
    `;

    const footer = document.createElement('div');
    footer.className = 'flex justify-end gap-2';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--secondary btn--sm';
    cancelBtn.textContent = canManage ? t('common.cancel', 'Cancel') : t('common.close', 'Close');
    footer.append(cancelBtn);
    let saveBtn = null;
    if (canManage) {
      saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn btn--primary btn--sm';
      saveBtn.textContent = tx('btn_save_credentials', 'Save credentials');
      footer.append(saveBtn);
    }

    const modal = Modal({
      title: canManage ? tx('modal_config_title', 'Configure Integration Credentials') : tx('modal_view_title', 'Integration credentials'),
      content,
      footer,
      size: 'lg',
      onClose: () => modal.remove(),
    });

    content.querySelectorAll<HTMLButtonElement>('.reveal-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = content.querySelector<HTMLInputElement>(`#${btn.dataset.for}`);
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
      });
    });
    content.querySelector('#copy-webhook-btn')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard?.writeText(g.webhook_url);
        toast.success(tx('url_copied', 'Webhook URL copied.'));
      } catch {
        content.querySelector<HTMLInputElement>('#integration-webhook-url')?.select();
      }
    });
    cancelBtn.addEventListener('click', () => modal.close(false));

    saveBtn?.addEventListener('click', async () => {
      if (isSaving) return;
      const values = {};
      content.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((input) => {
        const v = input.value.trim();
        if (v) values[input.dataset.field] = v;
      });
      const clear = [...content.querySelectorAll<HTMLInputElement>('input[data-clear]:checked')].map((c) => c.dataset.clear);
      const reasonInput = content.querySelector<HTMLInputElement>('#integration-reason');
      const reason = reasonInput?.value.trim() || '';

      if (!Object.keys(values).length && !clear.length) {
        toast.error(tx('nothing_to_save', 'Type a new value or tick a saved value to remove.'));
        return;
      }
      if (reason.length < REASON_MIN) {
        toast.error(tx('reason_short', 'Enter at least 10 characters.'));
        reasonInput?.focus();
        return;
      }

      isSaving = true;
      saveBtn.disabled = true;
      saveBtn.textContent = tx('saving', 'Saving...');
      try {
        const res = await adminApi.updateIntegration(g.key, { values, clear, reason });
        replaceIntegration(res?.integration);
        toast.success(tx('toast_save_success', 'Credentials saved and encrypted.'));
        if (res?.previous_credentials_unreadable) {
          toast.error(tx('toast_unreadable', 'The values saved before could not be read and were replaced.'));
        }
        modal.close(true);
        render();
        loadData({ quiet: true });
      } catch (err) {
        toast.error(err?.message || tx('toast_load_error', 'Could not load integrations.'));
        isSaving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = tx('btn_save_credentials', 'Save credentials');
      }
    });

    modal.open(trigger);
  }

  // WHY the shared Modal: the hand-rolled backdrop had no genie, Escape, focus trap or scroll lock.
  function renderLogs(trigger = null) {
    const content = document.createElement('div');
    content.className = 'space-y-4';
    if (isLoadingLogs) {
      content.innerHTML = `<div class="p-8 text-center text-muted"><div class="spinner"></div><p class="mt-2 text-xs">${t('common.loading', 'Loading')}...</p></div>`;
    } else if (!logsData.length) {
      content.innerHTML = `<div class="p-8 text-center text-muted text-xs">${tx('logs_empty', 'No recent webhook events found.')}</div>`;
    } else {
      content.innerHTML = `<div class="space-y-2">${logsData
        .map(
          (log) => `
          <div class="p-3 border rounded-lg bg-surface-2 text-xs flex-between">
            <div>
              <div class="font-bold text-primary flex items-center gap-2">
                <span>${log.kind === 'COURIER' ? tx('logs_kind_courier', 'Courier') : tx('logs_kind_payment', 'Payment')} · ${escapeHtml(log.source)}</span>
                ${Badge({
                  label: log.signature_valid ? tx('logs_signature_ok', 'Signature valid') : tx('logs_signature_bad', 'Signature invalid'),
                  variant: log.signature_valid ? 'success' : 'danger',
                }).outerHTML}
              </div>
              <span class="font-mono text-muted text-xxs block mt-1">${escapeHtml(log.provider_event_id)} · ${escapeHtml(log.result || tx('logs_pending', 'Not processed'))}</span>
            </div>
            <span class="text-muted text-xxs">${escapeHtml(formatDate(log.received_at, { dateStyle: 'medium', timeStyle: 'short' }))}</span>
          </div>`
        )
        .join('')}</div>`;
    }

    if (logsModal?.isOpen()) {
      logsModal.setContent(content);
      return;
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn--secondary btn--sm';
    closeBtn.textContent = t('common.close', 'Close');

    const modal = Modal({
      title: tx('logs_drawer_title', 'Gateway and courier webhooks'),
      description: tx('logs_drawer_desc', 'The latest webhooks payment gateways and couriers sent, refused ones included. Payloads are not shown.'),
      content,
      footer: closeBtn,
      size: 'lg',
      onClose: () => {
        modal.remove();
        if (logsModal === modal) logsModal = null;
      },
    });
    closeBtn.addEventListener('click', () => modal.close(false));
    logsModal = modal;
    modal.open(trigger);
  }

  loadData();
  root.replaceChildren(container);
}
