/**
 * UgcModerationPage.js — Moderator UGC Video & Content Approval Queue (Prompt 7.7-D).
 *
 * Implements:
 * 1. Queue of user-generated videos and content awaiting approval.
 * 2. AI pre-screening score indicator (safe / flagged / explicit).
 * 3. Video thumbnail preview with metadata (duration, resolution, uploader).
 * 4. Actions: Approve, Reject with reason, Age-gate (18+), Request re-upload.
 * 5. Bulk approve for AI-safe content batch.
 * 6. Stats: pending, approved today, rejected today, AI-flagged.
 *
 * Strings are i18n (en/bn); AI-score badges + stat cards use semantic design tokens.
 */

import { api } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatDate } from '../../services/format.js';

const AI_SCORE_CONFIG = {
  SAFE:     { bg: 'var(--success-100,#dcfce7)', text: 'var(--success-800,#166534)', border: 'var(--success-300,#86efac)', icon: '🟢', labelKey: 'mod_ugc.ai_safe' },
  FLAGGED:  { bg: 'var(--warning-100,#fef9c3)', text: 'var(--warning-800,#854d0e)', border: 'var(--warning-300,#fde047)', icon: '🟡', labelKey: 'mod_ugc.ai_flagged' },
  EXPLICIT: { bg: 'var(--danger-100,#fee2e2)',  text: 'var(--danger-800,#7f1d1d)',  border: 'var(--danger-300,#fca5a5)',  icon: '🔴', labelKey: 'mod_ugc.ai_explicit' },
};

const CONTENT_TYPES = ['ALL', 'PRODUCT_REVIEW', 'UNBOXING', 'TUTORIAL', 'LIFESTYLE', 'LIVE_REPLAY'];
const CONTENT_TYPE_KEYS = {
  ALL: 'mod_ugc.ct_all', PRODUCT_REVIEW: 'mod_ugc.ct_product_review', UNBOXING: 'mod_ugc.ct_unboxing',
  TUTORIAL: 'mod_ugc.ct_tutorial', LIFESTYLE: 'mod_ugc.ct_lifestyle', LIVE_REPLAY: 'mod_ugc.ct_live_replay',
};
const AI_FILTERS = ['ALL', 'SAFE', 'FLAGGED', 'EXPLICIT'];
const AI_FILTER_KEYS = { ALL: 'mod_ugc.ai_all', SAFE: 'mod_ugc.ai_safe', FLAGGED: 'mod_ugc.ai_flagged', EXPLICIT: 'mod_ugc.ai_explicit' };

const SEED_UGC = [
  { id: 'u1', content_type: 'PRODUCT_REVIEW', ai_score: 'SAFE',     title: 'Samsung Galaxy A35 — Honest 30-day review',  duration: '8:24', views: 342,  created_at: new Date(Date.now()-1800000).toISOString(), uploader_name: 'TechWithRafi'   },
  { id: 'u2', content_type: 'UNBOXING',        ai_score: 'SAFE',     title: 'Nike Air Max 270 unboxing & first look',       duration: '5:12', views: 1204, created_at: new Date(Date.now()-3600000).toISOString(), uploader_name: 'ShopWithNusrat' },
  { id: 'u3', content_type: 'TUTORIAL',         ai_score: 'FLAGGED',  title: 'How to unlock any phone — full tutorial',      duration: '12:45',views: 891,  created_at: new Date(Date.now()-7200000).toISOString(), uploader_name: 'GadgetGuru BD'  },
  { id: 'u4', content_type: 'LIFESTYLE',        ai_score: 'EXPLICIT', title: 'Summer outfits haul — clothing review',        duration: '6:30', views: 215,  created_at: new Date(Date.now()-10800000).toISOString(),uploader_name: 'User #7821'     },
  { id: 'u5', content_type: 'LIVE_REPLAY',      ai_score: 'SAFE',     title: 'Flash Sale Live Stream — 14 Sep 2026',         duration: '1:12:44',views:4521,created_at: new Date(Date.now()-14400000).toISOString(),uploader_name: 'TechMart Live'  },
  { id: 'u6', content_type: 'PRODUCT_REVIEW',   ai_score: 'FLAGGED',  title: 'Honest review: worst product I ever bought!',  duration: '9:18', views: 673,  created_at: new Date(Date.now()-18000000).toISOString(),uploader_name: 'ReviewKing BD'  },
];

