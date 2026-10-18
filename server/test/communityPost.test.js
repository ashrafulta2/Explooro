/**
 * communityPost.test.js — the community timeline's rules.
 *
 * Pins the invariants the service docblock states: each role may post only its own type, a review is
 * "verified" only through stored proof of purchase, one report per person counts toward the
 * auto-hide threshold, and a moderator decision moves the post and its reports together.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateDraft, resolveAuthorRole, visibleAudiences, serializePost, reportPost, moderatePost,
  getAutoHideThreshold, ROLE_POST, REPORT_REASONS, MODERATE_ACTIONS, THRESHOLD_LIMITS,
  validateMediaIds, mediaKind, createPost, createAnnouncement, LIMITS,
} from '../src/services/communityPost.service.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

/** An in-memory stand-in for the pool: just the queries reportPost / moderatePost make. */
function makeDb({ threshold = null, post = { id: 1, status: 'PUBLISHED', author_id: 10, post_type: 'REVIEW', hidden_reason: null }, media = [] } = {}) {
  // `media` is the uploads that exist: { id, mime_type, storage_key, owner_id, purpose, used }.
  const state = { post: { ...post }, reports: [], audit: [], calls: [], media: media.map((m) => ({ ...m })), attached: [], inserted: 0 };
  const query = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    state.calls.push(q.slice(0, 40));
    if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (q.includes('FROM platform_settings')) {
      return { rows: threshold === null ? [] : [{ key: 'community.auto_hide_report_threshold', value_json: threshold }] };
    }
    if (q.includes('FROM community_posts WHERE id = $1 FOR UPDATE')) return { rows: state.post.id === params[0] ? [{ ...state.post }] : [] };
    if (q.startsWith('INSERT INTO community_post_reports')) {
      const [postId, reporterId, reason] = params;
      if (state.reports.some((r) => r.postId === postId && r.reporterId === reporterId)) return { rows: [], rowCount: 0 };
      state.reports.push({ postId, reporterId, reason, status: 'OPEN' });
      return { rows: [], rowCount: 1 };
    }
    if (q.includes('COUNT(*)::int AS n FROM community_post_reports')) {
      return { rows: [{ n: state.reports.filter((r) => r.postId === params[0] && r.status === 'OPEN').length }] };
    }
    if (q.startsWith('UPDATE community_posts SET status')) {
      state.post.status = params[1];
      state.post.hidden_reason = params[2];
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith('UPDATE community_post_reports')) {
      let n = 0;
      for (const r of state.reports) if (r.postId === params[0] && r.status === 'OPEN') { r.status = params[1]; n += 1; }
      return { rows: [], rowCount: n };
    }
    if (q.startsWith('INSERT INTO community_posts')) { state.inserted += 1; return { rows: [{ id: 7 }] }; }
    if (q.includes('FROM products WHERE id = $1 AND supplier_id')) return { rows: [{}] };
    if (q.includes('FROM media_assets a')) {
      const [ids, userId] = params;
      return { rows: state.media.filter((m) => ids.includes(m.id) && m.owner_id === userId && m.purpose === 'COMMUNITY' && !m.used).map((m) => ({ id: m.id, mime_type: m.mime_type })) };
    }
    if (q.startsWith('INSERT INTO community_post_media')) {
      state.attached.push(...params[1].map((id, i) => ({ post_id: params[0], media_id: id, position: i })));
      return { rows: [], rowCount: params[1].length };
    }
    if (q.startsWith('SELECT p.id, p.ref')) {
      return { rows: [{ id: 7, ref: 'POST-X', author_id: 10, author_role: 'supplier', post_type: 'UPDATE', kind: 'RESTOCK', details: {}, audience: 'SHOP_PARTNERS', status: 'PUBLISHED', like_count: 0, author_name: 'Dhaka Textiles' }] };
    }
    if (q.includes('FROM community_post_media m')) {
      return { rows: state.attached.map((a) => ({ post_id: a.post_id, ...state.media.find((m) => m.id === a.media_id) })) };
    }
    if (q.startsWith('INSERT INTO audit_logs')) {
      state.audit.push({ action: params[2], after: JSON.parse(params[6] ?? 'null') });
      return { rows: [{ id: state.audit.length }] };
    }
    return { rows: [], rowCount: 0 };
  };
  return Object.assign(state, { query, connect: async () => ({ query, release() {} }) });
}

