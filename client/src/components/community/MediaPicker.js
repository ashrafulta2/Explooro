/**
 * MediaPicker — attach photos or one video to a post.
 *
 * A file is checked here (type, size, how many), uploaded the moment it is picked, and shown as a
 * tile with a remove button. The post only ever sends the ids of files that finished uploading.
 *
 * Invariants:
 *  - The limits come from POST_MEDIA, which mirrors the server; the server re-checks them all, so
 *    this component only spares a wasted upload and can never widen what a post may carry.
 *  - `isBusy()` is true while any upload is running. The composer disables Publish on it, so a post
 *    can never be sent with a file that is still on its way (which would silently drop the file).
 *  - A tile removed while its upload is in flight is forgotten: its id never reaches `getIds()`.
 *  - Preview URLs are object URLs, released when a tile goes away.
 */
import { el, icon } from './dom.ts';
import { Button } from '../ui/Button.ts';
import { t } from '../../services/i18n.js';
import { formatNumber } from '../../services/format.js';
import { POST_MEDIA, uploadPostMedia, errorText } from '../../services/community.api.ts';

const MB = 1024 * 1024;

/**
 * Pure: why a file may not be added, or null. `existing` is the files already on the post.
 * Returned as an i18n key plus its parameters so the message is in the reader's language.
 */
export function checkNewFile(file, existing) {
  if (!POST_MEDIA.types.includes(file.type)) return { key: 'community.media.error.bad_type', params: { name: file.name } };
  if (existing.length >= POST_MEDIA.maxFiles) return { key: 'community.media.error.too_many', params: { max: formatNumber(POST_MEDIA.maxFiles) } };
  const isVideo = file.type.startsWith('video/');
  if (isVideo && existing.filter((f) => f.isVideo).length >= POST_MEDIA.maxVideos) return { key: 'community.media.error.one_video', params: {} };
  const limit = isVideo ? POST_MEDIA.maxVideoBytes : POST_MEDIA.maxImageBytes;
  if (file.size > limit) {
    return { key: `community.media.error.too_large_${isVideo ? 'video' : 'image'}`, params: { name: file.name, mb: formatNumber(limit / MB) } };
  }
  return null;
}

/**
 * @param {object} [o]
 * @param {(busy:boolean)=>void} [o.onBusyChange]
 * @returns {HTMLElement & {getIds:()=>Array<number|string>, isBusy:()=>boolean}}
 */
export function MediaPicker({ onBusyChange } = {}) {
  const root = el('div', 'cm-media-picker');
  const tiles = el('div', 'cm-media-picker__tiles');
  const message = el('p', 'cm-media-picker__message', '', { role: 'alert' });
  const input = el('input', 'cm-media-picker__input', null, { type: 'file', multiple: true, accept: POST_MEDIA.types.join(','), tabindex: '-1' });
  const addBtn = Button({ label: t('community.media.add'), variant: 'secondary', size: 'sm', iconLeft: icon('image'), onClick: () => input.click() });
  const drop = el('div', 'cm-media-picker__drop', [
    addBtn,
    el('span', 'cm-media-picker__hint', t('community.media.hint', {
      max: formatNumber(POST_MEDIA.maxFiles), img: formatNumber(POST_MEDIA.maxImageBytes / MB), vid: formatNumber(POST_MEDIA.maxVideoBytes / MB),
    })),
  ]);
  root.append(drop, message, tiles);
  root.append(input);

  /** @type {Array<{key:string, name:string, isVideo:boolean, previewUrl:string, id:(number|string|null), uploading:boolean, node:HTMLElement}>} */
  let files = [];
  let busy = false;

  function syncBusy() {
    const now = files.some((f) => f.uploading);
    if (now !== busy) {
      busy = now;
      onBusyChange?.(busy);
    }
    addBtn.disabled = files.length >= POST_MEDIA.maxFiles;
  }

  function drawTile(f) {
    const preview = f.isVideo
      ? el('video', 'cm-media-picker__thumb', null, { src: f.previewUrl, muted: true, preload: 'metadata', playsinline: true, 'aria-hidden': 'true' })
      : el('img', 'cm-media-picker__thumb', null, { src: f.previewUrl, alt: '' });
    const remove = el('button', 'cm-media-picker__remove', '×', { type: 'button', 'aria-label': t('community.media.remove', { name: f.name }) });
    remove.addEventListener('click', () => discard(f));
    const parts = [preview, remove];
    if (f.isVideo) parts.push(el('span', 'cm-media-picker__badge', t('community.media.video')));
    if (f.uploading) parts.push(el('span', 'cm-media-picker__busy', t('community.media.uploading')));
    f.node.replaceChildren(...parts);
    f.node.classList.toggle('cm-media-picker__tile--busy', f.uploading);
  }

  function discard(f) {
    URL.revokeObjectURL(f.previewUrl);
    f.node.remove();
    files = files.filter((x) => x !== f);
    syncBusy();
  }

  async function add(list) {
    message.textContent = '';
    for (const file of list) {
      const problem = checkNewFile(file, files);
      if (problem) {
        message.textContent = t(problem.key, problem.params);
        continue;
      }
      const f = {
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        isVideo: file.type.startsWith('video/'),
        previewUrl: URL.createObjectURL(file),
        id: null,
        uploading: true,
        node: el('div', 'cm-media-picker__tile'),
      };
      files.push(f);
      tiles.append(f.node);
      drawTile(f);
      syncBusy();
      // Not awaited one by one: every picked file uploads at once.
      uploadPostMedia(file).then((asset) => {
        if (!files.includes(f)) return; // removed while it uploaded
        f.id = asset.id;
        f.uploading = false;
        drawTile(f);
        syncBusy();
      }).catch((err) => {
        if (!files.includes(f)) return;
        message.textContent = errorText(err) || t('community.media.error.failed', { name: f.name });
        discard(f);
      });
    }
  }

  input.addEventListener('change', () => {
    const picked = [...input.files];
    input.value = '';
    add(picked);
  });

  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('cm-media-picker__drop--over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, () => drop.classList.remove('cm-media-picker__drop--over'));
  }
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    add([...(e.dataTransfer?.files ?? [])]);
  });

  root.getIds = () => files.filter((f) => f.id !== null && !f.uploading).map((f) => f.id);
  root.isBusy = () => busy;
  return root;
}
