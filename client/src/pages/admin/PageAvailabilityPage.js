/**
 * PageAvailabilityPage.js — /admin/platform/pages, the super admin's per-page switchboard.
 *
 * Sits beside /admin/platform/modules, not above it. A module answers "does this capability work";
 * this answers "may the user see this page". Both are needed: switching `multi_warehouse` off to
 * hide /supplier/warehouses also kills nearest-depot routing, and 101 of the route table's 224
 * entries are `module: 'core'` and cannot be hidden by a module at all.
 *
 * The page list is NOT hand-maintained here — config/pageRegistry.js receives the router's own
 * route array from main.js, so a route added later appears here with no extra step.
 */

import { PageAvailabilityRow } from '../../components/admin/PageAvailabilityRow.js';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.js';
import { Modal } from '../../components/ui/Modal.js';
import { Button } from '../../components/ui/Button.js';
import { api } from '../../core/api.js';
import { appStore } from '../../state/appStore.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { setPageToggles, getPageToggles, PAGE_STATES } from '../../services/pageAccess.js';
import { listPages, PAGE_PORTALS, pageLabel } from '../../config/pageRegistry.js';

// WHY dynamic: Vite splits this into the route's CSS chunk, keeping it out of the entry bundle,
// whose gzipped budget (70KB, client/vite.config.js) is close to its ceiling. The node:test suite
// also imports page modules directly, where a static `.css` import throws
// ERR_UNKNOWN_FILE_EXTENSION. A failed load leaves the markup usable, just unstyled.
let stylesPromise = null;
function loadStyles() {
  if (!stylesPromise) {
    stylesPromise = import('../../styles/components/page-availability.css').catch(() => {
      stylesPromise = null;
    });
  }
  return stylesPromise;
}

/** Roles a LIMITED page can be released to — the platform's role keys, not an invented list. */
const AUDIENCE_ROLES = ['super_admin', 'admin', 'moderator', 'editor', 'supplier', 'saler', 'customer'];

