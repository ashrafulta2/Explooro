/**
 * TeamPurchaseModal.js — Social Group Buying & Team Purchases Modal (Prompt 9.5).
 *
 * Allows shoppers on ProductDetailPage to:
 * 1. View active group-buying pools for this product and join immediately to unlock instant discounts.
 * 2. Start a new team purchase (2 or 3 members), customize shipping, and launch a viral team link.
 * 3. Integrates with Fastify POST /team-purchases & /team-purchases/:id/join and navigates to /team/:id.
 */

import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { api } from '../../core/api.js';
import { appStore } from '../../state/appStore.js';
import { getCurrentUser } from '../../services/session.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { resolveProductImage } from './ProductCard.js';

export function openTeamPurchaseModal({
  product,
  selectedVariant = null,
  navigate = null,
} = {}) {
  if (!product) return null;

  const isBn = getLanguage() === 'bn';
  const currentUser = getCurrentUser();
  const retailPrice = Number(
    selectedVariant?.price_override ??
    product.price ??
    product.pricing?.retail_price ??
    product.default_retail_price ??
    product.retail_price ??
    0
  );

  // Discount options: 2 members = 15% discount, 3 members = 25% discount
  let selectedMembers = 3;
  let activeTeams = [];
  let isLoadingTeams = true;
  let timerInterval = null;

  const contentEl = document.createElement('div');
  contentEl.className = 'team-purchase-modal';

  const modal = Modal({
    title: isBn ? 'সোশ্যাল গ্রুপ বাই ও টিম পারচেজ' : 'Social Group Buying & Team Purchase',
    content: contentEl,
    size: 'lg',
    showClose: true,
  });

  function calcGroupPrice(members) {
    const discountPct = members === 2 ? 0.15 : 0.25;
    return Math.max(1, Math.round(retailPrice * (1 - discountPct)));
  }

  function calcSavings(members) {
    return Math.max(0, retailPrice - calcGroupPrice(members));
  }

  function formatCountdown(remainingSeconds) {
    if (remainingSeconds <= 0) return isBn ? 'মেয়াদ উত্তীর্ণ' : 'Expired';
    const hrs = Math.floor(remainingSeconds / 3600);
    const mins = Math.floor((remainingSeconds % 3600) / 60);
    const secs = remainingSeconds % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  async function loadActiveTeams() {
    isLoadingTeams = true;
    try {
      const res = await api.get(`/team-purchases?product_id=${product.id}`).catch(() => null);
      const list = res?.team_purchases || res?.data?.team_purchases || [];
      activeTeams = list.filter((tp) => tp.status === 'ACTIVE' && tp.current_members_count < tp.required_members);
    } catch {
      activeTeams = [];
    } finally {
      isLoadingTeams = false;
      render();
    }
  }

  function render() {
    contentEl.innerHTML = '';

    const title = isBn && product.title_bn ? product.title_bn : (product.title_en || product.title || 'Product');
    const imageUrl = product.primary_image_url || product.image_url || product.images?.[0]?.url || resolveProductImage(product) || '/placeholder.svg';
    const currentGroupPrice = calcGroupPrice(selectedMembers);
    const currentSavings = calcSavings(selectedMembers);
    const discountPct = selectedMembers === 2 ? 15 : 25;

    // 1. Product Snapshot & Deal Highlight Header
    const header = document.createElement('div');
    header.className = 'team-purchase-modal__product-header';
    header.innerHTML = `
      <div class="team-purchase-modal__thumb">
        <img src="${imageUrl}" alt="${title}" onerror="this.src='/placeholder.svg'" />
      </div>
      <div class="team-purchase-modal__info">
        <div class="flex items-center gap-2">
          <span class="badge badge--primary text-[10px] font-bold uppercase tracking-wider">
            👥 ${isBn ? 'গ্রুপ বাই ডিল' : 'Group Buying Deal'}
          </span>
          <span class="badge badge--success text-[10px] font-bold">
            ${isBn ? `${discountPct}% সাশ্রয়` : `Save ${discountPct}%`}
          </span>
        </div>
        <h4 class="team-purchase-modal__title mt-1">${title}</h4>
        <div class="team-purchase-modal__price-row">
          <span class="team-purchase-modal__team-price">${formatCurrency(currentGroupPrice)}</span>
          <span class="team-purchase-modal__original-price">${formatCurrency(retailPrice)}</span>
          <span class="text-xs font-semibold text-emerald-700 ml-1">
            (${isBn ? `${formatCurrency(currentSavings)} সাশ্রয়` : `Save ${formatCurrency(currentSavings)}`})
          </span>
        </div>
      </div>
    `;
    contentEl.append(header);

    // 2. Active Teams Pool Section (Join immediately)
    const activeSection = document.createElement('div');
    activeSection.className = 'team-purchase-modal__section';

    const activeHeading = document.createElement('h5');
    activeHeading.className = 'team-purchase-modal__section-title';
    activeHeading.textContent = isBn ? '⚡ সরাসরি টিমে যুক্ত হয়ে দ্রুত সাশ্রয় করুন' : '⚡ Join an Active Team for Instant Discount';
    activeSection.append(activeHeading);

    if (isLoadingTeams) {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'p-3 text-xs text-secondary text-center';
      loadingEl.textContent = isBn ? 'চলমান টিম লোড হচ্ছে…' : 'Checking for active teams…';
      activeSection.append(loadingEl);
    } else if (activeTeams.length > 0) {
      const listEl = document.createElement('div');
      listEl.className = 'team-purchase-modal__active-list';

      activeTeams.forEach((team) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'team-purchase-modal__active-item';

        const hostMember = team.members?.[0] || { user_name: 'Verified Buyer' };
        const current = team.current_members_count || team.members?.length || 1;
        const required = team.required_members || 3;
        const remainingSec = team.remaining_seconds || 3600;

        itemEl.innerHTML = `
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-full bg-brand-100 text-brand-700 font-bold text-xs flex items-center justify-center shrink-0 border border-brand-200">
              ${(hostMember.user_name || 'H').charAt(0).toUpperCase()}
            </div>
            <div class="min-w-0">
              <div class="text-xs font-bold text-primary truncate">${hostMember.user_name || 'Team Host'}</div>
              <div class="text-[11px] text-muted flex items-center gap-1.5 font-mono">
                <span class="text-amber-600 font-bold">${isBn ? `বাকি ${required - current} জন` : `${required - current} spot left`}</span>
                <span>·</span>
                <span>⏱️ ${formatCountdown(remainingSec)}</span>
              </div>
            </div>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            <button type="button" class="btn btn--primary btn--sm font-bold btn-join-active-team" data-team-id="${team.id}">
              ${isBn ? 'টিমে যুক্ত হন' : 'Join Team'}
            </button>
          </div>
        `;

        itemEl.querySelector('.btn-join-active-team').addEventListener('click', () => {
          modal.close();
          if (navigate) {
            navigate(`/team/${team.id}`);
          } else {
            window.location.href = `/team/${team.id}`;
          }
        });

        listEl.append(itemEl);
      });

      activeSection.append(listEl);
    } else {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'p-3 bg-surface-2 rounded-lg border border-subtle text-xs text-secondary text-center';
      emptyEl.textContent = isBn
        ? 'বর্তমানে এই পণ্যে কোনো খোলা টিম নেই। নিচে নতুন টিম শুরু করে বন্ধুদের আমন্ত্রণ জানান!'
        : 'No open teams currently waiting. Start your own team below and invite friends!';
      activeSection.append(emptyEl);
    }

    contentEl.append(activeSection);

    // 3. Start a New Team Section
    const startSection = document.createElement('div');
    startSection.className = 'team-purchase-modal__section';

    const startHeading = document.createElement('h5');
    startHeading.className = 'team-purchase-modal__section-title';
    startHeading.textContent = isBn ? '🚀 অথবা নতুন টিম শুরু করুন (২৪ ঘণ্টা সময়)' : '🚀 Or Start a New Team (24h Window)';
    startSection.append(startHeading);

    // Size Selector
    const sizeSelector = document.createElement('div');
    sizeSelector.className = 'team-purchase-modal__size-selector';

    const size2Option = document.createElement('div');
    size2Option.className = `team-purchase-modal__size-option ${selectedMembers === 2 ? 'team-purchase-modal__size-option--active' : ''}`;
    size2Option.innerHTML = `
      <div class="font-bold text-xs">${isBn ? '২ জনের টিম' : '2-Member Team'}</div>
      <div class="text-sm font-extrabold text-primary mt-0.5">${formatCurrency(calcGroupPrice(2))}</div>
      <div class="text-[10px] text-emerald-700 font-semibold">${isBn ? '১৫% ছাড়' : '15% OFF'}</div>
    `;
    size2Option.addEventListener('click', () => {
      selectedMembers = 2;
      render();
    });

    const size3Option = document.createElement('div');
    size3Option.className = `team-purchase-modal__size-option ${selectedMembers === 3 ? 'team-purchase-modal__size-option--active' : ''}`;
    size3Option.innerHTML = `
      <div class="font-bold text-xs">${isBn ? '৩ জনের টিম (সেরা ডিল)' : '3-Member Team (Best Deal)'}</div>
      <div class="text-sm font-extrabold text-primary mt-0.5">${formatCurrency(calcGroupPrice(3))}</div>
      <div class="text-[10px] text-emerald-700 font-semibold">${isBn ? '২৫% ছাড়' : '25% OFF'}</div>
    `;
    size3Option.addEventListener('click', () => {
      selectedMembers = 3;
      render();
    });

    sizeSelector.append(size2Option, size3Option);
    startSection.append(sizeSelector);

    // Form inputs for Initiator
    const form = document.createElement('form');
    form.className = 'space-y-3 mt-3';
    form.innerHTML = `
      <div>
        <label class="block text-[11px] font-bold text-secondary uppercase mb-1">
          ${isBn ? 'আপনার ডেলিভারি ঠিকানা' : 'Your Shipping Address'}
        </label>
        <input
          type="text"
          name="address"
          required
          value="${currentUser?.address || currentUser?.address_line || 'House 45, Road 7, Dhanmondi, Dhaka'}"
          class="input input--sm w-full" />
      </div>

      <div>
        <label class="block text-[11px] font-bold text-secondary uppercase mb-1">
          ${isBn ? 'পেমেন্ট পদ্ধতি' : 'Payment Method'}
        </label>
        <select name="payment_method" class="input input--sm w-full font-medium">
          <option value="COD">Cash on Delivery (Pay on Complete)</option>
          <option value="BKASH">bKash Authorization Hold</option>
          <option value="NAGAD">Nagad Authorization Hold</option>
          <option value="WALLET">Explooro Earner Vault</option>
        </select>
        <p class="text-[11px] text-muted mt-1">
          🛡️ ${isBn ? 'টিম পূর্ণ না হওয়া পর্যন্ত কোনো চার্জ হবে না। ২৪ ঘণ্টায় টিম পূর্ণ না হলে স্বয়ংক্রিয়ভাবে বাতিল হবে।' : 'Zero upfront charges. If the team does not complete within 24 hours, the hold is 100% released.'}
        </p>
      </div>

      <div class="pt-2">
        <button type="submit" class="btn btn--primary btn--md w-full font-bold" id="btn-submit-new-team">
          ${isBn ? `টিম পারচেজ শুরু করুন (${formatCurrency(currentGroupPrice)})` : `Start Team Purchase (${formatCurrency(currentGroupPrice)})`}
        </button>
      </div>
    `;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { auth } = appStore.get();
      if (!auth?.isAuthenticated) {
        toast.info(isBn ? 'টিম শুরু করতে অনুগ্রহ করে সাইন ইন করুন।' : 'Please sign in to start a team purchase.');
        modal.close();
        if (navigate) {
          navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
        } else {
          window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
        }
        return;
      }

      const submitBtn = form.querySelector('#btn-submit-new-team');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = isBn ? 'টিম তৈরি হচ্ছে…' : 'Creating Team…';
      }

      const formData = new FormData(form);
      const address = formData.get('address');
      const paymentMethod = formData.get('payment_method');

      try {
        const res = await api.post('/team-purchases', {
          product_id: product.id,
          product_slug: product.slug,
          product_name_en: product.title_en || product.title,
          product_name_bn: product.title_bn || product.title,
          product_image_url: imageUrl,
          original_price: retailPrice,
          group_price: currentGroupPrice,
          required_members: selectedMembers,
          shipping_address: { street: address },
          payment_method: paymentMethod,
        });

        const createdTeam = res?.team || res?.data?.team || res;
        const targetId = createdTeam?.id || createdTeam?.ref || 1;

        toast.success(
          isBn
            ? 'টিম পারচেজ সফলভাবে শুরু হয়েছে! বন্ধুদের আমন্ত্রণ জানান।'
            : 'Team purchase started! Invite friends to unlock your discount.'
        );

        modal.close();

        if (navigate) {
          navigate(`/team/${targetId}`);
        } else {
          window.location.href = `/team/${targetId}`;
        }
      } catch (err) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = isBn ? 'আবার চেষ্টা করুন' : 'Try Again';
        }
        toast.error(err.message || (isBn ? 'টিম তৈরি করতে ব্যর্থ হয়েছে।' : 'Failed to create team purchase.'));
      }
    });

    startSection.append(form);
    contentEl.append(startSection);

    // 4. Footer link to /account/team-purchases
    const footerLinks = document.createElement('div');
    footerLinks.className = 'team-purchase-modal__footer-links';
    footerLinks.innerHTML = `
      <a href="/account/team-purchases" class="text-xs text-primary font-bold hover:underline" id="modal-view-my-teams">
        ${isBn ? 'আমার সকল টিম পারচেজ ও ট্র্যাকিং →' : 'View all my team purchases & tracking →'}
      </a>
      <span class="text-[11px] text-muted font-mono">24h SLA Escrow</span>
    `;

    footerLinks.querySelector('#modal-view-my-teams').addEventListener('click', (e) => {
      e.preventDefault();
      modal.close();
      if (navigate) {
        navigate('/account/team-purchases');
      } else {
        window.location.href = '/account/team-purchases';
      }
    });

    contentEl.append(footerLinks);
  }

  render();
  loadActiveTeams();

  timerInterval = setInterval(() => {
    let hasTicking = false;
    activeTeams.forEach((team) => {
      if (team.remaining_seconds > 0) {
        team.remaining_seconds -= 1;
        hasTicking = true;
      }
    });
    if (hasTicking) {
      const timerSpans = contentEl.querySelectorAll('.team-purchase-modal__active-item');
      if (timerSpans.length) {
        activeTeams.forEach((team) => {
          const btn = contentEl.querySelector(`[data-team-id="${team.id}"]`);
          if (btn) {
            const item = btn.closest('.team-purchase-modal__active-item');
            const timerEl = item?.querySelector('.font-mono span:last-child');
            if (timerEl) timerEl.textContent = `⏱️ ${formatCountdown(team.remaining_seconds)}`;
          }
        });
      }
    }
  }, 1000);

  modal.open();

  return () => {
    if (timerInterval) clearInterval(timerInterval);
    modal.close();
  };
}
