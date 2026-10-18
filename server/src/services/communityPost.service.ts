/**
 * communityPost.service.ts — the community timeline: role-specific posts, likes, reports, moderation.
 *
 * Rules this file owns:
 *   - What each role may post is decided here, from the account's roles, never from the request:
 *     customer → REVIEW (verified purchase only), supplier → UPDATE, shop partner → IDEA,
 *     admin → ANNOUNCEMENT. A body that names another type is refused.
 *   - A post goes live at once. A post that reaches the auto-hide threshold (configuration:
 *     `community.auto_hide_report_threshold`) is hidden until a moderator decides.
 *   - One report per person per post, and nobody reports their own post.
 *
 * Invariant: `community_posts.like_count` always equals the rows in `community_post_likes`
 * (recomputed from the table on every toggle, never incremented in memory).
 */

import { withTransaction } from '../config/db.ts';
import { AppError } from '../plugins/errorHandler.ts';
import { generateRef } from '../lib/ref.ts';
import { writeAudit } from '../lib/audit.ts';
import * as repo from '../repositories/communityPost.repository.ts';
import * as settingRepo from '../repositories/setting.repository.ts';
import { getStorageDriver } from '../integrations/storage/index.ts';
import * as notices from './communityNotify.service.ts';

export const SETTINGS_GROUP = 'community';
export const THRESHOLD_KEY = 'community.auto_hide_report_threshold';
export const THRESHOLD_LIMITS = Object.freeze({ min: 2, max: 50, fallback: 5 });

// WHY these are constants and not settings: they are input-shape limits that stop an absurd payload,
// not business decisions. The business numbers (the report threshold) are configuration.
export const LIMITS = Object.freeze({
  text: 1000, tip: 300, title: 120, body: 2000, step: 200, steps: 8, tags: 5, tag: 30, tiers: 5,
  shipsFrom: 40, media: 4, videos: 1, comment: 1000,
});

export const ROLE_POST = Object.freeze({
  customer: { type: 'REVIEW', kinds: ['REVIEW'] },
  supplier: { type: 'UPDATE', kinds: ['NEW_ARRIVAL', 'RESTOCK', 'BULK_OFFER'] },
  saler: { type: 'IDEA', kinds: ['USABILITY_TIP', 'CREATIVE_IDEA', 'PRODUCT_STORY'] },
  admin: { type: 'ANNOUNCEMENT', kinds: ['ANNOUNCEMENT', 'POLICY_NOTICE', 'FEATURED_PICK'] },
});

export const REPORT_REASONS = ['SPAM', 'FAKE_REVIEW', 'MISLEADING', 'OFFENSIVE', 'OTHER'];
export const MODERATE_ACTIONS = ['KEEP', 'HIDE', 'REMOVE'];
const AUDIENCES = ['EVERYONE', 'CUSTOMERS', 'SUPPLIERS', 'SHOP_PARTNERS'];
const STAFF_ROLES = ['admin', 'super_admin', 'moderator', 'editor'];

function fail(field, en, bn) {
  return new AppError('VALIDATION_FAILED', en, bn, { field });
}

function text(v, field, max, { required = false } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) {
    if (required) throw fail(field, `${field} is required.`, 'এই ঘরটি পূরণ করা আবশ্যক।');
    return null;
  }
  if (s.length > max) throw fail(field, `${field} must be at most ${max} characters.`, `সর্বোচ্চ ${max} অক্ষর লেখা যাবে।`);
  return s;
}

function int(v, field, min, max, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw fail(field, `${field} is required.`, 'এই ঘরটি পূরণ করা আবশ্যক।');
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw fail(field, `${field} must be a whole number from ${min} to ${max}.`, `${min} থেকে ${max} এর মধ্যে পূর্ণসংখ্যা দিন।`);
  }
  return n;
}

function money(v, field, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw fail(field, `${field} is required.`, 'এই ঘরটি পূরণ করা আবশ্যক।');
    return null;
  }
  const n = Number(v);
  // Whole paisa only, like every other money input in the platform.
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000 || Math.round(n * 100) !== n * 100) {
    throw fail(field, `${field} must be a valid amount.`, 'সঠিক টাকার পরিমাণ দিন।');
  }
  return n;
}

