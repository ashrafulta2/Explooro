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

export function openGrantDrawer({ user = null, permissions = [], trigger = null, onSuccess = null }) {
  const isBn = getLanguage() === 'bn';

  const container = document.createElement('div');
  container.className = 'module-drawer-form';

  // Target user display or input
  let userId = user?.id;
  let userDisplayName = user ? (user.full_name || user.phone || `User #${user.id}`) : '';

  if (!user) {
    const userInput = Input({
      label: t('grants.select_user'),
      placeholder: 'User ID or Phone number',
      onInput: (e) => {
        userId = e.target.value.trim();
        userDisplayName = userId ? `User #${userId}` : 'Selected user';
        updatePreview();
      },
    });
    container.append(userInput);
  }

  // Permission selection (filter out CRITICAL per Prompt 2.5)
  const delegablePerms = permissions.filter((p) => p.risk_tier !== 'CRITICAL');
  const permOptions = delegablePerms.map((p) => ({
    value: p.key,
    label: `[${p.risk_tier}] ${isBn ? (p.label_bn || p.label_en) : (p.label_en || p.label_bn)} (${p.key})`,
  }));

  let selectedPerm = delegablePerms[0] || null;

  const permSelect = Select({
    label: t('grants.select_perm'),
    value: selectedPerm?.key || '',
    options: permOptions,
    onChange: (val) => {
      selectedPerm = delegablePerms.find((p) => p.key === val) || null;
      updatePreview();
    },
  });

  // Expiry date (max 90 days)
  const now = new Date();
  const maxDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const defaultDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const expiryInput = Input({
    label: t('grants.expiry_label'),
    type: 'date',
    value: defaultDate.toISOString().split('T')[0],
    min: now.toISOString().split('T')[0],
    max: maxDate.toISOString().split('T')[0],
    onInput: () => updatePreview(),
  });

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
  });

  // Live Delegation Preview Box
  const previewBox = document.createElement('div');
  previewBox.className = 'grant-preview-box';

  function updatePreview() {
    const dateVal = expiryInput.value ? new Date(expiryInput.value) : defaultDate;
    const formattedExpiry = formatDate(dateVal.getTime(), { lang: isBn ? 'bn' : 'en' });
    const permName = selectedPerm
      ? (isBn ? (selectedPerm.plain_bn || selectedPerm.label_bn) : (selectedPerm.plain_en || selectedPerm.label_en))
      : 'perform actions';

    const scopeVal = scopeInput.value.trim();
    let scopeText = '';
    if (scopeVal) {
      scopeText = isBn ? ` (${scopeVal} সীমার মধ্যে)` : ` (within ${scopeVal})`;
    }

    if (isBn) {
      previewBox.textContent = `📋 প্রিভিউ: ${userDisplayName} ${formattedExpiry} পর্যন্ত ${permName}${scopeText} করতে সক্ষম হবেন।`;
    } else {
      previewBox.textContent = `📋 Preview: ${userDisplayName} will be able to ${permName}${scopeText} until ${formattedExpiry}.`;
    }
  }

  updatePreview();

  container.append(permSelect, expiryInput, scopeInput, reasonTextarea, previewBox);

  const saveBtn = Button({
    label: isBn ? 'গ্রান্ট প্রদান করুন' : 'Issue Grant',
    variant: 'primary',
    onClick: async () => {
      const reason = reasonTextarea.value.trim();
      if (reason.length < 10) {
        toast.error(isBn ? 'কমপক্ষে ১০ অক্ষরের কারণ প্রদান বাধ্যতামূলক' : 'A justification of at least 10 characters is mandatory');
        return;
      }

      if (!userId || !selectedPerm) {
        toast.error(isBn ? 'ব্যবহারকারী এবং পারমিশন নির্বাচন করুন' : 'Please specify a user and permission');
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
          expiresAt: new Date(expiryInput.value).toISOString(),
          scopeJson: parsedScope,
        });

        toast.success(isBn ? 'স্ট্যান্ডিং গ্রান্ট সফলভাবে প্রদান করা হয়েছে' : 'Standing grant issued successfully');
        if (onSuccess) onSuccess();
        drawer.closeDrawer(true);
      } catch (err) {
        toast.error(err.message || t('common.error_generic'));
      } finally {
        saveBtn.setLoading(false);
      }
    },
  });

  const cancelBtn = Button({
    label: isBn ? 'বাতিল' : 'Cancel',
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
  });

  document.body.append(drawer);
  drawer.openDrawer(trigger);
}
