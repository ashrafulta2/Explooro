/**
 * CustomerReviewCard.js — Renders a review written by the customer.
 */
import { t, getLanguage } from '../../services/i18n.js';
import { formatRelativeTime } from '../../services/format.js';
import { Modal } from '../ui/Modal.js';

function renderStarRow(rating) {
  const row = document.createElement('span');
  row.className = 'customer-review-card__stars';
  row.setAttribute('aria-label', `${rating} of 5 stars`);

  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('span');
    star.innerHTML = `
      <svg viewBox="0 0 24 24" fill="${i <= rating ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
      </svg>
    `;
    row.appendChild(star);
  }
  return row;
}

function openMediaLightbox(mediaItem) {
  const content = document.createElement('div');
  content.className = 'review-lightbox-modal';

  if (mediaItem.media_kind === 'VIDEO') {
    const video = document.createElement('video');
    video.src = mediaItem.url || '/media/sample-unboxing.mp4';
    video.controls = true;
    video.autoplay = true;
    video.style.maxWidth = '100%';
    video.style.maxHeight = '70vh';
    video.style.borderRadius = 'var(--radius-xl)';
    content.appendChild(video);
  } else {
    const img = document.createElement('img');
    img.src = mediaItem.url || '/media/placeholder.webp';
    img.alt = 'Customer Review Photo';
    content.appendChild(img);
  }

  const modal = Modal({
    title: mediaItem.media_kind === 'VIDEO' ? '🎥 Video Unboxing' : '📸 Review Photo',
    content,
  });
  modal.open();
}

export function CustomerReviewCard({ review, onEdit, onDelete }) {
  const isBn = getLanguage() === 'bn';
  const productTitle = (isBn && review.product_title_bn) ? review.product_title_bn : (review.product_title_en || 'Product');

  const card = document.createElement('article');
  card.className = 'customer-review-card';
  card.dataset.reviewId = review.id;

  // Header: Product info + Status badge
  const header = document.createElement('div');
  header.className = 'customer-review-card__header';

  const productLink = document.createElement('a');
  productLink.href = `/product/${review.product_ref}`;
  productLink.className = 'customer-review-card__product-info';

  const thumb = document.createElement('img');
  thumb.className = 'customer-review-card__thumbnail';
  thumb.src = review.product_image || '/media/placeholder.webp';
  thumb.alt = productTitle;
  thumb.loading = 'lazy';

  const productText = document.createElement('div');
  const prodTitle = document.createElement('h3');
  prodTitle.className = 'customer-review-card__product-title';
  prodTitle.textContent = productTitle;

  const prodMeta = document.createElement('div');
  prodMeta.className = 'customer-review-card__product-meta';
  prodMeta.innerHTML = `<span>${review.product_ref}</span> · <span>💰 ৳${review.product_price || '0'}</span>`;

  productText.append(prodTitle, prodMeta);
  productLink.append(thumb, productText);

  const statusBadge = document.createElement('span');
  statusBadge.className = 'badge badge--success badge--sm';
  statusBadge.textContent = t('customer_reviews.status_published');

  header.append(productLink, statusBadge);

  // Rating & Date row
  const ratingRow = document.createElement('div');
  ratingRow.className = 'customer-review-card__rating-row';

  ratingRow.appendChild(renderStarRow(review.rating));

  if (review.is_verified_purchase) {
    const verifiedBadge = document.createElement('span');
    verifiedBadge.className = 'badge badge--verified badge--sm';
    verifiedBadge.innerHTML = `✓ ${t('customer_reviews.verified_purchase')}`;
    ratingRow.appendChild(verifiedBadge);
  }

  const dateSpan = document.createElement('span');
  dateSpan.className = 'customer-review-card__date';
  dateSpan.textContent = `· ${formatRelativeTime(review.created_at, { lang: isBn ? 'bn' : 'en' })}`;
  ratingRow.appendChild(dateSpan);

  // Review Title & Body
  const titleEl = document.createElement('h4');
  titleEl.className = 'customer-review-card__title';
  titleEl.textContent = review.title || (isBn ? 'দারুণ অভিজ্ঞতা' : 'Great Experience');

  const bodyEl = document.createElement('p');
  bodyEl.className = 'customer-review-card__body';
  bodyEl.textContent = review.body || '';

  card.append(header, ratingRow, titleEl, bodyEl);

  // Attached Media Gallery
  if (review.media && review.media.length > 0) {
    const mediaGrid = document.createElement('div');
    mediaGrid.className = 'customer-review-card__media-grid';

    review.media.forEach((m) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'customer-review-card__media-item';

      const img = document.createElement('img');
      img.className = 'customer-review-card__media-img';
      img.src = m.url || review.product_image || '/media/placeholder.webp';
      img.alt = 'Review media';
      itemEl.appendChild(img);

      if (m.media_kind === 'VIDEO') {
        const videoBadge = document.createElement('div');
        videoBadge.className = 'customer-review-card__media-video-badge';
        videoBadge.innerHTML = '▶';
        itemEl.appendChild(videoBadge);
      }

      itemEl.addEventListener('click', () => openMediaLightbox(m));
      mediaGrid.appendChild(itemEl);
    });

    card.appendChild(mediaGrid);
  }

  // Footer: Helpful count & Action buttons (Edit/Delete)
  const footer = document.createElement('div');
  footer.className = 'customer-review-card__footer';

  const helpfulSpan = document.createElement('span');
  helpfulSpan.className = 'customer-review-card__helpful-tag';
  helpfulSpan.innerHTML = `👍 <span>${t('customer_reviews.helpful_count', { count: review.helpful_count || 0 })}</span>`;

  const actions = document.createElement('div');
  actions.className = 'customer-review-card__actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'customer-review-card__btn-edit';
  editBtn.innerHTML = `<span>✏️</span> <span>${t('customer_reviews.btn_edit_review')}</span>`;
  editBtn.addEventListener('click', () => {
    if (typeof onEdit === 'function') onEdit(review);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'customer-review-card__btn-delete';
  deleteBtn.innerHTML = `<span>🗑️</span> <span>${t('customer_reviews.btn_delete_review')}</span>`;
  deleteBtn.addEventListener('click', () => {
    if (typeof onDelete === 'function') onDelete(review);
  });

  actions.append(editBtn, deleteBtn);
  footer.append(helpfulSpan, actions);
  card.appendChild(footer);

  return card;
}
