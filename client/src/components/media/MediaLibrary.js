/**
 * MediaLibrary.js — Reusable media library modal & browser (Prompt 4.2).
 */

import { Button } from '../ui/Button.js';
import { Modal } from '../ui/Modal.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';

export function openMediaLibrary({
  purpose = null,
  onSelect = () => {},
  trigger = null,
} = {}) {
  const isBn = getLanguage() === 'bn';
  // Filters Bar
  const filtersBar = document.createElement('div');
  filtersBar.className = 'media-library-filters';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'media-library-search';
  searchInput.placeholder = isBn ? 'মিডিয়া খুঁজুন…' : 'Search media by ref or name…';
  searchInput.setAttribute('aria-label', isBn ? 'মিডিয়া খুঁজুন' : 'Search media');

  const purposeSelect = document.createElement('select');
  purposeSelect.className = 'media-library-select';
  purposeSelect.setAttribute('aria-label', isBn ? 'মিডিয়া ফিল্টার' : 'Media filter');
  purposeSelect.innerHTML = `
    <option value="">${isBn ? 'সকল মিডিয়া' : 'All Purposes'}</option>
    <option value="PRODUCT" ${purpose === 'PRODUCT' ? 'selected' : ''}>Product</option>
    <option value="BANNER" ${purpose === 'BANNER' ? 'selected' : ''}>Banner</option>
    <option value="AVATAR" ${purpose === 'AVATAR' ? 'selected' : ''}>Avatar</option>
    <option value="STORE_LOGO" ${purpose === 'STORE_LOGO' ? 'selected' : ''}>Store Logo</option>
    <option value="REVIEW" ${purpose === 'REVIEW' ? 'selected' : ''}>Review</option>
  `;

  filtersBar.append(searchInput, purposeSelect);

  // Grid of Media Assets
  const grid = document.createElement('div');
  grid.className = 'media-library-grid';

  let selectedAsset = null;
  let assets = [];

  // Footer Actions
  const footer = document.createElement('div');
  footer.className = 'media-library-footer';

  const cancelBtn = Button({
    label: isBn ? 'বাতিল' : 'Cancel',
    variant: 'secondary',
    size: 'sm',
    onClick: close,
  });

  const selectBtn = Button({
    label: isBn ? 'নির্বাচন করুন' : 'Insert Selected',
    variant: 'primary',
    size: 'sm',
    onClick: () => {
      if (!selectedAsset) {
        toast.info(isBn ? 'একটি ছবি নির্বাচন করুন' : 'Please select an image first');
        return;
      }
      onSelect(selectedAsset);
      close();
    },
  });

  footer.append(cancelBtn, selectBtn);

  // WHY the shared Modal: the hand-rolled backdrop had no genie, Escape, focus trap or scroll lock.
  const content = document.createElement('div');
  content.className = 'media-library-content';
  content.append(filtersBar, grid);
  const modal = Modal({
    title: isBn ? 'মিডিয়া লাইব্রেরি' : 'Media Library',
    content,
    footer,
    size: 'lg',
    onClose: () => modal.remove(),
  });

  async function loadAssets() {
    grid.innerHTML = `<div class="media-library-empty">${isBn ? 'লোড হচ্ছে…' : 'Loading media…'}</div>`;
    try {
      const selectedPurpose = purposeSelect.value;
      const res = await api.get(`/media${selectedPurpose ? `?purpose=${selectedPurpose}` : ''}`);
      assets = res.assets || [];
      renderGrid();
    } catch {
      grid.innerHTML = `<div class="media-library-empty">${isBn ? 'মিডিয়া পাওয়া যায়নি' : 'No media assets found'}</div>`;
    }
  }

  function renderGrid() {
    const query = searchInput.value.toLowerCase().trim();
    const filtered = assets.filter((a) => !query || a.ref.toLowerCase().includes(query));

    if (filtered.length === 0) {
      grid.innerHTML = `<div class="media-library-empty">${isBn ? 'কোনো মিডিয়া পাওয়া যায়নি' : 'No media items match query'}</div>`;
      return;
    }

    grid.innerHTML = '';
    for (const asset of filtered) {
      const item = document.createElement('div');
      item.className = `media-library-item ${selectedAsset?.id === asset.id ? 'active' : ''}`;

      const img = document.createElement('img');
      img.src = asset.url;
      img.alt = asset.ref;

      const meta = document.createElement('div');
      meta.className = 'media-library-item__meta';
      meta.textContent = `${asset.width || '?'}×${asset.height || '?'} • ${asset.purpose}`;

      item.append(img, meta);

      item.addEventListener('click', () => {
        selectedAsset = asset;
        grid.querySelectorAll('.media-library-item').forEach((el) => el.classList.remove('active'));
        item.classList.add('active');
      });

      item.addEventListener('dblclick', () => {
        selectedAsset = asset;
        onSelect(selectedAsset);
        close();
      });

      grid.append(item);
    }
  }

  searchInput.addEventListener('input', renderGrid);
  purposeSelect.addEventListener('change', loadAssets);

  // Focus returns to the opener inside Modal (it restores previouslyFocused).
  function close() {
    modal.close(false);
  }

  loadAssets();
  modal.open(trigger);
}
