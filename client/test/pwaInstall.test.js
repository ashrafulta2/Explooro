/**
 * pwaInstall.test.js — the PWA can be installed on Android and on iPhone.
 *
 * Guards three things that broke silently before:
 * 1. Every icon was SVG. iOS ignores an SVG apple-touch-icon (the home screen showed a page
 *    screenshot), and Android's installed-app path wants PNG at 192 and 512.
 * 2. The install banner waited for `beforeinstallprompt`, which Safari never fires, so iPhone
 *    users were never told how to install.
 * 3. The PNGs are painted by scripts/logoPng.mjs from logoMark.ts; this checks they still match the
 *    SVGs scripts/logo.mjs writes in the same run, so a re-theme that skips one of them fails here.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { needsIosInstallHint } from '../src/components/pwa/PwaInstallPrompt.ts';
import { renderLogoRgba, parseHexColor, flattenPath } from '../../scripts/logoPng.mjs';
import en from '../src/locales/en.json' with { type: 'json' };
import bn from '../src/locales/bn.json' with { type: 'json' };

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(CLIENT, 'public');
const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.json'), 'utf8'));

/** Reads a PNG written by encodePng (8-bit RGBA, filter 0 on every row). */
function decodePng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  let off = 8;
  let width = 0, height = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'bit depth');
      assert.equal(data[9], 6, 'colour type RGBA');
    }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = (x, y) => {
    const o = y * (width * 4 + 1) + 1 + x * 4;
    return [...raw.subarray(o, o + 4)];
  };
  return { width, height, px };
}

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1';
const IPHONE_FACEBOOK = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.38.107;FBBV/1;FBDV/iPhone15,2]';
const IPHONE_INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 355.0.0.0.0';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

describe('iPhone install hint', () => {
  const hint = (userAgent, maxTouchPoints = 5, standalone = false) =>
    needsIosInstallHint({ userAgent, maxTouchPoints, standalone });

  test('shows on iPhone Safari, iPhone Chrome and an iPad that reports itself as a Mac', () => {
    assert.equal(hint(IPHONE_SAFARI), true);
    assert.equal(hint(IPHONE_CHROME), true);
    assert.equal(hint(IPAD_AS_MAC, 5), true);
  });

  test('never shows on a real Mac, on Android (it gets the install button), or once installed', () => {
    assert.equal(hint(IPAD_AS_MAC, 0), false, 'a Mac without a touch screen is a Mac');
    assert.equal(hint(ANDROID_CHROME), false);
    assert.equal(hint(IPHONE_SAFARI, 5, true), false, 'already running as an installed app');
  });

  test('never shows inside Facebook or Instagram, whose share menu cannot add to the Home Screen', () => {
    assert.equal(hint(IPHONE_FACEBOOK), false);
    assert.equal(hint(IPHONE_INSTAGRAM), false);
  });

  test('every banner string exists in both locales', () => {
    for (const key of ['dismiss', 'install.title', 'install.body', 'install.action', 'ios.title', 'ios.body']) {
      const get = (dict) => key.split('.').reduce((o, k) => o?.[k], dict.pwa);
      assert.equal(typeof get(en), 'string', `en pwa.${key}`);
      assert.equal(typeof get(bn), 'string', `bn pwa.${key}`);
      assert.notEqual(get(en), get(bn), `pwa.${key} is not translated`);
    }
  });
});

describe('PNG app icons', () => {
  test('the manifest offers PNG icons at 192 and 512, plus a maskable PNG, and each file has that size', () => {
    const png = manifest.icons.filter((i) => i.type === 'image/png');
    for (const [sizes, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
      const icon = png.find((i) => i.sizes === sizes && i.purpose === purpose);
      assert.ok(icon, `manifest needs a ${purpose} PNG at ${sizes}`);
      const { width, height } = decodePng(readFileSync(join(PUBLIC, icon.src)));
      assert.equal(`${width}x${height}`, sizes, `${icon.src} is really ${sizes}`);
    }
    for (const s of manifest.shortcuts) {
      for (const i of s.icons) assert.ok(existsSync(join(PUBLIC, i.src)), `shortcut icon ${i.src}`);
    }
  });

  test('index.html points iOS at a 180×180 PNG with no transparent corners', () => {
    const html = readFileSync(join(CLIENT, 'index.html'), 'utf8');
    const href = /<link rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(html)?.[1];
    assert.ok(href?.endsWith('.png'), `apple-touch-icon must be a PNG, got ${href}`);
    const { width, height, px } = decodePng(readFileSync(join(PUBLIC, href)));
    assert.equal(`${width}x${height}`, '180x180');
    // iOS fills transparency with black, so the corner must already be the badge colour.
    assert.equal(px(0, 0)[3], 255, 'corner is opaque');
  });

  test('every path the service worker pre-caches exists, so its install step cannot fail', () => {
    const sw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');
    const list = /const PRECACHE_ASSETS = \[([\s\S]*?)\];/.exec(sw)[1];
    for (const path of [...list.matchAll(/'([^']+)'/g)].map((m) => m[1])) {
      if (path === '/') continue;
      assert.ok(existsSync(join(PUBLIC, path)) || path === '/index.html', `sw.js pre-caches ${path}, which is missing`);
    }
  });

  test('the PNGs carry the same colours as the SVGs written in the same run', () => {
    const svg = readFileSync(join(PUBLIC, 'icons', 'icon-192.svg'), 'utf8');
    // logoMark.ts draws the badge circle first and the centre hole last.
    const [bg, hole] = [...svg.matchAll(/<circle[^>]*fill="(#[0-9a-f]+)"/gi)].map((m) => parseHexColor(m[1]));
    assert.ok(bg && hole, 'icon-192.svg has a badge circle and a hole circle');
    const { px } = decodePng(readFileSync(join(PUBLIC, 'icons', 'icon-192.png')));
    assert.deepEqual(px(96, 96), [...hole, 255], 'centre hole');
    // (48, 48) is (25, 25) in the 0..100 viewBox: inside the badge, between two sparkle points.
    assert.deepEqual(px(48, 48), [...bg, 255], 'badge between the sparkle points');
    assert.equal(px(0, 0)[3], 0, 'outside the round badge is transparent');
  });
});

describe('logoPng rasterizer', () => {
  test('paints the round badge on transparency and the maskable one full-bleed', () => {
    const colours = { bg: '#102030', hole: '#405060' };
    const size = 40;
    const round = renderLogoRgba({ size, ...colours });
    const square = renderLogoRgba({ size, maskable: true, ...colours });
    const at = (rgba, x, y) => [...rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
    assert.equal(at(round, 0, 0)[3], 0);
    assert.deepEqual(at(square, 0, 0), [16, 32, 48, 255]);
    assert.deepEqual(at(round, 20, 20), [64, 80, 96, 255], 'centre hole');
    const gold = at(round, 20, 8); // on the upper sparkle point
    assert.ok(gold[0] > 200 && gold[2] < 120, `upper point is gold, got ${gold}`);
  });

  test('refuses a path command it cannot paint instead of drawing the wrong shape', () => {
    assert.throws(() => flattenPath('M0,0 Q10,10 20,0 Z'), /not supported/);
    assert.throws(() => parseHexColor('var(--brand-900)'), /#hex/);
  });
});
