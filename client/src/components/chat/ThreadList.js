/**
 * ThreadList.js — Chat Conversation List (Prompt 8.4).
 *
 * Renders thread cards with unread counts, channel badges, participant roles, and live search.
 */

import { t } from '../../services/i18n.js';
import { formatDate } from '../../services/format.js';

export function ThreadList({ threads = [], selectedThreadId = null, onSelectThread }) {
  const container = document.createElement('div');
  container.className = 'chat-thread-list-component';

  let currentFilter = '';

  container.innerHTML = `
    <div class="thread-list-search">
      <div class="thread-search-input-wrap">
        <span class="thread-search-icon">🔍</span>
        <input type="text" class="input input--sm" id="thread-search-input" placeholder="${t('chat.search_threads') || 'Search conversations...'}" />
      </div>
    </div>
    <div class="thread-items-container" id="thread-items-box"></div>
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
      const name = (th.other_participant_name || '').toLowerCase();
      return preview.includes(q) || ref.includes(q) || phone.includes(q) || name.includes(q);
    });

    if (filtered.length === 0) {
      box.innerHTML = `
        <div class="chat-empty-state" style="padding: 32px 16px;">
          <span style="font-size: 28px; margin-bottom: 8px; display: block;">🔍</span>
          <p style="font-size: 12px; color: var(--text-muted);">${t('chat.no_conversations') || 'No conversations found.'}</p>
        </div>
      `;
      return;
    }

    filtered.forEach((th) => {
      const isSelected = String(th.id) === String(selectedThreadId);
      const unread = Number(th.unread_count) || 0;

      const card = document.createElement('div');
      card.className = `chat-thread-card ${isSelected ? 'selected active' : ''} ${unread > 0 ? 'unread' : ''}`;

      const displayName = th.other_participant_name || th.customerPhone || `Thread #${th.ref}`;
      const initial = (displayName.replace(/[^a-zA-Z0-9]/g, '')[0] || displayName[0] || 'C').toUpperCase();

      const channel = th.metadata_json?.channel || th.channel || 'IN_PLATFORM';
      const channelBadge = channel === 'WHATSAPP'
        ? '<span class="channel-pill whatsapp">🟢 WA</span>'
        : channel === 'MESSENGER'
        ? '<span class="channel-pill messenger">🔵 FB</span>'
        : '<span class="channel-pill in-platform">🟣 In-App</span>';

      card.innerHTML = `
        <div class="thread-card-top">
          <div class="thread-participant-info">
            <div class="thread-avatar">${initial}</div>
            <div class="thread-text-details">
              <div class="thread-name-row">
                <span class="thread-name">${displayName}</span>
                ${channelBadge}
              </div>
              ${th.customerPhone && th.other_participant_name ? `<span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${th.customerPhone}</span>` : ''}
            </div>
          </div>
          <span class="thread-meta-time">${formatDate(th.last_message_at)}</span>
        </div>
        <div class="thread-card-bottom">
          <p class="thread-snippet">${th.last_message_preview || 'No messages yet'}</p>
          ${unread > 0 ? `<div class="thread-unread-badge">${unread}</div>` : ''}
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
