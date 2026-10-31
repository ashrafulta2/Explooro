/**
 * SupplierFlashRulesCard — the limits a supplier's own flash sale must fit (migration 096).
 *
 * Shown on /admin/growth/campaigns, beside the deals it governs, behind growth.campaign.manage.
 * Configuration, not code: it writes `flash_sale.supplier_rules` in platform_settings through
 * PUT /admin/growth/campaigns/flash-sales/supplier-rules. The bounds come from the API (`limits`,
 * server RULE_LIMITS), never from this file. The save is strict (out of range is refused), needs a
 * reason, is audited, and a stale form gets a 409. A delegated admin's save goes for approval
 * (HIGH risk), which writeOutcome.ts reports as such rather than as done.
 *
 * Styles: inline layout over the shared tokens, so it adds nothing to the entry CSS.
 */
import { supplierFlashSaleApi, type RuleLimits, type SupplierFlashRules } from '../../services/supplierFlashSale.api.ts';
import { describeWriteOutcome } from '../../services/writeOutcome.ts';
import { pickMessage } from '../../core/api.ts';
import { toast } from '../../services/toast.ts';
import { Button } from '../ui/Button.ts';
import { t, getLanguage } from '../../services/i18n.ts';

const NUMBER_FIELDS = ['max_discount_pct', 'max_duration_hours', 'max_live_deals', 'min_listing_days'] as const;

export interface SupplierFlashRulesCardOptions {
  /** For the gallery: render these without calling the API. */
  initial?: { rules: SupplierFlashRules; limits: RuleLimits } | null;
}

export function SupplierFlashRulesCard({ initial = null }: SupplierFlashRulesCardOptions = {}): HTMLElement {
  const card = document.createElement('section');
  card.className = 'supplier-flash-rules';
  card.style.cssText = 'background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg, 12px); padding: 16px 18px; display: flex; flex-direction: column; gap: 12px;';

  let state = initial;

  function render() {
    card.replaceChildren();
    const title = document.createElement('h2');
    title.style.cssText = 'margin: 0; font-size: 15px; font-weight: 700; color: var(--text-primary);';
    title.textContent = t('admin_flash_rules.title');
    const intro = document.createElement('p');
    intro.style.cssText = 'margin: 0; font-size: 13px; color: var(--text-secondary);';
    intro.dataset.pageInfo = '';
    intro.textContent = t('admin_flash_rules.intro');
    card.append(title, intro);

    if (!state) {
      const loading = document.createElement('p');
      loading.style.cssText = 'margin: 0; font-size: 13px; color: var(--text-muted);';
      loading.textContent = t('admin_flash_rules.loading');
      card.append(loading);
      return;
    }

    const { rules, limits } = state;
    const form = document.createElement('form');
    form.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

    const enabledLabel = document.createElement('label');
    enabledLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-primary);';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = rules.enabled;
    enabledLabel.append(enabled, document.createTextNode(t('admin_flash_rules.enabled')));

    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 12px;';
    const inputs: Record<string, HTMLInputElement> = {};
    for (const key of NUMBER_FIELDS) {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--text-secondary);';
      const input = document.createElement('input');
      input.type = 'number';
      input.required = true;
      input.step = '1';
      input.min = String(limits[key].min);
      input.max = String(limits[key].max);
      input.value = String(rules[key]);
      input.style.cssText = 'min-height: 36px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: var(--radius-md, 8px); background: var(--surface-0); color: var(--text-primary); font: inherit;';
      inputs[key] = input;
      const hint = document.createElement('span');
      hint.style.cssText = 'font-weight: 400; color: var(--text-muted);';
      hint.textContent = t('admin_flash_rules.range', { min: limits[key].min, max: limits[key].max });
      wrap.append(document.createTextNode(t(`admin_flash_rules.field.${key}`)), input, hint);
      grid.append(wrap);
    }

    const reasonLabel = document.createElement('label');
    reasonLabel.style.cssText = 'display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--text-secondary);';
    const reason = document.createElement('input');
    reason.type = 'text';
    reason.required = true;
    reason.minLength = 10;
    reason.placeholder = t('admin_flash_rules.reason_placeholder');
    reason.style.cssText = inputs.max_discount_pct.style.cssText;
    reasonLabel.append(document.createTextNode(t('admin_flash_rules.reason')), reason);

    const save = Button({ label: t('admin_flash_rules.save'), type: 'submit', size: 'sm' });
    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; justify-content: flex-end;';
    actions.append(save);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      save.disabled = true;
      const next = { enabled: enabled.checked } as Omit<SupplierFlashRules, 'updated_at'>;
      for (const key of NUMBER_FIELDS) next[key] = Number(inputs[key].value);
      try {
        const res = await supplierFlashSaleApi.saveRules(next, reason.value.trim(), rules.updated_at ?? null);
        const outcome = describeWriteOutcome(res, {
          bn: getLanguage() === 'bn',
          fallback: t('admin_flash_rules.saved'),
          deferredFallback: t('admin_flash_rules.deferred'),
        });
        if (outcome.deferred) {
          toast.info(outcome.message);
          save.disabled = false;
          return;
        }
        toast.success(outcome.message);
        const body = res?.data ?? res;
        if (body?.rules) state = { rules: body.rules, limits: body.limits ?? limits };
        render();
      } catch (err) {
        toast.error(pickMessage(err) || t('admin_flash_rules.save_failed'));
        save.disabled = false;
      }
    });

    form.append(enabledLabel, grid, reasonLabel, actions);
    card.append(form);
  }

  render();
  if (!initial) {
    supplierFlashSaleApi.getRules()
      .then((res) => { state = res; render(); })
      .catch((err) => {
        const msg = document.createElement('p');
        msg.style.cssText = 'margin: 0; font-size: 13px; color: var(--danger-800, var(--text-primary));';
        msg.textContent = pickMessage(err) || t('admin_flash_rules.load_failed');
        card.append(msg);
      });
  }
  return card;
}
