/**
 * flyerEngine.ts — draws one flyer as an SVG string from a design (layout + palette + pattern) and
 * the content (product, price, photo, QR link). Pure: no DOM, no fetch, no i18n — the studio hands
 * in already-translated text, which is also what lets node:test render every design.
 *
 * Used by components/flyer/FlyerStudio.ts for the gallery thumbnails, the big preview and the
 * PNG/SVG/print exports, so what a person picks is exactly what they download.
 *
 * Every layout works in every format. Portrait formats (square, story, A4) are built from a
 * vertical stack of blocks whose one flexible block (the photo) takes the leftover height, so a
 * layout written once fits 1:1, 9:16 and A4 alike. The landscape banner (1200×630) has too little
 * height for a stack, so each layout also says how it arranges itself in columns.
 */

import { escapeHtml } from '../services/html.ts';
import { qrSvgGroup } from './qr.ts';
import { FORMATS, type FormatId, type LayoutId, type Palette, type PatternId } from '../config/flyerTemplates.ts';

export interface FlyerItem {
  title: string;
  subtitle?: string;
  /** Already formatted, e.g. "৳1,250". Empty = no price shown. */
  price?: string;
  /** A data: URI (exports) or a URL (on-screen previews), or null for the drawn placeholder. */
  photo?: string | null;
}

export interface FlyerContent {
  brand: string;
  brandLine: string;
  headline: string;
  tag: string;
  cta: string;
  scanLine: string;
  scanSub: string;
  /** The first item is the hero; the collage uses up to four. */
  items: FlyerItem[];
  qrText: string;
  showPrice: boolean;
}

export interface FlyerDesign {
  layout: LayoutId;
  palette: Palette;
  pattern: PatternId;
  format: FormatId;
}

export interface RenderOptions {
  /** Prefix for clipPath/pattern ids — several SVGs share one document in the gallery. */
  uid?: string;
  /** Thumbnail mode: a QR look-alike instead of encoding the real link (fast, never scanned). */
  draft?: boolean;
}

// WHY a stack and not the page font: a downloaded SVG/PNG is opened outside the app, so it can only
// use fonts installed on the viewer's device. Noto Sans Bengali / Nirmala UI cover Bangla on
// Android and Windows.
export const FONT_STACK = "'Segoe UI', 'Noto Sans Bengali', 'Nirmala UI', Roboto, system-ui, sans-serif";

const esc = (s: string) => escapeHtml(String(s ?? ''));
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Splits `text` into at most `maxLines` lines of roughly `maxWidth` px, ellipsising the last one. */
export function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  // WHY an estimate: SVG text cannot wrap and there is no layout engine when the file is downloaded.
  // 0.56em is a slightly generous average glyph width for both Latin and Bangla at bold weight
  // (Bangla vowel signs count as characters but take little width, which errs on the safe side).
  const perLine = Math.max(4, Math.floor(maxWidth / (fontSize * 0.56)));
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= perLine) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word.length > perLine ? `${word.slice(0, perLine - 1)}…` : word;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.length >= perLine ? last.slice(0, perLine - 1) : last}…`;
  }
  return lines;
}

/** Rough rendered width of one line — for sizing pills and stickers to their text. */
export function textWidth(text: string, fontSize: number): number {
  return Array.from(String(text || '')).length * fontSize * 0.6;
}

/** A font size at which `text` fits `maxWidth` on one line, never above `max` nor below `min`. */
function fitSize(text: string, maxWidth: number, max: number, min: number): number {
  const w = textWidth(text, 1);
  return Math.max(min, Math.min(max, w ? maxWidth / w : max));
}

type Anchor = 'start' | 'middle' | 'end';

interface TextOpts { fill: string; weight?: number; anchor?: Anchor; lh?: number; family?: string; style?: string }

/** A laid-out box, recorded only while layoutBoxes() runs (the overlap test reads them). */
export interface LayoutBox { kind: 'text' | 'qr' | 'pill'; x: number; y: number; w: number; h: number; label: string }
let probe: LayoutBox[] | null = null;
function record(kind: LayoutBox['kind'], x: number, y: number, w: number, h: number, label: string) {
  if (probe) probe.push({ kind, x, y, w, h, label });
}

/** Lines of text whose block TOP is `y`. */
function textBlock(lines: string[], x: number, y: number, size: number, o: TextOpts): string {
  const lh = o.lh ?? 1.2;
  if (probe) {
    lines.forEach((line, i) => {
      const w = textWidth(line, size) * (o.family ? 1 : 0.92);
      const left = o.anchor === 'middle' ? x - w / 2 : o.anchor === 'end' ? x - w : x;
      record('text', left, y + size * 0.92 + i * size * lh - size * 0.78, w, size * 0.98, line);
    });
  }
  return lines.map((line, i) => `<text x="${r1(x)}" y="${r1(y + size * 0.92 + i * size * lh)}" font-size="${r1(size)}" font-weight="${o.weight ?? 400}" fill="${o.fill}" text-anchor="${o.anchor ?? 'start'}"${o.family ? ` font-family="${o.family}"` : ''}${o.style ? ` font-style="${o.style}"` : ''}>${esc(line)}</text>`).join('');
}
const blockH = (lines: string[], size: number, lh = 1.2) => (lines.length ? lines.length * size * lh : 0);

/** One drawing session: holds the canvas size, the palette and the id prefix. */
class Ctx {
  W: number; H: number; c: Palette; uid: string; draft: boolean; content: FlyerContent;
  k: number; pad: number; land: boolean; tall: boolean; defs: string[] = []; n = 0;
  constructor(design: FlyerDesign, content: FlyerContent, opts: RenderOptions) {
    const f = FORMATS[design.format];
    this.W = f.width;
    this.H = f.height;
    this.c = design.palette;
    this.uid = (opts.uid || 'f').replace(/[^a-zA-Z0-9_-]/g, '');
    this.draft = !!opts.draft;
    this.content = content;
    this.land = this.W / this.H > 1.4;
    this.tall = this.H / this.W > 1.6;
    // One unit: 1 at 1080px wide; the banner scales from its height so its text is not tiny.
    this.k = this.land ? this.H / 640 : this.W / 1080;
    this.pad = Math.round(56 * this.k);
  }
  id(name: string) { this.n += 1; return `${this.uid}-${name}${this.n}`; }
  get item(): FlyerItem { return this.content.items[0] || { title: '' }; }
  get price(): string { return this.content.showPrice ? (this.item.price || '') : ''; }
}

// ── Building blocks ─────────────────────────────────────────────────────────────────────────────

/** A placeholder shopping bag, drawn — emoji render differently on every device and in canvas. */
function bagIcon(cx: number, cy: number, size: number, color: string): string {
  const w = size;
  const h = size * 0.9;
  const x = cx - w / 2;
  const y = cy - h / 2 + size * 0.08;
  return `<g fill="none" stroke="${color}" stroke-width="${r1(size * 0.07)}" stroke-linejoin="round" stroke-linecap="round" opacity="0.85">
    <path d="M${r1(x)} ${r1(y + h * 0.22)} h${r1(w)} l${r1(-w * 0.06)} ${r1(h * 0.78)} h${r1(-w * 0.88)} z"/>
    <path d="M${r1(cx - w * 0.22)} ${r1(y + h * 0.32)} v${r1(-h * 0.2)} a${r1(w * 0.22)} ${r1(w * 0.22)} 0 0 1 ${r1(w * 0.44)} 0 v${r1(h * 0.2)}"/>
  </g>`;
}

type Shape = 'rect' | 'circle' | 'arch';

function shapePath(shape: Shape, x: number, y: number, w: number, h: number, r: number): string {
  if (shape === 'circle') {
    const rad = Math.min(w, h) / 2;
    return `<circle cx="${r1(x + w / 2)}" cy="${r1(y + h / 2)}" r="${r1(rad)}"/>`;
  }
  if (shape === 'arch') {
    const rad = Math.min(w / 2, h / 2);
    return `<path d="M${r1(x)} ${r1(y + h)} V${r1(y + rad)} A${r1(rad)} ${r1(rad)} 0 0 1 ${r1(x + w)} ${r1(y + rad)} V${r1(y + h)} Z"/>`;
  }
  return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(r)}"/>`;
}

