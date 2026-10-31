/**
 * VariantOptionsPage.ts — which variant options (size, colour, weight, ...) each category offers
 * (/admin/catalog/variant-options).
 *
 * Configuration, not code: writes `catalog.variant_options` in platform_settings through
 * server/src/services/variantOptions.service.ts, which the variant save enforces and the product form
 * reads. A category without its own list follows its parent; with none at all it offers every option
 * (the behaviour before this page existed).
 *
 * `catalog.category.view` opens the page; `catalog.category.manage` enables Save. Every save needs a
 * reason, is refused with 409 if someone else saved first, and writes an audit row (history below).
 */

import { Button } from '../../components/ui/Button.ts';
import { api } from '../../core/api.ts';
import { can } from '../../services/permissions.ts';
import { toast } from '../../services/toast.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { formatRelativeTime } from '../../services/format.ts';
import { escapeHtml } from '../../services/html.ts';
import { clearVariantOptionsCache, resolveFor } from '../../services/variantOptions.ts';
import { VARIANT_DIMENSIONS } from '../../config/variantDimensions.ts';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.ts';
import '../../styles/components/variant-editor.css';

const MIN_REASON_LENGTH = 10;

interface Category {
  id: number;
  parent_id: number | null;
  name_en: string;
  name_bn: string;
  is_active: boolean;
}

