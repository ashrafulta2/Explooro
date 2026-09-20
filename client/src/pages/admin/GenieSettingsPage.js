/**
 * GenieSettingsPage.js — Super Admin governance of the popup "genie" open/close effect.
 *
 * Implements /admin/platform/genie:
 * 1. Whether the genie plays on popups at all (off = the plain CSS fade).
 * 2. How long one open or close takes.
 * 3. How finely it is drawn ("smoothness": light / balanced / smooth) — the trade between a
 *    smoother curve and the work done on every open and close.
 * 4. A "Try it" preview that plays the DRAFT values on a real popup without saving anything.
 * 5. "Who can change this" — role defaults plus live standing grants for `platform.genie.update`.
 * 6. Recent change history (actor, before → after, reason) straight from audit_logs.
 *
 * WHY its own page, and its own permission pair: same reasoning as the Language page. Platform
 * Settings writes through `platform.settings.update`, which is CRITICAL and therefore never
 * delegable (docs/rbac-spec.md §2); a MEDIUM `platform.genie.update` is what lets a Super Admin
 * hand popup motion to, say, a design lead without handing them the platform's money settings.
 *
 * The read key (`platform.genie.view`, LOW) gates the page; the write key gates Save, so an Admin
 * can see the current policy without being able to move it (docs/super-admin-audit.md §5 inv. 2).
 *
 * The page chrome (cards, diff, authority and history lists) is language-settings.css — the
 * classes are generic to "a governed platform setting" and duplicating 300 lines of CSS into a
 * second stylesheet would cost budget for nothing. It is imported here, never by main.css.
 */

import '../../styles/components/language-settings.css';
import '../../styles/components/genie-settings.css';

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Modal } from '../../components/ui/Modal.js';
import { Switch } from '../../components/ui/Switch.js';
import { RadioGroup } from '../../components/ui/Radio.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.js';
import { adminApi } from '../../services/admin.api.js';
import { can } from '../../services/permissions.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate, formatRelativeTime } from '../../services/format.js';
import { applyGeniePolicy } from '../../services/genieSettings.js';
import { GENIE_DEFAULTS, GENIE_LIMITS, GENIE_QUALITIES } from '../../lib/genie.js';
import { prefersReducedMotion } from '../../lib/motion.js';

const MIN_REASON_LENGTH = 10;
const DURATION_STEP_MS = 50;

/** History reasons and grantee names are typed by people; nothing is trusted into innerHTML raw. */
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const qualityLabel = (q) =>
  ({
    light: t('admin_genie.quality_light', 'Light'),
    balanced: t('admin_genie.quality_balanced', 'Balanced'),
    smooth: t('admin_genie.quality_smooth', 'Smooth'),
  })[q] || q;

/** One-line human summary of a policy, used by the confirm diff and the history list. */
function summarise(p) {
  if (!p) return '—';
  if (p.enabled === false) return t('admin_genie.summary_off', 'Off (plain fade)');
  return `${t('admin_genie.on', 'On')} · ${p.duration_ms} ms · ${qualityLabel(p.quality)}`;
}

function toPolicy(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    duration_ms: Number.isFinite(raw.duration_ms) ? raw.duration_ms : GENIE_DEFAULTS.duration_ms,
    quality: GENIE_QUALITIES.includes(raw.quality) ? raw.quality : GENIE_DEFAULTS.quality,
    updated_at: raw.updated_at || null,
    updated_by: raw.updated_by ?? null,
  };
}

