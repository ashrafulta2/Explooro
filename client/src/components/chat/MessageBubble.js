/**
 * MessageBubble.js — Chat Message Bubble (Prompt 8.4).
 *
 * Implements:
 * - Read receipts and delivery state (Sending ⏳, Delivered ✓, Read ✓✓, Failed ⚠️).
 * - Retry affordance on send failure.
 * - Interactive product cards with 1-tap checkout CTA buttons.
 * - Moderation report action trigger.
 */

import { formatDate } from '../../services/format.js';
import { t } from '../../services/i18n.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';

export function MessageBubble({ message, isOutgoing, currentUserId, onRetry }) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble-container flex mb-3 ${isOutgoing ? 'justify-end' : 'justify-start'}`;

  const payload = message.payload_json || {};
  const status = message.status || (message.id ? 'DELIVERED' : 'SENDING');
  const isRead = Array.isArray(message.read_by) && message.read_by.length > 1;

  // Status indicator icon for outgoing messages
  let statusIndicator = '';
  if (isOutgoing) {
    if (status === 'SENDING') {
      statusIndicator = '<span class="text-muted text-xxs ml-1" title="Sending...">⏳</span>';
    } else if (status === 'FAILED') {
      statusIndicator = '<span class="text-rose-500 font-bold text-xxs ml-1" title="Failed to send">⚠️</span>';
    } else if (isRead) {
      statusIndicator = '<span class="text-emerald text-xxs ml-1" title="Read">✓✓</span>';
    } else {
      statusIndicator = '<span class="text-secondary text-xxs ml-1" title="Delivered">✓</span>';
    }
  }

  if (message.msg_type === 'PRODUCT_CARD') {
    bubble.innerHTML = `
      <div class="product-bubble border rounded-lg p-3 max-w-sm shadow-sm ${isOutgoing ? 'bg-primary-subtle border-primary' : 'bg-surface'}">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="badge badge--emerald text-xxs font-semibold">🛍️ ${t('chat.product_card_badge') || 'Product Offer'}</span>
          <button class="btn-report-msg text-xxs text-muted hover:text-rose-500" title="Report message">🚩</button>
        </div>
        <h5 class="font-bold text-sm mb-1">${payload.productTitle || 'Featured Product'}</h5>
        <div class="font-semibold text-primary text-sm mb-2">৳${payload.price || '0.00'}</div>
        <a href="${payload.checkoutUrl || '#'}" target="_blank" class="btn btn--primary btn--xs w-full block text-center">
          ${t('chat.buy_now_btn') || 'Buy Now / অর্ডার করুন ⚡'}
        </a>
        <div class="flex items-center justify-between mt-2 pt-1 border-t text-xxs text-muted">
          <span>${formatDate(message.created_at)}</span>
          <div class="flex items-center">${statusIndicator}</div>
        </div>
      </div>
    `;
  } else {
    bubble.innerHTML = `
      <div class="message-bubble-body rounded-lg px-3.5 py-2 max-w-md shadow-xs ${
        isOutgoing ? 'bg-primary text-primary-contrast rounded-br-none' : 'bg-surface text-base rounded-bl-none border'
      }">
        <div class="flex items-start justify-between gap-3">
          <p class="text-sm whitespace-pre-wrap break-words leading-relaxed">${message.content || ''}</p>
          ${!isOutgoing ? '<button class="btn-report-msg text-xxs text-muted hover:text-rose-500 shrink-0" title="Report message">🚩</button>' : ''}
        </div>
        <div class="flex items-center justify-end gap-1 mt-1 text-xxs ${isOutgoing ? 'text-primary-contrast opacity-75' : 'text-muted'}">
          <span>${formatDate(message.created_at)}</span>
          ${statusIndicator}
        </div>
        ${
          status === 'FAILED'
            ? `<div class="mt-1 pt-1 border-t border-rose-200 flex items-center justify-between">
                 <span class="text-xxs text-rose-500">Failed to deliver</span>
                 <button class="btn-retry-send text-xxs font-bold text-primary underline">Retry</button>
               </div>`
            : ''
        }
      </div>
    `;
  }

  // Report message handler
  const reportBtn = bubble.querySelector('.btn-report-msg');
  if (reportBtn) {
    reportBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const reason = prompt(t('chat.report_prompt') || 'Please provide a reason for reporting this message:');
      if (!reason) return;
      try {
        await api.post(`/chat/messages/${message.id}/report`, { reason });
        toast.success(t('chat.report_submitted') || 'Message reported to moderation team.');
      } catch (err) {
        toast.error(err.message);
      }
    });
  }

  // Retry handler
  const retryBtn = bubble.querySelector('.btn-retry-send');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      if (onRetry) onRetry(message);
    });
  }

  return bubble;
}