/** The post type an account may write, taken from its roles. Admin comes first so staff who also hold another role post as staff. */
export function resolveAuthorRole(roles: string[] = []) {
  if (roles.includes('admin') || roles.includes('super_admin')) return 'admin';
  for (const r of ['customer', 'supplier', 'saler']) if (roles.includes(r)) return r;
  return null;
}

/**
 * Pure, so the API and the tests assert one rule. Returns the normalised fields to store, or throws
 * VALIDATION_FAILED. Product ownership and proof of purchase are checked by the caller against the
 * database; this only checks shape.
 */
export function validateDraft(authorRole, input: Record<string, any> = {}) {
  const spec = ROLE_POST[authorRole];
  if (!spec) throw new AppError('FORBIDDEN', 'Your account cannot post here.', 'আপনার অ্যাকাউন্ট থেকে এখানে পোস্ট করা যায় না।');
  const kind = String(input.kind || spec.kinds[0]).toUpperCase();
  if (!spec.kinds.includes(kind)) {
    throw fail('kind', 'This post kind is not available for your account.', 'এই ধরনের পোস্ট আপনার অ্যাকাউন্টের জন্য নয়।');
  }
  const d = input.details && typeof input.details === 'object' ? input.details : {};

  if (spec.type === 'REVIEW') {
    const liked = text(d.liked, 'liked', LIMITS.text);
    const improve = text(d.could_improve, 'could_improve', LIMITS.text);
    if (!liked && !improve) {
      throw fail('liked', 'Tell other buyers what you liked or what could be better.', 'কী ভালো লেগেছে বা কী ভালো হতে পারত, অন্তত একটি লিখুন।');
    }
    return { kind, title: null, body: null, audience: 'EVERYONE', isPinned: false, details: {
      rating: int(d.rating, 'rating', 1, 5, { required: true }),
      quality: int(d.quality, 'quality', 1, 5),
      value: int(d.value, 'value', 1, 5),
      delivery: int(d.delivery, 'delivery', 1, 5),
      liked, could_improve: improve, tip: text(d.tip, 'tip', LIMITS.tip),
    } };
  }

  if (spec.type === 'UPDATE') {
    const tiers = (Array.isArray(d.tiers) ? d.tiers : []).slice(0, LIMITS.tiers).map((t, i) => ({
      min_qty: int(t?.min_qty, `tiers[${i}].min_qty`, 1, 1_000_000, { required: true }),
      price: money(t?.price, `tiers[${i}].price`, { required: true }),
    }));
    const wholesale = money(d.wholesale_price, 'wholesale_price', { required: true });
    return { kind, title: null, body: text(input.body, 'body', LIMITS.body, { required: true }),
      audience: 'SHOP_PARTNERS', isPinned: false, details: {
        stock: int(d.stock, 'stock', 0, 10_000_000, { required: true }),
        min_order: int(d.min_order, 'min_order', 1, 1_000_000, { required: true }),
        wholesale_price: wholesale,
        best_price: Math.min(wholesale, ...tiers.map((t) => t.price)),
        ships_from: text(d.ships_from, 'ships_from', LIMITS.shipsFrom),
        tiers,
      } };
  }

  if (spec.type === 'IDEA') {
    const steps = (Array.isArray(d.steps) ? d.steps : [])
      .map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
    if (!steps.length) throw fail('steps', 'Add at least one step or idea.', 'অন্তত একটি ধাপ বা আইডিয়া যোগ করুন।');
    if (steps.length > LIMITS.steps || steps.some((s) => s.length > LIMITS.step)) {
      throw fail('steps', `Use at most ${LIMITS.steps} steps of ${LIMITS.step} characters.`, `সর্বোচ্চ ${LIMITS.steps}টি ধাপ, প্রতিটি ${LIMITS.step} অক্ষরের মধ্যে।`);
    }
    const tags = (Array.isArray(d.tags) ? d.tags : [])
      .map((s) => (typeof s === 'string' ? s.trim().replace(/^#/, '') : '')).filter(Boolean);
    if (tags.length > LIMITS.tags || tags.some((s) => s.length > LIMITS.tag)) {
      throw fail('tags', `Use at most ${LIMITS.tags} short tags.`, `সর্বোচ্চ ${LIMITS.tags}টি ছোট ট্যাগ দিন।`);
    }
    return { kind, title: text(input.title, 'title', LIMITS.title, { required: true }),
      body: text(input.body, 'body', LIMITS.body), audience: 'EVERYONE', isPinned: false,
      details: { steps, tags } };
  }

  const audience = String(input.audience || 'EVERYONE').toUpperCase();
  if (!AUDIENCES.includes(audience)) throw fail('audience', 'Choose who can see this.', 'কারা দেখবে তা বেছে নিন।');
  return { kind, title: text(input.title, 'title', LIMITS.title, { required: true }),
    body: text(input.body, 'body', LIMITS.body, { required: true }), audience,
    isPinned: input.is_pinned === true, details: {} };
}

/** Which audiences a viewer may see. Staff see all; a guest sees only posts meant for everyone. */
export function visibleAudiences(roles: string[] = []) {
  if (roles.some((r) => STAFF_ROLES.includes(r))) return AUDIENCES;
  const out = ['EVERYONE'];
  if (roles.includes('customer')) out.push('CUSTOMERS');
  if (roles.includes('supplier')) out.push('SUPPLIERS');
  if (roles.includes('saler')) out.push('SHOP_PARTNERS');
  return out;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/**
 * Pure. The media ids a post names: a short list of distinct whole numbers. Whether they may be
 * attached (yours, uploaded for the community, unused) is the database's answer, in attachMedia below.
 */
export function validateMediaIds(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw fail('media_ids', 'Attach photos or a video from your uploads.', 'আপলোড করা ছবি বা ভিডিও যুক্ত করুন।');
  const ids = raw.map((v) => Number(v));
  if (ids.some((n) => !Number.isInteger(n) || n < 1)) {
    throw fail('media_ids', 'One of the attached files is not valid.', 'যুক্ত করা একটি ফাইল সঠিক নয়।');
  }
  if (new Set(ids).size !== ids.length) {
    throw fail('media_ids', 'The same file is attached twice.', 'একই ফাইল দুইবার যুক্ত করা হয়েছে।');
  }
  if (ids.length > LIMITS.media) {
    throw fail('media_ids', `Attach at most ${LIMITS.media} files.`, `সর্বোচ্চ ${LIMITS.media}টি ফাইল যুক্ত করা যাবে।`);
  }
  return ids;
}

/** The kind of a stored file, from its detected MIME type. */
export const mediaKind = (mimeType) => (String(mimeType).startsWith('video/') ? 'VIDEO' : 'IMAGE');

/**
 * Checks the files against the database and the one-video rule, then joins them to the post. Runs in
 * the post's transaction so a failure leaves no post behind with half its files.
 */
async function attachPostMedia(client, userId, postId, mediaIds) {
  if (!mediaIds.length) return;
  const usable = await repo.lockUsableMedia(client, userId, mediaIds);
  if (usable.length !== mediaIds.length) {
    throw fail('media_ids', 'One of the files cannot be used. Upload it again.', 'একটি ফাইল ব্যবহার করা যাচ্ছে না। আবার আপলোড করুন।');
  }
  if (usable.filter((m) => mediaKind(m.mime_type) === 'VIDEO').length > LIMITS.videos) {
    throw fail('media_ids', 'A post can have one video.', 'একটি পোস্টে একটি ভিডিও দেওয়া যাবে।');
  }
  await repo.attachMedia(client, postId, mediaIds);
}

/** Serialises a page of posts with their files (one extra query for the whole page). */
async function serializeWithMedia(db, rows, extra = (r) => ({})) {
  const files = await repo.listMediaForPosts(db, rows.map((r) => r.id));
  const byPost = new Map();
  for (const f of files) {
    if (!byPost.has(f.post_id)) byPost.set(f.post_id, []);
    byPost.get(f.post_id).push({
      id: f.id, kind: mediaKind(f.mime_type), mime_type: f.mime_type,
      url: getStorageDriver().getPublicUrl(f.storage_key), width: f.width, height: f.height,
    });
  }
  return rows.map((r) => ({ ...serializePost(r, byPost.get(r.id) ?? []), ...extra(r) }));
}

export function serializePost(row, media = []) {
  return {
    id: row.id,
    ref: row.ref,
    type: row.post_type,
    kind: row.kind,
    title: row.title,
    body: row.body,
    details: row.details ?? {},
    audience: row.audience,
    is_pinned: row.is_pinned,
    status: row.status,
    created_at: row.created_at,
    like_count: row.like_count,
    comment_count: row.comment_count ?? 0,
    media,
    liked_by_me: !!row.liked_by_me,
    saved_by_me: !!row.saved_by_me,
    is_mine: !!row.is_mine,
    open_report_count: row.open_report_count ?? 0,
    // Verified purchase is a fact about the stored proof of purchase, never a flag the author sends.
    verified_purchase: row.post_type === 'REVIEW' && row.order_item_id != null,
    author: { id: row.author_id, role: row.author_role, name: row.author_name ?? '—', initials: initials(row.author_name) },
    product: row.product_id == null ? null : {
      id: row.product_id, ref: row.product_ref, slug: row.product_slug,
      title_en: row.product_title_en, title_bn: row.product_title_bn, price: row.product_price,
    },
  };
}

const THRESHOLD_META = {
  valueType: 'NUMBER',
  labelEn: 'Reports that auto-hide a community post',
  labelBn: 'যতগুলো রিপোর্টে কমিউনিটি পোস্ট নিজে থেকে লুকানো হয়',
};

/**
 * Pure. The threshold must be a whole number inside THRESHOLD_LIMITS. Strict: out of range is refused,
 * never clamped, so an admin who types 500 is told, not silently given 50. (The reader above is
 * forgiving on purpose: a bad stored value falls back so reporting never breaks.)
 */
export function validateThreshold(value) {
  const { min, max } = THRESHOLD_LIMITS;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new AppError('VALIDATION_FAILED', `Enter a whole number from ${min} to ${max}.`,
      `${min} থেকে ${max} এর মধ্যে একটি পূর্ণসংখ্যা দিন।`, { field: 'auto_hide_report_threshold', min, max });
  }
  return value;
}

/**
 * Changes the auto-hide threshold. Takes effect on the next report. Writes an audit row with the
 * before and after values and the reason; the settings group is locked first so two admins saving
 * together cannot record a `before` that never existed.
 */
export async function updateAutoHideThreshold(db, user, { value, reason }: Record<string, any> = {}) {
  const next = validateThreshold(value);
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    throw new AppError('VALIDATION_FAILED', 'Give a reason of at least 10 characters for this change.',
      'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।', { field: 'reason' });
  }
  return withTransaction(db, async (client) => {
    await settingRepo.lockSettingsGroup(client, SETTINGS_GROUP);
    const before = await getAutoHideThreshold(client);
    await settingRepo.upsertSetting(client, {
      key: THRESHOLD_KEY, valueJson: next, groupKey: SETTINGS_GROUP, updatedBy: user.id, ...THRESHOLD_META,
    });
    await writeAudit(client, {
      action: 'community.settings.update', targetType: 'platform_settings', targetRef: THRESHOLD_KEY,
      actor: user, riskTier: 'MEDIUM', before: { auto_hide_report_threshold: before },
      after: { auto_hide_report_threshold: next }, meta: { reason: reason.trim() },
    });
    return { auto_hide_report_threshold: next, previous: before };
  });
}

export async function getAutoHideThreshold(db) {
  const row = await settingRepo.getSettingByKey(db, THRESHOLD_KEY);
  let v = row?.value_json;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = Number(v); } }
  const n = Number(v);
  return Number.isInteger(n) && n >= THRESHOLD_LIMITS.min && n <= THRESHOLD_LIMITS.max ? n : THRESHOLD_LIMITS.fallback;
}

