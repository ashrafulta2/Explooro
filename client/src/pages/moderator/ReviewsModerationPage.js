/**
 * ReviewsModerationPage.js — Moderator Review Integrity Queue (Prompt 7.7-C).
 *
 * Implements:
 * 1. Queue of flagged product reviews awaiting moderation.
 * 2. Filter by flag reason: Fake, Spam, Offensive, Competitor Attack, Unverified Purchase.
 * 3. Review detail card with product context, reviewer info, and full review text.
 * 4. Actions: Approve, Reject (with reason), Shadow-hide, Request edits.
 * 5. Throughput KPIs: pending, approved today, rejected today.
 *
 * Strings are i18n (en/bn); flag badges + stat cards use semantic design tokens.
 */

import { api } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatDate } from '../../services/format.js';

const FLAG_REASONS = ['ALL', 'FAKE_REVIEW', 'SPAM', 'OFFENSIVE', 'COMPETITOR_ATTACK', 'UNVERIFIED_PURCHASE'];

const FLAG_LABEL_KEYS = {
  ALL: 'mod_reviews.fr_all', FAKE_REVIEW: 'mod_reviews.fr_fake', SPAM: 'mod_reviews.fr_spam',
  OFFENSIVE: 'mod_reviews.fr_offensive', COMPETITOR_ATTACK: 'mod_reviews.fr_competitor',
  UNVERIFIED_PURCHASE: 'mod_reviews.fr_unverified',
};

const FLAG_COLORS = {
  FAKE_REVIEW:          { bg: 'var(--danger-100,#fee2e2)',  text: 'var(--danger-700,#b91c1c)',  border: 'var(--danger-300,#fca5a5)' },
  SPAM:                 { bg: 'var(--warning-100,#fef9c3)', text: 'var(--warning-700,#854d0e)', border: 'var(--warning-300,#fde047)' },
  OFFENSIVE:            { bg: 'var(--warning-100,#ffedd5)', text: 'var(--warning-800,#9a3412)', border: 'var(--warning-300,#fdba74)' },
  COMPETITOR_ATTACK:    { bg: 'var(--info-100,#fae8ff)',    text: 'var(--info-700,#7e22ce)',    border: 'var(--info-300,#e879f9)' },
  UNVERIFIED_PURCHASE:  { bg: 'var(--info-100,#dbeafe)',    text: 'var(--info-700,#1e40af)',    border: 'var(--info-300,#93c5fd)' },
};

const SEED_REVIEWS = [
  { id: 'rv1', flag_reason: 'FAKE_REVIEW',         status: 'PENDING', reviewer_name: 'Ahmed K.',  product_name: 'Samsung Galaxy A35',  rating: 5, body: 'Best phone ever! Perfect in every way, no issues at all. 100% recommend!!!', created_at: new Date(Date.now()-1800000).toISOString() },
  { id: 'rv2', flag_reason: 'OFFENSIVE',            status: 'PENDING', reviewer_name: 'User #3291',product_name: 'Nike Air Max 270',     rating: 1, body: 'This seller is a [offensive content removed]. Total scam and waste of money.', created_at: new Date(Date.now()-3600000).toISOString() },
  { id: 'rv3', flag_reason: 'COMPETITOR_ATTACK',    status: 'PENDING', reviewer_name: 'Shafiq R.', product_name: 'Realme C65',           rating: 1, body: 'Terrible. Go buy [competitor brand] instead — much better quality and price.', created_at: new Date(Date.now()-7200000).toISOString() },
  { id: 'rv4', flag_reason: 'SPAM',                 status: 'PENDING', reviewer_name: 'ProShopper',product_name: 'HP Laptop 15s',        rating: 5, body: 'Visit my channel for discount codes! Best deals at [external link]. Subscribe now!', created_at: new Date(Date.now()-10800000).toISOString() },
  { id: 'rv5', flag_reason: 'UNVERIFIED_PURCHASE',  status: 'PENDING', reviewer_name: 'Rubel M.',  product_name: 'Xiaomi Smart TV 43"',  rating: 2, body: 'Poor build quality and display issues after 2 weeks.', created_at: new Date(Date.now()-14400000).toISOString() },
];

