/**
 * publicImages.test.js — every image the app points browsers, installers and link previews at exists
 * in client/public/ at the size it is declared with.
 *
 * WHY: `/og-banner.png` was named as the og:image, the twitter:image and a manifest screenshot for
 * months without ever existing, so every link shared to Facebook or WhatsApp had no picture and the
 * manifest asked for a file that answered 404. Nothing failed: a missing image is silent. This reads
 * the references out of the files that make them, so a renamed or deleted image fails here.
 *
 * Covered: manifest.json (icons, shortcut icons, screenshots), index.html's icon links,
 * services/seo.ts DEFAULT_OG_IMAGE, and the two prerender templates (server and build time).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generatePalette } from '../src/services/colorRamp.ts';
import { MASTER_PRESETS, DEFAULT_MASTER_PRESET } from '../src/config/master-themes.ts';
import { parseHexColor } from '../../scripts/logoPng.mjs';
import { layoutWordmark, OG_LAYOUT, OG_WIDTH, OG_HEIGHT } from '../../scripts/ogBanner.mjs';

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(CLIENT, '..');
const PUBLIC = join(CLIENT, 'public');
const read = (...p) => readFileSync(join(...p), 'utf8');

const manifest = JSON.parse(read(PUBLIC, 'manifest.json'));

/** Width and height from a PNG's IHDR, and a pixel reader for files written by encodePng. */
function readPng(path) {
  const buf = readFileSync(path);
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${path} is a PNG`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const pixel = () => {
    const idat = [];
    for (let off = 8; off < buf.length;) {
      const len = buf.readUInt32BE(off);
      if (buf.toString('ascii', off + 4, off + 8) === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
      off += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    return (x, y) => {
      const o = y * (width * 4 + 1) + 1 + x * 4;
      return [...raw.subarray(o, o + 4)];
    };
  };
  return { width, height, pixel };
}

/** Asserts `/path` exists under client/public and, for a PNG with a WxH size, that it is that size. */
function assertImage(src, sizes, from) {
  assert.ok(src.startsWith('/'), `${from}: ${src} is a site path`);
  const file = join(PUBLIC, src);
  assert.ok(existsSync(file), `${from} names ${src}, which is not in client/public`);
  if (!src.endsWith('.png') || !sizes || sizes === 'any') return;
  const { width, height } = readPng(file);
  assert.equal(`${width}x${height}`, sizes, `${from}: ${src} is declared ${sizes}`);
}

/** The link-preview image and its declared size, read from one prerender template. */
function ogFromTemplate(source, name) {
  const path = (prop) => new RegExp(`(?:property|name)="${prop}" content="\\$\\{[^}]+\\}(/[^"]+)"`).exec(source)?.[1];
  const num = (prop) => new RegExp(`property="${prop}" content="(\\d+)"`).exec(source)?.[1];
  const og = { image: path('og:image'), twitter: path('twitter:image'), width: num('og:image:width'), height: num('og:image:height') };
  assert.ok(og.image, `${name} has an og:image`);
  assert.equal(og.twitter, og.image, `${name}: twitter:image is the og:image`);
  assert.ok(og.width && og.height, `${name} declares og:image:width and og:image:height`);
  return og;
}

describe('manifest.json and index.html images', () => {
  test('every manifest icon, shortcut icon and screenshot exists at its declared size', () => {
    for (const icon of manifest.icons) assertImage(icon.src, icon.sizes, 'manifest icons');
    for (const s of manifest.shortcuts ?? []) {
      for (const icon of s.icons ?? []) assertImage(icon.src, icon.sizes, `manifest shortcut "${s.short_name}"`);
    }
    for (const shot of manifest.screenshots ?? []) assertImage(shot.src, shot.sizes, 'manifest screenshots');
  });

  test('index.html icon links exist at their declared size', () => {
    const html = read(CLIENT, 'index.html');
    const links = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*>/g)].map((m) => m[0]);
    assert.ok(links.length >= 2, 'index.html has a favicon and an apple-touch-icon');
    for (const link of links) {
      assertImage(/href="([^"]+)"/.exec(link)[1], /sizes="([^"]+)"/.exec(link)?.[1], 'index.html');
    }
  });

  test('no manifest screenshot is the link-preview banner', () => {
    // WHY: Chrome's install sheet shows screenshots as pictures of the app. A marketing banner there
    // tells the installer nothing about the app; real screenshots or none.
    const og = ogFromTemplate(read(ROOT, 'server', 'src', 'services', 'prerender.service.ts'), 'prerender.service.ts');
    for (const shot of manifest.screenshots ?? []) assert.notEqual(shot.src, og.image);
  });
});