export async function listTimeline(db, user, { type, role, sort, mine, saved, postId, limit = 20, offset = 0 }: Record<string, any> = {}) {
  const roles = user?.roles ?? [];
  const audiences = visibleAudiences(roles);
  const filters = {
    viewerId: user?.id ?? null,
    audiences,
    role: ['customer', 'supplier', 'saler', 'admin'].includes(role) ? role : null,
    authorId: mine && user ? user.id : null,
    savedOnly: Boolean(saved && user),
    // A link to one post (a share, a notification). The same visibility rules apply: a post the viewer
    // may not see simply yields an empty list.
    postId: Number.isInteger(Number(postId)) && Number(postId) > 0 ? Number(postId) : null,
    limit: Math.min(Math.max(Number(limit) || 20, 1), 50),
    offset: Math.max(Number(offset) || 0, 0),
  };
  const postType = ['REVIEW', 'UPDATE', 'IDEA', 'ANNOUNCEMENT'].includes(type) ? type : null;
  // A guest has no saved list: asking for it is an empty list, never everybody's posts.
  if (saved && !user) return { posts: [], counts: {}, meta: { limit: filters.limit, offset: filters.offset, has_more: false } };
  const [rows, counts] = await Promise.all([
    repo.listPosts(db, { ...filters, type: postType, sort: sort === 'top' ? 'top' : 'recent' }),
    repo.countByType(db, { viewerId: filters.viewerId, role: filters.role, audiences }),
  ]);
  const byType = Object.fromEntries(counts.map((c) => [c.post_type, c.n]));
  return {
    posts: await serializeWithMedia(db, rows),
    counts: { ALL: counts.reduce((a, c) => a + c.n, 0), ...byType },
    meta: { limit: filters.limit, offset: filters.offset, has_more: rows.length === filters.limit },
  };
}

