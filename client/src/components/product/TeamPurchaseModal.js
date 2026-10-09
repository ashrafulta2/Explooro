/**
 * TeamPurchaseModal.js — Social Group Buying & Team Purchases Modal (Prompt 9.5).
 *
 * Allows shoppers on ProductDetailPage to:
 * 1. View active group-buying pools for this product and join immediately to unlock instant discounts.
 * 2. Start a new team purchase (2 or 3 members) with a recipient name and address, pay by Cash on
 *    Delivery or wallet, and launch a viral team link.
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
import { TeamCheckoutForm } from './TeamCheckoutForm.js';

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

  // WHY prices come from GET /team-purchases/quote: the server charges the group price it computes
  // from the super admin's settings, so the modal shows those numbers rather than its own guess.
  // The fallback (15% / 25% off, no shipping) only renders until the quote arrives.
  let quote = null;
  let selectedMembers = 3;
  let activeTeams = [];
  let isLoadingTeams = true;
  let timerInterval = null;
  let checkoutForm = null;
  let quoteFailed = false;

  const contentEl = document.createElement('div');
  contentEl.className = 'team-purchase-modal';

  const modal = Modal({
    title: isBn ? 'সোশ্যাল গ্রুপ বাই ও টিম পারচেজ' : 'Social Group Buying & Team Purchase',
    content: contentEl,
    size: 'lg',
    showClose: true,
  });

  function quoteOption(members) {
    return quote?.options?.find((o) => Number(o.members) === members) || null;
  }

  function calcGroupPrice(members) {
    const option = quoteOption(members);
    if (option) return Number(option.group_price);
    const discountPct = members === 2 ? 0.15 : 0.25;
    return Math.max(1, Math.round(retailPrice * (1 - discountPct)));
  }

  function discountPctFor(members) {
    const option = quoteOption(members);
    return option ? Number(option.discount_pct) : (members === 2 ? 15 : 25);
  }

  async function loadQuote() {
    try {
      quote = await api.get(`/team-purchases/quote?product_id=${encodeURIComponent(product.id)}`);
      if (quote?.default_team_size && !quoteOption(selectedMembers)) selectedMembers = quote.default_team_size;
    } catch {
      quote = null;
      quoteFailed = true;
    }
    render();
  }

  function goToLogin() {
    modal.close();
    const target = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
    if (navigate) navigate(target);
    else window.location.href = target;
  }

  async function submitNewTeam(fields) {
    const { auth } = appStore.get();
    if (!auth?.isAuthenticated) {
      toast.info(isBn ? 'টিম শুরু করতে অনুগ্রহ করে সাইন ইন করুন।' : 'Please sign in to start a team purchase.');
      goToLogin();
      return;
    }

    const res = await api.post('/team-purchases', {
      product_id: product.id,
      required_members: selectedMembers,
      ...fields,
    });

    const createdTeam = res?.team || res?.data?.team || res;
    const targetId = createdTeam?.id || createdTeam?.ref;

    toast.success(
      isBn
        ? 'টিম পারচেজ সফলভাবে শুরু হয়েছে! বন্ধুদের আমন্ত্রণ জানান।'
        : 'Team purchase started! Invite friends to unlock your discount.'
    );
    modal.close();
    if (!targetId) return;
    if (navigate) navigate(`/team/${targetId}`);
    else window.location.href = `/team/${targetId}`;
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
    const imageUrl = product.primary_image_url || product.image_url || product.images?.[0]?.url || resolveProductImage(product) || '/placeholder-product.svg';
    const currentGroupPrice = calcGroupPrice(selectedMembers);
    const currentSavings = calcSavings(selectedMembers);
    const discountPct = discountPctFor(selectedMembers);

    // 1. Product Snapshot & Deal Highlight Header
    const header = document.createElement('div');
    header.className = 'team-purchase-modal__product-header';
    header.innerHTML = `
      <div class="team-purchase-modal__thumb">
        <img src="${imageUrl}" alt="${title}" onerror="this.onerror=null;this.src='/placeholder-product.svg'" />
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
    startHeading.innerHTML = isBn ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 3.81-2 24.36 24.36 0 0 1 5.9-2c3.55-1 6-4 6-4s-3 2.45-4 6a24.36 24.36 0 0 1-2 5.9A22 22 0 0 1 15 12z"></path><path d="M9 11l.01-.01"></path></svg> ' + t('team_purchases.checkout.start_heading', { hours: quote?.window_hours ?? 24 }) : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 3.81-2 24.36 24.36 0 0 1 5.9-2c3.55-1 6-4 6-4s-3 2.45-4 6a24.36 24.36 0 0 1-2 5.9A22 22 0 0 1 15 12z"></path><path d="M9 11l.01-.01"></path></svg> ' + t('team_purchases.checkout.start_heading', { hours: quote?.window_hours ?? 24 });
    startSection.append(startHeading);

    // Size Selector
    const sizeSelector = document.createElement('div');
    sizeSelector.className = 'team-purchase-modal__size-selector';

    const size2Option = document.createElement('div');
    size2Option.className = `team-purchase-modal__size-option ${selectedMembers === 2 ? 'team-purchase-modal__size-option--active' : ''}`;
    size2Option.innerHTML = `
      <div class="font-bold text-xs">${isBn ? '২ জনের টিম' : '2-Member Team'}</div>
      <div class="text-sm font-extrabold text-primary mt-0.5">${formatCurrency(calcGroupPrice(2))}</div>
      <div class="text-[10px] text-emerald-700 font-semibold">${isBn ? `${discountPctFor(2)}% ছাড়` : `${discountPctFor(2)}% OFF`}</div>
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
      <div class="text-[10px] text-emerald-700 font-semibold">${isBn ? `${discountPctFor(3)}% ছাড়` : `${discountPctFor(3)}% OFF`}</div>
    `;
    size3Option.addEventListener('click', () => {
      selectedMembers = 3;
      render();
    });

    sizeSelector.append(size2Option, size3Option);
    startSection.append(sizeSelector);

    // Recipient name + address + payment, with the server's price, shipping and total.
    // WHY the form survives re-renders: render() runs again on every size switch, and a shopper's
    // typed name and address must not be wiped by changing the team size.
    if (!checkoutForm && quote) {
      checkoutForm = TeamCheckoutForm({
        itemPrice: currentGroupPrice,
        shippingCharge: Number(quote?.shipping_charge ?? 0),
        walletBalance: quote?.wallet_balance ?? null,
        submitLabel: t('team_purchases.btn_start'),
        onSubmit: submitNewTeam,
      });
    }
    let form;
    if (checkoutForm) {
      checkoutForm.setItemPrice(currentGroupPrice);
      form = checkoutForm.el;
    } else {
      form = document.createElement('p');
      form.className = 'p-3 text-xs text-secondary text-center';
      form.textContent = quoteFailed ? t('team_purchases.checkout.unavailable') : t('common.loading');
    }
    const guarantee = document.createElement('p');
    guarantee.className = 'text-[11px] text-muted';
    guarantee.textContent = t('team_purchases.checkout.guarantee', { hours: quote?.window_hours ?? 24 });

    startSection.append(form, guarantee);
    contentEl.append(startSection);

    // 4. Footer link to /account/team-purchases
    const footerLinks = document.createElement('div');
    footerLinks.className = 'team-purchase-modal__footer-links';
    footerLinks.innerHTML = `
      <a href="/account/team-purchases" class="text-xs text-primary font-bold hover:underline" id="modal-view-my-teams">
        ${isBn ? 'আমার সকল টিম পারচেজ ও ট্র্যাকিং →' : 'View all my team purchases & tracking →'}
      </a>
      <span class="text-[11px] text-muted font-mono">${quote?.window_hours ?? 24}h SLA Escrow</span>
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
  loadQuote();
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
