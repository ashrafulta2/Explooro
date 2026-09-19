/**
 * UserDetailPage.js — 7-Tab User Deep-Dive with Permission Introspection & Timeline (Prompt 3.3).
 *
 * Implements:
 * 1. User Identity Header (Name, Ref ID, Contact, Role/Tier/Status Badges).
 * 2. Quick Administrative Action Toolbar (Issue Standing Grant, Apply Capability Restrictions).
 * 3. 7 Deep-Dive Tabs: Profile, Roles & Permissions, Restrictions, Activity Timeline, Orders & GMV, Vault & Balance, KYC.
 * 4. Permission Introspection with clear "Why" reasoning (Role / Standing Grant / JIT / Explicit Deny).
 * 5. One-click Restriction lifting with mandatory audit justification dialog.
 * 6. Layout-mirroring skeleton loader, explicit not-found / error states and bilingual i18n support.
 *
 * WHY there is no invented fallback user: an earlier revision answered any failed request with a
 * hardcoded "Rahim Khan, Super Admin", so a mistyped id or a 500 rendered a convincing but false
 * account — on a page whose whole job is to be the source of truth before a grant or a sanction.
 * A failed load now says so, and offers a retry.
 */

import { Tabs } from '../../components/ui/Tabs.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { api } from '../../core/api.js';
import { createBackButton } from '../../core/navBack.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate, formatCurrency, formatNumber } from '../../services/format.js';
import { openGrantDrawer } from '../../components/admin/GrantDrawer.js';
import { openRestrictionEditor } from '../../components/admin/RestrictionEditor.js';
import { UserTimeline } from '../../components/admin/UserTimeline.js';
import '../../styles/components/admin-users.css';

/** Builds `<tag class="…">text</tag>`. Text always goes through textContent — never innerHTML. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/**
 * The timeline endpoint has answered in two shapes (`action/category/description` and
 * `event_type/details_en`); UserTimeline only understands the first, so normalise here.
 */
function normaliseTimelineEvent(ev) {
  const action = ev.action || ev.event_type || 'activity.event';
  let category = ev.category;
  if (!category) {
    if (/LOGIN|AUTH|2FA|PASSWORD/i.test(action)) category = 'AUTH';
    else if (/GRANT|PERMISSION/i.test(action)) category = 'PERMISSIONS';
    else if (/RESTRICT/i.test(action)) category = 'RESTRICTIONS';
    else if (/ORDER/i.test(action)) category = 'ORDERS';
    else category = 'SYSTEM';
  }
  return { ...ev, action, category, description: ev.description || ev.details_en || ev.details || action };
}

