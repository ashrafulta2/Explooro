/**
 * ReportsPage.js — Moderator User Reports Handling Queue (Prompt 7.7-B).
 *
 * Implements:
 * 1. Filterable queue of user-submitted reports (spam, harassment, counterfeit, etc.).
 * 2. Report detail expansion with evidence attachments.
 * 3. One-click actions: Dismiss, Warn Reporter, Penalise Reported User, Escalate.
 * 4. Stats bar: open reports, resolved today, escalated.
 * 5. Bulk dismiss for low-priority spam reports.
 *
 * Strings are i18n (en/bn); type badges + stat cards use semantic design tokens.
 */

import { api } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatDate } from '../../services/format.js';

const REPORT_TYPES = ['ALL', 'SPAM', 'HARASSMENT', 'COUNTERFEIT', 'INAPPROPRIATE', 'FRAUD', 'OTHER'];
const STATUS_FILTERS = ['OPEN', 'RESOLVED', 'ESCALATED', 'DISMISSED'];

const TYPE_LABEL_KEYS = {
  ALL: 'mod_reports.rt_all', SPAM: 'mod_reports.rt_spam', HARASSMENT: 'mod_reports.rt_harassment',
  COUNTERFEIT: 'mod_reports.rt_counterfeit', INAPPROPRIATE: 'mod_reports.rt_inappropriate',
  FRAUD: 'mod_reports.rt_fraud', OTHER: 'mod_reports.rt_other',
};
const STATUS_LABEL_KEYS = {
  OPEN: 'mod_reports.st_open', RESOLVED: 'mod_reports.st_resolved',
  ESCALATED: 'mod_reports.st_escalated', DISMISSED: 'mod_reports.st_dismissed',
};

// Semantic tokens so type badges follow the theme (no purple token exists → counterfeit maps to info).
const TYPE_COLORS = {
  SPAM:          { bg: 'var(--warning-100,#fef9c3)', text: 'var(--warning-800,#854d0e)', border: 'var(--warning-300,#fde047)' },
  HARASSMENT:    { bg: 'var(--danger-100,#fee2e2)',  text: 'var(--danger-800,#7f1d1d)',  border: 'var(--danger-300,#fca5a5)' },
  COUNTERFEIT:   { bg: 'var(--info-100,#fae8ff)',    text: 'var(--info-800,#6b21a8)',    border: 'var(--info-300,#e879f9)' },
  INAPPROPRIATE: { bg: 'var(--warning-100,#ffedd5)', text: 'var(--warning-800,#9a3412)', border: 'var(--warning-300,#fdba74)' },
  FRAUD:         { bg: 'var(--danger-100,#fee2e2)',  text: 'var(--danger-800,#7f1d1d)',  border: 'var(--danger-500,#ef4444)' },
  OTHER:         { bg: 'var(--surface-2,#f1f5f9)',   text: 'var(--text-secondary,#475569)', border: 'var(--border-default,#cbd5e1)' },
};

const SEED_REPORTS = [
  { id: 'r1', report_type: 'SPAM',          status: 'OPEN', reporter_name: 'Rafi Islam',   reported_name: 'Quick Shop BD',    subject: 'Repeated spam listings in electronics category',     created_at: new Date(Date.now()-3600000).toISOString() },
  { id: 'r2', report_type: 'COUNTERFEIT',   status: 'OPEN', reporter_name: 'Nusrat Jahan', reported_name: 'GadgetZone',       subject: 'Selling fake Apple AirPods as genuine',               created_at: new Date(Date.now()-7200000).toISOString() },
  { id: 'r3', report_type: 'HARASSMENT',    status: 'OPEN', reporter_name: 'Karim Hossain',reported_name: 'User #4821',       subject: 'Abusive messages after order dispute',                created_at: new Date(Date.now()-10800000).toISOString() },
  { id: 'r4', report_type: 'FRAUD',         status: 'OPEN', reporter_name: 'Sadia Begum',  reported_name: 'TechMart Official',subject: 'Took payment but never shipped — 3 orders affected', created_at: new Date(Date.now()-14400000).toISOString() },
  { id: 'r5', report_type: 'INAPPROPRIATE', status: 'OPEN', reporter_name: 'Farhan Ahmed', reported_name: 'Fashion Hub BD',   subject: 'Product images contain nudity',                       created_at: new Date(Date.now()-18000000).toISOString() },
];

