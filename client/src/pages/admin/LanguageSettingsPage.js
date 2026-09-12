/**
 * LanguageSettingsPage.js — Super Admin Language & Localization governance.
 *
 * Implements /admin/platform/language:
 * 1. The platform default language — what a visitor with no saved choice of their own sees first.
 * 2. Which locales the language switcher may offer at all.
 * 3. Whether visitors may choose their own language, or are held to the platform default.
 * 4. "Who can change this" — the role defaults plus the live standing grants for
 *    `platform.localization.update`, read from the same tables the API's guard reads.
 * 5. Recent change history (actor, before → after, reason) straight from audit_logs.
 * 6. Shared PlatformSubnav interconnecting the platform governance surfaces.
 *
 * WHY this is its own page rather than a field on Platform Settings: the brief is "Super Admin, or
 * a user the Super Admin assigns". Platform Settings writes through `platform.settings.update`,
 * which is CRITICAL and therefore `delegable: false` — it can never be granted to anyone
 * (docs/rbac-spec.md §2). A separate MEDIUM-tier `platform.localization.update` is what makes the
 * "or an assigned user" half of the requirement expressible at all, and it needs its own surface
 * so a grantee who holds only that key has somewhere to go.
 *
 * The read key (`platform.localization.view`, LOW) gates the page; the write key
 * (`platform.localization.update`, MEDIUM) gates the Save action, so an Admin or Editor can see
 * the current policy without being able to move it — docs/super-admin-audit.md §5 invariant 2.
 */

import '../../styles/components/language-settings.css';

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Modal } from '../../components/ui/Modal.js';
import { Switch } from '../../components/ui/Switch.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.js';
import { LocaleChoiceCard } from '../../components/admin/LocaleChoiceCard.js';
import { adminApi } from '../../services/admin.api.js';
import { can } from '../../services/permissions.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage, applyLocalePolicy } from '../../services/i18n.js';
import { formatDate, formatRelativeTime } from '../../services/format.js';

const LOCALE_LABELS = { en: 'English', bn: 'বাংলা' };
const MIN_REASON_LENGTH = 10;

