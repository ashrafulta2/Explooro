/**
 * seo.js — Dynamic Document Head & Structured Data (JSON-LD) Service (Prompt 11.5 / Master Spec §K).
 *
 * Implements:
 * 1. Per-route dynamic head management (<title>, <meta name="description">, <link rel="canonical">).
 * 2. Bilingual hreflang alternating link tags (bn, en, x-default).
 * 3. OpenGraph & Twitter Card meta tag generation with dynamic image keys.
 * 4. Rich JSON-LD Structured Data Schema generation (Product, Offer, AggregateRating, Store, BreadcrumbList, WebSite, Article).
 * 5. Unicode Bengali slug normalization & encoding.
 */

const SITE_URL = 'https://explooro.com';
const SITE_NAME = 'Explooro';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-banner.png`;

/**
 * Normalizes Unicode Bengali or English text into a valid, URL-safe slug.
 */
export function normalizeSlug(text) {
  if (!text) return '';
  return text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s\-_—–]+/g, '-') // collapse whitespace, hyphens, and em/en dashes
    .replace(/[^\p{L}\p{M}\p{N}\-]/gu, '') // preserve Unicode alphanumeric letters, Bengali marks/matras, and hyphens
    .replace(/-+/g, '-') // collapse multiple consecutive hyphens
    .replace(/^-+|-+$/g, '');
}

/**
 * Updates document <head> meta tags, canonical link, hreflangs, and injects structured JSON-LD.
 */
export function updateHead({
  title = '',
  description = '',
  canonicalPath = '/',
  locale = 'en',
  ogImage = null,
  ogType = 'website',
  jsonLd = null,
  noIndex = false,
} = {}) {
  if (typeof document === 'undefined') return;

  const fullTitle = title ? `${title} — ${SITE_NAME}` : `${SITE_NAME} — Bangladesh's #1 Social Commerce Platform`;
  document.title = fullTitle;

  // 1. Meta Description
  setMetaTag('name', 'description', description || "Buy from verified suppliers. Sell from your own branded store. Explooro is Bangladesh's premier social commerce platform.");

  // 2. Robots
  setMetaTag('name', 'robots', noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');

  // 3. Canonical Link
  const canonicalUrl = `${SITE_URL}${canonicalPath.startsWith('/') ? canonicalPath : `/${canonicalPath}`}`;
  setLinkTag('canonical', canonicalUrl);

  // 4. Hreflang Alternates (Prompt 11.5 Requirement)
  setHreflangLinks(canonicalPath);

  // 5. OpenGraph Tags
  setMetaTag('property', 'og:title', fullTitle);
  setMetaTag('property', 'og:description', description || fullTitle);
  setMetaTag('property', 'og:url', canonicalUrl);
  setMetaTag('property', 'og:type', ogType);
  setMetaTag('property', 'og:site_name', SITE_NAME);
  setMetaTag('property', 'og:locale', locale === 'bn' ? 'bn_BD' : 'en_BD');
  setMetaTag('property', 'og:image', ogImage || DEFAULT_OG_IMAGE);

  // 6. Twitter Card Tags
  setMetaTag('name', 'twitter:card', 'summary_large_image');
  setMetaTag('name', 'twitter:title', fullTitle);
  setMetaTag('name', 'twitter:description', description || fullTitle);
  setMetaTag('name', 'twitter:image', ogImage || DEFAULT_OG_IMAGE);

  // 7. Structured Data (JSON-LD)
  if (jsonLd) {
    setJsonLd(jsonLd);
  }
}

