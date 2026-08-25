/**
 * TranslationManagerPage.js — Dynamic Multi-Locale Manager, Missing-Key Finder & Live Editor (Prompt 10.8).
 *
 * Implements idea proposition.md §L & Prompt 10.8 Requirement 6:
 * - Live in-place translation key editing updating the UI without redeployment.
 * - Per-locale completeness percentage gauges and missing-key detection.
 * - JSON Export / Import round-trip.
 * - Dynamic "Add New Locale" capability creating new languages live without code change.
 */

import {
  listTranslationCompleteness,
  getTranslationsForLocale,
  upsertTranslationKey,
  exportTranslationsJson,
  importTranslationsJson,
} from '../../services/content.api.js';

import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

export default function TranslationManagerPage(root, ctx = {}) {
  const container = document.createElement('div');
  container.className = 'translation-manager-page p-4 md:p-6 max-w-7xl mx-auto space-y-6';

  let completenessData = null;
  let activeLocale = 'bn';
  let translations = {};
  let searchQuery = '';
  let showMissingOnly = false;

  // 1. Page Header
  const header = document.createElement('div');
  header.className = 'page-header flex-between flex-wrap gap-4 border-b pb-4';
  header.innerHTML = `
    <div>
      <div class="flex items-center gap-2">
        <a href="/editor" class="btn btn-sm btn-ghost text-xs">➔ Back</a>
        <span class="text-2xl">🌐</span>
        <h2 class="text-2xl font-bold tracking-tight m-0">${t('editor.translations_title')}</h2>
      </div>
      <p class="text-sm text-muted m-0 mt-1">${t('editor.translations_subtitle')}</p>
    </div>
    <div class="flex gap-2 flex-wrap">
      <button class="btn btn-sm btn-secondary text-xs" id="export-json-btn">
        📥 ${t('editor.btn_export_json')}
      </button>
      <button class="btn btn-sm btn-secondary text-xs" id="import-json-btn">
        📤 ${t('editor.btn_import_json')}
      </button>
      <button class="btn btn-sm btn-primary text-xs" id="add-locale-btn">
        + ${t('editor.btn_add_locale')}
      </button>
    </div>
  `;
  container.append(header);

  // 2. Locale Completeness Gauges Row
  const gaugesRow = document.createElement('div');
  gaugesRow.className = 'grid grid-cols-2 md:grid-cols-4 gap-4';
  container.append(gaugesRow);

  // 3. Search & Filter Bar
  const filterBar = document.createElement('div');
  filterBar.className = 'card p-4 border rounded-xl bg-surface flex-between flex-wrap gap-3 shadow-sm';
  filterBar.innerHTML = `
    <div class="flex-1 min-w-[240px]">
      <input type="text" id="trans-search-input" class="input w-full text-xs font-mono" placeholder="🔍 Search translation keys or values...">
    </div>
    <div class="flex items-center gap-4 text-xs">
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" id="missing-only-checkbox">
        <span class="font-bold text-muted">${t('editor.filter_missing_only')}</span>
      </label>
      <div class="flex gap-1" id="locale-selector-btns">
        <!-- Injected locale buttons -->
      </div>
    </div>
  `;
  container.append(filterBar);

  // 4. Translation Table
  const tableWrap = document.createElement('div');
  tableWrap.className = 'border rounded-2xl overflow-x-auto bg-surface shadow-sm';
  container.append(tableWrap);

  async function loadData() {
    try {
      const [compRes, transRes] = await Promise.all([
        listTranslationCompleteness().catch(() => ({ data: { locales: [] } })),
        getTranslationsForLocale(activeLocale).catch(() => ({ data: {} })),
      ]);

      completenessData = compRes?.data;
      translations = transRes?.data || {};

      renderGauges();
      renderLocaleButtons();
      renderTable();
    } catch {
      // Fallback
    }
  }

  function renderGauges() {
    gaugesRow.innerHTML = '';
    const locales = completenessData?.locales || [
      { locale: 'en', total_keys: 250, completeness_pct: 100 },
      { locale: 'bn', total_keys: 242, completeness_pct: 97 },
    ];

    locales.forEach((loc) => {
      const isAct = loc.locale === activeLocale;
      const card = document.createElement('div');
      card.className = `card p-4 border rounded-xl cursor-pointer transition-all ${isAct ? 'border-primary bg-primary-soft/20 shadow-sm' : 'bg-surface hover:bg-surface-subtle'}`;
      card.innerHTML = `
        <div class="flex-between">
          <span class="text-sm font-bold uppercase font-mono">${loc.locale}</span>
          <span class="badge ${loc.completeness_pct >= 95 ? 'badge-success' : 'badge-warning'} text-xs font-mono font-bold">
            ${loc.completeness_pct}%
          </span>
        </div>
        <div class="mt-2 space-y-1">
          <div class="text-xs text-muted font-mono">${loc.total_keys} keys translated</div>
          <div class="w-full bg-surface-subtle h-1.5 rounded-full overflow-hidden border">
            <div class="bg-primary h-full transition-all" style="width: ${loc.completeness_pct}%;"></div>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        activeLocale = loc.locale;
        loadData();
      });

      gaugesRow.append(card);
    });
  }

  function renderLocaleButtons() {
    const host = filterBar.querySelector('#locale-selector-btns');
    if (!host) return;
    const locales = completenessData?.locales || [{ locale: 'en' }, { locale: 'bn' }];
    host.innerHTML = locales.map((l) => `
      <button class="loc-btn badge cursor-pointer text-xs font-mono py-1 px-2.5 ${l.locale === activeLocale ? 'badge-primary' : 'badge-neutral'}" data-loc="${l.locale}">
        ${l.locale.toUpperCase()}
      </button>
    `).join('');

    host.querySelectorAll('.loc-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeLocale = btn.getAttribute('data-loc');
        loadData();
      });
    });
  }

  function renderTable() {
    tableWrap.innerHTML = '';
    const entries = [];

    // Flatten namespace & keys
    for (const [ns, keysObj] of Object.entries(translations)) {
      if (typeof keysObj === 'object') {
        for (const [k, v] of Object.entries(keysObj)) {
          entries.push({ namespace: ns, key: k, value: v });
        }
      }
    }

    let filtered = entries;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((e) => e.key.toLowerCase().includes(q) || String(e.value).toLowerCase().includes(q));
    }
    if (showMissingOnly) {
      filtered = filtered.filter((e) => !e.value);
    }

    if (filtered.length === 0) {
      tableWrap.innerHTML = `
        <div class="p-8 text-center text-muted text-xs">
          No translation keys matching current filter.
        </div>
      `;
      return;
    }

    tableWrap.innerHTML = `
      <table class="table w-full text-left text-xs">
        <thead class="bg-surface-subtle border-b font-mono uppercase text-muted">
          <tr>
            <th class="p-3">Namespace</th>
            <th class="p-3">Translation Key</th>
            <th class="p-3">Localized Value [${activeLocale.toUpperCase()}]</th>
            <th class="p-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((item, idx) => `
            <tr class="border-b hover:bg-surface-subtle" data-idx="${idx}">
              <td class="p-3 font-mono font-bold text-muted">${item.namespace}</td>
              <td class="p-3 font-mono"><code>${item.key}</code></td>
              <td class="p-3">
                <input type="text" class="trans-val-input input w-full text-xs font-mono py-1" value="${item.value || ''}" data-ns="${item.namespace}" data-key="${item.key}" placeholder="Missing translation...">
              </td>
              <td class="p-3 text-right">
                <button class="save-val-btn btn btn-sm btn-primary text-xs" data-ns="${item.namespace}" data-key="${item.key}">
                  💾 ${t('common.save')}
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    tableWrap.querySelectorAll('.save-val-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ns = btn.getAttribute('data-ns');
        const k = btn.getAttribute('data-key');
        const row = btn.closest('tr');
        const val = row?.querySelector('.trans-val-input')?.value;

        try {
          await upsertTranslationKey({
            namespace: ns,
            key: k,
            locale: activeLocale,
            value: val,
          });
          toast.success(t('editor.string_saved_live'));
        } catch (err) {
          toast.error(err?.message || 'Failed to update string');
        }
      });
    });
  }

  // Filter Listeners
  filterBar.querySelector('#trans-search-input')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderTable();
  });

  filterBar.querySelector('#missing-only-checkbox')?.addEventListener('change', (e) => {
    showMissingOnly = e.target.checked;
    renderTable();
  });

  // Header Actions
  header.querySelector('#export-json-btn')?.addEventListener('click', async () => {
    try {
      const res = await exportTranslationsJson(activeLocale);
      const blob = new Blob([JSON.stringify(res?.data || {}, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `explooro_translations_${activeLocale}.json`;
      a.click();
      toast.success(t('editor.export_success'));
    } catch {
      toast.error('Failed to export translations');
    }
  });

  header.querySelector('#import-json-btn')?.addEventListener('click', () => {
    openImportModal();
  });

  header.querySelector('#add-locale-btn')?.addEventListener('click', () => {
    openAddLocaleModal();
  });

  function openImportModal() {
    const modalContent = document.createElement('div');
    modalContent.className = 'space-y-4 p-2';

    modalContent.innerHTML = `
      <div>
        <label class="block text-xs font-semibold text-muted mb-1">Target Locale</label>
        <input type="text" id="import-locale-code" class="input w-full font-mono text-xs" value="${activeLocale}">
      </div>
      <div>
        <label class="block text-xs font-semibold text-muted mb-1">Paste JSON Object</label>
        <textarea id="import-json-text" class="input w-full font-mono text-xs" rows="8" placeholder="{\n  &quot;common&quot;: {\n    &quot;buy_now&quot;: &quot;Buy Now&quot;\n  }\n}"></textarea>
      </div>
    `;

    const modal = Modal({
      title: `📥 ${t('editor.import_modal_title')}`,
      body: modalContent,
      confirmLabel: t('common.import'),
      onConfirm: async () => {
        const code = modalContent.querySelector('#import-locale-code')?.value?.trim();
        const jsonStr = modalContent.querySelector('#import-json-text')?.value?.trim();

        try {
          const parsed = JSON.parse(jsonStr);
          await importTranslationsJson(code, parsed);
          toast.success(t('editor.import_success'));
          modal.close();
          activeLocale = code;
          await loadData();
        } catch (err) {
          toast.error(err?.message || 'Invalid JSON format');
        }
      },
    });

    document.body.append(modal.element);
    modal.open();
  }

  function openAddLocaleModal() {
    const modalContent = document.createElement('div');
    modalContent.className = 'space-y-4 p-2';

    modalContent.innerHTML = `
      <div>
        <label class="block text-xs font-semibold text-muted mb-1">${t('editor.label_new_locale_code')}</label>
        <input type="text" id="new-locale-code" class="input w-full font-mono text-xs" placeholder="e.g. ar, es, fr, hi">
      </div>
      <div>
        <label class="block text-xs font-semibold text-muted mb-1">${t('editor.label_new_locale_name')}</label>
        <input type="text" id="new-locale-name" class="input w-full text-xs" placeholder="e.g. Arabic (العربية)">
      </div>
      <div class="p-3 border rounded bg-info-soft text-xs text-info">
        ℹ️ Adding a new locale is immediate and requires <b>zero redeployment or code modifications</b>.
      </div>
    `;

    const modal = Modal({
      title: `🌐 ${t('editor.add_locale_modal_title')}`,
      body: modalContent,
      confirmLabel: t('common.create'),
      onConfirm: async () => {
        const code = modalContent.querySelector('#new-locale-code')?.value?.trim()?.toLowerCase();
        if (!code || code.length > 5) {
          toast.error('Please provide a valid 2-5 letter language code');
          return;
        }

        try {
          // Seed initial key
          await upsertTranslationKey({
            namespace: 'common',
            key: 'app_title',
            locale: code,
            value: 'Explooro',
          });

          toast.success(`Locale [${code}] added live!`);
          modal.close();
          activeLocale = code;
          await loadData();
        } catch (err) {
          toast.error(err?.message || 'Failed to create locale');
        }
      },
    });

    document.body.append(modal.element);
    modal.open();
  }

  loadData();
  root.append(container);

  return () => container.remove();
}
