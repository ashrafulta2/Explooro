/**
 * flyerEngine.test.js — invariants of the Flyer Studio design library (config/flyerTemplates.ts)
 * and its renderer (lib/flyerEngine.ts).
 *
 * The studio promises Explooro partners and suppliers thousands of ready designs. Nobody can look
 * at thousands of pictures, so what makes the promise safe is asserted here as properties:
 * every layout draws in every format without text running into other text, the QR or off the
 * canvas; every palette stays readable; the gallery numbering never repeats a design; and every
 * string the studio shows exists in both languages.
 *
 * Runs on node:test; no test-runner dependency is added to the client.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderFlyer, layoutBoxes, fillCaption, wrapText } from '../src/lib/flyerEngine.ts';
import {
  FORMATS, LAYOUTS, PALETTES, PATTERNS, OCCASIONS,
  designAt, designCount, designKey, parseDesignKey, palettesFor, paletteById,
} from '../src/config/flyerTemplates.ts';
import { contrastRatio } from '../src/services/colorRamp.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');

function content(n, { long = false, bn = false } = {}) {
  const titles = long
    ? ['Premium Cotton Panjabi for Men with Hand Embroidery Work, Navy Blue', 'Handloom Jamdani Saree with Golden Zari Border', 'Genuine Leather Ladies Shoulder Bag', 'Smart Fitness Watch with Heart Rate']
    : ['Jamdani Saree', 'Panjabi', 'Leather Wallet', 'Smart Watch'];
  const bnTitles = ['প্রিমিয়াম কটন পাঞ্জাবি হাতের কাজসহ নেভি ব্লু রঙে', 'জামদানি শাড়ি সোনালি জরি পাড়', 'চামড়ার লেডিস ব্যাগ', 'স্মার্ট ঘড়ি'];
  return {
    brand: long ? 'Priyo Collection & Fashion House Dhaka' : 'Priyo Collection',
    brandLine: bn ? 'যাচাইকৃত এক্সপ্লোরো পার্টনার' : 'Verified Explooro Partner',
    headline: bn ? 'নতুন বছর, নতুন সাজ উৎসবের আনন্দে' : (long ? 'Stay warm, stay stylish this winter season' : 'Eid Mubarak'),
    tag: bn ? 'বৈশাখী অফার' : (long ? 'Boishakhi Offer' : 'New'),
    cta: bn ? 'এখনই অর্ডার করুন' : 'Order now',
    scanLine: bn ? 'QR স্ক্যান করে অর্ডার করুন' : 'Scan the QR to shop & order',
    scanSub: bn ? 'Scan with your phone camera to order' : 'ক্যামেরা দিয়ে স্ক্যান করে অর্ডার করুন',
    items: Array.from({ length: n }, (_, i) => ({ title: bn ? bnTitles[i] : titles[i], subtitle: bn ? titles[i] : bnTitles[i], price: long ? '৳1,25,000' : '৳950', photo: null })),
    qrText: 'https://explooro.com/s/AB12CD',
    showPrice: true,
  };
}

test('the library offers thousands of designs per occasion', () => {
  for (const occ of OCCASIONS) {
    assert.ok(designCount(occ) >= 1000, `${occ.id} offers only ${designCount(occ)} designs`);
  }
  assert.ok(designCount(OCCASIONS[0]) >= 10000);
});

test('the gallery numbering never shows the same design twice', () => {
  for (const occ of OCCASIONS) {
    const seen = new Set();
    const n = designCount(occ);
    for (let i = 0; i < n; i += 1) seen.add(designKey(designAt(occ, i)));
    assert.equal(seen.size, n, `${occ.id}: ${n - seen.size} repeated designs`);
  }
});

test('neighbouring gallery cards differ in layout', () => {
  const occ = OCCASIONS[0];
  for (let i = 0; i < 48; i += 1) assert.notEqual(designAt(occ, i).layout, designAt(occ, i + 1).layout);
});

test('a design key survives a round trip, and a bad key is refused', () => {
  for (const occ of OCCASIONS) {
    const d = designAt(occ, 137);
    assert.deepEqual(parseDesignKey(designKey(d)), d);
    assert.ok(palettesFor(occ).some((p) => p.id === d.palette), `${occ.id} used a palette it does not list`);
  }
  assert.equal(parseDesignKey('eid.nope.midnight.dots.0'), null);
  assert.equal(parseDesignKey('eid.hero_card.midnight.dots.99'), null);
  assert.equal(parseDesignKey(''), null);
});

test('every palette keeps text readable on its canvas and its cards', () => {
  for (const p of PALETTES) {
    for (const [name, fg, bg, min] of [
      ['text/bg', p.text, p.bg, 4.5], ['text/surface', p.text, p.surface, 4.5],
      ['muted/bg', p.muted, p.bg, 4.5], ['muted/surface', p.muted, p.surface, 4.5],
      ['price/bg', p.price, p.bg, 3], ['price/surface', p.price, p.surface, 3],
      ['onAccent/accent', p.onAccent, p.accent, 4.5],
    ]) {
      const ratio = contrastRatio(fg, bg);
      assert.ok(ratio >= min, `${p.id} ${name} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
  }
});

test('every occasion is complete in both languages', () => {
  const ids = new Set(PALETTES.map((p) => p.id));
  for (const occ of OCCASIONS) {
    for (const id of occ.palettes) assert.ok(ids.has(id), `${occ.id} names unknown palette ${id}`);
    assert.ok(occ.headlines.length >= 5 && occ.tags.length >= 3, `${occ.id} needs 5 headlines and 3 tags`);
    for (const b of [occ.label, ...occ.headlines, ...occ.tags, occ.caption]) {
      assert.ok(b.en.trim() && b.bn.trim(), `${occ.id} has a missing translation: ${JSON.stringify(b)}`);
    }
    for (const lang of ['en', 'bn']) assert.match(occ.caption[lang], /\{link\}/, `${occ.id} ${lang} caption has no link`);
  }
});

test('the copy promises no discount nobody set', () => {
  // A partner cannot change a price, so no headline, tag or caption may name a percentage or "off".
  for (const occ of OCCASIONS) {
    for (const b of [...occ.headlines, ...occ.tags, occ.caption]) {
      assert.doesNotMatch(`${b.en} ${b.bn}`, /\d\s*%|%\s*off|\boff\b|ছাড়/i, `${occ.id}: "${b.en}"`);
    }
  }
});

test('every layout draws a complete SVG in every format and palette', () => {
  for (const format of Object.keys(FORMATS)) {
    for (const layout of LAYOUTS) {
      for (const [i, palette] of PALETTES.entries()) {
        const svg = renderFlyer({ layout, palette, pattern: PATTERNS[i % PATTERNS.length], format }, content(layout === 'collage' ? 4 : 1), { uid: 't' });
        assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${format} ${layout} ${palette.id}`);
        assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'));
        assert.match(svg, new RegExp(`viewBox="0 0 ${FORMATS[format].width} ${FORMATS[format].height}"`));
      }
    }
  }
});

test('text never runs into other text, the QR, or off the canvas', () => {
  const hit = (a, b) => a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2;
  const problems = [];
  for (const format of Object.keys(FORMATS)) {
    for (const layout of LAYOUTS) {
      for (const variant of [{}, { long: true }, { bn: true }, { long: true, bn: true }]) {
        for (const n of layout === 'collage' ? [1, 2, 3, 4] : [1]) {
          const { width, height, boxes } = layoutBoxes({ layout, palette: PALETTES[0], pattern: 'plain', format }, content(n, variant));
          const where = `${format} ${layout} ${JSON.stringify(variant)} n=${n}`;
          for (const b of boxes) {
            if (b.x < -1 || b.y < -1 || b.x + b.w > width + 1 || b.y + b.h > height + 1) problems.push(`${where}: "${b.label}" leaves the canvas`);
          }
          for (let i = 0; i < boxes.length; i += 1) {
            for (let j = i + 1; j < boxes.length; j += 1) {
              const [a, b] = [boxes[i], boxes[j]];
              // A pill's own label sits inside it by design.
              if ((a.kind === 'pill') !== (b.kind === 'pill') && a.label === b.label) continue;
              if (hit(a, b)) problems.push(`${where}: "${a.label}" overlaps "${b.label}"`);
            }
          }
        }
      }
    }
  }
  assert.deepEqual(problems.slice(0, 10), []);
});

test('the QR encodes the real link outside draft mode', () => {
  const design = { layout: 'hero_card', palette: PALETTES[0], pattern: 'plain', format: 'SQUARE' };
  const real = renderFlyer(design, content(1));
  const draft = renderFlyer(design, content(1), { draft: true });
  assert.notEqual(real, draft);
  assert.ok(real.length > draft.length, 'the real QR draws far more modules than the look-alike');
});

test('product text and photo URLs are escaped', () => {
  const c = content(1);
  c.items[0].title = '<script>alert(1)</script>';
  c.items[0].photo = 'https://x.test/a.png"/><script>';
  const svg = renderFlyer({ layout: 'full_bleed', palette: PALETTES[3], pattern: 'dots', format: 'STORY' }, c);
  assert.doesNotMatch(svg, /<script>/);
});

test('ids stay unique per uid, so many flyers can share one page', () => {
  const svg = renderFlyer({ layout: 'collage', palette: PALETTES[0], pattern: 'dots', format: 'SQUARE' }, { ...content(4), items: content(4).items.map((it) => ({ ...it, photo: 'data:image/png;base64,AA==' })) }, { uid: 'card7' });
  const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 5);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith('card7-')));
});

test('a caption drops its price phrase when there is no price', () => {
  const tpl = '{headline}! {product}[ for {price}]. Order: {link}';
  assert.equal(fillCaption(tpl, { headline: 'Hi', product: 'Saree', price: '৳950', link: 'L' }), 'Hi! Saree for ৳950. Order: L');
  assert.equal(fillCaption(tpl, { headline: 'Hi', product: 'Saree', price: '', link: 'L' }), 'Hi! Saree. Order: L');
});

test('wrapping keeps to the line limit and marks what it cut', () => {
  const lines = wrapText('one two three four five six seven eight nine ten', 200, 40, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith('…'));
});

test('every flyer.* string the studio uses exists in both locales', () => {
  const en = JSON.parse(read('src/locales/en.json'));
  const bn = JSON.parse(read('src/locales/bn.json'));
  const get = (d, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), d);
  const sources = ['src/components/flyer/FlyerStudio.ts', 'src/pages/saler/SocialKitPage.ts', 'src/pages/supplier/SupplierSocialKitPage.ts', 'src/config/flyerTemplates.ts']
    .map(read).join('\n');
  const keys = new Set([...sources.matchAll(/'((?:flyer|social_kit|nav)\.[a-z0-9_.]+)'/g)].map((m) => m[1]));
  assert.ok(keys.size > 40);
  for (const key of keys) {
    for (const [lang, dict] of [['en', en], ['bn', bn]]) {
      assert.equal(typeof get(dict, key), 'string', `${key} is missing in ${lang}.json`);
    }
  }
  assert.equal(typeof get(en, 'nav.supplier.social_kit'), 'string');
  assert.equal(typeof get(bn, 'nav.supplier.social_kit'), 'string');
});

test('the supplier studio route and its nav item use the same guard', () => {
  const main = read('src/main.ts');
  const nav = read('src/config/navigation.ts');
  const route = main.slice(main.indexOf("path: '/supplier/social-kit'"), main.indexOf("path: '/supplier/social-kit'") + 400);
  const item = nav.split('\n').find((l) => l.includes("path: '/supplier/social-kit'"));
  assert.match(route, /permission: 'catalog\.product\.manage_own'/);
  assert.match(route, /module: 'social_seller_kit'/);
  assert.match(item, /permission: 'catalog\.product\.manage_own'/);
  assert.match(item, /module: 'social_seller_kit'/);
});

test('palette lookups fall back instead of drawing nothing', () => {
  assert.equal(paletteById('no-such').id, PALETTES[0].id);
});
