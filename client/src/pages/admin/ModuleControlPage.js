/**
 * ModuleControlPage.js — Grouped Module Control Panel UI (Prompt 3.2).
 *
 * Renders all 68 platform modules in an accessible, grouped accordion layout with live search,
 * filters, optimistic switches, reason modals, and dependency cascade support.
 */

import { ModuleRow } from '../../components/admin/ModuleRow.js';
import { Modal } from '../../components/ui/Modal.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.js';
import { api } from '../../core/api.js';
import { appStore } from '../../state/appStore.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { setFlags } from '../../services/featureFlags.js';
import { formatCurrency } from '../../services/format.js';

const GROUP_ORDER = [
  { key: 'trust', icon: '🛡️', label_en: 'Trust & Safety', label_bn: 'নিরাপত্তা ও আস্থা' },
  { key: 'commerce', icon: '🛍️', label_en: 'Commerce', label_bn: 'বাণিজ্য' },
  { key: 'finance', icon: '💳', label_en: 'Payments & Money', label_bn: 'পেমেন্ট ও অর্থ' },
  { key: 'logistics', icon: '🚚', label_en: 'Delivery & After-sales', label_bn: 'ডেলিভারি ও বিক্রয়োত্তর' },
  { key: 'communication', icon: '💬', label_en: 'Communication', label_bn: 'যোগাযোগ' },
  { key: 'growth', icon: '📈', label_en: 'Growth & Rewards', label_bn: 'প্রবৃদ্ধি ও পুরস্কার' },
  { key: 'content', icon: '🎨', label_en: 'Content & Presentation', label_bn: 'কনটেন্ট ও উপস্থাপনা' },
  { key: 'advanced', icon: '✨', label_en: 'AI & Advanced', label_bn: 'এআই ও অ্যাডভান্সড' },
  { key: 'system', icon: '⚙️', label_en: 'System', label_bn: 'সিস্টেম' },
];

