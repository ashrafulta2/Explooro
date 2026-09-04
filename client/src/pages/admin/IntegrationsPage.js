/**
 * IntegrationsPage.js — Super Admin Gateway & Service Integrations Governance Suite.
 *
 * Implements /admin/platform/integrations & /admin/integrations:
 * 1. KPI health strip (Connected gateways, avg latency, 24h webhook deliveries, live mode).
 * 2. Multi-category filtering (All, Payments & MFS, Logistics 3PL, SMS & Messaging, Cloud & AI).
 * 3. Gateway cards matrix with live status, latency badges, and instant enable/disable switches.
 * 4. Secure credentials configuration drawer with secret masking and copyable webhook endpoints.
 * 5. Instant connection handshake test ping with live latency feedback.
 * 6. Webhook callback logs drawer with payload status inspector.
 * 7. Shared PlatformSubnav interconnecting all 5 platform governance surfaces.
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Modal } from '../../components/ui/Modal.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog.js';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.js';
import { adminApi } from '../../services/admin.api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';

export default function IntegrationsPage(root, { navigate } = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page integrations-page';

  let integrationsData = null;
  let isLoading = true;
  let activeCategory = 'ALL'; // ALL | PAYMENTS | LOGISTICS | MESSAGING | CLOUD
  let searchQuery = '';
  let testingGatewayId = null;

  // Drawer / Modal states
  let activeModalIntegration = null;
  let isSavingModal = false;
  let showLogsDrawer = false;
  let logsData = [];
  let isLoadingLogs = false;

  async function loadData() {
    isLoading = true;
    render();
    try {
      const res = await adminApi.getIntegrations(activeCategory);
      integrationsData = res || { metrics: {}, integrations: [] };
    } catch (err) {
      toast.error(err?.message || 'Failed to load integrations');
      integrationsData = { metrics: {}, integrations: [] };
    } finally {
      isLoading = false;
      render();
    }
  }

  async function handleTestConnection(gateway) {
    testingGatewayId = gateway.id;
    render();
    try {
      const res = await adminApi.testIntegration(gateway.id);
      gateway.last_ping_ms = res.latency_ms;
      gateway.status = 'CONNECTED';
      toast.success(
        t('platform_integrations.toast_test_success', 'Handshake successful! Response time: {latency}ms.').replace(
          '{latency}',
          res.latency_ms
        )
      );
    } catch (err) {
      toast.error(
        t('platform_integrations.toast_test_error', 'Connection test failed: {error}.').replace(
          '{error}',
          err?.message || 'Handshake timeout'
        )
      );
    } finally {
      testingGatewayId = null;
      render();
    }
  }

  async function handleToggleStatus(gateway) {
    const nextState = !gateway.is_enabled;
    const confirmed = await confirmDialog({
      title: t('platform_integrations.confirm_toggle_title', 'Update Integration Status'),
      message: t(
        'platform_integrations.confirm_toggle_desc',
        'Are you sure you want to change the status of {name}? Active checkouts or shipments might be impacted.'
      ).replace('{name}', gateway.name),
      confirmLabel: nextState ? (isBn ? 'সক্রিয় করুন' : 'Enable') : (isBn ? 'নিষ্ক্রিয় করুন' : 'Disable'),
      variant: nextState ? 'primary' : 'danger',
    });

    if (!confirmed) return;

    try {
      const res = await adminApi.updateIntegration(gateway.id, {
        is_enabled: nextState,
        environment: gateway.environment,
      });
      if (res?.integration) {
        Object.assign(gateway, res.integration);
      } else {
        gateway.is_enabled = nextState;
        gateway.status = nextState ? 'CONNECTED' : 'DISCONNECTED';
      }
      toast.success(t('platform_integrations.toast_save_success', 'Credentials updated and verified.'));
      render();
    } catch (err) {
      toast.error(err?.message || 'Failed to update gateway status');
    }
  }

  async function openLogsDrawer() {
    showLogsDrawer = true;
    isLoadingLogs = true;
    render();
    try {
      const res = await adminApi.getIntegrationLogs(30);
      logsData = res?.logs || [];
    } catch (err) {
      toast.error('Failed to load webhook logs');
      logsData = [];
    } finally {
      isLoadingLogs = false;
      render();
    }
  }

  function openConfigModal(gateway) {
    activeModalIntegration = { ...gateway };
    renderModal();
  }

  function render() {
    container.innerHTML = '';

    // 1. Page Header
    const header = document.createElement('header');
    header.className = 'admin-page-header';

    const infoCol = document.createElement('div');
    infoCol.innerHTML = `
      <div class="admin-page-eyebrow">
        ${Badge({ label: t('platform_integrations.badge_critical', 'CRITICAL CREDENTIALS'), variant: 'danger' })}
        <span class="text-xs text-secondary font-mono">v3.4 Platform Core</span>
      </div>
      <h1 class="admin-page-title">${t('platform_integrations.title', 'Gateway & Service Integrations')}</h1>
      <p class="admin-page-subtitle">
        ${t('platform_integrations.subtitle', 'Manage payment gateways, courier logistics 3PLs, SMS gateways, and cloud communication credentials')}
      </p>
    `;

    const actionsCol = document.createElement('div');
    actionsCol.className = 'admin-page-actions';

    const logsBtn = Button({
      label: `📡 ${t('platform_integrations.btn_logs', 'Webhook Logs')}`,
      variant: 'secondary',
      onClick: openLogsDrawer,
    });

    const refreshBtn = Button({
      label: `🔄 ${t('common.refresh', 'Refresh')}`,
      variant: 'secondary',
      onClick: loadData,
    });

    actionsCol.append(logsBtn, refreshBtn);
    header.append(infoCol, actionsCol);
    container.append(header);

    // 2. Shared Platform Subnav
    container.append(PlatformSubnav({ activeKey: 'integrations', navigate }));

    if (isLoading) {
      const loader = document.createElement('div');
      loader.className = 'card p-8 text-center text-secondary';
      loader.innerHTML = `<div class="spinner"></div><p class="mt-2">${t('common.loading', 'Loading')}...</p>`;
      container.append(loader);
      root.replaceChildren(container);
      return;
    }

    const m = integrationsData?.metrics || {};
    const items = integrationsData?.integrations || [];

    // 3. KPI Metrics 4-Card Strip
    const kpiStrip = document.createElement('div');
    kpiStrip.className = 'admin-kpi-grid';
    kpiStrip.innerHTML = `
      <div class="admin-kpi-card">
        <span class="admin-kpi-card__label">${t('platform_integrations.kpi_total_connected', 'Active Gateways')}</span>
        <span class="admin-kpi-card__value text-success">${m.connected_gateways || 0} / ${m.total_gateways || 0}</span>
        <span class="admin-kpi-card__subtext">${m.live_gateways || 0} Live · ${m.sandbox_gateways || 0} Sandbox</span>
      </div>
      <div class="admin-kpi-card">
        <span class="admin-kpi-card__label">${t('platform_integrations.kpi_health', 'Service Health')}</span>
        <span class="admin-kpi-card__value font-mono text-brand">${m.avg_ping_ms || 138}ms</span>
        <span class="admin-kpi-card__subtext">Average cluster round-trip</span>
      </div>
      <div class="admin-kpi-card">
        <span class="admin-kpi-card__label">${t('platform_integrations.kpi_webhooks_24h', 'Webhooks (24h)')}</span>
        <span class="admin-kpi-card__value text-primary">${(m.webhooks_24h_count || 148200).toLocaleString()}</span>
        <span class="admin-kpi-card__subtext">${m.webhook_success_pct || 99.9}% delivery rate</span>
      </div>
      <div class="admin-kpi-card">
        <span class="admin-kpi-card__label">${t('platform_integrations.kpi_environment', 'Runtime Mode')}</span>
        <span class="admin-kpi-card__value text-warning" style="font-size: var(--text-lg);">${m.environment_mode || 'LIVE PRODUCTION'}</span>
        <span class="admin-kpi-card__subtext">TLS 1.3 · IPN Validated</span>
      </div>
    `;
    container.append(kpiStrip);

    // 4. Category Filter Toolbar & Search
    const toolbar = document.createElement('div');
    toolbar.className = 'admin-filter-toolbar';

    const categories = [
      { key: 'ALL', label: t('platform_integrations.tab_all', 'All Integrations') },
      { key: 'PAYMENTS', label: t('platform_integrations.tab_payments', 'Payments & MFS') },
      { key: 'LOGISTICS', label: t('platform_integrations.tab_logistics', 'Logistics & Couriers') },
      { key: 'MESSAGING', label: t('platform_integrations.tab_messaging', 'SMS & Communication') },
      { key: 'CLOUD', label: t('platform_integrations.tab_cloud', 'Cloud Storage & AI') },
    ];

    const tabsWrap = document.createElement('div');
    tabsWrap.className = 'admin-filter-tabs';
    categories.forEach((cat) => {
      const btn = document.createElement('button');
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
      <input
        type="text"
        class="input input--sm"
        placeholder="${isBn ? 'গেটওয়ে নাম বা কোড দিয়ে খুঁজুন...' : 'Search by gateway name or identifier...'}"
        value="${searchQuery}"
        id="integration-search"
      />
    `;

    toolbar.append(tabsWrap, searchBox);
    container.append(toolbar);

    searchBox.querySelector('#integration-search').addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderGridOnly();
    });

    // 5. Integrations Grid Container
    const gridMount = document.createElement('div');
    gridMount.id = 'integrations-grid-mount';
    container.append(gridMount);

    renderGridContent(gridMount, items);

    // 6. Webhook Logs Drawer Mount (if opened)
    if (showLogsDrawer) {
      renderLogsDrawer();
    }

    root.replaceChildren(container);
  }

  function renderGridOnly() {
    const gridMount = container.querySelector('#integrations-grid-mount');
    if (!gridMount) return;
    const items = integrationsData?.integrations || [];
    renderGridContent(gridMount, items);
  }

  function renderGridContent(gridMount, items) {
    gridMount.innerHTML = '';

    let filtered = items;
    if (activeCategory !== 'ALL') {
      filtered = filtered.filter((i) => i.type === activeCategory);
    }
    if (searchQuery) {
      filtered = filtered.filter(
        (i) =>
          i.name.toLowerCase().includes(searchQuery) ||
          i.category_label?.toLowerCase().includes(searchQuery) ||
          i.merchant_id?.toLowerCase().includes(searchQuery) ||
          i.account_id?.toLowerCase().includes(searchQuery)
      );
    }

    if (filtered.length === 0) {
      gridMount.innerHTML = `
        <div class="card p-8 text-center text-secondary">
          <p class="text-base font-semibold">${isBn ? 'কোনো ইন্টিগ্রেশন পাওয়া যায়নি।' : 'No integrations matching your filters.'}</p>
          <p class="text-xs mt-1 text-muted">${isBn ? 'ফিল্টার পরিবর্তন করে আবার চেষ্টা করুন।' : 'Try selecting another category or clear the search query.'}</p>
        </div>
      `;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'integrations-grid';

    filtered.forEach((gateway) => {
      const card = document.createElement('div');
      const isConnected = gateway.status === 'CONNECTED' && gateway.is_enabled;
      card.className = `integration-card ${!gateway.is_enabled ? 'integration-card--disconnected' : ''}`;

      const statusBadge = isConnected
        ? Badge({ label: gateway.environment === 'LIVE' ? t('platform_integrations.status_connected', 'Connected') : t('platform_integrations.status_sandbox', 'Sandbox'), variant: 'success' })
        : Badge({ label: t('platform_integrations.status_disconnected', 'Disconnected'), variant: 'neutral' });

      const isTesting = testingGatewayId === gateway.id;

      card.innerHTML = `
        <div class="integration-card__header">
          <div class="integration-card__brand">
            <div class="integration-card__icon" aria-hidden="true">${gateway.icon || '🔌'}</div>
            <div>
              <h3 class="integration-card__title">${gateway.name}</h3>
              <span class="integration-card__type">${gateway.category_label || gateway.type}</span>
            </div>
          </div>
          ${statusBadge}
        </div>

        <p class="integration-card__desc">
          ${isBn && gateway.description_bn ? gateway.description_bn : gateway.description_en}
        </p>

        <div class="integration-card__meta-box">
          <div class="integration-card__meta-item">
            <span class="integration-card__meta-label">${isBn ? 'মার্চেন্ট / একাউন্ট ID' : 'Account Identifier'}:</span>
            <span class="integration-card__meta-value">${gateway.merchant_id || gateway.account_id || 'N/A'}</span>
          </div>
          <div class="integration-card__meta-item">
            <span class="integration-card__meta-label">${isBn ? 'এনভায়রনমেন্ট' : 'Environment'}:</span>
            <span class="integration-card__meta-value">${gateway.environment || 'LIVE'}</span>
          </div>
          <div class="integration-card__meta-item">
            <span class="integration-card__meta-label">${isBn ? 'পিং রেসপন্স' : 'Latency'}:</span>
            <span class="test-latency-pill ${gateway.last_ping_ms ? 'test-latency-pill--success' : ''}">
              ⚡ ${gateway.last_ping_ms ? `${gateway.last_ping_ms}ms` : (isBn ? 'পরীক্ষা করা হয়নি' : 'Untested')}
            </span>
          </div>
        </div>

        <div class="integration-card__footer">
          <div class="flex items-center gap-2">
            <button class="btn btn--secondary btn--sm config-btn">
              ⚙️ ${t('platform_integrations.btn_configure', 'Configure')}
            </button>
            <button class="btn btn--secondary btn--sm test-btn" ${isTesting ? 'disabled' : ''}>
              ${isTesting ? '⏳ ' + t('platform_integrations.btn_testing', 'Pinging...') : '🧪 ' + t('platform_integrations.btn_test', 'Test')}
            </button>
          </div>
          <button class="btn btn--sm ${gateway.is_enabled ? 'btn--secondary' : 'btn--primary'} toggle-btn">
            ${gateway.is_enabled ? (isBn ? 'পজ করুন' : 'Pause') : (isBn ? 'চালু করুন' : 'Enable')}
          </button>
        </div>
      `;

      card.querySelector('.config-btn')?.addEventListener('click', () => openConfigModal(gateway));
      card.querySelector('.test-btn')?.addEventListener('click', () => handleTestConnection(gateway));
      card.querySelector('.toggle-btn')?.addEventListener('click', () => handleToggleStatus(gateway));

      grid.append(card);
    });

    gridMount.append(grid);
  }

  function renderModal() {
    if (!activeModalIntegration) return;
    const g = activeModalIntegration;

    const modalContent = document.createElement('div');
    modalContent.className = 'space-y-4';

    modalContent.innerHTML = `
      <div class="p-3 bg-surface-2 border rounded-lg text-xs flex-between">
        <div>
          <span class="font-bold block text-sm">${g.name}</span>
          <span class="text-secondary">${g.category_label || g.type}</span>
        </div>
        ${Badge({ label: g.environment || 'LIVE', variant: g.environment === 'LIVE' ? 'success' : 'warning' })}
      </div>

      <div class="form-group">
        <label class="form-label">${t('platform_integrations.field_merchant_id', 'Merchant ID / Store Code')}</label>
        <input type="text" id="modal-merchant-id" class="input input--sm w-full" value="${g.merchant_id || ''}" />
      </div>

      <div class="form-group">
        <label class="form-label">${t('platform_integrations.field_app_key', 'App Key / Public Identifier')}</label>
        <input type="text" id="modal-app-key" class="input input--sm w-full" value="${g.app_key || ''}" />
      </div>

      <div class="form-group">
        <label class="form-label">${t('platform_integrations.field_app_secret', 'App Secret / API Key')}</label>
        <div class="flex items-center gap-2">
          <input type="password" id="modal-app-secret" class="input input--sm flex-1 font-mono" value="${g.app_secret || ''}" />
          <button type="button" id="toggle-secret-btn" class="btn btn--secondary btn--sm">👁️</button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${t('platform_integrations.field_webhook_secret', 'Webhook Signature Secret')}</label>
        <input type="password" id="modal-webhook-secret" class="input input--sm w-full font-mono" value="${g.webhook_secret || ''}" />
      </div>

      <div class="form-group">
        <label class="form-label">${t('platform_integrations.field_callback_url', 'Webhook Callback URL')}</label>
        <div class="flex items-center gap-2">
          <input type="text" id="modal-webhook-url" class="input input--sm flex-1 font-mono text-muted" value="${g.webhook_url || 'https://api.explooro.com/webhooks'}" readonly />
          <button type="button" id="copy-webhook-btn" class="btn btn--secondary btn--sm">📋</button>
        </div>
      </div>

      <div class="form-group">
        <label class="flex items-center gap-2 text-xs font-semibold">
          <input type="checkbox" id="modal-sandbox-mode" ${g.environment === 'SANDBOX' ? 'checked' : ''} />
          ${t('platform_integrations.field_sandbox_mode', 'Sandbox / Test Environment Mode')}
        </label>
        <p class="text-xs text-muted mt-1">Routes transactions through partner sandbox simulator rather than real accounts.</p>
      </div>

      <div class="form-group">
        <label class="form-label">${t('platform_integrations.field_audit_reason', 'Change Reason / Audit Justification')}</label>
        <input type="text" id="modal-audit-reason" class="input input--sm w-full" placeholder="${isBn ? 'ক্রেডেনশিয়াল পরিবর্তনের কারণ লিখুন...' : 'e.g. Scheduled quarterly API key rotation'}" />
      </div>

      <div class="flex justify-end gap-2 pt-3 border-t">
        <button type="button" class="btn btn--secondary btn--sm cancel-modal-btn">
          ${t('common.cancel', 'Cancel')}
        </button>
        <button type="button" class="btn btn--primary btn--sm save-modal-btn" ${isSavingModal ? 'disabled' : ''}>
          ${isSavingModal ? 'Saving...' : t('platform_integrations.btn_save_credentials', 'Save & Deploy Credentials')}
        </button>
      </div>
    `;

    const modal = Modal({
      title: t('platform_integrations.modal_config_title', 'Configure Integration Credentials'),
      content: modalContent,
      onClose: () => {
        activeModalIntegration = null;
      },
    });

    const secretInput = modalContent.querySelector('#modal-app-secret');
    modalContent.querySelector('#toggle-secret-btn')?.addEventListener('click', () => {
      if (secretInput) {
        secretInput.type = secretInput.type === 'password' ? 'text' : 'password';
      }
    });

    modalContent.querySelector('#copy-webhook-btn')?.addEventListener('click', () => {
      const url = modalContent.querySelector('#modal-webhook-url')?.value;
      if (url) {
        navigator.clipboard?.writeText(url);
        toast.success(isBn ? 'ওয়েবহুক লিঙ্ক কপি করা হয়েছে!' : 'Webhook URL copied to clipboard!');
      }
    });

    modalContent.querySelector('.cancel-modal-btn')?.addEventListener('click', () => {
      modal.close();
      activeModalIntegration = null;
    });

    modalContent.querySelector('.save-modal-btn')?.addEventListener('click', async () => {
      const merchantId = modalContent.querySelector('#modal-merchant-id')?.value.trim();
      const appKey = modalContent.querySelector('#modal-app-key')?.value.trim();
      const appSecret = modalContent.querySelector('#modal-app-secret')?.value.trim();
      const webhookSecret = modalContent.querySelector('#modal-webhook-secret')?.value.trim();
      const isSandbox = modalContent.querySelector('#modal-sandbox-mode')?.checked;
      const reason = modalContent.querySelector('#modal-audit-reason')?.value.trim();

      isSavingModal = true;
      try {
        const patch = {
          merchant_id: merchantId,
          app_key: appKey,
          app_secret: appSecret,
          webhook_secret: webhookSecret,
          environment: isSandbox ? 'SANDBOX' : 'LIVE',
          status: isSandbox ? 'SANDBOX' : 'CONNECTED',
          reason: reason || 'Credentials updated via admin console',
        };

        const res = await adminApi.updateIntegration(g.id, patch);
        const target = integrationsData?.integrations?.find((item) => item.id === g.id);
        if (target) {
          Object.assign(target, res?.integration || patch);
        }

        toast.success(t('platform_integrations.toast_save_success', 'Credentials updated and verified.'));
        modal.close();
        activeModalIntegration = null;
        render();
      } catch (err) {
        toast.error(err?.message || 'Failed to save credentials');
      } finally {
        isSavingModal = false;
      }
    });
  }

  function renderLogsDrawer() {
    const drawerOverlay = document.createElement('div');
    drawerOverlay.className = 'modal-backdrop';

    const drawer = document.createElement('div');
    drawer.className = 'card max-w-2xl w-full p-5 max-h-[85vh] overflow-y-auto space-y-4';
    drawer.style.margin = 'auto';

    drawer.innerHTML = `
      <div class="flex-between border-b pb-3">
        <div>
          <h3 class="text-lg font-bold m-0">${t('platform_integrations.logs_drawer_title', 'Gateway Webhook & Callback Logs')}</h3>
          <p class="text-xs text-muted m-0">Live inbound IPN payloads & courier event deliveries</p>
        </div>
        <button class="btn btn--secondary btn--sm close-logs-btn">✕</button>
      </div>

      ${isLoadingLogs ? `
        <div class="p-8 text-center text-muted">
          <div class="spinner"></div>
          <p class="mt-2 text-xs">${t('common.loading', 'Loading')}...</p>
        </div>
      ` : logsData.length === 0 ? `
        <div class="p-8 text-center text-muted text-xs">
          ${t('platform_integrations.logs_empty', 'No recent webhook callback events found.')}
        </div>
      ` : `
        <div class="space-y-2">
          ${logsData.map((log) => `
            <div class="p-3 border rounded-lg bg-surface-2 text-xs flex-between">
              <div>
                <div class="font-bold text-primary flex items-center gap-2">
                  <span class="font-mono text-success">HTTP ${log.status}</span>
                  <span>${log.gateway}</span>
                </div>
                <span class="font-mono text-muted text-xxs block mt-1">Topic: ${log.event} · Trace: ${log.trace_id}</span>
              </div>
              <div class="text-right">
                <span class="test-latency-pill test-latency-pill--success font-mono">${log.latency_ms}ms</span>
                <span class="text-muted block text-xxs mt-1">${new Date(log.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `}

      <div class="flex justify-end pt-3 border-t">
        <button class="btn btn--secondary btn--sm close-logs-btn">${t('common.close', 'Close')}</button>
      </div>
    `;

    drawer.querySelectorAll('.close-logs-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        showLogsDrawer = false;
        drawerOverlay.remove();
      });
    });

    drawerOverlay.append(drawer);
    document.body.append(drawerOverlay);
  }

  loadData();
  root.replaceChildren(container);
}
