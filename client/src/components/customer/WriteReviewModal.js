/**
 * WriteReviewModal.js — Interactive review writer and editor modal with coin reward calculation.
 */
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { customerApi } from '../../services/customer.api.js';

export function openWriteReviewModal({ item = null, existingReview = null, onSaved = null }) {
  const isBn = getLanguage() === 'bn';
  const isEditing = Boolean(existingReview);

  const productRef = existingReview ? existingReview.product_ref : item?.product_ref;
  const productTitle = isBn
    ? (existingReview?.product_title_bn || item?.product_title_bn || 'পণ্য')
    : (existingReview?.product_title_en || item?.product_title_en || 'Product');
  const productImage = existingReview?.product_image || item?.product_image || '/media/placeholder.webp';
  const storeName = existingReview?.store_ref || item?.store_name || 'Verified Seller';

  let currentRating = existingReview?.rating || 5;
  let attachedMedia = existingReview?.media ? [...existingReview.media] : [];

  const ratingLabels = {
    1: t('customer_reviews.modal_rate_1'),
    2: t('customer_reviews.modal_rate_2'),
    3: t('customer_reviews.modal_rate_3'),
    4: t('customer_reviews.modal_rate_4'),
    5: t('customer_reviews.modal_rate_5'),
  };

  const form = document.createElement('form');
  form.className = 'space-y-4';

  // Product Preview Bar
  const prodSnippet = document.createElement('div');
  prodSnippet.className = 'review-modal-product';
  prodSnippet.innerHTML = `
    <img class="review-modal-product__img" src="${productImage}" alt="${productTitle}" />
    <div>
      <h4 class="review-modal-product__title">${productTitle}</h4>
      <p class="review-modal-product__store">🏪 ${storeName} · <span>${productRef}</span></p>
    </div>
  `;
  form.appendChild(prodSnippet);

  // Star Rating Selector
  const ratingSection = document.createElement('div');
  ratingSection.className = 'review-modal-stars-picker';

  const ratingLabel = document.createElement('span');
  ratingLabel.className = 'text-xs font-bold text-muted uppercase tracking-wider';
  ratingLabel.textContent = t('customer_reviews.modal_rating_label');

  const starRow = document.createElement('div');
  starRow.className = 'review-modal-stars-row';

  const starText = document.createElement('span');
  starText.className = 'review-modal-star-label';

  function updateStars(rating) {
    currentRating = rating;
    starText.textContent = ratingLabels[rating] || `${rating} Stars`;

    starRow.querySelectorAll('.review-modal-star-btn').forEach((btn, idx) => {
      const starVal = idx + 1;
      btn.classList.toggle('review-modal-star-btn--filled', starVal <= rating);
      btn.setAttribute('aria-pressed', String(starVal === rating));
    });
  }

  for (let i = 1; i <= 5; i++) {
    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = `review-modal-star-btn ${i <= currentRating ? 'review-modal-star-btn--filled' : ''}`;
    starBtn.setAttribute('aria-label', `${i} Stars`);
    starBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
      </svg>
    `;

    starBtn.addEventListener('click', () => updateStars(i));
    starBtn.addEventListener('mouseenter', () => {
      starText.textContent = ratingLabels[i] || `${i} Stars`;
    });
    starBtn.addEventListener('mouseleave', () => {
      starText.textContent = ratingLabels[currentRating] || `${currentRating} Stars`;
    });

    starRow.appendChild(starBtn);
  }

  updateStars(currentRating);
  ratingSection.append(ratingLabel, starRow, starText);
  form.appendChild(ratingSection);

  // Review Title Input
  const titleField = document.createElement('div');
  titleField.className = 'form-field';
  titleField.innerHTML = `
    <label class="form-label font-bold text-xs" for="review-input-title">${t('customer_reviews.modal_title_label')}</label>
    <input
      id="review-input-title"
      type="text"
      class="form-input"
      placeholder="${t('customer_reviews.modal_title_placeholder')}"
      value="${existingReview?.title || ''}"
      maxlength="100"
    />
  `;
  form.appendChild(titleField);

  // Review Body Textarea
  const bodyField = document.createElement('div');
  bodyField.className = 'form-field';
  bodyField.innerHTML = `
    <label class="form-label font-bold text-xs" for="review-input-body">${t('customer_reviews.modal_body_label')}</label>
    <textarea
      id="review-input-body"
      class="form-textarea"
      rows="3"
      placeholder="${t('customer_reviews.modal_body_placeholder')}"
      required
    >${existingReview?.body || ''}</textarea>
  `;
  form.appendChild(bodyField);

  const bodyInput = bodyField.querySelector('#review-input-body');

  // Quick Suggestions Chips
  const tagChipsSection = document.createElement('div');
  tagChipsSection.innerHTML = `<span class="text-[11px] font-bold text-muted">${t('customer_reviews.modal_quick_tags_label')}</span>`;
  const tagsContainer = document.createElement('div');
  tagsContainer.className = 'review-modal-tags';

  const suggestionTags = [
    t('customer_reviews.tag_fast_delivery'),
    t('customer_reviews.tag_authentic'),
    t('customer_reviews.tag_great_quality'),
    t('customer_reviews.tag_exact_color'),
    t('customer_reviews.tag_good_packaging'),
  ];

  suggestionTags.forEach((tagText) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'review-modal-tag-chip';
    chip.textContent = tagText;
    chip.addEventListener('click', () => {
      const current = bodyInput.value.trim();
      bodyInput.value = current ? `${current} ${tagText}` : tagText;
      bodyInput.focus();
    });
    tagsContainer.appendChild(chip);
  });
  tagChipsSection.appendChild(tagsContainer);
  form.appendChild(tagChipsSection);

  // Media Attachment Section (Photos & Unboxing Videos)
  const mediaSection = document.createElement('div');
  mediaSection.className = 'review-modal-media-section';

  const mediaHeader = document.createElement('div');
  mediaHeader.className = 'flex items-center justify-between gap-2 flex-wrap';
  mediaHeader.innerHTML = `
    <div>
      <h5 class="text-xs font-bold text-foreground mb-0">${t('customer_reviews.modal_media_label')}</h5>
      <p class="text-[11px] text-muted mb-0">${t('customer_reviews.modal_media_hint')}</p>
    </div>
  `;

  const uploadBtnWrap = document.createElement('div');
  uploadBtnWrap.className = 'flex items-center gap-2';

  const addPhotoBtn = document.createElement('button');
  addPhotoBtn.type = 'button';
  addPhotoBtn.className = 'btn btn--secondary btn--sm text-xs font-bold';
  addPhotoBtn.innerHTML = '📸 + Photo (+20 🪙)';

  const addVideoBtn = document.createElement('button');
  addVideoBtn.type = 'button';
  addVideoBtn.className = 'btn btn--primary btn--sm text-xs font-bold';
  addVideoBtn.innerHTML = '🎥 + Video (+40 🪙)';

  uploadBtnWrap.append(addPhotoBtn, addVideoBtn);
  mediaHeader.appendChild(uploadBtnWrap);

  const previewList = document.createElement('div');
  previewList.className = 'review-modal-media-preview-list';

  function renderMediaPreviews() {
    previewList.innerHTML = '';
    attachedMedia.forEach((m, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'review-modal-media-thumb';

      const img = document.createElement('img');
      img.src = m.url || productImage;
      img.alt = 'Uploaded media';
      thumb.appendChild(img);

      if (m.media_kind === 'VIDEO') {
        const badge = document.createElement('span');
        badge.className = 'absolute bottom-1 left-1 bg-black/70 text-white text-[10px] font-bold px-1 rounded';
        badge.textContent = 'VIDEO';
        thumb.appendChild(badge);
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'review-modal-media-thumb-remove';
      removeBtn.innerHTML = '✕';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', () => {
        attachedMedia.splice(idx, 1);
        renderMediaPreviews();
      });

      thumb.appendChild(removeBtn);
      previewList.appendChild(thumb);
    });
  }

  addPhotoBtn.addEventListener('click', () => {
    // Add realistic sample photo
    attachedMedia.push({
      id: Date.now(),
      url: productImage,
      media_kind: 'IMAGE',
    });
    renderMediaPreviews();
    toast.success(isBn ? 'ছবি সফলভাবে যুক্ত হয়েছে (+২০ কয়েন)' : 'Photo added! (+20 Coins)');
  });

  addVideoBtn.addEventListener('click', () => {
    // Add realistic sample unboxing video
    attachedMedia.push({
      id: Date.now(),
      url: '/media/sample-unboxing.mp4',
      media_kind: 'VIDEO',
    });
    renderMediaPreviews();
    toast.success(isBn ? 'ভিডিও সফলভাবে যুক্ত হয়েছে (+৪০ কয়েন)' : 'Video unboxing added! (+40 Coins)');
  });

  renderMediaPreviews();
  mediaSection.append(mediaHeader, previewList);
  form.appendChild(mediaSection);

  // Footer Actions
  const footer = document.createElement('div');
  footer.className = 'modal__footer flex justify-end gap-2 pt-4 border-t border-subtle';

  const cancelBtn = Button({
    label: t('common.cancel'),
    variant: 'secondary',
    onClick: () => modal.close(),
  });

  const submitBtn = Button({
    label: isEditing ? t('customer_reviews.modal_update_btn') : t('customer_reviews.modal_submit_btn'),
    variant: 'primary',
  });

  footer.append(cancelBtn, submitBtn);

  // Form Submit Handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const titleVal = form.querySelector('#review-input-title')?.value?.trim() || '';
    const bodyVal = bodyInput.value.trim();

    if (!bodyVal) {
      toast.error(isBn ? 'অনুগ্রহ করে রিভিউর বিবরণ লিখুন।' : 'Please write your review feedback.');
      bodyInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t('customer_reviews.modal_submitting');

    try {
      if (isEditing) {
        const res = await customerApi.updateReview(existingReview.id, {
          rating: currentRating,
          title: titleVal,
          body: bodyVal,
          media: attachedMedia,
        });

        toast.success(t('customer_reviews.toast_updated'));
        modal.close();
        if (typeof onSaved === 'function') onSaved(res?.data?.review);
      } else {
        const res = await customerApi.submitReview({
          product_ref: productRef,
          order_item_id: item?.order_item_id,
          rating: currentRating,
          title: titleVal,
          body: bodyVal,
          media: attachedMedia,
        });

        const awarded = res?.data?.coins_awarded || (attachedMedia.some((m) => m.media_kind === 'VIDEO') ? 40 : 20);
        toast.success(t('customer_reviews.toast_submitted', { coins: awarded }));
        modal.close();
        if (typeof onSaved === 'function') onSaved(res?.data?.review);
      }
    } catch (err) {
      toast.error(t('customer_reviews.toast_error'));
      submitBtn.disabled = false;
      submitBtn.textContent = isEditing ? t('customer_reviews.modal_update_btn') : t('customer_reviews.modal_submit_btn');
    }
  });

  const modal = Modal({
    title: isEditing ? t('customer_reviews.modal_edit_title') : t('customer_reviews.modal_write_title'),
    content: form,
    footer,
    size: 'lg',
  });

  modal.open();
  return modal;
}
