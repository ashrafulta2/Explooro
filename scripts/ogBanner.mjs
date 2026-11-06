/**
 * scripts/ogBanner.mjs — paints the 1200×630 link-preview image (`client/public/og-banner.png`) with
 * no dependencies.
 *
 * Imported by scripts/logo.mjs (which writes the file) and by client/test/publicImages.test.js. This
 * module only exports functions and constants: importing it writes nothing.
 *
 * What it draws: the sparkle mark above the wordmark "EXPLOORO", with the fifth letter in the brand
 * colour exactly as the top bar does it (formatExplooroBrandText in components/ui/icons.ts), on the
 * same dark ink as the app icon, plus four faint sparkles for texture.
 *
 * WHY the letters are drawn from strokes and not from a font: the shipped fonts are WOFF2, whose
 * glyph table is stored in a transformed form that needs a few hundred lines of decoding before a
 * single outline can be read, and sharp (which could rasterise text) is permitted only inside
 * server/src/services/media.service.ts (docs/dependency-ledger.md). The wordmark is six distinct
 * capitals made of straight strokes and circles, so it is drawn here as geometry: every stroke is a
 * signed distance, which also gives exact anti-aliasing for free. There is no tagline for the same
 * reason; a sentence (in Bangla above all) needs a real font.
 *
 * WHY the composition is centred and narrow: WhatsApp and Messenger crop the preview to a centred
 * square in their small layouts, so the mark and the whole wordmark sit inside the middle 630 px.
 */

import { renderLogoRgba, parseHexColor } from './logoPng.mjs';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** The sparkle mark, centred horizontally. */
const MARK_SIZE = 240;
const MARK_TOP = 123;
/** Cap height of the wordmark and the stroke weight its letters are drawn with. */
const CAP = 80;
const STROKE = 14;
const WORD_TOP = 425;
const TRACKING = 11;
/** Faint sparkles in the empty wings of the canvas: [centre x, centre y, size]. */
const DECOR = [
  [150, 140, 70],
  [215, 500, 44],
  [1010, 120, 40],
  [1060, 470, 90],
];
const DECOR_OPACITY = 0.14;

/**
 * The glyphs of the wordmark, in a box of `width` × CAP with y growing downward. Each part is a
 * stroke centre line: a segment [x1, y1, x2, y2] or an arc { cx, cy, r, from, to } in radians.
 * Centre lines sit STROKE/2 inside the box, so the painted letter fills it exactly.
 */
function glyph(letter) {
  const h = STROKE / 2;
  // Letter widths as a share of the cap height, so CAP alone resizes the wordmark.
  const w = (share) => Math.round(CAP * share);
  const base = CAP - h;
  // P and R share the bowl: a D shape from the cap line down to just past the middle.
  const bowl = (width) => {
    const bottom = CAP * 0.56;
    const r = (bottom - h) / 2;
    const cx = width - h - r;
    return {
      cx,
      bottom,
      parts: [
        [h, h, cx, h],
        [h, bottom, cx, bottom],
        { cx, cy: h + r, r, from: -Math.PI / 2, to: Math.PI / 2 },
      ],
    };
  };
  switch (letter) {
    case 'E':
      return { width: w(0.74), parts: [[h, h, h, base], [h, h, w(0.74) - h, h], [h, CAP / 2, w(0.67) - h, CAP / 2], [h, base, w(0.74) - h, base]] };
    case 'X':
      return { width: w(0.88), parts: [[h, h, w(0.88) - h, base], [h, base, w(0.88) - h, h]] };
    case 'P': {
      const b = bowl(w(0.76));
      return { width: w(0.76), parts: [[h, h, h, base], ...b.parts] };
    }
    case 'L':
      return { width: w(0.64), parts: [[h, h, h, base], [h, base, w(0.64) - h, base]] };
    case 'O':
      return { width: CAP, parts: [{ cx: CAP / 2, cy: CAP / 2, r: CAP / 2 - h, from: -Math.PI, to: Math.PI }] };
    case 'R': {
      const b = bowl(w(0.76));
      const legFrom = h + (b.cx - h) * 0.55;
      return { width: w(0.79), parts: [[h, h, h, base], ...b.parts, [legFrom, b.bottom, w(0.79) - h, base]] };
    }
    default:
      throw new Error(`ogBanner: no glyph for "${letter}"`);
  }
}

