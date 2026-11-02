/**
 * flyer.service.ts — Server-Side Vector Flyer & Local QR Code Generator (Prompt 9.7).
 *
 * Implements:
 * 1. Zero-dependency pure local QR code SVG matrix generator (no external API calls/latency).
 * 2. Multi-format flyer templates (Social Square 1:1, WhatsApp Story 9:16, A4 Print Poster).
 * 3. Native Bengali Unicode text rendering support with embedded typography.
 * 4. Multi-style themes (Modern Dark, Minimalist Light, Festive Gold).
 */

import { encodeQr, qrPathData } from '../lib/qr.ts';
import { AppError } from '../plugins/errorHandler.ts';
import { publicShortUrl } from './shortlink.service.ts';

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * A real, scannable QR code of `url` as a standalone SVG (lib/qr.ts, encoded locally).
 * WHY replaced: this used to draw finder patterns around a hash-seeded random fill, which looked
 * like a QR code but scanned as nothing.
 */
export function generateLocalQrSvg(url, size = 180, fgColor = '#000000', bgColor = '#ffffff') {
  const qr = encodeQr(String(url || ''));
  const quiet = 4;
  const cell = size / (qr.size + quiet * 2);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="${bgColor}" rx="12" />
    <path d="${qrPathData(qr)}" transform="translate(${(quiet * cell).toFixed(3)} ${(quiet * cell).toFixed(3)}) scale(${cell.toFixed(4)})" fill="${fgColor}" shape-rendering="crispEdges" />
  </svg>`;
}

// WHY one table: the flyer renderer and GET /saler/social-kit/templates read the same sizes, so the
// picker can never offer a format the renderer would silently draw as a square.
export const FLYER_FORMATS = Object.freeze({
  SQUARE: Object.freeze({ width: 1080, height: 1080, label_en: 'Social Post 1:1', label_bn: 'সোশ্যাল পোস্ট ১:১' }),
  STORY: Object.freeze({ width: 1080, height: 1920, label_en: 'WhatsApp / Facebook Story 9:16', label_bn: 'স্টোরি ৯:১৬' }),
  A4_PRINT: Object.freeze({ width: 1240, height: 1754, label_en: 'A4 Print Flyer', label_bn: 'A4 প্রিন্ট ফ্লায়ার' }),
});
export const FLYER_THEMES = Object.freeze(['DARK', 'MINIMAL', 'GOLD']);

/**
 * Builds a promotional flyer SVG across formats and themes.
 */
export function generateFlyerSvg({
  product,
  store = {} as Record<string, any>,
  shortUrl = 'https://explooro.com',
  format = 'SQUARE', // 'SQUARE' (1080x1080), 'STORY' (1080x1920), 'A4_PRINT' (1240x1754)
  theme = 'DARK',    // 'DARK', 'MINIMAL', 'GOLD'
}) {
  const { width, height } = FLYER_FORMATS[format] || FLYER_FORMATS.SQUARE;

  // WHY title_*: a `products` row names it title_en/title_bn, so real flyers used to print the demo
  // name. No product means a whole-store link: the flyer advertises the store, with no price.
  const productNameEn = escapeXml(product ? product.name_en || product.title_en || '' : 'Shop my full collection');
  const productNameBn = escapeXml(product ? product.name_bn || product.title_bn || '' : 'আমার পুরো কালেকশন দেখুন');
  const shopName = escapeXml(store?.shop_name || 'Explooro');
  // WHY default_retail_price: a raw `products` row has no base_price, so every real product's
  // flyer used to print the 2450 demo price.
  const priceNum = Number(product?.base_price ?? product?.default_retail_price);
  const hasPrice = Number.isFinite(priceNum) && priceNum > 0;
  const price = hasPrice ? priceNum.toFixed(2) : '';
  // WHY no fallback: a struck price is a claim to the shopper. It is drawn only when the caller
  // passes a real higher price; it used to be invented as price × 1.25 with a fixed 20% saving badge.
  const originalNum = Number(product?.original_price);
  const hasCompare = Number.isFinite(originalNum) && originalNum > priceNum && priceNum > 0;
  const comparePrice = hasCompare ? originalNum.toFixed(2) : '';
  const savePct = hasCompare ? Math.round(((originalNum - priceNum) / originalNum) * 100) : 0;
  const qrSize = format === 'STORY' ? 220 : 180;
  const qrSvg = generateLocalQrSvg(shortUrl, qrSize, '#000000', '#ffffff');

  // Theme palettes
  let bgGradientStart = '#0f172a';
  let bgGradientEnd = '#1e1b4b';
  let cardBg = '#1e293b';
  let primaryAccent = '#8b5cf6';
  let textColor = '#f8fafc';
  let mutedColor = '#94a3b8';
  let priceColor = '#38bdf8';

  if (theme === 'MINIMAL') {
    bgGradientStart = '#f8fafc';
    bgGradientEnd = '#f1f5f9';
    cardBg = '#ffffff';
    primaryAccent = '#6366f1';
    textColor = '#0f172a';
    mutedColor = '#64748b';
    priceColor = '#4338ca';
  } else if (theme === 'GOLD') {
    bgGradientStart = '#1a130b';
    bgGradientEnd = '#2e200e';
    cardBg = '#3d2b14';
    primaryAccent = '#f59e0b';
    textColor = '#fef3c7';
    mutedColor = '#d97706';
    priceColor = '#fbbf24';
  }

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@500;700&amp;family=Outfit:wght@600;800;900&amp;display=swap');
      .font-brand { font-family: 'Outfit', -apple-system, sans-serif; }
      .font-bn { font-family: 'Hind Siliguri', 'Noto Sans Bengali', -apple-system, sans-serif; }
    </style>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${bgGradientStart}" />
      <stop offset="100%" stop-color="${bgGradientEnd}" />
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-opacity="0.3" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bgGrad)" />

  <!-- Header Store Branding -->
  <g transform="translate(60, 60)">
    <rect width="${width - 120}" height="80" rx="16" fill="${cardBg}" opacity="0.9" />
    <circle cx="50" cy="40" r="24" fill="${primaryAccent}" />
    <text x="50" y="48" font-size="20" text-anchor="middle" fill="#ffffff" class="font-brand" font-weight="900">⚡</text>
    <text x="90" y="38" font-size="20" fill="${textColor}" class="font-brand" font-weight="800">${shopName}</text>
    <text x="90" y="58" font-size="13" fill="${mutedColor}" class="font-brand">Verified Explooro Social Shop Partner · Dhaka</text>
  </g>

  <!-- Main Showcase Card -->
  <g transform="translate(60, 170)" filter="url(#shadow)">
    <rect width="${width - 120}" height="${height - 380}" rx="24" fill="${cardBg}" />

    <!-- Product Visual Placeholder Frame -->
    <rect x="30" y="30" width="${width - 180}" height="${format === 'STORY' ? 800 : format === 'A4_PRINT' ? 700 : 420}" rx="16" fill="${primaryAccent}" fill-opacity="0.1" />
    <text x="${(width - 120) / 2}" y="${format === 'STORY' ? 440 : format === 'A4_PRINT' ? 390 : 250}" font-size="80" text-anchor="middle">🛍️</text>

    <!-- Product Titles (English & Bengali) -->
    <text x="40" y="${format === 'STORY' ? 900 : format === 'A4_PRINT' ? 800 : 510}" font-size="34" font-weight="900" fill="${textColor}" class="font-brand">${productNameEn}</text>
    <text x="40" y="${format === 'STORY' ? 950 : format === 'A4_PRINT' ? 850 : 560}" font-size="26" font-weight="700" fill="${mutedColor}" class="font-bn">${productNameBn}</text>

    <!-- Price Section -->
    <g transform="translate(40, ${format === 'STORY' ? 1020 : format === 'A4_PRINT' ? 920 : 620})">
      <text x="0" y="36" font-size="44" font-weight="900" fill="${priceColor}" class="font-brand">${hasPrice ? `৳${price}` : ''}</text>
${hasCompare ? `
      <text x="210" y="32" font-size="22" font-weight="600" text-decoration="line-through" fill="${mutedColor}" class="font-brand">৳${comparePrice}</text>
      <rect x="330" y="6" width="120" height="34" rx="8" fill="#22c55e" fill-opacity="0.2" />
      <text x="390" y="28" font-size="14" font-weight="800" fill="#22c55e" text-anchor="middle" class="font-brand">SAVE ${savePct}%</text>` : ''}
    </g>
  </g>

  <!-- Bottom CTA Footer with Local QR Code -->
  <g transform="translate(60, ${height - 180})">
    <rect width="${width - 120}" height="140" rx="20" fill="${cardBg}" opacity="0.95" />

    <!-- QR Code Embed -->
    <g transform="translate(20, -20)">
      ${qrSvg}
    </g>

    <!-- Scan & Order Callout -->
    <text x="220" y="60" font-size="24" font-weight="900" fill="${textColor}" class="font-brand">Scan QR Code to Order Now</text>
    <text x="220" y="90" font-size="16" font-weight="700" fill="${primaryAccent}" class="font-bn">ক্যামেরা বা WhatsApp দিয়ে স্ক্যান করে অর্ডার করুন</text>
    <text x="${width - 160}" y="76" font-size="15" font-weight="800" fill="${mutedColor}" text-anchor="end" class="font-brand">explooro.com</text>
  </g>
</svg>`;
}

/**
 * The flyer for one tracked short link: its product (if any), the partner's store name, and a QR
 * of the link itself, so a printed flyer always credits the partner who made it.
 */
export async function renderFlyerForLink(db, { code, format = 'SQUARE', theme = 'DARK' }) {
  const { rows } = await db.query(
    `SELECT sl.code, p.title_en, p.title_bn, p.default_retail_price, vs.shop_name
       FROM short_links sl
       LEFT JOIN products p ON p.id = sl.product_id AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
       LEFT JOIN virtual_stores vs ON vs.saler_id = sl.saler_id AND vs.deleted_at IS NULL
      WHERE sl.code = $1
      LIMIT 1`,
    [String(code || '').toLowerCase()],
  );
  const link = rows[0];
  if (!link) throw new AppError('SHORTLINK_NOT_FOUND', 'Short link does not exist or has expired.');
  return generateFlyerSvg({
    product: link.title_en ? link : null,
    store: { shop_name: link.shop_name || 'Explooro' },
    shortUrl: publicShortUrl(link.code),
    format: FLYER_FORMATS[format] ? format : 'SQUARE',
    theme: FLYER_THEMES.includes(theme) ? theme : 'DARK',
  });
}