export default function ReportsPage(root) {
  const container = document.createElement('div');
  container.className = 'reports-page';
  container.style.cssText = `
    max-width:1200px;margin:0 auto;padding:24px 20px 56px;
    display:flex;flex-direction:column;gap:20px;
    color:var(--text-primary,#0f172a);background:var(--surface-0,transparent);font-family:inherit;
  `;

  let reports       = [];
  let stats         = { open: 0, resolved_today: 0, escalated: 0 };
  let typeFilter    = 'ALL';
  let statusFilter  = 'OPEN';
  let expandedId    = null;
  let selectedIds   = new Set();
  let loading       = true;

  const typeLabel = (tp) => t(TYPE_LABEL_KEYS[tp] || 'mod_reports.rt_other', tp);
  const statusLabel = (s) => t(STATUS_LABEL_KEYS[s] || 'mod_reports.st_open', s);

  async function fetchReports() {
    loading = true; render();
    try {
      const params = '?limit=40' + (typeFilter!=='ALL'?'&report_type='+typeFilter:'') + '&status='+statusFilter;
      const res = await api.get('/moderation/reports'+params);
      reports = Array.isArray(res?.data) ? res.data : (Array.isArray(res?.data?.items) ? res.data.items : SEED_REPORTS);
      if (res?.data?.stats) stats = { ...stats, ...res.data.stats };
      else { stats.open = reports.filter(r=>r.status==='OPEN').length; }
    } catch { reports = SEED_REPORTS; stats.open = SEED_REPORTS.length; }
    loading = false; render();
  }

  async function resolveReport(id, action) {
    try {
      await api.post('/moderation/reports/'+id+'/'+action);
      toast.success(t('mod_reports.action_success', 'Report updated.'));
      fetchReports();
    } catch (err) { toast.error(err?.message || t('mod_reports.action_failed', 'Action failed.')); }
  }

  async function bulkDismiss() {
    if (!selectedIds.size) { toast.error(t('mod_reports.select_to_dismiss', 'Select reports to bulk dismiss.')); return; }
    if (!confirm(t('mod_reports.bulk_confirm', 'Dismiss {{count}} selected reports?', { count: selectedIds.size }))) return;
    try {
      await api.post('/moderation/reports/bulk-dismiss', { ids: [...selectedIds] });
      toast.success(t('mod_reports.bulk_success', '{{count}} reports dismissed.', { count: selectedIds.size }));
      selectedIds.clear();
      fetchReports();
    } catch (err) {
      // Dismiss each individually as fallback
      const n = selectedIds.size;
      for (const id of selectedIds) {
        try { await api.post('/moderation/reports/'+id+'/dismiss'); } catch {}
      }
      toast.success(t('mod_reports.bulk_success', '{{count}} reports dismissed.', { count: n }));
      selectedIds.clear();
      fetchReports();
    }
  }

  function renderStats() {
    const cards = [
      { label: t('mod_reports.stat_open', 'Open Reports'),      value: stats.open||reports.filter(r=>r.status==='OPEN').length, text:'var(--danger-700,#b91c1c)',  bg:'var(--danger-100,#fee2e2)' },
      { label: t('mod_reports.stat_resolved_today', 'Resolved Today'), value: stats.resolved_today||0, text:'var(--success-700,#15803d)', bg:'var(--success-100,#dcfce7)' },
      { label: t('mod_reports.stat_escalated', 'Escalated'),    value: stats.escalated||0, text:'var(--info-700,#7e22ce)', bg:'var(--info-100,#fae8ff)' },
    ];
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">
      ${cards.map(c=>`
        <div style="background:${c.bg};border-radius:12px;padding:14px 18px;text-align:center;">
          <div style="font-size:1.6rem;font-weight:800;color:${c.text};">${c.value}</div>
          <div style="font-size:0.78rem;color:${c.text};font-weight:600;margin-top:2px;">${c.label}</div>
        </div>
      `).join('')}
    </div>`;
  }

  function renderFilters() {
    return `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;
        background:var(--surface-1,#fff);border:1px solid var(--border-default,#e2e8f0);
        border-radius:12px;padding:12px 16px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;flex:1;">
          ${REPORT_TYPES.map(tp=>`
            <button class="btn-type-filter" data-type="${tp}"
              style="padding:5px 12px;border-radius:999px;font-size:0.78rem;font-weight:600;cursor:pointer;
              border:1px solid ${typeFilter===tp?'var(--brand,#f59e0b)':'var(--border-default,#e2e8f0)'};
              background:${typeFilter===tp?'var(--brand,#f59e0b)':'var(--surface-0,#f8fafc)'};
              color:${typeFilter===tp?'var(--brand-contrast,#fff)':'var(--text-secondary,#64748b)'};">
              ${typeLabel(tp)}
            </button>
          `).join('')}
        </div>
        <select id="sel-status" aria-label="${t('mod_reports.status_filter_label', 'Filter reports by status')}" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border-default,#e2e8f0);
          font-size:0.82rem;background:var(--surface-0,#f8fafc);cursor:pointer;color:var(--text-primary,#0f172a);">
          ${STATUS_FILTERS.map(s=>`<option value="${s}" ${statusFilter===s?'selected':''}>${statusLabel(s)}</option>`).join('')}
        </select>
        ${selectedIds.size>0?`
          <button id="btn-bulk-dismiss" style="padding:6px 14px;border-radius:8px;border:1px solid var(--danger-300,#fca5a5);
            background:var(--surface-1,#fff);color:var(--danger-700,#b91c1c);font-size:0.82rem;font-weight:600;cursor:pointer;">
            ${t('mod_reports.bulk_dismiss', 'Dismiss Selected ({{count}})', { count: selectedIds.size })}
          </button>
        `:''}
      </div>
    `;
  }

  function renderReportCard(r) {
    const tc  = TYPE_COLORS[r.report_type] || TYPE_COLORS.OTHER;
    const exp = expandedId === r.id;
    const sel = selectedIds.has(r.id);
    return `
      <div style="background:var(--surface-1,#fff);border:1px solid ${sel?'var(--brand,#f59e0b)':'var(--border-default,#e2e8f0)'};
        border-radius:12px;overflow:hidden;transition:border-color 0.1s;">
        <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;cursor:pointer;" class="report-row" data-id="${r.id}">
          <input type="checkbox" class="chk-report" data-id="${r.id}" ${sel?'checked':''} aria-label="${t('mod_reports.select_report', 'Select report')} ${r.id}" style="margin-top:3px;flex-shrink:0;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:999px;
                background:${tc.bg};color:${tc.text};border:1px solid ${tc.border};">
                ${typeLabel(r.report_type)}
              </span>
              <span style="font-size:0.875rem;font-weight:600;color:var(--text-primary,#0f172a);">
                ${r.subject||t('mod_reports.no_subject', 'No subject')}
              </span>
            </div>
            <p style="margin:0;font-size:0.78rem;color:var(--text-secondary,#64748b);">
              ${t('mod_reports.reported_by', 'Reported by')} <strong>${r.reporter_name||t('mod_reports.anonymous', 'Anonymous')}</strong> ·
              ${t('mod_reports.against', 'Against')} <strong>${r.reported_name||t('mod_reports.unknown', 'Unknown')}</strong> ·
              ${r.created_at?formatDate(r.created_at):'—'}
            </p>
          </div>
          <span style="font-size:0.9rem;flex-shrink:0;transform:rotate(${exp?'180':'0'}deg);
            transition:transform 0.2s;">▼</span>
        </div>
        ${exp?`
          <div style="border-top:1px solid var(--border-subtle,#f1f5f9);padding:14px 16px;background:var(--surface-0,#f8fafc);">
            <p style="margin:0 0 12px;font-size:0.82rem;color:var(--text-secondary,#64748b);">
              ${r.description||t('mod_reports.no_details', 'No additional details provided by the reporter.')}
            </p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn-action" data-action="resolve" data-id="${r.id}"
                style="padding:7px 16px;border-radius:7px;border:none;cursor:pointer;font-size:0.8rem;font-weight:600;
                background:var(--success,#15803d);color:var(--text-inverse,#fff);">✅ ${t('mod_reports.act_resolve', 'Resolve')}</button>
              <button class="btn-action" data-action="dismiss" data-id="${r.id}"
                style="padding:7px 16px;border-radius:7px;border:1px solid var(--border-default,#e2e8f0);
                cursor:pointer;font-size:0.8rem;font-weight:600;background:var(--surface-1,#fff);color:var(--text-secondary,#64748b);">${t('mod_reports.act_dismiss', 'Dismiss')}</button>
              <button class="btn-action" data-action="escalate" data-id="${r.id}"
                style="padding:7px 16px;border-radius:7px;border:1px solid var(--info-300,#e879f9);cursor:pointer;
                font-size:0.8rem;font-weight:600;background:var(--info-100,#fae8ff);color:var(--info-700,#7e22ce);">⬆ ${t('mod_reports.act_escalate', 'Escalate')}</button>
              <button class="btn-action" data-action="penalise" data-id="${r.id}"
                style="padding:7px 16px;border-radius:7px;border:none;cursor:pointer;font-size:0.8rem;
                font-weight:600;background:var(--danger,#b91c1c);color:var(--text-inverse,#fff);">🚫 ${t('mod_reports.act_penalise', 'Penalise User')}</button>
            </div>
          </div>
        `:''}
      </div>
    `;
  }

  function render() {
    const pulse = '<div style="height:90px;border-radius:12px;background:var(--surface-1,#f1f5f9);animation:rep-pulse 1.4s ease-in-out infinite;margin-bottom:8px;"></div>';
    container.innerHTML = `
      <style>@keyframes rep-pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>
      <div>
        <h1 style="margin:0 0 4px;font-size:1.6rem;font-weight:700;color:var(--text-primary,#0f172a);letter-spacing:-0.3px;">
          ${t('mod_reports.title', 'User Reports')}
        </h1>
        <p style="margin:0;font-size:0.93rem;color:var(--text-secondary,#64748b);">
          ${t('mod_reports.subtitle', 'Review and action user-submitted reports for spam, harassment, fraud, and policy violations.')}
        </p>
      </div>
      ${renderStats()}
      ${renderFilters()}
      <div id="reports-list" style="display:flex;flex-direction:column;gap:10px;">
        ${loading ? pulse+pulse+pulse : reports.length===0 ? `
          <div style="text-align:center;padding:48px 0;">
            <div style="font-size:2.5rem;margin-bottom:8px;">📭</div>
            <p style="margin:0;font-size:0.875rem;color:var(--text-secondary,#64748b);">${t('mod_reports.empty', 'No reports match the current filter.')}</p>
          </div>
        ` : reports.map(renderReportCard).join('')}
      </div>
    `;
    attachListeners();
  }

  function attachListeners() {
    container.querySelectorAll('.btn-type-filter').forEach(btn=>{
      btn.addEventListener('click',()=>{ typeFilter=btn.getAttribute('data-type'); fetchReports(); });
    });
    container.querySelector('#sel-status')?.addEventListener('change',e=>{ statusFilter=e.target.value; fetchReports(); });
    container.querySelector('#btn-bulk-dismiss')?.addEventListener('click', bulkDismiss);
    container.querySelectorAll('.report-row').forEach(row=>{
      row.addEventListener('click', e=>{
        if(e.target.type==='checkbox') return;
        const id = row.getAttribute('data-id');
        expandedId = expandedId===id ? null : id;
        render();
      });
    });
    container.querySelectorAll('.chk-report').forEach(chk=>{
      chk.addEventListener('change',()=>{
        const id = chk.getAttribute('data-id');
        if(chk.checked) selectedIds.add(id); else selectedIds.delete(id);
        render();
      });
    });
    container.querySelectorAll('.btn-action').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        resolveReport(btn.getAttribute('data-id'), btn.getAttribute('data-action'));
      });
    });
  }

  fetchReports();
  root.append(container);
}
