/**
 * community.api.ts — typed wrapper for the community timeline (/community/*, /admin/community/*).
 *
 * One place that knows the request/response shape (how-to-add-a-feature.md Step 8). Components never
 * call fetch; the mock/live switch and auth refresh live in core/api.ts.
 */
import { api, ApiError, pickMessage } from '../core/api.ts';

/** A request body or query string; the fields are the server's, passed through untouched. */
type Params = Record<string, any>;

/** The author block of a post or comment. */
export interface CommunityAuthor {
  name: string;
  role: string;
  initials?: string;
}

/** The product a post is about, as the API attaches it. */
export interface CommunityProduct {
  ref?: string;
  image_url?: string | null;
  price?: number | string | null;
  title_en?: string;
  title_bn?: string;
  rating_avg?: number | null;
  rating_count?: number;
  sold_count?: number;
  category_en?: string;
  category_bn?: string;
  availability?: 'IN' | 'LOW' | 'OUT' | string;
  supplier_name?: string;
}

/** A photo or video on a post. */
export interface CommunityMedia {
  url: string;
  kind?: 'VIDEO' | 'IMAGE' | string;
}

/** A serialized post from GET /community/posts. `details` depends on the post type. */
export interface CommunityPost {
  id: number | string;
  type: string;
  kind?: string;
  title?: string;
  body?: string;
  author: CommunityAuthor;
  created_at?: string;
  details?: Record<string, any>;
  product?: CommunityProduct | null;
  media?: CommunityMedia[];
  like_count?: number;
  comment_count?: number;
  liked_by_me?: boolean;
  saved_by_me?: boolean;
  is_mine?: boolean;
  is_pinned?: boolean;
  verified_purchase?: boolean;
}

/** One comment under a post. */
export interface CommunityComment {
  id: number | string;
  body: string;
  author: CommunityAuthor;
  created_at?: string;
  is_mine?: boolean;
}

/** The message to show for a failed call, in the reader's language; '' when it was not an API error. */
export function errorText(err: unknown): string {
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

/** Mirrors LIMITS.comment in server/src/services/communityPost.service.ts (client/test pins them). */
export const COMMENT_MAX = 1000;

export const REPORT_REASONS = ['SPAM', 'FAKE_REVIEW', 'MISLEADING', 'OFFENSIVE', 'OTHER'];
export const AUDIENCES = ['EVERYONE', 'CUSTOMERS', 'SUPPLIERS', 'SHOP_PARTNERS'];

/**
 * @param {object} [opts]
 * @param {string} [opts.type]  REVIEW | UPDATE | IDEA | ANNOUNCEMENT, omitted for all
 * @param {string} [opts.role]  author role filter: customer | supplier | saler | admin
 * @param {'recent'|'top'} [opts.sort]
 * @param {boolean} [opts.mine] only the signed-in user's own posts
 * @param {boolean} [opts.saved] only the posts the signed-in user saved (private list)
 * @param {number} [opts.postId] just this one post (a shared link or a notification)
 * @returns {Promise<{posts: object[], counts: Record<string, number>, meta: object}>}
 */
export interface ListPostsOptions {
  type?: string;
  role?: string;
  sort?: string;
  mine?: boolean;
  saved?: boolean;
  /** Just this one post (a shared link or a notification). */
  postId?: number | string;
  limit?: number;
  offset?: number;
}

export async function listPosts({ type, role, sort, mine, saved, postId, limit, offset }: ListPostsOptions = {}) {
  const query: Record<string, unknown> = {};
  if (type) query.type = type;
  if (role) query.role = role;
  if (sort) query.sort = sort;
  if (mine) query.mine = '1';
  if (saved) query.saved = '1';
  if (postId) query.post_id = postId;
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

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads one photo or video for a post through the shared media pipeline (the server checks the
 * file's real type from its bytes). Returns the asset; its `id` goes in `media_ids` when the post is sent.
 * @returns {Promise<{id: number|string, mime_type: string, url?: string}>}
 */
export async function uploadPostMedia(file: File) {
  const res = await api.post('/media/direct', {
    purpose: 'COMMUNITY',
    filename: file.name,
    data_base64: await readAsDataUrl(file),
  });
  const asset = res?.asset ?? res?.data?.asset;
  if (!asset) throw new Error('Upload failed');
  return asset;
}

export async function createPost(body: Params) {
  const { data } = await api.post('/community/posts', body);
  return data.post;
}

export async function createAnnouncement(body: Params) {
  const { data } = await api.post('/community/announcements', body);
  return data.post;
}

/** @returns {Promise<{liked: boolean, like_count: number}>} */
export async function toggleLike(postId: number | string) {
  const { data } = await api.post(`/community/posts/${postId}/like`, {});
  return data;
}

/** Adds the post to the member's private saved list, or takes it off. @returns {Promise<{saved: boolean}>} */
export async function toggleSave(postId: number | string) {
  const { data } = await api.post(`/community/posts/${postId}/save`, {});
  return data;
}

/** @returns {Promise<{reported: boolean, already_reported: boolean, auto_hidden: boolean}>} */
export async function reportPost(postId: number | string, { reason, note }: { reason?: string; note?: string } = {}) {
  const { data } = await api.post(`/community/posts/${postId}/report`, { reason, ...(note ? { note } : {}) });
  return data;
}

/** @returns {Promise<{items: object[], stats: object, threshold: number}>} */
export async function getQueue({ limit, offset }: { limit?: number; offset?: number } = {}) {
  const query: Record<string, unknown> = {};
  if (limit != null) query.limit = limit;
  if (offset != null) query.offset = offset;
  const { data } = await api.get('/admin/community/queue', { query });
  return data;
}

/**
 * Changes how many reports hide a post (community.settings.update). `reason` is at least 10 characters.
 * @returns {Promise<{auto_hide_report_threshold: number, previous: number}>}
 */
export async function updateThreshold(value: number, reason: string) {
  const { data } = await api.put('/admin/community/settings', { auto_hide_report_threshold: value, reason });
  return data;
}

/** @returns {Promise<{comments: object[], comment_count: number, meta: object}>} */
export async function listComments(postId: number | string, { limit, offset }: { limit?: number; offset?: number } = {}) {
  const query: Record<string, unknown> = {};
  if (limit != null) query.limit = limit;
  if (offset != null) query.offset = offset;
  const { data, meta } = await api.get(`/community/posts/${postId}/comments`, { query });
  return { comments: data?.comments ?? [], comment_count: data?.comment_count ?? 0, meta: meta || {} };
}

/** @returns {Promise<{comment: object, comment_count: number}>} */
export async function addComment(postId: number | string, body: string) {
  const { data } = await api.post(`/community/posts/${postId}/comments`, { body });
  return data;
}

/** A member deletes their own comment. @returns {Promise<{comment_count: number}>} */
export async function deleteComment(commentId: number | string) {
  const { data } = await api.delete(`/community/comments/${commentId}`);
  return data;
}

/** Staff remove any comment (community.post.moderate). @returns {Promise<{comment_count: number}>} */
export async function removeComment(commentId: number | string) {
  const { data } = await api.post(`/admin/community/comments/${commentId}/remove`, {});
  return data;
}

/** @param {'KEEP'|'HIDE'|'REMOVE'} action */
export type ModerationAction = 'KEEP' | 'HIDE' | 'REMOVE';

export async function moderatePost(postId: number | string, action: ModerationAction) {
  const { data } = await api.post(`/admin/community/posts/${postId}/moderate`, { action });
  return data;
}
