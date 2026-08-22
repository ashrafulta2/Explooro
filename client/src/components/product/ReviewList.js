/**
 * ReviewList — rating distribution, photo/video reviews, verified-purchase badge, sort/filter,
 * helpful votes, pagination, and review submission gated on a delivered purchase (Prompt 4.6).
 *
 * Returns `{ el, cleanup }` — the same async-loading-page-module contract ProductGrid.js/
 * FilterPanel.js already use, since this component fetches its own data and holds live listeners.
 */
import { t } from '../../services/i18n.js';
import { formatRelativeTime } from '../../services/format.js';
import { Button } from '../ui/Button.js';
import { Select } from '../ui/Select.js';
import { Input } from '../ui/Input.js';
import { Textarea } from '../ui/Textarea.js';
import { Skeleton } from '../ui/Skeleton.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Pagination } from '../ui/Pagination.js';
import { toast } from '../../services/toast.js';
import * as catalogApi from '../../services/catalog.api.js';

const SORT_OPTIONS = [
  { value: 'newest', i18n: 'product_detail.review.sort_newest' },
  { value: 'oldest', i18n: 'product_detail.review.sort_oldest' },
  { value: 'helpful', i18n: 'product_detail.review.sort_helpful' },
  { value: 'rating_high', i18n: 'product_detail.review.sort_rating_high' },
  { value: 'rating_low', i18n: 'product_detail.review.sort_rating_low' },
];

function starRow(filled, { size = 'md', interactive = false, onPick = null } = {}) {
  const wrap = document.createElement('span');
  wrap.className = `star-row star-row--${size}`;
  if (!interactive) wrap.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= 5; i += 1) {
    const star = document.createElement(interactive ? 'button' : 'span');
    if (interactive) {
      star.type = 'button';
      star.setAttribute('aria-label', t('product_detail.review.rate_n_stars', { count: i }));
    }
    star.className = 'star-row__star';
    star.dataset.filled = String(i <= filled);
    star.innerHTML =
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9Z"/></svg>';
    if (interactive) star.addEventListener('click', () => onPick && onPick(i));
    wrap.append(star);
  }
  return wrap;
}

function distributionBars(distribution, totalCount) {
  const wrap = document.createElement('div');
  wrap.className = 'review-distribution';
  for (let stars = 5; stars >= 1; stars -= 1) {
    const count = distribution[stars] || 0;
    const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
    const rowEl = document.createElement('div');
    rowEl.className = 'review-distribution__row';
    const label = document.createElement('span');
    label.className = 'review-distribution__label';
    label.textContent = t('product_detail.review.n_stars', { count: stars });
    const track = document.createElement('span');
    track.className = 'review-distribution__track';
    const fill = document.createElement('span');
    fill.className = 'review-distribution__fill';
    fill.style.width = `${pct}%`;
    track.append(fill);
    const countEl = document.createElement('span');
    countEl.className = 'review-distribution__count';
    countEl.textContent = String(count);
    rowEl.append(label, track, countEl);
    wrap.append(rowEl);
  }
  return wrap;
}

function reviewCard(review, lang, onMarkHelpful) {
  const card = document.createElement('article');
  card.className = 'review-card';

  const header = document.createElement('div');
  header.className = 'review-card__header';
  header.append(starRow(review.rating, { size: 'sm' }));
  if (review.is_verified_purchase) {
    const badge = document.createElement('span');
    badge.className = 'badge badge--verified badge--sm';
    badge.textContent = t('product_detail.review.verified_purchase');
    header.append(badge);
  }
  const date = document.createElement('span');
  date.className = 'review-card__date';
  date.textContent = formatRelativeTime(review.created_at, { lang });
  header.append(date);
  card.append(header);

  if (review.title) {
    const title = document.createElement('h4');
    title.className = 'review-card__title';
    title.textContent = review.title;
    card.append(title);
  }

  const reviewer = document.createElement('p');
  reviewer.className = 'review-card__reviewer';
  reviewer.textContent = review.reviewer_name || t('product_detail.review.anonymous');
  card.append(reviewer);

  if (review.body) {
    const body = document.createElement('p');
    body.className = 'review-card__body';
    body.textContent = review.body;
    card.append(body);
  }

  if (review.media && review.media.length > 0) {
    const mediaRow = document.createElement('div');
    mediaRow.className = 'review-card__media';
    for (const m of review.media) {
      const tile = document.createElement('div');
      tile.className = 'review-card__media-tile';
      if (m.url) {
        const img = document.createElement('img');
        img.src = m.url;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => img.remove(), { once: true });
        tile.append(img);
      }
      mediaRow.append(tile);
    }
    card.append(mediaRow);
  }

  const footer = document.createElement('div');
  footer.className = 'review-card__footer';
  const helpfulBtn = Button({
    label: t('product_detail.review.helpful_count', { count: review.helpful_count }),
    variant: 'ghost',
    size: 'sm',
    onClick: () => onMarkHelpful(review),
  });
  footer.append(helpfulBtn);
  card.append(footer);

  return card;
}

