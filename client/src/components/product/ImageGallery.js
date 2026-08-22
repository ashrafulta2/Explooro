/**
 * ImageGallery — product detail image/video gallery (Prompt 4.6).
 *
 * Invariants:
 *  - Thumbnails are real <button>s in a roving-tabindex row (same pattern as ui/Tabs.js) — arrow
 *    keys move the active image, Enter/Space activates a focused thumb.
 *  - Every image tries a real <img src> first; on load failure (or when there is no url at all —
 *    true for every seed/mock image right now, see server/src/db/seeds/007_demo_gallery_media.sql)
 *    it falls back to the same tinted-initials placeholder ProductCard.js already uses, so a
 *    missing photo degrades visibly rather than rendering a broken-image icon.
 *  - Swipe left/right on the main image moves to the next/previous slide on touch devices.
 *  - `gallery.setActiveByIndex(i)` / `gallery.setOverrideImage(imageLike)` are exposed so
 *    VariantSelector can swap the shown image when a variant with its own image is selected,
 *    without the two components needing to share state.
 */

import { t } from '../../services/i18n.js';

const PLACEHOLDER_COLOURS = [
  { bg: '#da694c', fg: '#fff' }, { bg: '#2d7b44', fg: '#fff' }, { bg: '#1e5fa8', fg: '#fff' },
  { bg: '#a04129', fg: '#fff' }, { bg: '#7b3da0', fg: '#fff' }, { bg: '#936412', fg: '#fff' },
  { bg: '#205b31', fg: '#fff' }, { bg: '#2c343a', fg: '#fff' }, { bg: '#8b1f17', fg: '#fff' },
  { bg: '#464e55', fg: '#fff' },
];

function placeholderInitials(title) {
  if (!title) return '?';
  return title.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
}

function buildSlide(image, title) {
  const slide = document.createElement('div');
  slide.className = 'gallery__slide';

  const palette = PLACEHOLDER_COLOURS[(image.image_index ?? 0) % PLACEHOLDER_COLOURS.length];
  const placeholder = document.createElement('div');
  placeholder.className = 'gallery__placeholder';
  placeholder.style.cssText = `background:${palette.bg};color:${palette.fg}`;
  placeholder.textContent = placeholderInitials(title);

  if (image.media_kind === 'VIDEO' && image.url) {
    const video = document.createElement('video');
    video.className = 'gallery__media';
    video.src = image.url;
    video.controls = true;
    video.preload = 'none';
    slide.append(video);
    return slide;
  }

  if (image.url) {
    const img = document.createElement('img');
    img.className = 'gallery__media';
    img.src = image.url;
    img.alt = title;
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(placeholder), { once: true });
    slide.append(img);
    return slide;
  }

  slide.append(placeholder);
  return slide;
}

export function ImageGallery({ images = [], title = '' } = {}) {
  const root = document.createElement('div');
  root.className = 'gallery';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', t('product_detail.gallery.label'));

  const list = images.length > 0 ? images : [{ id: 'fallback', url: null, image_index: 0 }];

  const main = document.createElement('div');
  main.className = 'gallery__main';

  const thumbRow = document.createElement('div');
  thumbRow.className = 'gallery__thumbs';
  thumbRow.setAttribute('role', 'tablist');
  thumbRow.setAttribute('aria-label', t('product_detail.gallery.thumbnails'));

  let activeIndex = list.findIndex((img) => img.is_primary);
  if (activeIndex < 0) activeIndex = 0;
  let overrideImage = null;
  const thumbButtons = [];

  function render() {
    main.replaceChildren(buildSlide(overrideImage || list[activeIndex], title));
    thumbButtons.forEach((btn, i) => {
      const isActive = !overrideImage && i === activeIndex;
      btn.setAttribute('aria-selected', String(isActive));
      btn.tabIndex = isActive ? 0 : -1;
    });
  }

  function selectIndex(index, { focus = false } = {}) {
    overrideImage = null;
    activeIndex = (index + list.length) % list.length;
    render();
    if (focus) thumbButtons[activeIndex]?.focus();
  }

  list.forEach((image, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gallery__thumb';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-label', t('product_detail.gallery.thumb_label', { index: i + 1 }));
    const palette = PLACEHOLDER_COLOURS[(image.image_index ?? 0) % PLACEHOLDER_COLOURS.length];
    if (image.url) {
      const thumb = document.createElement('img');
      thumb.src = image.url;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.addEventListener('error', () => {
        thumb.remove();
        btn.style.background = palette.bg;
      }, { once: true });
      btn.append(thumb);
    } else {
      btn.style.background = palette.bg;
    }
    btn.addEventListener('click', () => selectIndex(i));
    thumbButtons.push(btn);
    thumbRow.append(btn);
  });

  thumbRow.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      selectIndex(activeIndex + 1, { focus: true });
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      selectIndex(activeIndex - 1, { focus: true });
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectIndex(0, { focus: true });
    } else if (event.key === 'End') {
      event.preventDefault();
      selectIndex(list.length - 1, { focus: true });
    }
  });

  // Swipe support (touch devices) on the main slide.
  let touchStartX = null;
  main.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (touchStartX == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) selectIndex(activeIndex + (dx < 0 ? 1 : -1));
    touchStartX = null;
  }, { passive: true });

  root.append(main, thumbRow);
  render();

  root.setActiveByIndex = (index) => selectIndex(index);
  root.setOverrideImage = (imageLike) => {
    overrideImage = imageLike || null;
    render();
  };

  return root;
}
