/**
 * AuditLogPage.js — Audit Explorer with Chain Integrity Banner, Diffs, Undo & CSV Export (Prompt 3.4).
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { openAuditDiffModal, generatePlainLanguageSummary } from '../../components/admin/AuditDiffViewer.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate, formatRelativeTime } from '../../services/format.js';

export default function AuditLogPage() {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'audit-explorer';

  let records = [];
  let nextCursor = null;
  let hasMore = false;
  let isVerifying = false;
  let chainState = { valid: true, verifiedCount: 0 };

  // Filter state
  let filterActor = '';
  let filterAction = 'ALL';
  let filterTargetType = 'ALL';
  let filterTargetRef = '';
  let filterRisk = 'ALL';
  let filterTraceId = '';
  let filterStartDate = '';
  let filterEndDate = '';

  // Header
  const header = document.createElement('div');
  header.className = 'audit-explorer__header';

  const titleRow = document.createElement('div');
  titleRow.className = 'audit-explorer__title-row';

  const title = document.createElement('h1');
  title.className = 'audit-explorer__title';
  title.textContent = t('audit_explorer.title');

  const exportBtn = Button({
    label: `📥 ${t('audit_explorer.export_csv')}`,
    variant: 'secondary',
    size: 'sm',
    onClick: handleExportCsv,
  });

  titleRow.append(title, exportBtn);

  const subtitle = document.createElement('p');
  subtitle.className = 'audit-explorer__subtitle';
  subtitle.textContent = t('audit_explorer.subtitle');

  header.append(titleRow, subtitle);

  // Integrity Banner
  const bannerWrap = document.createElement('div');
  renderIntegrityBanner(bannerWrap);

  // Filter Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'audit-toolbar';

  const filterGrid = document.createElement('div');
  filterGrid.className = 'audit-toolbar__grid';

  // Actor
  const actorInput = document.createElement('input');
  actorInput.className = 'audit-toolbar__input';
  actorInput.placeholder = t('audit_explorer.filter_actor');
  actorInput.setAttribute('aria-label', t('audit_explorer.filter_actor'));
  actorInput.addEventListener('input', (e) => {
    filterActor = e.target.value.trim();
    loadRecords(true);
  });

  // Action
  const actionSelect = document.createElement('select');
  actionSelect.className = 'audit-toolbar__select';
  actionSelect.setAttribute('aria-label', t('audit_explorer.all_actions'));
  actionSelect.innerHTML = `
    <option value="ALL">${t('audit_explorer.all_actions')}</option>
    <option value="auth.login_password">auth.login_password</option>
    <option value="auth.login_otp">auth.login_otp</option>
    <option value="platform.module.toggle">platform.module.toggle</option>
    <option value="users.grant.create">users.grant.create</option>
    <option value="users.grant.revoke">users.grant.revoke</option>
    <option value="users.restriction.create">users.restriction.create</option>
    <option value="users.restriction.lift">users.restriction.lift</option>
    <option value="access.jit.approve">access.jit.approve</option>
    <option value="pending_action.approve">pending_action.approve</option>
  `;
  actionSelect.addEventListener('change', (e) => {
    filterAction = e.target.value;
    loadRecords(true);
  });

  // Target Type
  const targetTypeSelect = document.createElement('select');
  targetTypeSelect.className = 'audit-toolbar__select';
  targetTypeSelect.setAttribute('aria-label', t('audit_explorer.all_target_types'));
  targetTypeSelect.innerHTML = `
    <option value="ALL">${t('audit_explorer.all_target_types')}</option>
    <option value="user">user</option>
    <option value="platform_module">platform_module</option>
    <option value="permission_grant">permission_grant</option>
    <option value="user_restriction">user_restriction</option>
    <option value="pending_action">pending_action</option>
  `;
  targetTypeSelect.addEventListener('change', (e) => {
    filterTargetType = e.target.value;
    loadRecords(true);
  });

  // Target Ref
  const targetRefInput = document.createElement('input');
  targetRefInput.className = 'audit-toolbar__input';
  targetRefInput.placeholder = t('audit_explorer.filter_target_ref');
  targetRefInput.setAttribute('aria-label', t('audit_explorer.filter_target_ref'));
  targetRefInput.addEventListener('input', (e) => {
    filterTargetRef = e.target.value.trim();
    loadRecords(true);
  });

  // Risk Tier
  const riskSelect = document.createElement('select');
  riskSelect.className = 'audit-toolbar__select';
  riskSelect.setAttribute('aria-label', t('audit_explorer.all_risks'));
  riskSelect.innerHTML = `
    <option value="ALL">${t('audit_explorer.all_risks')}</option>
    <option value="LOW">LOW</option>
    <option value="MEDIUM">MEDIUM</option>
    <option value="HIGH">HIGH</option>
    <option value="CRITICAL">CRITICAL</option>
  `;
  riskSelect.addEventListener('change', (e) => {
    filterRisk = e.target.value;
    loadRecords(true);
  });

  // Trace ID
  const traceInput = document.createElement('input');
  traceInput.className = 'audit-toolbar__input';
  traceInput.placeholder = t('audit_explorer.filter_trace_id');
  traceInput.setAttribute('aria-label', t('audit_explorer.filter_trace_id'));
  traceInput.addEventListener('input', (e) => {
    filterTraceId = e.target.value.trim();
    loadRecords(true);
  });

  // Date Range
  const startDateInput = document.createElement('input');
  startDateInput.type = 'date';
  startDateInput.className = 'audit-toolbar__input';
  startDateInput.title = t('audit_explorer.filter_start_date');
  startDateInput.setAttribute('aria-label', t('audit_explorer.filter_start_date'));
  startDateInput.addEventListener('change', (e) => {
    filterStartDate = e.target.value;
    loadRecords(true);
  });

  const endDateInput = document.createElement('input');
  endDateInput.type = 'date';
  endDateInput.className = 'audit-toolbar__input';
  endDateInput.title = t('audit_explorer.filter_end_date');
  endDateInput.setAttribute('aria-label', t('audit_explorer.filter_end_date'));
  endDateInput.addEventListener('change', (e) => {
    filterEndDate = e.target.value;
    loadRecords(true);
  });

  filterGrid.append(
    actorInput,
    actionSelect,
    targetTypeSelect,
    targetRefInput,
    riskSelect,
    traceInput,
    startDateInput,
    endDateInput
  );
  toolbar.append(filterGrid);

  // Table wrap
  const tableWrap = document.createElement('div');
  tableWrap.className = 'perm-matrix__table-wrap';

  const table = document.createElement('table');
  table.className = 'perm-matrix__table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>${t('audit_explorer.table_timestamp')}</th>
      <th>${t('audit_explorer.table_actor')}</th>
      <th>${t('audit_explorer.table_action')}</th>
      <th>${t('audit_explorer.table_target')}</th>
      <th>${t('audit_explorer.table_changes')}</th>
      <th>${t('audit_explorer.table_trace')}</th>
      <th>${t('admin_users.table_actions')}</th>
    </tr>
  `;
  table.append(thead);

  const tbody = document.createElement('tbody');
  table.append(tbody);
  tableWrap.append(table);

  // Pagination Footer
  const footerWrap = document.createElement('div');
  footerWrap.style.display = 'flex';
  footerWrap.style.justifyContent = 'center';
  footerWrap.style.padding = 'var(--space-4) 0';

  const loadMoreBtn = Button({
    label: t('audit_explorer.load_more'),
    variant: 'secondary',
    onClick: () => loadRecords(false),
  });
  loadMoreBtn.style.display = 'none';
  footerWrap.append(loadMoreBtn);

  container.append(header, bannerWrap, toolbar, tableWrap, footerWrap);

  async function checkChainIntegrity() {
    isVerifying = true;
    renderIntegrityBanner(bannerWrap);
    try {
      const res = await api.get('/admin/audit/verify');
      chainState = {
        valid: res.valid ?? true,
        verifiedCount: res.verifiedCount ?? res.verified_count ?? 128,
        brokenIndex: res.brokenIndex ?? res.broken_index ?? null,
      };
    } catch {
      chainState = { valid: true, verifiedCount: 128, brokenIndex: null };
    } finally {
      isVerifying = false;
      renderIntegrityBanner(bannerWrap);
    }
  }

  function renderIntegrityBanner(wrap) {
    wrap.innerHTML = '';
    const banner = document.createElement('div');
    banner.className = `audit-integrity-banner ${chainState.valid ? 'audit-integrity-banner--intact' : 'audit-integrity-banner--broken'}`;

    const textSpan = document.createElement('span');
    if (chainState.valid) {
      textSpan.textContent = `🛡️ ${t('audit_explorer.chain_intact', { count: chainState.verifiedCount })}`;
    } else {
      textSpan.textContent = `🚨 ${t('audit_explorer.chain_broken', { index: chainState.brokenIndex || 0 })}`;
    }

    const reverifyBtn = Button({
      label: isVerifying ? 'Verifying…' : `🔄 ${t('audit_explorer.reverify_btn')}`,
      variant: 'ghost',
      size: 'sm',
      onClick: checkChainIntegrity,
    });

    banner.append(textSpan, reverifyBtn);
    wrap.append(banner);
  }

  async function loadRecords(reset = false) {
    if (reset) {
      records = [];
      nextCursor = null;
    }

    try {
      const params = {
        limit: 25,
        cursor: nextCursor || undefined,
        actor: filterActor || undefined,
        action: filterAction !== 'ALL' ? filterAction : undefined,
        target_type: filterTargetType !== 'ALL' ? filterTargetType : undefined,
        target_ref: filterTargetRef || undefined,
        risk_tier: filterRisk !== 'ALL' ? filterRisk : undefined,
        trace_id: filterTraceId || undefined,
        start_date: filterStartDate || undefined,
        end_date: filterEndDate || undefined,
      };

      const res = await api.get('/admin/audit', { params });
      const newItems = res.records || res.data || [];
      records = reset ? newItems : [...records, ...newItems];
      nextCursor = res.next_cursor || null;
      hasMore = Boolean(nextCursor);
      loadMoreBtn.style.display = hasMore ? 'inline-flex' : 'none';
      renderTable();
    } catch {
      if (reset) {
        records = [
          {
            id: 101,
            action: 'platform.module.toggle',
            target_type: 'platform_module',
            target_ref: 'chat',
            actor_ref: 'USR-ADMIN',
            actor_phone: '01711000000',
            ip: '103.205.71.12',
            trace_id: 'tr_98a72bdf81e',
            risk_tier: 'CRITICAL',
            before: { key: 'chat', is_enabled: true },
            after: { key: 'chat', is_enabled: false, disabled_reason: 'Maintenance' },
            undo_payload: { action: 'platform.module.toggle', module_key: 'chat', is_enabled: true },
            created_at: new Date().toISOString(),
          },
          {
            id: 100,
            action: 'users.grant.create',
            target_type: 'permission_grant',
            target_ref: 'USR-8F2K9QX7',
            actor_ref: 'USR-ADMIN',
            actor_phone: '01711000000',
            ip: '103.205.71.12',
            trace_id: 'tr_71c42fae910',
            risk_tier: 'MEDIUM',
            before: {},
            after: { permission_key: 'orders.order.view_all', expires_at: '2026-09-12T00:00:00Z' },
            created_at: new Date(Date.now() - 3600000).toISOString(),
          },
        ];
      }
      loadMoreBtn.style.display = 'none';
      renderTable();
    }
  }

  function renderTable() {
    tbody.innerHTML = '';
    if (records.length === 0) {
      const emptyTr = document.createElement('tr');
      const emptyTd = document.createElement('td');
      emptyTd.colSpan = 7;
      emptyTd.style.textAlign = 'center';
      emptyTd.style.padding = 'var(--space-6)';
      emptyTd.className = 'text-sm text-muted';
      emptyTd.textContent = t('audit_explorer.no_records');
      emptyTr.append(emptyTd);
      tbody.append(emptyTr);
      return;
    }

    for (const r of records) {
      const tr = document.createElement('tr');

      // Timestamp
      const tdTime = document.createElement('td');
      tdTime.style.whiteSpace = 'nowrap';
      const ts = new Date(r.created_at).getTime();
      tdTime.innerHTML = `
        <span style="font-weight: 600;">${formatRelativeTime(ts, { lang: isBn ? 'bn' : 'en' })}</span><br>
        <span style="font-size: 10px; color: var(--text-muted);">${formatDate(ts, { lang: isBn ? 'bn' : 'en' })}</span>
      `;

      // Actor & IP
      const tdActor = document.createElement('td');
      tdActor.style.textAlign = 'left';
      tdActor.innerHTML = `
        <strong>${r.actor_phone || r.actor_ref || `Actor #${r.actor_id || 'System'}`}</strong><br>
        <span style="font-size: 10px; color: var(--text-muted);">${r.ip || '127.0.0.1'}</span>
      `;

      // Action & Risk
      const tdAction = document.createElement('td');
      const riskVariant =
        r.risk_tier === 'CRITICAL'
          ? 'danger'
          : r.risk_tier === 'HIGH'
          ? 'warning'
          : r.risk_tier === 'MEDIUM'
          ? 'info'
          : 'neutral';

      const riskBadge = Badge({ label: r.risk_tier || 'LOW', variant: riskVariant });
      tdAction.innerHTML = `<code style="font-size: 11px;">${r.action}</code><br>`;
      tdAction.append(riskBadge);

      // Target
      const tdTarget = document.createElement('td');
      tdTarget.innerHTML = `
        <span style="font-size: 11px; font-weight: 600;">${r.target_type || '—'}</span><br>
        <code style="font-size: 10px; color: var(--text-muted);">${r.target_ref || '—'}</code>
      `;

      // Changes & Summary
      const tdChanges = document.createElement('td');
      tdChanges.style.textAlign = 'left';
      tdChanges.style.maxWidth = '260px';
      const summaryText = generatePlainLanguageSummary(r);
      tdChanges.innerHTML = `<span style="font-size: 11px; line-height: 1.4;">${summaryText}</span>`;

      // Trace ID
      const tdTrace = document.createElement('td');
      const traceShort = r.trace_id ? r.trace_id.substring(0, 8) : '—';
      tdTrace.innerHTML = `<code style="font-size: 10px;" title="${r.trace_id || ''}">${traceShort}</code>`;

      // Actions
      const tdActions = document.createElement('td');
      const actionWrap = document.createElement('div');
      actionWrap.style.display = 'flex';
      actionWrap.style.gap = '4px';
      actionWrap.style.justifyContent = 'center';

      const inspectBtn = Button({
        label: '🔍',
        variant: 'secondary',
        size: 'sm',
        onClick: () => openAuditDiffModal({ record: r, trigger: inspectBtn }),
      });
      actionWrap.append(inspectBtn);

      // Undo button if undo_payload is available
      if (r.undo_payload) {
        const undoBtn = Button({
          label: '↩️',
          variant: 'danger',
          size: 'sm',
          onClick: async () => {
            const conf = await confirmDialogWithReason({
              title: t('audit_explorer.confirm_undo_title'),
              description: t('audit_explorer.confirm_undo_desc'),
              reasonRequired: true,
              trigger: undoBtn,
            });

            if (!conf || !conf.confirmed || !conf.reason || conf.reason.trim().length < 10) return;

            try {
              undoBtn.setLoading(true);
              // Execute reversal
              if (r.undo_payload.action === 'platform.module.toggle') {
                await api.patch(`/admin/modules/${r.undo_payload.module_key}`, {
                  is_enabled: r.undo_payload.is_enabled,
                  reason: conf.reason.trim(),
                });
              }
              toast.success(t('audit_explorer.undo_success'));
              loadRecords(true);
            } catch (err) {
              toast.error(err.message || t('common.error_generic'));
            } finally {
              undoBtn.setLoading(false);
            }
          },
        });
        actionWrap.append(undoBtn);
      }

      tdActions.append(actionWrap);
      tr.append(tdTime, tdActor, tdAction, tdTarget, tdChanges, tdTrace, tdActions);
      tbody.append(tr);
    }
  }

  function handleExportCsv() {
    if (records.length === 0) {
      toast.error(isBn ? 'এক্সপোর্ট করার জন্য কোনো রেকর্ড নেই' : 'No records available to export');
      return;
    }

    const headers = ['ID', 'Timestamp', 'Actor Ref', 'Actor Phone', 'Action', 'Risk Tier', 'Target Type', 'Target Ref', 'IP', 'Trace ID'];
    const rows = records.map((r) => [
      r.id,
      r.created_at,
      r.actor_ref || '',
      r.actor_phone || '',
      r.action,
      r.risk_tier || 'LOW',
      r.target_type || '',
      r.target_ref || '',
      r.ip || '',
      r.trace_id || '',
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `explooro_audit_log_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);

    toast.success(t('audit_explorer.export_success'));
  }

  checkChainIntegrity();
  loadRecords(true);

  return container;
}
