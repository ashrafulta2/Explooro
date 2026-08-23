/**
 * ReviewCard.js — Polymorphic Content Review & Moderation Card (Prompt 7.4).
 *
 * Supports tailored presentations for:
 * - PRODUCT_NEW / PRODUCT_EDIT
 * - REVIEW
 * - UGC_VIDEO
 * - STOREFRONT_ASSET
 * - LIVE_STREAM
 * - CHAT_REPORT
 *
 * Features:
 * - Advisory automated pre-screening flag indicators
 * - One-click action buttons (Approve, Reject, Request Changes, Escalate, Shadow-Restrict)
 * - Claim locking indicators
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

  card.className = `review-card card p-5 transition ${isClaimedByMe ? 'border-primary shadow-sm' : ''} ${item.auto_flags?.length > 0 ? 'review-card--flagged' : ''}`;
  card.setAttribute('data-queue-id', item.id);

  const payload = typeof item.payload_snapshot_json === 'string'
    ? JSON.parse(item.payload_snapshot_json || '{}')
    : item.payload_snapshot_json || {};

  // 1. Render Pre-screening Flags
  let flagsHtml = '';
  if (Array.isArray(item.auto_flags) && item.auto_flags.length > 0) {
    flagsHtml = `
      <div class="review-card__flags mb-4 p-3 rounded bg-rose-subtle border border-rose text-xs space-y-1">
        <strong class="text-rose-dark block">⚠️ ${t('moderation.automated_flags_detected')} (${item.auto_flags.length}):</strong>
        ${item.auto_flags
          .map(
            (f) => `
          <div class="flex items-center gap-2 text-rose-dark">
            <span class="badge badge--rose badge--xs font-mono">${f.severity || 'WARN'}</span>
            <span>${f.label_en || f.code}</span>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  // 2. Render Body per Item Type
  let bodyHtml = '';
  if (item.item_type === 'PRODUCT_NEW' || item.item_type === 'PRODUCT_EDIT') {
    const images = Array.isArray(payload.images) ? payload.images : [];
    bodyHtml = `
      <div class="review-card__product space-y-3">
        <div class="flex items-start justify-between">
          <div>
            <h3 class="font-bold text-base text-text">${payload.title_en || 'Product Title'}</h3>
            <h4 class="text-xs text-secondary font-bengali">${payload.title_bn || ''}</h4>
            <div class="text-xs text-tertiary mt-1">Category: <strong>${payload.category_name || payload.category_id || 'General'}</strong> | Brand: <strong>${payload.brand || 'Unbranded'}</strong></div>
          </div>
          <div class="text-right">
            <span class="text-xs text-secondary block">Retail Price</span>
            <span class="font-bold text-base text-primary">${formatCurrency(payload.default_retail_price || payload.retail_price || 0)}</span>
          </div>
        </div>

        <!-- Pricing & Margin Breakdown -->
        <div class="grid grid-cols-3 gap-2 p-2 border rounded text-xs bg-surface-subtle">
          <div>
            <span class="text-secondary block">Base Cost:</span>
            <span class="font-semibold">${formatCurrency(payload.base_cost || 0)}</span>
          </div>
          <div>
            <span class="text-secondary block">Wholesale Margin:</span>
            <span class="font-semibold text-emerald">${formatCurrency(payload.wholesale_margin || 0)}</span>
          </div>
          <div>
            <span class="text-secondary block">Initial Stock:</span>
            <span class="font-semibold">${payload.stock_qty || payload.stock_quantity || 0} pcs</span>
          </div>
        </div>

        ${
          images.length > 0
            ? `
          <div class="flex gap-2 overflow-x-auto py-1">
            ${images
              .map(
                (img, idx) => `
              <img src="${img}" alt="Preview ${idx + 1}" class="w-16 h-16 object-cover rounded border" onerror="this.src='/placeholder-img.svg'"/>
            `
              )
              .join('')}
          </div>
        `
            : ''
        }

        <p class="text-xs text-secondary line-clamp-3 bg-surface p-2 rounded border">${payload.description_en || payload.description || 'No description provided.'}</p>
      </div>
    `;
  } else if (item.item_type === 'REVIEW') {
    bodyHtml = `
      <div class="review-card__review space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-amber text-sm">${'★'.repeat(payload.rating || 5)}${'☆'.repeat(5 - (payload.rating || 5))}</span>
            <span class="font-bold text-xs text-text">${payload.title || 'Product Review'}</span>
          </div>
          <span class="badge badge--emerald badge--xs">Verified Purchase</span>
        </div>
        <p class="text-xs text-secondary p-2 bg-surface rounded border">${payload.body || 'Review text'}</p>
      </div>
    `;
  } else if (item.item_type === 'UGC_VIDEO') {
    bodyHtml = `
      <div class="review-card__ugc space-y-2">
        <div class="flex items-center gap-3">
          <div class="w-20 h-24 bg-surface-subtle border rounded flex items-center justify-center text-lg">📹</div>
          <div>
            <h4 class="font-bold text-xs">${payload.title || 'UGC Video Submission'}</h4>
            <p class="text-xs text-secondary mt-1">${payload.caption || ''}</p>
          </div>
        </div>
      </div>
    `;
  } else if (item.item_type === 'STOREFRONT_ASSET') {
    bodyHtml = `
      <div class="review-card__storefront space-y-2">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-full border bg-surface-subtle flex items-center justify-center font-bold">🏪</div>
          <div>
            <h4 class="font-bold text-xs">Store Asset: ${payload.store_name || payload.slug}</h4>
            <span class="text-xs text-secondary">Slug: <code>${payload.slug}</code></span>
          </div>
        </div>
      </div>
    `;
  } else {
    bodyHtml = `
      <div class="review-card__generic text-xs text-secondary p-2 bg-surface rounded">
        <pre class="overflow-x-auto">${JSON.stringify(payload, null, 2)}</pre>
      </div>
    `;
  }

  // 3. Render Card Header & Metadata
  const typeBadgeColors = {
    PRODUCT_NEW: 'badge--blue',
    PRODUCT_EDIT: 'badge--indigo',
    REVIEW: 'badge--purple',
    UGC_VIDEO: 'badge--amber',
    STOREFRONT_ASSET: 'badge--emerald',
    LIVE_STREAM: 'badge--rose',
    CHAT_REPORT: 'badge--rose',
  };

  card.innerHTML = `
    <!-- Top Meta Bar -->
    <div class="flex items-center justify-between pb-3 mb-3 border-b">
      <div class="flex items-center gap-2">
        <span class="badge ${typeBadgeColors[item.item_type] || 'badge--gray'} font-mono">${item.item_type}</span>
        <span class="font-mono font-bold text-xs text-primary">${item.ref}</span>
        ${
          item.status === 'IN_REVIEW'
            ? `<span class="badge badge--amber badge--xs">🔒 ${isClaimedByMe ? t('moderation.claimed_by_you') : `${t('moderation.claimed_by')} ${item.claimed_by_name || `#${item.claimed_by}`}`}</span>`
            : item.status === 'APPROVED'
            ? `<span class="badge badge--emerald badge--xs">✅ ${t('moderation.status_approved')}</span>`
            : item.status === 'REJECTED'
            ? `<span class="badge badge--rose badge--xs">❌ ${t('moderation.status_rejected')}</span>`
            : `<span class="badge badge--gray badge--xs">${item.status}</span>`
        }
      </div>

      <div class="flex items-center gap-2 text-xs text-secondary">
        <span>👤 ${item.submitter_name || 'Seller'} (${item.submitter_role || 'supplier'})</span>
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
      <div class="review-card__actions mt-4 pt-3 border-t flex items-center justify-between">
        <div class="flex items-center gap-2">
          ${
            !item.claimed_by
              ? `<button class="btn btn--secondary btn--xs btn-claim">🔒 ${t('moderation.btn_claim')}</button>`
              : isClaimedByMe
              ? `<button class="btn btn--ghost btn--xs text-secondary btn-release">🔓 ${t('moderation.btn_release_claim')}</button>`
              : `<span class="text-xs text-secondary italic">Locked by other</span>`
          }
        </div>

        <div class="flex items-center gap-2">
          <button class="btn btn--danger btn--xs btn-escalate">🚨 ${t('moderation.btn_escalate')}</button>
          <button class="btn btn--secondary btn--xs btn-request-changes">✏️ ${t('moderation.btn_request_changes')}</button>
          <button class="btn btn--danger btn--xs btn-reject">❌ ${t('moderation.btn_reject')}</button>
          <button class="btn btn--primary btn--xs btn-approve">✅ ${t('moderation.btn_approve')}</button>
        </div>
      </div>
    `
        : ''
    }
  `;

  // Attach event listeners
  card.querySelector('.btn-claim')?.addEventListener('click', () => onClaim?.(item.id));
  card.querySelector('.btn-release')?.addEventListener('click', () => onRelease?.(item.id));
  card.querySelector('.btn-approve')?.addEventListener('click', () => onApprove?.(item.id));
  card.querySelector('.btn-reject')?.addEventListener('click', () => onReject?.(item.id));
  card.querySelector('.btn-request-changes')?.addEventListener('click', () => onRequestChanges?.(item.id));
  card.querySelector('.btn-escalate')?.addEventListener('click', () => onEscalate?.(item.id));

  return card;
}
