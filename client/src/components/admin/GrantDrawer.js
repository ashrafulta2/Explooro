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
import { formatDate } from '../../services/format.js';

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
  let userId = user?.id;
  let userDisplayName = user ? (user.full_name || user.phone || `User #${user.id}`) : '';

  if (!user) {
    const userInput = Input({
      label: t('grants.select_user'),
      placeholder: t('grants.user_placeholder', 'User ID or phone number'),
      required: true,
      onInput: (e) => {
        userId = e.target.value.trim();
        userDisplayName = userId ? `User #${userId}` : t('grants.selected_user', 'the selected user');
        updatePreview();
      },
    });
    container.append(userInput);
  }

  // Permission selection (filter out CRITICAL per Prompt 2.5)
  const delegablePerms = permissions.filter((p) => p.risk_tier !== 'CRITICAL');
  const permOptions = delegablePerms.map((p) => ({
    value: p.key,
    label: `[${p.risk_tier}] ${isBn ? (p.label_bn || p.label_en) : (p.label_en || p.label_bn)}`,
  }));

  let selectedPerm = delegablePerms[0] || null;

  function permHint(perm) {
    if (!perm) return '';
    const plain = isBn ? (perm.plain_bn || perm.plain_en) : (perm.plain_en || perm.plain_bn);
    return [plain, perm.key].filter(Boolean).join(' — ');
  }

  const permSelect = Select({
    label: t('grants.select_perm'),
    value: selectedPerm?.key || '',
    options: permOptions,
    required: true,
    hint: permHint(selectedPerm),
    onChange: (val) => {
      selectedPerm = delegablePerms.find((p) => p.key === val) || null;
      permSelect.setHint(permHint(selectedPerm));
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

  // Scope input (optional)
  const scopeInput = Input({
    label: t('grants.scope_label'),
    placeholder: 'e.g. {"district": "Dhaka", "max_amount": 5000}',
    onInput: () => updatePreview(),
  });

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

    const scopeVal = scopeInput.value.trim();
    const scopeText = scopeVal ? (isBn ? ` (${scopeVal} সীমার মধ্যে)` : ` (within ${scopeVal})`) : '';

    // Built from text nodes, never innerHTML: the user field and the scope box are free text.
    const name = document.createElement('strong');
    name.textContent = userDisplayName || t('grants.selected_user', 'the selected user');

    const parts = isBn
      ? ['প্রিভিউ: ', name, ` ${formattedExpiry} পর্যন্ত এই পারমিশন পাবেন: ${permName}${scopeText}।`]
      : ['Preview: ', name, ` will be able to ${permName}${scopeText} until ${formattedExpiry}.`];
    previewText.replaceChildren(...parts);
  }

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

      if (!userId || !selectedPerm) {
        toast.error(t('grants.err_user_perm', 'Please specify a user and permission'));
        return;
      }

      const expiry = validateExpiry();
      if (!expiry) {
        expiryInput.focus();
        return;
      }

      let parsedScope = null;
      if (scopeInput.value.trim()) {
        try {
          parsedScope = JSON.parse(scopeInput.value.trim());
        } catch {
          parsedScope = { constraint: scopeInput.value.trim() };
        }
      }

      saveBtn.setLoading(true);
      try {
        await api.post('/admin/grants', {
          userId,
          permissionKey: selectedPerm.key,
          reason,
          expiresAt: expiry.toISOString(),
          scopeJson: parsedScope,
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
