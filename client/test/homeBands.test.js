/**
 * homeBands.test.js — the per-role home top band stays wired to real routes, real translations and
 * real figures.
 *
 * Drift here is silent: a renamed route is a dead link, a missing key renders a humanized slug, and a
 * stat key the API stopped sending shows "–" forever. All three are caught here instead.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ROLE_BANDS, FULL_BAND_ROLES, SLIDE_TONES } from '../src/components/home/homeBands.ts';
import { navItems } from '../src/config/navigation.ts';
import { formatStat, percentShares, BOARD_VIEWS } from '../src/components/home/RoleBand.ts';
import { MOCK_HOME_STATS, MOCK_HOME_INSIGHTS } from '../src/mocks/handlers/homeSummary.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const en = JSON.parse(readFileSync(join(root, 'locales/en.json'), 'utf8'));
const bn = JSON.parse(readFileSync(join(root, 'locales/bn.json'), 'utf8'));
const css = readFileSync(join(root, 'styles/components/home-top.css'), 'utf8');
const resolve = (dict, key) => key.split('.').reduce((node, part) => (node == null ? node : node[part]), dict);

const POSITIONS = ['left', 'center', 'right'];
// /chat is a topbar destination (the chat icon), not a sidebar item, so it is not in navItems.
const navPaths = new Set([...navItems.map((n) => n.path), '/chat']);
const textRole = (role) => (role === 'super_admin' ? 'admin' : role);

/** Every panel and slide as `{ base, def }`: `base` is its i18n prefix, `def` its body. */
function units(role, band) {
  const out = [];
  for (const [position, panel] of Object.entries(band)) {
    const base = `marketplace.top.band.${textRole(role)}.${position}`;
    if (panel.slides) for (const s of panel.slides) out.push({ base: `${base}.${s.id}`, def: s });
    else out.push({ base, def: panel });
  }
  return out;
}
const itemsOf = (def) => [...(def.rows || []), ...(def.metrics || []), ...(def.links || [])];