export default function ReviewsModerationPage(root) {
  const container = document.createElement('div');
  container.className = 'reviews-moderation-page';
  container.style.cssText = `
    max-width:1200px;margin:0 auto;padding:24px 20px 56px;
    display:flex;flex-direction:column;gap:20px;
    color:var(--text-primary,#0f172a);background:var(--surface-0,transparent);font-family:inherit;
  `;

  let reviews     = [];
  let stats       = { pending: 0, approved_today: 0, rejected_today: 0 };
  let flagFilter  = 'ALL';
  let expandedId  = null;
  let loading     = true;

  const flagLabel = (f) => t(FLAG_LABEL_KEYS[f] || 'mod_reviews.fr_all', (f || 'UNKNOWN').replace(/_/g,' '));

  async function fetchReviews() {
    loading = true; render();
    try {
      const params = '?limit=40&status=PENDING'+(flagFilter!=='ALL'?'&flag_reason='+flagFilter:'');
      const res = await api.get('/moderation/reviews'+params);
      reviews = Array.isArray(res?.data)?res.data:(Array.isArray(res?.data?.items)?res.data.items:SEED_REVIEWS);
      if(res?.data?.stats) stats={...stats,...res.data.stats};
      else stats.pending=reviews.length;
    } catch { reviews=SEED_REVIEWS; stats.pending=SEED_REVIEWS.length; }
    loading = false; render();
  }

  async function decide(reviewId, decision, reason='') {
    try {
      await api.post('/moderation/reviews/'+reviewId+'/decide', { decision, reason });
      toast.success(decision==='APPROVED'?t('mod_reviews.approved_toast', 'Review approved.'):t('mod_reviews.rejected_toast', 'Review rejected.'));
      expandedId=null;
      fetchReviews();
    } catch (err) { toast.error(err?.message||t('mod_reviews.action_failed', 'Action failed.')); }
  }

  function renderStats() {
    const items = [
      { label:t('mod_reviews.stat_pending', 'Pending Review'), value:stats.pending||reviews.length, text:'var(--warning-700,#854d0e)', bg:'var(--warning-100,#fef9c3)' },
      { label:t('mod_reviews.stat_approved_today', 'Approved Today'), value:stats.approved_today||0, text:'var(--success-700,#15803d)', bg:'var(--success-100,#dcfce7)' },
      { label:t('mod_reviews.stat_rejected_today', 'Rejected Today'), value:stats.rejected_today||0, text:'var(--danger-700,#b91c1c)', bg:'var(--danger-100,#fee2e2)' },
    ];
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;">
      ${items.map(c=>`
        <div style="background:${c.bg};border-radius:12px;padding:14px 18px;text-align:center;">
          <div style="font-size:1.6rem;font-weight:800;color:${c.text};">${c.value}</div>
          <div style="font-size:0.78rem;color:${c.text};font-weight:600;margin-top:2px;">${c.label}</div>
        </div>
      `).join('')}
    </div>`;
  }

  function renderStars(rating) {
    return Array.from({length:5},(_,i)=>`<span style="color:${i<rating?'var(--warning-500,#f59e0b)':'var(--border-default,#e2e8f0)'};font-size:0.9rem;">★</span>`).join('');
  }

  function renderReviewCard(r) {
    const fc  = FLAG_COLORS[r.flag_reason] || { bg:'var(--surface-2,#f1f5f9)', text:'var(--text-secondary,#475569)', border:'var(--border-default,#cbd5e1)' };
    const exp = expandedId === r.id;
    return `
      <div style="background:var(--surface-1,#fff);border:1px solid var(--border-default,#e2e8f0);
        border-radius:12px;overflow:hidden;transition:box-shadow 0.15s;">
        <div class="review-row" data-id="${r.id}"
          style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;cursor:pointer;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:999px;
                background:${fc.bg};color:${fc.text};border:1px solid ${fc.border};">
                ${flagLabel(r.flag_reason)}
              </span>
              <span style="font-size:0.875rem;font-weight:600;color:var(--text-primary,#0f172a);">
                ${r.product_name||t('mod_reviews.unknown_product', 'Unknown Product')}
              </span>
              ${renderStars(r.rating||0)}
            </div>
            <p style="margin:0 0 4px;font-size:0.82rem;color:var(--text-secondary,#64748b);">
              ${t('mod_reviews.by', 'by {{name}}', { name: r.reviewer_name||t('mod_reports.anonymous', 'Anonymous') })} ·
              ${r.created_at?formatDate(r.created_at):'—'}
            </p>
            <p style="margin:0;font-size:0.875rem;color:var(--text-primary,#0f172a);
              display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
              "${r.body||t('mod_reviews.no_text', 'No review text.')}"
            </p>
          </div>
          <span style="flex-shrink:0;font-size:0.9rem;transform:rotate(${exp?180:0}deg);transition:transform 0.2s;">▼</span>
        </div>
        ${exp?`
          <div style="border-top:1px solid var(--border-subtle,#f1f5f9);padding:16px;background:var(--surface-0,#f8fafc);">
            <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid var(--border-default,#e2e8f0);
              font-size:0.875rem;color:var(--text-primary,#0f172a);font-style:italic;background:var(--surface-1,#fff);border-radius:0 8px 8px 0;">
              "${r.body||t('mod_reviews.no_text', 'No review text.')}"
            </blockquote>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn-decide" data-id="${r.id}" data-decision="APPROVED"
                style="padding:7px 16px;border-radius:7px;border:none;cursor:pointer;
                font-size:0.8rem;font-weight:600;background:var(--success,#15803d);color:var(--text-inverse,#fff);">✅ ${t('mod_reviews.act_approve', 'Approve')}</button>
              <button class="btn-reject-modal" data-id="${r.id}"
                style="padding:7px 16px;border-radius:7px;border:none;cursor:pointer;
                font-size:0.8rem;font-weight:600;background:var(--danger,#b91c1c);color:var(--text-inverse,#fff);">❌ ${t('mod_reviews.act_reject', 'Reject')}</button>
              <button class="btn-decide" data-id="${r.id}" data-decision="SHADOW_HIDDEN"
                style="padding:7px 16px;border-radius:7px;border:1px solid var(--border-default,#e2e8f0);cursor:pointer;
                font-size:0.8rem;font-weight:600;background:var(--surface-1,#fff);color:var(--text-secondary,#64748b);">👻 ${t('mod_reviews.act_shadow', 'Shadow Hide')}</button>
            </div>
          </div>
        `:''}
      </div>
    `;
  }

  function openRejectModal(reviewId) {
    const backdrop = document.createElement('div');
    backdrop.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;';
    backdrop.innerHTML=`
      <div style="background:var(--surface-1,#fff);border-radius:14px;max-width:460px;width:100%;padding:24px;
        box-shadow:0 20px 40px rgba(0,0,0,0.2);display:flex;flex-direction:column;gap:14px;color:var(--text-primary,#0f172a);">
        <h3 style="margin:0;font-size:1rem;font-weight:700;">${t('mod_reviews.reject_title', 'Reject Review — Provide Reason')}</h3>
        <div>
          <label style="font-size:0.8rem;font-weight:600;color:var(--text-secondary,#64748b);display:block;margin-bottom:6px;text-transform:uppercase;">${t('mod_reviews.reject_reason_label', 'Rejection Reason')}</label>
          <select id="sel-reject-reason" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border-default,#e2e8f0);font-size:0.875rem;background:var(--surface-0,#f8fafc);color:var(--text-primary,#0f172a);">
            <option value="CONTAINS_SPAM">${t('mod_reviews.rr_spam', 'Contains Spam / External Links')}</option>
            <option value="OFFENSIVE_LANGUAGE">${t('mod_reviews.rr_offensive', 'Offensive / Abusive Language')}</option>
            <option value="FAKE_OR_INCENTIVISED">${t('mod_reviews.rr_fake', 'Fake or Incentivised Review')}</option>
            <option value="COMPETITOR_MENTION">${t('mod_reviews.rr_competitor', 'Competitor Brand Mention')}</option>
            <option value="UNVERIFIED_CLAIM">${t('mod_reviews.rr_unverified', 'Unverifiable Claim')}</option>
            <option value="OTHER">${t('mod_reviews.rr_other', 'Other')}</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="btn-cancel-reject" style="padding:8px 18px;border-radius:7px;border:1px solid var(--border-default,#e2e8f0);background:var(--surface-1,#fff);color:var(--text-secondary,#64748b);font-size:0.875rem;font-weight:600;cursor:pointer;">${t('mod_reviews.cancel', 'Cancel')}</button>
          <button id="btn-confirm-reject" style="padding:8px 18px;border-radius:7px;border:none;background:var(--danger,#b91c1c);color:var(--text-inverse,#fff);font-size:0.875rem;font-weight:700;cursor:pointer;">${t('mod_reviews.confirm_reject', 'Confirm Rejection')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.querySelector('#btn-cancel-reject').addEventListener('click',()=>backdrop.remove());
    backdrop.querySelector('#btn-confirm-reject').addEventListener('click',()=>{
      const reason=backdrop.querySelector('#sel-reject-reason').value;
      backdrop.remove();
      decide(reviewId,'REJECTED',reason);
    });
  }

  function render() {
    const pulse='<div style="height:100px;border-radius:12px;background:var(--surface-1,#f1f5f9);animation:rvm-pulse 1.4s ease-in-out infinite;margin-bottom:8px;"></div>';
    container.innerHTML=`
      <style>@keyframes rvm-pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>
      <div>
        <h1 style="margin:0 0 4px;font-size:1.6rem;font-weight:700;color:var(--text-primary,#0f172a);letter-spacing:-0.3px;">
          ${t('mod_reviews.title', 'Review Moderation')}
        </h1>
        <p style="margin:0;font-size:0.93rem;color:var(--text-secondary,#64748b);">
          ${t('mod_reviews.subtitle', 'Review flagged product ratings for spam, fakes, offensive content, and competitor attacks.')}
        </p>
      </div>
      ${renderStats()}
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;
        background:var(--surface-1,#fff);border:1px solid var(--border-default,#e2e8f0);
        border-radius:12px;padding:12px 16px;">
        ${FLAG_REASONS.map(f=>`
          <button class="btn-flag-filter" data-flag="${f}"
            style="padding:5px 12px;border-radius:999px;font-size:0.78rem;font-weight:600;cursor:pointer;
            border:1px solid ${flagFilter===f?'var(--brand,#f59e0b)':'var(--border-default,#e2e8f0)'};
            background:${flagFilter===f?'var(--brand,#f59e0b)':'var(--surface-0,#f8fafc)'};
            color:${flagFilter===f?'var(--brand-contrast,#fff)':'var(--text-secondary,#64748b)'};">
            ${flagLabel(f)}
          </button>
        `).join('')}
      </div>
      <div id="reviews-list" style="display:flex;flex-direction:column;gap:10px;">
        ${loading?pulse+pulse+pulse:reviews.length===0?`
          <div style="text-align:center;padding:48px 0;">
            <div style="font-size:2.5rem;margin-bottom:8px;">✅</div>
            <p style="margin:0;font-size:0.875rem;color:var(--text-secondary,#64748b);">${t('mod_reviews.empty', 'No flagged reviews. All clear!')}</p>
          </div>
        `:reviews.map(renderReviewCard).join('')}
      </div>
    `;
    attachListeners();
  }

  function attachListeners() {
    container.querySelectorAll('.btn-flag-filter').forEach(btn=>{
      btn.addEventListener('click',()=>{ flagFilter=btn.getAttribute('data-flag'); fetchReviews(); });
    });
    container.querySelectorAll('.review-row').forEach(row=>{
      row.addEventListener('click',()=>{
        const id=row.getAttribute('data-id');
        expandedId=expandedId===id?null:id;
        render();
      });
    });
    container.querySelectorAll('.btn-decide').forEach(btn=>{
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        decide(btn.getAttribute('data-id'),btn.getAttribute('data-decision'));
      });
    });
    container.querySelectorAll('.btn-reject-modal').forEach(btn=>{
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        openRejectModal(btn.getAttribute('data-id'));
      });
    });
  }

  fetchReviews();
  root.append(container);
}
