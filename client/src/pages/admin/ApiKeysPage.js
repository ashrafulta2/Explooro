/**
 * ApiKeysPage.js — Developer Portal, Scoped API Keys, Webhook DLQ & Embeddable Widget Studio (Prompt 10.7).
 *
 * Implements /admin/platform/api-keys and /admin/api-keys:
 * - Scoped API key generator with Phase 2 RBAC permissions.
 * - 1-Time Token Reveal Modal with clipboard copy.
 * - Outbound Webhook subscriptions manager and Dead-Letter Queue (DLQ) replay tool.
 * - Embeddable Widget Studio with interactive preview and snippet generator.
 */

import {
  listApiKeys,
  createApiKey,
  rotateApiKey,
  revokeApiKey,
  listWebhookSubscriptions,
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveries,
  replayWebhookDelivery,
} from '../../services/developer.api.js';

import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog.js';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';

export default function ApiKeysPage(root, { navigate } = {}) {
  const container = document.createElement('div');
  container.className = 'admin-page api-keys-page';

  let activeTab = 'keys'; // 'keys' | 'webhooks' | 'widget'
  let apiKeys = [];
  let webhooks = [];
  let deliveries = [];

  // 1. Module Gating Check
  if (!isFeatureEnabled('open_api')) {
    container.append(
      EmptyState({
        title: t('developer.module_disabled_title'),
        description: t('developer.module_disabled_desc'),
      })
    );
    root.append(container);
    return () => container.remove();
  }

  // 2. Page Header
  const header = document.createElement('header');
  header.className = 'admin-page-header';
  header.innerHTML = `
    <div>
      <div class="admin-page-eyebrow">
        <span class="badge badge-primary text-xs font-mono">Open API & SDK</span>
        <span class="text-xs text-secondary font-mono">v1.4 Scoped RBAC</span>
      </div>
      <h1 class="admin-page-title">⚡ ${t('developer.page_title')}</h1>
      <p class="admin-page-subtitle">${t('developer.page_subtitle')}</p>
    </div>
  `;
  container.append(header);

  // 3. Shared Platform Subnav
  container.append(PlatformSubnav({ activeKey: 'apikeys', navigate }));

  // 4. KPI Metrics Row
  const metricsRow = document.createElement('div');
  metricsRow.className = 'admin-kpi-grid';
  container.append(metricsRow);

  // 5. Tab Navigation
  const tabNav = document.createElement('div');
  tabNav.className = 'admin-filter-toolbar';
  container.append(tabNav);

  const contentArea = document.createElement('div');
  contentArea.className = 'tab-content-area space-y-6';
  container.append(contentArea);

  async function loadAllData() {
    try {
      const [kRes, wRes, dRes] = await Promise.all([
        listApiKeys().catch(() => ({ data: [] })),
        listWebhookSubscriptions().catch(() => ({ data: [] })),
        listWebhookDeliveries().catch(() => ({ data: [] })),
      ]);

      apiKeys = kRes?.data || [];
      webhooks = wRes?.data || [];
      deliveries = dRes?.data || [];

      renderMetrics();
    } catch {
      // Fallback
    }
  }

  function renderMetrics() {
    const activeKeys = apiKeys.filter((k) => k.status === 'ACTIVE').length;
    const activeSubs = webhooks.filter((w) => w.status === 'ACTIVE').length;
    const deliveredCount = deliveries.filter((d) => d.status === 'DELIVERED').length;
    const dlqCount = deliveries.filter((d) => d.status === 'DEAD_LETTER').length;

    metricsRow.innerHTML = `
      <div class="admin-kpi-card">
        <span class="admin-kpi-card__label">${t('developer.metric_active_keys')}</span>
        <span class="admin-kpi-card__value font-mono text-brand">${activeKeys}</span>
        <span class="admin-kpi-card__subtext">Scoped credentials</span>
      </div>
      <div class="admin-kpi-card">
        <span class="admin-kpi-card__label">${t('developer.metric_webhooks')}</span>
        <span class="admin-kpi-card__value font-mono text-primary">${activeSubs}</span>
        <span class="admin-kpi-card__subtext">Outbound webhooks</span>
      </div>
      <div class="admin-kpi-card">
        <span class="admin-kpi-card__label">${t('developer.metric_delivered_events')}</span>
        <span class="admin-kpi-card__value font-mono text-success">${deliveredCount}</span>
        <span class="admin-kpi-card__subtext">Delivered (24h)</span>
      </div>
      <div class="admin-kpi-card">
        <span class="admin-kpi-card__label">${t('developer.metric_dlq_items')}</span>
        <span class="admin-kpi-card__value font-mono ${dlqCount > 0 ? 'text-danger' : 'text-secondary'}">${dlqCount}</span>
        <span class="admin-kpi-card__subtext">${dlqCount > 0 ? 'Requires attention' : 'DLQ healthy'}</span>
      </div>
    `;
  }

  function renderTabNav() {
    tabNav.innerHTML = `
      <div class="admin-filter-tabs">
        <button class="admin-filter-tab ${activeTab === 'keys' ? 'admin-filter-tab--active' : ''}" data-tab="keys">
          🔑 ${t('developer.tab_api_keys')} (${apiKeys.length})
        </button>
        <button class="admin-filter-tab ${activeTab === 'webhooks' ? 'admin-filter-tab--active' : ''}" data-tab="webhooks">
          📡 ${t('developer.tab_webhooks')} (${webhooks.length})
        </button>
        <button class="admin-filter-tab ${activeTab === 'widget' ? 'admin-filter-tab--active' : ''}" data-tab="widget">
          🧩 ${t('developer.tab_widget_studio')}
        </button>
      </div>
    `;

    tabNav.querySelectorAll('.admin-filter-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab');
        renderTabNav();
        renderCurrentTab();
      });
    });
  }

  function renderCurrentTab() {
    contentArea.innerHTML = '';
    renderTabNav();

    if (activeTab === 'keys') {
      renderKeysTab();
    } else if (activeTab === 'webhooks') {
      renderWebhooksTab();
    } else {
      renderWidgetStudioTab();
    }
  }

  // ---------------------------------------------------------------------------
  // TAB 1: API KEYS
  // ---------------------------------------------------------------------------
  function renderKeysTab() {
    const actionHeader = document.createElement('div');
    actionHeader.className = 'flex-between flex-wrap gap-3';
    actionHeader.innerHTML = `
      <div>
        <h3 class="text-lg font-bold m-0">${t('developer.keys_heading')}</h3>
        <p class="text-xs text-muted m-0">${t('developer.keys_subheading')}</p>
      </div>
    `;

    const createBtn = Button({
      label: `+ ${t('developer.btn_create_key')}`,
      variant: 'primary',
      onClick: openCreateKeyModal,
    });
    actionHeader.append(createBtn);
    contentArea.append(actionHeader);

    if (apiKeys.length === 0) {
      contentArea.append(
        EmptyState({
          title: t('developer.no_keys_title'),
          description: t('developer.no_keys_desc'),
        })
      );
      return;
    }

    const tableWrap = document.createElement('div');
    tableWrap.className = 'border rounded overflow-x-auto bg-surface shadow-sm';
    tableWrap.innerHTML = `
      <table class="table w-full text-left text-xs">
        <thead class="bg-surface-subtle border-b font-mono uppercase text-muted">
          <tr>
            <th class="p-3">Key Name / Ref</th>
            <th class="p-3">Prefix / Hash</th>
            <th class="p-3">Scopes</th>
            <th class="p-3">Rate Limit</th>
            <th class="p-3">Status</th>
            <th class="p-3">Last Used</th>
            <th class="p-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${apiKeys.map((k) => `
            <tr class="border-b hover:bg-surface-subtle" data-key-id="${k.id}">
              <td class="p-3">
                <div class="font-bold text-sm">${k.name}</div>
                <span class="badge badge-neutral text-xs font-mono">${k.ref}</span>
              </td>
              <td class="p-3 font-mono text-muted">
                <code>${k.key_prefix}</code>
              </td>
              <td class="p-3">
                <div class="flex gap-1 flex-wrap">
                  ${(k.scopes || []).map((s) => `<span class="badge badge-primary text-xs font-mono">${s}</span>`).join('')}
                </div>
              </td>
              <td class="p-3 font-mono">${k.rate_limit_rpm || 60} RPM</td>
              <td class="p-3">
                <span class="badge ${k.status === 'ACTIVE' ? 'badge-success' : 'badge-neutral'} text-xs font-mono">
                  ${k.status}
                </span>
              </td>
              <td class="p-3 text-muted">
                ${k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}
              </td>
              <td class="p-3 text-right space-x-2">
                ${k.status === 'ACTIVE' ? `
                  <button class="rotate-btn btn btn-sm btn-secondary text-xs" data-id="${k.id}">
                    🔄 ${t('developer.btn_rotate')}
                  </button>
                  <button class="revoke-btn btn btn-sm btn-danger text-xs" data-id="${k.id}">
                    ⛔ ${t('developer.btn_revoke')}
                  </button>
                ` : '<span class="text-muted text-xs">Revoked</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    tableWrap.querySelectorAll('.rotate-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const confirmed = await confirmDialog({
          title: t('developer.btn_rotate', 'Rotate API Key'),
          message: t('developer.confirm_rotate'),
          confirmLabel: t('developer.btn_rotate', 'Rotate'),
          variant: 'warning',
        });
        if (!confirmed) return;
        try {
          const res = await rotateApiKey(id);
          toast.success(t('developer.rotate_success'));
          openTokenRevealModal(res?.data?.raw_token);
          await loadAllData();
          renderCurrentTab();
        } catch (err) {
          toast.error(err?.message || 'Failed to rotate key');
        }
      });
    });

    tableWrap.querySelectorAll('.revoke-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const confirmed = await confirmDialog({
          title: t('developer.btn_revoke', 'Revoke API Key'),
          message: t('developer.confirm_revoke'),
          confirmLabel: t('developer.btn_revoke', 'Revoke'),
          variant: 'danger',
        });
        if (!confirmed) return;
        try {
          await revokeApiKey(id);
          toast.success(t('developer.revoke_success'));
          await loadAllData();
          renderCurrentTab();
        } catch (err) {
          toast.error(err?.message || 'Failed to revoke key');
        }
      });
    });

    contentArea.append(tableWrap);
  }

  function openCreateKeyModal() {
    const modalContent = document.createElement('div');
    modalContent.className = 'space-y-4 p-2';

    modalContent.innerHTML = `
      <div>
        <label for="modal-key-name" class="block text-xs font-semibold text-muted mb-1">${t('developer.label_key_name')}</label>
        <input type="text" id="modal-key-name" class="input w-full" placeholder="e.g. ERP Inventory Sync Client">
      </div>

      <div>
        <label class="block text-xs font-semibold text-muted mb-1">${t('developer.label_scopes')}</label>
        <div class="space-y-1 text-xs">
          <label class="flex items-center gap-2">
            <input type="checkbox" name="scope" value="catalog.products.read" checked>
            <code>catalog.products.read</code> — Read products, inventory & variants
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" name="scope" value="catalog.stores.read" checked>
            <code>catalog.stores.read</code> — Read public storefronts
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" name="scope" value="catalog.categories.read" checked>
            <code>catalog.categories.read</code> — Read category navigation tree
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" name="scope" value="orders.create">
            <code>orders.create</code> — Place partner orders (Write access)
          </label>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="modal-rate-limit" class="block text-xs font-semibold text-muted mb-1">${t('developer.label_rate_limit')}</label>
          <input type="number" id="modal-rate-limit" class="input w-full font-mono text-xs" value="60">
        </div>
        <div>
          <label for="modal-ip-allowlist" class="block text-xs font-semibold text-muted mb-1">${t('developer.label_ip_allowlist')}</label>
          <input type="text" id="modal-ip-allowlist" class="input w-full font-mono text-xs" placeholder="e.g. 192.168.1.1, 10.0.0.1">
        </div>
      </div>
    `;

    const modal = Modal({
      title: `🔑 ${t('developer.create_key_modal_title')}`,
      body: modalContent,
      confirmLabel: t('common.create'),
      onConfirm: async () => {
        const name = modalContent.querySelector('#modal-key-name')?.value?.trim();
        const rateLimit = parseInt(modalContent.querySelector('#modal-rate-limit')?.value, 10) || 60;
        const ips = (modalContent.querySelector('#modal-ip-allowlist')?.value || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        const scopes = Array.from(modalContent.querySelectorAll('input[name="scope"]:checked')).map((c) => c.value);

        if (!name) {
          toast.error(t('developer.error_name_required'));
          return;
        }

        try {
          const res = await createApiKey({
            name,
            scopes,
            rate_limit_rpm: rateLimit,
            ip_allowlist: ips,
          });

          modal.close();
          toast.success(t('developer.key_created_success'));
          openTokenRevealModal(res?.data?.raw_token);
          await loadAllData();
          renderCurrentTab();
        } catch (err) {
          toast.error(err?.message || 'Failed to create API key');
        }
      },
    });

    document.body.append(modal.element);
    modal.open();
  }

  function openTokenRevealModal(rawToken) {
    if (!rawToken) return;

    const modalContent = document.createElement('div');
    modalContent.className = 'space-y-4 p-2';

    modalContent.innerHTML = `
      <div class="p-3 border rounded bg-warning-soft text-xs text-warning">
        ⚠️ <b>Important:</b> This is the only time this secret token will be revealed. Store it securely in your environment variables.
      </div>

      <div>
        <label for="revealed-token" class="block text-xs font-semibold text-muted mb-1">Raw API Token</label>
        <div class="flex gap-2">
          <input type="text" readonly id="revealed-token" class="input w-full font-mono text-xs bg-surface-subtle" value="${rawToken}">
          <button class="btn btn-primary text-xs shrink-0" id="copy-token-btn">📋 Copy</button>
        </div>
      </div>
    `;

    modalContent.querySelector('#copy-token-btn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(rawToken);
      toast.success(t('developer.token_copied'));
    });

    const modal = Modal({
      title: `🔒 ${t('developer.token_reveal_title')}`,
      body: modalContent,
      confirmLabel: t('common.done'),
      onConfirm: () => modal.close(),
    });

    document.body.append(modal.element);
    modal.open();
  }

  // ---------------------------------------------------------------------------
  // TAB 2: WEBHOOKS & DLQ
  // ---------------------------------------------------------------------------
  function renderWebhooksTab() {
    const headerRow = document.createElement('div');
    headerRow.className = 'flex-between flex-wrap gap-3';
    headerRow.innerHTML = `
      <div>
        <h3 class="text-lg font-bold m-0">${t('developer.webhooks_heading')}</h3>
        <p class="text-xs text-muted m-0">${t('developer.webhooks_subheading')}</p>
      </div>
    `;

    const addBtn = Button({
      label: `+ ${t('developer.btn_add_webhook')}`,
      variant: 'primary',
      onClick: openCreateWebhookModal,
    });
    headerRow.append(addBtn);
    contentArea.append(headerRow);

    // Subscriptions List
    const subsSection = document.createElement('div');
    subsSection.className = 'space-y-3';

    if (webhooks.length === 0) {
      subsSection.append(
        EmptyState({
          title: t('developer.no_webhooks_title'),
          description: t('developer.no_webhooks_desc'),
        })
      );
    } else {
      const list = document.createElement('div');
      list.className = 'grid grid-cols-1 md:grid-cols-2 gap-4';

      webhooks.forEach((sub) => {
        const card = document.createElement('div');
        card.className = 'card p-4 border rounded bg-surface shadow-sm space-y-3';
        card.innerHTML = `
          <div class="flex-between">
            <span class="badge badge-primary text-xs font-mono">${sub.ref}</span>
            <span class="badge ${sub.status === 'ACTIVE' ? 'badge-success' : 'badge-neutral'} text-xs font-mono">${sub.status}</span>
          </div>
          <div>
            <div class="font-mono text-sm font-bold truncate">${sub.target_url}</div>
            <div class="text-xs text-muted mt-1 font-mono">Secret: <code>${(sub.secret || '').slice(0, 10)}...</code></div>
          </div>
          <div class="flex gap-1 flex-wrap">
            ${(sub.events || []).map((e) => `<span class="badge badge-neutral text-xs font-mono">${e}</span>`).join('')}
          </div>
          <div class="flex justify-end pt-2 border-t">
            <button class="delete-sub-btn btn btn-sm btn-ghost text-danger text-xs" data-id="${sub.id}">
              🗑️ ${t('common.delete')}
            </button>
          </div>
        `;

        card.querySelector('.delete-sub-btn')?.addEventListener('click', async () => {
          const confirmed = await confirmDialog({
            title: t('common.delete', 'Delete Webhook'),
            message: t('developer.confirm_delete_webhook'),
            confirmLabel: t('common.delete', 'Delete'),
            variant: 'danger',
          });
          if (!confirmed) return;
          try {
            await deleteWebhookSubscription(sub.id);
            toast.success(t('developer.webhook_deleted'));
            await loadAllData();
            renderCurrentTab();
          } catch (err) {
            toast.error(err?.message || 'Failed to delete webhook');
          }
        });

        list.append(card);
      });
      subsSection.append(list);
    }
    contentArea.append(subsSection);

    // Deliveries & Dead-Letter Queue Logs
    const dlqSection = document.createElement('div');
    dlqSection.className = 'space-y-3 pt-6 border-t';
    dlqSection.innerHTML = `
      <div class="flex-between">
        <h4 class="text-base font-bold m-0">📡 ${t('developer.deliveries_dlq_heading')}</h4>
        <span class="text-xs text-muted">${deliveries.length} recent dispatches</span>
      </div>
    `;

    const delivTable = document.createElement('div');
    delivTable.className = 'border rounded overflow-x-auto bg-surface shadow-sm';
    delivTable.innerHTML = `
      <table class="table w-full text-left text-xs">
        <thead class="bg-surface-subtle border-b font-mono uppercase text-muted">
          <tr>
            <th class="p-3">Event</th>
            <th class="p-3">Target Endpoint</th>
            <th class="p-3">Attempts</th>
            <th class="p-3">Status</th>
            <th class="p-3">HTTP Code / Error</th>
            <th class="p-3">Timestamp</th>
            <th class="p-3 text-right">Replay</th>
          </tr>
        </thead>
        <tbody>
          ${deliveries.length === 0 ? `
            <tr><td colspan="7" class="p-4 text-center text-muted">No delivery dispatches recorded.</td></tr>
          ` : deliveries.map((d) => {
            const isDlq = d.status === 'DEAD_LETTER';
            const isDelivered = d.status === 'DELIVERED';
            return `
              <tr class="border-b hover:bg-surface-subtle ${isDlq ? 'bg-danger-soft' : ''}">
                <td class="p-3 font-mono font-bold">${d.event_name}</td>
                <td class="p-3 font-mono text-muted max-w-xs truncate">${d.target_url}</td>
                <td class="p-3 font-mono">${d.attempt_number} / ${d.max_attempts}</td>
                <td class="p-3">
                  <span class="badge ${isDelivered ? 'badge-success' : isDlq ? 'badge-danger' : 'badge-warning'} text-xs font-mono">
                    ${d.status}
                  </span>
                </td>
                <td class="p-3 font-mono text-xs">
                  ${d.response_status ? `HTTP ${d.response_status}` : d.error_message || 'Pending'}
                </td>
                <td class="p-3 text-muted">${new Date(d.created_at).toLocaleTimeString()}</td>
                <td class="p-3 text-right">
                  <button class="replay-btn btn btn-sm btn-secondary text-xs" data-id="${d.id}">
                    🔁 ${t('developer.btn_replay')}
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    delivTable.querySelectorAll('.replay-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        try {
          await replayWebhookDelivery(id);
          toast.success(t('developer.replay_queued'));
          await loadAllData();
          renderCurrentTab();
        } catch (err) {
          toast.error(err?.message || 'Failed to replay webhook');
        }
      });
    });

    dlqSection.append(delivTable);
    contentArea.append(dlqSection);
  }

  function openCreateWebhookModal() {
    const modalContent = document.createElement('div');
    modalContent.className = 'space-y-4 p-2';

    modalContent.innerHTML = `
      <div>
        <label for="modal-webhook-url" class="block text-xs font-semibold text-muted mb-1">${t('developer.label_target_url')}</label>
        <input type="url" id="modal-webhook-url" class="input w-full font-mono text-xs" placeholder="https://my-backend.com/api/webhooks/explooro">
      </div>

      <div>
        <label class="block text-xs font-semibold text-muted mb-1">${t('developer.label_subscribed_events')}</label>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <label class="flex items-center gap-2">
            <input type="checkbox" name="wh-event" value="order.created" checked>
            <code>order.created</code>
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" name="wh-event" value="order.delivered" checked>
            <code>order.delivered</code>
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" name="wh-event" value="product.updated">
            <code>product.updated</code>
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" name="wh-event" value="payout.completed">
            <code>payout.completed</code>
          </label>
        </div>
      </div>
    `;

    const modal = Modal({
      title: `📡 ${t('developer.add_webhook_modal_title')}`,
      body: modalContent,
      confirmLabel: t('common.create'),
      onConfirm: async () => {
        const url = modalContent.querySelector('#modal-webhook-url')?.value?.trim();
        const events = Array.from(modalContent.querySelectorAll('input[name="wh-event"]:checked')).map((c) => c.value);

        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
          toast.error(t('developer.error_url_required'));
          return;
        }

        try {
          await createWebhookSubscription({
            target_url: url,
            events: events.length ? events : ['order.created'],
          });
          toast.success(t('developer.webhook_created_success'));
          modal.close();
          await loadAllData();
          renderCurrentTab();
        } catch (err) {
          toast.error(err?.message || 'Failed to create webhook');
        }
      },
    });

    document.body.append(modal.element);
    modal.open();
  }

  // ---------------------------------------------------------------------------
  // TAB 3: EMBEDDABLE WIDGET STUDIO
  // ---------------------------------------------------------------------------
  function renderWidgetStudioTab() {
    const studioContainer = document.createElement('div');
    studioContainer.className = 'grid grid-cols-1 md:grid-cols-3 gap-6';

    const controlsCard = document.createElement('div');
    controlsCard.className = 'card p-5 border rounded bg-surface space-y-4';
    controlsCard.innerHTML = `
      <h3 class="text-base font-bold m-0 border-b pb-2">⚙️ ${t('developer.widget_config_title')}</h3>

      <div>
        <label for="widget-limit-input" class="block text-xs font-semibold text-muted mb-1">${t('developer.widget_limit_label')}</label>
        <input type="number" id="widget-limit-input" class="input w-full font-mono text-xs" value="4" min="1" max="12">
      </div>

      <div>
        <label for="widget-lang-select" class="block text-xs font-semibold text-muted mb-1">${t('developer.widget_lang_label')}</label>
        <select id="widget-lang-select" class="input w-full text-xs">
          <option value="en">English</option>
          <option value="bn">বাংলা (Bengali)</option>
        </select>
      </div>

      <div class="border-t pt-3">
        <label for="widget-embed-snippet" class="block text-xs font-semibold text-muted mb-1">Embed Code (Copy & Paste)</label>
        <textarea id="widget-embed-snippet" readonly class="input w-full font-mono text-xs bg-surface-subtle" rows="5"></textarea>
        <button class="btn btn-primary text-xs w-full mt-2" id="copy-snippet-btn">
          📋 ${t('developer.btn_copy_snippet')}
        </button>
      </div>
    `;

    const previewCard = document.createElement('div');
    previewCard.className = 'card p-5 border rounded bg-surface md:col-span-2 space-y-4';
    previewCard.innerHTML = `
      <div class="flex-between border-b pb-2">
        <h3 class="text-base font-bold m-0">👁️ ${t('developer.widget_live_preview')}</h3>
        <span class="badge badge-success text-xs font-mono">&lt; 15 KB Standalone</span>
      </div>

      <div id="widget-preview-host" class="border rounded p-4 bg-surface-subtle min-h-[300px]">
        <!-- Embedded widget simulates here -->
      </div>
    `;

    function updateSnippetAndPreview() {
      const limit = parseInt(controlsCard.querySelector('#widget-limit-input')?.value || '4', 10);
      const lang = controlsCard.querySelector('#widget-lang-select')?.value || 'en';

      const snippet = `<!-- Explooro Embeddable Showcase -->\n<div id="explooro-widget"></div>\n<script src="${window.location.origin}/widget.js" data-container="#explooro-widget" data-limit="${limit}" data-lang="${lang}" async></script>`;

      const snippetArea = controlsCard.querySelector('#widget-embed-snippet');
      if (snippetArea) snippetArea.value = snippet;

      // Render simulated preview
      const previewHost = previewCard.querySelector('#widget-preview-host');
      if (previewHost) {
        previewHost.innerHTML = `
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            ${Array.from({ length: limit }).map((_, i) => `
              <div class="border rounded bg-surface p-3 space-y-2 shadow-xs">
                <div class="bg-surface-subtle h-28 rounded flex items-center justify-center text-xs text-muted">Product Image #${i + 1}</div>
                <div class="font-bold text-xs truncate">${lang === 'bn' ? 'প্রিমিয়াম এক্সিকিউটিভ ড্রেস' : 'Premium Cotton Apparel'}</div>
                <div class="font-mono text-sm font-bold text-primary">৳${(1200 + i * 350).toLocaleString()}</div>
                <button class="btn btn-sm btn-primary w-full text-xs">${lang === 'bn' ? 'কিনুন ➔' : 'Buy Now ➔'}</button>
              </div>
            `).join('')}
          </div>
          <div class="text-right text-xs text-muted mt-2">Powered by <b>Explooro</b></div>
        `;
      }
    }

    controlsCard.querySelector('#widget-limit-input')?.addEventListener('input', updateSnippetAndPreview);
    controlsCard.querySelector('#widget-lang-select')?.addEventListener('change', updateSnippetAndPreview);

    controlsCard.querySelector('#copy-snippet-btn')?.addEventListener('click', () => {
      const snippet = controlsCard.querySelector('#widget-embed-snippet')?.value;
      if (snippet) {
        navigator.clipboard.writeText(snippet);
        toast.success(t('developer.snippet_copied'));
      }
    });

    studioContainer.append(controlsCard, previewCard);
    contentArea.append(studioContainer);

    updateSnippetAndPreview();
  }

  // Initial Load
  loadAllData().then(() => {
    renderCurrentTab();
  });

  root.append(container);

  return () => container.remove();
}