/** A product photo clipped to a shape, or the tinted placeholder with a drawn bag. */
function photo(ctx: Ctx, item: FlyerItem, x: number, y: number, w: number, h: number, shape: Shape = 'rect', r = 24 * ctx.k, tint = ctx.c.accent): string {
  if (w <= 0 || h <= 0) return '';
  let bx = x; let by = y; let bw = w; let bh = h;
  if (shape === 'circle') {
    const d = Math.min(w, h);
    bx = x + (w - d) / 2; by = y + (h - d) / 2; bw = d; bh = d;
  }
  const base = shapePath(shape, bx, by, bw, bh, r).replace('/>', ` fill="${tint}" fill-opacity="0.16"/>`);
  if (!item.photo) return base + bagIcon(bx + bw / 2, by + bh / 2, Math.min(bw, bh) * 0.36, tint);
  const clip = ctx.id('clip');
  ctx.defs.push(`<clipPath id="${clip}">${shapePath(shape, bx, by, bw, bh, r)}</clipPath>`);
  return `${base}<image href="${esc(item.photo)}" x="${r1(bx)}" y="${r1(by)}" width="${r1(bw)}" height="${r1(bh)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>`;
}

/** The QR on a white tile (a QR needs a light quiet zone whatever the palette). */
function qr(ctx: Ctx, x: number, y: number, size: number): string {
  record('qr', x, y, size, size, 'QR');
  const tile = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(size)}" height="${r1(size)}" rx="${r1(size * 0.06)}" fill="#ffffff"/>`;
  const inner = size * 0.84;
  const ix = x + (size - inner) / 2;
  const iy = y + (size - inner) / 2;
  if (ctx.draft || !ctx.content.qrText) {
    // Three finder squares and a dot field: reads as "a QR goes here" at thumbnail size.
    const m = inner / 7;
    const finder = (fx: number, fy: number) => `<rect x="${r1(fx)}" y="${r1(fy)}" width="${r1(m * 2)}" height="${r1(m * 2)}" fill="none" stroke="#0f172a" stroke-width="${r1(m * 0.45)}"/><rect x="${r1(fx + m * 0.65)}" y="${r1(fy + m * 0.65)}" width="${r1(m * 0.7)}" height="${r1(m * 0.7)}" fill="#0f172a"/>`;
    const dots = [[3.2, 1], [4.6, 2.2], [3, 3.4], [5.4, 4.6], [3.8, 5.6], [1.2, 3.6], [5.6, 3.2], [2.2, 4.9]]
      .map(([dx, dy]) => `<rect x="${r1(ix + dx * m)}" y="${r1(iy + dy * m)}" width="${r1(m * 0.7)}" height="${r1(m * 0.7)}" fill="#0f172a"/>`).join('');
    return tile + finder(ix + m * 0.2, iy + m * 0.2) + finder(ix + inner - m * 2.2, iy + m * 0.2) + finder(ix + m * 0.2, iy + inner - m * 2.2) + dots;
  }
  return tile + (qrSvgGroup(ctx.content.qrText, ix, iy, inner) || '');
}

/** A rounded pill with centred text; returns its markup and width. */
function pill(text: string, x: number, y: number, size: number, fill: string, color: string, anchor: Anchor = 'start', stroke?: string): { svg: string; w: number; h: number } {
  const h = size * 1.9;
  const w = textWidth(text, size) + size * 1.6;
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  record('pill', left, y, w, h, text);
  const svg = `<rect x="${r1(left)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(h / 2)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${r1(size * 0.12)}"` : ''}/>`
    + `<text x="${r1(left + w / 2)}" y="${r1(y + h / 2 + size * 0.35)}" font-size="${r1(size)}" font-weight="700" text-anchor="middle" fill="${color}">${esc(text)}</text>`;
  return { svg, w, h };
}

/** Store badge: initial in a circle, store name, the "verified" line. Height = 76k. */
function brandRow(ctx: Ctx, x: number, y: number, w: number, color = ctx.c.text, mutedColor = ctx.c.muted): string {
  const k = ctx.k;
  const brand = ctx.content.brand;
  const initial = Array.from(brand.trim())[0] || 'E';
  const r = 30 * k;
  const nameLines = wrapText(brand, w - r * 2 - 20 * k, 30 * k, 1);
  return `<circle cx="${r1(x + r)}" cy="${r1(y + 38 * k)}" r="${r1(r)}" fill="${ctx.c.accent}"/>`
    + `<text x="${r1(x + r)}" y="${r1(y + 38 * k + 11 * k)}" font-size="${r1(30 * k)}" font-weight="700" text-anchor="middle" fill="${ctx.c.onAccent}">${esc(initial)}</text>`
    + textBlock(nameLines, x + r * 2 + 18 * k, y + 4 * k, 30 * k, { fill: color, weight: 700 })
    + textBlock(wrapText(ctx.content.brandLine, w - r * 2 - 20 * k, 19 * k, 1), x + r * 2 + 18 * k, y + 42 * k, 19 * k, { fill: mutedColor });
}
const BRAND_H = 76;

/** QR + "scan to order" copy beside it, centred vertically in the band. */
function scanBand(ctx: Ctx, x: number, y: number, w: number, h: number, opts: { fill?: string | null; text?: string; muted?: string } = {}): string {
  const k = ctx.k;
  const inset = Math.min(20 * k, h * 0.1);
  const size = h - inset * 2;
  let svg = opts.fill === null ? '' : `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(24 * k)}" fill="${opts.fill || ctx.c.surface}"/>`;
  svg += qr(ctx, x + inset, y + inset, size);
  const tx = x + inset + size + 30 * k;
  const tw = x + w - inset - tx;
  if (tw < 80 * k) return svg;
  const scanSize = Math.min(38 * k, h * 0.17);
  const lines = wrapText(ctx.content.scanLine, tw, scanSize, 2);
  const subSize = scanSize * 0.66;
  const subLines = wrapText(ctx.content.scanSub, tw, subSize, 2);
  const short = ctx.content.qrText.replace(/^https?:\/\//, '');
  const shortLines = short && h > 150 * k ? wrapText(short, tw, subSize * 0.92, 1) : [];
  const total = blockH(lines, scanSize) + subSize * 0.3 + blockH(subLines, subSize) + (shortLines.length ? subSize * 1.3 : 0);
  let ty = y + (h - total) / 2;
  svg += textBlock(lines, tx, ty, scanSize, { fill: opts.text || ctx.c.text, weight: 700 });
  ty += blockH(lines, scanSize) + subSize * 0.3;
  svg += textBlock(subLines, tx, ty, subSize, { fill: opts.muted || ctx.c.muted, weight: 600 });
  ty += blockH(subLines, subSize) + subSize * 0.15;
  if (shortLines.length) svg += textBlock(shortLines, tx, ty, subSize * 0.92, { fill: opts.muted || ctx.c.muted, family: 'ui-monospace, Consolas, monospace' });
  return svg;
}

/** Title (2 lines), subtitle (1 line) and price, top at `y`. Returns markup and used height. */
function info(ctx: Ctx, x: number, y: number, w: number, size: number, anchor: Anchor = 'start', colors: { text?: string; muted?: string; price?: string } = {}): { svg: string; h: number } {
  const item = ctx.item;
  const tx = anchor === 'middle' ? x + w / 2 : anchor === 'end' ? x + w : x;
  const titleLines = wrapText(item.title, w, size, 2);
  const subSize = size * 0.62;
  const subLines = item.subtitle ? wrapText(item.subtitle, w, subSize, 1) : [];
  const priceSize = size * 1.45;
  let svg = textBlock(titleLines, tx, y, size, { fill: colors.text || ctx.c.text, weight: 700, anchor });
  let h = blockH(titleLines, size);
  if (subLines.length) {
    svg += textBlock(subLines, tx, y + h + size * 0.15, subSize, { fill: colors.muted || ctx.c.muted, anchor });
    h += subSize * 1.35;
  }
  if (ctx.price) {
    svg += textBlock([ctx.price], tx, y + h + size * 0.2, priceSize, { fill: colors.price || ctx.c.price, weight: 800, anchor });
    h += priceSize * 1.25;
  }
  return { svg, h };
}
function infoHeight(ctx: Ctx, w: number, size: number): number {
  const titleLines = wrapText(ctx.item.title, w, size, 2);
  return blockH(titleLines, size) + (ctx.item.subtitle ? size * 0.62 * 1.35 : 0) + (ctx.price ? size * 1.45 * 1.25 : 0);
}

