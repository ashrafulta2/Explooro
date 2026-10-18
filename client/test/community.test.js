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

import { handleMockRequest } from '../src/mocks/index.js';
import { appStore, setMockRole, logOutMock } from '../src/state/appStore.js';
import { ROLE_KINDS, REPORT_REASONS, AUDIENCES } from '../src/services/community.api.js';
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
  ['components', 'community', 'PostCard.js'],
  ['components', 'community', 'PostComposer.js'],
  ['components', 'community', 'ModerationQueue.js'],
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
  assert.match(read('state', 'appStore.js'), /community_posts: true/);
});

test('both components are in the dev gallery', () => {
  const gallery = read('pages', 'dev', 'gallery-registry.js');
  assert.match(gallery, /id: 'community-post-card'/);
  assert.match(gallery, /id: 'community-post-composer'/);
});

test('the TopBar carries a Community button gated by the module, staff routed to the moderation page', () => {
  const bar = read('components', 'shell', 'TopBar.js');
  assert.match(bar, /isFeatureEnabled\('community_posts'\)/);
  assert.match(bar, /COMMUNITY_STAFF_ROLES = \['super_admin', 'admin', 'moderator'\]/);
  assert.match(bar, /'\/admin\/community' : '\/community'/);
  assert.match(bar, /t\('nav\.community'\)/);
  assert.ok(get(en, 'nav.community') && get(bn, 'nav.community'));
  assert.match(read('styles', 'components', 'shell.css'), /\.topbar__community-btn--guest \{ display: none; \}/);
});
