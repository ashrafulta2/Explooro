/**
 * community.api.js — typed wrapper for the community timeline (/community/*, /admin/community/*).
 *
 * One place that knows the request/response shape (how-to-add-a-feature.md Step 8). Components never
 * call fetch; the mock/live switch and auth refresh live in core/api.js.
 */
import { api, ApiError, pickMessage } from '../core/api.js';

/** The message to show for a failed call, in the reader's language; '' when it was not an API error. */
export function errorText(err) {
  return err instanceof ApiError ? pickMessage(err) || '' : '';
}

/** Post type keys, as the API sends them. The tab filter and the composer both use these. */
export const POST_TYPES = ['REVIEW', 'UPDATE', 'IDEA', 'ANNOUNCEMENT'];

/** What each role may post: the API `kind` values, in composer order. Mirrors ROLE_POST in the server service. */
export const ROLE_KINDS = Object.freeze({
  customer: ['REVIEW'],
  supplier: ['NEW_ARRIVAL', 'RESTOCK', 'BULK_OFFER'],
  saler: ['USABILITY_TIP', 'CREATIVE_IDEA', 'PRODUCT_STORY'],
  admin: ['ANNOUNCEMENT', 'POLICY_NOTICE', 'FEATURED_PICK'],
  super_admin: ['ANNOUNCEMENT', 'POLICY_NOTICE', 'FEATURED_PICK'],
});

/**
 * What a post may carry. Mirrors server/src/services/communityPost.service.ts (LIMITS.media / .videos),
 * media.service.ts (image 8 MB, MAX_DIRECT_UPLOAD_BYTES for a video) and the detected types; the
 * server re-checks every one, so these only spare the member a wasted upload.
 * client/test/community.test.js pins them to the server source.
 */
export const POST_MEDIA = Object.freeze({
  maxFiles: 4,
  maxVideos: 1,
  maxImageBytes: 8 * 1024 * 1024,
  maxVideoBytes: 30 * 1024 * 1024,
  types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4'],
});

export const REPORT_REASONS = ['SPAM', 'FAKE_REVIEW', 'MISLEADING', 'OFFENSIVE', 'OTHER'];
export const AUDIENCES = ['EVERYONE', 'CUSTOMERS', 'SUPPLIERS', 'SHOP_PARTNERS'];

/**
 * @param {object} [opts]
 * @param {string} [opts.type]  REVIEW | UPDATE | IDEA | ANNOUNCEMENT, omitted for all
 * @param {string} [opts.role]  author role filter: customer | supplier | saler | admin
 * @param {'recent'|'top'} [opts.sort]
 * @param {boolean} [opts.mine] only the signed-in user's own posts
 * @returns {Promise<{posts: object[], counts: Record<string, number>, meta: object}>}
 */
export async function listPosts({ type, role, sort, mine, limit, offset } = {}) {
  const query = {};
  if (type) query.type = type;
  if (role) query.role = role;
  if (sort) query.sort = sort;
  if (mine) query.mine = '1';
  if (limit != null) query.limit = limit;
  if (offset != null) query.offset = offset;
  const { data, meta } = await api.get('/community/posts', { query });
  return { posts: data?.posts ?? [], counts: data?.counts ?? {}, meta: meta || {} };
}

/** What the signed-in author may attach a post to (delivered purchases, own products, store items). */
export async function getComposerProducts() {
  const { data } = await api.get('/community/composer/products');
  return { role: data?.role ?? null, items: data?.items ?? [] };
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads one photo or video for a post through the shared media pipeline (the server checks the
 * file's real type from its bytes). Returns the asset; its `id` goes in `media_ids` when the post is sent.
 * @returns {Promise<{id: number|string, mime_type: string, url?: string}>}
 */
export async function uploadPostMedia(file) {
  const res = await api.post('/media/direct', {
    purpose: 'COMMUNITY',
    filename: file.name,
    data_base64: await readAsDataUrl(file),
  });
  const asset = res?.asset ?? res?.data?.asset;
  if (!asset) throw new Error('Upload failed');
  return asset;
}

export async function createPost(body) {
  const { data } = await api.post('/community/posts', body);
  return data.post;
}

export async function createAnnouncement(body) {
  const { data } = await api.post('/community/announcements', body);
  return data.post;
}

/** @returns {Promise<{liked: boolean, like_count: number}>} */
export async function toggleLike(postId) {
  const { data } = await api.post(`/community/posts/${postId}/like`, {});
  return data;
}

/** @returns {Promise<{reported: boolean, already_reported: boolean, auto_hidden: boolean}>} */
export async function reportPost(postId, { reason, note } = {}) {
  const { data } = await api.post(`/community/posts/${postId}/report`, { reason, ...(note ? { note } : {}) });
  return data;
}

/** @returns {Promise<{items: object[], stats: object, threshold: number}>} */
export async function getQueue({ limit, offset } = {}) {
  const query = {};
  if (limit != null) query.limit = limit;
  if (offset != null) query.offset = offset;
  const { data } = await api.get('/admin/community/queue', { query });
  return data;
}

/**
 * Changes how many reports hide a post (community.settings.update). `reason` is at least 10 characters.
 * @returns {Promise<{auto_hide_report_threshold: number, previous: number}>}
 */
export async function updateThreshold(value, reason) {
  const { data } = await api.put('/admin/community/settings', { auto_hide_report_threshold: value, reason });
  return data;
}

/** @param {'KEEP'|'HIDE'|'REMOVE'} action */
export async function moderatePost(postId, action) {
  const { data } = await api.post(`/admin/community/posts/${postId}/moderate`, { action });
  return data;
}