/** A star-burst sticker with up to two short lines of text. */
function burst(ctx: Ctx, cx: number, cy: number, r: number, text: string, fill = ctx.c.accent, color = ctx.c.onAccent): string {
  const pts: string[] = [];
  const spikes = 16;
  for (let i = 0; i < spikes * 2; i += 1) {
    const rad = i % 2 === 0 ? r : r * 0.84;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    pts.push(`${r1(cx + rad * Math.cos(a))},${r1(cy + rad * Math.sin(a))}`);
  }
  const size = fitSize(text, r * 1.35, r * 0.42, r * 0.18);
  const lines = wrapText(text, r * 1.4, size, 2);
  const h = blockH(lines, size, 1.1);
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>` + textBlock(lines, cx, cy - h / 2, size, { fill: color, weight: 800, anchor: 'middle', lh: 1.1 });
}

/** A rounded call-to-action button. */
function ctaButton(ctx: Ctx, cx: number, y: number, size: number): { svg: string; h: number } {
  const p = pill(`${ctx.content.cta} →`, cx, y, size, ctx.c.accent, ctx.c.onAccent, 'middle');
  return { svg: p.svg, h: p.h };
}

// ── Background patterns ────────────────────────────────────────────────────────────────────────

/** A deterministic 0..1 sequence, so a design looks the same every time it is drawn. */
function seeded(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function patternLayer(ctx: Ctx, pattern: PatternId, seed: number): string {
  const { W, H, k } = ctx;
  const color = ctx.c.deco;
  const op = 0.13;
  switch (pattern) {
    case 'dots': {
      const id = ctx.id('dots');
      const s = 36 * k;
      ctx.defs.push(`<pattern id="${id}" width="${r1(s)}" height="${r1(s)}" patternUnits="userSpaceOnUse"><circle cx="${r1(s / 2)}" cy="${r1(s / 2)}" r="${r1(3.5 * k)}" fill="${color}"/></pattern>`);
      return `<rect width="${W}" height="${H}" fill="url(#${id})" opacity="${op + 0.05}"/>`;
    }
    case 'stripes': {
      const id = ctx.id('stripes');
      const s = 44 * k;
      ctx.defs.push(`<pattern id="${id}" width="${r1(s)}" height="${r1(s)}" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="${r1(s / 3)}" height="${r1(s)}" fill="${color}"/></pattern>`);
      return `<rect width="${W}" height="${H}" fill="url(#${id})" opacity="${op * 0.7}"/>`;
    }
    case 'rings': {
      const rings = (cx: number, cy: number) => [1, 2, 3, 4, 5].map((i) => `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(i * 70 * k)}" fill="none" stroke="${color}" stroke-width="${r1(10 * k)}"/>`).join('');
      return `<g opacity="${op}">${rings(W, 0)}${rings(0, H)}</g>`;
    }
    case 'confetti': {
      const rnd = seeded(seed * 97 + 13);
      let s = '';
      const count = Math.round((W * H) / (90000));
      for (let i = 0; i < count; i += 1) {
        const x = rnd() * W; const y = rnd() * H; const sz = (8 + rnd() * 14) * k;
        s += rnd() > 0.5
          ? `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(sz / 2)}"/>`
          : `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(sz)}" height="${r1(sz * 0.45)}" transform="rotate(${Math.round(rnd() * 180)} ${r1(x)} ${r1(y)})"/>`;
      }
      return `<g fill="${color}" opacity="${op + 0.1}">${s}</g>`;
    }
    case 'alpana': {
      // An eight-petal rosette, the motif of Bengali alpana floor art, in two corners.
      const rosette = (cx: number, cy: number, rr: number) => {
        let p = `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(rr * 0.18)}"/>`;
        for (let i = 0; i < 8; i += 1) {
          p += `<ellipse cx="${r1(cx)}" cy="${r1(cy - rr * 0.55)}" rx="${r1(rr * 0.16)}" ry="${r1(rr * 0.36)}" transform="rotate(${i * 45} ${r1(cx)} ${r1(cy)})"/>`;
        }
        return p + `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(rr)}" fill="none" stroke="${color}" stroke-width="${r1(6 * k)}"/>`;
      };
      return `<g fill="${color}" opacity="${op + 0.03}">${rosette(W - 40 * k, 40 * k, 190 * k)}${rosette(40 * k, H - 40 * k, 190 * k)}</g>`;
    }
    case 'waves': {
      let s = '';
      for (let i = 0; i < 4; i += 1) {
        const y = H - (60 + i * 46) * k;
        const amp = 18 * k;
        const len = 180 * k;
        let d = `M0 ${r1(y)}`;
        for (let x = 0; x < W + len; x += len) d += ` q${r1(len / 4)} ${r1(-amp)} ${r1(len / 2)} 0 t${r1(len / 2)} 0`;
        s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${r1(8 * k)}"/>`;
      }
      return `<g opacity="${op}">${s}</g>`;
    }
    case 'shapes': {
      const rnd = seeded(seed * 31 + 7);
      let s = '';
      for (let i = 0; i < 6; i += 1) {
        const x = rnd() * W; const y = rnd() * H; const sz = (60 + rnd() * 110) * k;
        const kind = i % 3;
        s += kind === 0
          ? `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(sz / 2)}" fill="none" stroke="${color}" stroke-width="${r1(14 * k)}"/>`
          : kind === 1
            ? `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(sz)}" height="${r1(sz)}" rx="${r1(sz * 0.18)}" transform="rotate(${Math.round(rnd() * 90)} ${r1(x)} ${r1(y)})" fill="${color}"/>`
            : `<polygon points="${r1(x)},${r1(y - sz / 2)} ${r1(x + sz / 2)},${r1(y + sz / 2)} ${r1(x - sz / 2)},${r1(y + sz / 2)}" fill="none" stroke="${color}" stroke-width="${r1(14 * k)}"/>`;
      }
      return `<g opacity="${op}">${s}</g>`;
    }
    default:
      return '';
  }
}

// ── Portrait stack ─────────────────────────────────────────────────────────────────────────────

interface Block { h: number | 'flex'; gap?: number; draw: (x: number, y: number, w: number, h: number) => string }

/** Stacks blocks top to bottom; the 'flex' block (usually the photo) takes the leftover height. */
function vstack(x: number, y: number, w: number, h: number, blocks: Block[], gap: number): string {
  const fixed = blocks.reduce((s, b) => s + (b.h === 'flex' ? 0 : b.h), 0) + gap * (blocks.length - 1);
  const flex = Math.max(0, h - fixed);
  let cy = y;
  let out = '';
  for (const b of blocks) {
    const bh = b.h === 'flex' ? flex : b.h;
    out += b.draw(x, cy, w, bh);
    cy += bh + gap;
  }
  return out;
}

// ── Layouts ────────────────────────────────────────────────────────────────────────────────────

type LayoutFn = (ctx: Ctx) => string;

const headlineSize = (ctx: Ctx, scale = 1) => (ctx.tall ? 78 : 64) * ctx.k * scale;
const footerH = (ctx: Ctx) => (ctx.tall ? 290 : 220) * ctx.k;

/** Banner helper: photo column left, copy middle, QR column right. */
function bannerColumns(ctx: Ctx, opts: { shape?: Shape; photoFill?: boolean; headlineColor?: string } = {}): string {
  const { W, H, pad, k } = ctx;
  const qrSize = 230 * k;
  const photoW = opts.photoFill ? W * 0.4 : Math.min(H - pad * 2, W * 0.29);
  const px = opts.photoFill ? 0 : pad;
  const py = opts.photoFill ? 0 : pad;
  const ph = opts.photoFill ? H : H - pad * 2;
  let s = photo(ctx, ctx.item, px, py, photoW, ph, opts.shape || 'rect', opts.photoFill ? 0 : 28 * k);
  const tx = px + photoW + 44 * k;
  const qx = W - pad - qrSize;
  const tw = qx - 40 * k - tx;
  let y = pad;
  s += brandRow(ctx, tx, y, tw);
  y += (BRAND_H + 22) * k;
  const hs = 46 * k;
  const hl = wrapText(ctx.content.headline, tw, hs, 2);
  s += textBlock(hl, tx, y, hs, { fill: opts.headlineColor || ctx.c.text, weight: 800 });
  y += blockH(hl, hs) + 14 * k;
  s += info(ctx, tx, y, tw, 34 * k).svg;
  const tag = pill(ctx.content.tag, qx + qrSize / 2, pad, 24 * k, ctx.c.accent, ctx.c.onAccent, 'middle');
  s += tag.svg;
  s += qr(ctx, qx, pad + tag.h + 20 * k, qrSize);
  s += textBlock(wrapText(ctx.content.scanSub, qrSize, 19 * k, 2), qx + qrSize / 2, pad + tag.h + 34 * k + qrSize, 19 * k, { fill: ctx.c.text, weight: 700, anchor: 'middle' });
  return s;
}

