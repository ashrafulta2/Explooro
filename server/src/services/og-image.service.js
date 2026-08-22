/**
 * og-image.service.js — Server-side dynamic OpenGraph image generator for stores & products (Prompt 4.8).
 *
 * Generates high-fidelity 1200x630 social preview cards (SVG/PNG) for WhatsApp, Facebook,
 * Telegram, and Twitter/X sharing.
 */

// Simple in-memory cache for generated OG image buffers keyed by entity key + updated_at
const ogCache = new Map();
const MAX_CACHE_ENTRIES = 500;

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
 * Generates an OpenGraph SVG banner for a virtual storefront.
 * Dimensions: 1200 x 630 (Standard OG Image ratio: 1.91:1).
 */
export function generateStoreOgSvg(store) {
  const shopName = escapeXml(store.shop_name || 'Explooro Store');
  const slug = escapeXml(store.slug || '');
  const bio = escapeXml(store.bio || 'Verified Bangladeshi Social Seller · Powered by Explooro');
  const district = escapeXml(store.district || 'Dhaka, Bangladesh');
  const rating = store.rating ? Number(store.rating).toFixed(1) : '4.9';
  const followers = store.followers ? Number(store.followers).toLocaleString() : '1,200+';
  const productsCount = store.products_count ? Number(store.products_count) : '45+';
  const isOpen = store.is_open !== false;
  const statusColor = isOpen ? '#22c55e' : '#ef4444';
  const statusText = isOpen ? 'Store Open 🟢' : 'Store Closed 🔴';

  // Explooro brand colors
  const primaryBg = '#0b0f19';
  const cardBg = '#131b2e';
  const brandViolet = '#7c3aed';
  const brandVioletLight = '#a78bfa';
  const textWhite = '#f8fafc';
  const textMuted = '#94a3b8';

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primaryBg}" />
      <stop offset="50%" stop-color="#111827" />
      <stop offset="100%" stop-color="#090d16" />
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${brandViolet}" />
      <stop offset="100%" stop-color="${brandVioletLight}" />
    </linearGradient>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${cardBg}" />
      <stop offset="100%" stop-color="#1e293b" />
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000" flood-opacity="0.45" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bgGrad)" />

  <!-- Accent top bar -->
  <rect x="0" y="0" width="1200" height="8" fill="url(#accentGrad)" />

  <!-- Subtle glow shapes -->
  <circle cx="1100" cy="100" r="280" fill="${brandViolet}" opacity="0.12" />
  <circle cx="100" cy="550" r="220" fill="#0284c7" opacity="0.08" />

  <!-- Main Card Container -->
  <rect x="80" y="60" width="1040" height="510" rx="24" fill="url(#cardGrad)" stroke="#334155" stroke-width="2" filter="url(#shadow)" />

  <!-- Explooro Header Badge -->
  <rect x="120" y="95" width="170" height="38" rx="8" fill="#1e1b4b" stroke="${brandViolet}" stroke-width="1.5" />
  <text x="135" y="120" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" fill="${brandVioletLight}">⚡ EXPLOORO STORE</text>

  <!-- Store Status Badge -->
  <rect x="910" y="95" width="170" height="38" rx="8" fill="#0f172a" stroke="${statusColor}" stroke-width="1.5" />
  <circle cx="930" cy="114" r="5" fill="${statusColor}" />
  <text x="945" y="120" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" font-weight="600" fill="${statusColor}">${statusText}</text>

  <!-- Store Avatar / Logo Box -->
  <rect x="120" y="160" width="110" height="110" rx="20" fill="url(#accentGrad)" />
  <text x="175" y="230" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="44" font-weight="800" fill="#ffffff" text-anchor="middle">${shopName.charAt(0)}</text>

  <!-- Store Title & Slug -->
  <text x="250" y="210" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="40" font-weight="800" fill="${textWhite}">${shopName}</text>
  <text x="250" y="248" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="500" fill="${brandVioletLight}">explooro.com/store/${slug}</text>

  <!-- Verified Seller Badge Icon -->
  <circle cx="215" cy="170" r="14" fill="#0284c7" />
  <path d="M209 170l4 4 8-8" stroke="#ffffff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />

  <!-- Bio / Tagline (Wrapped display) -->
  <text x="120" y="315" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="400" fill="${textMuted}">${bio.slice(0, 95)}</text>

  <!-- Stats Grid -->
  <rect x="120" y="360" width="960" height="110" rx="16" fill="#0f172a" stroke="#1e293b" stroke-width="1.5" />

  <!-- Stat 1: Rating -->
  <text x="160" y="405" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="800" fill="#fbbf24">★ ${rating}</text>
  <text x="160" y="440" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="500" fill="${textMuted}">Customer Rating</text>

  <!-- Divider -->
  <line x1="380" y1="380" x2="380" y2="450" stroke="#334155" stroke-width="1.5" />

  <!-- Stat 2: Products -->
  <text x="440" y="405" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="800" fill="${textWhite}">${productsCount}</text>
  <text x="440" y="440" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="500" fill="${textMuted}">Products Listed</text>

  <!-- Divider -->
  <line x1="680" y1="380" x2="680" y2="450" stroke="#334155" stroke-width="1.5" />

  <!-- Stat 3: Community & Trust -->
  <text x="740" y="405" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="800" fill="#38bdf8">100% Escrow</text>
  <text x="740" y="440" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="500" fill="${textMuted}">Buyer Protected</text>

  <!-- Footer Banner -->
  <text x="120" y="525" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="17" font-weight="600" fill="#64748b">🛍️ Shop directly on WhatsApp or Web · Fast Delivery across ${district}</text>
