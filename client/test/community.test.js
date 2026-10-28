/**
 * community.test.js — invariants for the /community timeline.
 *
 * Suites:
 *   1. Locale integrity — the `community` block has the same keys and the same {{placeholders}} in en
 *      and bn, every key the components render exists, and the keys they build at run time resolve.
 *   2. Mock contract — the preview handlers keep the rules the server enforces: a role sees only the
 *      audiences meant for it, posts go live at once, one report per person, the report that reaches
 *      the threshold hides the post, and a moderator decision moves the post and its reports.
 *   3. Wiring — the route, the nav items and the module flag agree, and the gallery shows both
 *      components.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { handleMockRequest } from '../src/mocks/index.ts';
import { appStore, setMockRole, logOutMock } from '../src/state/appStore.ts';
import { ROLE_KINDS, REPORT_REASONS, AUDIENCES, POST_MEDIA, COMMENT_MAX } from '../src/services/community.api.ts';
import { checkNewFile } from '../src/components/community/MediaPicker.ts';
import { MOCK_COMMUNITY_TEMPLATES } from '../src/mocks/handlers/community.js';
import { navItems } from '../src/config/navigation.js';

const src = path.resolve(import.meta.dirname, '../src');
const read = (...p) => fs.readFileSync(path.join(src, ...p), 'utf8');
const en = JSON.parse(read('locales', 'en.json'));
const bn = JSON.parse(read('locales', 'bn.json'));

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
const get = (obj, key) => key.split('.').reduce((a, p) => (a == null ? a : a[p]), obj);
const placeholders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

const COMPONENT_FILES = [
  ['pages', 'CommunityPage.js'],
  ['components', 'community', 'PostCard.ts'],
  ['components', 'community', 'PostComposer.ts'],
  ['components', 'community', 'ModerationQueue.ts'],
  ['components', 'community', 'MediaPicker.ts'],
  ['components', 'community', 'CommentThread.ts'],
];

// ── 1. Locale integrity ────────────────────────────────────────────────────────────────────

test('the community block has identical keys and placeholders in en and bn', () => {
  const a = new Map(flatten(en.community));
  const b = new Map(flatten(bn.community));
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
  for (const [key, value] of a) {
    assert.ok(String(b.get(key)).trim(), `bn community.${key} is empty`);
    assert.deepEqual(placeholders(b.get(key)), placeholders(value), `community.${key}: placeholders differ between en and bn`);
  }
});

test('every static community key the components render exists in both languages', () => {
  const missing = [];
  for (const file of COMPONENT_FILES) {
    const code = read(...file);
    for (const [, key] of code.matchAll(/\bt\('(community\.[\w.]+)'/g)) {
      for (const [name, dict] of [['en', en], ['bn', bn]]) if (get(dict, key) === undefined) missing.push(`${name}:${key}`);
    }
    for (const [, key] of code.matchAll(/label: '(community\.[\w.]+)'/g)) {
      for (const [name, dict] of [['en', en], ['bn', bn]]) if (get(dict, key) === undefined) missing.push(`${name}:${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the keys built at run time resolve for every role, kind, reason, audience and rating', () => {
  const need = [];
  for (const role of ['customer', 'supplier', 'saler', 'admin']) need.push(`community.role.${role}`, `community.from.${role}`);
  for (const role of ['customer', 'supplier', 'saler', 'admin', 'super_admin']) need.push(`community.composer.placeholder.${role}`);
  for (const key of ['review', 'update', 'idea', 'announce']) need.push(`community.composer.title.${key}`, `community.composer.sub.${key}`);
  for (const key of ['review', 'update', 'idea']) need.push(`community.composer.no_products.${key}`);
  for (const kinds of new Set(Object.values(ROLE_KINDS))) for (const k of kinds) need.push(`community.kind.${k}`);
  for (const r of REPORT_REASONS) need.push(`community.report.reason.${r}`);
  for (const a of AUDIENCES) need.push(`community.audience.${a}`);
  for (let i = 1; i <= 5; i += 1) need.push(`community.composer.rating_word.${i}`);
  for (const a of ['KEEP', 'HIDE', 'REMOVE']) need.push(`community.mod.done.${a}`);
  for (const tab of ['all', 'review', 'update', 'idea', 'announce']) need.push(`community.tab.${tab}`);
  for (const s of ['recent', 'top']) need.push(`community.sort.${s}`);
  for (const f of ['quality', 'value', 'delivery']) need.push(`community.card.facet.${f}`);
  for (const k of ['bad_type', 'too_many', 'one_video', 'too_large_image', 'too_large_video', 'failed']) need.push(`community.media.error.${k}`);
  need.push('nav.shared.community', 'perm_matrix.domain_community');
  const missing = need.filter((k) => get(en, k) === undefined || get(bn, k) === undefined);
  assert.deepEqual(missing, []);
});

// ── 2. Mock contract ───────────────────────────────────────────────────────────────────────

const call = (method, p, body, query) => handleMockRequest({ method, path: p, body, query });
const ids = (res) => res.body.data.posts.map((p) => p.id);

test('a role sees only the audiences meant for it, and a guest sees public posts', () => {
  logOutMock();
  assert.deepEqual(call('GET', '/community/posts').body.data.posts.map((p) => p.type).sort(), ['ANNOUNCEMENT', 'IDEA', 'REVIEW']);

  setMockRole('customer');
  const asCustomer = call('GET', '/community/posts');
  assert.ok(!asCustomer.body.data.posts.some((p) => p.type === 'UPDATE'), 'a supplier update is for shop partners, not customers');

  setMockRole('saler');
  assert.ok(call('GET', '/community/posts').body.data.posts.some((p) => p.type === 'UPDATE'));
  assert.equal(call('GET', '/community/posts', null, { type: 'IDEA' }).body.data.posts.length, 1);
  assert.equal(call('GET', '/community/posts', null, { sort: 'top' }).body.data.posts[0].is_pinned, true, 'the pinned post stays first');
});

test('each role posts only its own type, and the post is live at once', () => {
  setMockRole('customer');
  const noProof = call('POST', '/community/posts', { kind: 'REVIEW', order_item_id: 1, details: { rating: 5, liked: 'x' } });
  assert.equal(noProof.status, 400, 'a review needs a delivered order line');
  const wrongKind = call('POST', '/community/posts', { kind: 'RESTOCK', details: {} });
  assert.equal(wrongKind.status, 400);

  const review = call('POST', '/community/posts', { kind: 'REVIEW', order_item_id: 4822, details: { rating: 5, liked: 'Great fit' } });
  assert.equal(review.status, 201);
  assert.equal(review.body.data.post.verified_purchase, true);
  assert.equal(review.body.data.post.status, 'PUBLISHED');
  assert.ok(ids(call('GET', '/community/posts')).includes(review.body.data.post.id));
  const again = call('POST', '/community/posts', { kind: 'REVIEW', order_item_id: 4822, details: { rating: 5, liked: 'twice' } });
  assert.equal(again.status, 409, 'one review per order line');

  setMockRole('supplier');
  assert.equal(call('POST', '/community/announcements', { title: 'x', body: 'y' }).status, 403);
  const update = call('POST', '/community/posts', {
    kind: 'RESTOCK', product_id: 101, body: 'More stock', details: { stock: 10, min_order: 2, wholesale_price: 100, tiers: [{ min_qty: 5, price: 90 }] },
  });
  assert.equal(update.status, 201);
  assert.equal(update.body.data.post.details.best_price, 90);

  setMockRole('admin');
  const ann = call('POST', '/community/announcements', { kind: 'ANNOUNCEMENT', title: 'Hello', body: 'World', audience: 'EVERYONE', is_pinned: true });
  assert.equal(ann.status, 201);
  assert.equal(call('POST', '/community/posts', { kind: 'ANNOUNCEMENT', title: 'x' }).status, 403, 'admins post through /announcements');
});

test('reporting leaves the post live, counts once per person, and the threshold hides it', () => {
  setMockRole('saler');
  const own = call('POST', '/community/posts/4/report', { reason: 'SPAM' });
  assert.equal(own.status, 403, 'nobody reports their own post');
  assert.equal(call('POST', '/community/posts/3/report', { reason: 'RUDE' }).status, 400);

  // Post 3 is seeded with 3 open reports; the threshold is 5.
  const first = call('POST', '/community/posts/3/report', { reason: 'MISLEADING' });
  assert.deepEqual(first.body.data, { reported: true, already_reported: false, auto_hidden: false });
  const repeat = call('POST', '/community/posts/3/report', { reason: 'MISLEADING' });
  assert.deepEqual(repeat.body.data, { reported: false, already_reported: true, auto_hidden: false });
  assert.ok(ids(call('GET', '/community/posts')).includes(3), 'still live after reports below the threshold');

  setMockRole('customer');
  const fifth = call('POST', '/community/posts/3/report', { reason: 'SPAM' });
  assert.equal(fifth.body.data.auto_hidden, true);
  setMockRole('saler');
  assert.ok(!ids(call('GET', '/community/posts')).includes(3), 'a hidden post leaves the timeline');
});

test('only staff reach the queue, and Keep brings a hidden post back with its reports dismissed', () => {
  setMockRole('customer');
  assert.equal(call('GET', '/admin/community/queue').status, 403);
  assert.equal(call('POST', '/admin/community/posts/3/moderate', { action: 'KEEP' }).status, 403);

  setMockRole('moderator');
  const queue = call('GET', '/admin/community/queue').body.data;
  const row = queue.items.find((i) => i.id === 3);
  assert.equal(row.status, 'HIDDEN');
  assert.equal(row.top_reason, 'MISLEADING');
  assert.equal(queue.threshold, 5);
  assert.equal(call('POST', '/admin/community/posts/3/moderate', { action: 'DELETE' }).status, 400);

  const kept = call('POST', '/admin/community/posts/3/moderate', { action: 'KEEP' });
  assert.equal(kept.body.data.status, 'PUBLISHED');
  assert.ok(kept.body.data.reports_resolved >= 5);
  setMockRole('saler');
  assert.ok(ids(call('GET', '/community/posts')).includes(3));

  setMockRole('moderator');
  assert.equal(call('POST', '/admin/community/posts/3/moderate', { action: 'REMOVE' }).body.data.status, 'REMOVED');
  assert.equal(call('POST', '/admin/community/posts/3/moderate', { action: 'KEEP' }).status, 404, 'a removed post cannot come back');
  logOutMock();
  assert.equal(appStore.get().auth.isAuthenticated, false);
});

// ── 3. Wiring ───────────────────────────────────────────────────────────────────────────────

test('the routes, the nav items and the module flag agree', () => {
  const main = read('main.js');
  assert.match(main, /path: '\/community',[\s\S]*?module: 'community_posts'[\s\S]*?CommunityPage\.js/);
  assert.match(main, /path: '\/admin\/community',[\s\S]*?permission: 'community\.post\.moderate'[\s\S]*?CommunityPage\.js/);
  const items = navItems.filter((i) => i.path === '/community' || i.path === '/admin/community');
  assert.deepEqual(items.map((i) => i.key).sort(), ['admin.content.community', 'customer.community', 'moderator.community', 'saler.community', 'supplier.community']);
  for (const i of items) assert.equal(i.module, 'community_posts', `${i.key} must be gated by the module the route uses`);
  assert.equal(items.find((i) => i.key === 'admin.content.community').permission, 'community.post.moderate');
  assert.match(read('state', 'appStore.ts'), /community_posts: true/);
});

test('both components are in the dev gallery', () => {
  const gallery = read('pages', 'dev', 'gallery-registry.js');
  assert.match(gallery, /id: 'community-post-card'/);
  assert.match(gallery, /id: 'community-post-composer'/);
});

test('the TopBar carries a Community button gated by the module, staff routed to the moderation page', () => {
  const bar = read('components', 'shell', 'TopBar.ts');
  assert.match(bar, /isFeatureEnabled\('community_posts'\)/);
  assert.match(bar, /COMMUNITY_STAFF_ROLES = \['super_admin', 'admin', 'moderator'\]/);
  assert.match(bar, /'\/admin\/community' : '\/community'/);
  assert.match(bar, /t\('nav\.community'\)/);
  assert.ok(get(en, 'nav.community') && get(bn, 'nav.community'));
  assert.match(read('styles', 'components', 'shell.css'), /\.topbar__community-btn--guest \{ display: none; \}/);
});

// ── 4. Photos and video ───────────────────────────────────────────────────────────────────

const file = (name, type, size) => ({ name, type, size });

test('the picker limits mirror the server source', () => {
  const server = fs.readFileSync(path.resolve(src, '../../server/src/services/communityPost.service.ts'), 'utf8');
  const media = fs.readFileSync(path.resolve(src, '../../server/src/services/media.service.ts'), 'utf8');
  assert.match(server, new RegExp(`media: ${POST_MEDIA.maxFiles}, videos: ${POST_MEDIA.maxVideos}`));
  assert.match(media, new RegExp(`MAX_IMAGE_SIZE_BYTES = ${POST_MEDIA.maxImageBytes / 1024 / 1024} \\* 1024 \\* 1024`));
  assert.match(media, new RegExp(`MAX_DIRECT_UPLOAD_BYTES = ${POST_MEDIA.maxVideoBytes / 1024 / 1024} \\* 1024 \\* 1024`));
  const uploader = read('components', 'media', 'ImageUploader.ts');
  for (const type of POST_MEDIA.types) assert.ok(uploader.includes(`'${type}'`), `${type} is not an uploadable type`);
});

test('checkNewFile refuses a wrong type, a big file, a fifth file and a second video', () => {
  assert.equal(checkNewFile(file('a.jpg', 'image/jpeg', 1000), []), null);
  assert.equal(checkNewFile(file('a.mp4', 'video/mp4', 1000), []), null);
  assert.equal(checkNewFile(file('a.exe', 'application/octet-stream', 10), []).key, 'community.media.error.bad_type');
  assert.equal(checkNewFile(file('a.svg', 'image/svg+xml', 10), []).key, 'community.media.error.bad_type');
  assert.equal(checkNewFile(file('big.jpg', 'image/jpeg', POST_MEDIA.maxImageBytes + 1), []).key, 'community.media.error.too_large_image');
  assert.equal(checkNewFile(file('ok.jpg', 'image/jpeg', POST_MEDIA.maxImageBytes), []), null);
  assert.equal(checkNewFile(file('big.mp4', 'video/mp4', POST_MEDIA.maxVideoBytes + 1), []).key, 'community.media.error.too_large_video');
  const four = Array.from({ length: POST_MEDIA.maxFiles }, () => ({ isVideo: false }));
  assert.equal(checkNewFile(file('a.jpg', 'image/jpeg', 10), four).key, 'community.media.error.too_many');
  assert.equal(checkNewFile(file('b.mp4', 'video/mp4', 10), [{ isVideo: true }]).key, 'community.media.error.one_video');
  assert.equal(checkNewFile(file('b.jpg', 'image/jpeg', 10), [{ isVideo: true }]), null, 'a photo may sit beside a video');
});

test('mock: files upload, attach in order, and cannot be reused, borrowed or mixed up', () => {
  setMockRole('saler');
  const upload = (mime, purpose = 'COMMUNITY') => call('POST', '/media/direct', { purpose, filename: 'x', data_base64: `data:${mime};base64,AAAA` }).body.asset;
  const a = upload('image/png');
  const b = upload('video/mp4');
  const c = upload('image/png');
  const body = (ids) => ({ kind: 'CREATIVE_IDEA', product_id: 101, title: 'Look', details: { steps: ['One'] }, media_ids: ids });

  const made = call('POST', '/community/posts', body([c.id, a.id, b.id]));
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.data.post.media.map((m) => [m.id, m.kind]), [[c.id, 'IMAGE'], [a.id, 'IMAGE'], [b.id, 'VIDEO']]);
  const listed = call('GET', '/community/posts').body.data.posts.find((p) => p.id === made.body.data.post.id);
  assert.equal(listed.media.length, 3);

  assert.equal(call('POST', '/community/posts', body([a.id])).status, 400, 'a file already on a post cannot be used again');
  assert.equal(call('POST', '/community/posts', body([999])).status, 400, 'an unknown file');
  assert.equal(call('POST', '/community/posts', body([upload('image/png', 'PRODUCT').id])).status, 400, 'a file uploaded for another purpose');
  assert.equal(call('POST', '/community/posts', body([1, 2, 3, 4, 5])).status, 400, 'more than four');
  const v1 = upload('video/mp4');
  const v2 = upload('video/mp4');
  assert.equal(call('POST', '/community/posts', body([v1.id, v2.id])).status, 400, 'two videos');
  assert.equal(call('POST', '/community/posts', { ...body([]), media_ids: undefined }).status, 201, 'a post without files is fine');
  logOutMock();
});

// ── 5. The auto-hide setting ──────────────────────────────────────────────────────────────

test('mock: only an admin can change the threshold, with a reason, and the queue and the next report use it', () => {
  const put = (body) => call('PUT', '/admin/community/settings', body);
  const good = { auto_hide_report_threshold: 6, reason: 'A little more patience before hiding' };

  setMockRole('moderator');
  assert.equal(put(good).status, 403, 'a moderator can view the queue but not change the rule');
  assert.equal(call('GET', '/admin/community/queue').body.data.threshold, 5);

  setMockRole('admin');
  assert.equal(put({ ...good, auto_hide_report_threshold: 1 }).status, 400);
  assert.equal(put({ ...good, auto_hide_report_threshold: 51 }).status, 400);
  assert.equal(put({ ...good, auto_hide_report_threshold: 5.5 }).status, 400);
  assert.equal(put({ ...good, auto_hide_report_threshold: '6' }).status, 400);
  assert.equal(put({ auto_hide_report_threshold: 6, reason: 'short' }).status, 400);
  assert.equal(call('GET', '/admin/community/queue').body.data.threshold, 5, 'refused changes leave the value alone');

  const saved = put(good);
  assert.deepEqual(saved.body.data, { auto_hide_report_threshold: 6, previous: 5 });
  const queue = call('GET', '/admin/community/queue').body.data;
  assert.equal(queue.threshold, 6);
  assert.deepEqual(queue.threshold_limits, { min: 2, max: 50 });

  // Post 2 starts with 1 open report; with the threshold at 6 two more reports must not hide it.
  setMockRole('saler');
  assert.equal(call('POST', '/community/posts/2/report', { reason: 'SPAM' }).body.data.auto_hidden, false);
  setMockRole('supplier');
  assert.equal(call('POST', '/community/posts/2/report', { reason: 'SPAM' }).body.data.auto_hidden, false);
  assert.ok(call('GET', '/community/posts').body.data.posts.some((p) => p.id === 2));

  setMockRole('admin');
  put({ auto_hide_report_threshold: 5, reason: 'Back to the default setting' });
  assert.equal(call('GET', '/admin/community/queue').body.data.threshold, 5);
  logOutMock();
});

test('the settings form is shown only to holders of community.settings.update', () => {
  const queue = read('components', 'community', 'ModerationQueue.ts');
  assert.match(queue, /can\('community\.settings\.update'\)/);
  assert.match(queue, /MIN_REASON = 10/);
  const catalog = JSON.parse(fs.readFileSync(path.resolve(src, '../../docs/permission-catalog.json'), 'utf8'));
  const perm = catalog.permissions.find((p) => p.key === 'community.settings.update');
  assert.deepEqual([...perm.default_roles].sort(), ['admin', 'super_admin']);
  for (const k of ['title', 'label', 'reason', 'reason_ph', 'hint', 'save', 'saved', 'range', 'unchanged', 'reason_short']) {
    assert.ok(get(en, `community.mod.settings.${k}`) && get(bn, `community.mod.settings.${k}`), `community.mod.settings.${k}`);
  }
});

// ── 6. Comments ───────────────────────────────────────────────────────────────────────────

test('the comment limit mirrors the server source', () => {
  const server = fs.readFileSync(path.resolve(src, '../../server/src/services/communityPost.service.ts'), 'utf8');
  assert.match(server, new RegExp(`comment: ${COMMENT_MAX}`));
});

test('mock: a comment is live at once, counts on the post, and is readable only where the post is', () => {
  const commentsOf = (id, query) => call('GET', `/community/posts/${id}/comments`, null, query);
  const postCount = (id) => call('GET', '/community/posts').body.data.posts.find((p) => p.id === id)?.comment_count;

  // A fresh supplier update (for shop partners), so earlier tests' moderation of the seeded ones cannot matter.
  setMockRole('supplier');
  const POST = call('POST', '/community/posts', {
    kind: 'RESTOCK', product_id: 101, body: 'More stock', details: { stock: 10, min_order: 2, wholesale_price: 100 },
  }).body.data.post.id;
  const reply = call('POST', `/community/posts/${POST}/comments`, { body: 'Ask me anything about it.' });
  assert.equal(reply.status, 201, 'the author may comment on their own post although they are not in its audience');

  setMockRole('customer');
  assert.equal(commentsOf(POST).status, 404, 'a customer cannot see a post meant for shop partners');
  assert.equal(call('POST', `/community/posts/${POST}/comments`, { body: 'hi' }).status, 404);

  setMockRole('saler');
  assert.equal(commentsOf(POST).body.data.comments.length, 1);
  assert.equal(postCount(POST), 1);
  const added = call('POST', `/community/posts/${POST}/comments`, { body: '  Is it breathable?  ' });
  assert.equal(added.status, 201);
  assert.equal(added.body.data.comment.body, 'Is it breathable?');
  assert.equal(added.body.data.comment.is_mine, true);
  assert.equal(added.body.data.comment_count, 2);
  assert.equal(postCount(POST), 2);
  assert.deepEqual(commentsOf(POST).body.data.comments.map((c) => c.is_mine), [false, true], 'oldest first, mine marked');

  assert.equal(call('POST', `/community/posts/${POST}/comments`, { body: '   ' }).status, 400);
  assert.equal(call('POST', `/community/posts/${POST}/comments`, { body: 'x'.repeat(COMMENT_MAX + 1) }).status, 400);

  // Deleting: only your own.
  const theirs = commentsOf(POST).body.data.comments[0].id;
  assert.equal(call('DELETE', `/community/comments/${theirs}`).status, 403, "someone else's comment");
  assert.equal(call('DELETE', `/community/comments/${added.body.data.comment.id}`).body.data.comment_count, 1);
  assert.equal(call('DELETE', `/community/comments/${added.body.data.comment.id}`).status, 404, 'already gone');
  assert.equal(postCount(POST), 1);

  // Staff remove any comment; a member cannot use that route.
  assert.equal(call('POST', `/admin/community/comments/${theirs}/remove`).status, 403);
  setMockRole('moderator');
  assert.equal(call('POST', `/admin/community/comments/${theirs}/remove`).body.data.comment_count, 0);
  assert.equal(call('POST', `/admin/community/comments/${theirs}/remove`).status, 404);

  // A guest reads a public post's thread (post 2 is seeded with one comment) but cannot write.
  logOutMock();
  assert.equal(commentsOf(2).body.data.comments.length, 1);
  assert.equal(commentsOf(POST).status, 404);
  assert.equal(call('POST', '/community/posts/2/comments', { body: 'hi' }).status, 401);
});

// ── 7. Saved posts ────────────────────────────────────────────────────────────────────────

test('mock: saving is private, toggles, and the Saved list is the member\'s own', () => {
  const list = (query) => call('GET', '/community/posts', null, query).body.data.posts;
  const save = (id) => call('POST', `/community/posts/${id}/save`);

  setMockRole('customer');
  assert.equal(list({ saved: '1' }).length, 0, 'nothing saved yet');
  assert.deepEqual(save(2).body.data, { saved: true });
  assert.deepEqual(list({ saved: '1' }).map((p) => p.id), [2]);
  assert.equal(list().find((p) => p.id === 2).saved_by_me, true, 'the post carries the flag for its saver');
  assert.equal(list({ saved: '1', type: 'ANNOUNCEMENT' }).length, 0, 'the Saved list still honours the type tab');

  // Another member sees none of it.
  setMockRole('saler');
  assert.equal(list({ saved: '1' }).length, 0);
  assert.equal(list().find((p) => p.id === 2).saved_by_me, false);

  // A post you cannot see cannot be saved; a guest cannot save and has no list.
  setMockRole('customer');
  assert.equal(save(3).status, 404, 'meant for shop partners');
  assert.equal(save(9999).status, 404);
  logOutMock();
  assert.equal(save(2).status, 401);
  assert.equal(list({ saved: '1' }).length, 0, 'a guest asking for saved posts gets an empty list, not everyone\'s');

  // Taking it off.
  setMockRole('customer');
  assert.deepEqual(save(2).body.data, { saved: false });
  assert.equal(list({ saved: '1' }).length, 0);
  logOutMock();
});

test('the page offers the Saved filter to signed-in members and the card carries the button', () => {
  const page = read('pages', 'CommunityPage.js');
  assert.match(page, /community\.filter\.saved/);
  assert.match(page, /saved: state\.saved/);
  assert.match(page, /onSave:/);
  const card = read('components', 'community', 'PostCard.ts');
  assert.match(card, /icon\('bookmark'\)/);
  assert.match(card, /community\.card\.saved_toast/);
  assert.ok(read('components', 'ui', 'icons.ts').includes('bookmark: svg('));
});

// ── 8. Notifications and links to one post ────────────────────────────────────────────────


// Oldest first (the API answers newest first), so "what was added" is a slice off the end.
const inbox = () => call('GET', '/notifications', null, { category: 'COMMUNITY' }).body.data.items.slice().sort((x, y) => x.id - y.id);
const unread = () => call('GET', '/notifications/unread-count').body.data.unread_count;

test('mock: a comment tells the post author, once, with a link that opens the thread, and nobody else', () => {
  // Post 4 is the shop partner's idea (author role: saler).
  setMockRole('saler');
  const before = inbox().length;
  const unreadBefore = unread();

  setMockRole('customer');
  assert.equal(call('POST', '/community/posts/4/comments', { body: 'Great idea, thank you for sharing it with everyone.' }).status, 201);
  assert.equal(inbox().length, 0, "the commenter's own inbox gets nothing");

  setMockRole('saler');
  const got = inbox();
  assert.equal(got.length, before + 1);
  const n = got.at(-1);
  assert.equal(n.template_key, 'COMMUNITY_COMMENT');
  assert.equal(n.category, 'COMMUNITY');
  assert.equal(n.data_json.linkUrl, '/community?post=4&comments=1');
  assert.match(n.body_en, /Great idea/);
  assert.equal(unread(), unreadBefore + 1);

  // A second comment while that one is unread adds no second bell.
  setMockRole('customer');
  call('POST', '/community/posts/4/comments', { body: 'A second comment' });
  setMockRole('saler');
  assert.equal(inbox().length, before + 1);

  // Reading it lets the next comment notify again.
  call('POST', `/notifications/${n.id}/read`);
  setMockRole('supplier');
  call('POST', '/community/posts/4/comments', { body: 'A comment after the bell was read' });
  setMockRole('saler');
  assert.equal(inbox().length, before + 2);

  // Commenting on your own post tells nobody.
  call('POST', '/community/posts/4/comments', { body: 'replying on my own post' });
  assert.equal(inbox().length, before + 2);
  logOutMock();
});

test('mock: a moderator decision tells the author with a link or none, and staff comment removal tells the commenter', () => {
  setMockRole('saler');
  const ideaId = call('POST', '/community/posts', { kind: 'USABILITY_TIP', product_id: 101, title: 'Tip', details: { steps: ['x'] } }).body.data.post.id;
  const base = inbox().length;

  setMockRole('moderator');
  call('POST', `/admin/community/posts/${ideaId}/moderate`, { action: 'KEEP' });
  setMockRole('saler');
  assert.equal(inbox().length, base, 'keeping a post that was never hidden tells nobody');

  setMockRole('moderator');
  call('POST', `/admin/community/posts/${ideaId}/moderate`, { action: 'HIDE' });
  call('POST', `/admin/community/posts/${ideaId}/moderate`, { action: 'KEEP' });
  call('POST', `/admin/community/posts/${ideaId}/moderate`, { action: 'REMOVE' });
  setMockRole('saler');
  const added = inbox().slice(base);
  assert.deepEqual(added.map((x) => x.template_key), ['COMMUNITY_POST_HIDDEN', 'COMMUNITY_POST_RESTORED', 'COMMUNITY_POST_REMOVED']);
  assert.equal(added[0].data_json.linkUrl, `/community?post=${ideaId}`);
  assert.equal(added[2].data_json.linkUrl, '/community', 'a removed post has nothing to open');
  assert.ok(added.every((x) => x.title_bn && x.body_bn), 'every notice is bilingual');

  // Staff remove a customer's comment on post 2 (a public review) and the customer is told.
  setMockRole('customer');
  const comment = call('POST', '/community/posts/2/comments', { body: 'rude words' }).body.data.comment;
  const customerBase = inbox().length;
  setMockRole('moderator');
  call('POST', `/admin/community/comments/${comment.id}/remove`);
  setMockRole('customer');
  assert.equal(inbox().length, customerBase + 1);
  assert.equal(inbox().at(-1).template_key, 'COMMUNITY_COMMENT_REMOVED');
  assert.match(inbox().at(-1).body_en, /rude words/);
  logOutMock();
});

test('mock: a link to one post shows just that post, under the same visibility rules', () => {
  setMockRole('saler');
  const one = call('GET', '/community/posts', null, { post_id: '4' }).body.data.posts;
  assert.deepEqual(one.map((p) => p.id), [4]);
  assert.equal(call('GET', '/community/posts', null, { post_id: '99999' }).body.data.posts.length, 0);
  setMockRole('customer');
  assert.equal(call('GET', '/community/posts', null, { post_id: '3' }).body.data.posts.length, 0, 'a post meant for shop partners');
  logOutMock();
});

test('the mock notices are the migration templates, and the settings page and drawer know the category', () => {
  const sql = fs.readFileSync(path.resolve(src, '../../server/src/db/migrations/084_community_notifications.sql'), 'utf8');
  const migrationKeys = [...sql.matchAll(/\('(COMMUNITY_[A-Z_]+)', 'COMMUNITY'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...MOCK_COMMUNITY_TEMPLATES].sort(), migrationKeys);

  assert.match(read('pages', 'settings', 'NotificationPreferencesPage.js'), /key: 'COMMUNITY'/);
  assert.match(read('components', 'notifications', 'NotificationCenter.ts'), /id: 'COMMUNITY'/);
  for (const k of ['notifications.tab_community', 'notifications.cat_community_title', 'notifications.cat_community_desc', 'community.onepost.title', 'community.onepost.all']) {
    assert.ok(get(en, k) && get(bn, k), k);
  }
  assert.ok(call('GET', '/notifications/preferences').body.data.data?.some?.((p) => p.category === 'COMMUNITY')
    || call('GET', '/notifications/preferences').body.data.some((p) => p.category === 'COMMUNITY'));

  // The page reads the link and opens the thread; the share link points at the same URL shape.
  const page = read('pages', 'CommunityPage.js');
  assert.match(page, /params\.get\('post'\)/);
  assert.match(page, /params\.get\('comments'\) === '1'/);
  assert.match(read('components', 'community', 'PostCard.ts'), /\/community\?post=\$\{post\.id\}/);
});