const LAYOUT_FNS: Record<LayoutId, LayoutFn> = {
  /** Store header card, photo card with the product copy, QR footer. */
  hero_card(ctx) {
    if (ctx.land) return bannerColumns(ctx);
    const { W, H, pad, k } = ctx;
    const iw = W - pad * 2 - 80 * k;
    const size = (ctx.tall ? 58 : 48) * k;
    return vstack(pad, pad, W - pad * 2, H - pad * 2, [
      { h: 110 * k, draw: (x, y, w, h) => {
        const tag = pill(ctx.content.tag, x + w - 24 * k, y + (h - 24 * k * 1.9) / 2, 24 * k, ctx.c.accent, ctx.c.onAccent, 'end');
        return `<rect x="${x}" y="${r1(y)}" width="${w}" height="${r1(h)}" rx="${r1(20 * k)}" fill="${ctx.c.surface}"/>` + brandRow(ctx, x + 24 * k, y + 17 * k, w - tag.w - 70 * k) + tag.svg;
      } },
      { h: 'flex', draw: (x, y, w, h) => {
        const ih = infoHeight(ctx, iw, size);
        const hl = textBlock(wrapText(ctx.content.headline, iw, 30 * k, 1), x + 40 * k, y + 34 * k, 30 * k, { fill: ctx.c.muted, weight: 700 });
        const photoTop = y + 90 * k;
        const ph = h - ih - 160 * k;
        return `<rect x="${x}" y="${r1(y)}" width="${w}" height="${r1(h)}" rx="${r1(28 * k)}" fill="${ctx.c.surface}"/>` + hl
          + photo(ctx, ctx.item, x + 40 * k, photoTop, w - 80 * k, ph)
          + info(ctx, x + 40 * k, photoTop + ph + 30 * k, iw, size).svg;
      } },
      { h: footerH(ctx), draw: (x, y, w, h) => scanBand(ctx, x, y, w, h) },
    ], 28 * k);
  },

  /** The photo covers the whole canvas; a solid panel at the bottom carries the copy. */
  full_bleed(ctx) {
    const { W, H, pad, k } = ctx;
    if (ctx.land) {
      let s = photo(ctx, ctx.item, W * 0.5, 0, W * 0.5, H, 'rect', 0);
      s += `<rect x="0" y="0" width="${r1(W * 0.5)}" height="${H}" fill="${ctx.c.bg}"/>`;
      const tw = W * 0.5 - pad * 2;
      let y = pad;
      s += pill(ctx.content.tag, pad, y, 24 * k, ctx.c.accent, ctx.c.onAccent).svg;
      y += 66 * k;
      const hl = wrapText(ctx.content.headline, tw, 50 * k, 2);
      s += textBlock(hl, pad, y, 50 * k, { fill: ctx.c.text, weight: 800 });
      y += blockH(hl, 50 * k) + 10 * k;
      s += info(ctx, pad, y, tw, 30 * k).svg;
      s += scanBand(ctx, W * 0.5 + pad, H - pad - 170 * k, W * 0.5 - pad * 2, 170 * k);
      return s;
    }
    const fh = footerH(ctx);
    const size = (ctx.tall ? 60 : 50) * k;
    const iw = W - pad * 2 - fh;
    const ih = infoHeight(ctx, iw, size);
    const hs = headlineSize(ctx, 0.85);
    const hl = wrapText(ctx.content.headline, iw, hs, 2);
    const panelH = Math.max(fh, blockH(hl, hs) + ih + 30 * k) + pad * 1.4;
    const py = H - panelH;
    let s = photo(ctx, ctx.item, 0, 0, W, py + 40 * k, 'rect', 0);
    s += `<rect x="0" y="${r1(py)}" width="${W}" height="${r1(panelH)}" rx="${r1(40 * k)}" fill="${ctx.c.bg}"/>`;
    s += pill(ctx.content.tag, pad, pad, 28 * k, ctx.c.accent, ctx.c.onAccent).svg;
    const brandW = Math.min(W * 0.5, textWidth(ctx.content.brand, 30 * k) + 110 * k);
    s += `<rect x="${r1(W - pad - brandW)}" y="${pad}" width="${r1(brandW)}" height="${r1(96 * k)}" rx="${r1(48 * k)}" fill="${ctx.c.bg}" opacity="0.94"/>`;
    s += brandRow(ctx, W - pad - brandW + 18 * k, pad + 10 * k, brandW - 40 * k);
    let y = py + pad * 0.8;
    s += textBlock(hl, pad, y, hs, { fill: ctx.c.text, weight: 800 });
    y += blockH(hl, hs) + 10 * k;
    s += info(ctx, pad, y, iw, size * 0.8).svg;
    const qs = fh - 40 * k;
    s += qr(ctx, W - pad - qs, py + pad * 0.8, qs);
    s += textBlock(wrapText(ctx.content.scanSub, qs + 60 * k, 20 * k, 2), W - pad - qs / 2, py + pad * 0.8 + qs + 12 * k, 20 * k, { fill: ctx.c.text, weight: 700, anchor: 'middle' });
    return s;
  },

  /** Photo on one half, copy on a solid block on the other; the tag sticker sits on the seam. */
  split(ctx) {
    const { W, H, pad, k } = ctx;
    if (ctx.land) {
      let s = photo(ctx, ctx.item, 0, 0, W * 0.44, H, 'rect', 0);
      s += `<rect x="${r1(W * 0.44)}" y="0" width="${r1(W * 0.56)}" height="${H}" fill="${ctx.c.surface}"/>`;
      s += burst(ctx, W * 0.44, H * 0.26, 74 * k, ctx.content.tag);
      const x = W * 0.44 + 100 * k;
      const tw = W - pad - x;
      let y = pad;
      s += brandRow(ctx, x, y, tw);
      y += (BRAND_H + 16) * k;
      const hl = wrapText(ctx.content.headline, tw, 42 * k, 2);
      s += textBlock(hl, x, y, 42 * k, { fill: ctx.c.text, weight: 800 });
      y += blockH(hl, 42 * k) + 10 * k;
      s += info(ctx, x, y, tw * 0.6, 30 * k).svg;
      s += scanBand(ctx, x + tw * 0.6, H - pad - 210 * k, tw * 0.4, 210 * k, { fill: null });
      return s;
    }
    const top = H * (ctx.tall ? 0.5 : 0.42);
    let s = photo(ctx, ctx.item, 0, 0, W, top, 'rect', 0);
    s += `<rect x="0" y="${r1(top)}" width="${W}" height="${r1(H - top)}" fill="${ctx.c.surface}"/>`;
    // The store badge rides on the photo, so the lower half keeps its height for the copy.
    const brandW = Math.min(W * 0.6, textWidth(ctx.content.brand, 30 * k) + 110 * k);
    s += `<rect x="${pad}" y="${pad}" width="${r1(brandW)}" height="${r1(96 * k)}" rx="${r1(48 * k)}" fill="${ctx.c.surface}" opacity="0.94"/>`;
    s += brandRow(ctx, pad + 18 * k, pad + 10 * k, brandW - 40 * k);
    s += burst(ctx, W - pad - 110 * k, top, 120 * k, ctx.content.tag);
    const fh = footerH(ctx) * (ctx.tall ? 1 : 0.9);
    return s + vstack(pad, top + 40 * k, W - pad * 2 - 200 * k, H - top - 40 * k - pad, [
      { h: 'flex', draw: (x, y, w, h) => {
        // WHY a fit: the copy shares half the canvas with the QR band; long titles shrink rather than spill.
        const fitted = (scale: number) => {
          const hs = headlineSize(ctx, 0.9 * scale);
          const size = (ctx.tall ? 52 : 42) * k * scale;
          const hl = wrapText(ctx.content.headline, w, hs, 2);
          return { hs, size, hl, used: blockH(hl, hs) + 12 * k + infoHeight(ctx, w, size) };
        };
        let f = fitted(1);
        if (f.used > h) f = fitted(Math.max(0.6, h / f.used));
        const oy = y + Math.max(0, (h - f.used) / 2);
        return textBlock(f.hl, x, oy, f.hs, { fill: ctx.c.text, weight: 800 }) + info(ctx, x, oy + blockH(f.hl, f.hs) + 12 * k, w, f.size).svg;
      } },
      { h: fh, draw: (x, y, w, h) => scanBand(ctx, x, y, W - pad * 2, h, { fill: ctx.c.bg }) },
    ], 16 * k);
  },

  /** A big round photo in an accent ring, a price sticker on its edge, copy centred. */
  spotlight(ctx) {
    const { W, H, pad, k } = ctx;
    if (ctx.land) return bannerColumns(ctx, { shape: 'circle' });
    const fh = footerH(ctx);
    const size = (ctx.tall ? 54 : 44) * k;
    return vstack(pad, pad, W - pad * 2, H - pad * 2, [
      { h: BRAND_H * k, draw: (x, y, w) => brandRow(ctx, x, y, w) },
      { h: 'flex', draw: (x, y, w, h) => {
        const hs = headlineSize(ctx);
        const hl = wrapText(ctx.content.headline, w, hs, 2);
        const titleLines = wrapText(ctx.item.title, w, size, 2);
        const textH = blockH(hl, hs) + blockH(titleLines, size) + 50 * k;
        const d = Math.min(w * 0.82, h - textH);
        let s = textBlock(hl, x + w / 2, y, hs, { fill: ctx.c.text, weight: 800, anchor: 'middle' });
        const cy = y + blockH(hl, hs) + 20 * k;
        const cx = x + (w - d) / 2;
        s += `<circle cx="${r1(x + w / 2)}" cy="${r1(cy + d / 2)}" r="${r1(d / 2 + 14 * k)}" fill="none" stroke="${ctx.c.accent}" stroke-width="${r1(10 * k)}"/>`;
        s += photo(ctx, ctx.item, cx, cy, d, d, 'circle');
        const stickerR = Math.max(70 * k, d * 0.18);
        s += burst(ctx, x + w / 2 + d * 0.36, cy + d * 0.82, stickerR, ctx.price || ctx.content.tag);
        s += textBlock(titleLines, x + w / 2, cy + d + 30 * k, size, { fill: ctx.c.text, weight: 700, anchor: 'middle' });
        return s;
      } },
      { h: fh, draw: (x, y, w, h) => scanBand(ctx, x, y, w, h) },
    ], 24 * k);
  },

  /** A tag strip across the top, the photo, and a big price star-burst over its corner. */
  price_burst(ctx) {
    const { W, H, pad, k } = ctx;
    if (ctx.land) {
      let s = `<rect x="0" y="0" width="${W}" height="${r1(84 * k)}" fill="${ctx.c.accent}"/>`;
      s += textBlock([ctx.content.tag.toUpperCase()], W / 2, 18 * k, 40 * k, { fill: ctx.c.onAccent, weight: 900, anchor: 'middle' });
      const ph = H - 84 * k - pad * 2;
      s += photo(ctx, ctx.item, pad, 84 * k + pad, ph, ph);
      s += burst(ctx, pad + ph, 84 * k + pad + 40 * k, 80 * k, ctx.price || ctx.content.tag);
      const x = pad + ph + 110 * k;
      const qs = ph - 50 * k;
      const tw = W - pad - qs - 40 * k - x;
      let y = 84 * k + pad;
      const hl = wrapText(ctx.content.headline, tw, 44 * k, 2);
      s += textBlock(hl, x, y, 44 * k, { fill: ctx.c.text, weight: 800 });
      y += blockH(hl, 44 * k) + 10 * k;
      s += textBlock(wrapText(ctx.item.title, tw, 30 * k, 2), x, y, 30 * k, { fill: ctx.c.muted, weight: 600 });
      s += textBlock(wrapText(ctx.content.brand, tw, 24 * k, 1), x, H - pad - 30 * k, 24 * k, { fill: ctx.c.text, weight: 700 });
      s += qr(ctx, W - pad - qs, 84 * k + pad, qs);
      s += textBlock(wrapText(ctx.content.scanSub, qs, 17 * k, 1), W - pad - qs / 2, 84 * k + pad + qs + 8 * k, 17 * k, { fill: ctx.c.text, weight: 700, anchor: 'middle' });
      return s;
    }
    const strip = (ctx.tall ? 150 : 120) * k;
    let s = `<rect x="0" y="0" width="${W}" height="${r1(strip)}" fill="${ctx.c.accent}"/>`;
    const tagText = ctx.content.tag.toUpperCase();
    s += textBlock([tagText], W / 2, (strip - fitSize(tagText, W - pad * 2, 70 * k, 30 * k)) / 2 - 6 * k, fitSize(tagText, W - pad * 2, 70 * k, 30 * k), { fill: ctx.c.onAccent, weight: 900, anchor: 'middle' });
    const fh = footerH(ctx);
    const size = (ctx.tall ? 54 : 44) * k;
    return s + vstack(pad, strip + 30 * k, W - pad * 2, H - strip - 30 * k - pad, [
      { h: 'flex', draw: (x, y, w, h) => photo(ctx, ctx.item, x, y, w, h) + burst(ctx, x + w - 120 * k, y + h - 90 * k, 140 * k, ctx.price || ctx.content.headline) },
      { h: blockH(wrapText(ctx.content.headline, W - pad * 2, headlineSize(ctx, 0.85), 2), headlineSize(ctx, 0.85)) + blockH(wrapText(ctx.item.title, W - pad * 2, size * 0.75, 2), size * 0.75) + 14 * k,
        draw: (x, y, w) => {
          const hs = headlineSize(ctx, 0.85);
          const hl = wrapText(ctx.content.headline, w, hs, 2);
          return textBlock(hl, x, y, hs, { fill: ctx.c.text, weight: 800 })
            + textBlock(wrapText(ctx.item.title, w, size * 0.75, 2), x, y + blockH(hl, hs) + 14 * k, size * 0.75, { fill: ctx.c.muted, weight: 600 });
        } },
      { h: fh, draw: (x, y, w, h) => scanBand(ctx, x, y, w, h) },
    ], 26 * k);
  },

  /** A tilted white instant-photo print with tape, the title written on it. */
  polaroid(ctx) {
    const { W, H, pad, k } = ctx;
    const ink = '#1e293b';
    const card = (x: number, y: number, w: number, h: number, angle: number) => {
      const border = w * 0.06;
      const cap = Math.max(70 * k, h * 0.16);
      const titleSize = Math.min(40 * k, cap * 0.45);
      const g = `<g transform="rotate(${angle} ${r1(x + w / 2)} ${r1(y + h / 2)})">`
        + `<rect x="${r1(x + 8 * k)}" y="${r1(y + 12 * k)}" width="${r1(w)}" height="${r1(h)}" fill="#000000" opacity="0.18"/>`
        + `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="#ffffff"/>`
        + photo(ctx, ctx.item, x + border, y + border, w - border * 2, h - border - cap, 'rect', 0)
        + textBlock(wrapText(ctx.item.title, w - border * 2, titleSize, 1), x + w / 2, y + h - cap + (cap - titleSize) / 2 - 4 * k, titleSize, { fill: ink, weight: 700, anchor: 'middle', style: 'italic' })
        + `<rect x="${r1(x + w / 2 - 70 * k)}" y="${r1(y - 22 * k)}" width="${r1(140 * k)}" height="${r1(44 * k)}" fill="${ctx.c.accent}" opacity="0.75" transform="rotate(-4 ${r1(x + w / 2)} ${r1(y)})"/>`
        + '</g>';
      return g;
    };
    if (ctx.land) {
      const h = H - pad * 2;
      let s = card(pad + 10 * k, pad + 10 * k, h * 0.86, h - 20 * k, -4);
      const x = pad + h * 0.86 + 70 * k;
      const qs = 220 * k;
      const tw = W - pad - qs - 30 * k - x;
      let y = pad;
      s += brandRow(ctx, x, y, tw);
      y += (BRAND_H + 20) * k;
      const hl = wrapText(ctx.content.headline, tw, 46 * k, 2);
      s += textBlock(hl, x, y, 46 * k, { fill: ctx.c.text, weight: 800 });
      y += blockH(hl, 46 * k) + 20 * k;
      if (ctx.price) s += pill(ctx.price, x, y, 40 * k, ctx.c.accent, ctx.c.onAccent).svg;
      s += pill(ctx.content.tag, W - pad, pad, 22 * k, ctx.c.surface, ctx.c.text, 'end').svg;
      s += qr(ctx, W - pad - qs, H - pad - qs - 34 * k, qs);
      s += textBlock(wrapText(ctx.content.scanSub, qs, 18 * k, 1), W - pad - qs / 2, H - pad - 26 * k, 18 * k, { fill: ctx.c.text, weight: 700, anchor: 'middle' });
      return s;
    }
    const fh = footerH(ctx);
    return vstack(pad, pad, W - pad * 2, H - pad * 2, [
      { h: Math.max(BRAND_H * k, 60 * k), draw: (x, y, w) => brandRow(ctx, x, y, w * 0.6) + pill(ctx.content.tag, x + w, y + 8 * k, 26 * k, ctx.c.accent, ctx.c.onAccent, 'end').svg },
      { h: blockH(wrapText(ctx.content.headline, W - pad * 2, headlineSize(ctx), 2), headlineSize(ctx)), draw: (x, y, w) => textBlock(wrapText(ctx.content.headline, w, headlineSize(ctx), 2), x + w / 2, y, headlineSize(ctx), { fill: ctx.c.text, weight: 800, anchor: 'middle' }) },
      { h: 'flex', draw: (x, y, w, h) => {
        const cw = Math.min(w * 0.78, h * 0.86);
        const ch = Math.min(h - 30 * k, cw * 1.2);
        let s = card(x + (w - cw) / 2, y + 26 * k, cw, ch, -3);
        if (ctx.price) s += burst(ctx, x + (w + cw) / 2 - 10 * k, y + 26 * k + ch * 0.78, Math.max(80 * k, cw * 0.16), ctx.price);
        return s;
      } },
      { h: fh, draw: (x, y, w, h) => scanBand(ctx, x, y, w, h) },
    ], 26 * k);
  },

  /** Editorial: an oversized headline, a thin rule, the photo, then title/price beside the QR. */
  magazine(ctx) {
    const { W, H, pad, k } = ctx;
    if (ctx.land) {
      let s = photo(ctx, ctx.item, W * 0.58, pad, W * 0.42 - pad, H - pad * 2, 'rect', 6 * k);
      const tw = W * 0.58 - pad - 40 * k;
      s += textBlock([ctx.content.brand.toUpperCase()], pad, pad, 22 * k, { fill: ctx.c.muted, weight: 700 });
      s += `<rect x="${pad}" y="${r1(pad + 36 * k)}" width="${r1(tw)}" height="${r1(3 * k)}" fill="${ctx.c.text}"/>`;
      const hs = fitSize(ctx.content.headline, tw * 1.6, 70 * k, 40 * k);
      const hl = wrapText(ctx.content.headline, tw, hs, 2);
      s += textBlock(hl, pad, pad + 56 * k, hs, { fill: ctx.c.text, weight: 900, lh: 1.05 });
      const y = pad + 56 * k + blockH(hl, hs, 1.05) + 16 * k;
      s += info(ctx, pad, y, tw - 180 * k, 28 * k).svg;
      s += qr(ctx, pad + tw - 160 * k, H - pad - 160 * k, 160 * k);
      return s;
    }
    const fh = footerH(ctx);
    const hs = fitSize(ctx.content.headline, (W - pad * 2) * 1.8, (ctx.tall ? 120 : 100) * k, 56 * k);
    const hl = wrapText(ctx.content.headline, W - pad * 2, hs, 3);
    return vstack(pad, pad, W - pad * 2, H - pad * 2, [
      { h: 40 * k, draw: (x, y, w) => textBlock([ctx.content.brand.toUpperCase()], x, y, 26 * k, { fill: ctx.c.muted, weight: 700 })
        + textBlock([ctx.content.tag.toUpperCase()], x + w, y, 26 * k, { fill: ctx.c.price, weight: 800, anchor: 'end' })
        + `<rect x="${x}" y="${r1(y + 38 * k)}" width="${w}" height="${r1(3 * k)}" fill="${ctx.c.text}"/>` },
      { h: blockH(hl, hs, 1.02), draw: (x, y) => textBlock(hl, x, y, hs, { fill: ctx.c.text, weight: 900, lh: 1.02 }) },
      { h: 'flex', draw: (x, y, w, h) => photo(ctx, ctx.item, x, y, w, h, 'rect', 6 * k) },
      { h: fh, draw: (x, y, w, h) => {
        const qs = h - 10 * k;
        return info(ctx, x, y + 6 * k, w - qs - 40 * k, (ctx.tall ? 46 : 38) * k).svg
          + qr(ctx, x + w - qs, y + 5 * k, qs);
      } },
    ], 22 * k);
  },

  /** A coupon ticket: perforated edge, a big tag, the photo, and the QR on the tear-off stub. */
  ticket(ctx) {
    const { W, H, pad, k } = ctx;
    const notch = 34 * k;
    if (ctx.land) {
      const x = pad; const y = pad; const w = W - pad * 2; const h = H - pad * 2;
      const stubX = x + w - 300 * k;
      let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r1(28 * k)}" fill="${ctx.c.surface}"/>`;
      s += `<circle cx="${r1(stubX)}" cy="${y}" r="${r1(notch)}" fill="${ctx.c.bg}"/><circle cx="${r1(stubX)}" cy="${y + h}" r="${r1(notch)}" fill="${ctx.c.bg}"/>`;
      s += `<line x1="${r1(stubX)}" y1="${r1(y + notch + 10 * k)}" x2="${r1(stubX)}" y2="${r1(y + h - notch - 10 * k)}" stroke="${ctx.c.muted}" stroke-width="${r1(4 * k)}" stroke-dasharray="${r1(14 * k)} ${r1(12 * k)}"/>`;
      const ph = h - 60 * k;
      s += photo(ctx, ctx.item, x + 30 * k, y + 30 * k, ph, ph);
      const tx = x + 60 * k + ph;
      const tw = stubX - 30 * k - tx;
      const ts = fitSize(ctx.content.tag.toUpperCase(), tw, 60 * k, 30 * k);
      s += textBlock([ctx.content.tag.toUpperCase()], tx, y + 30 * k, ts, { fill: ctx.c.price, weight: 900 });
      s += textBlock(wrapText(ctx.content.headline, tw, 30 * k, 2), tx, y + 40 * k + ts * 1.2, 30 * k, { fill: ctx.c.text, weight: 700 });
      s += info(ctx, tx, y + h - 30 * k - infoHeight(ctx, tw, 28 * k), tw, 28 * k).svg;
      const qs = 220 * k;
      s += qr(ctx, stubX + (x + w - stubX - qs) / 2, y + 40 * k, qs);
      s += textBlock(wrapText(ctx.content.scanSub, 240 * k, 18 * k, 2), stubX + (x + w - stubX) / 2, y + 60 * k + qs, 18 * k, { fill: ctx.c.text, weight: 700, anchor: 'middle' });
      return s;
    }
    const x = pad; const y = pad; const w = W - pad * 2; const h = H - pad * 2;
    const fh = footerH(ctx);
    const stubY = y + h - fh - 30 * k;
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r1(32 * k)}" fill="${ctx.c.surface}"/>`;
    s += `<circle cx="${x}" cy="${r1(stubY)}" r="${r1(notch)}" fill="${ctx.c.bg}"/><circle cx="${x + w}" cy="${r1(stubY)}" r="${r1(notch)}" fill="${ctx.c.bg}"/>`;
    s += `<line x1="${r1(x + notch + 14 * k)}" y1="${r1(stubY)}" x2="${r1(x + w - notch - 14 * k)}" y2="${r1(stubY)}" stroke="${ctx.c.muted}" stroke-width="${r1(4 * k)}" stroke-dasharray="${r1(16 * k)} ${r1(14 * k)}"/>`;
    const inner = 44 * k;
    const tagText = ctx.content.tag.toUpperCase();
    const ts = fitSize(tagText, w - inner * 2, (ctx.tall ? 110 : 88) * k, 40 * k);
    const size = (ctx.tall ? 50 : 40) * k;
    s += vstack(x + inner, y + inner, w - inner * 2, stubY - y - inner * 2, [
      { h: BRAND_H * k, draw: (bx, by, bw) => brandRow(ctx, bx, by, bw) },
      { h: ts * 1.15, draw: (bx, by, bw) => textBlock([tagText], bx + bw / 2, by, ts, { fill: ctx.c.price, weight: 900, anchor: 'middle' }) },
      { h: 40 * k, draw: (bx, by, bw) => textBlock(wrapText(ctx.content.headline, bw, 34 * k, 1), bx + bw / 2, by, 34 * k, { fill: ctx.c.text, weight: 700, anchor: 'middle' }) },
      { h: 'flex', draw: (bx, by, bw, bh) => photo(ctx, ctx.item, bx, by, bw, bh) },
      { h: infoHeight(ctx, w - inner * 2, size), draw: (bx, by, bw) => info(ctx, bx, by, bw, size, 'middle').svg },
    ], 18 * k);
    s += scanBand(ctx, x + inner, stubY + 30 * k, w - inner * 2, fh - 10 * k, { fill: null });
    return s;
  },

  /** Up to four products in a grid — a "shop my picks" post. */
  collage(ctx) {
    const { W, H, pad, k } = ctx;
    const items = ctx.content.items.slice(0, 4);
    if (!items.length) items.push({ title: '' });
    const cell = (it: FlyerItem, x: number, y: number, w: number, h: number) => {
      const ts = Math.min(30 * k, h * 0.09);
      const capH = ts * 1.3 + (ctx.content.showPrice && it.price ? ts * 1.5 : 0) + 24 * k;
      let s = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(22 * k)}" fill="${ctx.c.surface}"/>`;
      s += photo(ctx, it, x + 14 * k, y + 14 * k, w - 28 * k, h - capH - 14 * k, 'rect', 14 * k);
      s += textBlock(wrapText(it.title, w - 32 * k, ts, 1), x + 16 * k, y + h - capH + 6 * k, ts, { fill: ctx.c.text, weight: 700 });
      if (ctx.content.showPrice && it.price) s += textBlock([it.price], x + 16 * k, y + h - capH + 6 * k + ts * 1.3, ts * 1.2, { fill: ctx.c.price, weight: 800 });
      return s;
    };
    const grid = (x: number, y: number, w: number, h: number, gap: number) => {
      const n = items.length;
      if (n === 1) return cell(items[0], x, y, w, h);
      if (n === 2) {
        return ctx.land || w > h
          ? cell(items[0], x, y, (w - gap) / 2, h) + cell(items[1], x + (w + gap) / 2, y, (w - gap) / 2, h)
          : cell(items[0], x, y, w, (h - gap) / 2) + cell(items[1], x, y + (h + gap) / 2, w, (h - gap) / 2);
      }
      if (n === 3) {
        return cell(items[0], x, y, w, (h - gap) * 0.55)
          + cell(items[1], x, y + (h - gap) * 0.55 + gap, (w - gap) / 2, (h - gap) * 0.45)
          + cell(items[2], x + (w + gap) / 2, y + (h - gap) * 0.55 + gap, (w - gap) / 2, (h - gap) * 0.45);
      }
      const cw = (w - gap) / 2; const chh = (h - gap) / 2;
      return items.map((it, i) => cell(it, x + (i % 2) * (cw + gap), y + Math.floor(i / 2) * (chh + gap), cw, chh)).join('');
    };
    if (ctx.land) {
      const lw = W * 0.36;
      let s = brandRow(ctx, pad, pad, lw - pad);
      const hl = wrapText(ctx.content.headline, lw - pad, 42 * k, 2);
      s += textBlock(hl, pad, pad + (BRAND_H + 16) * k, 42 * k, { fill: ctx.c.text, weight: 800 });
      s += pill(ctx.content.tag, pad, pad + (BRAND_H + 30) * k + blockH(hl, 42 * k), 22 * k, ctx.c.accent, ctx.c.onAccent).svg;
      s += scanBand(ctx, pad - 10 * k, H - pad - 170 * k, lw - pad, 170 * k, { fill: null });
      const gx = lw + 20 * k;
      const gw = W - pad - gx;
      if (items.length >= 3) {
        const cw = (gw - 16 * k * (items.length - 1)) / items.length;
        return s + items.map((it, i) => cell(it, gx + i * (cw + 16 * k), pad, cw, H - pad * 2)).join('');
      }
      return s + grid(gx, pad, gw, H - pad * 2, 16 * k);
    }
    const fh = footerH(ctx);
    const hs = headlineSize(ctx, 0.85);
    const hl = wrapText(ctx.content.headline, W - pad * 2, hs, 2);
    return vstack(pad, pad, W - pad * 2, H - pad * 2, [
      { h: BRAND_H * k, draw: (x, y, w) => brandRow(ctx, x, y, w * 0.62) + pill(ctx.content.tag, x + w, y + 10 * k, 24 * k, ctx.c.accent, ctx.c.onAccent, 'end').svg },
      { h: blockH(hl, hs), draw: (x, y) => textBlock(hl, x, y, hs, { fill: ctx.c.text, weight: 800 }) },
      { h: 'flex', draw: (x, y, w, h) => grid(x, y, w, h, 18 * k) },
      { h: fh, draw: (x, y, w, h) => scanBand(ctx, x, y, w, h) },
    ], 22 * k);
  },

  /** A tall arch window for the photo with an offset outline behind it, copy centred below. */
  arch(ctx) {
    const { W, H, pad, k } = ctx;
    if (ctx.land) return bannerColumns(ctx, { shape: 'arch' });
    const size = (ctx.tall ? 52 : 40) * k;
    const qs = (ctx.tall ? 210 : 150) * k;
    return vstack(pad, pad, W - pad * 2, H - pad * 2, [
      { h: 40 * k, draw: (x, y, w) => textBlock([ctx.content.brand], x + w / 2, y, 32 * k, { fill: ctx.c.text, weight: 700, anchor: 'middle' }) },
      { h: 'flex', draw: (x, y, w, h) => {
        const aw = Math.min(w * 0.72, h * 0.62);
        const ax = x + (w - aw) / 2;
        let s = `<g fill="none" stroke="${ctx.c.accent}" stroke-width="${r1(6 * k)}">${shapePath('arch', ax + 22 * k, y + 22 * k, aw, h - 22 * k, 0)}</g>`;
        s += photo(ctx, ctx.item, ax, y, aw, h - 22 * k, 'arch');
        s += pill(ctx.content.tag, ax + aw / 2, y + h - 80 * k, 26 * k, ctx.c.accent, ctx.c.onAccent, 'middle').svg;
        return s;
      } },
      { h: blockH(wrapText(ctx.content.headline, W - pad * 2, headlineSize(ctx, 0.8), 2), headlineSize(ctx, 0.8)),
        draw: (x, y, w) => textBlock(wrapText(ctx.content.headline, w, headlineSize(ctx, 0.8), 2), x + w / 2, y, headlineSize(ctx, 0.8), { fill: ctx.c.text, weight: 800, anchor: 'middle' }) },
      { h: infoHeight(ctx, W - pad * 2 - 100 * k, size), draw: (x, y, w) => info(ctx, x + 50 * k, y, w - 100 * k, size, 'middle').svg },
      { h: qs + 34 * k, draw: (x, y, w) => {
        const tw = Math.min(w - qs - 30 * k, 420 * k);
        const gx = x + (w - qs - 30 * k - tw) / 2;
        return qr(ctx, gx, y, qs)
          + textBlock(wrapText(ctx.content.scanLine, tw, 30 * k, 2), gx + qs + 30 * k, y + qs / 2 - 40 * k, 30 * k, { fill: ctx.c.text, weight: 700 })
          + textBlock([ctx.content.scanSub], gx + qs + 30 * k, y + qs / 2 + 36 * k, 20 * k, { fill: ctx.c.muted, weight: 600 });
      } },
    ], 22 * k);
  },

  /** A card with a diagonal corner ribbon carrying the tag and a price bar along the bottom. */
  ribbon(ctx) {
    const { W, H, pad, k } = ctx;
    const ribbonOn = (x: number, y: number, w: number, text: string) => {
      const len = 300 * k;
      const band = 64 * k;
      const clip = ctx.id('rib');
      ctx.defs.push(`<clipPath id="${clip}"><rect x="${r1(x + w - len)}" y="${r1(y)}" width="${r1(len)}" height="${r1(len)}"/></clipPath>`);
      const cx = x + w - len * 0.36;
      const cy = y + len * 0.36;
      const ts = fitSize(text, len * 0.8, 30 * k, 16 * k);
      return `<g clip-path="url(#${clip})"><g transform="rotate(45 ${r1(cx)} ${r1(cy)})"><rect x="${r1(cx - len)}" y="${r1(cy - band / 2)}" width="${r1(len * 2)}" height="${r1(band)}" fill="${ctx.c.accent}"/>`
        + `<text x="${r1(cx)}" y="${r1(cy + ts * 0.35)}" font-size="${r1(ts)}" font-weight="800" text-anchor="middle" fill="${ctx.c.onAccent}">${esc(text.toUpperCase())}</text></g></g>`;
    };
    if (ctx.land) {
      const x = pad; const y = pad; const w = W - pad * 2; const h = H - pad * 2;
      let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r1(24 * k)}" fill="${ctx.c.surface}"/>`;
      const ph = h - 40 * k;
      s += photo(ctx, ctx.item, x + 20 * k, y + 20 * k, ph, ph, 'rect', 16 * k);
      const tx = x + ph + 60 * k;
      const qs = 200 * k;
      const tw = x + w - 60 * k - qs - tx;
      let ty = y + 30 * k;
      s += brandRow(ctx, tx, ty, tw);
      ty += (BRAND_H + 16) * k;
      const hl = wrapText(ctx.content.headline, tw, 40 * k, 2);
      s += textBlock(hl, tx, ty, 40 * k, { fill: ctx.c.text, weight: 800 });
      ty += blockH(hl, 40 * k) + 10 * k;
      s += info(ctx, tx, ty, tw, 28 * k).svg;
      s += qr(ctx, x + w - 40 * k - qs, y + h - 40 * k - qs, qs);
      s += ribbonOn(x, y, w, ctx.content.tag);
      return s;
    }
    const fh = footerH(ctx);
    const size = (ctx.tall ? 52 : 42) * k;
    return vstack(pad, pad, W - pad * 2, H - pad * 2, [
      { h: 'flex', draw: (x, y, w, h) => {
        const barH = ctx.price ? 120 * k : 0;
        const hs = headlineSize(ctx, 0.75);
        const hl = wrapText(ctx.content.headline, w - 300 * k, hs, 2);
        const titleLines = wrapText(ctx.item.title, w - 80 * k, size, 2);
        let s = `<rect x="${x}" y="${r1(y)}" width="${w}" height="${r1(h)}" rx="${r1(28 * k)}" fill="${ctx.c.surface}"/>`;
        s += brandRow(ctx, x + 36 * k, y + 32 * k, w - 330 * k);
        let cy = y + (BRAND_H + 50) * k;
        s += textBlock(hl, x + 36 * k, cy, hs, { fill: ctx.c.text, weight: 800 });
        cy += blockH(hl, hs) + 20 * k;
        const ph = h - (cy - y) - blockH(titleLines, size) - barH - 60 * k;
        s += photo(ctx, ctx.item, x + 36 * k, cy, w - 72 * k, ph);
        cy += ph + 20 * k;
        s += textBlock(titleLines, x + 36 * k, cy, size, { fill: ctx.c.text, weight: 700 });
        if (barH) {
          const by = y + h - barH;
          const clip = ctx.id('bar');
          ctx.defs.push(`<clipPath id="${clip}"><rect x="${x}" y="${r1(y)}" width="${w}" height="${r1(h)}" rx="${r1(28 * k)}"/></clipPath>`);
          s += `<rect x="${x}" y="${r1(by)}" width="${w}" height="${r1(barH)}" fill="${ctx.c.accent}" clip-path="url(#${clip})"/>`;
          s += textBlock([ctx.price], x + 36 * k, by + (barH - 64 * k) / 2 - 4 * k, 64 * k, { fill: ctx.c.onAccent, weight: 900 });
          s += textBlock([`${ctx.content.cta} →`], x + w - 36 * k, by + (barH - 34 * k) / 2 - 4 * k, 34 * k, { fill: ctx.c.onAccent, weight: 700, anchor: 'end' });
        }
        return s + ribbonOn(x, y, w, ctx.content.tag);
      } },
      { h: fh, draw: (x, y, w, h) => scanBand(ctx, x, y, w, h) },
    ], 26 * k);
  },

  /** Social-story style: outline tag, a huge headline, the photo, a call-to-action button. */
  stack(ctx) {
    const { W, H, pad, k } = ctx;
    if (ctx.land) {
      let s = pill(ctx.content.tag, pad, pad, 24 * k, 'none', ctx.c.text, 'start', ctx.c.text).svg;
      const tw = W * 0.5 - pad;
      const hs = fitSize(ctx.content.headline, tw * 1.7, 64 * k, 38 * k);
      const hl = wrapText(ctx.content.headline, tw, hs, 2);
      s += textBlock(hl, pad, pad + 70 * k, hs, { fill: ctx.c.text, weight: 900, lh: 1.05 });
      const y = pad + 80 * k + blockH(hl, hs, 1.05);
      s += textBlock(wrapText(ctx.item.title, tw, 28 * k, 1), pad, y, 28 * k, { fill: ctx.c.muted, weight: 600 });
      if (ctx.price) s += textBlock([ctx.price], pad, y + 40 * k, 48 * k, { fill: ctx.c.price, weight: 900 });
      s += ctaButton(ctx, pad + 150 * k, H - pad - 56 * k, 24 * k).svg;
      const ph = H - pad * 2;
      s += photo(ctx, ctx.item, W * 0.5 + 10 * k, pad, W * 0.5 - pad - 230 * k, ph, 'rect', 40 * k);
      const qs = 190 * k;
      s += qr(ctx, W - pad - qs, H - pad - qs - 30 * k, qs);
      s += textBlock(wrapText(ctx.content.scanSub, qs, 16 * k, 1), W - pad - qs / 2, H - pad - 22 * k, 16 * k, { fill: ctx.c.text, weight: 700, anchor: 'middle' });
      s += textBlock(wrapText(ctx.content.brand, qs, 22 * k, 2), W - pad - qs / 2, pad, 22 * k, { fill: ctx.c.text, weight: 700, anchor: 'middle' });
      return s;
    }
    const hs = fitSize(ctx.content.headline, (W - pad * 2) * 1.9, (ctx.tall ? 116 : 92) * k, 54 * k);
    const hl = wrapText(ctx.content.headline, W - pad * 2, hs, 3);
    const size = (ctx.tall ? 46 : 38) * k;
    const qs = (ctx.tall ? 200 : 150) * k;
    return vstack(pad, pad, W - pad * 2, H - pad * 2, [
      { h: 56 * k, draw: (x, y, w) => pill(ctx.content.tag, x, y, 26 * k, 'none', ctx.c.text, 'start', ctx.c.text).svg
        + textBlock(wrapText(ctx.content.brand, w * 0.5, 26 * k, 1), x + w, y + 10 * k, 26 * k, { fill: ctx.c.muted, weight: 700, anchor: 'end' }) },
      { h: blockH(hl, hs, 1.04), draw: (x, y) => textBlock(hl, x, y, hs, { fill: ctx.c.text, weight: 900, lh: 1.04 }) },
      { h: 'flex', draw: (x, y, w, h) => photo(ctx, ctx.item, x, y, w, h, 'rect', 44 * k) },
      { h: infoHeight(ctx, W - pad * 2, size), draw: (x, y, w) => info(ctx, x, y, w, size).svg },
      { h: qs, draw: (x, y, w, h) => {
        const btn = ctaButton(ctx, x + (w - qs - 30 * k) / 2, y + (h - 34 * k * 1.9) / 2, 34 * k);
        return btn.svg + qr(ctx, x + w - qs, y, qs);
      } },
    ], 24 * k);
  },
};

