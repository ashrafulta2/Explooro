/**
 * ThreadList.js — Chat Conversation List (Prompt 8.4).
 *
 * Renders thread cards with unread counts, channel badges, participant roles, and live search.
 */

import { t } from '../../services/i18n.js';
import { formatDate } from '../../services/format.js';

export function ThreadList({ threads = [], selectedThreadId = null, onSelectThread }) {
  const container = document.createElement('div');
  container.className = 'chat-thread-list-component flex flex-col h-full';

  let currentFilter = '';

  container.innerHTML = `
    <div class="thread-list-search p-3 border-b">
      <input type="text" class="input input--sm w-full" id="thread-search-input" placeholder="${t('chat.search_threads') || 'Search conversations...'}" />
    </div>
    <div class="thread-items-container flex-1 overflow-y-auto" id="thread-items-box"></div>
  `;

  const box = container.querySelector('#thread-items-box');
  const searchInput = container.querySelector('#thread-search-input');

  function renderItems() {
    box.innerHTML = '';
    const q = currentFilter.toLowerCase().trim();

    const filtered = threads.filter((th) => {
      const preview = (th.last_message_preview || '').toLowerCase();
      const ref = (th.ref || '').toLowerCase();
      const phone = (th.customerPhone || '').toLowerCase();
      return preview.includes(q) || ref.includes(q) || phone.includes(q);
    });

    if (filtered.length === 0) {
      box.innerHTML = `<div class="p-6 text-center text-xs text-muted">${t('chat.no_conversations') || 'No conversations found.'}</div>`;
      return;
    }

    filtered.forEach((th) => {
      const isSelected = th.id === selectedThreadId;
      const unread = Number(th.unread_count) || 0;

      const card = document.createElement('div');
      card.className = `chat-thread-card p-3 border-b cursor-pointer transition-colors hover:bg-base ${
        isSelected ? 'bg-surface font-semibold border-l-4 border-l-primary' : ''
      }`;

      const channel = th.metadata_json?.channel || th.channel || 'IN_PLATFORM';
      const channelBadge = channel === 'WHATSAPP'
        ? '<span class="badge badge--emerald text-xxs">🟢 WA</span>'
        : channel === 'MESSENGER'
        ? '<span class="badge badge--primary text-xxs">🔵 FB</span>'
        : '<span class="badge badge--indigo text-xxs">🟣 In-App</span>';

      card.innerHTML = `
        <div class="flex items-center justify-between gap-2 mb-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="truncate text-sm">${th.customerPhone || th.other_participant_name || `Thread #${th.ref}`}</span>
            ${channelBadge}
          </div>
          <span class="text-xxs text-muted shrink-0">${formatDate(th.last_message_at)}</span>
        </div>
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs text-secondary truncate flex-1">${th.last_message_preview || 'No messages yet'}</p>
          ${unread > 0 ? `<span class="badge badge--primary text-xxs rounded-full px-1.5">${unread}</span>` : ''}
        </div>
      `;

      card.addEventListener('click', () => {
        if (onSelectThread) onSelectThread(th);
      });

      box.appendChild(card);
    });
  }

  searchInput.addEventListener('input', (e) => {
    currentFilter = e.target.value;
    renderItems();
  });

  renderItems();
  return container;
}