export function ReviewList({ productId, ratingAvg = 0, ratingCount = 0, lang = 'en' } = {}) {
  const el = document.createElement('section');
  el.className = 'review-list';
  let destroyed = false;

  const heading = document.createElement('h2');
  heading.className = 'review-list__heading';
  heading.textContent = t('product_detail.review.heading', { count: ratingCount });
  el.append(heading);

  const summary = document.createElement('div');
  summary.className = 'review-list__summary';
  const avgBlock = document.createElement('div');
  avgBlock.className = 'review-list__avg';
  const avgNumber = document.createElement('span');
  avgNumber.className = 'review-list__avg-number';
  avgNumber.textContent = Number(ratingAvg || 0).toFixed(1);
  avgBlock.append(avgNumber, starRow(Math.round(Number(ratingAvg) || 0)));
  const avgCount = document.createElement('span');
  avgCount.className = 'review-list__avg-count';
  avgCount.textContent = t('product_detail.review.rating_count', { count: ratingCount });
  avgBlock.append(avgCount);
  summary.append(avgBlock);
  const distributionSlot = document.createElement('div');
  summary.append(distributionSlot);
  el.append(summary);

  // ── Write-a-review section (eligibility fetched on mount) ──────────────
  const writeSection = document.createElement('div');
  writeSection.className = 'review-list__write';
  el.append(writeSection);

  // ── Controls (sort + filters) ───────────────────────────────────────────
  const controls = document.createElement('div');
  controls.className = 'review-list__controls';
  let sort = 'newest';
  let ratingFilter = null;
  let photosOnly = false;

  const sortSelect = Select({
    label: t('product_detail.review.sort_label'),
    options: SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.i18n) })),
    value: sort,
    onChange: (e) => { sort = e.target.value; page = 1; load(); },
  });
  controls.append(sortSelect);

  const ratingFilterRow = document.createElement('div');
  ratingFilterRow.className = 'review-list__rating-filter';
  ratingFilterRow.setAttribute('role', 'group');
  ratingFilterRow.setAttribute('aria-label', t('product_detail.review.filter_by_rating'));
  const filterButtons = [];
  function buildRatingFilterButtons() {
    ratingFilterRow.replaceChildren();
    filterButtons.length = 0;
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'review-list__rating-filter-btn';
    allBtn.textContent = t('product_detail.review.filter_all');
    allBtn.addEventListener('click', () => { ratingFilter = null; page = 1; syncFilterButtons(); load(); });
    ratingFilterRow.append(allBtn);
    filterButtons.push({ value: null, el: allBtn });
    for (let stars = 5; stars >= 1; stars -= 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'review-list__rating-filter-btn';
      btn.textContent = t('product_detail.review.n_stars', { count: stars });
      btn.addEventListener('click', () => { ratingFilter = stars; page = 1; syncFilterButtons(); load(); });
      ratingFilterRow.append(btn);
      filterButtons.push({ value: stars, el: btn });
    }
    syncFilterButtons();
  }
  function syncFilterButtons() {
    for (const { value, el: btn } of filterButtons) {
      btn.setAttribute('aria-pressed', String(value === ratingFilter));
    }
  }
  buildRatingFilterButtons();
  controls.append(ratingFilterRow);

  const photosToggle = document.createElement('button');
  photosToggle.type = 'button';
  photosToggle.className = 'review-list__photos-toggle';
  photosToggle.textContent = t('product_detail.review.photos_only');
  photosToggle.setAttribute('aria-pressed', 'false');
  photosToggle.addEventListener('click', () => {
    photosOnly = !photosOnly;
    photosToggle.setAttribute('aria-pressed', String(photosOnly));
    page = 1;
    load();
  });
  controls.append(photosToggle);
  el.append(controls);

  // ── List + pagination ───────────────────────────────────────────────────
  const listSlot = document.createElement('div');
  listSlot.className = 'review-list__items';
  el.append(listSlot);

  const paginationSlot = document.createElement('div');
  el.append(paginationSlot);

  let page = 1;

  async function markHelpful(review) {
    try {
      const result = await catalogApi.markReviewHelpful(review.id);
      review.helpful_count = result.helpful_count;
      load();
    } catch {
      toast.error(t('product_detail.review.helpful_failed'));
    }
  }

  async function load() {
    listSlot.replaceChildren(Skeleton({ variant: 'text', lines: 4 }), Skeleton({ variant: 'text', lines: 4 }));
    let result;
    try {
      result = await catalogApi.listReviews(productId, {
        rating: ratingFilter,
        hasPhotos: photosOnly,
        sort,
        page,
        pageSize: 5,
      });
    } catch {
      if (destroyed) return;
      listSlot.replaceChildren(EmptyState({ title: t('product_detail.review.load_failed') }));
      return;
    }
    if (destroyed) return;

    distributionSlot.replaceChildren(distributionBars(result.distribution, ratingCount));

    if (result.reviews.length === 0) {
      listSlot.replaceChildren(
        EmptyState({
          title: t('product_detail.review.empty_title'),
          description: t('product_detail.review.empty_description'),
        })
      );
      paginationSlot.replaceChildren();
      return;
    }

    listSlot.replaceChildren(...result.reviews.map((r) => reviewCard(r, lang, markHelpful)));

    if (result.pagination.total_pages > 1) {
      paginationSlot.replaceChildren(
        Pagination({
          mode: 'offset',
          page: result.pagination.page,
          totalPages: result.pagination.total_pages,
          totalItems: result.pagination.total_count,
          pageSize: result.pagination.page_size,
          onChange: ({ page: nextPage }) => { page = nextPage; load(); window.scrollTo({ top: listSlot.offsetTop, behavior: 'smooth' }); },
        })
      );
    } else {
      paginationSlot.replaceChildren();
    }
  }

  function renderEligibilityMessage(reason) {
    const messageKey = {
      NOT_SIGNED_IN: 'product_detail.review.gate_sign_in',
      NOT_PURCHASED: 'product_detail.review.gate_not_purchased',
      NOT_YET_DELIVERED: 'product_detail.review.gate_not_delivered',
      ALREADY_REVIEWED: 'product_detail.review.gate_already_reviewed',
    }[reason];
    const note = document.createElement('p');
    note.className = 'review-list__gate-note';
    note.textContent = t(messageKey || 'product_detail.review.gate_not_purchased');
    writeSection.replaceChildren(note);
  }

  function renderWriteForm() {
    let selectedRating = 0;
    const form = document.createElement('form');
    form.className = 'review-form';

    const label = document.createElement('p');
    label.className = 'review-form__label';
    label.textContent = t('product_detail.review.your_rating');
    form.append(label);

    const starsInput = starRow(0, { interactive: true, onPick: (n) => { selectedRating = n; refreshStars(); } });
    function refreshStars() {
      [...starsInput.children].forEach((star, i) => { star.dataset.filled = String(i < selectedRating); });
    }
    form.append(starsInput);

    const titleField = Input({ placeholder: t('product_detail.review.title_placeholder') });
    form.append(titleField);

    const bodyField = Textarea({ placeholder: t('product_detail.review.body_placeholder'), rows: 3 });
    form.append(bodyField);

    const submitBtn = Button({ label: t('product_detail.review.submit'), type: 'submit' });
    form.append(submitBtn);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!selectedRating) {
        toast.warning(t('product_detail.review.rating_required'));
        return;
      }
      submitBtn.setLoading(true);
      try {
        await catalogApi.submitReview(productId, { rating: selectedRating, title: titleField.value, body: bodyField.value });
        toast.success(t('product_detail.review.submit_success'));
        writeSection.replaceChildren();
        page = 1;
        ratingCount += 1;
        heading.textContent = t('product_detail.review.heading', { count: ratingCount });
        load();
      } catch (err) {
        toast.error(err.message_en || t('product_detail.review.submit_failed'));
      } finally {
        submitBtn.setLoading(false);
      }
    });

    writeSection.replaceChildren(form);
  }

  async function loadEligibility() {
    try {
      const eligibility = await catalogApi.getReviewEligibility(productId);
      if (destroyed) return;
      if (eligibility.can_review) renderWriteForm();
      else renderEligibilityMessage(eligibility.reason);
    } catch {
      // Not signed in / no session yet — same as an explicit NOT_SIGNED_IN reason.
      if (!destroyed) renderEligibilityMessage('NOT_SIGNED_IN');
    }
  }

  load();
  loadEligibility();

  return {
    el,
    cleanup: () => { destroyed = true; },
  };
}