/** Draws a flyer. Returns a complete, standalone `<svg>` document string. */
export function renderFlyer(design: FlyerDesign, content: FlyerContent, opts: RenderOptions = {}): string {
  const ctx = new Ctx(design, content, opts);
  const seed = design.layout.length * 131 + design.palette.id.length * 17 + design.pattern.length;
  const bg = `<rect width="${ctx.W}" height="${ctx.H}" fill="${ctx.c.bg}"/>`;
  const deco = patternLayer(ctx, design.pattern, seed);
  const body = (LAYOUT_FNS[design.layout] || LAYOUT_FNS.hero_card)(ctx);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ctx.W} ${ctx.H}" width="${ctx.W}" height="${ctx.H}" font-family="${FONT_STACK}">`
    + (ctx.defs.length ? `<defs>${ctx.defs.join('')}</defs>` : '')
    + bg + deco + body
    + '</svg>';
}

/** Renders a flyer and returns the text, pill and QR boxes it placed — for layout tests. */
export function layoutBoxes(design: FlyerDesign, content: FlyerContent): { width: number; height: number; boxes: LayoutBox[] } {
  probe = [];
  try {
    renderFlyer(design, content, { draft: true });
    const f = FORMATS[design.format];
    return { width: f.width, height: f.height, boxes: probe };
  } finally {
    probe = null;
  }
}

/**
 * Fills a caption template's {placeholders}. A [bracketed] part is kept only when every placeholder
 * inside it has a value, so "{product}[ for {price}]." reads naturally with or without a price.
 */
export function fillCaption(template: string, values: Record<string, string>): string {
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, name) => (name in values ? values[name] : m));
  return String(template || '')
    .replace(/\[([^\]]*)\]/g, (_, part: string) => {
      const names = [...part.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
      return names.every((n) => values[n]) ? part : '';
    })
    .replace(/\{(\w+)\}/g, (m) => fill(m))
    .trim();
}