export default function ModuleControlPage(root, { navigate } = {}) {
  const container = document.createElement('div');
  container.className = 'module-control';

  const authState = appStore.get()?.auth || {};
  const isSuperAdmin = (authState.roles || []).includes('super_admin') || authState.role === 'super_admin';

  let allModules = [];
  let searchQuery = '';
  let selectedGroup = 'ALL';
  let selectedState = 'ALL'; // ALL | ON | OFF
  let filterRecentOnly = false;
  let filterTargetedOnly = false;

  const openGroups = new Set(GROUP_ORDER.map((g) => g.key)); // All open by default

  // Header
  const header = document.createElement('div');
  header.className = 'module-control__header';

  const titleRow = document.createElement('div');
  titleRow.className = 'module-control__title-row';

  const title = document.createElement('h1');
  title.className = 'module-control__title';
  title.textContent = t('modules.title');

  const statsBadge = document.createElement('div');
  statsBadge.className = 'module-control__stats';
  statsBadge.textContent = '...';

  titleRow.append(title, statsBadge);

  const subtitle = document.createElement('p');
  subtitle.className = 'module-control__subtitle';
  subtitle.textContent = t('modules.subtitle');

  header.append(titleRow, subtitle);

  // Read-only banner if not super_admin
  if (!isSuperAdmin) {
    const banner = document.createElement('div');
    banner.className = 'module-control__banner';
    banner.innerHTML = `⚠️ <span>${t('modules.read_only_banner')}</span>`;
    header.append(banner);
  }

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'module-control__toolbar';

  // Search Input
  const searchWrap = document.createElement('div');
  searchWrap.className = 'module-control__search';
  const searchIcon = document.createElement('span');
  searchIcon.className = 'module-control__search-icon';
  searchIcon.textContent = '🔍';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = t('modules.search_placeholder');
  searchInput.setAttribute('aria-label', t('modules.search_placeholder'));
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderList();
  });
  searchWrap.append(searchIcon, searchInput);

  // Group Filter
  const isBn = getLanguage() === 'bn';
  const groupSelect = document.createElement('select');
  groupSelect.className = 'module-control__filter-select';
  groupSelect.setAttribute('aria-label', t('modules.filter_all_groups'));
  groupSelect.innerHTML = `<option value="ALL">${t('modules.filter_all_groups')}</option>` +
    GROUP_ORDER.map((g) => `<option value="${g.key}">${g.icon} ${isBn ? g.label_bn : g.label_en}</option>`).join('');
  groupSelect.addEventListener('change', (e) => {
    selectedGroup = e.target.value;
    renderList();
  });

  // State Filter
  const stateSelect = document.createElement('select');
  stateSelect.className = 'module-control__filter-select';
  stateSelect.innerHTML = `
    <option value="ALL">${t('modules.filter_state_all')}</option>
    <option value="ON">${t('modules.filter_state_on')}</option>
    <option value="OFF">${t('modules.filter_state_off')}</option>
  `;
  stateSelect.addEventListener('change', (e) => {
    selectedState = e.target.value;
    renderList();
  });

  // Filter Chips
  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'module-control__filter-chips';

  const recentChip = document.createElement('button');
  recentChip.type = 'button';
  recentChip.className = 'filter-chip';
  recentChip.textContent = `🕒 ${t('modules.filter_recently_changed')}`;
  recentChip.addEventListener('click', () => {
    filterRecentOnly = !filterRecentOnly;
    recentChip.classList.toggle('filter-chip--active', filterRecentOnly);
    renderList();
  });

  const targetedChip = document.createElement('button');
  targetedChip.type = 'button';
  targetedChip.className = 'filter-chip';
  targetedChip.textContent = `🎯 ${t('modules.filter_has_targeting')}`;
  targetedChip.addEventListener('click', () => {
    filterTargetedOnly = !filterTargetedOnly;
    targetedChip.classList.toggle('filter-chip--active', filterTargetedOnly);
    renderList();
  });

  chipsWrap.append(recentChip, targetedChip);
  toolbar.append(searchWrap, groupSelect, stateSelect, chipsWrap);

  // Group Accordion List
  const groupList = document.createElement('div');
  groupList.className = 'module-group-list';

  // docs/ai-strategy.md §6 — spend cap must be visible (and editable) to the Admin. Lives here
  // because "AI & Advanced" modules already live in this page's mental model.
  const subnav = PlatformSubnav({ activeKey: 'modules', navigate });
  if (isSuperAdmin) {
    container.append(header, subnav, buildAiUsageCard(), toolbar, groupList);
  } else {
    container.append(header, subnav, toolbar, groupList);
  }

  async function loadModules() {
    try {
      const res = await api.get('/admin/modules');
      allModules = res.modules || [];
      updateStats();
      renderList();
    } catch {
      // Fallback in case of mock mode
      const fallback = appStore.get()?.modules || {};
      allModules = Object.entries(fallback).map(([k, v]) => ({
        key: k,
        group_key: 'commerce',
        label_en: k,
        label_bn: k,
        is_enabled: Boolean(v),
      }));
      updateStats();
      renderList();
    }
  }

  function updateStats() {
    const total = allModules.length;
    const enabledCount = allModules.filter((m) => m.is_enabled).length;
    statsBadge.textContent = t('modules.stats_counter', { enabled: enabledCount, total });
  }

  function showDependencyConflictModal(parentModule, errorObj, reason) {
    const dependents = errorObj.dependents || [];
    const isLangBn = getLanguage() === 'bn';
    const parentName = isLangBn ? (parentModule.label_bn || parentModule.label_en) : (parentModule.label_en || parentModule.label_bn);

    const body = document.createElement('div');
    const desc = document.createElement('p');
    desc.className = 'text-sm text-secondary';
    desc.textContent = t('modules.dependency_modal_desc', { name: parentName });

    const list = document.createElement('div');
    list.className = 'dep-modal__list';

    for (const dep of dependents) {
      const item = document.createElement('div');
      item.className = 'dep-modal__item';
      const label = document.createElement('span');
      label.textContent = isLangBn ? dep.label_bn : dep.label_en;
      const key = document.createElement('code');
      key.textContent = dep.key;
      item.append(label, key);
      list.append(item);
    }

    body.append(desc, list);

    const cascadeBtn = Button({
      label: t('modules.cascade_btn'),
      variant: 'danger',
      onClick: async () => {
        cascadeBtn.setLoading(true);
        try {
          await handleToggle(parentModule, false, reason, true);
          modal.closeModal(true);
        } catch (err) {
          toast.error(err.message || t('common.error_generic'));
        } finally {
          cascadeBtn.setLoading(false);
        }
      },
    });

    const cancelBtn = Button({
      label: isLangBn ? 'বাতিল' : 'Cancel',
      variant: 'ghost',
      onClick: () => modal.closeModal(false),
    });

    const footer = document.createDocumentFragment();
    footer.append(cancelBtn, cascadeBtn);

    const modal = Modal({
      title: t('modules.dependency_modal_title'),
      content: body,
      footer,
    });

    document.body.append(modal);
    modal.openModal();
  }

  async function handleToggle(module, enabled, reason, cascade = false, switchControl = null) {
    try {
      const res = await api.patch(`/admin/modules/${module.key}`, {
        enabled,
        reason,
        cascade,
      });

      const updatedModule = res.data?.module;
      const cascaded = res.data?.cascaded || [];

      // Update in-memory state
      const targetIdx = allModules.findIndex((m) => m.key === module.key);
      if (targetIdx >= 0 && updatedModule) {
        allModules[targetIdx] = { ...allModules[targetIdx], ...updatedModule };
      }

      for (const c of cascaded) {
        const cIdx = allModules.findIndex((m) => m.key === c.key);
        if (cIdx >= 0) allModules[cIdx] = { ...allModules[cIdx], ...c };
      }

      // Sync feature flags map
      const flagsUpdate = { [module.key]: enabled };
      for (const c of cascaded) {
        flagsUpdate[c.key] = false;
      }
      setFlags(flagsUpdate);

      const isLangBn = getLanguage() === 'bn';
      const mName = isLangBn ? (module.label_bn || module.label_en) : (module.label_en || module.label_bn);
      toast.success(t(enabled ? 'modules.toggle_on_success' : 'modules.toggle_off_success', { name: mName }));

      updateStats();
      renderList();
    } catch (err) {
      if (err.statusCode === 409 || err.code === 'MODULE_DEPENDENCY_CONFLICT') {
        showDependencyConflictModal(module, err, reason);
        if (switchControl) switchControl.revert();
      } else {
        toast.error(err.message || t('common.error_generic'));
        if (switchControl) switchControl.revert();
        throw err;
      }
    }
  }

  function renderList() {
    groupList.innerHTML = '';
    const isLangBn = getLanguage() === 'bn';

    const filtered = allModules.filter((m) => {
      if (selectedGroup !== 'ALL' && m.group_key !== selectedGroup) return false;
      if (selectedState === 'ON' && !m.is_enabled) return false;
      if (selectedState === 'OFF' && m.is_enabled) return false;
      if (filterRecentOnly && !m.last_reason && !m.updated_at) return false;
      if (filterTargetedOnly && (!m.targeting_rules || m.targeting_rules.length === 0)) return false;
      if (searchQuery) {
        const searchStr = `${m.key} ${m.label_en || ''} ${m.label_bn || ''} ${m.description_en || ''} ${m.description_bn || ''}`.toLowerCase();
        if (!searchStr.includes(searchQuery)) return false;
      }
      return true;
    });

    const modulesByGroup = new Map();
    for (const g of GROUP_ORDER) {
      modulesByGroup.set(g.key, []);
    }
    for (const m of filtered) {
      const gKey = m.group_key || 'commerce';
      if (!modulesByGroup.has(gKey)) modulesByGroup.set(gKey, []);
      modulesByGroup.get(gKey).push(m);
    }

    for (const groupDef of GROUP_ORDER) {
      const groupMods = modulesByGroup.get(groupDef.key) || [];
      if (groupMods.length === 0 && (searchQuery || selectedGroup !== 'ALL' || selectedState !== 'ALL')) {
        continue; // Hide empty groups when filtering
      }

      const isOpen = openGroups.has(groupDef.key);

      const groupCard = document.createElement('div');
      groupCard.className = `module-group ${isOpen ? 'module-group--open' : ''}`;

      // Group Header Button
      const groupHeader = document.createElement('button');
      groupHeader.type = 'button';
      groupHeader.className = 'module-group__header';
      groupHeader.setAttribute('aria-expanded', String(isOpen));

      const titleWrap = document.createElement('div');
      titleWrap.className = 'module-group__title-wrap';

      const iconSpan = document.createElement('span');
      iconSpan.textContent = groupDef.icon;

      const titleH3 = document.createElement('h3');
      titleH3.className = 'module-group__title';
      titleH3.textContent = isLangBn ? groupDef.label_bn : groupDef.label_en;

      const enabledCount = groupMods.filter((m) => m.is_enabled).length;
      const counterSpan = document.createElement('span');
      counterSpan.className = 'module-group__counter';
      counterSpan.textContent = t('modules.group_counter', { enabled: enabledCount, total: groupMods.length });

      titleWrap.append(iconSpan, titleH3, counterSpan);

      const chevron = document.createElement('span');
      chevron.className = 'module-group__chevron';
      chevron.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>';

      groupHeader.append(titleWrap, chevron);

      groupHeader.addEventListener('click', () => {
        if (openGroups.has(groupDef.key)) {
          openGroups.delete(groupDef.key);
          groupCard.classList.remove('module-group--open');
          groupHeader.setAttribute('aria-expanded', 'false');
          body.hidden = true;
        } else {
          openGroups.add(groupDef.key);
          groupCard.classList.add('module-group--open');
          groupHeader.setAttribute('aria-expanded', 'true');
          body.hidden = false;
        }
      });

      // Group Body
      const body = document.createElement('div');
      body.className = 'module-group__body';
      body.hidden = !isOpen;

      for (const m of groupMods) {
        const rowEl = ModuleRow({
          module: m,
          isSuperAdmin,
          onToggle: handleToggle,
          onRefresh: loadModules,
        });
        body.append(rowEl);
      }

      groupCard.append(groupHeader, body);
      groupList.append(groupCard);
    }
  }

  loadModules();

  root.append(container);
}

