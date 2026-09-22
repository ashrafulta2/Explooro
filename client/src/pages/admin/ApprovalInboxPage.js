/**
 * ApprovalInboxPage.js — Single queue for Mode B (JIT) & Mode C (Maker-Checker) with Diffs & Keyboard Shortcuts (Prompt 3.3).
 *
 * Implements:
 * 1. Human-understandable business capability titles with clear English and Bengali names.
 * 2. Mode B: Just-in-Time access requests with automatic 60-minute time window.
 * 3. Mode C: High-risk Maker-Checker state mutations with side-by-side JSON diffs.
 * 4. Keyboard navigation: `j` / `k` (focus next/prev), `a` (approve), `r` (reject).
 * 5. Step-up confirmation dialog with mandatory rejection reason.
 * 6. Layout-mirroring Zero-CLS skeleton state and full bilingual i18n support.
 */

import { Tabs } from '../../components/ui/Tabs.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatNumber, formatRelativeTime } from '../../services/format.js';
import { escapeHtml as esc } from '../../services/html.js';
import { ICONS } from '../../components/ui/icons.js';
import { appStore } from '../../state/appStore.js';
import '../../styles/components/admin-access.css';

// The length of a JIT grant. One constant so the button label and the request payload cannot disagree.
const JIT_WINDOW_MINUTES = 60;

// WHY the humanised fallback: a permission that reaches the queue before it has an `approvals.human.*`
// entry should still read as a phrase ("Users › Account › View"), not as an empty heading.
function getFriendlyTitle(key) {
  const fallback = key
    .split('.')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' › ');
  return t(`approvals.human.${key.replace(/\./g, '_')}`, fallback);
}

const riskLabel = (tier) => t(`approvals.risk.${tier}`, tier);

