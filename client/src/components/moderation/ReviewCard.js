/**
 * ReviewCard.js — Polymorphic Content Review & Moderation Card (Prompt 7.4).
 *
 * Fully integrated with platform design tokens & theme CSS variables.
 */

import { formatCurrency, formatDate } from '../../services/format.js';
import { t } from '../../services/i18n.js';

export function ReviewCard({
  item,
  currentUserId,
  onApprove,
  onReject,
  onRequestChanges,
  onEscalate,
  onShadowRestrict,
  onClaim,
  onRelease,
} = {}) {
  const card = document.createElement('div');
  const isClaimedByMe = item.claimed_by === currentUserId;
  const isClaimedByOther = item.claimed_by && item.claimed_by !== currentUserId;
  const isPendingOrInReview = ['PENDING', 'IN_REVIEW'].includes(item.status);

  card.className = `review-card`;
  card.setAttribute('data-queue-id', item.id);
  card.style.cssText = `
    background: var(--surface-1, #ffffff);
    border: 1px solid ${isClaimedByMe ? 'var(--border-interactive, #4f46e5)' : 'var(--border-subtle, #e2e8f0)'};
    border-left: 4px solid ${item.pre_screening?.has_flags ? 'var(--danger, #e11d48)' : isClaimedByMe ? 'var(--brand, #4f46e5)' : 'var(--border-subtle, #cbd5e1)'};
    border-radius: var(--radius-lg, 12px);
    padding: 20px;
    box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));
    display: flex;
    flex-direction: column;
    gap: 14px;
    transition: all 0.2s ease;
  `;

  const payload = typeof item.data === 'object'
    ? item.data
    : typeof item.payload_snapshot_json === 'string'
    ? JSON.parse(item.payload_snapshot_json || '{}')
    : item.payload_snapshot_json || {};

  // 1. Render Pre-screening Flags
  let flagsHtml = '';
  const flags = item.pre_screening?.flags || item.auto_flags || [];
  if (Array.isArray(flags) && flags.length > 0) {
    flagsHtml = `
      <div style="
        padding: 12px 14px;
        border-radius: var(--radius-md, 8px);
        background: var(--danger-bg, rgba(225, 29, 72, 0.08));
        border: 1px solid var(--danger-border, rgba(225, 29, 72, 0.25));
        display: flex;
        flex-direction: column;
        gap: 6px;
      ">
        <div style="font-size: 12px; font-weight: 700; color: var(--danger, #e11d48); display: flex; align-items: center; gap: 6px;">
          ⚠️ ${t('moderation.automated_flags_detected', 'Automated Risk Pre-screening Flags Detected')} (${flags.length}):
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          ${flags
            .map(
              (f) => `
            <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--danger, #e11d48);">
              <span style="padding: 1px 6px; border-radius: 4px; background: rgba(225, 29, 72, 0.15); font-weight: 700; font-family: monospace; font-size: 10px;">${f.code || 'FLAG'}</span>
              <span>${f.message || f.label_en || 'Prohibited content pattern'}</span>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  // 2. Render Body per Item Type
  let bodyHtml = '';
  if (item.item_type === 'PRODUCT_NEW' || item.item_type === 'PRODUCT_EDIT' || item.item_type === 'PRODUCT') {
    const images = Array.isArray(payload.images) ? payload.images : [];
    bodyHtml = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap;">
          <div>
            <h3 style="font-size: 15px; font-weight: 700; margin: 0; color: var(--text-primary, #0f172a);">${payload.title_en || 'Product Title'}</h3>
            <h4 style="font-size: 13px; color: var(--text-muted, #64748b); margin: 2px 0 0 0;">${payload.title_bn || ''}</h4>
            <div style="font-size: 12px; color: var(--text-muted, #64748b); margin-top: 4px;">
              Category: <strong style="color: var(--text-primary, #0f172a);">${payload.category || payload.category_name || 'General'}</strong>
            </div>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 11px; color: var(--text-muted, #64748b); display: block;">Retail Price</span>
            <span style="font-size: 18px; font-weight: 800; color: var(--text-brand, #4f46e5);">${formatCurrency(payload.price || payload.default_retail_price || 0)}</span>
          </div>
        </div>

        <div style="
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 10px;
          padding: 10px 14px;
          border-radius: var(--radius-md, 8px);
          background: var(--surface-2, #f8fafc);
          border: 1px solid var(--border-subtle, #e2e8f0);
          font-size: 12px;
        ">
          <div>
            <span style="color: var(--text-muted, #64748b); display: block; font-size: 11px;">Wholesale Base Cost:</span>
            <strong style="color: var(--text-primary, #0f172a);">${formatCurrency(payload.base_cost || (payload.price ? payload.price * 0.8 : 0))}</strong>
          </div>
          <div>
            <span style="color: var(--text-muted, #64748b); display: block; font-size: 11px;">Est. Reseller Margin:</span>
            <strong style="color: var(--success, #059669);">${formatCurrency(payload.wholesale_margin || (payload.price ? payload.price * 0.2 : 0))}</strong>
          </div>
          <div>
            <span style="color: var(--text-muted, #64748b); display: block; font-size: 11px;">Initial Stock Lot:</span>
            <strong style="color: var(--text-primary, #0f172a);">${payload.stock_qty || 50} units</strong>
          </div>
        </div>

        ${
          images.length > 0
            ? `
          <div style="display: flex; gap: 8px; overflow-x: auto; padding: 4px 0;">
            ${images
              .map(
                (img, idx) => `
              <img src="${img}" alt="Preview ${idx + 1}" style="width: 64px; height: 64px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border-subtle, #e2e8f0);" onerror="this.src='/placeholder-product.png'"/>
            `
              )
              .join('')}
          </div>
        `
            : ''
        }

        <p style="
          margin: 0;
          font-size: 12px;
          color: var(--text-secondary, #475569);
          line-height: 1.5;
          padding: 10px 12px;
          border-radius: var(--radius-md, 8px);
          background: var(--surface-2, #f8fafc);
          border: 1px solid var(--border-subtle, #e2e8f0);
        ">
          ${payload.description || payload.description_en || 'No description provided.'}
        </p>
      </div>
    `;
  } else if (item.item_type === 'REVIEW') {
    bodyHtml = `
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="color: #f59e0b; font-size: 14px;">${'★'.repeat(payload.rating || 5)}${'☆'.repeat(5 - (payload.rating || 5))}</span>
            <span style="font-size: 12px; font-weight: 700; color: var(--text-primary, #0f172a);">${payload.product_title || 'Product Review'}</span>
          </div>
          <span style="font-size: 11px; padding: 2px 8px; border-radius: 4px; background: var(--success-bg, rgba(5, 150, 105, 0.1)); color: var(--success, #059669); font-weight: 600;">Verified Purchase</span>
        </div>
        <p style="margin: 0; font-size: 12px; color: var(--text-secondary, #475569); padding: 10px 12px; background: var(--surface-2, #f8fafc); border-radius: 8px; border: 1px solid var(--border-subtle, #e2e8f0);">${payload.comment || payload.body || 'Review text'}</p>
      </div>
    `;
  } else if (item.item_type === 'UGC_VIDEO') {
    bodyHtml = `
      <div style="display: flex; align-items: center; gap: 14px; padding: 10px; background: var(--surface-2, #f8fafc); border-radius: 8px; border: 1px solid var(--border-subtle, #e2e8f0);">
        <div style="width: 50px; height: 50px; border-radius: 8px; background: var(--info-bg, rgba(79, 70, 229, 0.1)); display: flex; align-items: center; justify-content: center; font-size: 24px;">📹</div>
        <div>
          <h4 style="margin: 0; font-size: 13px; font-weight: 700; color: var(--text-primary, #0f172a);">${payload.title_en || payload.title || 'UGC Video'}</h4>
          <p style="margin: 2px 0 0 0; font-size: 11px; color: var(--text-muted, #64748b);">Tagged: ${(payload.tagged_products || []).join(', ') || 'Showcase Product'}</p>
        </div>
      </div>
    `;
  } else {
    bodyHtml = `
      <div style="padding: 10px 12px; background: var(--surface-2, #f8fafc); border-radius: 8px; border: 1px solid var(--border-subtle, #e2e8f0); font-size: 12px;">
        <strong style="color: var(--danger, #e11d48);">${payload.report_reason || 'Community User Report'}</strong>
        <p style="margin: 4px 0 0 0; color: var(--text-secondary, #475569);">${payload.chat_excerpt || JSON.stringify(payload)}</p>
      </div>
    `;
  }

  card.innerHTML = `
    <!-- Top Meta Bar -->
    <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid var(--border-subtle, #e2e8f0); flex-wrap: wrap; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <span style="font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-family: monospace; background: var(--info-bg, rgba(79, 70, 229, 0.1)); color: var(--text-brand, #4f46e5); border: 1px solid var(--info-border, rgba(79, 70, 229, 0.25));">${item.item_type}</span>
        <span style="font-family: monospace; font-size: 12px; font-weight: 700; color: var(--text-primary, #0f172a);">${item.ref}</span>
        ${
          item.status === 'IN_REVIEW'
            ? `<span style="font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 700; background: var(--warning-bg, rgba(217, 119, 6, 0.1)); color: var(--warning, #d97706); border: 1px solid var(--warning-border, rgba(217, 119, 6, 0.25));">🔒 ${isClaimedByMe ? t('moderation.claimed_by_you', 'Claimed by you') : `${t('moderation.claimed_by', 'Claimed')} ${item.claimed_by_name || `#${item.claimed_by}`}`}</span>`
            : item.status === 'APPROVED'
            ? `<span style="font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 700; background: var(--success-bg, rgba(5, 150, 105, 0.1)); color: var(--success, #059669); border: 1px solid var(--success-border, rgba(5, 150, 105, 0.25));">✅ ${t('moderation.status_approved', 'Approved')}</span>`
            : item.status === 'REJECTED'
            ? `<span style="font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 700; background: var(--danger-bg, rgba(225, 29, 72, 0.1)); color: var(--danger, #e11d48); border: 1px solid var(--danger-border, rgba(225, 29, 72, 0.25));">❌ ${t('moderation.status_rejected', 'Rejected')}</span>`
            : `<span style="font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 700; background: var(--surface-2, #e2e8f0); color: var(--text-muted, #64748b);">${item.status}</span>`
        }
      </div>

      <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted, #64748b);">
        <span>👤 <strong>${item.submitter_name || 'Seller'}</strong></span>
        <span>•</span>
        <span>⏱️ ${formatDate(item.created_at)}</span>
      </div>
    </div>

    <!-- Flags -->
    ${flagsHtml}

    <!-- Content Body -->
    ${bodyHtml}

    <!-- Action Toolbar -->
    ${
      isPendingOrInReview
        ? `
      <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 12px; border-top: 1px solid var(--border-subtle, #e2e8f0); flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          ${
            !item.claimed_by
              ? `<button class="btn-claim" style="padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); cursor: pointer;">🔒 ${t('moderation.btn_claim', 'Claim Lock')}</button>`
              : isClaimedByMe
              ? `<button class="btn-release" style="padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-muted, #64748b); cursor: pointer;">🔓 ${t('moderation.btn_release_claim', 'Release Lock')}</button>`
              : `<span style="font-size: 12px; color: var(--text-muted, #64748b); font-style: italic;">Locked by other reviewer</span>`
          }
        </div>

        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <button class="btn-escalate" style="padding: 6px 12px; font-size: 12px; font-weight: 600; border-radius: 6px; border: 1px solid var(--danger-border, #e11d48); background: var(--danger-bg, rgba(225, 29, 72, 0.08)); color: var(--danger, #e11d48); cursor: pointer;">🚨 ${t('moderation.btn_escalate', 'Escalate')}</button>
          <button class="btn-request-changes" style="padding: 6px 12px; font-size: 12px; font-weight: 600; border-radius: 6px; border: 1px solid var(--warning-border, #d97706); background: var(--warning-bg, rgba(217, 119, 6, 0.08)); color: var(--warning, #d97706); cursor: pointer;">✏️ ${t('moderation.btn_request_changes', 'Changes')}</button>
          <button class="btn-reject" style="padding: 6px 12px; font-size: 12px; font-weight: 600; border-radius: 6px; border: 1px solid var(--danger, #e11d48); background: var(--danger, #e11d48); color: #ffffff; cursor: pointer;">❌ ${t('moderation.btn_reject', 'Reject')}</button>
          <button class="btn-approve" style="padding: 6px 16px; font-size: 12px; font-weight: 700; border-radius: 6px; border: none; background: var(--success, #059669); color: #ffffff; cursor: pointer;">✅ ${t('moderation.btn_approve', 'Approve')}</button>
        </div>
      </div>
    `
        : ''
    }
  `;

  card.querySelector('.btn-claim')?.addEventListener('click', () => onClaim?.(item.id));
  card.querySelector('.btn-release')?.addEventListener('click', () => onRelease?.(item.id));
  card.querySelector('.btn-approve')?.addEventListener('click', () => onApprove?.(item.id));
  card.querySelector('.btn-reject')?.addEventListener('click', () => onReject?.(item.id));
  card.querySelector('.btn-request-changes')?.addEventListener('click', () => onRequestChanges?.(item.id));
  card.querySelector('.btn-escalate')?.addEventListener('click', () => onEscalate?.(item.id));

  return card;
}
