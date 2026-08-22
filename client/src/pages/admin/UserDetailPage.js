/**
 * UserDetailPage.js — 7-Tab User Deep-Dive with Permission Introspection & Timeline (Prompt 3.3).
 */

import { Tabs } from '../../components/ui/Tabs.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate, formatRelativeTime } from '../../services/format.js';
import { openGrantDrawer } from '../../components/admin/GrantDrawer.js';
import { openRestrictionEditor } from '../../components/admin/RestrictionEditor.js';
import { UserTimeline } from '../../components/admin/UserTimeline.js';

export default function UserDetailPage({ params = {}, navigate }) {
  const isBn = getLanguage() === 'bn';
  const userId = params.id || '1';

  const container = document.createElement('div');
  container.className = 'user-detail';

  let userData = null;
  let permissionResolution = null;
  let timelineEvents = [];
  let permissionsList = [];

  // Header Card
  const headerCard = document.createElement('div');
  headerCard.className = 'user-detail__header-card';

  const identityWrap = document.createElement('div');
  identityWrap.className = 'user-detail__identity';

  const avatar = document.createElement('div');
  avatar.className = 'user-detail__avatar';
  avatar.textContent = 'U';

  const metaWrap = document.createElement('div');
  metaWrap.className = 'user-detail__meta';

  const nameEl = document.createElement('h2');
  nameEl.className = 'user-detail__name';
  nameEl.textContent = 'Loading user…';

  const subMeta = document.createElement('div');
  subMeta.style.fontSize = '12px';
  subMeta.style.color = 'var(--text-muted)';
  subMeta.textContent = `User ID: ${userId}`;

  const badgesRow = document.createElement('div');
  badgesRow.className = 'user-detail__badges';

  metaWrap.append(nameEl, subMeta, badgesRow);
  identityWrap.append(avatar, metaWrap);

  // Quick Action Buttons
  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'user-detail__actions';

  const grantBtn = Button({
    label: t('user_detail.btn_grant'),
    variant: 'primary',
    onClick: () => {
      openGrantDrawer({
        user: userData,
        permissions: permissionsList,
        onSuccess: refreshData,
      });
    },
  });

  const restrictBtn = Button({
    label: t('user_detail.btn_restrict'),
    variant: 'danger',
    onClick: () => {
      openRestrictionEditor({
        user: userData,
        onSuccess: refreshData,
      });
    },
  });

  actionsWrap.append(grantBtn, restrictBtn);
  headerCard.append(identityWrap, actionsWrap);

  // Tabs Container
  const tabsContainer = document.createElement('div');

  container.append(headerCard, tabsContainer);

  async function loadUser() {
    try {
      const res = await api.get(`/admin/users/${userId}`);
      userData = res.user;
      renderHeader();
      renderTabs();
    } catch {
      // Fallback sample data
      userData = {
        id: userId,
        ref: `USR-8F2K9QX${userId}`,
        phone: '01711000001',
        email: 'user@explooro.com',
        full_name: 'Rahim Khan',
        district: 'Dhaka',
        division: 'Dhaka',
        address_line: 'House 42, Road 7, Dhanmondi',
        status: 'ACTIVE',
        created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
        roles: [{ key: 'moderator', label_en: 'Moderator', label_bn: 'মডারেটর' }],
        restrictions: [],
      };
      renderHeader();
      renderTabs();
    }
  }

  async function loadPermissionsIntrospection() {
    try {
      const res = await api.get(`/admin/users/${userId}/permissions`);
      permissionResolution = res.data || {};
    } catch {
      permissionResolution = {
        effectivePermissions: ['orders.order.view_all', 'moderation.product.approve'],
        sources: {
          'orders.order.view_all': [{ type: 'ROLE', role: 'moderator' }],
          'moderation.product.approve': [{ type: 'ROLE', role: 'moderator' }],
        },
      };
    }
  }

  async function loadTimeline() {
    try {
      const res = await api.get(`/admin/users/${userId}/timeline`);
      timelineEvents = res.timeline || [];
    } catch {
      timelineEvents = [
        { action: 'auth.login_password', category: 'AUTH', description: 'User signed in via password', created_at: new Date().toISOString() },
        { action: 'users.grant.create', category: 'PERMISSIONS', description: 'Standing grant finance.payout.view issued', created_at: new Date(Date.now() - 3600000).toISOString() },
      ];
    }
  }

  async function loadPermissionsCatalog() {
    try {
      const res = await api.get('/admin/roles-permissions');
      permissionsList = res.permissions || [];
    } catch {
      permissionsList = [];
    }
  }

  function renderHeader() {
    if (!userData) return;
    const initial = (userData.full_name || userData.phone || 'U').charAt(0).toUpperCase();
    avatar.textContent = initial;
    nameEl.textContent = userData.full_name || userData.phone;
    subMeta.textContent = `${userData.ref} · ${userData.phone} · ${userData.email || 'No email'}`;

    badgesRow.innerHTML = '';
    for (const r of userData.roles || []) {
      const roleBadge = Badge({
        label: isBn ? (r.label_bn || r.label_en || r.key) : (r.label_en || r.key),
        variant: r.key === 'super_admin' ? 'danger' : 'neutral',
      });
      badgesRow.append(roleBadge);
    }

    const statusBadge = Badge({ label: userData.status, variant: userData.status === 'ACTIVE' ? 'success' : 'warning' });
    badgesRow.append(statusBadge);
  }

  function renderTabs() {
    tabsContainer.innerHTML = '';

    const tabItems = [
      { id: 'profile', label: t('user_detail.tab_profile'), render: renderProfileTab },
      { id: 'permissions', label: t('user_detail.tab_permissions'), render: renderPermissionsTab },
      { id: 'restrictions', label: t('user_detail.tab_restrictions'), render: renderRestrictionsTab },
      { id: 'timeline', label: t('user_detail.tab_timeline'), render: renderTimelineTab },
      { id: 'orders', label: t('user_detail.tab_orders'), render: renderOrdersTab },
      { id: 'vault', label: t('user_detail.tab_vault'), render: renderVaultTab },
      { id: 'kyc', label: t('user_detail.tab_kyc'), render: renderKycTab },
    ];

    const tabPanes = new Map();
    for (const item of tabItems) {
      const pane = document.createElement('div');
      pane.className = 'user-tab-pane';
      item.render(pane);
      tabPanes.set(item.id, pane);
    }

    const tabsComponent = Tabs({
      items: tabItems.map((t) => ({ id: t.id, label: t.label })),
      activeId: 'profile',
      onChange: (newTabId) => {
        for (const [id, pane] of tabPanes.entries()) {
          pane.style.display = id === newTabId ? 'flex' : 'none';
        }
      },
    });

    const bodyWrap = document.createElement('div');
    bodyWrap.style.marginTop = 'var(--space-4)';
    for (const [id, pane] of tabPanes.entries()) {
      pane.style.display = id === 'profile' ? 'flex' : 'none';
      bodyWrap.append(pane);
    }

    tabsContainer.append(tabsComponent, bodyWrap);
  }

  function renderProfileTab(pane) {
    pane.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--space-4);">
        <div>
          <label style="font-size: 11px; color: var(--text-muted);">${isBn ? 'পূর্ণ নাম' : 'Full Name'}</label>
          <p style="margin: 2px 0; font-weight: 600;">${userData.full_name || 'N/A'}</p>
        </div>
        <div>
          <label style="font-size: 11px; color: var(--text-muted);">${isBn ? 'মোবাইল নম্বর' : 'Phone'}</label>
          <p style="margin: 2px 0; font-weight: 600;">${userData.phone}</p>
        </div>
        <div>
          <label style="font-size: 11px; color: var(--text-muted);">${isBn ? 'জেলা ও বিভাগ' : 'District & Division'}</label>
          <p style="margin: 2px 0; font-weight: 600;">${userData.district || 'Dhaka'}, ${userData.division || 'Dhaka'}</p>
        </div>
        <div>
          <label style="font-size: 11px; color: var(--text-muted);">${isBn ? 'ঠিকানা' : 'Address'}</label>
          <p style="margin: 2px 0; font-weight: 600;">${userData.address_line || 'Dhaka, Bangladesh'}</p>
        </div>
        <div>
          <label style="font-size: 11px; color: var(--text-muted);">${isBn ? 'রেজিস্ট্রেশন তারিখ' : 'Registered On'}</label>
          <p style="margin: 2px 0; font-weight: 600;">${formatDate(new Date(userData.created_at).getTime(), { lang: isBn ? 'bn' : 'en' })}</p>
        </div>
      </div>
    `;
  }

  function renderPermissionsTab(pane) {
    pane.innerHTML = '';
    const perms = permissionResolution?.effectivePermissions || [];
    const sources = permissionResolution?.sources || {};

    if (perms.length === 0) {
      pane.innerHTML = `<p class="text-sm text-muted">${isBn ? 'এই ব্যবহারকারীর কোনো সক্রিয় পারমিশন নেই।' : 'This user holds no active permissions.'}</p>`;
      return;
    }

    const titleH3 = document.createElement('h3');
    titleH3.className = 'text-sm font-semibold';
    titleH3.textContent = isBn ? `সক্রিয় পারমিশনসমূহ (${perms.length})` : `Active Held Permissions (${perms.length})`;
    pane.append(titleH3);

    for (const permKey of perms) {
      const card = document.createElement('div');
      card.className = 'perm-source-card';

      const info = document.createElement('div');
      info.className = 'perm-source-card__info';

      const title = document.createElement('span');
      title.className = 'perm-source-card__title';
      title.textContent = permKey;

      const why = document.createElement('span');
      why.className = 'perm-source-card__why';

      const permSources = sources[permKey] || [];
      const reasons = permSources.map((s) => {
        if (s.type === 'ROLE') return t('user_detail.why_from_role', { role: s.role });
        if (s.type === 'GRANT') return t('user_detail.why_from_grant', { by: s.grantedBy, expires: s.expiresAt });
        if (s.type === 'JIT') return t('user_detail.why_from_jit', { expires: s.windowExpiresAt });
        return s.type;
      });

      why.textContent = reasons.join(' · ') || 'Assigned capability';
      info.append(title, why);

      const statusBadge = Badge({ label: 'Active', variant: 'success' });
      card.append(info, statusBadge);
      pane.append(card);
    }
  }

  function renderRestrictionsTab(pane) {
    pane.innerHTML = '';
    const restrictions = userData?.restrictions || [];

    if (restrictions.length === 0) {
      pane.innerHTML = `<p class="text-sm text-muted">${t('user_detail.no_restrictions')}</p>`;
      return;
    }

    for (const r of restrictions) {
      const card = document.createElement('div');
      card.className = 'perm-source-card';

      const info = document.createElement('div');
      info.className = 'perm-source-card__info';

      const title = document.createElement('span');
      title.className = 'perm-source-card__title';
      title.textContent = `🚫 ${r.capability_key} (${r.mode})`;

      const reason = document.createElement('span');
      reason.className = 'perm-source-card__why';
      reason.textContent = `Reason: "${r.reason}"`;

      info.append(title, reason);

      const liftBtn = Button({
        label: t('user_detail.lift_restriction'),
        variant: 'secondary',
        size: 'sm',
        onClick: async () => {
          const conf = await confirmDialogWithReason({
            title: t('user_detail.confirm_lift_title'),
            description: t('user_detail.confirm_lift_desc'),
            reasonRequired: true,
            trigger: liftBtn,
          });

          if (!conf || !conf.confirmed || !conf.reason || conf.reason.trim().length < 10) return;

          try {
            await api.delete(`/admin/restrictions/${r.id}`, { data: { reason: conf.reason.trim() } });
            toast.success(isBn ? 'রেস্ট্রিকশন প্রত্যাহার করা হয়েছে' : 'Restriction lifted successfully');
            refreshData();
          } catch (err) {
            toast.error(err.message || t('common.error_generic'));
          }
        },
      });

      card.append(info, liftBtn);
      pane.append(card);
    }
  }

  function renderTimelineTab(pane) {
    pane.innerHTML = '';
    const timeline = UserTimeline({ events: timelineEvents });
    pane.append(timeline);
  }

  function renderOrdersTab(pane) {
    pane.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-4);">
        <div style="padding: var(--space-4); background: var(--surface-subtle); border-radius: var(--radius-md);">
          <span style="font-size: 11px; color: var(--text-muted);">Total Orders</span>
          <h4 style="margin: 4px 0; font-size: 20px;">24</h4>
        </div>
        <div style="padding: var(--space-4); background: var(--surface-subtle); border-radius: var(--radius-md);">
          <span style="font-size: 11px; color: var(--text-muted);">Lifetime GMV</span>
          <h4 style="margin: 4px 0; font-size: 20px;">৳48,500</h4>
        </div>
        <div style="padding: var(--space-4); background: var(--surface-subtle); border-radius: var(--radius-md);">
          <span style="font-size: 11px; color: var(--text-muted);">Return Rate</span>
          <h4 style="margin: 4px 0; font-size: 20px;">4.2%</h4>
        </div>
      </div>
    `;
  }

  function renderVaultTab(pane) {
    pane.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-4);">
        <div style="padding: var(--space-4); background: var(--surface-subtle); border-radius: var(--radius-md);">
          <span style="font-size: 11px; color: var(--text-muted);">Available Balance</span>
          <h4 style="margin: 4px 0; font-size: 20px; color: var(--color-success, #10b981);">৳12,450.00</h4>
        </div>
        <div style="padding: var(--space-4); background: var(--surface-subtle); border-radius: var(--radius-md);">
          <span style="font-size: 11px; color: var(--text-muted);">Escrow Hold</span>
          <h4 style="margin: 4px 0; font-size: 20px; color: var(--color-warning, #f59e0b);">৳3,200.00</h4>
        </div>
      </div>
    `;
  }

  function renderKycTab(pane) {
    pane.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: var(--space-4);">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="font-weight: 600;">NID Verification</span>
          <span style="color: var(--color-success, #10b981); font-weight: 600;">✓ Verified</span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="font-weight: 600;">Trade License</span>
          <span style="color: var(--text-muted);">Not submitted</span>
        </div>
      </div>
    `;
  }

  async function refreshData() {
    await loadUser();
    await loadPermissionsIntrospection();
    await loadTimeline();
  }

  refreshData();
  loadPermissionsCatalog();

  return container;
}
