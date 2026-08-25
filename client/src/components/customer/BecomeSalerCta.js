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
import { appStore } from '../../state/appStore.js';

export function BecomeSalerCta({ onUpgradeSuccess = null, onNavigate = null } = {}) {
  const container = document.createElement('div');
  container.className = 'become-saler-cta relative overflow-hidden rounded-3xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 via-surface to-primary/5 p-6 md:p-8 shadow-md';

  container.innerHTML = `
    <div class="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
      <div class="space-y-3 max-w-2xl">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 text-primary text-xs font-bold uppercase tracking-wider">
          <span>✨ ৳০ পুঁজিতে ব্যবসা</span>
          <span>·</span>
          <span>Zero Paperwork</span>
        </div>
        <h2 class="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight leading-tight">
          ${t('customer.become_saler.headline', '১ ক্লিকে নিজের অনলাইন দোকান খুলুন 🚀')}
        </h2>
        <p class="text-sm md:text-base text-muted leading-relaxed">
          ${t('customer.become_saler.subtext', 'হোলসেলের দামে ১০০+ সেরা পণ্য আপনার নামে বিক্রি করে প্রতি অর্ডারে ২০-৩৫% লাভ করুন। ডেলিভারি ও প্যাকেজিংয়ের ঝামেলা ছাড়াই সরাসরি বিকাশে টাকা তুলুন।')}
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div class="flex items-center gap-2 text-xs font-bold text-foreground">
            <span class="text-base text-emerald-500">✓</span>
            <span>${t('customer.become_saler.benefit_1', 'কোনো অগ্রিম পুঁজি লাগবে না')}</span>
          </div>
          <div class="flex items-center gap-2 text-xs font-bold text-foreground">
            <span class="text-base text-emerald-500">✓</span>
            <span>${t('customer.become_saler.benefit_2', 'সাপ্লায়ার নিজে ডেলিভারি করবে')}</span>
          </div>
          <div class="flex items-center gap-2 text-xs font-bold text-foreground">
            <span class="text-base text-emerald-500">✓</span>
            <span>${t('customer.become_saler.benefit_3', 'তাৎক্ষণিক বিকাশ ও ব্যাংক ক্যাশআউট')}</span>
          </div>
        </div>
      </div>

      <div class="flex flex-col sm:flex-row lg:flex-col items-center lg:items-end justify-center gap-3 shrink-0">
        <div id="upgrade-action-slot"></div>
        <span class="text-[11px] text-muted font-medium text-center">
          ${t('customer.become_saler.instant_note', '⚡ কোনো কাগজপত্র ছাড়াই ৩ সেকেন্ডে শুরু')}
        </span>
      </div>
    </div>

    <!-- Ambient Decorative Background Glow -->
    <div class="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-primary/10 blur-2xl pointer-events-none"></div>
  `;

  const actionSlot = container.querySelector('#upgrade-action-slot');
  let isUpgrading = false;

  const upgradeBtn = Button({
    label: `🚀 ${t('customer.become_saler.cta_btn', 'বিক্রেতা হতে ক্লিক করুন')}`,
    variant: 'primary',
    size: 'lg',
    className: 'px-8 py-4 text-base font-extrabold shadow-lg hover:shadow-primary/30 active:scale-95 transition-all',
    onClick: handleUpgrade,
  });

  actionSlot.append(upgradeBtn);

  async function handleUpgrade() {
    if (isUpgrading) return;
    isUpgrading = true;
    upgradeBtn.disabled = true;
    upgradeBtn.textContent = '⏳ Creating Storefront...';

    try {
      const res = await customerApi.becomeSaler();
      const data = res.data || {};

      toast.success(data.message_bn || data.message_en || 'বিক্রেতা হিসেবে অ্যাকাউন্ট তৈরি সম্পন্ন!');

      // Update auth store user roles if available
      try {
        const auth = appStore.get()?.auth;
        if (auth && auth.isAuthenticated) {
          appStore.update({
            auth: {
              ...auth,
              role: 'saler',
              permissions: [...(auth.permissions || []), 'saler.store.manage', 'saler.order.view'],
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
      upgradeBtn.disabled = false;
      upgradeBtn.textContent = `🚀 ${t('customer.become_saler.cta_btn', 'বিক্রেতা হতে ক্লিক করুন')}`;
    }
  }

  return {
    element: container,
  };
}