export default function VariantOptionsPage(root: HTMLElement) {
  loadSystemHealthStyles();
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page variant-options-page';

  let data = null;
  let loadError = null;
  let isLoading = true;
  // The working copy the checkboxes edit; saved as a whole.
  let draft: Record<string, string[]> = {};

  async function loadData() {
    isLoading = true;
    render();
    try {
      const res = await api.get('/admin/catalog/variant-options');
      data = res?.data ?? res;
      draft = structuredClone(data.rules?.categories ?? {});
      loadError = null;
    } catch (err) {
      loadError = err?.message || t('common.error_generic');
    } finally {
      isLoading = false;
      render();
    }
  }

  const relative = (iso) => formatRelativeTime(new Date(iso).getTime(), { lang: isBn ? 'bn' : 'en' });
  const optLabel = (k) => t(`product_detail.variant.attribute.${k}`);

  /** Parents first, each followed by its children, so the table reads as the category tree. */
  function ordered(categories: Category[]): Array<Category & { depth: number }> {
    const kids = new Map<string, Category[]>();
    for (const c of categories) {
      const key = String(c.parent_id ?? 'root');
      if (!kids.has(key)) kids.set(key, []);
      kids.get(key).push(c);
    }
    const out = [];
    const ids = new Set(categories.map((c) => String(c.id)));
    const walk = (key: string, depth: number, seen: Set<string>) => {
      for (const c of kids.get(key) || []) {
        if (seen.has(String(c.id))) continue;
        seen.add(String(c.id));
        out.push({ ...c, depth });
        walk(String(c.id), depth + 1, seen);
      }
    };
    const seen = new Set<string>();
    walk('root', 0, seen);
    // A child whose parent row is missing would never be reached from the root; list it at the top level.
    for (const c of categories) if (!seen.has(String(c.id)) && !ids.has(String(c.parent_id))) walk(String(c.parent_id), 0, seen);
    for (const c of categories) if (!seen.has(String(c.id))) out.push({ ...c, depth: 0 });
    return out;
  }

  function table(canUpdate: boolean) {
    const cats: Category[] = data.categories || [];
    const parentOf = new Map(cats.map((c) => [String(c.id), c.parent_id == null ? null : String(c.parent_id)]));
    const wrap = document.createElement('div');
    wrap.className = 'system-table-wrap';
    const tbl = document.createElement('table');
    tbl.className = 'system-table variant-options-table';
    tbl.innerHTML = `<thead><tr>
      <th scope="col">${escapeHtml(t('admin_catalog.variant_options.col_category'))}</th>
      <th scope="col">${escapeHtml(t('admin_catalog.variant_options.col_own'))}</th>
      ${VARIANT_DIMENSIONS.map((d) => `<th scope="col">${escapeHtml(optLabel(d))}</th>`).join('')}
    </tr></thead>`;
    const body = document.createElement('tbody');

    const paint = () => {
      body.replaceChildren();
      for (const c of ordered(cats)) {
        const id = String(c.id);
        const own = draft[id];
        const effective = resolveFor({ categories: draft }, id, parentOf);
        const tr = document.createElement('tr');
        const name = isBn ? c.name_bn || c.name_en : c.name_en;
        const th = document.createElement('th');
        th.scope = 'row';
        th.className = 'text-sm';
        th.style.paddingInlineStart = `calc(var(--space-3) + ${c.depth} * var(--space-4))`;
        th.textContent = `${c.depth ? '└ ' : ''}${name}${c.is_active ? '' : ` (${t('admin_catalog.variant_options.inactive')})`}`;
        tr.append(th);

        const ownCell = document.createElement('td');
        const ownBox = document.createElement('input');
        ownBox.type = 'checkbox';
        ownBox.checked = Boolean(own);
        ownBox.disabled = !canUpdate;
        ownBox.setAttribute('aria-label', t('admin_catalog.variant_options.own_label', { name }));
        ownBox.addEventListener('change', () => {
          // Starting a list of its own begins from what it shows now, so ticking the box changes nothing yet.
          if (ownBox.checked) draft[id] = [...effective];
          else delete draft[id];
          paint();
        });
        const follows = document.createElement('span');
        follows.className = 'text-xs text-muted';
        follows.textContent = own ? '' : ` ${t(c.parent_id == null ? 'admin_catalog.variant_options.all_by_default' : 'admin_catalog.variant_options.follows_parent')}`;
        ownCell.append(ownBox, follows);
        tr.append(ownCell);

        for (const d of VARIANT_DIMENSIONS) {
          const td = document.createElement('td');
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = effective.includes(d);
          box.disabled = !canUpdate || !own;
          box.setAttribute('aria-label', `${name}: ${optLabel(d)}`);
          box.addEventListener('change', () => {
            const next = VARIANT_DIMENSIONS.filter((x) => (x === d ? box.checked : draft[id].includes(x)));
            if (next.length === 0) {
              box.checked = true;
              toast.error(t('admin_catalog.variant_options.need_one'));
              return;
            }
            draft[id] = next;
            paint();
          });
          td.append(box);
          tr.append(td);
        }
        body.append(tr);
      }
    };
    paint();
    tbl.append(body);
    wrap.append(tbl);
    return wrap;
  }

  function settingsPanel() {
    const canUpdate = data.can_update !== false && can('catalog.category.manage');
    const panel = document.createElement('section');
    panel.className = 'admin-panel mt-4';
    panel.innerHTML = `
      <h2 class="admin-panel__title">${escapeHtml(t('admin_catalog.variant_options.card_title'))}</h2>
      <p data-page-info class="text-sm text-secondary">${escapeHtml(t('admin_catalog.variant_options.card_desc'))}</p>
      <p class="text-xs text-muted">${escapeHtml(data.updated_at ? t('admin_catalog.variant_options.changed', { when: relative(data.updated_at) }) : t('admin_catalog.variant_options.never_changed'))}</p>
    `;
    panel.append(table(canUpdate));

    const reasonId = 'variant-options-reason';
    const reasonWrap = document.createElement('div');
    reasonWrap.className = 'catalog-form-group mt-4';
    reasonWrap.innerHTML = `
      <label class="catalog-form-label" for="${reasonId}">${escapeHtml(t('admin_catalog.variant_options.reason'))}</label>
      <input id="${reasonId}" class="catalog-form-input" type="text" maxlength="500" ${canUpdate ? '' : 'disabled'} />
      <span class="catalog-form-hint">${escapeHtml(t('admin_catalog.variant_options.reason_hint', { min: MIN_REASON_LENGTH }))}</span>`;
    const reason = reasonWrap.querySelector('input');

    const save = Button({
      label: t('common.save_changes'),
      variant: 'primary',
      size: 'sm',
      disabled: !canUpdate,
      onClick: async () => {
        if (reason.value.trim().length < MIN_REASON_LENGTH) {
          toast.error(t('admin_catalog.variant_options.reason_hint', { min: MIN_REASON_LENGTH }));
          reason.focus();
          return;
        }
        save.disabled = true;
        try {
          const res = await api.put('/admin/catalog/variant-options', {
            categories: draft,
            reason: reason.value.trim(),
            base_updated_at: data.updated_at ?? null,
          });
          clearVariantOptionsCache();
          toast.success((isBn ? res?.message_bn : res?.message_en) || t('admin_catalog.variant_options.saved'));
          await loadData();
        } catch (err) {
          toast.error(err?.message || t('common.error_generic'));
          // Someone else saved first: show their version rather than leave a form that can never save.
          if (err?.status === 409 || err?.code === 'CONFLICT') await loadData();
        } finally {
          save.disabled = false;
        }
      },
    });
    const actions = document.createElement('div');
    actions.className = 'group-buy-settings__actions mt-2';
    actions.append(save);
    panel.append(reasonWrap, actions);

    if (!canUpdate) {
      const note = document.createElement('p');
      note.className = 'text-xs text-muted mt-2';
      note.textContent = t('admin_catalog.variant_options.view_only');
      panel.append(note);
    }
    return panel;
  }

  function historyPanel() {
    const panel = document.createElement('section');
    panel.className = 'admin-panel mt-4';
    const summary = (rules) => {
      const entries = Object.entries(rules?.categories || {});
      if (!entries.length) return t('admin_catalog.variant_options.all_everywhere');
      const name = (id) => {
        const c = (data.categories || []).find((x) => String(x.id) === id);
        return c ? (isBn ? c.name_bn || c.name_en : c.name_en) : `#${id}`;
      };
      return entries.map(([id, list]) => `${name(id)}: ${(list as string[]).map(optLabel).join(', ')}`).join('; ');
    };
    const rows = (data.history || []).map((row) => `
      <tr>
        <td class="text-xs">${escapeHtml(row.created_at ? relative(row.created_at) : '—')}</td>
        <td class="text-xs font-mono">${escapeHtml(row.actor_ref || row.actor_id || '—')}</td>
        <td class="text-xs">${escapeHtml(summary(row.before_json))} → <strong>${escapeHtml(summary(row.after_json))}</strong></td>
        <td class="text-xs text-secondary">${escapeHtml(row.meta_json?.reason || row.meta?.reason || '')}</td>
      </tr>`).join('');
    panel.innerHTML = `<h2 class="admin-panel__title">${escapeHtml(t('admin_catalog.variant_options.history_title'))}</h2>` + (rows
      ? `<div class="system-table-wrap"><table class="system-table">
          <thead><tr>
            <th scope="col">${escapeHtml(t('admin_catalog.variant_options.col_when'))}</th>
            <th scope="col">${escapeHtml(t('admin_catalog.variant_options.col_who'))}</th>
            <th scope="col">${escapeHtml(t('admin_catalog.variant_options.col_change'))}</th>
            <th scope="col">${escapeHtml(t('admin_catalog.variant_options.col_reason'))}</th>
          </tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="p-6 text-center text-sm text-muted">${escapeHtml(t('admin_catalog.variant_options.history_empty'))}</p>`);
    return panel;
  }

  function render() {
    root.innerHTML = '';
    container.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'admin-page-header';
    header.innerHTML = `
      <div>
        <h1 class="admin-page-title">${escapeHtml(t('admin_catalog.variant_options.title'))}</h1>
        <p class="admin-page-subtitle">${escapeHtml(t('admin_catalog.variant_options.subtitle'))}</p>
      </div>`;
    container.append(header);
    if (isLoading && !data) {
      const loading = document.createElement('div');
      loading.className = 'p-8 text-center text-muted';
      loading.textContent = t('common.loading');
      container.append(loading);
    } else if (loadError && !data) {
      const error = document.createElement('div');
      error.className = 'admin-panel p-6 text-center text-sm';
      error.textContent = loadError;
      container.append(error);
    } else if (data) {
      container.append(settingsPanel(), historyPanel());
    }
    root.appendChild(container);
  }

  loadData();
}
