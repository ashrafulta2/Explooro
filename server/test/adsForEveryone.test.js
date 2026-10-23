/**
 * adsForEveryone.test.js — Phase C (migration 087): anyone can advertise through Boost, and an ad's
 * audience is a hard filter that never singles anyone out.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeAudience,
  isNarrowed,
  matchesAudience,
  resolveRules,
  assertAudienceAllowed,
  DEFAULT_RULES,
} from '../src/services/adAudience.service.ts';
import { normalizeTargeting } from '../src/services/ads.service.ts';
import { resolveCreativeTarget, postDestination } from '../src/services/adDestination.service.ts';

const read = (rel) => fs.readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');
const viewer = (over = {}) => ({ roles: ['customer'], gender: 'FEMALE', division: 'Dhaka', district: 'Gazipur', interests: [12], ...over });

describe('audience — normalising what a client sends', () => {
  test('unknown values are dropped, known ones canonicalised and de-duplicated', () => {
    const a = normalizeAudience({ roles: ['Customer', 'admin', 'customer'], gender: 'female', divisions: ['dhaka', 'Atlantis', 'DHAKA'], interests: [12, '12', -1, 'x'] });
    assert.deepEqual(a.roles, ['customer']);
    assert.equal(a.gender, 'FEMALE');
    assert.deepEqual(a.divisions, ['Dhaka']);
    assert.deepEqual(a.interests, [12]);
  });

  test('nothing chosen is "everyone", and targeting always carries an audience', () => {
    assert.equal(isNarrowed(normalizeAudience(null)), false);
    assert.equal(isNarrowed(normalizeAudience({ gender: 'ALL' })), false);
    assert.equal(isNarrowed(normalizeAudience({ divisions: ['Sylhet'] })), true);
    assert.deepEqual(normalizeTargeting({}).audience, normalizeAudience({}));
  });
});

describe('audience — the hard filter at serve time', () => {
  test('everyone matches an un-narrowed audience, signed in or not', () => {
    assert.equal(matchesAudience(normalizeAudience({}), null), true);
    assert.equal(matchesAudience(normalizeAudience({}), viewer()), true);
  });

  test('every condition must hold', () => {
    const a = normalizeAudience({ roles: ['customer'], gender: 'FEMALE', divisions: ['Dhaka'], interests: [12] });
    assert.equal(matchesAudience(a, viewer()), true);
    assert.equal(matchesAudience(a, viewer({ roles: ['supplier'] })), false);
    assert.equal(matchesAudience(a, viewer({ gender: 'MALE' })), false);
    assert.equal(matchesAudience(a, viewer({ division: 'Sylhet', district: 'Sylhet' })), false);
    assert.equal(matchesAudience(a, viewer({ interests: [99] })), false);
  });

  test('a signed-out visitor never matches account type or gender', () => {
    assert.equal(matchesAudience(normalizeAudience({ roles: ['customer'] }), null), false);
    assert.equal(matchesAudience(normalizeAudience({ gender: 'MALE' }), null), false);
  });

  test('an unknown gender only matches "all genders"', () => {
    assert.equal(matchesAudience(normalizeAudience({ gender: 'FEMALE' }), viewer({ gender: null })), false);
    assert.equal(matchesAudience(normalizeAudience({ gender: 'ALL' }), viewer({ gender: null })), true);
  });

  test('place: a district or division match is enough, and the page context fills in for a visitor', () => {
    assert.equal(matchesAudience(normalizeAudience({ districts: ['Gazipur'] }), viewer({ division: null })), true);
    assert.equal(matchesAudience(normalizeAudience({ districts: ['Bogura'] }), null, { district: 'bogura' }), true);
    assert.equal(matchesAudience(normalizeAudience({ divisions: ['Khulna'] }), null), false);
  });

  test('interest: from history, or from the category page being viewed', () => {
    const a = normalizeAudience({ interests: [14] });
    assert.equal(matchesAudience(a, viewer({ interests: [] }), { categoryId: '14' }), true);
    assert.equal(matchesAudience(a, viewer({ interests: [14] })), true);
    assert.equal(matchesAudience(a, viewer({ interests: [] })), false);
  });
});

describe('audience — never singling anyone out', () => {
  const dbCounting = (people) => ({
    query: async (sql) => (sql.includes('platform_settings')
      ? { rows: [{ value_json: { min_audience_size: 20, interest_window_days: 90 } }] }
      : { rows: [{ people }] }),
  });

  test('a narrowed audience below the minimum is refused', async () => {
    await assert.rejects(() => assertAudienceAllowed(dbCounting(3), normalizeAudience({ gender: 'MALE' })), (e) => e.code === 'AUDIENCE_TOO_SMALL');
    await assertAudienceAllowed(dbCounting(25), normalizeAudience({ gender: 'MALE' }));
  });

  test('"everyone" is never refused, however few accounts exist', async () => {
    await assertAudienceAllowed(dbCounting(0), normalizeAudience({}));
  });

  test('rules fall back field by field; the defaults equal the migration 087 seed', () => {
    assert.deepEqual(resolveRules({ min_audience_size: 0, interest_window_days: 30 }), { min_audience_size: DEFAULT_RULES.min_audience_size, interest_window_days: 30 });
    const seed = JSON.parse(read('src/db/migrations/087_ads_for_everyone.sql').match(/'(\{"min_audience_size"[^']*\})'::jsonb/)[1]);
    assert.deepEqual(seed, { ...DEFAULT_RULES });
  });
});

describe('Boost — what may be promoted', () => {
  const boost = { key: 'easy_boost', requires_product: false };
  const dbWith = (post, store = null) => ({
    query: async (sql) => {
      if (sql.includes('FROM community_posts')) return { rows: post ? [post] : [] };
      if (sql.includes('FROM virtual_stores')) return { rows: store ? [store] : [] };
      return { rows: [] };
    },
  });

  test('your own published post lands on that post', async () => {
    const t = await resolveCreativeTarget(dbWith({ id: 41, author_id: 7, status: 'PUBLISHED' }), { userId: 7, adProduct: boost, communityPostId: 41 });
    assert.equal(t.destinationUrl, postDestination(41));
  });

  test("someone else's post, or a hidden one, is refused", async () => {
    await assert.rejects(() => resolveCreativeTarget(dbWith({ id: 41, author_id: 8, status: 'PUBLISHED' }), { userId: 7, adProduct: boost, communityPostId: 41 }), (e) => e.code === 'AD_POST_NOT_OWNED');
    await assert.rejects(() => resolveCreativeTarget(dbWith({ id: 41, author_id: 7, status: 'HIDDEN' }), { userId: 7, adProduct: boost, communityPostId: 41 }), (e) => e.code === 'AD_POST_NOT_PUBLISHED');
  });

  test('with nothing to promote a Boost is refused instead of opening the home page', async () => {
    await assert.rejects(() => resolveCreativeTarget(dbWith(null), { userId: 7, adProduct: boost }), (e) => e.code === 'AD_TARGET_REQUIRED');
    const t = await resolveCreativeTarget(dbWith(null, { slug: 'my-shop' }), { userId: 6, adProduct: boost });
    assert.equal(t.destinationUrl, '/store/my-shop');
  });
});

describe('ads for everyone — wiring', () => {
  test('Boost is open to every account type; the old formats keep their roles', () => {
    const sql = read('src/db/migrations/087_ads_for_everyone.sql');
    assert.match(sql, /'easy_boost'[\s\S]*ARRAY\['customer', 'saler', 'supplier'\]/);
    assert.ok(!/UPDATE ad_products/.test(sql), 'no existing format is changed');
  });

  test('customers hold growth.ad.manage_own', () => {
    const catalog = JSON.parse(read('../docs/permission-catalog.json'));
    const perm = catalog.permissions.find((p) => p.key === 'growth.ad.manage_own');
    assert.ok(perm.default_roles.includes('customer'));
  });

  test('the wizard endpoints are guarded and the auction reads an optional viewer', () => {
    const src = read('src/routes/ads.routes.ts');
    assert.match(src, /'\/ads\/easy\/options'[\s\S]*?requireManageAds, checkCanRunAds/);
    assert.match(src, /'\/ads\/audience-estimate'[\s\S]*?requireManageAds/);
    assert.match(src, /'\/ads\/auction'[\s\S]*?viewerIfSignedIn/);
  });

  test('every new error code has an HTTP status', () => {
    const src = read('src/plugins/errorHandler.ts');
    for (const code of ['AD_POST_NOT_OWNED', 'AD_POST_NOT_PUBLISHED', 'AD_TARGET_REQUIRED', 'AUDIENCE_TOO_SMALL']) assert.ok(src.includes(`${code}:`), code);
  });
});