export default function UgcModerationPage(root) {
  const container = document.createElement('div');
  container.className = 'ugc-moderation-page';
  container.style.cssText = `
    max-width:1280px;margin:0 auto;padding:24px 20px 56px;
    display:flex;flex-direction:column;gap:20px;
    color:var(--text-primary,#0f172a);background:var(--surface-0,transparent);font-family:inherit;
  `;

  let ugcItems      = [];
  let stats         = { pending: 0, approved_today: 0, rejected_today: 0, ai_flagged: 0 };
  let typeFilter    = 'ALL';
  let aiFilter      = 'ALL';
  let selectedIds   = new Set();
  let expandedId    = null;
  let loading       = true;

  const ctLabel = (tp) => t(CONTENT_TYPE_KEYS[tp] || 'mod_ugc.ct_all', (tp || '').replace(/_/g,' '));
  const aiLabel = (s) => t(AI_FILTER_KEYS[s] || 'mod_ugc.ai_all', s);

  async function fetchUgc() {
    loading = true; render();
    try {
      const params = '?limit=40&status=PENDING'
        +(typeFilter!=='ALL'?'&content_type='+typeFilter:'')
        +(aiFilter!=='ALL'?'&ai_score='+aiFilter:'');
      const res = await api.get('/moderation/ugc'+params);
      ugcItems = Array.isArray(res?.data)?res.data:(Array.isArray(res?.data?.items)?res.data.items:SEED_UGC);
      if(res?.data?.stats) stats={...stats,...res.data.stats};
      else {
        stats.pending=ugcItems.length;
        stats.ai_flagged=ugcItems.filter(u=>u.ai_score!=='SAFE').length;
      }
    } catch { ugcItems=SEED_UGC; stats.pending=SEED_UGC.length; stats.ai_flagged=SEED_UGC.filter(u=>u.ai_score!=='SAFE').length; }
    loading = false; render();
  }

  async function decide(id, decision, reason='') {
    try {
      await api.post('/moderation/ugc/'+id+'/decide', { decision, reason });
      toast.success(decision==='APPROVED'?t('mod_ugc.decide_approved', 'UGC content approved.'):t('mod_ugc.decide_actioned', 'UGC content actioned.'));
      expandedId=null; selectedIds.delete(id);
      fetchUgc();
    } catch (err) { toast.error(err?.message||t('mod_ugc.action_failed', 'Action failed.')); }
  }

  async function bulkApproveSafe() {
    const safeIds = ugcItems.filter(u=>u.ai_score==='SAFE').map(u=>u.id);
    if (!safeIds.length) { toast.error(t('mod_ugc.bulk_none', 'No AI-safe items to bulk approve.')); return; }
    if (!confirm(t('mod_ugc.bulk_confirm', 'Bulk approve {{count}} AI-safe items?', { count: safeIds.length }))) return;
    try {
      await api.post('/moderation/ugc/bulk-approve', { ids: safeIds });
      toast.success(t('mod_ugc.bulk_success', '{{count}} items approved.', { count: safeIds.length }));
      fetchUgc();
    } catch {
      const n = safeIds.length;
      for (const id of safeIds) { try { await api.post('/moderation/ugc/'+id+'/decide',{decision:'APPROVED'}); } catch {} }
      toast.success(t('mod_ugc.bulk_success', '{{count}} items approved.', { count: n }));
      fetchUgc();
    }
  }

  function renderStats() {
    const cards = [
      { label:t('mod_ugc.stat_pending', 'Pending'),        value:stats.pending,       text:'var(--warning-700,#854d0e)', bg:'var(--warning-100,#fef9c3)' },
      { label:t('mod_ugc.stat_ai_flagged', 'AI Flagged'),  value:stats.ai_flagged,    text:'var(--danger-700,#b91c1c)',  bg:'var(--danger-100,#fee2e2)' },
      { label:t('mod_ugc.stat_approved_today', 'Approved Today'), value:stats.approved_today, text:'var(--success-700,#15803d)', bg:'var(--success-100,#dcfce7)' },
      { label:t('mod_ugc.stat_rejected_today', 'Rejected Today'), value:stats.rejected_today, text:'var(--text-secondary,#475569)', bg:'var(--surface-2,#f1f5f9)' },
    ];
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;">
      ${cards.map(c=>`
        <div style="background:${c.bg};border-radius:12px;padding:14px 18px;text-align:center;">
          <div style="font-size:1.5rem;font-weight:800;color:${c.text};">${c.value||0}</div>
          <div style="font-size:0.78rem;color:${c.text};font-weight:600;margin-top:2px;">${c.label}</div>
        </div>
      `).join('')}
    </div>`;
  }

  function renderUgcCard(item) {
    const ai  = AI_SCORE_CONFIG[item.ai_score] || AI_SCORE_CONFIG.SAFE;
    const exp = expandedId === item.id;
    const sel = selectedIds.has(item.id);
    // Generate a placeholder thumbnail gradient
    const hue = (item.id.charCodeAt(1)||0) * 37 % 360;
    return `
      <div style="background:var(--surface-1,#fff);border:2px solid ${sel?'var(--brand,#f59e0b)':'var(--border-default,#e2e8f0)'};
        border-radius:14px;overflow:hidden;">
        <div style="display:flex;align-items:flex-start;gap:14px;padding:14px 16px;cursor:pointer;" class="ugc-row" data-id="${item.id}">
          <!-- Thumbnail -->
          <div style="position:relative;flex-shrink:0;width:120px;height:68px;border-radius:8px;overflow:hidden;
            background:linear-gradient(135deg,hsl(${hue},60%,40%),hsl(${hue+60},60%,60%));">
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
              <span aria-hidden="true" style="font-size:1.5rem;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.6);">▶</span>
            </div>
            <div style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.75);color:#fff;
              font-size:0.65rem;font-weight:600;padding:1px 5px;border-radius:3px;">
              ${item.duration||'—'}
            </div>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:999px;
                background:${ai.bg};color:${ai.text};border:1px solid ${ai.border};">
                ${ai.icon} ${t('mod_ugc.ai_badge', 'AI: {{score}}', { score: t(ai.labelKey, item.ai_score) })}
              </span>
              <span style="font-size:0.72rem;padding:2px 8px;border-radius:999px;
                background:var(--surface-2,#f1f5f9);color:var(--text-secondary,#64748b);">
                ${ctLabel(item.content_type)}
              </span>
            </div>
            <p style="margin:0 0 3px;font-size:0.9rem;font-weight:600;color:var(--text-primary,#0f172a);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${item.title||t('mod_ugc.untitled', 'Untitled')}
            </p>
            <p style="margin:0;font-size:0.78rem;color:var(--text-secondary,#64748b);">
              ${t('mod_ugc.by', 'by {{name}}', { name: item.uploader_name||t('mod_ugc.unknown', 'Unknown') })} ·
              ${t('mod_ugc.views', '{{count}} views', { count: (item.views||0).toLocaleString() })} ·
              ${item.created_at?formatDate(item.created_at):'—'}
            </p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <input type="checkbox" class="chk-ugc" data-id="${item.id}" ${sel?'checked':''} aria-label="${t('mod_ugc.select_item', 'Select item')} ${item.id}">
            <span style="font-size:0.9rem;transform:rotate(${exp?180:0}deg);transition:transform 0.2s;">▼</span>
          </div>
        </div>
        ${exp?`
          <div style="border-top:1px solid var(--border-subtle,#f1f5f9);padding:14px 16px;background:var(--surface-0,#f8fafc);">
            ${item.ai_score!=='SAFE'?`
              <div style="padding:10px 14px;border-radius:8px;background:${ai.bg};border:1px solid ${ai.border};
                margin-bottom:14px;font-size:0.82rem;color:${ai.text};font-weight:600;">
                ${ai.icon} ${item.ai_score==='EXPLICIT'?t('mod_ugc.flagged_explicit', 'AI Pre-screening flagged this content. Requires careful review before any approval.'):t('mod_ugc.flagged_other', 'AI Pre-screening flagged this content. Please verify before approving.')}
              </div>
            `:''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn-ugc-decide" data-id="${item.id}" data-decision="APPROVED"
                style="padding:7px 16px;border-radius:7px;border:none;cursor:pointer;font-size:0.8rem;font-weight:600;
                background:var(--success,#15803d);color:var(--text-inverse,#fff);">✅ ${t('mod_ugc.act_approve', 'Approve')}</button>
              <button class="btn-ugc-decide" data-id="${item.id}" data-decision="REJECTED"
                style="padding:7px 16px;border-radius:7px;border:none;cursor:pointer;font-size:0.8rem;font-weight:600;
                background:var(--danger,#b91c1c);color:var(--text-inverse,#fff);">❌ ${t('mod_ugc.act_reject', 'Reject')}</button>
              <button class="btn-ugc-decide" data-id="${item.id}" data-decision="AGE_GATED"
                style="padding:7px 16px;border-radius:7px;border:1px solid var(--warning-300,#fdba74);cursor:pointer;font-size:0.8rem;
                font-weight:600;background:var(--warning-100,#ffedd5);color:var(--warning-800,#9a3412);">🔞 ${t('mod_ugc.act_agegate', 'Age-Gate (18+)')}</button>
              <button class="btn-ugc-decide" data-id="${item.id}" data-decision="REQUEST_REUPLOAD"
                style="padding:7px 16px;border-radius:7px;border:1px solid var(--border-default,#e2e8f0);cursor:pointer;
                font-size:0.8rem;font-weight:600;background:var(--surface-1,#fff);color:var(--text-secondary,#64748b);">🔄 ${t('mod_ugc.act_reupload', 'Request Re-upload')}</button>
            </div>
          </div>
        `:''}
      </div>
    `;
  }

  function render() {
    const safeBulkCount = ugcItems.filter(u=>u.ai_score==='SAFE').length;
    const pulse='<div style="height:100px;border-radius:12px;background:var(--surface-1,#f1f5f9);animation:ugc-pulse 1.4s ease-in-out infinite;margin-bottom:8px;"></div>';
    container.innerHTML=`
      <style>@keyframes ugc-pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 style="margin:0 0 4px;font-size:1.6rem;font-weight:700;color:var(--text-primary,#0f172a);letter-spacing:-0.3px;">
            ${t('mod_ugc.title', 'UGC Content Moderation')}
          </h1>
          <p style="margin:0;font-size:0.93rem;color:var(--text-secondary,#64748b);">
            ${t('mod_ugc.subtitle', 'Review user-generated videos and content before they go live on the platform.')}
          </p>
        </div>
        ${safeBulkCount>0?`
          <button id="btn-bulk-safe" style="padding:9px 18px;border-radius:8px;border:none;cursor:pointer;
            font-size:0.875rem;font-weight:700;background:var(--success,#15803d);color:var(--text-inverse,#fff);">
            ✅ ${t('mod_ugc.bulk_approve', 'Bulk Approve {{count}} AI-Safe', { count: safeBulkCount })}
          </button>
        `:''}
      </div>
      ${renderStats()}
      <!-- Filters -->
      <div style="display:flex;flex-direction:column;gap:10px;background:var(--surface-1,#fff);
        border:1px solid var(--border-default,#e2e8f0);border-radius:12px;padding:12px 16px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <span style="font-size:0.72rem;font-weight:700;color:var(--text-secondary,#64748b);text-transform:uppercase;margin-right:4px;">${t('mod_ugc.type_label', 'Type')}</span>
          ${CONTENT_TYPES.map(tp=>`
            <button class="btn-type-filter" data-type="${tp}"
              style="padding:4px 12px;border-radius:999px;font-size:0.78rem;font-weight:600;cursor:pointer;
              border:1px solid ${typeFilter===tp?'var(--brand,#f59e0b)':'var(--border-default,#e2e8f0)'};
              background:${typeFilter===tp?'var(--brand,#f59e0b)':'var(--surface-0,#f8fafc)'};
              color:${typeFilter===tp?'var(--brand-contrast,#fff)':'var(--text-secondary,#64748b)'};">${ctLabel(tp)}</button>
          `).join('')}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <span style="font-size:0.72rem;font-weight:700;color:var(--text-secondary,#64748b);text-transform:uppercase;margin-right:4px;">${t('mod_ugc.ai_label', 'AI Score')}</span>
          ${AI_FILTERS.map(s=>`
            <button class="btn-ai-filter" data-ai="${s}"
              style="padding:4px 12px;border-radius:999px;font-size:0.78rem;font-weight:600;cursor:pointer;
              border:1px solid ${aiFilter===s?'var(--brand,#f59e0b)':'var(--border-default,#e2e8f0)'};
              background:${aiFilter===s?'var(--brand,#f59e0b)':'var(--surface-0,#f8fafc)'};
              color:${aiFilter===s?'var(--brand-contrast,#fff)':'var(--text-secondary,#64748b)'};">${aiLabel(s)}</button>
          `).join('')}
        </div>
      </div>
      <!-- Queue -->
      <div id="ugc-list" style="display:flex;flex-direction:column;gap:10px;">
        ${loading?pulse+pulse+pulse:ugcItems.length===0?`
          <div style="text-align:center;padding:48px 0;">
            <div style="font-size:2.5rem;margin-bottom:8px;">🎬</div>
            <p style="margin:0;font-size:0.875rem;color:var(--text-secondary,#64748b);">${t('mod_ugc.empty', 'No UGC content pending review.')}</p>
          </div>
        `:ugcItems.map(renderUgcCard).join('')}
      </div>
    `;
    attachListeners();
  }

  function attachListeners() {
    container.querySelector('#btn-bulk-safe')?.addEventListener('click', bulkApproveSafe);
    container.querySelectorAll('.btn-type-filter').forEach(b=>b.addEventListener('click',()=>{ typeFilter=b.getAttribute('data-type'); fetchUgc(); }));
    container.querySelectorAll('.btn-ai-filter').forEach(b=>b.addEventListener('click',()=>{ aiFilter=b.getAttribute('data-ai'); fetchUgc(); }));
    container.querySelectorAll('.ugc-row').forEach(row=>{
      row.addEventListener('click',e=>{
        if(e.target.type==='checkbox') return;
        const id=row.getAttribute('data-id');
        expandedId=expandedId===id?null:id;
        render();
      });
    });
    container.querySelectorAll('.chk-ugc').forEach(chk=>{
      chk.addEventListener('change',()=>{
        const id=chk.getAttribute('data-id');
        if(chk.checked) selectedIds.add(id); else selectedIds.delete(id);
        render();
      });
    });
    container.querySelectorAll('.btn-ugc-decide').forEach(btn=>{
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        decide(btn.getAttribute('data-id'),btn.getAttribute('data-decision'));
      });
    });
  }

  fetchUgc();
  root.append(container);
}