/** What the signed-in author may attach a post to: delivered purchases, own products, or own store items. */
export async function listComposerProducts(db, user) {
  const role = resolveAuthorRole(user.roles);
  if (role === 'customer') return { role, items: await repo.listReviewableItems(db, user.id) };
  if (role === 'supplier') return { role, items: await repo.listSupplierProducts(db, user.id) };
  if (role === 'saler') return { role, items: await repo.listPartnerProducts(db, user.id) };
  return { role, items: [] };
}

export async function createPost(db, user, input: Record<string, any> = {}) {
  const role = resolveAuthorRole(user.roles);
  if (!role || role === 'admin') {
    throw new AppError('FORBIDDEN', 'Your account cannot write this kind of post.', 'আপনার অ্যাকাউন্ট এই ধরনের পোস্ট লিখতে পারে না।');
  }
  const draft = validateDraft(role, input);
  const mediaIds = validateMediaIds(input.media_ids);

  let productId = null;
  let orderItemId = null;
  if (role === 'customer') {
    const item = await repo.findDeliveredItem(db, user.id, Number(input.order_item_id));
    if (!item) {
      throw new AppError('VALIDATION_FAILED', 'You can review a product after it is delivered to you.',
        'পণ্যটি আপনার কাছে ডেলিভারি হওয়ার পর রিভিউ দিতে পারবেন।', { field: 'order_item_id' });
    }
    productId = item.product_id;
    orderItemId = item.order_item_id;
  } else {
    productId = int(input.product_id, 'product_id', 1, Number.MAX_SAFE_INTEGER, { required: true });
    const ok = role === 'supplier'
      ? await repo.supplierOwnsProduct(db, user.id, productId)
      : await repo.partnerSellsProduct(db, user.id, productId);
    if (!ok) {
      throw new AppError('PERMISSION_DENIED', 'Pick a product that is yours to post about.',
        'যে পণ্যটি আপনার, শুধু সেটি নিয়েই পোস্ট করতে পারবেন।', { field: 'product_id' });
    }
  }

  let id;
  try {
    // One transaction: the post and its files go in together or not at all.
    id = await withTransaction(db, async (client) => {
      const postId = await repo.insertPost(client, {
        ref: generateRef('POST'), authorId: user.id, authorRole: role, postType: ROLE_POST[role].type,
        kind: draft.kind, productId, orderItemId, title: draft.title, body: draft.body,
        details: draft.details, audience: draft.audience, isPinned: draft.isPinned,
      });
      await attachPostMedia(client, user.id, postId, mediaIds);
      return postId;
    });
  } catch (err) {
    // uq_community_review_per_order_item: a second review for the same delivered line.
    if (err?.code === '23505' && String(err.constraint ?? '').includes('review')) {
      throw new AppError('CONFLICT', 'You already reviewed this purchase.', 'এই কেনাকাটার রিভিউ আপনি আগেই দিয়েছেন।');
    }
    if (err?.code === '23505') {
      throw fail('media_ids', 'One of the files is already on another post.', 'একটি ফাইল আগেই অন্য পোস্টে ব্যবহার করা হয়েছে।');
    }
    throw err;
  }
  return (await serializeWithMedia(db, [await repo.getPost(db, id, user.id)]))[0];
}

