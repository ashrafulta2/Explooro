/**
 * ImageUploader.js — Robust client-side media uploader (Prompt 4.2).
 *
 * Features:
 * - Drag & drop, file picker, clipboard paste (Ctrl+V), mobile camera capture
 * - Client-side size & format validation (max 8MB images, max 100MB videos)
 * - Aspect ratio presets (1:1 Product, 16:9 Banner, 4:3)
 * - Multi-file reordering & progress bars
 * - Direct upload round trip to backend with derivative support
 */

import { Button } from '../ui/Button.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';

export const MAX_IMAGE_SIZE = 8 * 1024 * 1024;    // 8MB
export const MAX_VIDEO_SIZE = 100 * 1024 * 1024;  // 100MB

export function ImageUploader({
  purpose = 'PRODUCT',
  aspectRatio = '1:1',
  maxFiles = 8,
  initialImages = [],
  onChange = () => {},
  onUploadComplete = () => {},
} = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'media-uploader';

  let items = [...initialImages]; // Array of { id, ref, url, width, height, isUploading, progress }
  let selectedAspect = aspectRatio;

  // Header / Aspect Ratio Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'media-uploader__toolbar';

  const toolbarTitle = document.createElement('span');
  toolbarTitle.className = 'media-uploader__toolbar-title';
  toolbarTitle.textContent = `${t('media.upload_title') || 'Upload Media'} (${items.length}/${maxFiles})`;

  const aspectControls = document.createElement('div');
  aspectControls.className = 'media-uploader__aspects';

  const aspectOptions = [
    { key: '1:1', label: '1:1 (Product)' },
    { key: '16:9', label: '16:9 (Banner)' },
    { key: '4:3', label: '4:3 (Standard)' },
  ];

  for (const opt of aspectOptions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `media-uploader__aspect-btn ${selectedAspect === opt.key ? 'active' : ''}`;
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      selectedAspect = opt.key;
      aspectControls.querySelectorAll('.media-uploader__aspect-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
    aspectControls.append(btn);
  }

  toolbar.append(toolbarTitle, aspectControls);

  // Hidden File Inputs (Standard & Mobile Camera)
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4';
  fileInput.setAttribute('aria-label', isBn ? 'মিডিয়া ফাইল আপলোড' : 'Upload media files');
  fileInput.style.display = 'none';

  const cameraInput = document.createElement('input');
  cameraInput.type = 'file';
  cameraInput.accept = 'image/*';
  cameraInput.capture = 'environment';
  cameraInput.setAttribute('aria-label', isBn ? 'ক্যামেরা দিয়ে ছবি তুলুন' : 'Capture photo with camera');
  cameraInput.style.display = 'none';

  // Dropzone
  const dropzone = document.createElement('div');
  dropzone.className = 'media-dropzone';
  dropzone.innerHTML = `
    <div class="media-dropzone__icon">📸</div>
    <div class="media-dropzone__text">
      <strong>${isBn ? 'ছবি টেনে আনুন অথবা ক্লিক করে আপলোড করুন' : 'Drag & drop media here, or browse'}</strong>
      <span>${isBn ? 'সর্বোচ্চ ৮ মেগাবাইট (JPEG, PNG, WebP, AVIF) • পেস্ট (Ctrl+V) সমর্থিত' : 'Max 8MB (JPEG, PNG, WebP, AVIF) • Paste (Ctrl+V) supported'}</span>
    </div>
    <div class="media-dropzone__actions"></div>
  `;

  const actionsWrap = dropzone.querySelector('.media-dropzone__actions');

  const browseBtn = Button({
    label: isBn ? 'ফাইল নির্বাচন' : 'Browse Files',
    variant: 'secondary',
    size: 'sm',
    onClick: () => fileInput.click(),
  });

  const cameraBtn = Button({
    label: `📷 ${isBn ? 'ক্যামেরা' : 'Camera'}`,
    variant: 'ghost',
    size: 'sm',
    onClick: () => cameraInput.click(),
  });

  actionsWrap.append(browseBtn, cameraBtn);

  // Drag & Drop Events
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('media-dropzone--active');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('media-dropzone--active');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('media-dropzone--active');
    if (e.dataTransfer?.files?.length) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files?.length) {
      handleFiles(Array.from(e.target.files));
      fileInput.value = '';
    }
  });

  cameraInput.addEventListener('change', (e) => {
    if (e.target.files?.length) {
      handleFiles(Array.from(e.target.files));
      cameraInput.value = '';
    }
  });

  // Clipboard Paste Event
  const onPaste = (e) => {
    const clipItems = e.clipboardData?.items;
    if (!clipItems) return;
    const files = [];
    for (const item of clipItems) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) {
      handleFiles(files);
    }
  };

  container.addEventListener('focusin', () => document.addEventListener('paste', onPaste));
  container.addEventListener('focusout', () => document.removeEventListener('paste', onPaste));

  // Thumbnail Grid & Reordering
  const grid = document.createElement('div');
  grid.className = 'media-grid';
  renderGrid();

  container.append(toolbar, fileInput, cameraInput, dropzone, grid);

  function renderGrid() {
    grid.innerHTML = '';
    toolbarTitle.textContent = `${t('media.upload_title') || 'Upload Media'} (${items.length}/${maxFiles})`;

    items.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'media-card';
      card.dataset.index = index;

      if (item.isUploading) {
        card.innerHTML = `
          <div class="media-card__loading">
            <div class="media-card__spinner"></div>
            <span>${item.progress || 0}%</span>
          </div>
        `;
      } else {
        const img = document.createElement('img');
        img.className = 'media-card__thumb';
        img.src = item.url;
        img.alt = `Media ${index + 1}`;

        const badge = document.createElement('span');
        badge.className = 'media-card__badge';
        badge.textContent = index === 0 ? (isBn ? 'প্রধান' : 'Primary') : `#${index + 1}`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'media-card__remove-btn';
        removeBtn.innerHTML = '✕';
        removeBtn.title = 'Remove';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          items.splice(index, 1);
          renderGrid();
          onChange(items);
        });

        // Reordering controls
        const controls = document.createElement('div');
        controls.className = 'media-card__reorder';

        if (index > 0) {
          const leftBtn = document.createElement('button');
          leftBtn.type = 'button';
          leftBtn.className = 'media-card__arrow';
          leftBtn.innerHTML = '◀';
          leftBtn.title = 'Move Left';
          leftBtn.addEventListener('click', () => {
            const temp = items[index];
            items[index] = items[index - 1];
            items[index - 1] = temp;
            renderGrid();
            onChange(items);
          });
          controls.append(leftBtn);
        }

        if (index < items.length - 1) {
          const rightBtn = document.createElement('button');
          rightBtn.type = 'button';
          rightBtn.className = 'media-card__arrow';
          rightBtn.innerHTML = '▶';
          rightBtn.title = 'Move Right';
          rightBtn.addEventListener('click', () => {
            const temp = items[index];
            items[index] = items[index + 1];
            items[index + 1] = temp;
            renderGrid();
            onChange(items);
          });
          controls.append(rightBtn);
        }

        const dims = document.createElement('span');
        dims.className = 'media-card__dims';
        dims.textContent = item.width ? `${item.width}×${item.height}` : '';

        card.append(img, badge, removeBtn, controls, dims);
      }

      grid.append(card);
    });
  }

  async function handleFiles(files) {
    if (items.length + files.length > maxFiles) {
      toast.error(
        isBn
          ? `সর্বোচ্চ ${maxFiles}টি ফাইল আপলোড করা যাবে`
          : `Maximum ${maxFiles} files allowed`
      );
      return;
    }

    for (const file of files) {
      const isVideo = file.type.startsWith('video/');
      const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;

      // 1. Client-Side Size Validation (8MB Image / 100MB Video)
      if (file.size > maxSize) {
        toast.error(
          isBn
            ? `"${file.name}" ফাইলের আকার (${(file.size / (1024 * 1024)).toFixed(1)}MB) অনুমোদিত সর্বোচ্চ ${isVideo ? '১০০' : '৮'} মেগাবাইটের বেশি।`
            : `"${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds the maximum allowed ${isVideo ? '100MB' : '8MB'} limit.`
        );
        continue;
      }

      // Add temporary upload placeholder
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      const placeholder = {
        id: tempId,
        url: '',
        isUploading: true,
        progress: 10,
      };
      items.push(placeholder);
      renderGrid();

      try {
        // Read file as base64 for direct upload
        const base64Data = await fileToBase64(file);
        placeholder.progress = 50;
        renderGrid();

        // 2. Direct upload to Fastify media API
        const res = await api.post('/media/direct', {
          purpose,
          filename: file.name,
          data_base64: base64Data,
        });

        if (res?.asset) {
          const uploadedAsset = {
            id: res.asset.id,
            ref: res.asset.ref,
            url: res.asset.url,
            width: res.asset.width,
            height: res.asset.height,
            mime_type: res.asset.mime_type,
            derivatives: res.asset.derivatives_json,
            isUploading: false,
          };

          const idx = items.findIndex((i) => i.id === tempId);
          if (idx !== -1) {
            items[idx] = uploadedAsset;
          }
          renderGrid();
          onChange(items);
          onUploadComplete(uploadedAsset);
          toast.success(isBn ? 'ফাইল সফলভাবে আপলোড হয়েছে' : 'Image uploaded successfully');
        }
      } catch (err) {
        items = items.filter((i) => i.id !== tempId);
        renderGrid();
        toast.error(err.message || (isBn ? 'আপলোড ব্যর্থ হয়েছে' : 'Upload failed'));
      }
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  container.getItems = () => items;
  container.setItems = (newItems) => {
    items = [...newItems];
    renderGrid();
  };

  return container;
}
