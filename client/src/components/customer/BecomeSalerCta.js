/**
 * BecomeSalerCta.js — 1-Click Zero-Paperwork Saler Upgrade Component (Prompt 11.3 / idea §AL.3).
 *
 * Implements:
 * 1. Genuine 1-click upgrade provisioning saler role & virtual store in <3 seconds.
 * 2. High-contrast, low-literacy friendly visual presentation with clear value propositions.
 * 3. Immediate redirect to /saler/store-builder with zero paperwork.
 */

import { customerApi } from '../../services/customer.api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../ui/Button.js';
import { appStore, setMockRole } from '../../state/appStore.js';
import { defaultPermissionsForRole } from '../../config/permissions.mock.js';

export function BecomeSalerCta({ onUpgradeSuccess = null, onNavigate = null } = {}) {
  const container = document.createElement('div');
  container.className = 'become-saler-cta';

  container.innerHTML = `
    <div class="become-saler-cta__body">
      <div class="become-saler-cta__info">
        <div class="inline-flex items-center gap-2">
          <span class="badge badge--primary text-[10px] font-bold uppercase tracking-wider">
            ✨ ${t('customer.become_saler.badge', 'Zero-Capital Reseller Hub')}
          </span>
        </div>
        <h2 class="become-saler-cta__title">
          ${t('customer.become_saler.headline', 'Open Your Online Store in 1 Tap')} 🚀
        </h2>
        <p class="become-saler-cta__desc">
          ${t('customer.become_saler.subtext', 'Sell 100+ wholesale products under your own store name and earn 20-35% profit per order. Zero hassle packaging & shipping, with instant bKash/Bank cashouts.')}
        </p>

        <div class="become-saler-cta__benefits">
          <div class="become-saler-cta__benefit-item">
            <span class="text-primary font-bold">✓</span>
            <span>${t('customer.become_saler.benefit_1', 'Zero upfront capital required')}</span>
          </div>
          <div class="become-saler-cta__benefit-item">
            <span class="text-primary font-bold">✓</span>
            <span>${t('customer.become_saler.benefit_2', 'Suppliers pack & ship directly')}</span>
          </div>
          <div class="become-saler-cta__benefit-item">
            <span class="text-primary font-bold">✓</span>
            <span>${t('customer.become_saler.benefit_3', 'Instant bKash & Bank cashouts')}</span>
          </div>
        </div>
      </div>

      <div class="become-saler-cta__action-wrap">
        <div id="upgrade-action-slot"></div>
        <span class="text-[11px] text-muted font-medium text-center">
          ⚡ ${t('customer.become_saler.instant_note', '3-Second instant start · Zero paperwork')}
        </span>
      </div>
    </div>
  `;

  const actionSlot = container.querySelector('#upgrade-action-slot');
  let isUpgrading = false;

  const upgradeBtn = Button({
    label: `🚀 ${t('customer.become_saler.cta_btn', 'Click to Become a Saler')}`,
    variant: 'primary',
    size: 'lg',
    onClick: handleUpgrade,
  });

  actionSlot.append(upgradeBtn);

  async function handleUpgrade() {
    if (isUpgrading) return;
    isUpgrading = true;
    upgradeBtn.setLoading(true);
    upgradeBtn.setLabel(`⏳ ${t('customer.become_saler.btn_upgrading', 'Provisioning Storefront...')}`);

    try {
      const res = await customerApi.becomeSaler();
      const data = res.data || {};

      toast.success(data.message_bn || data.message_en || t('customer.become_saler.upgrade_success', 'Congratulations! Your digital store is active.'));

      // Elevate session to saler role
      try {
        if (typeof setMockRole === 'function') {
          setMockRole('saler');
        } else {
          const auth = appStore.get()?.auth || {};
          const salerPerms = defaultPermissionsForRole('saler');
          appStore.update({
            auth: {
              ...auth,
              isAuthenticated: true,
              role: 'saler',
              permissions: Array.from(new Set([...(auth.permissions || []), ...salerPerms])),
            },
          });
        }
      } catch {}

      if (typeof onUpgradeSuccess === 'function') {
        onUpgradeSuccess(data);
      }

      // 1-Click navigate to /saler/store-builder
      const targetUrl = data.redirect_url || '/saler/store-builder';
      if (typeof onNavigate === 'function') {
        onNavigate(targetUrl);
      } else {
        history.pushState({}, '', targetUrl);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    } catch (err) {
      toast.error(err.message || 'Upgrade failed. Please try again.');
      isUpgrading = false;
      upgradeBtn.setLoading(false);
      upgradeBtn.setLabel(`🚀 ${t('customer.become_saler.cta_btn', 'Click to Become a Saler')}`);
    }
  }

  return {
    element: container,
  };
}
