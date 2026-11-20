/**
 * scripts/logoPng.mjs — paints the Explooro mark to PNG with no dependencies.
 *
 * Imported by scripts/logo.mjs (which writes the files) and by client/test/pwaIcons.test.js. This
 * module only exports functions: importing it writes nothing.
 *
 * WHY PNG at all, when the SVG icons already exist: iOS ignores an SVG apple-touch-icon and puts a
 * screenshot of the page on the home screen instead, and Android's installed-app (WebAPK) path is
 * only dependable with PNG icons at 192 and 512.
 *
 * WHY a hand-written rasterizer and not sharp: sharp is permitted only inside
 * server/src/services/media.service.ts (docs/dependency-ledger.md), and importing that file drags in
 * the storage driver and the database layer. The mark is three shapes, so painting it here is small.
 * The geometry and the gold come from client/src/services/logoMark.ts, the same numbers the SVGs
 * are built from, so the PNGs cannot drift from them.
 */

import { deflateSync, crc32 } from 'node:zlib';

import {
  LOGO_RING_LEFT,
  LOGO_RING_RIGHT,
  LOGO_RING_RADIUS,
  LOGO_RING_WIDTH,
  LOGO_LINK_Y,
  LOGO_MASKABLE_SCALE,
  LOGO_FALLBACK_COLORS,
} from '../client/src/services/logoMark.ts';

/** Samples per pixel along each axis (4 × 4 = 16), enough for smooth edges at icon sizes. */
const SAMPLES_PER_AXIS = 4;

/** '#rrggbb' or '#rgb' → [r, g, b]. Anything else (a var(--…), a url(#…)) cannot be painted here. */
export function parseHexColor(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) throw new Error(`logoPng: expected a #hex colour, got "${color}"`);
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** Is (x, y) on the stroke of a ring centred at `c`? */
function onRing(c, x, y) {
  return Math.abs(Math.hypot(x - c.cx, y - c.cy) - LOGO_RING_RADIUS) <= LOGO_RING_WIDTH / 2;
}

/**
 * The colour the mark paints at (x, y) in its own 0..100 coordinates, or null for nothing.
 * Same layering as buildLogoMarkSvg: left ring, right ring over it, then the left ring again
 * below LOGO_LINK_Y, which is what makes the two interlock.
 */
export function markColorAt(x, y, ring1, ring2) {
  const left = onRing(LOGO_RING_LEFT, x, y);
  if (left && y >= LOGO_LINK_Y) return ring1;
  if (onRing(LOGO_RING_RIGHT, x, y)) return ring2;
  return left ? ring1 : null;
}

/**
 * Paints the mark into straight-alpha RGBA bytes, size × size.
 *
 * - `maskable: false` matches buildLogoMarkSvg: the rings on transparency.
 * - `maskable: true` matches buildLogoMaskableSvg: a full square of `bg` with the mark shrunk by
 *   LOGO_MASKABLE_SCALE. Use it wherever the OS crops the icon itself (Android masks, iOS corners).
 */
export function renderLogoRgba({
  size,
  ring1 = LOGO_FALLBACK_COLORS.ring1,
  ring2 = LOGO_FALLBACK_COLORS.ring2,
  bg = LOGO_FALLBACK_COLORS.bg,
  maskable = false,
}) {
  const r1 = parseHexColor(ring1);
  const r2 = parseHexColor(ring2);
  const bgRgb = parseHexColor(bg);
  const scale = maskable ? LOGO_MASKABLE_SCALE : 1;
  const unit = 100 / size;
  const n = SAMPLES_PER_AXIS;
  const out = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const px = (x + (sx + 0.5) / n) * unit;
          const py = (y + (sy + 0.5) / n) * unit;
          // The mark's own coordinates, undoing the maskable shrink around the centre.
          const color = markColorAt(50 + (px - 50) / scale, 50 + (py - 50) / scale, r1, r2) ?? (maskable ? bgRgb : null);
          if (color) {
            r += color[0]; g += color[1]; b += color[2]; hits++;
          }
        }
      }
      const o = (y * size + x) * 4;
      if (hits) {
        out[o] = Math.round(r / hits);
        out[o + 1] = Math.round(g / hits);
        out[o + 2] = Math.round(b / hits);
        out[o + 3] = Math.round((255 * hits) / (n * n));
      }
    }
  }
  return out;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

/** Straight-alpha RGBA bytes → an 8-bit RGBA PNG file. */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderLogoPng(options) {
  return encodePng(options.size, options.size, renderLogoRgba(options));
}
