/**
 * AdminAdReviewPage.ts — the ad review queue (/admin/growth/ad-review).
 *
 * Every ad whose format asks for review (Boost included) waits here in PENDING_REVIEW until someone
 * with `growth.ad.review` approves or rejects it. Before this page the API existed but nothing in the
 * client called it, so a submitted ad could never leave the queue.
 *
 * WHY a page of its own and not a tab on /admin/growth/ads: that page is guarded by
 * `growth.ad.govern`, this decision by `growth.ad.review`. A moderator holds only the second, so
 * putting the queue behind the first would lock out the very people the permission was made for.
 */

import { Button } from '../../components/ui/Button.ts';
import { Modal } from '../../components/ui/Modal.ts';
import { api } from '../../core/api.ts';
import { toast } from '../../services/toast.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { formatCurrency } from '../../services/format.ts';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.js';

const REASON_MIN = 3;
const REASON_MAX = 500;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string | null): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// WHY a check: the banner URL is typed by the advertiser, and an admin's browser should only ever
// fetch a plain web or same-site image from it.
function safeImageUrl(url) {
  return typeof url === 'string' && /^(https?:\/\/|\/)/i.test(url) ? url : null;
}

export default function AdminAdReviewPage(root: HTMLElement) {
  loadSystemHealthStyles();
  const isBn = getLanguage() === 'bn';
  const tr = (en, bn) => (isBn ? bn : en);
  const container = el('div', 'admin-page ad-review-page');

  let queue = [];
  let isLoading = true;

  async function loadData() {
    isLoading = true;
    render();
    try {
      const res = await api.get('/admin/ads/campaigns/review');
      const payload = res?.data || res || {};
      queue = payload.campaigns || [];
    } catch (err) {
      queue = [];
      toast.error(err?.message || tr('Could not load the review queue.', 'রিভিউ তালিকা লোড করা যায়নি।'));
    } finally {
      isLoading = false;
      render();
    }
  }

  async function decide(camp, decision, reason) {
    await api.post(`/admin/ads/campaigns/${camp.id}/review`, { decision, reason });
    toast.success(decision === 'APPROVE'
      ? tr('Ad approved and now live.', 'বিজ্ঞাপন অনুমোদিত হয়েছে এবং চালু হয়েছে।')
      : tr('Ad rejected.', 'বিজ্ঞাপন বাতিল করা হয়েছে।'));
    await loadData();
  }

  // WHY a required reason: the advertiser sees it as the rejection message, and the audit row is the
  // only record of why a paid ad was turned down.
  function askReject(camp) {
    const body = el('div');
    body.append(el('p', 'text-sm text-secondary', tr(
      `"${camp.title}" will not run. Prepaid ads are refunded in full.`,
      `"${camp.title}" চালু হবে না। প্রিপেইড বিজ্ঞাপনের পুরো টাকা ফেরত যাবে।`
    )));
    const label = el('label', 'form-label', tr('Reason (shown to the advertiser)', 'কারণ (বিজ্ঞাপনদাতা দেখতে পাবেন)'));
    const input = el('textarea', 'form-input');
    input.rows = 3;
    input.maxLength = REASON_MAX;
    label.append(input);
    body.append(label);

    const cancel = Button({ label: tr('Cancel', 'বাতিল'), variant: 'ghost', onClick: () => modal.closeModal(false) });
    const confirm = Button({
      label: tr('Reject ad', 'বিজ্ঞাপন বাতিল করুন'),
      variant: 'danger',
      onClick: async () => {
        const reason = input.value.trim();
        if (reason.length < REASON_MIN) {
          toast.error(tr(`Enter a reason (at least ${REASON_MIN} characters).`, `কারণ লিখুন (কমপক্ষে ${REASON_MIN} অক্ষর)।`));
          return;
        }
        confirm.setLoading(true);
        try {
          await decide(camp, 'REJECT', reason);
          modal.closeModal(true);
        } catch (err) {
          toast.error(err?.message || tr('The decision could not be saved.', 'সিদ্ধান্ত সংরক্ষণ করা যায়নি।'));
        } finally {
          confirm.setLoading(false);
        }
      },
    });
    const footer = document.createDocumentFragment();
    footer.append(cancel, confirm);
    const modal = Modal({
      title: tr('Reject ad', 'বিজ্ঞাপন বাতিল'),
      content: body,
      footer,
      onClose: () => modal.remove(),
    });
    document.body.append(modal);
    modal.openModal();
  }

  async function approve(camp, button) {
    button.setLoading(true);
    try {
      await decide(camp, 'APPROVE', null);
    } catch (err) {
      toast.error(err?.message || tr('The decision could not be saved.', 'সিদ্ধান্ত সংরক্ষণ করা যায়নি।'));
      button.setLoading(false);
    }
  }

  function renderCard(camp) {
    const creative = camp.creative || {};
    const card = el('div', 'admin-panel mt-4');
    card.style.padding = 'var(--space-4)';

    const head = el('div');
    head.style.display = 'flex';
    head.style.gap = 'var(--space-4)';
    head.style.flexWrap = 'wrap';

    const image = safeImageUrl(creative.banner_image_url);
    if (image) {
      const img = el('img');
      img.src = image;
      img.alt = '';
      img.loading = 'lazy';
      img.style.width = '160px';
      img.style.height = '100px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = 'var(--radius-md)';
      head.append(img);
    }

    const info = el('div');
    info.style.flex = '1 1 260px';
    info.append(
      el('div', 'font-bold text-primary', camp.title),
      el('div', 'text-xs text-muted font-mono', camp.ref || `#${camp.id}`),
    );
    if (creative.headline) info.append(el('div', 'mt-2 font-semibold', creative.headline));
    if (creative.description) info.append(el('p', 'text-sm text-secondary', creative.description));
    if (creative.destination_url) info.append(el('div', 'text-xs text-muted', `→ ${creative.destination_url}`));
    head.append(info);

    const meta = el('div');
    meta.style.flex = '1 1 200px';
    const seller = camp.seller_name_en || camp.seller_phone || `#${camp.user_id}`;
    meta.append(
      el('div', 'font-semibold text-primary', seller),
      el('div', 'text-xs text-muted', [camp.seller_phone, camp.seller_tier].filter(Boolean).join(' · ')),
      el('div', 'mt-2 text-sm', `${tr('Placement', 'স্থান')}: ${camp.placement || '—'}`),
      el('div', 'text-sm font-mono', `${tr('Budget', 'বাজেট')}: ${formatCurrency(camp.total_budget)}`),
      el('div', 'text-xs text-muted', `${tr('Submitted', 'জমা')}: ${camp.created_at ? new Date(camp.created_at).toLocaleString(isBn ? 'bn-BD' : 'en-GB') : '—'}`),
    );
    head.append(meta);
    card.append(head);

    const actions = el('div');
    actions.style.display = 'flex';
    actions.style.gap = 'var(--space-2)';
    actions.style.justifyContent = 'flex-end';
    actions.style.marginTop = 'var(--space-3)';
    const rejectBtn = Button({ label: tr('Reject', 'বাতিল'), variant: 'danger', onClick: () => askReject(camp) });
    const approveBtn = Button({ label: tr('Approve', 'অনুমোদন'), variant: 'primary', onClick: () => approve(camp, approveBtn) });
    actions.append(rejectBtn, approveBtn);
    card.append(actions);
    return card;
  }

  function render() {
    root.innerHTML = '';
    container.innerHTML = '';

    if (isLoading) {
      container.append(el('div', 'p-8 text-center text-muted', t('common.loading')));
      root.appendChild(container);
      return;
    }

    const header = el('div', 'admin-page-header');
    const titleBox = el('div');
    titleBox.append(
      el('h1', 'admin-page-title', tr('Ad review queue', 'বিজ্ঞাপন রিভিউ তালিকা')),
      el('p', 'admin-page-subtitle', tr(
        'Ads wait here until approved. An approved ad starts serving at once; a rejected prepaid ad is refunded.',
        'অনুমোদনের আগে বিজ্ঞাপন এখানে অপেক্ষা করে। অনুমোদিত বিজ্ঞাপন সাথে সাথে চালু হয়; বাতিল প্রিপেইড বিজ্ঞাপনের টাকা ফেরত যায়।'
      )),
    );
    const actions = el('div', 'admin-page-actions');
    const refresh = el('button', 'btn btn--secondary btn--sm', tr('Refresh', 'রিফ্রেশ'));
    refresh.type = 'button';
    refresh.addEventListener('click', () => loadData());
    actions.append(refresh);
    header.append(titleBox, actions);
    container.append(header);

    if (queue.length === 0) {
      container.append(el('div', 'admin-panel mt-4 p-8 text-center text-muted', tr('Nothing is waiting for review.', 'রিভিউয়ের জন্য কিছু অপেক্ষায় নেই।')));
    } else {
      queue.forEach((camp) => container.append(renderCard(camp)));
    }
    root.appendChild(container);
  }

  loadData();
}