function setMetaTag(attrName, attrVal, content) {
  let el = document.head.querySelector(`meta[${attrName}="${attrVal}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attrName, attrVal);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLinkTag(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function setHreflangLinks(path) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  // Remove existing alternates
  document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el) => el.remove());

  const alternates = [
    { hreflang: 'en', href: `${SITE_URL}${cleanPath}` },
    { hreflang: 'bn', href: `${SITE_URL}/bn${cleanPath === '/' ? '' : cleanPath}` },
    { hreflang: 'x-default', href: `${SITE_URL}${cleanPath}` },
  ];

  alternates.forEach(({ hreflang, href }) => {
    const link = document.createElement('link');
    link.setAttribute('rel', 'alternate');
    link.setAttribute('hreflang', hreflang);
    link.setAttribute('href', href);
    document.head.appendChild(link);
  });
}

function setJsonLd(schemaObj) {
  let script = document.head.querySelector('script[type="application/ld+json"]#seo-structured-data');
  if (!script) {
    script = document.createElement('script');
    script.setAttribute('type', 'application/ld+json');
    script.setAttribute('id', 'seo-structured-data');
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(schemaObj, null, 2);
}

// -----------------------------------------------------------------------------
// JSON-LD Schema Builders (Schema.org Compliant)
// -----------------------------------------------------------------------------

/**
 * Builds Schema.org Product Structured Data with Offer, Brand, and Rating.
 */
export function buildProductJsonLd({
  id = null,
  name = '',
  description = '',
  images = [],
  sku = '',
  retailPrice = 0,
  currency = 'BDT',
  inStock = true,
  brand = 'Explooro Artisan',
  ratingValue = 4.8,
  reviewCount = 12,
  store = null,
} = {}) {
  const productUrl = `${SITE_URL}/products/${sku || id || 'item'}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: name,
    image: images.length > 0 ? images : [DEFAULT_OG_IMAGE],
    description: description,
    sku: String(sku || id || 'EXP-001'),
    mpn: String(id || '001'),
    brand: {
      '@type': 'Brand',
      name: brand || 'Explooro Verified Supplier',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: String(ratingValue || '4.8'),
      reviewCount: String(reviewCount || '1'),
      bestRating: '5',
      worstRating: '1',
    },
    offers: {
      '@type': 'Offer',
      url: productUrl,
      priceCurrency: currency,
      price: parseFloat(retailPrice || 0).toFixed(2),
      priceValidUntil: '2027-12-31',
      itemCondition: 'https://schema.org/NewCondition',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: {
        '@type': 'Organization',
        name: store?.shop_name || 'Explooro Marketplace',
      },
    },
  };
}

/**
 * Builds Schema.org Store / OnlineStore Structured Data.
 */
export function buildStoreJsonLd({
  slug = '',
  shopName = '',
  bio = '',
  logoUrl = null,
  salerName = '',
} = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': ['Store', 'LocalBusiness', 'OnlineStore'],
    name: shopName || 'Explooro Storefront',
    url: `${SITE_URL}/store/${slug}`,
    logo: logoUrl || DEFAULT_OG_IMAGE,
    description: bio || `${shopName} on Explooro Social Commerce Platform`,
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'BD',
      addressLocality: 'Dhaka',
    },
    priceRange: '৳৳',
    founder: {
      '@type': 'Person',
      name: salerName || 'Verified Merchant',
    },
  };
}

/**
 * Builds Schema.org BreadcrumbList Structured Data.
 */
export function buildBreadcrumbJsonLd(items = []) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url.startsWith('http') ? item.url : `${SITE_URL}${item.url.startsWith('/') ? item.url : `/${item.url}`}`,
    })),
  };
}

/**
 * Builds Schema.org WebSite Structured Data with SearchAction.
 */
export function buildWebsiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/products?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * Builds Schema.org Article / BlogPosting Structured Data for UGC Stories.
 */
export function buildStoryJsonLd({
  title = '',
  description = '',
  slug = '',
  authorName = 'Explooro Creator',
  imageUrl = null,
  publishedAt = null,
} = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: description,
    image: imageUrl || DEFAULT_OG_IMAGE,
    url: `${SITE_URL}/stories/${slug}`,
    author: {
      '@type': 'Person',
      name: authorName,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/favicon.svg`,
      },
    },
    datePublished: publishedAt || new Date().toISOString(),
  };
}
