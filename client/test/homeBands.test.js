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
import { ROLE_BANDS, FULL_BAND_ROLES } from '../src/components/home/homeBands.js';
import { navItems } from '../src/config/navigation.js';
import { formatStat } from '../src/components/home/RoleBand.js';
import { MOCK_HOME_STATS } from '../src/mocks/handlers/homeSummary.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const en = JSON.parse(readFileSync(join(root, 'locales/en.json'), 'utf8'));
const bn = JSON.parse(readFileSync(join(root, 'locales/bn.json'), 'utf8'));
const resolve = (dict, key) => key.split('.').reduce((node, part) => (node == null ? node : node[part]), dict);

const POSITIONS = ['left', 'center', 'right'];
// /chat is a topbar destination (the chat icon), not a sidebar item, so it is not in navItems.
const navPaths = new Set([...navItems.map((n) => n.path), '/chat']);

function panelItems(panel) {
  return [...(panel.rows || []), ...(panel.metrics || []), ...(panel.links || [])];
}

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
      for (const panel of Object.values(band)) {
        for (const path of [panel.cta, ...panelItems(panel).map((i) => i.path)]) {
          if (!navPaths.has(path)) missing.push(`${role}: ${path}`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });

  it('every label exists in both English and Bangla', () => {
    const missing = [];
    for (const [role, band] of Object.entries(ROLE_BANDS)) {
      for (const [position, panel] of Object.entries(band)) {
        const textRole = role === 'super_admin' ? 'admin' : role;
        const keys = ['kicker', 'title', 'cta'].map((k) => `marketplace.top.band.${textRole}.${position}.${k}`);
        for (const item of panelItems(panel)) {
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

  it('every figure a band shows is one the API sends for that role (the mock mirrors the live keys)', () => {
    const absent = [];
    for (const [role, band] of Object.entries(ROLE_BANDS)) {
      for (const panel of Object.values(band)) {
        for (const item of panelItems(panel).filter((i) => i.stat)) {
          if (!(item.stat in (MOCK_HOME_STATS[role] || {}))) absent.push(`${role}: ${item.stat}`);
        }
      }
    }
    assert.deepEqual(absent, []);
  });

  it('super admin and admin differ only in the third review-queue figure', () => {
    const third = (role) => ROLE_BANDS[role].center.metrics[2].stat;
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