export default function PageAvailabilityPage(root, { navigate } = {}) {
  loadStyles();

  const auth = appStore.get()?.auth || {};
  const permissions = auth.permissions || [];
  const canToggle = permissions.includes('platform.page.toggle');

  /** `{ [route_path]: { state, allowed_roles, allowed_user_ids, reason, updated_at } }` */
  let toggles = { ...getPageToggles() };
  let searchQuery = '';
  let selectedPortal = 'ALL';
  let selectedState = 'ALL';

  const container = document.createElement('div');
  container.className = 'page-avail';

  // ── Header ────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'page-avail__header';

  const titleRow = document.createElement('div');
  titleRow.className = 'page-avail__title-row';

  const title = document.createElement('h1');
  title.className = 'page-avail__title';
  title.textContent = t('page_availability.title', 'Page Availability');

  const stats = document.createElement('div');
  stats.className = 'page-avail__stats';

  titleRow.append(title, stats);

  const subtitle = document.createElement('p');
  subtitle.className = 'page-avail__subtitle';
  subtitle.textContent = t(
    'page_availability.subtitle',
    'Hide any page from users, mark it coming soon, or release it to selected roles and users only — without switching off the feature behind it.'
  );

  header.append(titleRow, subtitle);

  if (!canToggle) {
    const banner = document.createElement('div');
    banner.className = 'page-avail__banner';
    banner.textContent = t(
      'page_availability.read_only_banner',
      'Read-only. Super Admin privileges are required to change page availability.'
    );
    header.append(banner);
  } else {
    // Said on the page because it is the one surprising thing about the feature: a super admin
    // never sees their own pages disappear, so "I parked it and it is still there" is expected.
    const note = document.createElement('div');
    note.className = 'page-avail__note';
    note.textContent = t(
      'page_availability.super_admin_note',
      'Note: parked pages stay visible to Super Admins so you can still open and test them. Use the role switcher to see what users see.'
    );
    header.append(note);
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'page-avail__toolbar';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'page-avail__search';
  searchInput.placeholder = t('page_availability.search_placeholder', 'Search by page name or path…');
  searchInput.setAttribute('aria-label', searchInput.placeholder);
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderList();
  });

  const isBn = getLanguage() === 'bn';

  const portalSelect = document.createElement('select');
  portalSelect.className = 'page-avail__filter';
  portalSelect.setAttribute('aria-label', t('page_availability.filter_portal', 'All portals'));
  portalSelect.innerHTML =
    `<option value="ALL">${t('page_availability.filter_portal', 'All portals')}</option>` +
    PAGE_PORTALS.map((p) => `<option value="${p.key}">${isBn ? p.label_bn : p.label_en}</option>`).join('');
  portalSelect.addEventListener('change', (e) => {
    selectedPortal = e.target.value;
    renderList();
  });

  const stateSelect = document.createElement('select');
  stateSelect.className = 'page-avail__filter';
  stateSelect.setAttribute('aria-label', t('page_availability.filter_state', 'All states'));
  stateSelect.innerHTML =
    `<option value="ALL">${t('page_availability.filter_state', 'All states')}</option>` +
    PAGE_STATES.map(
      (s) => `<option value="${s}">${t(`page_availability.state_${s.toLowerCase()}`, s)}</option>`
    ).join('');
  stateSelect.addEventListener('change', (e) => {
    selectedState = e.target.value;
    renderList();
  });

  toolbar.append(searchInput, portalSelect, stateSelect);

  const list = document.createElement('div');
  list.className = 'page-avail__list';

  container.append(header, PlatformSubnav({ activeKey: 'pages', navigate }), toolbar, list);
  root.append(container);

  // ── Data ──────────────────────────────────────────────────────────────────
  async function load() {
    try {
      const res = await api.get('/admin/pages');
      const rows = res.pages ?? res.data ?? [];
      toggles = {};
      for (const row of rows) {
        if (!row?.route_path) continue;
        toggles[row.route_path] = {
          state: PAGE_STATES.includes(row.state) ? row.state : 'LIVE',
          allowed_roles: row.allowed_roles ?? [],
          allowed_user_ids: (row.allowed_user_ids ?? []).map(String),
          reason: row.reason ?? null,
          updated_at: row.updated_at ?? null,
        };
      }
    } catch {
      // The admin read failed; the viewer-facing map we already hold is still the truth for the
      // states themselves, so render from that rather than showing an error with no list.
      toggles = { ...getPageToggles() };
    }
    renderList();
  }

  function visiblePages() {
    return listPages().filter((page) => {
      if (selectedPortal !== 'ALL' && page.portal !== selectedPortal) return false;
      const state = toggles[page.path]?.state ?? 'LIVE';
      if (selectedState !== 'ALL' && state !== selectedState) return false;
      if (searchQuery) {
        const haystack = `${page.path} ${pageLabel(page)} ${page.module} ${page.permission ?? ''}`.toLowerCase();
        if (!haystack.includes(searchQuery)) return false;
      }
      return true;
    });
  }

  function renderStats() {
    const all = listPages();
    const parked = all.filter((p) => (toggles[p.path]?.state ?? 'LIVE') !== 'LIVE').length;
    stats.textContent = t('page_availability.stats', '{{parked}} of {{total}} pages parked', {
      parked,
      total: all.length,
    });
  }

  function renderList() {
    list.replaceChildren();
    renderStats();

    const pages = visiblePages();
    if (pages.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'page-avail__empty';
      empty.textContent = t('page_availability.empty', 'No page matches these filters.');
      list.append(empty);
      return;
    }

    // Grouped by portal in PAGE_PORTALS order, so the admin reads the screen the way the product
    // is organised rather than as 224 alphabetical paths.
    for (const portal of PAGE_PORTALS) {
      const group = pages.filter((p) => p.portal === portal.key);
      if (group.length === 0) continue;

      const section = document.createElement('section');
      section.className = 'page-avail__group';

      const heading = document.createElement('h2');
      heading.className = 'page-avail__group-title';
      heading.textContent = `${isBn ? portal.label_bn : portal.label_en} (${group.length})`;
      section.append(heading);

      for (const page of group) {
        section.append(
          PageAvailabilityRow({
            page,
            toggle: toggles[page.path],
            canToggle,
            onPick: openReasonModal,
          })
        );
      }

      list.append(section);
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  /**
   * Every change asks for a reason before it is sent — CLAUDE.md requires the audit row, and the
   * server refuses anything under 10 characters, so asking here is the difference between one
   * dialog and a rejected request the admin has to decipher.
   */
  function openReasonModal(page, nextState) {
    const body = document.createElement('div');
    body.className = 'page-avail-modal';

    const desc = document.createElement('p');
    desc.className = 'page-avail-modal__desc';
    desc.textContent = t('page_availability.modal_desc', 'Set "{{label}}" to {{state}}.', {
      label: pageLabel(page),
      state: t(`page_availability.state_${nextState.toLowerCase()}`, nextState),
    });

    const effect = document.createElement('p');
    effect.className = 'page-avail-modal__effect';
    effect.textContent = t(
      `page_availability.effect_${nextState.toLowerCase()}`,
      nextState === 'HIDDEN'
        ? 'The nav item disappears and the URL returns the 404 page.'
        : nextState === 'COMING_SOON'
          ? 'The nav item stays with a "Coming soon" badge and the page shows a placeholder.'
          : nextState === 'LIMITED'
            ? 'Live only for the roles and users you list below. Hidden for everyone else.'
            : 'Visible and working for everyone who has the permission and module for it.'
    );

    body.append(desc, effect);

    // LIMITED needs an audience; the server refuses an empty one, so the form collects it.
    let rolesWrap = null;
    let userIdsInput = null;
    if (nextState === 'LIMITED') {
      rolesWrap = document.createElement('fieldset');
      rolesWrap.className = 'page-avail-modal__roles';
      const legend = document.createElement('legend');
      legend.textContent = t('page_availability.audience_roles', 'Roles');
      rolesWrap.append(legend);
      const existing = new Set(toggles[page.path]?.allowed_roles ?? []);
      for (const role of AUDIENCE_ROLES) {
        const label = document.createElement('label');
        label.className = 'page-avail-modal__role';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = role;
        box.checked = existing.has(role);
        label.append(box, document.createTextNode(` ${role}`));
        rolesWrap.append(label);
      }

      const userField = document.createElement('label');
      userField.className = 'page-avail-modal__users';
      userField.textContent = t('page_availability.audience_users_label', 'User IDs (comma separated)');
      userIdsInput = document.createElement('input');
      userIdsInput.type = 'text';
      userIdsInput.className = 'input';
      userIdsInput.value = (toggles[page.path]?.allowed_user_ids ?? []).join(', ');
      userIdsInput.placeholder = '1024, 2048';
      userField.append(userIdsInput);

      body.append(rolesWrap, userField);
    }

    const reasonField = document.createElement('label');
    reasonField.className = 'page-avail-modal__reason';
    reasonField.textContent = t('page_availability.reason_label', 'Reason (at least 10 characters)');
    const reasonInput = document.createElement('textarea');
    reasonInput.className = 'textarea';
    reasonInput.rows = 3;
    reasonInput.required = true;
    reasonField.append(reasonInput);
    body.append(reasonField);

    const confirmBtn = Button({
      label: t('page_availability.apply', 'Apply'),
      variant: nextState === 'HIDDEN' ? 'danger' : 'primary',
      onClick: async () => {
        const reason = reasonInput.value.trim();
        if (reason.length < 10) {
          toast.error(t('page_availability.reason_too_short', 'Give a reason of at least 10 characters.'));
          reasonInput.focus();
          return;
        }

        const allowedRoles = rolesWrap
          ? [...rolesWrap.querySelectorAll('input[type="checkbox"]:checked')].map((b) => b.value)
          : [];
        const allowedUserIds = userIdsInput
          ? userIdsInput.value.split(',').map((s) => s.trim()).filter(Boolean)
          : [];

        if (nextState === 'LIMITED' && allowedRoles.length === 0 && allowedUserIds.length === 0) {
          toast.error(
            t('page_availability.limited_needs_audience', 'Pick at least one role or user, or use Hidden instead.')
          );
          return;
        }

        confirmBtn.setLoading(true);
        try {
          await api.put('/admin/pages', {
            route_path: page.path,
            state: nextState,
            allowed_roles: allowedRoles,
            allowed_user_ids: allowedUserIds,
            reason,
          });

          toggles[page.path] = {
            state: nextState,
            allowed_roles: nextState === 'LIMITED' ? allowedRoles : [],
            allowed_user_ids: nextState === 'LIMITED' ? allowedUserIds : [],
            reason,
            updated_at: new Date().toISOString(),
          };

          // Push the change into the live resolver so the sidebar, the command palette and the
          // router agree with this screen immediately instead of on the next cold boot.
          setPageToggles(
            Object.fromEntries(
              Object.entries(toggles).filter(([, row]) => row.state !== 'LIVE')
            )
          );
          // appStore is what AppShell re-renders off — nudge it so the nav rebuilds now.
          appStore.update((s) => ({ ...s }));

          toast.success(t('page_availability.saved', '"{{label}}" updated.', { label: pageLabel(page) }));
          modal.closeModal(true);
          renderList();
        } catch (err) {
          toast.error(err.message_en || err.message || t('common.error_generic'));
        } finally {
          confirmBtn.setLoading(false);
        }
      },
    });

    const cancelBtn = Button({
      label: t('common.cancel', 'Cancel'),
      variant: 'ghost',
      onClick: () => modal.closeModal(false),
    });

    const footer = document.createDocumentFragment();
    footer.append(cancelBtn, confirmBtn);

    const modal = Modal({
      title: t('page_availability.modal_title', 'Change page availability'),
      content: body,
      footer,
      important: nextState === 'HIDDEN',
    });

    document.body.append(modal);
    modal.openModal();
    reasonInput.focus();
  }

  load();
}