/** Staff announcement. Writes an audit row, because it is a staff action visible to every member. */
export async function createAnnouncement(db, user, input: Record<string, any> = {}) {
  const draft = validateDraft('admin', input);
  const mediaIds = validateMediaIds(input.media_ids);
  const id = await withTransaction(db, async (client) => {
    const postId = await repo.insertPost(client, {
      ref: generateRef('POST'), authorId: user.id, authorRole: 'admin', postType: 'ANNOUNCEMENT',
      kind: draft.kind, productId: null, orderItemId: null, title: draft.title, body: draft.body,
      details: {}, audience: draft.audience, isPinned: draft.isPinned,
    });
    await attachPostMedia(client, user.id, postId, mediaIds);
    return postId;
  });
  const post = await repo.getPost(db, id, user.id);
  await writeAudit(db, {
    action: 'community.post.announce', targetType: 'community_post', targetRef: post.ref,
    actor: user, before: null,
    after: { kind: draft.kind, title: draft.title, audience: draft.audience, pinned: draft.isPinned, media: mediaIds.length },
  });
  return (await serializeWithMedia(db, [post]))[0];
}

// ── Comments ──────────────────────────────────────────────────────────────────────────────

/** Pure. A comment is 1 to LIMITS.comment characters after trimming; the stored text is the trimmed text. */
export function validateCommentBody(raw) {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body) throw fail('body', 'Write a comment first.', 'আগে মন্তব্য লিখুন।');
  if (body.length > LIMITS.comment) {
    throw fail('body', `A comment can be at most ${LIMITS.comment} characters.`, `মন্তব্য সর্বোচ্চ ${LIMITS.comment} অক্ষরের হতে পারে।`);
  }
  return body;
}

