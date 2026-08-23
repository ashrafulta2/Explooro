/**
 * NotificationCenter.js — Unified In-App Notification Center Drawer (Prompt 8.2).
 *
 * Implements:
 * - Slide-out / dropdown drawer for notification items.
 * - Category filter tabs (ALL, ORDERS, PAYMENTS, SECURITY, MARKETING, SYSTEM).
 * - Real-time WebSocket arrival listener (`notification:new`).
 * - Unread counter badge and Mark-All-Read action.
 * - Deep linking to source order/dispute/payout entity.
 */

import { Drawer } from '../ui/Drawer.js';
import { Button } from '../ui/Button.js';
import { Tabs } from '../ui/Tabs.js';
import { api } from '../../core/api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate } from '../../services/format.js';
import { toast } from '../../services/toast.js';

export function openNotificationCenter({ trigger = null, onUnreadCountChanged = null } = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'notification-center-drawer';

  let currentCategory = 'ALL';
  let notifications = [];
  let unreadCount = 0;

  // Header / Action Bar
  const headerBar = document.createElement('div');
  headerBar.className = 'notification-center-header';
  headerBar.innerHTML = `
    <div class="notification-header-title">
      <h3>${t('notifications.center_title') || 'Notifications'}</h3>
      <span class="notification-badge-count" id="drawer-unread-badge">0</span>
    </div>
  `;

  const markAllBtn = Button({
    label: t('notifications.btn_mark_all_read') || 'Mark all as read',
    variant: 'ghost',
    size: 'sm',
    onClick: async () => {
      try {
        await api.post('/api/v1/notifications/read-all');
        notifications.forEach((n) => (n.is_read = true));
        unreadCount = 0;
        updateBadge();
        renderList();
        toast.success(t('notifications.marked_all_read_success') || 'All marked as read.');
        if (onUnreadCountChanged) onUnreadCountChanged(0);
      } catch (err) {
        toast.error(err.message);
      }
    },
  });
  headerBar.appendChild(markAllBtn);
  container.appendChild(headerBar);

  // Category filter tabs
  const categoryTabs = Tabs({
    tabs: [
      { id: 'ALL', label: t('notifications.tab_all') || 'All' },
      { id: 'ORDER', label: t('notifications.tab_orders') || 'Orders' },
      { id: 'FINANCE', label: t('notifications.tab_finance') || 'Finance' },
      { id: 'SECURITY', label: t('notifications.tab_security') || 'Security' },
      { id: 'MARKETING', label: t('notifications.tab_promos') || 'Promos' },
    ],
    activeTab: 'ALL',
    onChange: (catId) => {
      currentCategory = catId;
      renderList();
    },
  });
  container.appendChild(categoryTabs);

  // Notification list container
  const listContainer = document.createElement('div');
  listContainer.className = 'notification-list-container';
  container.appendChild(listContainer);

  function updateBadge() {
    const badge = container.querySelector('#drawer-unread-badge');
    if (badge) {
      badge.textContent = String(unreadCount);
      badge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    }
  }

  function getCategoryIcon(cat) {
    switch (cat) {
      case 'SECURITY': return '🔒';
      case 'ORDER': return '📦';
      case 'FINANCE': return '💰';
      case 'MARKETING': return '🎁';
      default: return '🔔';
    }
  }

  function renderList() {
    listContainer.innerHTML = '';

    const filtered = currentCategory === 'ALL'
      ? notifications
      : notifications.filter((n) => n.category === currentCategory);

    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div class="notification-empty-state">
          <span class="empty-icon">🔔</span>
          <p>${t('notifications.empty_list') || 'No notifications in this category.'}</p>
        </div>
      `;
      return;
    }

    filtered.forEach((notif) => {
      const itemNode = document.createElement('div');
      itemNode.className = `notification-item ${notif.is_read ? 'read' : 'unread'}`;

      const title = isBn ? (notif.title_bn || notif.title_en) : notif.title_en;
      const body = isBn ? (notif.body_bn || notif.body_en) : notif.body_en;

      itemNode.innerHTML = `
        <div class="notif-icon-col">
          <span class="notif-cat-badge notif-cat-${(notif.category || 'system').toLowerCase()}">
            ${getCategoryIcon(notif.category)}
          </span>
        </div>
        <div class="notif-content-col">
          <div class="notif-title-row">
            <h4 class="notif-title">${title}</h4>
            <span class="notif-time">${formatDate(notif.created_at)}</span>
          </div>
          <p class="notif-body">${body}</p>
          ${
            notif.data_json?.linkUrl
              ? `<a href="${notif.data_json.linkUrl}" class="notif-deep-link">${t('notifications.view_details') || 'View Details →'}</a>`
              : ''
          }
        </div>
        ${
          !notif.is_read
            ? `<div class="notif-unread-dot" title="Unread"></div>`
            : ''
        }
      `;

      itemNode.addEventListener('click', async () => {
        if (!notif.is_read) {
          try {
            await api.post(`/api/v1/notifications/${notif.id}/read`);
            notif.is_read = true;
            unreadCount = Math.max(0, unreadCount - 1);
            updateBadge();
            itemNode.classList.remove('unread');
            itemNode.classList.add('read');
            const dot = itemNode.querySelector('.notif-unread-dot');
            if (dot) dot.remove();
            if (onUnreadCountChanged) onUnreadCountChanged(unreadCount);
          } catch {}
        }

        if (notif.data_json?.linkUrl) {
          window.location.hash = notif.data_json.linkUrl;
          drawerInstance.close();
        }
      });

      listContainer.appendChild(itemNode);
    });
  }

  async function fetchNotifications() {
    listContainer.innerHTML = `<div class="notification-loading">Loading notifications...</div>`;
    try {
      const res = await api.get('/api/v1/notifications?limit=50');
      notifications = res?.data?.items || [];
      unreadCount = notifications.filter((n) => !n.is_read).length;
      updateBadge();
      renderList();
    } catch (err) {
      listContainer.innerHTML = `<div class="notification-error">${err.message}</div>`;
    }
  }

  // Open Drawer
  const drawerInstance = Drawer({
    title: t('notifications.center_title') || 'Notifications',
    content: container,
    position: 'right',
    width: '420px',
  });

  fetchNotifications();

  // Listen to live WebSocket arrival
  function handleLiveNotification(e) {
    if (e?.detail?.notification) {
      const newNotif = e.detail.notification;
      notifications.unshift({
        ...newNotif,
        is_read: false,
        created_at: new Date().toISOString(),
      });
      unreadCount++;
      updateBadge();
      renderList();
      if (onUnreadCountChanged) onUnreadCountChanged(unreadCount);
    }
  }

  window.addEventListener('explooro:notification', handleLiveNotification);

  return drawerInstance;
}