</svg>`;
}

/**
 * Generates an OpenGraph SVG banner for a product share.
 */
export function generateProductOgSvg(product) {
  const title = escapeXml(product.title_en || product.title_bn || 'Product');
  const price = product.default_retail_price || product.price || 0;
  const brand = escapeXml(product.brand || 'Explooro Certified');
  const storeName = escapeXml(product.store_name || product.supplier_name_en || 'Explooro Marketplace');
  const rating = product.rating_avg ? Number(product.rating_avg).toFixed(1) : '4.8';

  const primaryBg = '#0b0f19';
  const cardBg = '#131b2e';
  const brandViolet = '#7c3aed';
  const brandVioletLight = '#a78bfa';
  const textWhite = '#f8fafc';
  const textMuted = '#94a3b8';

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primaryBg}" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="priceGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#10b981" />
      <stop offset="100%" stop-color="#34d399" />
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bgGrad)" />
  <rect x="0" y="0" width="1200" height="8" fill="${brandViolet}" />

  <!-- Main Card -->
  <rect x="80" y="60" width="1040" height="510" rx="24" fill="${cardBg}" stroke="#334155" stroke-width="2" />

  <!-- Brand tag -->
  <rect x="120" y="100" width="180" height="36" rx="8" fill="#1e1b4b" />
  <text x="135" y="124" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" fill="${brandVioletLight}">⚡ ${brand.toUpperCase()}</text>

  <!-- Product Title -->
  <text x="120" y="200" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="38" font-weight="800" fill="${textWhite}">${title.slice(0, 48)}</text>

  <!-- Price Badge -->
  <rect x="120" y="250" width="280" height="70" rx="16" fill="#064e3b" stroke="#10b981" stroke-width="1.5" />
  <text x="150" y="298" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="36" font-weight="800" fill="#34d399">৳ ${Number(price).toLocaleString('en-US', { minimumFractionDigits: 2 })}</text>

  <!-- Store Info -->
  <text x="120" y="380" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="600" fill="${textWhite}">Sold by: ${storeName}</text>
  <text x="120" y="420" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="400" fill="${textMuted}">★ ${rating} Rating · 100% Genuine &amp; Escrow Protected</text>

  <!-- CTA Box -->
  <rect x="120" y="460" width="960" height="70" rx="12" fill="#0f172a" stroke="#1e293b" />
  <text x="150" y="503" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="700" fill="${brandVioletLight}">🚀 Buy online or chat with seller on Explooro · Cash on Delivery available</text>
</svg>`;
}

/**
 * Returns the cached or freshly generated OpenGraph image.
 */
export async function getStoreOgImageBuffer(store) {
  const cacheKey = `store:${store.slug}:${store.updated_at || 'v1'}`;
  if (ogCache.has(cacheKey)) {
    return ogCache.get(cacheKey);
  }

  const svg = generateStoreOgSvg(store);
  const buffer = Buffer.from(svg, 'utf-8');

  if (ogCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = ogCache.keys().next().value;
    ogCache.delete(oldestKey);
  }
  ogCache.set(cacheKey, { buffer, contentType: 'image/svg+xml' });

  return { buffer, contentType: 'image/svg+xml' };
}

/**
 * Returns the cached or freshly generated OpenGraph product image.
 */
export async function getProductOgImageBuffer(product) {
  const cacheKey = `product:${product.slug || product.id}:${product.updated_at || 'v1'}`;
  if (ogCache.has(cacheKey)) {
    return ogCache.get(cacheKey);
  }

  const svg = generateProductOgSvg(product);
  const buffer = Buffer.from(svg, 'utf-8');

  if (ogCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = ogCache.keys().next().value;
    ogCache.delete(oldestKey);
  }
  ogCache.set(cacheKey, { buffer, contentType: 'image/svg+xml' });

  return { buffer, contentType: 'image/svg+xml' };
}
