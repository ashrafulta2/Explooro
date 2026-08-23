/**
 * LiveStreamCard.js — Discovery card for live & scheduled broadcast sessions (Prompt 10.1).
 */

import { formatBdt } from '../../services/format.js';
import { t, getLanguage } from '../../services/i18n.js';

export function LiveStreamCard({ stream, onWatchClick }) {
  const card = document.createElement('div');
  card.className = 'live-stream-card';

  const isLive = stream.status === 'LIVE';
  const isScheduled = stream.status === 'SCHEDULED';

  const statusBadge = isLive
    ? `<span class="live-status-pill live-status-pill--live"><span class="pulse-dot"></span> LIVE (${stream.viewer_count || 0})</span>`
    : `<span class="live-status-pill live-status-pill--scheduled">⏰ ${t('live.scheduled') || 'Scheduled'}</span>`;

  card.innerHTML = `
    <div class="live-stream-card__thumb-wrapper">
      <img 
        class="live-stream-card__thumb" 
        src="${stream.cover_image || '/placeholder-product.png'}" 
        alt="${stream.title}"
        onerror="this.src='/placeholder-product.png'"
      />
      <div class="live-stream-card__badge-top">
        ${statusBadge}
      </div>
      <div class="live-stream-card__products-badge">
        🛍️ ${stream.product_count || 0} ${t('live.items') || 'items'}
      </div>
    </div>
    <div class="live-stream-card__body">
      <h3 class="live-stream-card__title">${stream.title}</h3>
      <div class="live-stream-card__host">
        <div class="live-stream-card__avatar">${(stream.host_name || 'H').slice(0, 1).toUpperCase()}</div>
        <div class="live-stream-card__host-info">
          <span class="live-stream-card__host-name">${stream.host_name || 'Host'}</span>
          <span class="live-stream-card__store-name">${stream.store_name || 'Verified Store'}</span>
        </div>
      </div>
      <button class="btn ${isLive ? 'btn--primary' : 'btn--secondary'} btn--block btn--sm live-stream-card__btn">
        ${isLive ? `▶ ${t('live.watch_live') || 'Watch Live'}` : `📅 ${t('live.set_reminder') || 'View Schedule'}`}
      </button>
    </div>
  `;

  const btn = card.querySelector('.live-stream-card__btn');
  if (btn && onWatchClick) {
    btn.addEventListener('click', () => onWatchClick(stream));
  }

  return card;
}