export default function LanguageSettingsPage(root, { navigate } = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page language-settings-page';

  let policy = null;
  let authority = { roles: [], grants: [] };
  let history = [];
  let supportedLocales = ['en', 'bn'];
  let isLoading = true;
  let isSaving = false;

  /** The edited copy. `null` until load, then always a complete policy. */
  let draft = null;
  let canUpdate = can('platform.localization.update');

  function isDirty() {
    if (!policy || !draft) return false;
    return (
      policy.default_locale !== draft.default_locale ||
      policy.allow_user_override !== draft.allow_user_override ||
      policy.enabled_locales.join(',') !== draft.enabled_locales.join(',')
    );
  }

  async function loadData() {
    isLoading = true;
    render();
    try {
      const res = await adminApi.getLocalizationPolicy();
      policy = {
        default_locale: res?.policy?.default_locale || 'en',
        enabled_locales: [...(res?.policy?.enabled_locales || ['en', 'bn'])].sort(),
        allow_user_override: res?.policy?.allow_user_override !== false,
        updated_at: res?.policy?.updated_at || null,
        updated_by: res?.policy?.updated_by || null,
      };
      draft = { ...policy, enabled_locales: [...policy.enabled_locales] };
      authority = res?.authority || { roles: [], grants: [] };
      history = res?.history || [];
      supportedLocales = res?.supported_locales || supportedLocales;
      // The server is the authority on whether this operator may write; `can()` only knows what
      // the last permission sync told the client.
      if (typeof res?.can_update === 'boolean') canUpdate = res.can_update;
    } catch (err) {
      toast.error(err?.message_en || err?.message || 'Failed to load language settings');
      policy = null;
      draft = null;
    } finally {
      isLoading = false;
      render();
    }
  }

  function setDefaultLocale(locale) {
    if (!draft) return;
    draft.default_locale = locale;
    // A default that is not enabled is the one combination the API refuses, so enabling it here
    // is the only behaviour that cannot produce a save the user does not expect.
    if (!draft.enabled_locales.includes(locale)) {
      draft.enabled_locales = [...draft.enabled_locales, locale].sort();
    }
    render();
  }

  function toggleEnabled(locale, nextEnabled) {
    if (!draft) return;
    if (!nextEnabled && locale === draft.default_locale) {
      toast.error(
        isBn ? 'ডিফল্ট ভাষা বন্ধ করা যাবে না।' : 'The default language cannot be disabled.'
      );
      render();
      return;
    }
    if (!nextEnabled && draft.enabled_locales.length <= 1) {
      toast.error(isBn ? 'অন্তত একটি ভাষা সক্রিয় রাখতে হবে।' : 'At least one language must stay enabled.');
      render();
      return;
    }
    draft.enabled_locales = nextEnabled
      ? [...new Set([...draft.enabled_locales, locale])].sort()
      : draft.enabled_locales.filter((l) => l !== locale);
    render();
  }

  function discardChanges() {
    if (!policy) return;
    draft = { ...policy, enabled_locales: [...policy.enabled_locales] };
    render();
  }

  /**
   * Save confirmation. Purpose-built rather than confirmDialogWithReason() because the API
   * requires a reason of at least MIN_REASON_LENGTH characters and the shared dialog only enforces
   * "not empty" — a checklist that does not gate the action is worse than none
   * (docs/super-admin-audit.md §5 invariant 9).
   */
  function openSaveModal(trigger) {
    const body = document.createElement('div');
    body.className = 'language-save-modal';

    const summary = document.createElement('div');
    summary.className = 'language-save-modal__summary';
    summary.innerHTML = `
      <p class="text-sm text-secondary">
        ${t(
          'admin_language.modal_desc',
          'Every visitor who has not chosen a language of their own will see the platform default from their next page load.'
        )}
      </p>
      <dl class="language-diff">
        ${diffRow(
          t('admin_language.field_default', 'Default language'),
          LOCALE_LABELS[policy.default_locale] || policy.default_locale,
          LOCALE_LABELS[draft.default_locale] || draft.default_locale
        )}
        ${diffRow(
          t('admin_language.field_enabled', 'Enabled languages'),
          policy.enabled_locales.map((l) => LOCALE_LABELS[l] || l).join(', '),
          draft.enabled_locales.map((l) => LOCALE_LABELS[l] || l).join(', ')
        )}
        ${diffRow(
          t('admin_language.field_override', 'Visitors may choose'),
          policy.allow_user_override ? t('common.yes', 'Yes') : t('common.no', 'No'),
          draft.allow_user_override ? t('common.yes', 'Yes') : t('common.no', 'No')
        )}
      </dl>
    `;

    const reasonField = Textarea({
      label: t('admin_language.reason_label', 'Why are you changing this?'),
      hint: t(
        'admin_language.reason_hint',
        'Recorded in the audit log with the old and new values. At least 10 characters.'
      ),
      rows: 3,
      maxLength: 500,
      showCounter: true,
      required: true,
    });

    const cancelBtn = Button({
      label: t('common.cancel', 'Cancel'),
      variant: 'secondary',
      onClick: () => modal.close(),
    });

    const confirmBtn = Button({
      label: t('admin_language.btn_confirm_save', 'Apply default language'),
      variant: 'primary',
      disabled: true,
      onClick: async () => {
        const reason = reasonField.value.trim();
        modal.close();
        await executeSave(reason);
      },
    });

    // The gate: nothing is submittable until the reason meets the same minimum the API enforces.
    const reasonInput = reasonField.querySelector('textarea');
    reasonInput?.addEventListener('input', () => {
      confirmBtn.setDisabled(reasonInput.value.trim().length < MIN_REASON_LENGTH);
    });

    const footer = document.createDocumentFragment();
    footer.append(cancelBtn, confirmBtn);

    body.append(summary, reasonField);

    const modal = Modal({
      title: t('admin_language.modal_title', 'Confirm the platform default language'),
      content: body,
      footer,
      size: 'sm',
    });

    modal.open(trigger);
    reasonInput?.focus();
  }

  function diffRow(label, from, to) {
    const changed = from !== to;
    return `
      <div class="language-diff__row${changed ? ' language-diff__row--changed' : ''}">
        <dt class="language-diff__label">${label}</dt>
        <dd class="language-diff__value">
          <span class="language-diff__from">${from}</span>
          ${changed ? `<span class="language-diff__arrow" aria-hidden="true">→</span><span class="language-diff__to">${to}</span>` : ''}
        </dd>
      </div>
    `;
  }

  async function executeSave(reason) {
    isSaving = true;
    render();
    try {
      const res = await adminApi.updateLocalizationPolicy({
        default_locale: draft.default_locale,
        enabled_locales: draft.enabled_locales,
        allow_user_override: draft.allow_user_override,
        reason,
      });

      policy = {
        default_locale: res?.policy?.default_locale || draft.default_locale,
        enabled_locales: [...(res?.policy?.enabled_locales || draft.enabled_locales)].sort(),
        allow_user_override: res?.policy?.allow_user_override !== false,
        updated_at: res?.policy?.updated_at || new Date().toISOString(),
        updated_by: res?.policy?.updated_by ?? null,
      };
      draft = { ...policy, enabled_locales: [...policy.enabled_locales] };

      // Adopt the new policy in this tab immediately. Without this the operator saves a default
      // and sees nothing change until their next cold load, which reads as a failed save.
      await applyLocalePolicy(policy);

      toast.success(
        res?.[isBn ? 'message_bn' : 'message_en'] ||
          t('admin_language.toast_saved', 'Default language updated.')
      );
      // Re-read so the history panel shows the row that was just written.
      await loadData();
      return;
    } catch (err) {
      toast.error(err?.[isBn ? 'message_bn' : 'message_en'] || err?.message || 'Failed to save');
    } finally {
      isSaving = false;
      render();
    }
  }

  function renderPolicyCard() {
    const card = document.createElement('section');
    card.className = 'card language-policy-card';

    const fieldset = document.createElement('fieldset');
    fieldset.className = 'language-policy-card__fieldset';

    const legend = document.createElement('legend');
    legend.className = 'language-policy-card__legend';
    legend.textContent = t('admin_language.locales_legend', 'Languages');
    fieldset.append(legend);

    const hint = document.createElement('p');
    hint.className = 'language-policy-card__hint';
    hint.textContent = t(
      'admin_language.locales_hint',
      'The default is what a new visitor sees. Disabling a language removes it from the switcher everywhere.'
    );
    fieldset.append(hint);

    const grid = document.createElement('div');
    grid.className = 'locale-card-grid';
    supportedLocales.forEach((locale) => {
      grid.append(
        LocaleChoiceCard({
          locale,
          isDefault: draft.default_locale === locale,
          isEnabled: draft.enabled_locales.includes(locale),
          isCurrent: getLanguage() === locale,
          idPrefix: 'platform-locale',
          readOnly: !canUpdate || isSaving,
          onSetDefault: setDefaultLocale,
          onToggleEnabled: toggleEnabled,
        })
      );
    });
    fieldset.append(grid);
    card.append(fieldset);

    const overrideRow = document.createElement('div');
    overrideRow.className = 'language-policy-card__override';
    overrideRow.append(
      Switch({
        label: t('admin_language.override_label', 'Let visitors choose their own language'),
        hint: t(
          'admin_language.override_hint',
          'Off means everyone sees the default and the language switcher is hidden, including for signed-in users.'
        ),
        checked: draft.allow_user_override,
        disabled: !canUpdate || isSaving,
        onChange: (checked) => {
          draft.allow_user_override = checked;
          render();
        },
      })
    );
    card.append(overrideRow);

    if (policy.updated_at) {
      const meta = document.createElement('p');
      meta.className = 'language-policy-card__meta';
      meta.textContent = `${t('admin_language.last_changed', 'Last changed')}: ${formatRelativeTime(
        new Date(policy.updated_at).getTime(),
        { lang: isBn ? 'bn' : 'en' }
      )}`;
      card.append(meta);
    }

    return card;
  }

  function renderAuthorityCard() {
    const card = document.createElement('section');
    card.className = 'card language-authority-card';

    const head = document.createElement('div');
    head.className = 'language-authority-card__head';
    head.innerHTML = `
      <h2 class="card-title">${t('admin_language.authority_title', 'Who can change this')}</h2>
      <p class="text-xs text-secondary">
        ${t(
          'admin_language.authority_hint',
          'Super Admin always can. Anyone else needs a standing grant for platform.localization.update.'
        )}
      </p>
    `;
    card.append(head);

    const roleList = document.createElement('ul');
    roleList.className = 'language-authority-list';
    (authority.roles || []).forEach((role) => {
      const li = document.createElement('li');
      li.className = 'language-authority-list__item';
      li.innerHTML = `
        <span class="language-authority-list__name">${isBn ? role.label_bn || role.label_en : role.label_en}</span>
        <span class="language-authority-list__kind">${t('admin_language.by_role', 'by role')}</span>
      `;
      roleList.append(li);
    });

    (authority.grants || []).forEach((grant) => {
      const li = document.createElement('li');
      li.className = 'language-authority-list__item';
      const name = grant.display_name || grant.full_name || grant.user_ref;
      const until = grant.expires_at
        ? formatDate(new Date(grant.expires_at).getTime(), { lang: isBn ? 'bn' : 'en' })
        : '';
      li.innerHTML = `
        <span class="language-authority-list__name">${name}</span>
        <span class="language-authority-list__kind">
          ${t('admin_language.by_grant', 'granted')}${until ? ` · ${t('admin_language.until', 'until')} ${until}` : ''}
        </span>
      `;
      roleList.append(li);
    });

    if (!roleList.children.length) {
      card.append(
        EmptyState({
          title: t('admin_language.authority_empty', 'No one holds this permission yet'),
          description: t(
            'admin_language.authority_empty_desc',
            'Assign it from Access Grants to let someone other than a Super Admin change the language.'
          ),
        })
      );
    } else {
      card.append(roleList);
    }

    const grantBtn = Button({
      label: t('admin_language.btn_manage_grants', 'Assign this permission'),
      variant: 'secondary',
      size: 'sm',
      onClick: () => navigate?.('/admin/grants'),
    });
    const actions = document.createElement('div');
    actions.className = 'language-authority-card__actions';
    actions.append(grantBtn);
    card.append(actions);

    return card;
  }

  function renderHistoryCard() {
    const card = document.createElement('section');
    card.className = 'card language-history-card';
    const heading = document.createElement('h2');
    heading.className = 'card-title';
    heading.textContent = t('admin_language.history_title', 'Recent changes');
    card.append(heading);

    if (!history.length) {
      card.append(
        EmptyState({
          title: t('admin_language.history_empty', 'No changes recorded yet'),
          description: t(
            'admin_language.history_empty_desc',
            'Every change to the default language is written to the audit log with its old and new values.'
          ),
        })
      );
      return card;
    }

    const list = document.createElement('ol');
    list.className = 'language-history-list';
    history.forEach((row) => {
      const before = row.before_json || {};
      const after = row.after_json || {};
      const reason = row.after?.meta?.reason || row.after_json?.meta?.reason || '';
      const li = document.createElement('li');
      li.className = 'language-history-list__item';
      li.innerHTML = `
        <div class="language-history-list__head">
          <span class="language-history-list__actor font-mono">${row.actor_ref || row.actor_id || '—'}</span>
          <span class="language-history-list__time">${
            row.created_at
              ? formatRelativeTime(new Date(row.created_at).getTime(), { lang: isBn ? 'bn' : 'en' })
              : ''
          }</span>
        </div>
        <p class="language-history-list__change">
          ${LOCALE_LABELS[before.default_locale] || before.default_locale || '—'}
          <span aria-hidden="true">→</span>
          <strong>${LOCALE_LABELS[after.default_locale] || after.default_locale || '—'}</strong>
        </p>
        ${reason ? `<p class="language-history-list__reason">${reason}</p>` : ''}
      `;
      list.append(li);
    });
    card.append(list);
    return card;
  }

  function render() {
    container.innerHTML = '';

    const header = document.createElement('header');
    header.className = 'admin-page-header';

    const infoCol = document.createElement('div');
    // WHY the badge is appended and not interpolated: Badge() returns a DOM node, so putting it in
    // a template literal renders the string "[object HTMLSpanElement]".
    const eyebrow = document.createElement('div');
    eyebrow.className = 'admin-page-eyebrow';
    eyebrow.append(Badge({ label: t('admin_language.badge', 'LOCALIZATION'), variant: 'primary' }));
    const eyebrowMeta = document.createElement('span');
    eyebrowMeta.className = 'text-xs text-secondary font-mono';
    eyebrowMeta.textContent = 'platform_settings · localization';
    eyebrow.append(eyebrowMeta);

    const titleEl = document.createElement('h1');
    titleEl.className = 'admin-page-title';
    titleEl.textContent = t('admin_language.title', 'Language & Default Locale');

    const subtitleEl = document.createElement('p');
    subtitleEl.className = 'admin-page-subtitle';
    subtitleEl.textContent = t(
      'admin_language.subtitle',
      'Set the language the platform opens in for every new visitor, choose which languages the switcher offers, and decide whether visitors may change it.'
    );

    infoCol.append(eyebrow, titleEl, subtitleEl);

    const actionsCol = document.createElement('div');
    actionsCol.className = 'admin-page-actions';

    if (canUpdate) {
      const discardBtn = Button({
        label: t('common.discard', 'Discard'),
        variant: 'secondary',
        disabled: !isDirty() || isSaving,
        onClick: discardChanges,
      });
      const saveBtn = Button({
        label: t('admin_language.btn_save', 'Save language policy'),
        variant: 'primary',
        disabled: !isDirty() || isSaving,
        onClick: (event) => openSaveModal(event?.currentTarget || null),
      });
      actionsCol.append(discardBtn, saveBtn);
    } else {
      const readOnlyNote = document.createElement('p');
      readOnlyNote.className = 'admin-page-actions__note';
      readOnlyNote.textContent = t(
        'admin_language.read_only',
        'You can view this policy but not change it.'
      );
      actionsCol.append(readOnlyNote);
    }

    header.append(infoCol, actionsCol);
    container.append(header);

    container.append(PlatformSubnav({ activeKey: 'language', navigate }));

    if (isLoading) {
      const loader = document.createElement('div');
      loader.className = 'card p-8 text-center text-secondary';
      loader.innerHTML = `<div class="spinner"></div><p class="mt-2">${t('common.loading', 'Loading')}…</p>`;
      container.append(loader);
      root.replaceChildren(container);
      return;
    }

    if (!policy || !draft) {
      container.append(
        EmptyState({
          title: t('admin_language.load_failed', 'Language settings are unavailable'),
          description: t(
            'admin_language.load_failed_desc',
            'The policy could not be read. The platform is running on its built-in default until this loads.'
          ),
          action: Button({ label: t('common.retry', 'Retry'), variant: 'primary', onClick: loadData }),
        })
      );
      root.replaceChildren(container);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'language-settings-grid';
    grid.append(renderPolicyCard(), renderAuthorityCard(), renderHistoryCard());
    container.append(grid);

    root.replaceChildren(container);
  }

  loadData();

  return container;
}