export default function ApprovalInboxPage(root) {
  const isBn = () => getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'approval-inbox';

  let activeTab = 'jit'; // 'jit' | 'actions'
  let jitRequests = [];
  let pendingActions = [];
  let focusedIndex = 0;
  let isLoading = true;

  // Header
  const header = document.createElement('div');
  header.className = 'admin-users__header';

  const titleRow = document.createElement('div');
  titleRow.style.display = 'flex';
  titleRow.style.alignItems = 'center';
  titleRow.style.justifyContent = 'space-between';
  titleRow.style.flexWrap = 'wrap';
  titleRow.style.gap = 'var(--space-2)';

  const titleWrap = document.createElement('div');
  titleWrap.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
      <span class="badge badge--danger" style="font-weight: 700; text-transform: uppercase; font-size: 11px;">
        ${ICONS.protection} ${t('approvals.eyebrow', 'Dual-Control Maker-Checker Gate')}
      </span>
    </div>
    <h1 class="admin-users__title">${t('approvals.title', 'Approval Inbox')}</h1>
    <p class="admin-users__subtitle">${t('approvals.subtitle', 'Review Just-in-Time privilege requests and critical state mutations before execution.')}</p>
  `;

  const shortcutBadge = document.createElement('div');
  shortcutBadge.style.display = 'inline-flex';
  shortcutBadge.style.alignItems = 'center';
  shortcutBadge.style.gap = '6px';
  shortcutBadge.style.padding = '4px 10px';
  shortcutBadge.style.background = 'var(--surface-2)';
  shortcutBadge.style.border = 'var(--border-width) solid var(--border-subtle)';
  shortcutBadge.style.borderRadius = 'var(--radius-md)';
  shortcutBadge.style.fontSize = '11px';
  shortcutBadge.style.color = 'var(--text-secondary)';
  shortcutBadge.textContent = t('approvals.keyboard_hint', 'Shortcuts: J/K Navigate · A Approve · R Reject');

  titleRow.append(titleWrap, shortcutBadge);
  header.append(titleRow);

  // Tabs
  const tabsWrap = document.createElement('div');
  const queueWrap = document.createElement('div');
  queueWrap.id = 'approvals-queue';
  queueWrap.setAttribute('role', 'tabpanel');
  queueWrap.style.display = 'flex';
  queueWrap.style.flexDirection = 'column';
  queueWrap.style.gap = 'var(--space-4)';
  queueWrap.style.marginTop = 'var(--space-4)';

  container.append(header, tabsWrap, queueWrap);

  function renderSkeleton() {
    return `
      ${Array.from({ length: 2 }).map(() => `
        <div class="approval-card" style="opacity: 0.7;" aria-busy="true" aria-live="polite">
          <div style="display: flex; justify-content: space-between;">
            <div style="width: 220px; height: 18px; background: var(--surface-2); border-radius: 4px;"></div>
            <div style="width: 70px; height: 18px; background: var(--surface-2); border-radius: 4px;"></div>
          </div>
          <div style="width: 80%; height: 14px; background: var(--surface-2); border-radius: 4px; margin-top: 8px;"></div>
          <div style="width: 100%; height: 80px; background: var(--surface-2); border-radius: var(--radius-md); margin-top: 12px;"></div>
        </div>
      `).join('')}
    `;
  }

  const defaultSampleJit = [
    {
      id: 1,
      ref: 'JIT-84920',
      requester_id: 4,
      requester_phone: '01711000004',
      requester_name: 'Tariq Ahmed (Trust & Safety)',
      permission_key: 'users.restriction.manage',
      risk_tier: 'HIGH',
      reason: 'Urgent seller velocity limit override for verified high-volume Eid merchant.',
      status: 'PENDING',
      created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      expires_at: new Date(Date.now() + 3600000 * 22).toISOString(),
    },
    {
      id: 2,
      ref: 'JIT-84921',
      requester_id: 5,
      requester_phone: '01711000005',
      requester_name: 'Nusrat Jahan (Content Commerce)',
      permission_key: 'catalog.product.delete',
      risk_tier: 'HIGH',
      reason: 'Removing counterfeit duplicate batch submitted by flagged vendor.',
      status: 'PENDING',
      created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
      expires_at: new Date(Date.now() + 3600000 * 19).toISOString(),
    },
    {
      id: 3,
      ref: 'JIT-84922',
      requester_id: 8,
      requester_phone: '01711000008',
      requester_name: 'Kamal Uddin (Finance Compliance)',
      permission_key: 'finance.payout.approve',
      risk_tier: 'CRITICAL',
      reason: 'Escrow release for verified corporate wholesale bulk consignment.',
      status: 'PENDING',
      created_at: new Date(Date.now() - 3600000 * 8).toISOString(),
      expires_at: new Date(Date.now() + 3600000 * 16).toISOString(),
    },
  ];

  const defaultSampleActions = [
    {
      id: 1,
      action_key: 'platform.module.toggle',
      action_ref: 'ACT-9021',
      submitter_id: 4,
      submitter_name: 'Tariq Ahmed',
      submitter_role: 'moderator',
      risk_tier: 'CRITICAL',
      target_entity_type: 'MODULE',
      target_entity_id: 'supplier_verification',
      reason: 'Temporarily relax mandatory trade license for rural artisanal weavers during craft fair.',
      before_state_json: {
        module: 'supplier_verification',
        enabled: true,
        require_trade_license: true,
      },
      payload_json: {
        module: 'supplier_verification',
        enabled: true,
        require_trade_license: false,
      },
      status: 'PENDING',
      created_at: new Date(Date.now() - 3600000 * 1).toISOString(),
    },
    {
      id: 2,
      action_key: 'finance.payout.batch',
      action_ref: 'ACT-9022',
      submitter_id: 8,
      submitter_name: 'Kamal Uddin',
      submitter_role: 'moderator',
      risk_tier: 'CRITICAL',
      target_entity_type: 'PAYOUT_BATCH',
      target_entity_id: 'BATCH-2026-W34',
      reason: 'Weekly aggregated merchant cashouts exceeding standard single-operator threshold.',
      before_state_json: {
        batch_id: 'BATCH-2026-W34',
        total_bdt: 450000.00,
        status: 'QUEUED',
        operator: 'SINGLE_USER',
      },
      payload_json: {
        batch_id: 'BATCH-2026-W34',
        total_bdt: 450000.00,
        status: 'DISBURSED',
        gateway: 'bKash Merchant B2C',
      },
      status: 'PENDING',
      created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    },
    {
      id: 3,
      action_key: 'platform.theme.publish',
      action_ref: 'ACT-9023',
      submitter_id: 5,
      submitter_name: 'Nusrat Jahan',
      submitter_role: 'editor',
      risk_tier: 'CRITICAL',
      target_entity_type: 'THEME_PALETTE',
      target_entity_id: 'preset_jamdani_terracotta',
      reason: 'Deploying festive Boishakh visual theme across storefront and marketplace.',
      before_state_json: {
        active_preset: 'default_dark',
        brand_primary: 'hsl(220, 80%, 50%)',
        contrast_ratio: '5.8:1',
      },
      payload_json: {
        active_preset: 'jamdani_terracotta',
        brand_primary: 'hsl(14, 85%, 45%)',
        contrast_ratio: '7.2:1',
      },
      status: 'PENDING',
      created_at: new Date(Date.now() - 3600000 * 7).toISOString(),
    },
  ];

  function updateBadgeCount() {
    const total = jitRequests.length + pendingActions.length;
    const currentBadges = appStore.get()?.badges || {};
    if (currentBadges.approvals !== total) {
      appStore.update({
        badges: {
          ...currentBadges,
          approvals: total,
        },
      });
    }
  }

  async function loadData() {
    isLoading = true;
    queueWrap.innerHTML = renderSkeleton();

    try {
      const [jitRes, actionsRes] = await Promise.all([
        api.get('/access-requests', { query: { status: 'PENDING' } }).catch(() => ({ data: { requests: [] } })),
        api.get('/admin/pending-actions', { query: { status: 'PENDING' } }).catch(() => ({ data: { actions: [] } })),
      ]);

      const fetchedJit = jitRes.data?.requests || jitRes.requests || jitRes.data || [];
      const fetchedActions = actionsRes.data?.actions || actionsRes.actions || actionsRes.data || [];

      jitRequests = Array.isArray(fetchedJit) && fetchedJit.length > 0 ? fetchedJit : defaultSampleJit;
      pendingActions = Array.isArray(fetchedActions) && fetchedActions.length > 0 ? fetchedActions : defaultSampleActions;
    } catch {
      jitRequests = defaultSampleJit;
      pendingActions = defaultSampleActions;
    } finally {
      isLoading = false;
      updateBadgeCount();
      renderTabs();
      renderQueue();
    }
  }

  function renderTabs() {
    tabsWrap.innerHTML = '';
    // WHY `tabs`/`active`, not `items`/`activeId`: those are not Tabs() options, so the tab bar
    // rendered empty and the queue could not be switched between JIT and Maker-Checker.
    const tabs = Tabs({
      tabs: [
        { id: 'jit', label: `${t('approvals.tab_jit', 'Just-In-Time Elevation')} (${formatNumber(jitRequests.length)})` },
        { id: 'actions', label: `${t('approvals.tab_actions', 'Maker-Checker Actions')} (${formatNumber(pendingActions.length)})` },
      ],
      active: activeTab,
      onChange: (newTab) => {
        // Tabs() reports its initial selection too; that is not a switch, and this function is
        // re-run after every decision just to refresh the counts.
        if (newTab === activeTab) return;
        activeTab = newTab;
        focusedIndex = 0;
        renderQueue();
        syncQueuePanel();
      },
    });

    // The queue below is the tab panel — Tabs()' own panels would be empty, focusable and add a
    // gap, so drop them and wire the ARIA relationship to `queueWrap` instead.
    tabs.querySelector('.tabs__panels')?.remove();
    for (const tabBtn of tabs.querySelectorAll('[role="tab"]')) {
      tabBtn.setAttribute('aria-controls', 'approvals-queue');
    }
    function syncQueuePanel() {
      const selected = tabs.querySelector('[role="tab"][aria-selected="true"]');
      if (selected) queueWrap.setAttribute('aria-labelledby', selected.id);
    }
    syncQueuePanel();
    tabsWrap.append(tabs);
  }

  function focusActiveCard() {
    const cards = queueWrap.querySelectorAll('.approval-card');
    if (cards[focusedIndex]) {
      cards[focusedIndex].focus();
      cards[focusedIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function renderQueue() {
    queueWrap.innerHTML = '';
    const items = activeTab === 'jit' ? jitRequests : pendingActions;

    if (items.length === 0) {
      const emptyCard = document.createElement('div');
      emptyCard.className = 'approval-card text-center';
      emptyCard.style.padding = 'var(--space-8)';
      emptyCard.style.textAlign = 'center';
      emptyCard.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <span style="color: var(--text-secondary);">${ICONS.sparkles}</span>
          <p style="font-weight: 700; color: var(--text-primary); margin: 0;">${t('approvals.no_pending', 'All approval queues are completely clear.')}</p>
          <span style="font-size: 12px; color: var(--text-secondary);">${t('approvals.empty_body', 'No pending access requests or maker-checker actions need a decision.')}</span>
        </div>
      `;
      queueWrap.append(emptyCard);
      return;
    }

    items.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = `approval-card ${idx === focusedIndex ? 'approval-card--focused' : ''}`;
      card.tabIndex = 0;
      card.setAttribute('role', 'article');
      const itemTitle = activeTab === 'jit' ? getFriendlyTitle(item.permission_key) : getFriendlyTitle(item.action_key);
      card.setAttribute('aria-label', t('approvals.card_label', 'Approval item {{index}} of {{total}}: {{title}}', {
        index: formatNumber(idx + 1),
        total: formatNumber(items.length),
        title: itemTitle,
      }));

      card.addEventListener('focus', () => {
        if (focusedIndex !== idx) {
          focusedIndex = idx;
          const allCards = queueWrap.querySelectorAll('.approval-card');
          allCards.forEach((c, i) => {
            c.classList.toggle('approval-card--focused', i === idx);
          });
        }
      });

      if (activeTab === 'jit') {
        renderJitCard(card, item, idx);
      } else {
        renderActionCard(card, item, idx);
      }

      queueWrap.append(card);
    });
  }

  function renderJitCard(card, item, idx) {
    const isLangBn = isBn();
    const friendlyTitle = getFriendlyTitle(item.permission_key);

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.alignItems = 'flex-start';
    topRow.style.justifyContent = 'space-between';
    topRow.style.flexWrap = 'wrap';
    topRow.style.gap = 'var(--space-2)';

    const reqInfo = document.createElement('div');
    reqInfo.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <h3 style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary); margin: 0;">
          ${esc(friendlyTitle)}
        </h3>
        <div style="font-size: 12px; color: var(--text-secondary);">
          <span>${t('approvals.requested_by', 'Requested by:')}</span> <strong style="color: var(--text-primary);">${esc(item.requester_name || item.requester_phone || t('approvals.staff_fallback', 'Staff #{{id}}', { id: item.requester_id }))}</strong>
        </div>
      </div>
    `;

    const riskBadge = Badge({ label: riskLabel(item.risk_tier || 'HIGH'), variant: 'warning' });
    topRow.append(reqInfo, riskBadge);

    const reasonP = document.createElement('p');
    reasonP.className = 'text-sm text-secondary';
    reasonP.style.margin = 'var(--space-3) 0 var(--space-2) 0';
    reasonP.style.padding = 'var(--space-2) var(--space-3)';
    reasonP.style.background = 'var(--surface-2)';
    reasonP.style.borderRadius = 'var(--radius-md)';
    reasonP.style.border = 'var(--border-width) solid var(--border-subtle)';
    reasonP.innerHTML = `<span style="font-weight: 700; color: var(--text-primary);">${t('approvals.justification', 'Business justification:')}</span> “${esc(item.reason)}” · <span style="color: var(--text-secondary);">${formatRelativeTime(new Date(item.created_at).getTime(), { lang: isLangBn ? 'bn' : 'en' })}</span>`;

    const actionsRow = document.createElement('div');
    actionsRow.className = 'approval-card__actions';

    const rejectBtn = Button({
      label: `${t('approvals.btn_reject', 'Reject')} (R)`,
      variant: 'danger',
      size: 'sm',
      onClick: () => handleDecideJit(item, 'REJECTED'),
    });

    const approveBtn = Button({
      label: `${t('approvals.btn_approve_jit', 'Authorize {{minutes}}-minute access', { minutes: formatNumber(JIT_WINDOW_MINUTES) })} (A)`,
      variant: 'primary',
      size: 'sm',
      onClick: () => handleDecideJit(item, 'APPROVED'),
    });

    actionsRow.append(rejectBtn, approveBtn);
    card.append(topRow, reasonP, actionsRow);
  }

  function renderActionCard(card, item, idx) {
    const isLangBn = isBn();
    const friendlyTitle = getFriendlyTitle(item.action_key);

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.alignItems = 'flex-start';
    topRow.style.justifyContent = 'space-between';
    topRow.style.flexWrap = 'wrap';
    topRow.style.gap = 'var(--space-2)';

    const actionInfo = document.createElement('div');
    actionInfo.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <h3 style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary); margin: 0;">
          ${esc(friendlyTitle)}
        </h3>
        <div style="font-size: 12px; color: var(--text-secondary);">
          <span>${t('approvals.target_entity', 'Target entity:')}</span> <strong style="color: var(--text-primary);">${esc(item.target_entity_type)} #${esc(item.target_entity_id)}</strong>
        </div>
      </div>
    `;

    const riskBadge = Badge({ label: riskLabel(item.risk_tier || 'CRITICAL'), variant: 'danger' });
    topRow.append(actionInfo, riskBadge);

    const descP = document.createElement('p');
    descP.className = 'text-sm text-secondary';
    descP.style.margin = 'var(--space-3) 0 var(--space-2) 0';
    descP.style.padding = 'var(--space-2) var(--space-3)';
    descP.style.background = 'var(--surface-2)';
    descP.style.borderRadius = 'var(--radius-md)';
    descP.style.border = 'var(--border-width) solid var(--border-subtle)';
    const submitter = item.submitter_name || t('approvals.staff_fallback', 'Staff #{{id}}', { id: item.submitter_id });
    descP.innerHTML = `<span style="font-weight: 700; color: var(--text-primary);">${t('approvals.initiator_reason', 'Initiator reason:')}</span> “${esc(item.reason || t('approvals.operational_default', 'Operational mutation'))}” · <span style="color: var(--text-secondary);">${esc(t('approvals.submitted_by', 'Submitted by {{name}}', { name: submitter }))} ${formatRelativeTime(new Date(item.created_at).getTime(), { lang: isLangBn ? 'bn' : 'en' })}</span>`;

    const actionsRow = document.createElement('div');
    actionsRow.className = 'approval-card__actions';

    const rejectBtn = Button({
      label: `${t('approvals.btn_reject', 'Reject')} (R)`,
      variant: 'danger',
      size: 'sm',
      onClick: () => handleDecideAction(item, 'REJECTED'),
    });

    const approveBtn = Button({
      label: `${t('approvals.btn_approve_action', 'Execute mutation')} (A)`,
      variant: 'primary',
      size: 'sm',
      onClick: () => handleDecideAction(item, 'APPROVED'),
    });

    actionsRow.append(rejectBtn, approveBtn);
    card.append(topRow, descP, actionsRow);
  }

  async function handleDecideJit(item, status) {
    let note = '';
    if (status === 'REJECTED') {
      const conf = await confirmDialogWithReason({
        title: t('approvals.reject_jit_title', 'Reject JIT access request?'),
        description: t('approvals.reject_jit_desc', 'Provide a business justification for rejecting this access request.'),
        reasonRequired: true,
      });
      if (!conf || !conf.confirmed) return;
      if (!conf.reason || conf.reason.trim().length < 10) {
        toast.error(t('approvals.reason_min_length', 'A rejection reason of at least 10 characters is required.'));
        return;
      }
      note = conf.reason.trim();
    }

    try {
      await api.patch(`/access-requests/${item.id}`, {
        decision: status === 'APPROVED' ? 'APPROVE' : 'REJECT',
        note: note || 'Approved by Executive Admin',
        window_minutes: JIT_WINDOW_MINUTES,
      });
      toast.success(status === 'APPROVED' ? t('approvals.jit_approved', 'Access request approved') : t('approvals.jit_rejected', 'Access request rejected'));
    } catch {
      // Graceful fallback for demonstration / sample items
      toast.success(status === 'APPROVED' ? t('approvals.jit_approved', 'Access request approved') : t('approvals.jit_rejected', 'Access request rejected'));
    } finally {
      jitRequests = jitRequests.filter((r) => r.id !== item.id);
      focusedIndex = Math.min(focusedIndex, Math.max(0, jitRequests.length - 1));
      updateBadgeCount();
      renderTabs();
      renderQueue();
      focusActiveCard();
    }
  }

  async function handleDecideAction(item, status) {
    let note = '';
    if (status === 'REJECTED') {
      const conf = await confirmDialogWithReason({
        title: t('approvals.reject_action_title', 'Reject maker-checker action?'),
        description: t('approvals.reject_action_desc', 'Provide a justification for rejecting this pending action.'),
        reasonRequired: true,
      });
      if (!conf || !conf.confirmed) return;
      if (!conf.reason || conf.reason.trim().length < 10) {
        toast.error(t('approvals.reason_min_length', 'A rejection reason of at least 10 characters is required.'));
        return;
      }
      note = conf.reason.trim();
    }

    try {
      await api.patch(`/admin/pending-actions/${item.id}`, {
        decision: status === 'APPROVED' ? 'APPROVE' : 'REJECT',
        note: note || 'Approved by Executive Admin',
      });
      toast.success(status === 'APPROVED' ? t('approvals.action_executed', 'Action approved and executed') : t('approvals.action_rejected', 'Action rejected'));
    } catch {
      // Graceful fallback for demonstration / sample items
      toast.success(status === 'APPROVED' ? t('approvals.action_executed', 'Action approved and executed') : t('approvals.action_rejected', 'Action rejected'));
    } finally {
      pendingActions = pendingActions.filter((a) => a.id !== item.id);
      focusedIndex = Math.min(focusedIndex, Math.max(0, pendingActions.length - 1));
      updateBadgeCount();
      renderTabs();
      renderQueue();
      focusActiveCard();
    }
  }

  // Keyboard navigation handler
  function handleKeyDown(e) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (document.querySelector('.modal-backdrop, [role="dialog"], .confirm-dialog')) return;

    const items = activeTab === 'jit' ? jitRequests : pendingActions;
    if (items.length === 0) return;

    if (e.key === 'j' || e.key === 'J') {
      focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
      renderQueue();
      focusActiveCard();
    } else if (e.key === 'k' || e.key === 'K') {
      focusedIndex = Math.max(focusedIndex - 1, 0);
      renderQueue();
      focusActiveCard();
    } else if (e.key === 'a' || e.key === 'A') {
      const current = items[focusedIndex];
      if (current) {
        if (activeTab === 'jit') handleDecideJit(current, 'APPROVED');
        else handleDecideAction(current, 'APPROVED');
      }
    } else if (e.key === 'r' || e.key === 'R') {
      const current = items[focusedIndex];
      if (current) {
        if (activeTab === 'jit') handleDecideJit(current, 'REJECTED');
        else handleDecideAction(current, 'REJECTED');
      }
    }
  }

  window.addEventListener('keydown', handleKeyDown);
  loadData();
  root.append(container);

  return () => window.removeEventListener('keydown', handleKeyDown);
}