const reporter = (id) => ({ id, roles: ['customer'] });

// ── Who may post what ───────────────────────────────────────────────────────────────────────

test('each role resolves to exactly one post type, and staff post as staff', () => {
  assert.equal(resolveAuthorRole(['customer']), 'customer');
  assert.equal(resolveAuthorRole(['supplier']), 'supplier');
  assert.equal(resolveAuthorRole(['saler']), 'saler');
  assert.equal(resolveAuthorRole(['customer', 'admin']), 'admin');
  assert.equal(resolveAuthorRole(['super_admin']), 'admin');
  assert.equal(resolveAuthorRole(['moderator']), null);
  assert.deepEqual(
    Object.fromEntries(Object.entries(ROLE_POST).map(([r, s]) => [r, s.type])),
    { customer: 'REVIEW', supplier: 'UPDATE', saler: 'IDEA', admin: 'ANNOUNCEMENT' }
  );
});

test('a role cannot use another role\'s post kind', () => {
  assert.throws(() => validateDraft('customer', { kind: 'RESTOCK', details: { rating: 4, liked: 'x' } }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateDraft('supplier', { kind: 'REVIEW' }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateDraft('moderator', {}), { code: 'FORBIDDEN' });
});

// ── Validation per role ─────────────────────────────────────────────────────────────────────

test('a review needs a 1-5 rating and something written', () => {
  assert.throws(() => validateDraft('customer', { details: { liked: 'Nice' } }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateDraft('customer', { details: { rating: 6, liked: 'Nice' } }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateDraft('customer', { details: { rating: 4 } }), { code: 'VALIDATION_FAILED' });
  const ok = validateDraft('customer', { details: { rating: 4, quality: 5, liked: '  Soft fabric ', tip: 'Wash cold' } });
  assert.equal(ok.details.rating, 4);
  assert.equal(ok.details.liked, 'Soft fabric');
  assert.equal(ok.details.value, null);
  assert.equal(ok.audience, 'EVERYONE');
});

test('a supplier update records the best price across the wholesale price and every tier', () => {
  const d = validateDraft('supplier', {
    kind: 'RESTOCK', body: 'Back in stock',
    details: { stock: 500, min_order: 10, wholesale_price: 780, tiers: [{ min_qty: 50, price: 740 }, { min_qty: 200, price: 700 }] },
  });
  assert.equal(d.details.best_price, 700);
  assert.equal(d.audience, 'SHOP_PARTNERS');
  assert.throws(() => validateDraft('supplier', { body: 'x', details: { stock: -1, min_order: 1, wholesale_price: 1 } }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateDraft('supplier', { body: 'x', details: { stock: 1, min_order: 1, wholesale_price: 10.123 } }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateDraft('supplier', { details: { stock: 1, min_order: 1, wholesale_price: 1 } }), { code: 'VALIDATION_FAILED' });
});

test('an idea needs a headline and at least one step; blank steps and # on tags are cleaned', () => {
  const d = validateDraft('saler', { kind: 'CREATIVE_IDEA', title: ' Style it ', details: { steps: [' One ', '', '  ', 'Two'], tags: ['#eid', 'styling'] } });
  assert.equal(d.title, 'Style it');
  assert.deepEqual(d.details.steps, ['One', 'Two']);
  assert.deepEqual(d.details.tags, ['eid', 'styling']);
  assert.throws(() => validateDraft('saler', { title: 'x', details: { steps: ['', ' '] } }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateDraft('saler', { details: { steps: ['x'] } }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateDraft('saler', { title: 'x', details: { steps: Array(9).fill('x') } }), { code: 'VALIDATION_FAILED' });
});

test('an announcement needs a title, a message and a known audience; only it can pin', () => {
  const d = validateDraft('admin', { title: 'Eid dates', body: 'Order early', audience: 'customers', is_pinned: true });
  assert.equal(d.audience, 'CUSTOMERS');
  assert.equal(d.isPinned, true);
  assert.throws(() => validateDraft('admin', { title: 'x', body: 'y', audience: 'NOBODY' }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateDraft('admin', { title: 'x' }), { code: 'VALIDATION_FAILED' });
  assert.equal(validateDraft('customer', { details: { rating: 3, liked: 'ok' }, is_pinned: true }).isPinned, false);
});

// ── Visibility and serialisation ────────────────────────────────────────────────────────────

test('a viewer sees only the audiences meant for them; staff see all; a guest sees public posts', () => {
  assert.deepEqual(visibleAudiences([]), ['EVERYONE']);
  assert.deepEqual(visibleAudiences(['customer']), ['EVERYONE', 'CUSTOMERS']);
  assert.deepEqual(visibleAudiences(['saler']), ['EVERYONE', 'SHOP_PARTNERS']);
  assert.deepEqual(visibleAudiences(['supplier']), ['EVERYONE', 'SUPPLIERS']);
  assert.equal(visibleAudiences(['moderator']).length, 4);
});

test('verified purchase comes from the stored order line, never from the author', () => {
  const base = { id: 1, ref: 'P', post_type: 'REVIEW', kind: 'REVIEW', details: {}, audience: 'EVERYONE', status: 'PUBLISHED', author_id: 1, author_role: 'customer', author_name: 'Nusrat Jahan' };
  assert.equal(serializePost({ ...base, order_item_id: 77 }).verified_purchase, true);
  assert.equal(serializePost({ ...base, order_item_id: null }).verified_purchase, false);
  assert.equal(serializePost({ ...base, post_type: 'IDEA', order_item_id: 77 }).verified_purchase, false);
  assert.equal(serializePost({ ...base, order_item_id: 1 }).author.initials, 'NJ');
});

// ── Reports and auto-hide ───────────────────────────────────────────────────────────────────

test('the auto-hide threshold is read from settings and falls back when missing or out of range', async () => {
  assert.equal(await getAutoHideThreshold(makeDb()), THRESHOLD_LIMITS.fallback);
  assert.equal(await getAutoHideThreshold(makeDb({ threshold: 8 })), 8);
  assert.equal(await getAutoHideThreshold(makeDb({ threshold: '3' })), 3);
  assert.equal(await getAutoHideThreshold(makeDb({ threshold: 1 })), THRESHOLD_LIMITS.fallback);
  assert.equal(await getAutoHideThreshold(makeDb({ threshold: 500 })), THRESHOLD_LIMITS.fallback);
});

test('a post stays live below the threshold and is hidden by the report that reaches it', async () => {
  const db = makeDb({ threshold: 3 });
  const r1 = await reportPost(db, reporter(1), 1, { reason: 'SPAM' });
  const r2 = await reportPost(db, reporter(2), 1, { reason: 'SPAM' });
  assert.equal(r1.auto_hidden, false);
  assert.equal(r2.auto_hidden, false);
  assert.equal(db.post.status, 'PUBLISHED');
  const r3 = await reportPost(db, reporter(3), 1, { reason: 'MISLEADING' });
  assert.equal(r3.auto_hidden, true);
  assert.equal(db.post.status, 'HIDDEN');
  assert.equal(db.post.hidden_reason, 'REPORTS');
  assert.deepEqual(db.audit.map((a) => a.action), ['community.post.auto_hide']);
  assert.equal(db.audit[0].after.threshold, 3);
});

test('reporting twice does not count twice, so one person cannot hide a post', async () => {
  const db = makeDb({ threshold: 2 });
  await reportPost(db, reporter(1), 1, { reason: 'SPAM' });
  const again = await reportPost(db, reporter(1), 1, { reason: 'SPAM' });
  assert.equal(again.already_reported, true);
  assert.equal(again.reported, false);
  assert.equal(again.auto_hidden, false);
  assert.equal(db.post.status, 'PUBLISHED');
});

test('nobody reports their own post, a hidden post, or a missing one, and the reason must be known', async () => {
  const db = makeDb();
  await assert.rejects(() => reportPost(db, reporter(10), 1, { reason: 'SPAM' }), { code: 'FORBIDDEN' });
  await assert.rejects(() => reportPost(db, reporter(1), 1, { reason: 'RUDE' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(() => reportPost(db, reporter(1), 999, { reason: 'SPAM' }), { code: 'NOT_FOUND' });
  const hidden = makeDb({ post: { id: 1, status: 'HIDDEN', author_id: 10, post_type: 'IDEA', hidden_reason: 'REPORTS' } });
  await assert.rejects(() => reportPost(hidden, reporter(1), 1, { reason: 'SPAM' }), { code: 'NOT_FOUND' });
});

// ── Moderator decisions ─────────────────────────────────────────────────────────────────────

test('Hide actions the reports and Keep dismisses them and brings the post back', async () => {
  const db = makeDb({ threshold: 50 });
  await reportPost(db, reporter(1), 1, { reason: 'SPAM' });
  await reportPost(db, reporter(2), 1, { reason: 'SPAM' });
  const staff = { id: 99, roles: ['moderator'] };

  const hidden = await moderatePost(db, staff, 1, 'HIDE');
  assert.deepEqual(hidden, { status: 'HIDDEN', reports_resolved: 2 });
  assert.equal(db.post.hidden_reason, 'MODERATOR');
  assert.ok(db.reports.every((r) => r.status === 'ACTIONED'));

  const kept = await moderatePost(db, staff, 1, 'KEEP');
  assert.equal(kept.status, 'PUBLISHED');
  assert.equal(db.post.hidden_reason, null);
  assert.deepEqual(db.audit.map((a) => a.action), ['community.post.hide', 'community.post.keep']);
});

test('Remove is final and unknown actions are refused', async () => {
  const db = makeDb();
  const staff = { id: 99, roles: ['admin'] };
  await assert.rejects(() => moderatePost(db, staff, 1, 'DELETE'), { code: 'VALIDATION_FAILED' });
  assert.equal((await moderatePost(db, staff, 1, 'REMOVE')).status, 'REMOVED');
  await assert.rejects(() => moderatePost(db, staff, 1, 'KEEP'), { code: 'NOT_FOUND' });
  assert.deepEqual(MODERATE_ACTIONS, ['KEEP', 'HIDE', 'REMOVE']);
});

// ── Photos and video ────────────────────────────────────────────────────────────────────────

test('a post names at most four distinct, valid files', () => {
  assert.deepEqual(validateMediaIds(undefined), []);
  assert.deepEqual(validateMediaIds(['5', 6]), [5, 6]);
  assert.throws(() => validateMediaIds('5'), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateMediaIds([0]), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateMediaIds(['x']), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateMediaIds([1, 1]), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateMediaIds([1, 2, 3, 4, 5]), { code: 'VALIDATION_FAILED' });
  assert.equal(LIMITS.media, 4);
  assert.equal(mediaKind('video/mp4'), 'VIDEO');
  assert.equal(mediaKind('image/png'), 'IMAGE');
});

const SUPPLIER = { id: 10, roles: ['supplier'] };
const UPDATE = { kind: 'RESTOCK', product_id: 1, body: 'More stock', details: { stock: 5, min_order: 1, wholesale_price: 10 } };
const upload = (id, over = {}) => ({ id, mime_type: 'image/png', storage_key: `community/${id}.png`, owner_id: 10, purpose: 'COMMUNITY', used: false, ...over });

test('a post is saved with its files in the order the author chose', async () => {
  const db = makeDb({ media: [upload(1), upload(2, { mime_type: 'video/mp4', storage_key: 'community/2.mp4' }), upload(3)] });
  const post = await createPost(db, SUPPLIER, { ...UPDATE, media_ids: [3, 1, 2] });
  assert.deepEqual(db.attached.map((a) => a.media_id), [3, 1, 2]);
  assert.deepEqual(db.attached.map((a) => a.position), [0, 1, 2]);
  assert.deepEqual(post.media.map((m) => [m.id, m.kind]), [[3, 'IMAGE'], [1, 'IMAGE'], [2, 'VIDEO']]);
  assert.ok(post.media.every((m) => m.url.endsWith(`.${m.kind === 'VIDEO' ? 'mp4' : 'png'}`)));
});

test('a file that is not yours, not for the community, or already used cannot be attached, and nothing is saved', async () => {
  const db = makeDb({ media: [upload(1, { owner_id: 99 }), upload(2, { purpose: 'PRODUCT' }), upload(3, { used: true }), upload(4)] });
  for (const id of [1, 2, 3, 99]) {
    await assert.rejects(() => createPost(db, SUPPLIER, { ...UPDATE, media_ids: [4, id] }), { code: 'VALIDATION_FAILED' });
  }
  assert.equal(db.attached.length, 0);
  assert.ok(db.calls.includes('ROLLBACK'), 'the post is rolled back with its files');
  assert.equal(db.calls.filter((c) => c === 'COMMIT').length, 0);
});

test('a post can have one video', async () => {
  const mp4 = { mime_type: 'video/mp4', storage_key: 'community/v.mp4' };
  const db = makeDb({ media: [upload(1, mp4), upload(2, mp4), upload(3)] });
  await assert.rejects(() => createPost(db, SUPPLIER, { ...UPDATE, media_ids: [1, 2] }), { code: 'VALIDATION_FAILED' });
  assert.equal((await createPost(db, SUPPLIER, { ...UPDATE, media_ids: [1, 3] })).media.length, 2);
});

test('a post with no files still saves and lists no media; announcements can carry files too', async () => {
  const db = makeDb({ media: [upload(1, { owner_id: 2 })] });
  assert.deepEqual((await createPost(db, SUPPLIER, UPDATE)).media, []);
  const ann = await createAnnouncement(db, { id: 2, roles: ['admin'] }, { title: 'Eid', body: 'Dates', media_ids: [1] });
  assert.equal(ann.media.length, 1);
  assert.equal(db.audit.at(-1).after.media, 1);
});

// ── Migration, catalog and module agree with the code ──────────────────────────────────────

test('the migration CHECK lists match what the service accepts', () => {
  const sql = read('server', 'src', 'db', 'migrations', '080_community_posts.sql');
  const list = (re) => [...(sql.match(re)?.[1] ?? '').matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(list(/post_type\s+TEXT NOT NULL CHECK \(post_type IN \(([^)]*)\)/), [...new Set(Object.values(ROLE_POST).map((s) => s.type))]);
  assert.deepEqual(list(/reason\s+TEXT NOT NULL CHECK \(reason IN \(([^)]*)\)/), REPORT_REASONS);
  assert.deepEqual(list(/author_role\s+TEXT NOT NULL CHECK \(author_role IN \(([^)]*)\)/), Object.keys(ROLE_POST));
  assert.match(sql, /community\.auto_hide_report_threshold/);
  assert.match(sql, /UNIQUE \(post_id, reporter_id\)/);
});

test('the media migration allows the COMMUNITY purpose and lets a file sit on one post only', () => {
  const sql = read('server', 'src', 'db', 'migrations', '081_community_post_media.sql');
  assert.match(sql, /'COMMUNITY'\)\)/);
  assert.match(sql, /UNIQUE \(media_id\)/);
  assert.match(sql, /media_id\s+BIGINT\s+NOT NULL REFERENCES media_assets\(id\) ON DELETE RESTRICT/);
  // Every purpose the service accepts is allowed by the table, so an upload cannot pass the service and die on the CHECK.
  const service = read('server', 'src', 'services', 'media.service.ts');
  const allowed = [...(service.match(/ALLOWED_PURPOSES = new Set\(\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(allowed.includes('COMMUNITY'));
  for (const purpose of allowed) assert.ok(sql.includes(`'${purpose}'`), `${purpose} is missing from the table's purpose CHECK`);
  assert.match(read('server', 'src', 'routes', 'communityPost.routes.ts'), /media_ids: \{ type: 'array', maxItems: 4/);
});

test('the permissions and the module exist where the routes expect them', () => {
  const catalog = JSON.parse(read('docs', 'permission-catalog.json'));
  const byKey = new Map(catalog.permissions.map((p) => [p.key, p]));
  for (const key of ['community.post.create_own', 'community.post.report', 'community.post.announce', 'community.post.moderate']) {
    assert.ok(byKey.has(key), `${key} is missing from the catalog`);
  }
  assert.ok(byKey.get('community.post.create_own').default_roles.includes('customer'));
  assert.ok(byKey.get('community.post.moderate').default_roles.includes('moderator'));
  assert.equal(byKey.get('community.post.announce').default_roles.includes('customer'), false);

  const seed = JSON.parse(read('server', 'src', 'config', 'modules.seed.json'));
  const modules = Array.isArray(seed) ? seed : seed.modules;
  assert.ok(modules.some((m) => m.key === 'community_posts'));
  assert.match(read('server', 'src', 'db', 'seeds', '003_modules.sql'), /\('community_posts'/);

  const routes = read('server', 'src', 'routes', 'communityPost.routes.ts');
  for (const key of ['community.post.create_own', 'community.post.report', 'community.post.announce', 'community.post.moderate']) {
    assert.ok(routes.includes(`'${key}'`), `${key} is not enforced by any route`);
  }
});
