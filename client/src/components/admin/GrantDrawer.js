/**
 * GrantDrawer.js — Drawer for issuing time-boxed standing grants with natural language preview (Prompt 3.3).
 */

import { Drawer } from '../ui/Drawer.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Select } from '../ui/Select.js';
import { Textarea } from '../ui/Textarea.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate, formatCurrency, normaliseBdPhone } from '../../services/format.js';
import { scopeFieldsFor } from '../../config/grant-scopes.js';

const MAX_GRANT_DAYS = 90;
const DEFAULT_GRANT_DAYS = 14;
const MIN_REASON_LENGTH = 10;

const CLIPBOARD_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
  'stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>' +
  '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path></svg>';

/** `YYYY-MM-DD` in the operator's LOCAL calendar — `toISOString()` is UTC and is a day off for
 * anyone east of Greenwich in the early morning (Bangladesh is UTC+6), which moved `min` to yesterday. */
function toLocalDateInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** A grant runs THROUGH the chosen day, so it expires at the end of it, in local time. */
function endOfLocalDay(dateInputValue) {
  const [y, m, d] = dateInputValue.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 0);
}

/** "Access live revenue…" reads wrongly after "will be able to"; keep acronyms (KPIs) intact. */
function lowerFirst(text) {
  if (!text) return text;
  const second = text.charAt(1);
  if (second && second === second.toUpperCase() && second !== second.toLowerCase()) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function openGrantDrawer({ user = null, permissions = [], trigger = null, onSuccess = null }) {
  const isBn = getLanguage() === 'bn';
  const lang = isBn ? 'bn' : 'en';

  const container = document.createElement('div');
  container.className = 'module-drawer-form';

  // Target user display or input
  let userId = user?.id ?? null;
  let userDisplayName = user ? (user.full_name || user.phone || `User #${user.id}`) : '';
  let userInput = null;
  let lookupSeq = 0;

  // WHY resolve instead of sending the typed text: the field invites "ID or phone number", but the
  // API takes a numeric user_id — "01711000004" was coerced to the integer 1711000004 and the grant
  // landed on the wrong account or failed on the foreign key.
  async function resolveUser(text) {
    const phone = normaliseBdPhone(text);
    if (!phone && /^\d+$/.test(text)) {
      try {
        const res = await api.get(`/admin/users/${text}`);
        return res.user ? [res.user] : [];
      } catch {
        return [];
      }
    }
    const res = await api.get('/admin/users', { query: { q: phone || text, limit: 5 } });
    const users = res.users || [];
    const exact = users.filter((u) =>
      (phone && normaliseBdPhone(u.phone) === phone) || String(u.ref || '').toLowerCase() === text.toLowerCase()
    );
    return exact.length ? exact : users;
  }

  async function lookupUser() {
    const text = userInput.value.trim();
    const seq = ++lookupSeq;
    userId = null;
    userDisplayName = '';
    if (!text) {
      userInput.setError('');
      updatePreview();
      return false;
    }
    let matches = [];
    try {
      matches = await resolveUser(text);
    } catch {
      matches = [];
    }
    if (seq !== lookupSeq) return false; // a newer keystroke superseded this lookup
    if (matches.length === 1) {
      const [match] = matches;
      userId = Number(match.id);
      userDisplayName = match.full_name || match.display_name || match.phone || match.ref;
      userInput.setError('');
      userInput.setHint(`${userDisplayName} · ${match.ref || ''}`);
    } else {
      userInput.setHint('');
      userInput.setError(matches.length
        ? t('grants.err_user_ambiguous', 'Several people match. Enter the exact user ID, ref or phone number.')
        : t('grants.err_user_not_found', 'No user matches that ID, ref or phone number.'));
    }
    updatePreview();
    return userId !== null;
  }

  if (!user) {
    userInput = Input({
      label: t('grants.select_user'),
      placeholder: t('grants.user_placeholder', 'User ID or phone number'),
      required: true,
      onInput: () => {
        userId = null;
        userInput.setError('');
        userInput.setHint('');
      },
    });
    userInput.input.addEventListener('blur', () => { lookupUser(); });
    container.append(userInput);
  }

  // Permission selection (filter out CRITICAL per Prompt 2.5)
  const delegablePerms = permissions.filter((p) => p.risk_tier !== 'CRITICAL');
  // WHY no "[HIGH]" prefix: that was the raw enum, in English, in both languages.
  const permOptions = delegablePerms.map((p) => ({
    value: p.key,
    label: `${isBn ? (p.label_bn || p.label_en) : (p.label_en || p.label_bn)} · ${t(`grants.risk.${p.risk_tier}`, p.risk_tier)}`,
  }));

  let selectedPerm = delegablePerms[0] || null;

  function permHint(perm) {
    if (!perm) return '';
    return isBn ? (perm.plain_bn || perm.plain_en || '') : (perm.plain_en || perm.plain_bn || '');
  }

  const permSelect = Select({
    label: t('grants.select_perm'),
    value: selectedPerm?.key || '',
    options: permOptions,
    required: true,
    hint: permHint(selectedPerm),
    // WHY e.target.value: Select passes the change Event, not the value. Matching the Event against
    // keys left selectedPerm null after ANY change, so picking a permission made Issue Grant fail.
    onChange: (e) => {
      const val = e?.target ? e.target.value : e;
      selectedPerm = delegablePerms.find((p) => p.key === val) || null;
      saveBtn.setDisabled?.(!selectedPerm);
      permSelect.setHint(permHint(selectedPerm));
      syncScopeField();
      updatePreview();
    },
  });

  // Nothing to choose from — say so instead of showing an empty dropdown that fails on submit.
  if (!selectedPerm) {
    permSelect.setError(t('grants.no_permissions', 'No delegable permissions are available to grant.'));
  }

  // Expiry date (max 90 days)
  const now = new Date();
  const minDate = toLocalDateInput(now);
  const maxDate = toLocalDateInput(addDays(now, MAX_GRANT_DAYS));

  const expiryInput = Input({
    label: t('grants.expiry_label'),
    type: 'date',
    value: toLocalDateInput(addDays(now, DEFAULT_GRANT_DAYS)),
    required: true,
    onInput: () => {
      expiryInput.setError('');
      updatePreview();
    },
  });
  expiryInput.input.min = minDate;
  expiryInput.input.max = maxDate;

  // Scope (optional). WHY a typed field per supported permission instead of a free JSON box: the
  // server enforces only the scopes in config/grant-scopes.js, and a hand-typed JSON limit it can't
  // check (or a typo it used to store as {"constraint": …}) reads as a safety net that isn't there.
  const scopeInput = Input({
    label: t('grants.scope_max_amount_label', 'Limit: largest amount per approval (Tk, optional)'),
    hint: t('grants.scope_max_amount_hint', 'Leave empty for no limit. Anything above this is refused.'),
    type: 'number',
    inputmode: 'decimal',
    placeholder: '50000',
    onInput: () => {
      scopeInput.setError('');
      updatePreview();
    },
  });
  scopeInput.input.min = '1';
  scopeInput.input.step = '0.01';

  function scopeSupported() {
    return Boolean(selectedPerm && scopeFieldsFor(selectedPerm.key)?.max_amount);
  }

  function syncScopeField() {
    scopeInput.hidden = !scopeSupported();
    if (scopeInput.hidden) {
      scopeInput.value = '';
      scopeInput.setError('');
    }
  }

  /** `undefined` = invalid (error shown), `null` = no scope, otherwise the scope object. */
  function readScope() {
    if (!scopeSupported()) return null;
    const raw = scopeInput.value.trim();
    if (!raw) return null;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      scopeInput.setError(t('grants.err_scope_amount', 'Enter an amount greater than zero, or leave it empty.'));
      return undefined;
    }
    return { max_amount: Math.round(amount * 100) / 100 };
  }

  // Mandatory reason
  const reasonTextarea = Textarea({
    label: t('grants.reason_label'),
    placeholder: t('grants.reason_placeholder'),
    required: true,
    rows: 3,
    onInput: () => reasonTextarea.setError(''),
  });

  // Live Delegation Preview Box
  const previewBox = document.createElement('div');
  previewBox.className = 'grant-preview-box';
  previewBox.setAttribute('role', 'status');
  previewBox.setAttribute('aria-live', 'polite');

  const previewIcon = document.createElement('span');
  previewIcon.className = 'grant-preview-box__icon';
  previewIcon.setAttribute('aria-hidden', 'true');
  previewIcon.innerHTML = CLIPBOARD_ICON;

  const previewText = document.createElement('span');
  previewText.className = 'grant-preview-box__text';
  previewBox.append(previewIcon, previewText);

  function updatePreview() {
    const expiryValue = expiryInput.value;
    const expiry = expiryValue ? endOfLocalDay(expiryValue) : addDays(now, DEFAULT_GRANT_DAYS);
    const formattedExpiry = Number.isNaN(expiry.getTime()) ? '—' : formatDate(expiry.getTime(), { lang });

    const rawPerm = selectedPerm
      ? (isBn ? (selectedPerm.plain_bn || selectedPerm.label_bn) : (selectedPerm.plain_en || selectedPerm.label_en))
      : '';
    const permName = rawPerm
      ? (isBn ? rawPerm : lowerFirst(rawPerm))
      : t('grants.preview_fallback_action', 'perform actions');

    const scopeAmount = scopeSupported() ? Number(scopeInput.value.trim()) : NaN;
    const scopeText = scopeAmount > 0
      ? ` ${t('grants.preview_scope', '(up to {{amount}} each)', { amount: formatCurrency(scopeAmount, { lang }) })}`
      : '';

    // Built from text nodes, never innerHTML: the user field and the scope box are free text.
    const name = document.createElement('strong');
    name.textContent = userDisplayName || t('grants.selected_user', 'the selected user');

    const parts = isBn
      ? ['প্রিভিউ: ', name, ` ${formattedExpiry} পর্যন্ত এই পারমিশন পাবেন: ${permName}${scopeText}।`]
      : ['Preview: ', name, ` will be able to ${permName}${scopeText} until ${formattedExpiry}.`];
    previewText.replaceChildren(...parts);
  }

  syncScopeField();
  updatePreview();

  container.append(permSelect, expiryInput, scopeInput, reasonTextarea, previewBox);

  // Returns the validated expiry Date, or null after flagging the field.
  function validateExpiry() {
    const value = expiryInput.value;
    if (!value) {
      expiryInput.setError(t('grants.err_expiry_required', 'Choose an expiration date.'));
      return null;
    }
    const expiry = endOfLocalDay(value);
    const latest = endOfLocalDay(maxDate);
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() < Date.now()) {
      expiryInput.setError(t('grants.err_expiry_past', 'The expiration date must be today or later.'));
      return null;
    }
    if (expiry.getTime() > latest.getTime()) {
      expiryInput.setError(t('grants.err_expiry_max', { days: MAX_GRANT_DAYS }));
      return null;
    }
    return expiry;
  }

  const saveBtn = Button({
    label: t('grants.btn_issue', 'Issue Grant'),
    variant: 'primary',
    disabled: !selectedPerm,
    onClick: async () => {
      const reason = reasonTextarea.value.trim();
      if (reason.length < MIN_REASON_LENGTH) {
        reasonTextarea.setError(t('grants.err_reason_short', { min: MIN_REASON_LENGTH }));
        reasonTextarea.focus();
        return;
      }

      if (userInput && userId === null && !(await lookupUser())) {
        userInput.focus();
        return;
      }
      if (!userId || !selectedPerm) {
        toast.error(t('grants.err_user_perm', 'Please specify a user and permission'));
        return;
      }

      const expiry = validateExpiry();
      if (!expiry) {
        expiryInput.focus();
        return;
      }

      const scope = readScope();
      if (scope === undefined) {
        scopeInput.focus();
        return;
      }

      saveBtn.setLoading(true);
      try {
        // WHY snake_case: the route schema is `additionalProperties: false` with snake_case
        // required fields, so the camelCase body this used to send was a 400 on the live API.
        await api.post('/admin/grants', {
          user_id: Number(userId),
          permission_key: selectedPerm.key,
          reason,
          expires_at: expiry.toISOString(),
          scope_json: scope,
        });

        toast.success(t('grants.issued', 'Standing grant issued successfully'));
        if (onSuccess) onSuccess();
        drawer.closeDrawer(true);
      } catch (err) {
        toast.error((isBn ? err.message_bn : err.message_en) || err.message || t('common.error_generic'));
      } finally {
        saveBtn.setLoading(false);
      }
    },
  });

  const cancelBtn = Button({
    label: t('common.cancel', 'Cancel'),
    variant: 'ghost',
    onClick: () => drawer.closeDrawer(false),
  });

  const footer = document.createDocumentFragment();
  footer.append(cancelBtn, saveBtn);

  const drawer = Drawer({
    title: t('grants.drawer_title'),
    content: container,
    footer,
    side: 'right',
    size: 'md',
    // WHY: each open used to leave a closed <dialog> (and its form) behind in <body> for good.
    onClose: () => drawer.remove(),
  });

  document.body.append(drawer);
  drawer.openDrawer(trigger);
}
