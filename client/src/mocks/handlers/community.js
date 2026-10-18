/**
 * Mock handlers for the community timeline.
 *
 * Mirrors the live contract in server/src/{routes,controllers,services}/communityPost*:
 *   GET  /community/posts                  → { data: { posts, counts }, meta }
 *   GET  /community/composer/products      → { data: { role, items } }
 *   POST /community/posts                  → { data: { post } }
 *   POST /community/announcements          → { data: { post } }
 *   POST /community/posts/:id/like         → { data: { liked, like_count } }
 *   POST /community/posts/:id/report       → { data: { reported, already_reported, auto_hidden } }
 *   GET  /admin/community/queue            → { data: { items, stats, threshold } }
 *   POST /admin/community/posts/:id/moderate → { data: { status, reports_resolved } }
 *
 * State is in memory and resets on reload; the live data is in Postgres. The rules a preview must
 * show (posts go live at once, one report per person, auto-hide at the threshold, a hidden post
 * leaves the timeline and enters the moderation queue) are the same ones the server enforces.
 */
import { appStore } from '../../state/appStore.js';
import { resolveMockMedia } from './media.js';

// Mirrors THRESHOLD_LIMITS.fallback in server/src/services/communityPost.service.ts.
const AUTO_HIDE_THRESHOLD = 5;

const ROLE_POST = {
  customer: { type: 'REVIEW', kinds: ['REVIEW'] },
  supplier: { type: 'UPDATE', kinds: ['NEW_ARRIVAL', 'RESTOCK', 'BULK_OFFER'] },
  saler: { type: 'IDEA', kinds: ['USABILITY_TIP', 'CREATIVE_IDEA', 'PRODUCT_STORY'] },
  admin: { type: 'ANNOUNCEMENT', kinds: ['ANNOUNCEMENT', 'POLICY_NOTICE', 'FEATURED_PICK'] },
};
const STAFF = ['admin', 'super_admin', 'moderator', 'editor'];
const AUDIENCE_OF = { customer: 'CUSTOMERS', supplier: 'SUPPLIERS', saler: 'SHOP_PARTNERS' };

const PRODUCT = {
  id: 101, ref: 'PRD-PANJABI', slug: 'cotton-panjabi-navy', price: 1150,
  title_en: 'Cotton panjabi, navy', title_bn: 'সুতির পাঞ্জাবি, নেভি',
};

const ME = {
  customer: { id: 7, name: 'Nusrat Jahan' },
  supplier: { id: 5, name: 'Dhaka Textiles' },
  saler: { id: 6, name: 'Rafi Fashion' },
  admin: { id: 2, name: 'Explooro Team' },
  super_admin: { id: 1, name: 'Explooro Team' },
  moderator: { id: 3, name: 'Explooro Moderator' },
  editor: { id: 4, name: 'Explooro Editor' },
};

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Flat colour tiles standing in for photos, so the gallery has something to show in a preview.
const demoTile = (label, fill) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${fill}"/>`
  + `<text x="320" y="250" font-family="sans-serif" font-size="40" text-anchor="middle" fill="#1f1f1f">${label}</text></svg>`
);
const DEMO_LOOKS = [
  { id: 'demo-1', kind: 'IMAGE', mime_type: 'image/svg+xml', url: demoTile('Look 1', '#ffe6b8'), width: 640, height: 480 },
  { id: 'demo-2', kind: 'IMAGE', mime_type: 'image/svg+xml', url: demoTile('Look 2', '#cedfff'), width: 640, height: 480 },
  { id: 'demo-3', kind: 'IMAGE', mime_type: 'image/svg+xml', url: demoTile('Look 3', '#b0e7bb'), width: 640, height: 480 },
];

const ago = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();