/** docs/ai-strategy.md §6 — current-month AI spend vs. the admin-editable monthly cap. */
function buildAiUsageCard() {
  const card = document.createElement('div');
  card.className = 'assistant-panel__usage-card';
  card.textContent = '…';

  async function load() {
    try {
      const res = await api.get('/ai/usage');
      const summary = res.data || res;
      render(summary);
    } catch {
      card.remove(); // ai.config.manage denied, or the AI layer isn't reachable — just hide it
    }
  }

  function render(summary) {
    card.innerHTML = '';
    const pct = summary.cap_usd > 0 ? Math.min(100, (summary.spent_usd / summary.cap_usd) * 100) : 0;

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '13px';
    title.textContent = `✨ ${t('ai.usage_title')}`;
    card.append(title);

    const stat = (labelKey, value) => {
      const el = document.createElement('div');
      el.className = 'assistant-panel__usage-stat';
      const label = document.createElement('span');
      label.className = 'assistant-panel__usage-stat-label';
      label.textContent = t(labelKey);
      const val = document.createElement('span');
      val.className = 'assistant-panel__usage-stat-value';
      val.textContent = value;
      el.append(label, val);
      return el;
    };

    card.append(
      stat('ai.usage_spent_label', formatCurrency(summary.spent_usd, { symbol: '$' })),
      stat('ai.usage_cap_label', formatCurrency(summary.cap_usd, { symbol: '$' })),
      stat('ai.usage_remaining_label', formatCurrency(summary.remaining_usd, { symbol: '$' })),
      stat('ai.usage_driver_label', summary.driver)
    );

    const track = document.createElement('div');
    track.className = 'assistant-panel__usage-bar-track';
    const fill = document.createElement('div');
    fill.className = 'assistant-panel__usage-bar-fill';
    fill.style.width = `${pct}%`;
    track.append(fill);
    card.append(track);

    const form = document.createElement('form');
    form.className = 'assistant-panel__usage-cap-form';
    const capInput = document.createElement('input');
    capInput.type = 'number';
    capInput.min = '0';
    capInput.step = '1';
    capInput.className = 'assistant-panel__usage-cap-input';
    capInput.value = summary.cap_usd;
    const saveBtn = Button({ label: t('ai.usage_save_cap'), variant: 'secondary', size: 'sm', type: 'submit' });
    form.append(capInput, saveBtn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api.patch('/ai/usage/cap', { cap_usd: parseFloat(capInput.value) });
        render(res.data || res);
        toast.success(t('common.save_changes'));
      } catch (err) {
        toast.error(err.message);
      }
    });
    card.append(form);
  }

  load();
  return card;
}
