/**
 * LiveStreamCard.js — Discovery card for live & scheduled broadcast sessions (Prompt 10.1).
 * Upgraded with design tokens, high-contrast badges, verified host indicators, formatted schedule time, and clean Button primitive.
 */

import { formatBdt } from '../../services/format.js';
import { t, getLanguage } from '../../services/i18n.js';
import { Button } from '../ui/Button.js';

export function LiveStreamCard({ stream, onWatchClick }) {
  const card = document.createElement('div');
  card.className = 'live-stream-card';

  const isLive = stream.status === 'LIVE';
  const isScheduled = stream.status === 'SCHEDULED';
  const isEnded = stream.status === 'ENDED' || stream.status === 'TERMINATED';

  // Format Scheduled Time
  let scheduledTimeFormatted = '';
  if (isScheduled && stream.scheduled_for) {
    try {
      const d = new Date(stream.scheduled_for);
      const isBn = getLanguage() === 'bn';
      scheduledTimeFormatted = d.toLocaleDateString(isBn ? 'bn-BD' : 'en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      scheduledTimeFormatted = '';
    }
  }

  // Status Badge
  let statusBadgeHtml = '';
  if (isLive) {
    statusBadgeHtml = `<span class="live-status-pill live-status-pill--live"><span class="pulse-dot pulse-dot--white"></span> LIVE (${stream.viewer_count || 1})</span>`;
  } else if (isScheduled) {
    statusBadgeHtml = `<span class="live-status-pill live-status-pill--scheduled">⏰ ${scheduledTimeFormatted || (t('live.scheduled') || 'Scheduled')}</span>`;
  } else {
    statusBadgeHtml = `<span class="live-status-pill live-status-pill--ended">🎬 ${t('live.replay') || 'Replay'}</span>`;
  }

  // Category Tag
  const rawCategory = stream.settings_json?.category || stream.category || '';
  const categoryLabel = rawCategory ? rawCategory.replace(/_/g, ' ') : '';
  const categoryBadgeHtml = categoryLabel 
    ? `<span class="category-tag-badge">${categoryLabel}</span>`
    : '';

  // Deal Snippet (pinned product or first featured product)
  const pinnedProd = stream.pinned_product || (stream.products && stream.products[0]);
  let dealSnippetHtml = '';
  if (pinnedProd) {
    const isBn = getLanguage() === 'bn';
    const prodTitle = (isBn ? (pinnedProd.title_bn || pinnedProd.title_en) : (pinnedProd.title_en || pinnedProd.title_bn)) || pinnedProd.title || 'Featured Deal';
    const prodPrice = pinnedProd.special_price || pinnedProd.price || 0;
    dealSnippetHtml = `
      <div class="live-stream-card__deal-snippet">
        <span class="deal-snippet-title">⚡ ${prodTitle}</span>
        <span class="deal-snippet-price">${formatBdt(prodPrice)}</span>
      </div>
    `;
  }

  card.innerHTML = `
    <div class="live-stream-card__thumb-wrapper">
      <img 
        class="live-stream-card__thumb" 
        src="${stream.cover_image || '/placeholder-product.png'}" 
        alt="${stream.title}"
        loading="lazy"
        onerror="this.src='/placeholder-product.png'"
      />
      <div class="live-stream-card__scrim"></div>
      <div class="live-stream-card__badge-top">
        ${statusBadgeHtml}
      </div>
      ${categoryBadgeHtml ? `<div class="live-stream-card__category-top">${categoryBadgeHtml}</div>` : ''}
      <div class="live-stream-card__products-badge">
        🛍️ ${stream.product_count || (stream.products?.length || 0)} ${t('live.items') || 'items'}
      </div>
    </div>
    <div class="live-stream-card__body">
      <h3 class="live-stream-card__title" title="${stream.title}">${stream.title}</h3>
      ${stream.description ? `<p class="live-stream-card__desc">${stream.description}</p>` : ''}
      
      ${dealSnippetHtml}

      <div class="live-stream-card__host">
        <div class="live-stream-card__avatar">${(stream.host_name || 'H').slice(0, 1).toUpperCase()}</div>
        <div class="live-stream-card__host-info">
          <span class="live-stream-card__host-name">
            ${stream.host_name || 'Verified Host'}
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Verified"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path></svg>
          </span>
          <span class="live-stream-card__store-name">${stream.store_name || 'Explooro Merchant'}</span>
        </div>
      </div>

      <div class="live-stream-card__btn-container"></div>
    </div>
  `;

  const btnContainer = card.querySelector('.live-stream-card__btn-container');
  let ctaLabel = t('live.watch_live') || 'Watch Live';
  let ctaVariant = 'primary';
  if (isScheduled) {
    ctaLabel = t('live.set_reminder') || 'View Schedule';
    ctaVariant = 'secondary';
  } else if (isEnded) {
    ctaLabel = t('live.watch_replay') || 'Watch Replay';
    ctaVariant = 'secondary';
  }

  const actionBtn = Button({
    label: ctaLabel,
    variant: ctaVariant,
    size: 'sm',
    fullWidth: true,
    onClick: () => {
      if (onWatchClick) onWatchClick(stream);
    },
  });
  btnContainer.append(actionBtn);

  return card;
}