function segmentDistance(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function arcDistance(px, py, { cx, cy, r, from, to }) {
  const a = Math.atan2(py - cy, px - cx);
  if (a >= from && a <= to) return Math.abs(Math.hypot(px - cx, py - cy) - r);
  return Math.min(
    Math.hypot(px - (cx + r * Math.cos(from)), py - (cy + r * Math.sin(from))),
    Math.hypot(px - (cx + r * Math.cos(to)), py - (cy + r * Math.sin(to))),
  );
}

/** Lays out "EXPLOORO" centred on the canvas: [{ x, width, parts, accent }]. */
export function layoutWordmark(text = 'EXPLOORO') {
  const glyphs = [...text].map((letter, i) => ({ ...glyph(letter), accent: i === 4 }));
  const total = glyphs.reduce((sum, g) => sum + g.width, 0) + TRACKING * (glyphs.length - 1);
  let x = Math.round((OG_WIDTH - total) / 2);
  return glyphs.map((g) => {
    const placed = { ...g, x };
    x += g.width + TRACKING;
    return placed;
  });
}

/** Source-over of a straight-alpha colour onto an opaque RGBA canvas. */
function blend(out, i, rgb, alpha) {
  if (alpha <= 0) return;
  for (let c = 0; c < 3; c++) out[i + c] = Math.round(out[i + c] + (rgb[c] - out[i + c]) * alpha);
}

function stampMark(out, { left, top, size, bg, hole, opacity }) {
  const mark = renderLogoRgba({ size, bg, hole });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = left + x;
      const cy = top + y;
      if (cx < 0 || cy < 0 || cx >= OG_WIDTH || cy >= OG_HEIGHT) continue;
      const m = (y * size + x) * 4;
      blend(out, (cy * OG_WIDTH + cx) * 4, [mark[m], mark[m + 1], mark[m + 2]], (mark[m + 3] / 255) * opacity);
    }
  }
}

/**
 * Paints the banner into opaque RGBA bytes, OG_WIDTH × OG_HEIGHT.
 *
 * - `bg`: the canvas, and the mark's badge and hole (the same dark ink as the app icon).
 * - `text`: the wordmark.
 * - `accent`: the wordmark's fifth letter, the brand colour the top bar paints it with.
 */
export function renderOgBannerRgba({ bg, text, accent }) {
  const bgRgb = parseHexColor(bg);
  const textRgb = parseHexColor(text);
  const accentRgb = parseHexColor(accent);
  const out = new Uint8Array(OG_WIDTH * OG_HEIGHT * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = bgRgb[0];
    out[i + 1] = bgRgb[1];
    out[i + 2] = bgRgb[2];
    out[i + 3] = 255;
  }

  for (const [cx, cy, size] of DECOR) {
    stampMark(out, { left: Math.round(cx - size / 2), top: Math.round(cy - size / 2), size, bg, hole: bg, opacity: DECOR_OPACITY });
  }
  stampMark(out, { left: Math.round((OG_WIDTH - MARK_SIZE) / 2), top: MARK_TOP, size: MARK_SIZE, bg, hole: bg, opacity: 1 });

  const half = STROKE / 2;
  for (const g of layoutWordmark()) {
    const rgb = g.accent ? accentRgb : textRgb;
    for (let y = WORD_TOP - 1; y <= WORD_TOP + CAP + 1; y++) {
      for (let x = g.x - 1; x <= g.x + g.width + 1; x++) {
        // Distance from the pixel centre to the letter's edge; < 0 is inside.
        const px = x + 0.5 - g.x;
        const py = y + 0.5 - WORD_TOP;
        let d = Infinity;
        for (const part of g.parts) {
          d = Math.min(d, Array.isArray(part) ? segmentDistance(px, py, part) : arcDistance(px, py, part));
        }
        blend(out, (y * OG_WIDTH + x) * 4, rgb, Math.max(0, Math.min(1, half - d + 0.5)));
      }
    }
  }
  return out;
}

/** Where the wordmark and the mark sit, for the test to sample. */
export const OG_LAYOUT = { MARK_SIZE, MARK_TOP, CAP, STROKE, WORD_TOP };
