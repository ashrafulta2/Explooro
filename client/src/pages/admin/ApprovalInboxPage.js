/**
 * ApprovalInboxPage.js — Single queue for Mode B (JIT) & Mode C (Maker-Checker) with Diffs & Keyboard Shortcuts (Prompt 3.3).
 */

import { Tabs } from '../../components/ui/Tabs.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatRelativeTime } from '../../services/format.js';

export default function ApprovalInboxPage() {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'approval-inbox';

  let activeTab = 'jit'; // 'jit' | 'actions'
  let jitRequests = [];
  let pendingActions = [];
  let focusedIndex = 0;

  // Header
  const header = document.createElement('div');
  header.className = 'admin-users__header';

  const titleRow = document.createElement('div');
  titleRow.style.display = 'flex';
  titleRow.style.alignItems = 'center';
  titleRow.style.justifyContent = 'space-between';

  const title = document.createElement('h1');
  title.className = 'admin-users__title';
  title.textContent = t('approvals.title');

  const shortcutHint = document.createElement('span');
  shortcutHint.className = 'text-xs text-muted';
  shortcutHint.textContent = t('approvals.keyboard_hint');

  titleRow.append(title, shortcutHint);

  const subtitle = document.createElement('p');
  subtitle.className = 'admin-users__subtitle';
  subtitle.textContent = t('approvals.subtitle');

  header.append(titleRow, subtitle);

  // Tabs
  const tabsWrap = document.createElement('div');
  const queueWrap = document.createElement('div');
  queueWrap.style.display = 'flex';
  queueWrap.style.flexDirection = 'column';
  queueWrap.style.gap = 'var(--space-4)';
  queueWrap.style.marginTop = 'var(--space-4)';

  container.append(header, tabsWrap, queueWrap);

  async function loadData() {
    try {
      const [jitRes, actionsRes] = await Promise.all([
        api.get('/access-requests', { params: { status: 'PENDING' } }).catch(() => ({ data: [] })),
        api.get('/pending-actions', { params: { status: 'PENDING' } }).catch(() => ({ data: [] })),
      ]);
      jitRequests = jitRes.data || [];
      pendingActions = actionsRes.data || [];
      renderTabs();
      renderQueue();
    } catch {
      jitRequests = [];
      pendingActions = [];
      renderTabs();
      renderQueue();
    }
  }

  function renderTabs() {
    tabsWrap.innerHTML = '';
    const tabs = Tabs({
      items: [
        { id: 'jit', label: `${t('approvals.tab_jit')} (${jitRequests.length})` },
        { id: 'actions', label: `${t('approvals.tab_actions')} (${pendingActions.length})` },
      ],
      activeId: activeTab,
      onChange: (newTab) => {
        activeTab = newTab;
        focusedIndex = 0;
        renderQueue();
      },
    });
    tabsWrap.append(tabs);
  }

  function renderQueue() {
    queueWrap.innerHTML = '';
    const items = activeTab === 'jit' ? jitRequests : pendingActions;

    if (items.length === 0) {
      const emptyCard = document.createElement('div');
      emptyCard.className = 'approval-card text-center';
      emptyCard.style.padding = 'var(--space-8)';
      emptyCard.innerHTML = `<p class="text-sm text-muted">${t('approvals.no_pending')}</p>`;
      queueWrap.append(emptyCard);
      return;
    }

    items.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = `approval-card ${idx === focusedIndex ? 'approval-card--focused' : ''}`;
      card.tabIndex = 0;

      if (activeTab === 'jit') {
        renderJitCard(card, item, idx);
      } else {
        renderActionCard(card, item, idx);
      }

      queueWrap.append(card);
    });
  }

  function renderJitCard(card, item, idx) {
    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.alignItems = 'center';
    topRow.style.justifyContent = 'space-between';

    const reqInfo = document.createElement('div');
    reqInfo.innerHTML = `
      <strong style="font-size: 15px;">${item.requester_phone || `User #${item.requester_id}`}</strong>
      <span style="font-size: 12px; color: var(--text-muted); margin-left: 8px;">Requested: <code>${item.permission_key}</code></span>
    `;

    const riskBadge = Badge({ label: item.risk_tier || 'MEDIUM', variant: 'info' });
    topRow.append(reqInfo, riskBadge);

    const reasonP = document.createElement('p');
    reasonP.className = 'text-sm text-secondary';
    reasonP.style.margin = 'var(--space-2) 0';
    reasonP.textContent = `"${item.reason}" · Submitted ${formatRelativeTime(new Date(item.created_at).getTime(), { lang: isBn ? 'bn' : 'en' })}`;

    const actionsRow = document.createElement('div');
    actionsRow.style.display = 'flex';
    actionsRow.style.gap = 'var(--space-3)';
    actionsRow.style.justifyContent = 'flex-end';

    const rejectBtn = Button({
      label: `❌ ${t('approvals.btn_reject')} (R)`,
      variant: 'danger',
      size: 'sm',
      onClick: () => handleDecideJit(item, 'REJECTED'),
    });

    const approveBtn = Button({
      label: `✅ ${t('approvals.btn_approve')} (A)`,
      variant: 'primary',
      size: 'sm',
      onClick: () => handleDecideJit(item, 'APPROVED'),
    });

    actionsRow.append(rejectBtn, approveBtn);
    card.append(topRow, reasonP, actionsRow);
  }

  function renderActionCard(card, item, idx) {
    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.alignItems = 'center';
    topRow.style.justifyContent = 'space-between';

    const actionInfo = document.createElement('div');
    actionInfo.innerHTML = `
      <strong style="font-size: 15px;">${item.action_key}</strong>
      <span style="font-size: 12px; color: var(--text-muted); margin-left: 8px;">Target: ${item.target_entity_type} #${item.target_entity_id}</span>
    `;

    const riskBadge = Badge({ label: item.risk_tier || 'HIGH', variant: 'warning' });
    topRow.append(actionInfo, riskBadge);

    const descP = document.createElement('p');
    descP.className = 'text-sm text-secondary';
    descP.style.margin = 'var(--space-2) 0';
    descP.textContent = `Submitter reason: "${item.reason || 'Operational mutation'}" · Submitted by User #${item.submitter_id} ${formatRelativeTime(new Date(item.created_at).getTime(), { lang: isBn ? 'bn' : 'en' })}`;

    // Visual Diff Viewer
    const diffWrap = document.createElement('div');
    diffWrap.className = 'approval-diff';

    const beforePane = document.createElement('div');
    beforePane.className = 'approval-diff__pane';
    beforePane.innerHTML = `<span style="font-weight: 600; color: var(--color-danger, #ef4444);">${t('approvals.diff_before')}</span>`;
    const beforePre = document.createElement('pre');
    beforePre.textContent = JSON.stringify(item.before_state_json || item.preconditions_json || {}, null, 2);
    beforePane.append(beforePre);

    const afterPane = document.createElement('div');
    afterPane.className = 'approval-diff__pane';
    afterPane.innerHTML = `<span style="font-weight: 600; color: var(--color-success, #10b981);">${t('approvals.diff_after')}</span>`;
    const afterPre = document.createElement('pre');
    afterPre.textContent = JSON.stringify(item.payload_json || {}, null, 2);
    afterPane.append(afterPre);

    diffWrap.append(beforePane, afterPane);

    const actionsRow = document.createElement('div');
    actionsRow.style.display = 'flex';
    actionsRow.style.gap = 'var(--space-3)';
    actionsRow.style.justifyContent = 'flex-end';

    const rejectBtn = Button({
      label: `❌ ${t('approvals.btn_reject')} (R)`,
      variant: 'danger',
      size: 'sm',
      onClick: () => handleDecideAction(item, 'REJECTED'),
    });

    const approveBtn = Button({
      label: `✅ ${t('approvals.btn_approve')} (A)`,
      variant: 'primary',
      size: 'sm',
      onClick: () => handleDecideAction(item, 'APPROVED'),
    });

    actionsRow.append(rejectBtn, approveBtn);
    card.append(topRow, descP, diffWrap, actionsRow);
  }

  async function handleDecideJit(item, status) {
    let note = '';
    if (status === 'REJECTED') {
      const conf = await confirmDialogWithReason({
        title: isBn ? 'জেআইটি অনুরোধ প্রত্যাখ্যান করবেন?' : 'Reject JIT Access Request?',
        description: isBn ? 'প্রত্যাখ্যানের সুনির্দিষ্ট কারণ উল্লেখ করুন।' : 'Provide a justification for rejecting this access request.',
        reasonRequired: true,
      });
      if (!conf || !conf.confirmed || !conf.reason || conf.reason.trim().length < 10) return;
      note = conf.reason.trim();
    }

    try {
      await api.patch(`/access-requests/${item.id}`, {
        status,
        approverNote: note || 'Approved by Admin',
        windowMinutes: 60,
      });
      toast.success(isBn ? `অনুরোধ ${status === 'APPROVED' ? 'অনুমোদিত' : 'প্রত্যাখ্যাত'}` : `Request ${status.toLowerCase()} successfully`);
      loadData();
    } catch (err) {
      toast.error(err.message || t('common.error_generic'));
    }
  }

  async function handleDecideAction(item, status) {
    let note = '';
    if (status === 'REJECTED') {
      const conf = await confirmDialogWithReason({
        title: isBn ? 'অ্যাকশন প্রত্যাখ্যান করবেন?' : 'Reject Maker-Checker Action?',
        description: isBn ? 'প্রত্যাখ্যানের সুনির্দিষ্ট কারণ উল্লেখ করুন।' : 'Provide a justification for rejecting this pending action.',
        reasonRequired: true,
      });
      if (!conf || !conf.confirmed || !conf.reason || conf.reason.trim().length < 10) return;
      note = conf.reason.trim();
    }

    try {
      await api.patch(`/pending-actions/${item.id}`, {
        status,
        approverNote: note || 'Approved by Admin',
      });
      toast.success(isBn ? `অ্যাকশন ${status === 'APPROVED' ? 'অনুমোদিত ও সম্পাদিত' : 'প্রত্যাখ্যাত'}` : `Action ${status.toLowerCase()} successfully`);
      loadData();
    } catch (err) {
      toast.error(err.message || t('common.error_generic'));
    }
  }

  // Keyboard navigation handler
  function handleKeyDown(e) {
    // Ignore if typing in an input/textarea
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    const items = activeTab === 'jit' ? jitRequests : pendingActions;
    if (items.length === 0) return;

    if (e.key === 'j' || e.key === 'J') {
      focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
      renderQueue();
    } else if (e.key === 'k' || e.key === 'K') {
      focusedIndex = Math.max(focusedIndex - 1, 0);
      renderQueue();
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

  return container;
}
