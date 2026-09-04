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
  bubble.className = `chat-bubble-container ${isOutgoing ? 'outgoing' : 'incoming'}`;

  const payload = message.payload_json || {};
  const status = message.status || (message.id ? 'DELIVERED' : 'SENDING');
  const isRead = Array.isArray(message.read_by) && message.read_by.length > 1;

  // Status indicator icon for outgoing messages
  let statusIndicator = '';
  if (isOutgoing) {
    if (status === 'SENDING') {
      statusIndicator = '<span class="message-status-icon" title="Sending...">⏳</span>';
    } else if (status === 'FAILED') {
      statusIndicator = '<span class="message-status-icon" style="color: var(--danger); font-weight: bold;" title="Failed to send">⚠️</span>';
    } else if (isRead) {
      statusIndicator = '<span class="message-status-icon message-status-read" title="Read">✓✓</span>';
    } else {
      statusIndicator = '<span class="message-status-icon" title="Delivered">✓</span>';
    }
  }

  if (message.msg_type === 'PRODUCT_CARD') {
    bubble.innerHTML = `
      <div class="product-bubble">
        <div class="product-bubble-header">
          <span class="product-bubble-badge">🛍️ ${t('chat.product_card_badge') || 'Product Offer'}</span>
          <button class="btn-report-msg" title="Report message">🚩</button>
        </div>
        <h5 class="product-bubble-title">${payload.productTitle || 'Featured Product'}</h5>
        <div class="product-bubble-price">৳${payload.price || '0.00'}</div>
        <a href="${payload.checkoutUrl || '#'}" target="_blank" class="product-bubble-cta">
          ${t('chat.buy_now_btn') || 'Buy Now / অর্ডার করুন ⚡'}
        </a>
        <div class="message-meta-row">
          <span>${formatDate(message.created_at)}</span>
          ${statusIndicator}
        </div>
      </div>
    `;
  } else {
    bubble.innerHTML = `
      <div class="message-bubble-body">
        <div class="message-bubble-content">
          <p class="message-text">${message.content || ''}</p>
          ${!isOutgoing ? '<button class="btn-report-msg" title="Report message">🚩</button>' : ''}
        </div>
        <div class="message-meta-row">
          <span>${formatDate(message.created_at)}</span>
          ${statusIndicator}
        </div>
        ${
          status === 'FAILED'
            ? `<div class="message-failed-footer">
                 <span style="color: var(--danger);">${t('chat.failed_to_deliver') || 'Failed to deliver'}</span>
                 <button class="btn-retry-send">${t('chat.retry') || 'Retry'}</button>
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