describe('link-preview image (og:image)', () => {
  const server = ogFromTemplate(read(ROOT, 'server', 'src', 'services', 'prerender.service.ts'), 'prerender.service.ts');
  const build = ogFromTemplate(read(ROOT, 'scripts', 'prerender.js'), 'scripts/prerender.js');
  const seoDefault = /const DEFAULT_OG_IMAGE = `\$\{SITE_URL\}(\/[^`]+)`/.exec(read(CLIENT, 'src', 'services', 'seo.ts'))?.[1];

  test('seo.ts, the server prerender and the build prerender name the same image and size', () => {
    assert.ok(seoDefault, 'seo.ts DEFAULT_OG_IMAGE is `${SITE_URL}/…`');
    assert.equal(server.image, seoDefault);
    assert.deepEqual(build, server);
  });

  test('the image exists at the declared size, 1200×630, and is small enough for WhatsApp', () => {
    assertImage(server.image, `${server.width}x${server.height}`, 'og:image');
    assert.equal(`${server.width}x${server.height}`, `${OG_WIDTH}x${OG_HEIGHT}`, 'the 1.91:1 size Facebook and X render full width');
    // WHY 300KB: WhatsApp drops the preview picture for larger images.
    assert.ok(statSync(join(PUBLIC, server.image)).size < 300 * 1024, 'og:image under 300KB');
  });

  test('the shipped banner carries the default theme\'s colours (re-run scripts/logo.mjs after a re-seed)', () => {
    const palette = generatePalette(MASTER_PRESETS[DEFAULT_MASTER_PRESET].master);
    const px = readPng(join(PUBLIC, server.image)).pixel();
    const rgba = (hex) => [...parseHexColor(hex), 255];
    const [first, , , , accent] = layoutWordmark();
    const midStroke = (g) => [g.x + Math.floor(OG_LAYOUT.STROKE / 2), OG_LAYOUT.WORD_TOP + Math.floor(OG_LAYOUT.CAP / 2)];

    assert.deepEqual(px(0, 0), rgba(palette.neutral[900]), 'canvas is the app icon\'s dark ink');
    assert.deepEqual(px(...midStroke(first)), rgba(palette.neutral[0]), 'wordmark ink');
    assert.deepEqual(px(...midStroke(accent)), rgba(palette.brand[palette.meta.anchorStep]), 'fifth letter in the brand colour, as the top bar draws it');
    const markCentre = [OG_WIDTH / 2, OG_LAYOUT.MARK_TOP + OG_LAYOUT.MARK_SIZE / 2];
    assert.deepEqual(px(...markCentre), rgba(palette.neutral[900]), 'the mark\'s centre hole');
    const [r, , b] = px(markCentre[0], markCentre[1] - Math.round(OG_LAYOUT.MARK_SIZE / 8));
    assert.ok(r > 200 && b < 100, 'the sparkle above the hole is gold');
  });

  test('the wordmark fits the centred square WhatsApp and Messenger crop small previews to', () => {
    const glyphs = layoutWordmark();
    const left = glyphs[0].x;
    const right = glyphs.at(-1).x + glyphs.at(-1).width;
    const square = [(OG_WIDTH - OG_HEIGHT) / 2, (OG_WIDTH + OG_HEIGHT) / 2];
    assert.ok(left >= square[0] && right <= square[1], `wordmark spans ${left}–${right}, square is ${square.join('–')}`);
  });
});
