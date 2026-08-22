/**
 * ModuleTargetingDrawer.js — Drawer for viewing and configuring module targeting rules (Prompt 3.2).
 */

import { Drawer } from '../ui/Drawer.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Select } from '../ui/Select.js';
import { Switch } from '../ui/Switch.js';
import { Badge } from '../ui/Badge.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';

export function openModuleTargetingDrawer({ module, trigger, onSuccess }) {
  const isBn = getLanguage() === 'bn';
  const moduleName = isBn ? (module.label_bn || module.label_en) : (module.label_en || module.label_bn);

  const container = document.createElement('div');
  container.className = 'module-drawer-form';

  const rulesListWrap = document.createElement('div');
  rulesListWrap.className = 'targeting-rules-list';

  let currentRules = [...(module.targeting_rules || [])];

  function renderRulesList() {
    rulesListWrap.innerHTML = '';
    if (currentRules.length === 0) {
      const emptyP = document.createElement('p');
      emptyP.className = 'text-sm text-muted';
      emptyP.textContent = t('modules.no_rules');
      rulesListWrap.append(emptyP);
      return;
    }

    for (const rule of currentRules) {
      const card = document.createElement('div');
      card.className = 'targeting-rule-card';

      const info = document.createElement('div');
      info.className = 'targeting-rule-card__info';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.gap = '8px';

      const title = document.createElement('span');
      title.className = 'targeting-rule-card__title';
      title.textContent = `${rule.target_type}: ${rule.target_value}`;

      const statusBadge = Badge({
        label: rule.is_enabled ? (isBn ? 'সক্রিয়' : 'Enabled') : (isBn ? 'নিষ্ক্রিয়' : 'Disabled'),
        variant: rule.is_enabled ? 'success' : 'neutral',
      });

      header.append(title, statusBadge);

      const val = document.createElement('span');
      val.className = 'targeting-rule-card__val';
      val.textContent = `${t('modules.rule_priority')}: ${rule.priority}`;

      info.append(header, val);

      const delBtn = Button({
        label: '🗑️',
        variant: 'ghost',
        size: 'sm',
        onClick: async () => {
          delBtn.setLoading(true);
          try {
            await api.delete(`/admin/targeting-rules/${rule.id}`);
            currentRules = currentRules.filter((r) => r.id !== rule.id);
            renderRulesList();
            toast.success(isBn ? 'নিয়মটি মুছে ফেলা হয়েছে' : 'Targeting rule deleted');
            if (onSuccess) onSuccess();
          } catch (err) {
            toast.error(err.message || t('common.error_generic'));
          } finally {
            delBtn.setLoading(false);
          }
        },
      });

      card.append(info, delBtn);
      rulesListWrap.append(card);
    }
  }

  renderRulesList();

  // Divider
  const hr = document.createElement('hr');
  hr.style.borderColor = 'var(--border-subtle)';

  // Add rule section
  const addTitle = document.createElement('h4');
  addTitle.className = 'text-sm font-semibold';
  addTitle.textContent = t('modules.add_rule');

  const typeSelect = Select({
    label: t('modules.rule_type'),
    value: 'DISTRICT',
    options: [
      { value: 'DISTRICT', label: 'DISTRICT (e.g. Dhaka, Sylhet)' },
      { value: 'TIER', label: 'TIER (STARTER, VERIFIED_TRADER, ELITE_PARTNER)' },
      { value: 'ROLE', label: 'ROLE (customer, saler, supplier, moderator)' },
      { value: 'USER', label: 'USER ID / Ref' },
      { value: 'PERCENTAGE', label: 'PERCENTAGE (1-100)' },
    ],
  });

  const valueInput = Input({
    label: t('modules.rule_value'),
    placeholder: 'e.g. Dhaka, 50, ELITE_PARTNER',
  });

  const enabledSwitch = Switch({
    label: t('modules.rule_enabled'),
    checked: true,
  });

  const addBtn = Button({
    label: t('modules.add_rule'),
    variant: 'secondary',
    onClick: async () => {
      const val = valueInput.value.trim();
      if (!val) {
        toast.error(isBn ? 'টার্গেট মান লিখুন' : 'Please enter a target value');
        return;
      }

      addBtn.setLoading(true);
      try {
        const res = await api.post(`/admin/modules/${module.key}/targeting`, {
          target_type: typeSelect.value,
          target_value: val,
          is_enabled: enabledSwitch.checked,
        });

        if (res.data) {
          currentRules.push(res.data);
          valueInput.value = '';
          renderRulesList();
          toast.success(isBn ? 'নতুন নিয়ম যুক্ত হয়েছে' : 'Targeting rule added');
          if (onSuccess) onSuccess();
        }
      } catch (err) {
        toast.error(err.message || t('common.error_generic'));
      } finally {
        addBtn.setLoading(false);
      }
    },
  });

  container.append(rulesListWrap, hr, addTitle, typeSelect, valueInput, enabledSwitch, addBtn);

  const closeBtn = Button({
    label: isBn ? 'বন্ধ করুন' : 'Close',
    variant: 'primary',
    onClick: () => drawer.closeDrawer(false),
  });

  const footer = document.createDocumentFragment();
  footer.append(closeBtn);

  const drawer = Drawer({
    title: t('modules.drawer_targeting_title', { name: moduleName }),
    content: container,
    footer,
    side: 'right',
    size: 'md',
  });

  document.body.append(drawer);
  drawer.openDrawer(trigger);
}
