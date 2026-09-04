/**
 * MessageComposer.js — Chat Message Composer (Prompt 8.4).
 *
 * Implements:
 * - Text input with Enter to send.
 * - Typing indicators emitted on keystrokes.
 * - Quick replies bar.
 * - Product card insertion trigger.
 * - Image attachment simulator with progress bar.
 */

import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

export function MessageComposer({
  onSendMessage,
  onSendTyping,
  onOpenProductModal,
  isOffline = false,
  initialValue = '',
}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'chat-composer-component';

  const quickReplies = [
    { en: 'Is this item available in stock?', bn: 'পণ্যটি কি বর্তমানে স্টকে আছে?' },
    { en: 'What is the delivery charge for Dhaka?', bn: 'ঢাকার ভিতরে ডেলিভারি চার্জ কত?' },
    { en: 'Cash on Delivery (COD) is supported.', bn: 'ক্যাশ অন ডেলিভারি (সিওডি) সুবিধা রয়েছে।' },
    { en: 'Thank you! Order confirmed.', bn: 'ধন্যবাদ! অর্ডার কনফার্ম করা হয়েছে।' },
  ];

  container.innerHTML = `
    ${
      isOffline
        ? `<div class="offline-queue-banner mb-2">
             <span>⚠️ ${t('chat.offline_banner') || 'Offline: Messages will queue and auto-send when connection restores.'}</span>
           </div>`
        : ''
    }
    <div class="quick-replies-scroll" id="composer-quick-replies"></div>
    <div class="composer-input-row">
      <button type="button" class="composer-action-btn" id="btn-insert-product" title="${t('chat.btn_insert_card') || 'Insert Product Card'}" aria-label="Insert Product Card">
        📦
      </button>
      <button type="button" class="composer-action-btn" id="btn-attach-image" title="Attach Image" aria-label="Attach Image">
        📎
      </button>
      <textarea class="composer-textarea" id="composer-textarea" rows="1" placeholder="${t('chat.type_message_placeholder') || 'Type a message...'}"></textarea>
      <button type="button" class="composer-send-btn" id="btn-send-msg">
        <span>${t('chat.send_button') || 'Send'}</span>
        <span>➤</span>
      </button>
    </div>
    <div class="upload-progress-box hidden" id="upload-progress-box" hidden>
      <div class="upload-progress-label-row">
        <span>Uploading image...</span>
        <span id="upload-pct">0%</span>
      </div>
      <div class="upload-progress-track">
        <div class="upload-progress-bar-fill" id="upload-progress-fill" style="width: 0%;"></div>
      </div>
    </div>
  `;

  const textarea = container.querySelector('#composer-textarea');
  if (initialValue) {
    textarea.value = initialValue;
  }
  const sendBtn = container.querySelector('#btn-send-msg');
  const qrBox = container.querySelector('#composer-quick-replies');

  // Render quick replies
  quickReplies.forEach((qr) => {
    const chip = document.createElement('button');
    chip.className = 'quick-reply-chip text-xxs px-2.5 py-1 rounded-full border bg-base hover:bg-surface transition-colors shrink-0';
    chip.textContent = isBn ? qr.bn : qr.en;
    chip.addEventListener('click', () => {
      textarea.value = chip.textContent;
      textarea.focus();
      handleInput();
    });
    qrBox.appendChild(chip);
  });

  // Typing debounce timer
  let typingTimer = null;
  function emitTyping(isTyping) {
    if (onSendTyping) onSendTyping(isTyping);
  }

  function handleInput() {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;

    emitTyping(true);
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      emitTyping(false);
    }, 2000);
  }

  textarea.addEventListener('input', handleInput);

  function doSend() {
    const text = (textarea.value || '').trim();
    if (!text) return;
    textarea.value = '';
    textarea.style.height = '38px';
    emitTyping(false);
    if (typingTimer) clearTimeout(typingTimer);

    if (onSendMessage) {
      onSendMessage(text);
    }
  }

  sendBtn.addEventListener('click', doSend);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  // Product insertion action
  container.querySelector('#btn-insert-product').addEventListener('click', () => {
    if (onOpenProductModal) onOpenProductModal();
  });

  // Image attachment simulation
  container.querySelector('#btn-attach-image').addEventListener('click', () => {
    const progressBox = container.querySelector('#upload-progress-box');
    const progressFill = container.querySelector('#upload-progress-fill');
    const progressPct = container.querySelector('#upload-pct');

    progressBox.classList.remove('hidden');
    progressBox.removeAttribute('hidden');
    let pct = 0;
    const interval = setInterval(() => {
      pct += 25;
      progressFill.style.width = `${pct}%`;
      progressPct.textContent = `${pct}%`;
      if (pct >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          progressBox.classList.add('hidden');
          progressBox.setAttribute('hidden', '');
          progressFill.style.width = '0%';
          if (onSendMessage) {
            onSendMessage('📷 [Image Attachment: product_sample.jpg]');
          }
        }, 300);
      }
    }, 150);
  });

  return container;
}
