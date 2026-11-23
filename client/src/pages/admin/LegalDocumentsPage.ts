/**
 * LegalDocumentsPage.ts — /admin/platform/legal: the terms, privacy policy, refund policy and
 * Explooro partner agreement (migration 104, services/legal.service.ts).
 *
 *   * Company details: every value the documents show through a {{company.*}} token (name,
 *     licence, DBID, contacts, time limits, …), in the blocks the API's `company_fields` names.
 *     Required ones are warned about and outlined while empty, because the text reads "—" there.
 *     Saving them changes every document at once and asks nobody to agree again.
 *   * "Show where details go": the current text with each token marked filled / default / empty,
 *     and the points a lawyer should confirm (migration 113 left them out of the text).
 *   * Each document: its versions, how many people agreed to each, and "Publish a new version".
 *     A published version is never edited. The new version starts from the current text; ticking
 *     "everyone must agree again" asks every account it applies to on their next visit.
 *
 * `platform.legal.view` (LOW) opens the page; `platform.legal.publish` (CRITICAL, super admin only)
 * enables every write. Each write needs a reason and writes an audit row, listed at the bottom.
 * WHY the limits come from the API: the server refuses anything outside them.
 */

import { Button } from '../../components/ui/Button.ts';
import { Input } from '../../components/ui/Input.ts';
import { Textarea } from '../../components/ui/Textarea.ts';
import { Checkbox } from '../../components/ui/Checkbox.ts';
import { confirmDialog } from '../../components/ui/ConfirmDialog.ts';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.ts';
import { getLegalAdmin, publishLegalVersion, saveLegalCompany } from '../../services/legal.api.ts';
import { can } from '../../services/permissions.ts';
import { toast } from '../../services/toast.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { formatDate, formatRelativeTime, formatNumber } from '../../services/format.ts';
import { escapeHtml } from '../../services/html.ts';
import { renderLegalText, markLegalTokens } from '../../services/legalText.ts';
import { LEGAL_REVIEW_POINTS } from '../../config/legal.ts';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.ts';
import type { PageContext } from '../types.ts';
import '../../styles/components/legal.css';

/** The blocks of the details form, in order. Which field sits in which comes from the API. */
const FIELD_GROUPS = ['identity', 'contact', 'operations', 'time'];


