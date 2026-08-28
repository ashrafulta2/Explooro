/**
 * PendingReviewCard.js — Displays a delivered purchase awaiting customer review.
 */
import { t, getLanguage } from '../../services/i18n.js';
import { formatRelativeTime } from '../../services/format.js';

export function PendingReviewCard({ item, onWriteReview }) {
  const isBn = getLanguage() === 'bn';
  const productTitle = (isBn && item.product_title_bn) ? item.product_title_bn : item.product_title_en;

  const card = document.createElement('div');
  card.className = 'pending-review-card';
  card.dataset.orderItemId = item.order_item_id;

  const main = document.createElement('div');
  main.className = 'pending-review-card__main';

  const img = document.createElement('img');
  img.className = 'pending-review-card__thumbnail';
  img.src = item.product_image || '/media/placeholder.webp';
  img.alt = productTitle;
  img.loading = 'lazy';

  const content = document.createElement('div');
  content.className = 'pending-review-card__content';

  const title = document.createElement('h3');
  title.className = 'pending-review-card__title';
  title.textContent = productTitle;

  const meta = document.createElement('div');
  meta.className = 'pending-review-card__meta';

  const storeSpan = document.createElement('span');
  storeSpan.innerHTML = `🏪 <strong>${item.store_name || 'Verified Seller'}</strong>`;

  const orderSpan = document.createElement('span');
  orderSpan.textContent = t('customer_reviews.order_id_label', { id: item.order_ref || item.order_item_id });

  const deliveredSpan = document.createElement('span');
  const relativeDate = formatRelativeTime(item.delivered_at, { lang: isBn ? 'bn' : 'en' });
  deliveredSpan.textContent = `· 🚚 ${t('customer_reviews.delivered_on', { date: relativeDate })}`;

  meta.append(storeSpan, orderSpan, deliveredSpan);

  const incentive = document.createElement('div');
  incentive.className = 'pending-review-card__incentive';
  incentive.innerHTML = `<span>🎁</span> <span>${isBn ? 'ছবিসহ +২০ কয়েন · ভিডিওতে +৪০ কয়েন' : '+20 Coins for Photo · +40 Coins for Video'}</span>`;

  content.append(title, meta, incentive);
  main.append(img, content);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pending-review-card__btn-write';
  btn.innerHTML = `<span>✍️</span> <span>${t('customer_reviews.btn_write_review')}</span>`;
  btn.addEventListener('click', () => {
    if (typeof onWriteReview === 'function') {
      onWriteReview(item);
    }
  });

  card.append(main, btn);
  return card;
}