export default function UserDetailPage(root, { params = {}, navigate } = {}) {
  const isBn = getLanguage() === 'bn';
  const lang = isBn ? 'bn' : 'en';
  const userId = params.id;

  const nav = (url, opts) => {
    if (typeof navigate === 'function') navigate(url, opts);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = el('div', 'user-detail');

  let userData = null;
  let permissionEntries = [];
  let timelineEvents = [];
  let permissionsList = [];
  let activeTab = 'profile';

  // The shell only injects its own "‹" into the heading when the page has no back control of its
  // own (data-nav-back). This one carries an explicit fallback so a deep link still lands on the
  // Users list rather than the dashboard.
  const backLink = createBackButton({
    href: '/admin/users',
    label: t('user_detail.back_to_users', 'Back to Users'),
    className: 'user-detail__back',
    navigate: nav,
  });

  const headerCard = el('div', 'user-detail__header-card');
  headerCard.hidden = true;

  const identityWrap = el('div', 'user-detail__identity');
  const avatar = el('div', 'user-detail__avatar');
  avatar.setAttribute('aria-hidden', 'true');
  const metaWrap = el('div', 'user-detail__meta');
  const nameEl = el('h2', 'user-detail__name');
  const subMeta = el('div', 'user-detail__sub');
  const badgesRow = el('div', 'user-detail__badges');
  metaWrap.append(nameEl, subMeta, badgesRow);
  identityWrap.append(avatar, metaWrap);

  const actionsWrap = el('div', 'user-detail__actions');

  const grantBtn = Button({
    label: t('user_detail.btn_grant', 'Grant Permission'),
    variant: 'primary',
    size: 'sm',
    onClick: () => {
      openGrantDrawer({
        user: userData,
        permissions: permissionsList,
        trigger: grantBtn,
        onSuccess: refreshData,
      });
    },
  });

  const restrictBtn = Button({
    label: t('user_detail.btn_restrict', 'Apply Restriction'),
    variant: 'danger',
    size: 'sm',
    onClick: () => {
      openRestrictionEditor({
        user: userData,
        trigger: restrictBtn,
        onSuccess: refreshData,
      });
    },
  });

  actionsWrap.append(grantBtn, restrictBtn);
  headerCard.append(identityWrap, actionsWrap);

  const stateWrap = el('div');
  const tabsContainer = el('div');
  container.append(backLink, headerCard, stateWrap, tabsContainer);

  /* ---------------------------------------------------------------- data */

  async function loadUser() {
    const res = await api.get(`/admin/users/${encodeURIComponent(userId)}`);
    userData = res.user;
    if (!userData) {
      const err = new Error('User payload missing');
      err.status = 404;
      throw err;
    }
  }

  // The endpoint replies `{ permissions, sources }`; an older client read `effectivePermissions`
  // and camelCase source fields, which silently rendered "no permissions" against the real API.
  async function loadPermissionsIntrospection() {
    try {
      const res = await api.get(`/admin/users/${encodeURIComponent(userId)}/permissions`);
      const payload = res.data || {};
      const keys = payload.permissions || payload.effectivePermissions || [];
      const sources = payload.sources || {};
      permissionEntries = keys.map((key) => ({ key, sources: sources[key] || [], why: '' }));
    } catch {
      // Introspection is enrichment: fall back to the flat list the detail endpoint carries.
      permissionEntries = (userData?.permissions || []).map((p) => ({
        key: p.key,
        sources: [],
        why: p.why || '',
      }));
    }
  }

  async function loadTimeline() {
    try {
      const res = await api.get(`/admin/users/${encodeURIComponent(userId)}/timeline`);
      timelineEvents = (res.timeline || res.events || []).map(normaliseTimelineEvent);
    } catch {
      timelineEvents = [];
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

  /* -------------------------------------------------------------- states */

  function showSkeleton() {
    headerCard.hidden = true;
    tabsContainer.replaceChildren();
    stateWrap.replaceChildren(
      el('div', 'user-detail__skeleton'),
      el('div', 'user-detail__skeleton'),
    );
    stateWrap.style.display = 'flex';
    stateWrap.style.flexDirection = 'column';
    stateWrap.style.gap = 'var(--space-4)';
    stateWrap.setAttribute('aria-busy', 'true');
    nameEl.textContent = t('user_detail.loading', 'Loading user…');
  }

  function showFailure(kind) {
    headerCard.hidden = true;
    tabsContainer.replaceChildren();
    stateWrap.removeAttribute('aria-busy');
    stateWrap.style.display = '';

    const box = el('div', 'user-detail__state');
    box.setAttribute('role', 'alert');
    const notFound = kind === 'notfound';
    box.append(
      el('h2', 'user-detail__state-title', notFound
        ? t('user_detail.not_found_title', 'User not found')
        : t('user_detail.load_failed_title', 'Could not load this user')),
      el('p', 'user-detail__state-text', notFound
        ? t('user_detail.not_found_text', 'No account matches this ID. It may have been deleted or the link is wrong.')
        : t('user_detail.load_failed_text', 'Something went wrong while loading the account. Please try again.')),
    );
    if (notFound) {
      box.append(Button({
        label: t('user_detail.back_to_users', 'Back to Users'),
        variant: 'secondary',
        size: 'sm',
        onClick: () => nav('/admin/users'),
      }));
    } else {
      box.append(Button({
        label: t('user_detail.retry', 'Try again'),
        variant: 'secondary',
        size: 'sm',
        onClick: () => refreshData({ initial: true }),
      }));
    }
    stateWrap.replaceChildren(box);
  }

  /* -------------------------------------------------------------- render */

  function renderHeader() {
    const initial = (userData.full_name || userData.phone || 'U').trim().charAt(0).toUpperCase();
    avatar.textContent = initial;
    nameEl.textContent = userData.full_name || userData.phone;
    subMeta.textContent = [
      userData.ref,
      userData.phone,
      userData.email || t('user_detail.no_email', 'No email'),
    ].filter(Boolean).join(' · ');

    badgesRow.replaceChildren();
    for (const r of userData.roles || []) {
      badgesRow.append(Badge({
        label: isBn ? (r.label_bn || r.label_en || r.key) : (r.label_en || r.key),
        variant: r.key === 'super_admin' ? 'danger' : 'neutral',
      }));
    }

    badgesRow.append(Badge({
      label: userData.status,
      variant: userData.status === 'ACTIVE' ? 'success' : 'warning',
    }));

    if (userData.kyc_status) {
      const verified = userData.kyc_status === 'VERIFIED';
      badgesRow.append(Badge({
        label: verified
          ? `✓ ${t('user_detail.kyc_approved', 'KYC Verified')}`
          : t('user_detail.kyc_pending', 'Verification Pending'),
        variant: verified ? 'success' : 'warning',
      }));
    }

    headerCard.hidden = false;
  }

  function renderTabs() {
    const tabItems = [
      { id: 'profile', label: t('user_detail.tab_profile', 'Profile'), render: renderProfileTab },
      { id: 'permissions', label: t('user_detail.tab_permissions', 'Roles & Permissions'), render: renderPermissionsTab },
      { id: 'restrictions', label: t('user_detail.tab_restrictions', 'Restrictions'), render: renderRestrictionsTab },
      { id: 'timeline', label: t('user_detail.tab_timeline', 'Activity Timeline'), render: renderTimelineTab },
      { id: 'orders', label: t('user_detail.tab_orders', 'Orders & GMV'), render: renderOrdersTab },
      { id: 'vault', label: t('user_detail.tab_vault', 'Vault & Balance'), render: renderVaultTab },
      { id: 'kyc', label: t('user_detail.tab_kyc', 'KYC & Verification'), render: renderKycTab },
    ];

    // WHY `tabs`/`panel` and not `items`/`activeId`: Tabs() takes `{ tabs, active }` and owns the
    // panel show/hide itself. The previous call used the wrong option names, so the tab list was
    // empty and the page showed only the Profile pane with no way to reach the other six.
    const tabsComponent = Tabs({
      tabs: tabItems.map((item) => {
        const panel = el('div', 'user-tab-pane');
        item.render(panel);
        return { id: item.id, label: item.label, panel };
      }),
      active: activeTab,
      onChange: (id) => { activeTab = id; },
    });

    tabsContainer.replaceChildren(tabsComponent);
  }

  function field(label, value) {
    const wrap = el('div', 'user-detail__field');
    wrap.append(el('span', 'user-detail__field-label', label), el('p', 'user-detail__field-value', value));
    return wrap;
  }

  function fmtDate(value) {
    const ts = value ? new Date(value).getTime() : NaN;
    return Number.isNaN(ts) ? '—' : formatDate(ts, { lang });
  }

  function renderProfileTab(pane) {
    const grid = el('div', 'user-detail__grid');
    const place = [userData.district, userData.division].filter(Boolean).join(', ');
    grid.append(
      field(t('user_detail.field_full_name', 'Full Name'), userData.full_name || '—'),
      field(t('user_detail.field_phone', 'Phone'), userData.phone || '—'),
      field(t('user_detail.field_email', 'Email'), userData.email || '—'),
      field(t('user_detail.field_location', 'District & Division'), place || '—'),
      field(t('user_detail.field_address', 'Address'), userData.address_line || '—'),
      field(t('user_detail.field_registered', 'Registered On'), fmtDate(userData.created_at)),
    );
    pane.append(grid);
  }

  function describeSource(s) {
    if (s.type === 'ROLE') {
      return t('user_detail.why_from_role', { role: s.role });
    }
    if (s.type === 'GRANT') {
      return t('user_detail.why_from_grant', {
        by: s.granted_by ?? s.grantedBy ?? '—',
        expires: fmtDate(s.expires_at ?? s.expiresAt),
      });
    }
    if (s.type === 'JIT') {
      return t('user_detail.why_from_jit', { expires: fmtDate(s.window_expires_at ?? s.windowExpiresAt) });
    }
    return s.type;
  }

  function renderPermissionsTab(pane) {
    if (permissionEntries.length === 0) {
      pane.append(el('p', 'user-detail__state-text', t('user_detail.no_permissions', 'This user holds no active permissions.')));
      return;
    }

    pane.append(el('h3', 'user-detail__section-title',
      t('user_detail.active_permissions', { count: formatNumber(permissionEntries.length, { lang }) })));

    for (const entry of permissionEntries) {
      const card = el('div', 'perm-source-card');
      const info = el('div', 'perm-source-card__info');
      const reasons = entry.sources.map(describeSource);
      if (entry.why) reasons.push(entry.why);
      info.append(
        el('span', 'perm-source-card__title', entry.key),
        el('span', 'perm-source-card__why', reasons.join(' · ') || t('user_detail.assigned_capability', 'Assigned capability')),
      );
      card.append(info, Badge({ label: t('user_detail.perm_active', 'Active'), variant: 'success' }));
      pane.append(card);
    }
  }

  function renderRestrictionsTab(pane) {
    const restrictions = userData.restrictions || [];

    if (restrictions.length === 0) {
      const empty = el('div', 'user-detail__empty');
      empty.append(
        el('strong', '', `✓ ${t('user_detail.no_restrictions', 'No active capability restrictions on this account.')}`),
        el('span', '', t('user_detail.no_restrictions_hint', 'All features and transaction capabilities are enabled without sanctions.')),
      );
      pane.append(empty);
      return;
    }

    for (const r of restrictions) {
      const card = el('div', 'perm-source-card');
      const info = el('div', 'perm-source-card__info');
      const details = [t('user_detail.restriction_reason', { reason: r.reason || '—' })];
      if (r.expires_at) details.push(t('user_detail.restriction_expires', { date: fmtDate(r.expires_at) }));

      info.append(
        el('span', 'perm-source-card__title perm-source-card__title--danger',
          `🚫 ${r.capability_key || r.key} (${r.mode || r.status || 'BLOCKED'})`),
        el('span', 'perm-source-card__why', details.join(' · ')),
      );

      const liftBtn = Button({
        label: t('user_detail.lift_restriction', 'Lift Restriction'),
        variant: 'secondary',
        size: 'sm',
        onClick: async () => {
          const conf = await confirmDialogWithReason({
            title: t('user_detail.confirm_lift_title', 'Lift capability restriction?'),
            description: t('user_detail.confirm_lift_desc', "Removing this restriction will immediately restore the user's capability."),
            reasonRequired: true,
            trigger: liftBtn,
          });

          if (!conf || !conf.confirmed || !conf.reason || conf.reason.trim().length < 10) return;

          liftBtn.setLoading?.(true);
          try {
            // WHY `body`: core/api.js reads `{ body }` — the old `{ data }` option was dropped, so
            // the mandatory audit justification never reached the server.
            await api.delete(`/admin/restrictions/${r.id}`, { body: { reason: conf.reason.trim() } });
            toast.success(t('user_detail.lift_success', 'Restriction lifted successfully'));
            refreshData();
          } catch (err) {
            liftBtn.setLoading?.(false);
            toast.error((isBn ? err.message_bn : err.message_en) || err.message || t('user_detail.lift_failed', 'Failed to lift restriction.'));
          }
        },
      });

      card.append(info, liftBtn);
      pane.append(card);
    }
  }

  function renderTimelineTab(pane) {
    pane.append(UserTimeline({ events: timelineEvents }));
  }

  function stat(label, value, tone = '') {
    const card = el('div', 'user-stat');
    card.append(
      el('span', 'user-stat__label', label),
      el('h4', `user-stat__value${tone ? ` user-stat__value--${tone}` : ''}`, value),
    );
    return card;
  }

  // WHY `??` and no invented defaults: the old `|| 89` / `|| 385000` turned a genuine zero (a new
  // account) into a fabricated 89 orders and ৳385,000 GMV.
  function renderOrdersTab(pane) {
    const orders = userData.total_orders_count ?? userData.orders_count ?? 0;
    const gmv = userData.total_gmv_bdt ?? userData.gmv_bdt ?? 0;
    const returnRate = userData.return_rate_pct;
    const grid = el('div', 'user-stat-grid');
    grid.append(
      stat(t('user_detail.stat_orders', 'Total Orders'), formatNumber(orders, { lang })),
      stat(t('user_detail.stat_gmv', 'Lifetime GMV'), formatCurrency(gmv, { lang })),
      stat(
        t('user_detail.stat_return_rate', 'Return Rate'),
        returnRate === undefined || returnRate === null ? '—' : `${formatNumber(returnRate, { lang })}%`,
      ),
    );
    pane.append(grid);
  }

  function renderVaultTab(pane) {
    const grid = el('div', 'user-stat-grid');
    grid.append(
      stat(t('user_detail.stat_balance', 'Available Balance'), formatCurrency(userData.wallet_balance_bdt ?? 0, { lang }), 'success'),
      stat(t('user_detail.stat_escrow', 'Escrow Hold'), formatCurrency(userData.escrow_held_bdt ?? 0, { lang }), 'warning'),
    );
    pane.append(grid);
  }

  function kycRow(title, hint, statusText, statusClass) {
    const row = el('div', 'user-kyc-row');
    const left = el('div');
    left.append(el('span', 'user-kyc-row__title', title), el('p', 'user-kyc-row__hint', hint));
    row.append(left, el('span', `user-kyc-row__status user-kyc-row__status--${statusClass}`, statusText));
    return row;
  }

  function renderKycTab(pane) {
    const verified = userData.kyc_status === 'VERIFIED';
    pane.append(
      kycRow(
        t('user_detail.kyc_nid', 'National ID (Smart NID)'),
        `${t('user_detail.kyc_verified_on', 'Verified on')}: ${userData.kyc_verified_at ? fmtDate(userData.kyc_verified_at) : t('user_detail.kyc_pending_short', 'Pending')}`,
        verified ? `✓ ${t('user_detail.kyc_approved', 'KYC Verified')}` : t('user_detail.kyc_pending', 'Verification Pending'),
        verified ? 'ok' : 'pending',
      ),
      kycRow(
        t('user_detail.kyc_trade_license', 'Trade License'),
        t('user_detail.kyc_trade_hint', 'Enterprise merchant verification'),
        t('user_detail.kyc_optional', 'Optional for Salers'),
        'muted',
      ),
    );
  }

  /* ---------------------------------------------------------------- flow */

  async function refreshData({ initial = false } = {}) {
    if (initial) showSkeleton();
    try {
      await loadUser();
    } catch (err) {
      showFailure(err?.status === 404 ? 'notfound' : 'error');
      return;
    }
    await Promise.all([loadPermissionsIntrospection(), loadTimeline()]);
    stateWrap.replaceChildren();
    stateWrap.removeAttribute('aria-busy');
    stateWrap.style.display = '';
    renderHeader();
    renderTabs();
  }

  refreshData({ initial: true });
  loadPermissionsCatalog();

  root.append(container);
}
