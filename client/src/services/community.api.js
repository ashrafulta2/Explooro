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

/** @param {'KEEP'|'HIDE'|'REMOVE'} action */
export async function moderatePost(postId, action) {
  const { data } = await api.post(`/admin/community/posts/${postId}/moderate`, { action });
  return data;
}
