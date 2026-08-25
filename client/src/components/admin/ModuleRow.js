/**
 * ModuleRow.js — Individual module card row with optimistic toggle, targeting and settings (Prompt 3.2).
 */

import { Switch } from '../ui/Switch.js';
import { Button } from '../ui/Button.js';
import { Badge } from '../ui/Badge.js';
import { confirmDialogWithReason } from '../ui/ConfirmDialog.js';
import { openModuleSettingsDrawer } from './ModuleSettingsDrawer.js';
import { openModuleTargetingDrawer } from './ModuleTargetingDrawer.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatRelativeTime } from '../../services/format.js';

export function ModuleRow({
  module,
  isSuperAdmin = false,
  onToggle,
  onRefresh,
}) {
  const isBn = getLanguage() === 'bn';
  const label = isBn ? (module.label_bn || module.label_en) : (module.label_en || module.label_bn);
  const description = isBn ? (module.description_bn || module.description_en) : (module.description_en || module.description_bn);

  const row = document.createElement('div');
  row.className = 'module-row';
  row.dataset.moduleKey = module.key;

  // Main Info Column
  const main = document.createElement('div');
  main.className = 'module-row__main';

  const header = document.createElement('div');
  header.className = 'module-row__header';

  const labelEl = document.createElement('span');
  labelEl.className = 'module-row__label';
  labelEl.textContent = label;

  header.append(labelEl);

  if (module.risk_of_disabling === 'CRITICAL') {
    const riskBadge = Badge({ label: isBn ? 'গুরুত্বপূর্ণ' : 'Critical', variant: 'danger' });
    header.append(riskBadge);
  }

  const descEl = document.createElement('p');
  descEl.className = 'module-row__desc';
  descEl.textContent = description || '';

  const metaEl = document.createElement('div');
  metaEl.className = 'module-row__meta';

  if (module.last_reason) {
    metaEl.textContent = `${isBn ? 'সর্বশেষ কারণ' : 'Last reason'}: "${module.last_reason}"`;
  } else if (module.updated_at) {
    const timeAgo = formatRelativeTime(new Date(module.updated_at).getTime(), { lang: isBn ? 'bn' : 'en' });
    metaEl.textContent = t('modules.changed_by', { time: timeAgo, actor: module.updated_by ? `Admin #${module.updated_by}` : 'Admin' });
  } else {
    metaEl.textContent = t('modules.never_changed');
  }

  main.append(header, descEl, metaEl);

  // Actions Column
  const actions = document.createElement('div');
  actions.className = 'module-row__actions';

  // Targeting Indicator Badge
  const ruleCount = (module.targeting_rules || []).length;
  if (ruleCount > 0) {
    const targetBadge = document.createElement('button');
    targetBadge.type = 'button';
    targetBadge.className = 'module-row__target-badge';
    targetBadge.innerHTML = `🎯 <span>${t('modules.targeting_badge', { count: ruleCount })}</span>`;
    targetBadge.addEventListener('click', () => {
      openModuleTargetingDrawer({ module, trigger: targetBadge, onSuccess: onRefresh });
    });
    actions.append(targetBadge);
  } else if (isSuperAdmin) {
    const addTargetBtn = document.createElement('button');
    addTargetBtn.type = 'button';
    addTargetBtn.className = 'module-row__btn-icon';
    addTargetBtn.title = isBn ? 'টার্গেটিং কনফিগার' : 'Configure Targeting';
    addTargetBtn.setAttribute('aria-label', isBn ? 'টার্গেটিং কনফিগার' : 'Configure Targeting');
    addTargetBtn.textContent = '🎯';
    addTargetBtn.addEventListener('click', () => {
      openModuleTargetingDrawer({ module, trigger: addTargetBtn, onSuccess: onRefresh });
    });
    actions.append(addTargetBtn);
  }

  // Settings Button (if sub_settings_schema is present)
  if (module.settings_schema) {
    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'module-row__btn-icon';
    settingsBtn.title = t('modules.settings_btn');
    settingsBtn.setAttribute('aria-label', t('modules.settings_btn'));
    settingsBtn.textContent = '⚙️';
    settingsBtn.addEventListener('click', () => {
      openModuleSettingsDrawer({ module, trigger: settingsBtn, onSuccess: onRefresh });
    });
    actions.append(settingsBtn);
  }

  // State Switch
  const switchControl = Switch({
    checked: Boolean(module.is_enabled),
    disabled: !isSuperAdmin,
    onChange: async (newChecked) => {
      if (!isSuperAdmin) {
        switchControl.revert();
        return;
      }

      if (!newChecked) {
        // Toggling OFF requires mandatory reason
        const result = await confirmDialogWithReason({
          title: t('modules.confirm_disable_title', { name: label }),
          description: t('modules.confirm_disable_desc'),
          reasonRequired: true,
          reasonLabel: t('modules.reason_label'),
          reasonHint: t('modules.reason_hint'),
          trigger: switchControl,
        });

        if (!result || !result.confirmed || !result.reason || result.reason.trim().length < 10) {
          switchControl.revert();
          return;
        }

        switchControl.setPending(true);
        try {
          await onToggle(module, false, result.reason.trim(), false, switchControl);
        } catch {
          switchControl.revert();
        } finally {
          switchControl.setPending(false);
        }
      } else {
        // Toggling ON is immediate
        switchControl.setPending(true);
        try {
          await onToggle(module, true, 'Enabled by administrator', false, switchControl);
        } catch {
          switchControl.revert();
        } finally {
          switchControl.setPending(false);
        }
      }
    },
  });

  actions.append(switchControl);
  row.append(main, actions);

  return row;
}
