/**
 * ModuleSettingsDrawer.ts — Dynamic form generator from sub_settings_schema (Prompt 3.2).
 *
 * Automatically inspects JSON schema properties (boolean, integer, number, string, enum, array)
 * and creates corresponding accessible form controls.
 */

import { Drawer } from '../ui/Drawer.ts';
import { Button } from '../ui/Button.ts';
import { Input } from '../ui/Input.ts';
import { Select } from '../ui/Select.ts';
import { Switch } from '../ui/Switch.ts';
import { api } from '../../core/api.ts';
import { toast } from '../../services/toast.ts';
import { t, getLanguage } from '../../services/i18n.ts';

/** One property of a module's settings schema (JSON-schema subset). */
export interface SettingProperty {
  type?: 'boolean' | 'integer' | 'number' | 'string' | 'array' | string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

/** A platform module as GET /admin/modules sends it. */
export interface PlatformModule {
  key: string;
  label_en?: string;
  label_bn?: string;
  description_en?: string;
  description_bn?: string;
  is_enabled?: boolean;
  risk_of_disabling?: string;
  last_reason?: string;
  updated_at?: string;
  updated_by?: number | string;
  affected_routes?: string[];
  settings_schema?: { properties?: Record<string, SettingProperty> } | null;
  settings_json?: Record<string, unknown>;
  targeting_rules?: { target_type: string; target_value: string; is_enabled?: boolean; [field: string]: unknown }[];
}

export interface ModuleDrawerOptions {
  module: PlatformModule;
  trigger?: Element | null;
  onSuccess?: ((result?: unknown) => void) | null;
}

export function openModuleSettingsDrawer({ module, trigger, onSuccess }: ModuleDrawerOptions) {
  const isBn = getLanguage() === 'bn';
  const moduleName = isBn ? (module.label_bn || module.label_en) : (module.label_en || module.label_bn);

  const formContainer = document.createElement('div');
  formContainer.className = 'module-drawer-form';

  const schema = module.settings_schema || {};
  const properties: Record<string, SettingProperty> = schema.properties || {};
  const currentValues = { ...(module.settings_json || {}) };

  const fieldGetters: Record<string, () => unknown> = {};

  if (Object.keys(properties).length === 0) {
    const emptyNotice = document.createElement('p');
    emptyNotice.className = 'text-sm text-muted';
    emptyNotice.textContent = isBn ? 'এই মডিউলে কোনো কনফিগারযোগ্য সেটিংস নেই।' : 'This module has no configurable settings.';
    formContainer.append(emptyNotice);
  }

  for (const [propKey, propDef] of Object.entries(properties)) {
    const fieldWrap = document.createElement('div');
    fieldWrap.className = 'module-drawer-form__field';

    const fieldLabel = propKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const val = currentValues[propKey] !== undefined ? currentValues[propKey] : propDef.default;

    if (propDef.type === 'boolean') {
      const switchControl = Switch({
        label: fieldLabel,
        checked: Boolean(val),
      });
      fieldWrap.append(switchControl);
      fieldGetters[propKey] = () => switchControl.checked;
    } else if (propDef.enum && Array.isArray(propDef.enum)) {
      const selectControl = Select({
        label: fieldLabel,
        value: (val as string | number) ?? propDef.enum[0],
        options: propDef.enum.map((opt) => ({ value: opt, label: opt })),
      });
      fieldWrap.append(selectControl);
      fieldGetters[propKey] = () => selectControl.value;
    } else if (propDef.type === 'integer' || propDef.type === 'number') {
      const inputControl = Input({
        label: fieldLabel,
        type: 'number',
        value: val !== undefined ? String(val) : '',
        // @ts-expect-error Input (ui/Input.ts) has no min / max / step option and ignores them; they have never reached the DOM
        min: propDef.minimum,
        max: propDef.maximum,
        step: propDef.type === 'integer' ? '1' : 'any',
      });
      fieldWrap.append(inputControl);
      fieldGetters[propKey] = () => {
        const v = inputControl.value.trim();
        if (v === '') return propDef.default;
        return propDef.type === 'integer' ? parseInt(v, 10) : parseFloat(v);
      };
    } else if (propDef.type === 'array') {
      const arrayVal = Array.isArray(val) ? val.join(', ') : '';
      const inputControl = Input({
        label: `${fieldLabel} (comma separated)`,
        value: arrayVal,
        placeholder: 'e.g. item1, item2',
      });
      fieldWrap.append(inputControl);
      fieldGetters[propKey] = () => {
        const raw = inputControl.value.trim();
        if (!raw) return [];
        return raw.split(',').map((s) => s.trim()).filter(Boolean);
      };
    } else {
      const inputControl = Input({
        label: fieldLabel,
        type: 'text',
        value: val !== undefined ? String(val) : '',
      });
      fieldWrap.append(inputControl);
      fieldGetters[propKey] = () => inputControl.value.trim();
    }

    formContainer.append(fieldWrap);
  }

  const saveBtn = Button({
    label: isBn ? 'সংরক্ষণ করুন' : 'Save Settings',
    variant: 'primary',
    onClick: async () => {
      saveBtn.setLoading(true);
      try {
        const updatedSettings: Record<string, unknown> = {};
        for (const [k, getter] of Object.entries(fieldGetters)) {
          updatedSettings[k] = getter();
        }

        const res = await api.patch(`/admin/modules/${module.key}/settings`, {
          settings: updatedSettings,
        });

        toast.success(t('modules.settings_saved', { name: moduleName }));
        if (onSuccess) onSuccess(res.data);
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
    title: t('modules.drawer_settings_title', { name: moduleName }),
    content: formContainer,
    footer,
    side: 'right',
    size: 'md',
    removeOnClose: true,
  });

  document.body.append(drawer);
  drawer.openDrawer(trigger);
}