export default function GenieSettingsPage(root, { navigate } = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page genie-settings-page';

  let policy = null;
  let draft = null;
  let authority = { roles: [], grants: [] };
  let history = [];
  let limits = { min: GENIE_LIMITS.minDurationMs, max: GENIE_LIMITS.maxDurationMs };
  let isLoading = true;
  let isSaving = false;
  let canUpdate = can('platform.genie.update');

  function isDirty() {
    if (!policy || !draft) return false;
    return (
      policy.enabled !== draft.enabled ||
      policy.duration_ms !== draft.duration_ms ||
      policy.quality !== draft.quality
    );
  }

  async function loadData() {
    isLoading = true;
    render();
    try {
      const res = await adminApi.getGeniePolicy();
      policy = toPolicy(res?.policy);
      draft = { ...policy };
      authority = res?.authority || { roles: [], grants: [] };
      history = res?.history || [];
      if (res?.limits) {
        limits = {
          min: res.limits.min_duration_ms ?? limits.min,
          max: res.limits.max_duration_ms ?? limits.max,
        };
      }
      // The server is the authority on whether this operator may write; `can()` only knows what
      // the last permission sync told the client.
      if (typeof res?.can_update === 'boolean') canUpdate = res.can_update;
    } catch (err) {
      toast.error(err?.message_en || err?.message || 'Failed to load popup effect settings');
      policy = null;
      draft = null;
    } finally {
      isLoading = false;
      render();
    }
  }

  function discardChanges() {
    if (!policy) return;
    draft = { ...policy };
    render();
  }

  /**
   * Plays the DRAFT values on a real Modal, opened from the button so the genie has a control to
   * fly to. The engine is put back to the SAVED policy when the preview closes; nothing is
   * persisted (cache: false), so a preview can never leak into what visitors get.
   */
  function openPreview(trigger) {
    applyGeniePolicy(draft, { cache: false });

    const body = document.createElement('div');
    body.className = 'genie-preview';
    const text = document.createElement('p');
    text.className = 'text-sm text-secondary';
    text.textContent = t(
      'admin_genie.preview_body',
      'Close this window and watch it return to the button. These values are applied only while the preview is open — nothing is saved.'
    );
    const summary = document.createElement('p');
    summary.className = 'genie-preview__summary font-mono';
    summary.textContent = summarise(draft);
    body.append(text, summary);
    if (prefersReducedMotion()) {
      const note = document.createElement('p');
      note.className = 'text-sm genie-preview__note';
      note.textContent = t(
        'admin_genie.preview_reduced',
        'Your device has reduced motion turned on, so no animation plays for you. Visitors without that setting will see it.'
      );
      body.append(note);
    }

    const closeBtn = Button({
      label: t('admin_genie.preview_close', 'Close preview'),
      variant: 'primary',
      onClick: () => modal.close(),
    });
    const footer = document.createDocumentFragment();
    footer.append(closeBtn);

    const modal = Modal({
      title: t('admin_genie.preview_title', 'This is how popups will feel'),
      content: body,
      footer,
      size: 'sm',
      onClose: () => applyGeniePolicy(policy, { cache: false }),
    });
    modal.open(trigger);
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
        ${esc(t('admin_genie.modal_desc', 'Every visitor gets the new popup effect from their next page load.'))}
      </p>
      <dl class="language-diff">
        ${diffRow(
          t('admin_genie.field_enabled', 'Genie animation'),
          policy.enabled ? t('admin_genie.on', 'On') : t('admin_genie.off', 'Off'),
          draft.enabled ? t('admin_genie.on', 'On') : t('admin_genie.off', 'Off')
        )}
        ${diffRow(t('admin_genie.field_duration', 'Duration'), `${policy.duration_ms} ms`, `${draft.duration_ms} ms`)}
        ${diffRow(t('admin_genie.field_quality', 'Smoothness'), qualityLabel(policy.quality), qualityLabel(draft.quality))}
      </dl>
    `;

    const reasonField = Textarea({
      label: t('admin_genie.reason_label', 'Why are you changing this?'),
      hint: t(
        'admin_genie.reason_hint',
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
      label: t('admin_genie.btn_confirm_save', 'Apply popup effect'),
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
      title: t('admin_genie.modal_title', 'Confirm the popup effect'),
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
        <dt class="language-diff__label">${esc(label)}</dt>
        <dd class="language-diff__value">
          <span class="language-diff__from">${esc(from)}</span>
          ${changed ? `<span class="language-diff__arrow" aria-hidden="true">→</span><span class="language-diff__to">${esc(to)}</span>` : ''}
        </dd>
      </div>
    `;
  }

  async function executeSave(reason) {
    isSaving = true;
    render();
    try {
      const res = await adminApi.updateGeniePolicy({
        enabled: draft.enabled,
        duration_ms: draft.duration_ms,
        quality: draft.quality,
        reason,
      });
      policy = toPolicy(res?.policy || draft);
      draft = { ...policy };

      // Adopt the new policy in this tab at once. Without this the operator saves a value and sees
      // nothing change until their next cold load, which reads as a failed save.
      applyGeniePolicy(policy);

      toast.success(
        res?.[isBn ? 'message_bn' : 'message_en'] || t('admin_genie.toast_saved', 'Popup effect updated.')
      );
      // Re-read so the history panel shows the row that was just written.
      await loadData();
    } catch (err) {
      toast.error(err?.[isBn ? 'message_bn' : 'message_en'] || err?.message || 'Failed to save');
    } finally {
      isSaving = false;
      render();
    }
  }

  function renderPolicyCard() {
    const readOnly = !canUpdate || isSaving;
    const card = document.createElement('section');
    card.className = 'card language-policy-card genie-policy-card';

    const legend = document.createElement('h2');
    legend.className = 'language-policy-card__legend';
    legend.textContent = t('admin_genie.effect_legend', 'Effect');
    card.append(legend);

    const intro = document.createElement('p');
    intro.className = 'language-policy-card__hint';
    intro.textContent = t(
      'admin_genie.effect_hint',
      'Popups pour out of the button that opened them and are sucked back into it when closed.'
    );
    card.append(intro);

    card.append(
      Switch({
        label: t('admin_genie.enabled_label', 'Play the genie animation on popups'),
        hint: t(
          'admin_genie.enabled_hint',
          'Off means popups use a plain fade. Visitors who have reduced motion turned on in their device never see the animation either way.'
        ),
        checked: draft.enabled,
        disabled: readOnly,
        onChange: (checked) => {
          draft.enabled = checked;
          render();
        },
      })
    );

    // ── Duration ──────────────────────────────────────────────────────────
    const durationField = document.createElement('div');
    durationField.className = 'genie-field';
    const durationId = 'genie-duration';
    const durationHead = document.createElement('div');
    durationHead.className = 'genie-field__head';
    const durationLabel = document.createElement('label');
    durationLabel.className = 'genie-field__label';
    durationLabel.htmlFor = durationId;
    durationLabel.textContent = t('admin_genie.duration_label', 'Duration');
    const output = document.createElement('output');
    output.className = 'genie-field__value font-mono';
    output.htmlFor = durationId;
    output.textContent = `${draft.duration_ms} ms`;
    durationHead.append(durationLabel, output);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = durationId;
    slider.className = 'genie-range';
    slider.min = String(limits.min);
    slider.max = String(limits.max);
    slider.step = String(DURATION_STEP_MS);
    slider.value = String(draft.duration_ms);
    slider.disabled = readOnly || !draft.enabled;
    // `input` only updates the readout, so dragging never rebuilds the control under the pointer;
    // `change` (on release, or per keypress) commits to the draft and re-renders the buttons.
    slider.addEventListener('input', () => {
      output.textContent = `${slider.value} ms`;
    });
    slider.addEventListener('change', () => {
      draft.duration_ms = Number(slider.value);
      render();
    });

    const durationHint = document.createElement('p');
    durationHint.className = 'genie-field__hint';
    durationHint.textContent = t(
      'admin_genie.duration_hint',
      'How long one open or close takes. 650 ms is the shipped default; shorter feels snappier, longer shows off the curve.'
    );
    const scale = document.createElement('div');
    scale.className = 'genie-range-scale font-mono';
    scale.setAttribute('aria-hidden', 'true');
    scale.innerHTML = `<span>${limits.min} ms</span><span>${limits.max} ms</span>`;
    durationField.append(durationHead, slider, scale, durationHint);
    card.append(durationField);

    // ── Smoothness ────────────────────────────────────────────────────────
    const quality = RadioGroup({
      legend: t('admin_genie.quality_legend', 'Smoothness'),
      hint: t(
        'admin_genie.quality_hint',
        'A finer drawing looks smoother but does more work on every open and close. Pick a lighter one if your visitors use budget phones.'
      ),
      name: 'genie-quality',
      value: draft.quality,
      disabled: readOnly || !draft.enabled,
      options: GENIE_QUALITIES.map((q) => ({
        value: q,
        label: qualityLabel(q),
        hint: t(`admin_genie.quality_${q}_desc`, ''),
      })),
      onChange: (value) => {
        draft.quality = value;
        render();
      },
    });
    quality.classList.add('genie-quality');
    card.append(quality);

    // ── Preview + meta ────────────────────────────────────────────────────
    const actions = document.createElement('div');
    actions.className = 'genie-policy-card__actions';
    actions.append(
      Button({
        label: t('admin_genie.btn_preview', 'Try it'),
        variant: 'secondary',
        disabled: isSaving,
        onClick: (event) => openPreview(event?.currentTarget || null),
      })
    );
    card.append(actions);

    if (policy.updated_at) {
      const meta = document.createElement('p');
      meta.className = 'language-policy-card__meta';
      meta.textContent = `${t('admin_genie.last_changed', 'Last changed')}: ${formatRelativeTime(
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
      <h2 class="card-title">${esc(t('admin_genie.authority_title', 'Who can change this'))}</h2>
      <p class="text-xs text-secondary">
        ${esc(t('admin_genie.authority_hint', 'Super Admin always can. Anyone else needs a standing grant for platform.genie.update.'))}
      </p>
    `;
    card.append(head);

    const list = document.createElement('ul');
    list.className = 'language-authority-list';
    (authority.roles || []).forEach((role) => {
      const li = document.createElement('li');
      li.className = 'language-authority-list__item';
      li.innerHTML = `
        <span class="language-authority-list__name">${esc(isBn ? role.label_bn || role.label_en : role.label_en)}</span>
        <span class="language-authority-list__kind">${esc(t('admin_genie.by_role', 'by role'))}</span>
      `;
      list.append(li);
    });
    (authority.grants || []).forEach((grant) => {
      const li = document.createElement('li');
      li.className = 'language-authority-list__item';
      const name = grant.display_name || grant.full_name || grant.user_ref;
      const until = grant.expires_at
        ? formatDate(new Date(grant.expires_at).getTime(), { lang: isBn ? 'bn' : 'en' })
        : '';
      li.innerHTML = `
        <span class="language-authority-list__name">${esc(name)}</span>
        <span class="language-authority-list__kind">
          ${esc(t('admin_genie.by_grant', 'granted'))}${until ? ` · ${esc(t('admin_genie.until', 'until'))} ${esc(until)}` : ''}
        </span>
      `;
      list.append(li);
    });

    if (!list.children.length) {
      card.append(
        EmptyState({
          title: t('admin_genie.authority_empty', 'No one holds this permission yet'),
          description: t(
            'admin_genie.authority_empty_desc',
            'Assign it from Access Grants to let someone other than a Super Admin tune the popup effect.'
          ),
        })
      );
    } else {
      card.append(list);
    }

    const actions = document.createElement('div');
    actions.className = 'language-authority-card__actions';
    actions.append(
      Button({
        label: t('admin_genie.btn_manage_grants', 'Assign this permission'),
        variant: 'secondary',
        size: 'sm',
        onClick: () => navigate?.('/admin/grants'),
      })
    );
    card.append(actions);
    return card;
  }

  function renderHistoryCard() {
    const card = document.createElement('section');
    card.className = 'card language-history-card';
    const heading = document.createElement('h2');
    heading.className = 'card-title';
    heading.textContent = t('admin_genie.history_title', 'Recent changes');
    card.append(heading);

    if (!history.length) {
      card.append(
        EmptyState({
          title: t('admin_genie.history_empty', 'No changes recorded yet'),
          description: t(
            'admin_genie.history_empty_desc',
            'Every change to the popup effect is written to the audit log with its old and new values.'
          ),
        })
      );
      return card;
    }

    const list = document.createElement('ol');
    list.className = 'language-history-list';
    history.forEach((row) => {
      const reason = row.after?.meta?.reason || row.after_json?.meta?.reason || '';
      const li = document.createElement('li');
      li.className = 'language-history-list__item';
      li.innerHTML = `
        <div class="language-history-list__head">
          <span class="language-history-list__actor font-mono">${esc(row.actor_ref || row.actor_id || '—')}</span>
          <span class="language-history-list__time">${esc(
            row.created_at
              ? formatRelativeTime(new Date(row.created_at).getTime(), { lang: isBn ? 'bn' : 'en' })
              : ''
          )}</span>
        </div>
        <p class="language-history-list__change">
          ${esc(summarise(row.before_json))}
          <span aria-hidden="true">→</span>
          <strong>${esc(summarise(row.after_json))}</strong>
        </p>
        ${reason ? `<p class="language-history-list__reason">${esc(reason)}</p>` : ''}
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
    eyebrow.append(Badge({ label: t('admin_genie.badge', 'POPUP EFFECT'), variant: 'primary' }));
    const eyebrowMeta = document.createElement('span');
    eyebrowMeta.className = 'text-xs text-secondary font-mono';
    eyebrowMeta.textContent = 'platform_settings · genie';
    eyebrow.append(eyebrowMeta);

    const titleEl = document.createElement('h1');
    titleEl.className = 'admin-page-title';
    titleEl.textContent = t('admin_genie.title', 'Popup Genie Effect');

    const subtitleEl = document.createElement('p');
    subtitleEl.className = 'admin-page-subtitle';
    subtitleEl.textContent = t(
      'admin_genie.subtitle',
      'Control the open-and-close animation every popup plays: turn it on or off, set how long it takes, and choose how smoothly it is drawn.'
    );
    infoCol.append(eyebrow, titleEl, subtitleEl);

    const actionsCol = document.createElement('div');
    actionsCol.className = 'admin-page-actions';
    if (canUpdate) {
      actionsCol.append(
        Button({
          label: t('common.discard', 'Discard'),
          variant: 'secondary',
          disabled: !isDirty() || isSaving,
          onClick: discardChanges,
        }),
        Button({
          label: t('admin_genie.btn_save', 'Save popup effect'),
          variant: 'primary',
          disabled: !isDirty() || isSaving,
          onClick: (event) => openSaveModal(event?.currentTarget || null),
        })
      );
    } else {
      const readOnlyNote = document.createElement('p');
      readOnlyNote.className = 'admin-page-actions__note';
      readOnlyNote.textContent = t('admin_genie.read_only', 'You can view this setting but not change it.');
      actionsCol.append(readOnlyNote);
    }

    header.append(infoCol, actionsCol);
    container.append(header);
    container.append(PlatformSubnav({ activeKey: 'genie', navigate }));

    if (isLoading) {
      const loader = document.createElement('div');
      loader.className = 'card p-8 text-center text-secondary';
      loader.innerHTML = `<div class="spinner"></div><p class="mt-2">${esc(t('common.loading', 'Loading'))}…</p>`;
      container.append(loader);
      root.replaceChildren(container);
      return;
    }

    if (!policy || !draft) {
      container.append(
        EmptyState({
          title: t('admin_genie.load_failed', 'Popup effect settings are unavailable'),
          description: t(
            'admin_genie.load_failed_desc',
            'The setting could not be read. Popups keep using the built-in default until this loads.'
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
