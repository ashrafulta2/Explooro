/**
 * scripts/ogBanner.mjs — paints the 1200×630 link-preview image (`client/public/og-banner.png`) with
 * no dependencies.
 *
 * Imported by scripts/logo.mjs (which writes the file) and by client/test/publicImages.test.js. This
 * module only exports functions and constants: importing it writes nothing.
 *
 * What it draws: the linked-rings mark above the wordmark "explooro", its "oo" in the two ring
 * colours exactly as the top bar does it (formatExplooroBrandText in components/ui/icons.ts), on the
 * theme's dark ink, plus four faint copies of the mark for texture.
 *
 * WHY the letters are drawn from strokes and not from a font: the shipped fonts are WOFF2, whose
 * glyph table is stored in a transformed form that needs a few hundred lines of decoding before a
 * single outline can be read, and sharp (which could rasterise text) is permitted only inside
 * server/src/services/media.service.ts (docs/dependency-ledger.md). The wordmark is six distinct
 * lowercase letters of a geometric face (Poppins 700: circles and straight stems), so it is drawn
 * here as geometry: every stroke is a signed distance, which also gives exact anti-aliasing for
 * free. There is no tagline for the same
 * reason; a sentence (in Bangla above all) needs a real font.
 *
 * WHY the composition is centred and narrow: WhatsApp and Messenger crop the preview to a centred
 * square in their small layouts, so the mark and the whole wordmark sit inside the middle 630 px.
 */

import { renderLogoRgba, parseHexColor } from './logoPng.mjs';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** The linked-rings mark, centred horizontally. */
const MARK_SIZE = 240;
const MARK_TOP = 123;
/**
 * The wordmark's vertical metrics, top of the "l" at WORD_TOP: x-height, the ascender above it,
 * the descender of the "p" below the baseline, and the stroke weight (Poppins 700 is about a
 * quarter of the x-height).
 */
const X_HEIGHT = 64;
const ASCENDER = 92;
const DESCENDER = 28;
const STROKE = 17;
const WORD_TOP = 405;
const TRACKING = 7;
/** Faint copies of the mark in the empty wings of the canvas: [centre x, centre y, size]. */
const DECOR = [
  [150, 140, 70],
  [215, 500, 44],
  [1010, 120, 40],
  [1060, 470, 90],
];
const DECOR_OPACITY = 0.14;

/**
 * The glyphs of the wordmark, in a box of `width` × (ASCENDER + DESCENDER) with y growing downward
 * from the ascender line. Each part is a stroke centre line: a segment [x1, y1, x2, y2] or an arc
 * { cx, cy, r, from, to } in radians (0 points right, π/2 down). Centre lines sit STROKE/2 inside
 * the box, so the painted letter fills it exactly. `probe` is a point on a centre line, where a
 * test can read the letter's colour.
 */
function glyph(letter) {
  const h = STROKE / 2;
  const top = ASCENDER - X_HEIGHT; // the x-height line
  const base = ASCENDER; // the baseline
  const cy = top + X_HEIGHT / 2;
  const r = X_HEIGHT / 2 - h; // the bowl shared by o, e and p
  const PI = Math.PI;
  switch (letter) {
    case 'o':
      return { width: X_HEIGHT, probe: [h, cy], parts: [{ cx: X_HEIGHT / 2, cy, r, from: -PI, to: PI }] };
    case 'e':
      // The bowl, open at the lower right, with the bar across its middle.
      return {
        width: X_HEIGHT,
        probe: [h, cy],
        parts: [
          { cx: X_HEIGHT / 2, cy, r, from: -PI, to: 0 },
          { cx: X_HEIGHT / 2, cy, r, from: PI / 4, to: PI },
          [h, cy, X_HEIGHT - h, cy],
        ],
      };
    case 'x': {
      const w = Math.round(X_HEIGHT * 0.86);
      return { width: w, probe: [w / 2, cy], parts: [[h, top + h, w - h, base - h], [h, base - h, w - h, top + h]] };
    }
    case 'p':
      return {
        width: X_HEIGHT,
        probe: [h, cy],
        parts: [[h, top + h, h, base + DESCENDER - h], { cx: X_HEIGHT / 2, cy, r, from: -PI, to: PI }],
      };
    case 'l':
      return { width: STROKE, probe: [h, cy], parts: [[h, h, h, base - h]] };
    case 'r': {
      const rr = X_HEIGHT * 0.34;
      const w = Math.round(h + rr + X_HEIGHT * 0.16 + h);
      return {
        width: w,
        probe: [h, cy],
        parts: [[h, top + h, h, base - h], { cx: h + rr, cy: top + h + rr, r: rr, from: -PI, to: -PI / 2 }, [h + rr, top + h, w - h, top + h]],
      };
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

/**
 * Lays out "explooro" centred on the canvas: [{ x, width, parts, probe, ring }]. `ring` is 1 or 2
 * for the two letters of the "oo", which take the ring colours, and 0 for the rest.
 */
export function layoutWordmark(text = 'explooro') {
  const glyphs = [...text].map((letter, i) => ({ ...glyph(letter), ring: i === 4 ? 1 : i === 5 ? 2 : 0 }));
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

function stampMark(out, { left, top, size, ring1, ring2, opacity }) {
  const mark = renderLogoRgba({ size, ring1, ring2 });
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
 * - `bg`: the canvas, the theme's darkest working neutral.
 * - `ring1`, `ring2`: the mark's two rings, the colours the top bar paints them with.
 *   The wordmark's "oo" takes the same two colours.
 * - `text`: the rest of the wordmark.
 */
export function renderOgBannerRgba({ bg, text, ring1, ring2 }) {
  const bgRgb = parseHexColor(bg);
  const textRgb = parseHexColor(text);
  const ringRgb = [textRgb, parseHexColor(ring1), parseHexColor(ring2)];
  const out = new Uint8Array(OG_WIDTH * OG_HEIGHT * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = bgRgb[0];
    out[i + 1] = bgRgb[1];
    out[i + 2] = bgRgb[2];
    out[i + 3] = 255;
  }

  for (const [cx, cy, size] of DECOR) {
    stampMark(out, { left: Math.round(cx - size / 2), top: Math.round(cy - size / 2), size, ring1, ring2, opacity: DECOR_OPACITY });
  }
  stampMark(out, { left: Math.round((OG_WIDTH - MARK_SIZE) / 2), top: MARK_TOP, size: MARK_SIZE, ring1, ring2, opacity: 1 });

  const half = STROKE / 2;
  for (const g of layoutWordmark()) {
    const rgb = ringRgb[g.ring];
    for (let y = WORD_TOP - 1; y <= WORD_TOP + ASCENDER + DESCENDER + 1; y++) {
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
export const OG_LAYOUT = { MARK_SIZE, MARK_TOP, X_HEIGHT, ASCENDER, DESCENDER, STROKE, WORD_TOP };