let nextId = 100;
const posts = [
  {
    id: 1, type: 'ANNOUNCEMENT', kind: 'ANNOUNCEMENT', authorRole: 'admin', authorId: 2, authorName: 'Explooro Team',
    title: 'Eid delivery cut-off dates',
    body: 'Orders placed before 20 Oct reach Dhaka by 24 Oct. Allow 2 extra days outside Dhaka.',
    details: {}, audience: 'EVERYONE', pinned: true, product: null, orderItem: null, createdAt: ago(30), likes: new Set(['x1', 'x2', 'x3']),
  },
  {
    id: 2, type: 'REVIEW', kind: 'REVIEW', authorRole: 'customer', authorId: 7, authorName: 'Nusrat Jahan',
    title: null, body: null, product: PRODUCT, orderItem: 4821, audience: 'EVERYONE', pinned: false, createdAt: ago(2),
    details: {
      rating: 4, quality: 4, value: 3, delivery: 5,
      liked: 'Soft fabric, clean stitching, true to size.',
      could_improve: 'Colour is a little lighter than the photo.',
      tip: 'Wash cold and dry in shade to keep the colour.',
    },
    likes: new Set(['x1', 'x2']),
  },
  {
    id: 3, type: 'UPDATE', kind: 'RESTOCK', authorRole: 'supplier', authorId: 5, authorName: 'Dhaka Textiles',
    title: null, body: 'Back in stock in sizes M to XXL. New packaging keeps the fold crisp.', product: PRODUCT, orderItem: null,
    audience: 'SHOP_PARTNERS', pinned: false, createdAt: ago(5),
    details: {
      stock: 500, min_order: 10, wholesale_price: 780, best_price: 700, ships_from: '20 Oct',
      tiers: [{ min_qty: 10, price: 780 }, { min_qty: 50, price: 740 }, { min_qty: 200, price: 700 }],
    },
    likes: new Set(['x1']),
  },
  {
    id: 4, type: 'IDEA', kind: 'CREATIVE_IDEA', authorRole: 'saler', authorId: 6, authorName: 'Rafi Fashion',
    title: '3 ways to style a panjabi beyond Eid', body: null, product: PRODUCT, orderItem: null, audience: 'EVERYONE',
    pinned: false, createdAt: ago(24), media: DEMO_LOOKS,
    details: {
      steps: ['Pair with white pajama and loafers for the day', 'Layer a black vest for evening events', 'Wear with jeans for a relaxed Friday look'],
      tags: ['eid', 'styling'],
    },
    likes: new Set(['x1', 'x2', 'x3', 'x4']),
  },
].map((p) => ({ ...p, status: 'PUBLISHED', hiddenReason: null }));

// Seeded so the moderation queue has something to review in a preview.
const reports = [
  { postId: 3, reporterId: 'r1', reason: 'MISLEADING', status: 'OPEN' },
  { postId: 3, reporterId: 'r2', reason: 'MISLEADING', status: 'OPEN' },
  { postId: 3, reporterId: 'r3', reason: 'SPAM', status: 'OPEN' },
  { postId: 2, reporterId: 'r1', reason: 'FAKE_REVIEW', status: 'OPEN' },
];

function viewer() {
  const auth = appStore.get().auth || {};
  const role = auth.isAuthenticated ? auth.role : null;
  return { role, user: role ? ME[role] ?? { id: 99, name: 'Member' } : null };
}

function openReports(postId) {
  return reports.filter((r) => r.postId === postId && r.status === 'OPEN');
}

function serialize(p, user) {
  return {
    id: p.id, ref: `POST-${p.id}`, type: p.type, kind: p.kind, title: p.title, body: p.body, details: p.details,
    audience: p.audience, is_pinned: p.pinned, status: p.status, created_at: p.createdAt,
    like_count: p.likes.size, media: p.media ?? [], liked_by_me: user ? p.likes.has(`u${user.id}`) : false,
    is_mine: user ? p.authorId === user.id : false,
    open_report_count: openReports(p.id).length,
    verified_purchase: p.type === 'REVIEW' && p.orderItem != null,
    author: { id: p.authorId, role: p.authorRole, name: p.authorName, initials: initials(p.authorName) },
    product: p.product ? {
      id: p.product.id, ref: p.product.ref, slug: p.product.slug,
      title_en: p.product.title_en, title_bn: p.product.title_bn, price: p.product.price,
    } : null,
  };
}

function audiencesFor(role) {
  if (!role) return ['EVERYONE'];
  if (STAFF.includes(role)) return ['EVERYONE', 'CUSTOMERS', 'SUPPLIERS', 'SHOP_PARTNERS'];
  return ['EVERYONE', AUDIENCE_OF[role]].filter(Boolean);
}

function fail(status, code, en, bn, field) {
  return { status, body: { error: { code, message_en: en, message_bn: bn, details: field ? { field } : undefined } } };
}

const MAX_MEDIA = 4;