export function serializeComment(row) {
  return {
    id: row.id,
    post_id: row.post_id,
    body: row.body,
    created_at: row.created_at,
    is_mine: !!row.is_mine,
    author: { id: row.author_id, role: row.author_role ?? 'customer', name: row.author_name ?? '—', initials: initials(row.author_name) },
  };
}

/**
 * The post a comment is about, or NOT_FOUND. A post that is hidden, removed, or meant for another
 * audience is "not found" to this viewer, the same as on the timeline; its author always sees it.
 */
async function visiblePost(db, user, postId) {
  const post = await repo.getPost(db, postId, user?.id ?? null);
  const seen = post && post.status === 'PUBLISHED'
    && (visibleAudiences(user?.roles ?? []).includes(post.audience) || (user && Number(post.author_id) === Number(user.id)));
  if (!seen) throw new AppError('NOT_FOUND', 'Post not found.', 'পোস্টটি পাওয়া যায়নি।');
  return post;
}

export async function listPostComments(db, user, postId, { limit = 20, offset = 0 }: Record<string, any> = {}) {
  await visiblePost(db, user, postId);
  const size = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const rows = await repo.listComments(db, { postId, viewerId: user?.id ?? null, limit: size, offset: Math.max(Number(offset) || 0, 0) });
  return {
    comments: rows.map(serializeComment),
    comment_count: await repo.countComments(db, postId),
    meta: { limit: size, offset: Math.max(Number(offset) || 0, 0), has_more: rows.length === size },
  };
}