describe('home bands', () => {
  it('every role in FULL_BAND_ROLES defines all three panels; customer defines only the left one', () => {
    for (const role of FULL_BAND_ROLES) {
      assert.deepEqual(Object.keys(ROLE_BANDS[role]).sort(), [...POSITIONS].sort(), role);
    }
    assert.deepEqual(Object.keys(ROLE_BANDS.customer), ['left']);
  });

  it('every link points at a route that exists in the navigation', () => {
    const missing = [];
    for (const [role, band] of Object.entries(ROLE_BANDS)) {
      for (const { def } of units(role, band)) {
        for (const path of [def.cta, ...itemsOf(def).map((i) => i.path)]) {
          if (!navPaths.has(path)) missing.push(`${role}: ${path}`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });

  it('every label exists in both English and Bangla', () => {
    const missing = [];
    for (const [role, band] of Object.entries(ROLE_BANDS)) {
      for (const { base, def } of units(role, band)) {
        const keys = ['kicker', 'title', 'cta'].map((k) => `${base}.${k}`);
        if (def.kind === 'leaderboard') keys.push(`${base}.empty`, `marketplace.top.band.board.count.${def.count}`);
        for (const item of itemsOf(def)) {
          keys.push(item.stat ? `marketplace.top.band.stat.${item.stat}` : `marketplace.top.band.link.${item.link}`);
        }
        for (const key of keys) {
          for (const [name, dict] of [['en', en], ['bn', bn]]) {
            if (typeof resolve(dict, key) !== 'string') missing.push(`${name}: ${key}`);
          }
        }
      }
    }
    assert.deepEqual(missing, []);
  });

  it('every figure and ranking a band shows is one the API sends for that role (the mock mirrors the live keys)', () => {
    const absent = [];
    for (const [role, band] of Object.entries(ROLE_BANDS)) {
      for (const { def } of units(role, band)) {
        for (const item of itemsOf(def).filter((i) => i.stat)) {
          if (!(item.stat in (MOCK_HOME_STATS[role] || {}))) absent.push(`${role}: ${item.stat}`);
        }
        if (def.kind === 'leaderboard' && !Array.isArray(MOCK_HOME_INSIGHTS[role]?.[def.board])) absent.push(`${role}: insights.${def.board}`);
      }
    }
    assert.deepEqual(absent, []);
  });

  it('every moderation item type a ranking can name has a label in both languages', () => {
    const types = ['PRODUCT_NEW', 'PRODUCT_EDIT', 'REVIEW', 'UGC_VIDEO', 'STOREFRONT_ASSET', 'LIVE_STREAM', 'CHAT_REPORT'];
    for (const type of types) {
      for (const dict of [en, bn]) assert.equal(typeof resolve(dict, `marketplace.top.band.board.item_type.${type}`), 'string', type);
    }
  });

  it('every slide in a role has its own colour, and no two roles open on the same one', () => {
    const openers = new Map();
    for (const role of FULL_BAND_ROLES) {
      const slides = ROLE_BANDS[role].center.slides;
      assert.ok(slides.length >= 2, `${role} has a slider`);
      const tones = slides.map((s) => s.tone);
      assert.equal(new Set(tones).size, tones.length, `${role}: ${tones}`);
      for (const tone of tones) {
        assert.ok(SLIDE_TONES.includes(tone), `${role}: unknown tone ${tone}`);
        assert.match(css, new RegExp(`\\.home-band__slide--${tone} \\{`), `home-top.css styles ${tone}`);
      }
      if (role !== 'super_admin') {
        assert.ok(!openers.has(tones[0]), `${role} opens on ${tones[0]}, like ${openers.get(tones[0])}`);
        openers.set(tones[0], role);
      }
    }
  });

  it('no two slides in a role are drawn the same way, and every view is styled', () => {
    for (const role of FULL_BAND_ROLES) {
      const looks = ROLE_BANDS[role].center.slides.map((s) => (s.kind === 'leaderboard' ? s.view : s.kind));
      assert.equal(new Set(looks).size, looks.length, `${role}: ${looks}`);
      for (const s of ROLE_BANDS[role].center.slides.filter((x) => x.kind === 'leaderboard')) {
        assert.ok(BOARD_VIEWS.includes(s.view), `${role}.${s.id}: unknown view ${s.view}`);
      }
    }
    const used = new Set(FULL_BAND_ROLES.flatMap((r) => ROLE_BANDS[r].center.slides.map((s) => s.view).filter(Boolean)));
    for (const view of used) {
      const block = { list: 'list-row', spotlight: 'spot', bars: 'bars-row', chips: 'chip', tiles: 'tilegrid', share: 'share-bar' }[view];
      assert.match(css, new RegExp(`\\.home-band__${block} \\{`), `home-top.css styles the ${view} view`);
    }
  });

  it('no ranking row is allowed to shrink below its own text (the bar once struck through "38 sold")', () => {
    // The bug: rows were `flex: 1 1 0` with a fixed floor inside the band's fixed height, so two-line text
    // was clipped and an absolutely placed bar covered it. No ranking item may combine those again.
    const rules = css.match(/\.home-band__(list-row|spot-row|bars-row|chip|tilecard|share-item)[^{]*\{[^}]*\}/g) || [];
    assert.ok(rules.length > 0);
    for (const rule of rules) assert.doesNotMatch(rule, /flex:\s*1 1 0/, rule);
  });

  it('the list reset inside a ranking can never strip a view card of its padding', () => {
    // The bug: `.home-band__board ol { padding: 0 }` (0,1,1) out-ranked `.home-band__bars { padding }` (0,1,0),
    // so the bars card, which is itself the <ol>, lost its padding and its text touched the card edge.
    assert.doesNotMatch(css, /(^|\n)\.home-band__board ol\b/, 'the reset must be wrapped in :where()');
    assert.match(css, /:where\(\.home-band__board ol\) \{[^}]*padding: 0/);
    assert.match(css, /\.home-band__bars \{[^}]*padding: var\(--space-\d\) var\(--space-\d\)/);
  });

  it('side-panel rows never shrink below their text, and only figure rows wrap', () => {
    assert.match(css, /\.home-band__row \{ flex: 1 0 auto;/);
    assert.doesNotMatch(css, /\.home-band__row \{ flex-wrap: wrap/, 'wrapping every row pushed the "›" out of shortcut rows');
    assert.match(css, /\.home-band__row--stat \{ flex-wrap: wrap;/);
  });

  it('share percentages always add up to exactly 100', () => {
    for (const values of [[14, 9, 6, 4, 2], [1, 1, 1], [7], [3, 3, 3, 1], [0, 5]]) {
      const pct = percentShares(values);
      assert.equal(pct.reduce((a, v) => a + v, 0), 100, String(values));
    }
    assert.deepEqual(percentShares([0, 0]), [0, 0]);
    assert.deepEqual(percentShares([1, 1, 1]).sort(), [33, 33, 34]);
  });

  it('super admin and admin differ only in the third review-queue figure', () => {
    const third = (role) => ROLE_BANDS[role].center.slides[0].metrics[2].stat;
    assert.equal(third('super_admin'), 'approvals_waiting');
    assert.equal(third('admin'), 'my_pending_requests');
  });

  it('a figure that is missing shows a dash, never zero; money is formatted as currency', () => {
    assert.equal(formatStat({ stat: 'x' }, undefined), '–');
    assert.equal(formatStat({ stat: 'x' }, null), '–');
    assert.notEqual(formatStat({ stat: 'x' }, 0), '–');
    assert.match(formatStat({ stat: 'x', money: true }, '4820.00'), /4,820\.00/);
  });
});
