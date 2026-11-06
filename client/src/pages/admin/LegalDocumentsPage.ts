/**
 * LegalDocumentsPage.ts — /admin/platform/legal: the terms, privacy policy, refund policy and
 * Explooro partner agreement (migration 104, services/legal.service.ts).
 *
 *   * Company details: the name, licence, address and contact the documents show ({{company.*}}).
 *     Warned about while any is empty, because the documents read "—" in their place.
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
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.ts';
import type { PageContext } from '../types.ts';
import '../../styles/components/legal.css';

const COMPANY_FIELD_ORDER = ['legal_name', 'trade_license', 'address_en', 'address_bn', 'support_email', 'support_phone'];

export default function LegalDocumentsPage(root: HTMLElement, { navigate }: PageContext = {}) {
  loadSystemHealthStyles();
  const container = document.createElement('div');
  container.className = 'admin-page legal-admin-page';

  let data = null;
  let loadError = null;
  let isLoading = true;
  /** The document whose new-version form is open, if any. */
  let editing: string | null = null;

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
    const grid = document.createElement('div');
    grid.className = 'group-buy-settings__grid';
    const fields = {};
    for (const f of COMPANY_FIELD_ORDER) {
      const input = Input({
        label: t(`admin.legal.company.${f}`),
        hint: t(`admin.legal.company.${f}_hint`),
        type: f === 'support_email' ? 'email' : f === 'support_phone' ? 'tel' : 'text',
        name: `company_${f}`,
        value: data.company?.[f] ?? '',
        maxLength: data.company_fields?.[f]?.max ?? 200,
      });
      input.input.disabled = !canPublish();
      fields[f] = input;
      grid.append(input);
    }
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
          const body = Object.fromEntries(COMPANY_FIELD_ORDER.map((f) => [f, fields[f].value.trim()]));
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
    view.className = 'btn btn--ghost btn--sm';
    view.textContent = t('admin.legal.view');
    view.target = '_blank';
    view.rel = 'noopener';
    actions.append(view);
    if (canPublish() && editing !== doc.key) {
      actions.append(Button({ label: t('admin.legal.new_version'), variant: 'secondary', size: 'sm', onClick: () => { editing = doc.key; render(); } }));
    }
    head.append(actions);
    section.append(head);
    if (doc.versions.length) section.append(versionsTable(doc));
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
