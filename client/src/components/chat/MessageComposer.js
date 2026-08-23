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
}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'chat-composer-component border-t p-3 bg-surface';

  const quickReplies = [
    { en: 'Is this item available in stock?', bn: 'পণ্যটি কি বর্তমানে স্টকে আছে?' },
    { en: 'What is the delivery charge for Dhaka?', bn: 'ঢাকার ভিতরে ডেলিভারি চার্জ কত?' },
    { en: 'Cash on Delivery (COD) is supported.', bn: 'ক্যাশ অন ডেলিভারি (সিওডি) সুবিধা রয়েছে।' },
    { en: 'Thank you! Order confirmed.', bn: 'ধন্যবাদ! অর্ডার কনফার্ম করা হয়েছে।' },
  ];

  container.innerHTML = `
    ${
      isOffline
        ? `<div class="offline-queue-badge bg-amber-500 text-white text-xxs px-2 py-1 rounded mb-2 flex items-center justify-between">
             <span>⚠️ ${t('chat.offline_banner') || 'Offline: Messages will queue and auto-send when connection restores.'}</span>
           </div>`
        : ''
    }
    <div class="quick-replies-scroll flex items-center gap-1.5 overflow-x-auto pb-2 mb-1" id="composer-quick-replies"></div>
    <div class="composer-input-row flex items-end gap-2">
      <button class="btn btn--secondary btn--sm btn-prod-insert shrink-0" id="btn-insert-product" title="Insert Product Card">
        📦
      </button>
      <button class="btn btn--secondary btn--sm btn-img-attach shrink-0" id="btn-attach-image" title="Attach Image">
        📎
      </button>
      <textarea class="input input--sm flex-1 resize-none py-2" id="composer-textarea" rows="1" placeholder="${t('chat.type_message_placeholder') || 'Type a message...'}" style="min-height: 38px; max-height: 120px;"></textarea>
      <button class="btn btn--primary btn--sm shrink-0" id="btn-send-msg">
        ${t('chat.send_button') || 'Send'}
      </button>
    </div>
    <div class="upload-progress-bar hidden mt-2" id="upload-progress-box">
      <div class="flex items-center justify-between text-xxs text-secondary mb-1">
        <span>Uploading image...</span>
        <span id="upload-pct">0%</span>
      </div>
      <div class="w-full bg-base rounded-full h-1.5 overflow-hidden">
        <div class="bg-primary h-full transition-all duration-150" id="upload-progress-fill" style="width: 0%;"></div>
      </div>
    </div>
  `;

  const textarea = container.querySelector('#composer-textarea');
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
    let pct = 0;
    const interval = setInterval(() => {
      pct += 25;
      progressFill.style.width = `${pct}%`;
      progressPct.textContent = `${pct}%`;
      if (pct >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          progressBox.classList.add('hidden');
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