/** Mirrors validateMediaIds + attachPostMedia: the uploads must be the caller's, for the community, and unused. */
function takeMedia(ids, userId) {
  if (ids === undefined || ids === null) return { media: [] };
  const list = Array.isArray(ids) ? ids.map(Number) : null;
  if (!list || list.some((n) => !Number.isInteger(n) || n < 1)) return { error: fail(400, 'VALIDATION_FAILED', 'One of the attached files is not valid.', 'যুক্ত করা একটি ফাইল সঠিক নয়।', 'media_ids') };
  if (new Set(list).size !== list.length) return { error: fail(400, 'VALIDATION_FAILED', 'The same file is attached twice.', 'একই ফাইল দুইবার যুক্ত করা হয়েছে।', 'media_ids') };
  if (list.length > MAX_MEDIA) return { error: fail(400, 'VALIDATION_FAILED', `Attach at most ${MAX_MEDIA} files.`, `সর্বোচ্চ ${MAX_MEDIA}টি ফাইল যুক্ত করা যাবে।`, 'media_ids') };
  const used = new Set(posts.flatMap((p) => (p.media ?? []).map((m) => Number(m.id))));
  const found = list.map((id) => resolveMockMedia(id));
  if (found.some((a, i) => !a || a.purpose !== 'COMMUNITY' || used.has(list[i]))) {
    return { error: fail(400, 'VALIDATION_FAILED', 'One of the files cannot be used. Upload it again.', 'একটি ফাইল ব্যবহার করা যাচ্ছে না। আবার আপলোড করুন।', 'media_ids') };
  }
  const media = found.map((a) => ({
    id: a.id, kind: String(a.mime_type).startsWith('video/') ? 'VIDEO' : 'IMAGE', mime_type: a.mime_type, url: a.url, width: null, height: null,
  }));
  if (media.filter((m) => m.kind === 'VIDEO').length > 1) {
    return { error: fail(400, 'VALIDATION_FAILED', 'A post can have one video.', 'একটি পোস্টে একটি ভিডিও দেওয়া যাবে।', 'media_ids') };
  }
  return { media };
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function buildDraft(role, body) {
  const spec = ROLE_POST[role];
  const kind = String(body.kind || spec.kinds[0]).toUpperCase();
  if (!spec.kinds.includes(kind)) return { error: fail(400, 'VALIDATION_FAILED', 'This post kind is not available for your account.', 'এই ধরনের পোস্ট আপনার অ্যাকাউন্টের জন্য নয়।', 'kind') };
  const d = body.details || {};
  if (spec.type === 'REVIEW') {
    const rating = Number(d.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: fail(400, 'VALIDATION_FAILED', 'Choose a rating from 1 to 5.', '১ থেকে ৫ এর মধ্যে রেটিং দিন।', 'rating') };
    const liked = str(d.liked, 1000);
    const improve = str(d.could_improve, 1000);
    if (!liked && !improve) return { error: fail(400, 'VALIDATION_FAILED', 'Tell other buyers what you liked or what could be better.', 'কী ভালো লেগেছে বা কী ভালো হতে পারত, অন্তত একটি লিখুন।', 'liked') };
    const sub = (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : null);
    return { draft: { kind, title: null, body: null, audience: 'EVERYONE', pinned: false,
      details: { rating, quality: sub(d.quality), value: sub(d.value), delivery: sub(d.delivery), liked: liked || null, could_improve: improve || null, tip: str(d.tip, 300) || null } } };
  }
  if (spec.type === 'UPDATE') {
    const text = str(body.body, 2000);
    const stock = Number(d.stock);
    const minOrder = Number(d.min_order);
    const price = Number(d.wholesale_price);
    if (!text) return { error: fail(400, 'VALIDATION_FAILED', 'Add the highlights for shop partners.', 'শপ পার্টনারদের জন্য বিবরণ লিখুন।', 'body') };
    if (!Number.isInteger(stock) || stock < 0) return { error: fail(400, 'VALIDATION_FAILED', 'Enter the stock you have.', 'আপনার স্টকের পরিমাণ লিখুন।', 'stock') };
    if (!Number.isInteger(minOrder) || minOrder < 1) return { error: fail(400, 'VALIDATION_FAILED', 'Enter the minimum order quantity.', 'সর্বনিম্ন অর্ডারের পরিমাণ লিখুন।', 'min_order') };
    if (!Number.isFinite(price) || price < 0) return { error: fail(400, 'VALIDATION_FAILED', 'Enter the wholesale price.', 'পাইকারি দাম লিখুন।', 'wholesale_price') };
    const tiers = (Array.isArray(d.tiers) ? d.tiers : []).slice(0, 5).map((t) => ({ min_qty: Number(t.min_qty), price: Number(t.price) }))
      .filter((t) => t.min_qty >= 1 && t.price >= 0);
    return { draft: { kind, title: null, body: text, audience: 'SHOP_PARTNERS', pinned: false,
      details: { stock, min_order: minOrder, wholesale_price: price, best_price: Math.min(price, ...tiers.map((t) => t.price)), ships_from: str(d.ships_from, 40) || null, tiers } } };
  }
  if (spec.type === 'IDEA') {
    const title = str(body.title, 120);
    const steps = (Array.isArray(d.steps) ? d.steps : []).map((s) => str(s, 200)).filter(Boolean).slice(0, 8);
    if (!title) return { error: fail(400, 'VALIDATION_FAILED', 'Add a headline.', 'একটি শিরোনাম দিন।', 'title') };
    if (!steps.length) return { error: fail(400, 'VALIDATION_FAILED', 'Add at least one step or idea.', 'অন্তত একটি ধাপ বা আইডিয়া যোগ করুন।', 'steps') };
    const tags = (Array.isArray(d.tags) ? d.tags : []).map((s) => str(s, 30).replace(/^#/, '')).filter(Boolean).slice(0, 5);
    return { draft: { kind, title, body: str(body.body, 2000) || null, audience: 'EVERYONE', pinned: false, details: { steps, tags } } };
  }
  const title = str(body.title, 120);
  const text = str(body.body, 2000);
  if (!title || !text) return { error: fail(400, 'VALIDATION_FAILED', 'Add a title and a message.', 'শিরোনাম ও বার্তা লিখুন।', 'title') };
  const audience = String(body.audience || 'EVERYONE').toUpperCase();
  return { draft: { kind, title, body: text, audience, pinned: body.is_pinned === true, details: {} } };
}

export const communityHandlers = [
  {
    method: 'GET',
    path: '/community/posts',
    handler({ query }) {
      const { role, user } = viewer();
      const audiences = audiencesFor(role);
      const visible = posts.filter((p) => p.status === 'PUBLISHED' && (audiences.includes(p.audience) || (user && p.authorId === user.id)));
      const roleFilter = ['customer', 'supplier', 'saler', 'admin'].includes(query.role) ? query.role : null;
      const base = visible.filter((p) => !roleFilter || p.authorRole === roleFilter);
      const counts = { ALL: base.length };
      for (const p of base) counts[p.type] = (counts[p.type] || 0) + 1;
      let list = base.filter((p) => !query.type || p.type === query.type);
      if (query.mine === '1' && user) list = list.filter((p) => p.authorId === user.id);
      list = [...list].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return query.sort === 'top' ? b.likes.size - a.likes.size || b.id - a.id : b.id - a.id;
      });
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const page = list.slice(offset, offset + limit);
      return {
        status: 200,
        body: { data: { posts: page.map((p) => serialize(p, user)), counts }, meta: { limit, offset, has_more: offset + limit < list.length } },
      };
    },
  },
  {
    method: 'GET',
    path: '/community/composer/products',
    handler() {
      const { role } = viewer();
      if (role === 'customer') {
        return { status: 200, body: { data: { role, items: [{
          order_item_id: 4822, order_ref: 'ORD-4822', delivered_at: ago(48), product_id: PRODUCT.id, product_ref: PRODUCT.ref,
          title_en: PRODUCT.title_en, title_bn: PRODUCT.title_bn, shop_name: 'Rafi Fashion',
        }, {
          order_item_id: 4830, order_ref: 'ORD-4830', delivered_at: ago(96), product_id: 102, product_ref: 'PRD-LEATHER-BAG',
          title_en: 'Leather crossbody bag', title_bn: 'চামড়ার ক্রসবডি ব্যাগ', shop_name: 'Urban Carry',
        }] } } };
      }
      if (role === 'supplier') {
        return { status: 200, body: { data: { role, items: [{ product_id: PRODUCT.id, product_ref: PRODUCT.ref, title_en: PRODUCT.title_en, title_bn: PRODUCT.title_bn, stock_qty: 340 }] } } };
      }
      if (role === 'saler') {
        return { status: 200, body: { data: { role, items: [{ product_id: PRODUCT.id, product_ref: PRODUCT.ref, title_en: PRODUCT.title_en, title_bn: PRODUCT.title_bn, price: 1150 }] } } };
      }
      return { status: 200, body: { data: { role, items: [] } } };
    },
  },
  {
    method: 'POST',
    path: '/community/posts',
    handler({ body = {} }) {
      const { role, user } = viewer();
      if (!user || !['customer', 'supplier', 'saler'].includes(role)) {
        return fail(403, 'FORBIDDEN', 'Your account cannot write this kind of post.', 'আপনার অ্যাকাউন্ট এই ধরনের পোস্ট লিখতে পারে না।');
      }
      const { draft, error } = buildDraft(role, body);
      if (error) return error;
      const taken = takeMedia(body.media_ids, user.id);
      if (taken.error) return taken.error;
      let product = PRODUCT;
      let orderItem = null;
      if (role === 'customer') {
        orderItem = Number(body.order_item_id);
        if (![4821, 4822, 4830].includes(orderItem) || posts.some((p) => p.type === 'REVIEW' && p.orderItem === orderItem)) {
          return fail(orderItem && posts.some((p) => p.orderItem === orderItem) ? 409 : 400, orderItem && posts.some((p) => p.orderItem === orderItem) ? 'CONFLICT' : 'VALIDATION_FAILED',
            'You can review a product after it is delivered to you.', 'পণ্যটি আপনার কাছে ডেলিভারি হওয়ার পর রিভিউ দিতে পারবেন।', 'order_item_id');
        }
        if (orderItem === 4830) product = { id: 102, ref: 'PRD-LEATHER-BAG', slug: 'leather-crossbody-bag', price: 2450, title_en: 'Leather crossbody bag', title_bn: 'চামড়ার ক্রসবডি ব্যাগ' };
      } else if (Number(body.product_id) !== PRODUCT.id) {
        return fail(403, 'PERMISSION_DENIED', 'Pick a product that is yours to post about.', 'যে পণ্যটি আপনার, শুধু সেটি নিয়েই পোস্ট করতে পারবেন।', 'product_id');
      }
      const post = {
        id: nextId++, type: ROLE_POST[role].type, kind: draft.kind, authorRole: role, authorId: user.id, authorName: user.name,
        title: draft.title, body: draft.body, details: draft.details, audience: draft.audience, pinned: false,
        product, orderItem, createdAt: new Date().toISOString(), likes: new Set(), status: 'PUBLISHED', hiddenReason: null,
        media: taken.media,
      };
      posts.push(post);
      return { status: 201, body: { data: { post: serialize(post, user) } } };
    },
  },
  {
    method: 'POST',
    path: '/community/announcements',
    handler({ body = {} }) {
      const { role, user } = viewer();
      if (!user || !['admin', 'super_admin'].includes(role)) {
        return fail(403, 'PERMISSION_DENIED', "You don't have access to this action.", 'এই কাজটি করার অনুমতি আপনার নেই।');
      }
      const { draft, error } = buildDraft('admin', body);
      if (error) return error;
      const taken = takeMedia(body.media_ids, user.id);
      if (taken.error) return taken.error;
      const post = {
        id: nextId++, type: 'ANNOUNCEMENT', kind: draft.kind, authorRole: 'admin', authorId: user.id, authorName: user.name,
        title: draft.title, body: draft.body, details: {}, audience: draft.audience, pinned: draft.pinned, product: null, orderItem: null,
        createdAt: new Date().toISOString(), likes: new Set(), status: 'PUBLISHED', hiddenReason: null, media: taken.media,
      };
      posts.push(post);
      return { status: 201, body: { data: { post: serialize(post, user) } } };
    },
  },
  {
    method: 'POST',
    path: '/community/posts/:id/like',
    handler({ params }) {
      const { user } = viewer();
      const post = posts.find((p) => p.id === Number(params.id) && p.status === 'PUBLISHED');
      if (!user) return fail(401, 'AUTH_REQUIRED', 'Sign in required.', 'সাইন ইন করা প্রয়োজন।');
      if (!post) return fail(404, 'NOT_FOUND', 'Post not found.', 'পোস্টটি পাওয়া যায়নি।');
      const key = `u${user.id}`;
      const liked = !post.likes.has(key);
      if (liked) post.likes.add(key); else post.likes.delete(key);
      return { status: 200, body: { data: { liked, like_count: post.likes.size } } };
    },
  },
  {
    method: 'POST',
    path: '/community/posts/:id/report',
    handler({ params, body = {} }) {
      const { user } = viewer();
      const post = posts.find((p) => p.id === Number(params.id) && p.status === 'PUBLISHED');
      if (!user) return fail(401, 'AUTH_REQUIRED', 'Sign in required.', 'সাইন ইন করা প্রয়োজন।');
      if (!['SPAM', 'FAKE_REVIEW', 'MISLEADING', 'OFFENSIVE', 'OTHER'].includes(body.reason)) {
        return fail(400, 'VALIDATION_FAILED', 'Choose a reason for the report.', 'রিপোর্টের কারণ বেছে নিন।', 'reason');
      }
      if (!post) return fail(404, 'NOT_FOUND', 'Post not found.', 'পোস্টটি পাওয়া যায়নি।');
      if (post.authorId === user.id) return fail(403, 'FORBIDDEN', 'You cannot report your own post.', 'নিজের পোস্ট রিপোর্ট করা যায় না।');
      const already = reports.some((r) => r.postId === post.id && r.reporterId === `u${user.id}`);
      if (!already) reports.push({ postId: post.id, reporterId: `u${user.id}`, reason: body.reason, status: 'OPEN' });
      const autoHidden = !already && openReports(post.id).length >= AUTO_HIDE_THRESHOLD;
      if (autoHidden) { post.status = 'HIDDEN'; post.hiddenReason = 'REPORTS'; }
      return { status: 200, body: { data: { reported: !already, already_reported: already, auto_hidden: autoHidden } } };
    },
  },
  {
    method: 'GET',
    path: '/admin/community/queue',
    handler() {
      const { role, user } = viewer();
      if (!['moderator', 'admin', 'super_admin'].includes(role)) {
        return fail(403, 'PERMISSION_DENIED', "You don't have access to this action.", 'এই কাজটি করার অনুমতি আপনার নেই।');
      }
      const queued = posts.filter((p) => p.status === 'HIDDEN' || (p.status !== 'REMOVED' && openReports(p.id).length > 0))
        .sort((a, b) => openReports(b.id).length - openReports(a.id).length);
      const items = queued.map((p) => {
        const counts = {};
        for (const r of openReports(p.id)) counts[r.reason] = (counts[r.reason] || 0) + 1;
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        return { ...serialize(p, user), top_reason: top ? top[0] : null, hidden_reason: p.hiddenReason };
      });
      return {
        status: 200,
        body: { data: { items, threshold: AUTO_HIDE_THRESHOLD, stats: {
          open_reports: new Set(reports.filter((r) => r.status === 'OPEN').map((r) => r.postId)).size,
          posts_today: 128, hidden_this_week: 2 + posts.filter((p) => p.status === 'HIDDEN').length, avg_review_hours: 3,
        } } },
      };
    },
  },
  {
    method: 'POST',
    path: '/admin/community/posts/:id/moderate',
    handler({ params, body = {} }) {
      const { role } = viewer();
      if (!['moderator', 'admin', 'super_admin'].includes(role)) {
        return fail(403, 'PERMISSION_DENIED', "You don't have access to this action.", 'এই কাজটি করার অনুমতি আপনার নেই।');
      }
      const post = posts.find((p) => p.id === Number(params.id) && p.status !== 'REMOVED');
      if (!post) return fail(404, 'NOT_FOUND', 'Post not found.', 'পোস্টটি পাওয়া যায়নি।');
      if (!['KEEP', 'HIDE', 'REMOVE'].includes(body.action)) {
        return fail(400, 'VALIDATION_FAILED', 'Choose Keep, Hide or Remove.', 'রাখা, লুকানো বা সরানো বেছে নিন।', 'action');
      }
      post.status = { KEEP: 'PUBLISHED', HIDE: 'HIDDEN', REMOVE: 'REMOVED' }[body.action];
      post.hiddenReason = body.action === 'HIDE' ? 'MODERATOR' : null;
      const open = openReports(post.id);
      for (const r of open) r.status = body.action === 'KEEP' ? 'DISMISSED' : 'ACTIONED';
      return { status: 200, body: { data: { status: post.status, reports_resolved: open.length } } };
    },
  },
];

export default communityHandlers;