export async function addComment(db, user, postId, { body }: Record<string, any> = {}) {
  const text = validateCommentBody(body);
  const post = await visiblePost(db, user, postId);
  const id = await repo.insertComment(db, { postId, authorId: user.id, body: text });
  const row = await repo.getComment(db, id, user.id);
  // Tell the post's author (not for their own comment). Never fails the comment.
  await notices.notifyPostAuthorOfComment(db, { post, comment: row, actorId: user.id });
  return {
    comment: serializeComment(row),
    comment_count: await repo.countComments(db, postId),
  };
}

/** A member takes down their own comment. Not an audited staff action: it is the author's own. */
export async function deleteOwnComment(db, user, commentId) {
  const comment = await repo.getComment(db, commentId, user.id);
  if (!comment || comment.status !== 'PUBLISHED') throw new AppError('NOT_FOUND', 'Comment not found.', 'মন্তব্যটি পাওয়া যায়নি।');
  if (Number(comment.author_id) !== Number(user.id)) throw new AppError('FORBIDDEN', 'You can only delete your own comments.', 'শুধু নিজের মন্তব্য মুছতে পারবেন।');
  await repo.removeComment(db, commentId, user.id);
  return { comment_count: await repo.countComments(db, comment.post_id) };
}

/** Staff removal. Audited with the comment text so the record says what was taken down. */
export async function removeCommentAsStaff(db, user, commentId) {
  const done = await withTransaction(db, async (client) => {
    const comment = await repo.getComment(client, commentId, user.id);
    if (!comment || comment.status !== 'PUBLISHED') throw new AppError('NOT_FOUND', 'Comment not found.', 'মন্তব্যটি পাওয়া যায়নি।');
    await repo.removeComment(client, commentId, user.id);
    await writeAudit(client, {
      action: 'community.comment.remove', targetType: 'community_post_comment', targetRef: String(commentId),
      actor: user, before: { status: 'PUBLISHED', post_id: comment.post_id, author_id: comment.author_id, body: comment.body },
      after: { status: 'REMOVED' },
    });
    return { comment_count: await repo.countComments(client, comment.post_id), comment };
  });
  await notices.notifyCommentRemoved(db, { comment: done.comment, actorId: user.id });
  return { comment_count: done.comment_count };
}

/**
 * Adds a post to the member's private saved list, or takes it off. Only a post they can see can be
 * saved (the same rule as commenting), so the list cannot be used to probe for hidden posts.
 */
export async function toggleSave(db, user, postId) {
  await visiblePost(db, user, postId);
  return { saved: await repo.toggleSave(db, postId, user.id) };
}

export async function toggleLike(db, user, postId) {
  const post = await repo.getPost(db, postId, user.id);
  if (!post || post.status !== 'PUBLISHED') throw new AppError('NOT_FOUND', 'Post not found.', 'পোস্টটি পাওয়া যায়নি।');
  return withTransaction(db, (client) => repo.toggleLike(client, postId, user.id));
}

/**
 * Files a report. The post stays live. When the open reports reach the threshold it is hidden until
 * a moderator decides: the post row is locked first so two reports arriving together cannot both
 * miss the threshold, or hide it twice.
 */
