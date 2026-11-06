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
  LOGO_SPARKLE_PATH,
  LOGO_BADGE_RADIUS,
  LOGO_HOLE_RADIUS,
  LOGO_MASKABLE_SCALE,
  LOGO_GOLD_STOPS,
} from '../client/src/services/logoMark.ts';

/** Samples per pixel along each axis (4 × 4 = 16), enough for smooth edges at icon sizes. */
const SAMPLES_PER_AXIS = 4;
/** Straight segments each cubic curve is cut into. */
const CURVE_STEPS = 32;

/** '#rrggbb' or '#rgb' → [r, g, b]. Anything else (a var(--…), a url(#…)) cannot be painted here. */
export function parseHexColor(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) throw new Error(`logoPng: expected a #hex colour, got "${color}"`);
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/**
 * Turns an SVG path of absolute M / C / Z commands into a polygon. Throws on any other command, so
 * a future change to LOGO_SPARKLE_PATH fails loudly here instead of painting the wrong shape.
 */
export function flattenPath(d, steps = CURVE_STEPS) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const points = [];
  let i = 0;
  let cmd = null;
  let cx = 0;
  let cy = 0;
  const num = () => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error('logoPng: path ended early');
    return v;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === 'M') {
      cx = num(); cy = num();
      points.push([cx, cy]);
    } else if (cmd === 'C') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        points.push([
          u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
          u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
        ]);
      }
      cx = x; cy = y;
    } else if (cmd === 'Z') {
      // the polygon test below always closes the shape
    } else {
      throw new Error(`logoPng: path command "${cmd}" is not supported (only absolute M, C, Z)`);
    }
  }
  return points;
}

function insidePolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The gold at position t (0..1) along the gradient, interpolated in sRGB as SVG does by default. */
export function goldAt(t) {
  const stops = LOGO_GOLD_STOPS.map((s) => ({ offset: s.offset, rgb: parseHexColor(s.color) }));
  if (t <= stops[0].offset) return stops[0].rgb;
  for (let k = 1; k < stops.length; k++) {
    const a = stops[k - 1];
    const b = stops[k];
    if (t <= b.offset) {
      const f = (t - a.offset) / (b.offset - a.offset);
      return a.rgb.map((v, c) => v + (b.rgb[c] - v) * f);
    }
  }
  return stops[stops.length - 1].rgb;
}

/**
 * Paints the mark into straight-alpha RGBA bytes, size × size.
 *
 * - `maskable: false` matches buildLogoMarkSvg: a round badge on transparency.
 * - `maskable: true` matches buildLogoMaskableSvg: a full square of `bg` with the mark shrunk by
 *   LOGO_MASKABLE_SCALE. Use it wherever the OS crops the icon itself (Android masks, iOS corners).
 */
export function renderLogoRgba({ size, bg, hole, maskable = false }) {
  const bgRgb = parseHexColor(bg);
  const holeRgb = parseHexColor(hole);
  const star = flattenPath(LOGO_SPARKLE_PATH);
  const xs = star.map((p) => p[0]);
  const ys = star.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
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
          let color = null;
          if (maskable || (px - 50) ** 2 + (py - 50) ** 2 <= LOGO_BADGE_RADIUS ** 2) color = bgRgb;
          // The mark's own coordinates, undoing the maskable shrink around the centre.
          const qx = 50 + (px - 50) / scale;
          const qy = 50 + (py - 50) / scale;
          if (qx >= minX && qx <= maxX && qy >= minY && qy <= maxY && insidePolygon(star, qx, qy)) {
            // x1=0% y1=0% → x2=100% y2=100% of the sparkle's bounding box
            color = goldAt(((qx - minX) / (maxX - minX) + (qy - minY) / (maxY - minY)) / 2);
          }
          if ((qx - 50) ** 2 + (qy - 50) ** 2 <= LOGO_HOLE_RADIUS ** 2) color = holeRgb;
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
