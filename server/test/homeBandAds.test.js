/**
 * homeBandAds.test.js — the premium ads of the home page's top band (migration 111).
 *
 *   1. Staff never see them; guests, customers, Explooro partners and suppliers do.
 *   2. A staff viewer gets three empty panels without a single query.
 *   3. The server's placements and viewer roles equal the client's and the mock's.
 *   4. The migration sells exactly one FLAT_DAILY format per panel and adds all three to the CHECK.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  HOME_BAND_PLACEMENTS, HOME_BAND_AD_VIEWER_ROLES, seesHomeBandAds, listHomeBandPlacements,
} from '../src/services/ads.service.ts';
import { HOME_BAND_PLACEMENTS as CLIENT_PLACEMENTS, HOME_BAND_POSITIONS } from '../../client/src/services/ads.api.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');

test('guests, customers, partners and suppliers see home band ads; staff never do', () => {
  assert.equal(seesHomeBandAds([]), true, 'a guest is a shopper');
  assert.equal(seesHomeBandAds(undefined), true);
  assert.equal(seesHomeBandAds(['customer']), true);
  assert.equal(seesHomeBandAds(['saler']), true);
  assert.equal(seesHomeBandAds(['supplier']), true);
  assert.equal(seesHomeBandAds(['customer', 'saler']), true);
  for (const staff of ['admin', 'super_admin', 'moderator', 'editor', 'finance']) {
    assert.equal(seesHomeBandAds([staff]), false, staff);
    assert.equal(seesHomeBandAds(['customer', staff]), false, `customer + ${staff}`);
  }
});

test('a staff viewer gets three empty panels without touching the database', async () => {
  const db = { query: () => { throw new Error('no query expected'); } };
  const out = await listHomeBandPlacements(db, null, { viewerRoles: ['admin'] });
  assert.deepEqual(out, { left: [], center: [], right: [] });
});

test('the client and the mock agree with the server on placements and viewer roles', () => {
  assert.deepEqual({ ...CLIENT_PLACEMENTS }, { ...HOME_BAND_PLACEMENTS });
  assert.deepEqual([...HOME_BAND_POSITIONS], Object.keys(HOME_BAND_PLACEMENTS));
  const mock = read('client/src/mocks/handlers/ads.ts');
  const m = mock.match(/MOCK_HOME_BAND_VIEWER_ROLES = \[([^\]]*)\]/);
  assert.ok(m, 'mock viewer roles not found');
  assert.deepEqual(m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean), [...HOME_BAND_AD_VIEWER_ROLES]);
});

test('migration 111 sells one FLAT_DAILY format per panel and widens the placement CHECK', () => {
  const sql = read('server/src/db/migrations/111_home_band_ads.sql');
  const check = sql.slice(sql.indexOf('CHECK (placement IN'), sql.indexOf('));'));
  for (const [position, placement] of Object.entries(HOME_BAND_PLACEMENTS)) {
    assert.ok(check.includes(`'${placement}'`), `${placement} missing from the CHECK`);
    const row = sql.match(new RegExp(`\\('home_band_${position}'[\\s\\S]*?'${placement}', '(\\w+)'`));
    assert.ok(row, `no ad product sells ${placement}`);
    assert.equal(row[1], 'FLAT_DAILY');
  }
  // Every placement an older migration allowed must still be allowed.
  for (const older of ['SEARCH_RESULTS', 'HOME_HERO', 'PUSH_INBOX', 'SOURCING_CATALOG']) {
    assert.ok(check.includes(`'${older}'`), `${older} dropped from the CHECK`);
  }
});