export async function reportPost(db, user, postId, { reason, note }: Record<string, any> = {}) {
  if (!REPORT_REASONS.includes(reason)) throw fail('reason', 'Choose a reason for the report.', 'রিপোর্টের কারণ বেছে নিন।');
  const cleanNote = text(note, 'note', LIMITS.tip);
  const threshold = await getAutoHideThreshold(db);

  const result = await withTransaction(db, async (client) => {
    const post = await repo.lockPost(client, postId);
    if (!post || post.status !== 'PUBLISHED') throw new AppError('NOT_FOUND', 'Post not found.', 'পোস্টটি পাওয়া যায়নি।');
    // WHY Number(): pg returns BIGINT as a string, and the session's id is a number. A strict compare
    // here let authors report their own posts on a real database while the unit tests (numeric ids) passed.
    if (Number(post.author_id) === Number(user.id)) {
      throw new AppError('FORBIDDEN', 'You cannot report your own post.', 'নিজের পোস্ট রিপোর্ট করা যায় না।');
    }
    const created = await repo.insertReport(client, { postId, reporterId: user.id, reason, note: cleanNote });
    const open = await repo.countOpenReports(client, postId);
    let autoHidden = false;
    if (created && open >= threshold) {
      await repo.setStatus(client, postId, 'HIDDEN', 'REPORTS');
      autoHidden = true;
      await writeAudit(client, {
        action: 'community.post.auto_hide', targetType: 'community_post', targetRef: String(postId),
        actor: null, before: { status: 'PUBLISHED' }, after: { status: 'HIDDEN', open_reports: open, threshold },
      });
    }
    return { reported: created, already_reported: !created, auto_hidden: autoHidden };
  });
  // Outside the transaction: the author hears about it only once the hiding is committed.
  if (result.auto_hidden) {
    await notices.notifyPostAuthorOfDecision(db, { post: await repo.getPost(db, postId, null), outcome: 'AUTO_HIDDEN' });
  }
  return result;
}

/** Moderator decision on one post: KEEP (live, reports dismissed), HIDE or REMOVE (reports actioned). */
export async function moderatePost(db, user, postId, action) {
  if (!MODERATE_ACTIONS.includes(action)) throw fail('action', 'Choose Keep, Hide or Remove.', 'রাখা, লুকানো বা সরানো বেছে নিন।');
  const done = await withTransaction(db, async (client) => {
    const post = await repo.lockPost(client, postId);
    if (!post || post.status === 'REMOVED') throw new AppError('NOT_FOUND', 'Post not found.', 'পোস্টটি পাওয়া যায়নি।');
    const next = { KEEP: 'PUBLISHED', HIDE: 'HIDDEN', REMOVE: 'REMOVED' }[action];
    await repo.setStatus(client, postId, next, next === 'HIDDEN' ? 'MODERATOR' : null);
    const resolved = await repo.resolveReports(client, postId, action === 'KEEP' ? 'DISMISSED' : 'ACTIONED', user.id);
    await writeAudit(client, {
      action: `community.post.${action.toLowerCase()}`, targetType: 'community_post', targetRef: String(postId),
      actor: user, before: { status: post.status, hidden_reason: post.hidden_reason },
      after: { status: next, reports_resolved: resolved },
    });
    return { status: next, reports_resolved: resolved, previous: post.status };
  });
  // The author is told the outcome. Keeping a post that was never hidden changes nothing for them.
  const outcome = { HIDE: 'HIDDEN', REMOVE: 'REMOVED' }[action] ?? (done.previous === 'HIDDEN' ? 'RESTORED' : null);
  if (outcome) {
    await notices.notifyPostAuthorOfDecision(db, { post: await repo.getPost(db, postId, null), outcome, actorId: user.id });
  }
  return { status: done.status, reports_resolved: done.reports_resolved };
}

export async function getQueue(db, { limit = 30, offset = 0 }: Record<string, any> = {}) {
  const [rows, stats, threshold] = await Promise.all([
    repo.listQueue(db, { limit: Math.min(Math.max(Number(limit) || 30, 1), 100), offset: Math.max(Number(offset) || 0, 0) }),
    repo.queueStats(db),
    getAutoHideThreshold(db),
  ]);
  const reasons = Object.fromEntries((await repo.topReasons(db, rows.map((r) => r.id))).map((r) => [r.post_id, r.reason]));
  return {
    items: await serializeWithMedia(db, rows, (r) => ({ top_reason: reasons[r.id] ?? null })),
    stats, threshold, threshold_limits: { min: THRESHOLD_LIMITS.min, max: THRESHOLD_LIMITS.max },
  };
}