export default function LegalDocumentsPage(root: HTMLElement, { navigate }: PageContext = {}) {
  loadSystemHealthStyles();
  const container = document.createElement('div');
  container.className = 'admin-page legal-admin-page';

  let data = null;
  let loadError = null;
  let isLoading = true;
  /** The document whose new-version form is open, if any. */
  let editing: string | null = null;
  /** The documents whose marked preview is open, and in which language. */
  const previewing = new Map<string, 'en' | 'bn'>();

  const lang = () => (getLanguage() === 'bn' ? 'bn' : 'en');
  const canPublish = () => data?.can_publish !== false && can('platform.legal.publish');
  const docName = (key) => t(`admin.legal.doc.${key}`);

  async function loadData() {
    isLoading = true;
    render();
    try {
      data = await getLegalAdmin();
      loadError = null;
    } catch (err) {
      loadError = err?.message || t('common.error_generic');
    } finally {
      isLoading = false;
      render();
    }
  }

  function panel(titleKey: string, descKey?: string) {
    const section = document.createElement('section');
    section.className = 'admin-panel mt-4';
    section.innerHTML = `<h2 class="admin-panel__title">${escapeHtml(t(titleKey))}</h2>`
      + (descKey ? `<p data-page-info class="text-sm text-secondary">${escapeHtml(t(descKey))}</p>` : '');
    return section;
  }

  function reasonInput(name: string) {
    const min = data.limits.reason.min;
    const field = Input({
      label: t('admin.legal.reason'),
      hint: t('admin.legal.reason_hint', { min }),
      type: 'text',
      name,
      maxLength: data.limits.reason.max,
      required: true,
    });
    field.input.disabled = !canPublish();
    return field;
  }

  function reasonOk(field) {
    if (field.value.trim().length >= data.limits.reason.min) return true;
    toast.error(t('admin.legal.reason_hint', { min: data.limits.reason.min }));
    field.input.focus();
    return false;
  }

  function missingCard() {
    const missing = data.missing_company_fields || [];
    if (!missing.length) return null;
    const box = document.createElement('section');
    box.className = 'admin-panel mt-4 legal-admin__warning';
    box.setAttribute('role', 'status');
    box.innerHTML = `
      <h2 class="admin-panel__title">${escapeHtml(t('admin.legal.missing_title'))}</h2>
      <p class="text-sm">${escapeHtml(t('admin.legal.missing_desc', {
        fields: missing.map((f) => t(`admin.legal.company.${f}`)).join(', '),
      }))}</p>`;
    return box;
  }

  function companyCard() {
    const section = panel('admin.legal.company_title', 'admin.legal.company_desc');
    const specs = data.company_fields || {};
    const order = Object.keys(specs);
    const fields = {};
    for (const group of FIELD_GROUPS) {
      const inGroup = order.filter((f) => specs[f].group === group);
      if (!inGroup.length) continue;
      const heading = document.createElement('h3');
      heading.className = 'legal-admin__group-title';
      heading.textContent = t(`admin.legal.group.${group}`);
      const grid = document.createElement('div');
      grid.className = 'group-buy-settings__grid';
      for (const f of inGroup) {
        const spec = specs[f];
        const isNumber = spec.kind === 'days' || spec.kind === 'years';
        const input = Input({
          label: t(`admin.legal.company.${f}`) + (spec.required ? ' *' : ''),
          hint: t(`admin.legal.company.${f}_hint`),
          type: spec.kind === 'email' ? 'email' : spec.kind === 'tel' ? 'tel' : 'text',
          inputmode: isNumber ? 'numeric' : undefined,
          suffix: isNumber ? t(`admin.legal.unit.${spec.kind}`) : undefined,
          name: `company_${f}`,
          value: data.company?.[f] ?? '',
          maxLength: spec.max ?? 200,
        });
        input.input.disabled = !canPublish();
        // WHY marked here as well as in the warning: the warning names the field, this shows it.
        if (spec.required && !data.company?.[f]) input.classList.add('legal-admin__field--missing');
        fields[f] = input;
        grid.append(input);
      }
      section.append(heading, grid);
    }
    const grid = document.createElement('div');
    grid.className = 'group-buy-settings__grid mt-3';
    const reason = reasonInput('company_reason');
    grid.append(reason);

    const save = Button({
      label: t('admin.legal.company_save'),
      variant: 'primary',
      size: 'sm',
      disabled: !canPublish(),
      onClick: async () => {
        if (!reasonOk(reason)) return;
        save.disabled = true;
        try {
          const body = Object.fromEntries(order.map((f) => [f, fields[f].value.trim()]));
          const res = await saveLegalCompany({ ...body, reason: reason.value.trim() });
          toast.success((lang() === 'bn' ? res?.message_bn : res?.message_en) || t('admin.legal.saved'));
          await loadData();
        } catch (err) {
          toast.error(err?.message || t('common.error_generic'));
        } finally {
          save.disabled = false;
        }
      },
    });
    const actions = document.createElement('div');
    actions.className = 'group-buy-settings__actions';
    actions.append(save);
    section.append(grid, actions);
    if (!canPublish()) {
      const note = document.createElement('p');
      note.className = 'text-xs text-muted mt-2';
      note.textContent = t('admin.legal.super_admin_only');
      section.append(note);
    }
    return section;
  }

  function versionsTable(doc) {
    const rows = doc.versions.map((v) => {
      const note = (lang() === 'bn' ? v.change_note_bn : v.change_note_en) || '—';
      return `<tr>
        <td class="font-mono">${escapeHtml(String(v.version))}</td>
        <td class="text-xs">${escapeHtml(formatDate(v.published_at, { lang: lang(), dateStyle: 'medium' }))}</td>
        <td class="text-xs">${escapeHtml(t(v.requires_reacceptance ? 'admin.legal.reaccept_yes' : 'admin.legal.reaccept_no'))}</td>
        <td class="text-xs text-secondary">${escapeHtml(note)}</td>
        <td class="text-xs">${doc.accepted_by ? escapeHtml(formatNumber(v.acceptances, { lang: lang() })) : '—'}</td>
      </tr>`;
    }).join('');
    const wrap = document.createElement('div');
    wrap.className = 'system-table-wrap';
    wrap.innerHTML = `<table class="system-table">
      <thead><tr>
        <th>${escapeHtml(t('admin.legal.col_version'))}</th>
        <th>${escapeHtml(t('admin.legal.col_published'))}</th>
        <th>${escapeHtml(t('admin.legal.col_reaccept'))}</th>
        <th>${escapeHtml(t('admin.legal.col_note'))}</th>
        <th>${escapeHtml(t('admin.legal.col_accepted'))}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    return wrap;
  }

  function publishForm(doc) {
    const cur = doc.current;
    const L = data.limits;
    const form = document.createElement('div');
    form.className = 'legal-admin__form mt-3';
    const grid = document.createElement('div');
    grid.className = 'group-buy-settings__grid';

    const titleEn = Input({ label: t('admin.legal.title_en'), name: `${doc.key}_title_en`, value: cur?.title_en ?? '', maxLength: L.title.max, required: true });
    const titleBn = Input({ label: t('admin.legal.title_bn'), name: `${doc.key}_title_bn`, value: cur?.title_bn ?? '', maxLength: L.title.max, required: true });
    const bodyEn = Textarea({ label: t('admin.legal.body_en'), hint: t('admin.legal.body_hint'), name: `${doc.key}_body_en`, value: cur?.body_en ?? '', rows: 14, maxLength: L.body.max, required: true });
    const bodyBn = Textarea({ label: t('admin.legal.body_bn'), hint: t('admin.legal.body_hint'), name: `${doc.key}_body_bn`, value: cur?.body_bn ?? '', rows: 14, maxLength: L.body.max, required: true });
    const noteEn = Input({ label: t('admin.legal.note_en'), hint: t('admin.legal.note_hint'), name: `${doc.key}_note_en`, maxLength: L.changeNote.max, required: true });
    const noteBn = Input({ label: t('admin.legal.note_bn'), hint: t('admin.legal.note_hint'), name: `${doc.key}_note_bn`, maxLength: L.changeNote.max, required: true });
    grid.append(titleEn, titleBn, bodyEn, bodyBn, noteEn, noteBn);

    // WHY never pre-ticked: asking every user to agree again is the heavy choice and must be made
    // on purpose. A document nobody signs (the refund policy) has no such choice.
    const reaccept = doc.accepted_by
      ? Checkbox({ label: t('admin.legal.reaccept_label'), hint: t('admin.legal.reaccept_hint'), checked: false, name: `${doc.key}_reaccept` })
      : null;
    const reason = reasonInput(`${doc.key}_reason`);
    form.append(grid);
    if (reaccept) form.append(reaccept);
    form.append(reason);

    const publish = Button({
      label: t('admin.legal.publish_btn', { version: (cur?.version ?? 0) + 1 }),
      variant: 'primary',
      size: 'sm',
      onClick: async () => {
        if (!reasonOk(reason)) return;
        const wantsReaccept = Boolean(reaccept?.checked);
        const ok = await confirmDialog({
          title: t('admin.legal.confirm_title', { doc: docName(doc.key), version: (cur?.version ?? 0) + 1 }),
          description: t(wantsReaccept ? 'admin.legal.confirm_reaccept' : 'admin.legal.confirm_no_reaccept'),
          confirmLabel: t('admin.legal.publish_confirm'),
          variant: wantsReaccept ? 'danger' : 'primary',
          trigger: publish,
        });
        if (!ok) return;
        publish.disabled = true;
        try {
          const res = await publishLegalVersion(doc.key, {
            base_version: cur?.version ?? 0,
            title_en: titleEn.value.trim(),
            title_bn: titleBn.value.trim(),
            body_en: bodyEn.value,
            body_bn: bodyBn.value,
            change_note_en: noteEn.value.trim(),
            change_note_bn: noteBn.value.trim(),
            requires_reacceptance: wantsReaccept,
            reason: reason.value.trim(),
          });
          toast.success((lang() === 'bn' ? res?.message_bn : res?.message_en) || t('admin.legal.published'));
          editing = null;
          await loadData();
        } catch (err) {
          toast.error(err?.message || t('common.error_generic'));
          publish.disabled = false;
        }
      },
    });
    const cancel = Button({ label: t('common.cancel'), variant: 'ghost', size: 'sm', onClick: () => { editing = null; render(); } });
    const actions = document.createElement('div');
    actions.className = 'group-buy-settings__actions';
    actions.append(cancel, publish);
    form.append(actions);
    return form;
  }

  /** The current text with every {{token}} marked: filled, default, empty or filled by the platform. */
  function markedPreview(doc, previewLang: 'en' | 'bn') {
    const wrap = document.createElement('div');
    wrap.className = 'legal-admin__preview mt-3';
    const bar = document.createElement('div');
    bar.className = 'legal-admin__preview-bar';
    const legend = document.createElement('p');
    legend.className = 'legal-admin__legend text-xs';
    legend.innerHTML = ['filled', 'fallback', 'empty', 'auto']
      .map((s) => `<mark class="legal-token legal-token--${s}">${escapeHtml(t(`admin.legal.mark.${s}`))}</mark>`).join(' ');
    const other = previewLang === 'en' ? 'bn' : 'en';
    bar.append(legend, Button({
      label: t(`admin.legal.preview_in_${other}`),
      variant: 'ghost',
      size: 'sm',
      onClick: () => { previewing.set(doc.key, other); render(); },
    }));
    const body = document.createElement('div');
    body.className = 'legal-page__body legal-admin__preview-body';
    body.lang = previewLang;
    const text = previewLang === 'bn' ? doc.current?.body_bn : doc.current?.body_en;
    body.innerHTML = markLegalTokens(renderLegalText(text).html, {
      company: data.company || {},
      fields: data.company_fields || {},
      lang: previewLang,
      auto: { 'returns.window_days': data.return_window_days },
      labelOf: (field) => t(`admin.legal.company.${field in (data.company_fields || {}) ? field : `${field}_en`}`),
    });
    wrap.append(bar, body);
    return wrap;
  }

  /** What a lawyer should confirm in this document before launch. Not part of the text. */
  function reviewList(doc) {
    const n = LEGAL_REVIEW_POINTS[doc.key] ?? 0;
    if (!n) return null;
    const box = document.createElement('details');
    box.className = 'legal-admin__review mt-3';
    const items = Array.from({ length: n }, (_, i) => `<li>${escapeHtml(t(`admin.legal.review.${doc.key}.${i + 1}`))}</li>`).join('');
    box.innerHTML = `<summary>${escapeHtml(t('admin.legal.review_title', { count: n }))}</summary><ul>${items}</ul>`;
    return box;
  }

  function documentCard(doc) {
    const section = document.createElement('section');
    section.className = 'admin-panel mt-4';
    const cur = doc.current;
    const audience = doc.accepted_by === 'all'
      ? t('admin.legal.audience_all')
      : Array.isArray(doc.accepted_by)
        ? t('admin.legal.audience_roles', { roles: doc.accepted_by.map((r) => t(`admin.legal.role.${r}`)).join(', ') })
        : t('admin.legal.audience_none');

    const head = document.createElement('div');
    head.className = 'legal-admin__doc-head';
    head.innerHTML = `
      <div>
        <h2 class="admin-panel__title">${escapeHtml(docName(doc.key))}</h2>
        <p class="text-sm text-secondary">${escapeHtml(cur
          ? t('admin.legal.current', { version: cur.version })
          : t('admin.legal.none_yet'))} · ${escapeHtml(audience)}</p>
      </div>`;
    const actions = document.createElement('div');
    actions.className = 'legal-admin__doc-actions';
    const view = document.createElement('a');
    view.href = doc.path;
    view.className = 'btn btn--secondary btn--sm';
    view.textContent = t('admin.legal.view');
    view.target = '_blank';
    view.rel = 'noopener';
    actions.append(view);
    if (cur) {
      const open = previewing.has(doc.key);
      actions.append(Button({
        label: t(open ? 'admin.legal.preview_hide' : 'admin.legal.preview_show'),
        variant: 'secondary',
        size: 'sm',
        onClick: () => {
          if (open) previewing.delete(doc.key);
          else previewing.set(doc.key, lang());
          render();
        },
      }));
    }
    if (canPublish() && editing !== doc.key) {
      actions.append(Button({ label: t('admin.legal.new_version'), variant: 'secondary', size: 'sm', onClick: () => { editing = doc.key; render(); } }));
    }
    head.append(actions);
    section.append(head);
    if (doc.versions.length) section.append(versionsTable(doc));
    const review = reviewList(doc);
    if (review) section.append(review);
    if (previewing.has(doc.key)) section.append(markedPreview(doc, previewing.get(doc.key)));
    if (editing === doc.key) section.append(publishForm(doc));
    return section;
  }

  function historyPanel() {
    const section = panel('admin.legal.history_title');
    const rows = (data.history || []).map((row) => {
      const when = row.created_at ? formatRelativeTime(new Date(row.created_at).getTime(), { lang: lang() }) : '—';
      const reason = row.meta_json?.reason || row.meta?.reason || '';
      const what = row.action === 'platform.legal.publish'
        ? t('admin.legal.history_publish', { ref: row.target_ref || '' })
        : t('admin.legal.history_company');
      return `<tr>
        <td class="text-xs">${escapeHtml(when)}</td>
        <td class="text-xs font-mono">${escapeHtml(row.actor_ref || row.actor_id || '—')}</td>
        <td>${escapeHtml(what)}</td>
        <td class="text-xs text-secondary">${escapeHtml(reason)}</td>
      </tr>`;
    }).join('');
    const body = document.createElement('div');
    body.innerHTML = rows
      ? `<div class="system-table-wrap"><table class="system-table">
          <thead><tr>
            <th>${escapeHtml(t('admin.legal.col_when'))}</th>
            <th>${escapeHtml(t('admin.legal.col_who'))}</th>
            <th>${escapeHtml(t('admin.legal.col_change'))}</th>
            <th>${escapeHtml(t('admin.legal.col_reason'))}</th>
          </tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="p-6 text-center text-sm text-muted">${escapeHtml(t('admin.legal.history_empty'))}</p>`;
    section.append(body);
    return section;
  }

  function render() {
    root.innerHTML = '';
    container.replaceChildren();
    const header = document.createElement('div');
    header.className = 'admin-page-header';
    header.innerHTML = `
      <div>
        <h1 class="admin-page-title">${escapeHtml(t('admin.legal.title'))}</h1>
        <p class="admin-page-subtitle">${escapeHtml(t('admin.legal.subtitle'))}</p>
      </div>`;
    container.append(header, PlatformSubnav({ activeKey: 'legal', navigate }));

    if (isLoading && !data) {
      const p = document.createElement('div');
      p.className = 'p-8 text-center text-muted';
      p.textContent = t('common.loading');
      container.append(p);
    } else if (loadError && !data) {
      const p = document.createElement('div');
      p.className = 'admin-panel p-6 text-center text-sm';
      p.textContent = loadError;
      container.append(p);
    } else if (data) {
      const missing = missingCard();
      if (missing) container.append(missing);
      container.append(companyCard(), ...data.documents.map(documentCard), historyPanel());
    }
    root.appendChild(container);
  }

  loadData();
}
