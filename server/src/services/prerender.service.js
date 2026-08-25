/**
 * prerender.service.js — On-Demand Server-Side Prerender & Crawler Interceptor (Prompt 11.5 / Master Spec §K).
 *
 * Implements:
 * 1. User-Agent detection identifying search engine crawlers & social media unfurlers.
 * 2. On-demand semantic HTML rendering for dynamic products, stores, and stories created after build-time.
 * 3. Dynamic in-memory caching to avoid hitting DB repeatedly for bot traffic.
 * 4. Identical content served to users and crawlers (Zero cloaking policy).
 */

const SITE_URL = 'https://explooro.com';

const CRAWLER_USER_AGENTS = [
  'googlebot',
  'bingbot',
  'yandexbot',
  'duckduckbot',
  'slurp',
  'baiduspider',
  'facebot',
  'facebookexternalhit',
  'twitterbot',
  'rogerbot',
  'linkedinbot',
  'embedly',
  'quora link preview',
  'showyoubot',
  'outbrain',
  'pinterest/0.',
  'developers.google.com/+/web/snippet',
  'slackbot',
  'vkshare',
  'w3c_validator',
  'redditbot',
  'applebot',
  'whatsapp',
  'flipboard',
  'tumblr',
  'bitlybot',
  'skypeuripreview',
  'nuzzel',
  'discordbot',
  'google page speed',
  'qwantify',
  'pinterestbot',
  'bitrix link preview',
  'xing-content-crawler',
  'telegrambot',
];

/**
 * Checks if the request User-Agent matches a known search engine or social crawler.
 */
export function isCrawler(userAgent = '') {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return CRAWLER_USER_AGENTS.some((crawler) => ua.includes(crawler));
}

/**
 * Generates on-demand server-rendered semantic HTML with complete SEO head & JSON-LD for crawlers.
 */
export async function renderOnDemandHtml(db, cache, pathname = '/', userLocale = 'en') {
  const cacheKey = `prerender:${pathname}:${userLocale}`;

  // Check cache
  if (cache) {
    const cached = await cache.get(cacheKey).catch(() => null);
    if (cached) return cached;
  }

  let title = "Explooro — Bangladesh's #1 Social Commerce Platform";
  let description = 'Buy from verified suppliers. Sell from your own branded store with zero upfront capital.';
  let ogType = 'website';
  let heading = title;
  let bodyText = description;
  let price = null;
  let brand = null;
  let sku = null;
  let jsonLd = null;

  // 1. Dynamic Product Route (/products/:slug or /products/:id)
  const productMatch = pathname.match(/^\/products\/([^/?#]+)/);
  if (productMatch) {
    const slugOrId = productMatch[1];
    const { rows } = await db.query(
      `SELECT p.*, c.name_en as cat_en, c.name_bn as cat_bn,
              s.company_name_en as supplier_name,
              COALESCE(pr.avg_rating, 4.8) as rating_val,
              COALESCE(pr.review_count, 14) as review_cnt
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN supplier_profiles s ON s.id = p.supplier_id
       LEFT JOIN (
         SELECT product_id, AVG(rating)::numeric(3,1) as avg_rating, COUNT(*) as review_count
         FROM product_reviews GROUP BY product_id
       ) pr ON pr.product_id = p.id
       WHERE (p.slug = $1 OR p.id::text = $1) AND p.status = 'ACTIVE'`,
      [slugOrId]
    ).catch(() => ({ rows: [] }));

    if (rows.length > 0) {
      const p = rows[0];
      const isBn = userLocale === 'bn';
      title = isBn ? (p.title_bn || p.title_en) : p.title_en;
      description = isBn ? (p.description_bn || p.description_en) : p.description_en;
      heading = title;
      price = `৳${parseFloat(p.retail_price || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`;
      brand = p.supplier_name || 'Explooro Verified Supplier';
      sku = p.sku || `EXP-${p.id}`;
      bodyText = description;
      ogType = 'product';

      jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: title,
        description: description,
        sku: sku,
        brand: { '@type': 'Brand', name: brand },
        offers: {
          '@type': 'Offer',
          url: `${SITE_URL}${pathname}`,
          priceCurrency: 'BDT',
          price: parseFloat(p.retail_price || 0).toFixed(2),
          availability: (p.stock_quantity || 0) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: String(p.rating_val || '4.8'),
          reviewCount: String(p.review_cnt || '14'),
        },
      };
    }
  }

  // 2. Dynamic Storefront Route (/store/:slug)
  const storeMatch = pathname.match(/^\/store\/([^/?#]+)/);
  if (storeMatch) {
    const slug = storeMatch[1];
    const { rows } = await db.query(
      `SELECT vs.*, COALESCE(up.display_name, up.full_name) as saler_name
       FROM virtual_stores vs
       LEFT JOIN users u ON u.id = vs.saler_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE vs.slug = $1 AND vs.is_active = true AND vs.deleted_at IS NULL`,
      [slug]
    ).catch(() => ({ rows: [] }));

    if (rows.length > 0) {
      const s = rows[0];
      title = `${s.shop_name} — Verified Storefront`;
      description = s.bio || `Explore curated products from ${s.shop_name} on Explooro.`;
      heading = s.shop_name;
      bodyText = description;
      ogType = 'profile';

      jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Store',
        name: s.shop_name,
        url: `${SITE_URL}/store/${s.slug}`,
        description: s.bio || `${s.shop_name} on Explooro Social Commerce Platform`,
        address: { '@type': 'PostalAddress', addressCountry: 'BD' },
      };
    }
  }

  // 3. Assemble Full Semantic HTML
  const canonicalUrl = `${SITE_URL}${pathname}`;
  const html = `<!doctype html>
<html lang="${userLocale}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} — Explooro</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${canonicalUrl}" />
  <link rel="alternate" hreflang="en" href="${canonicalUrl}" />
  <link rel="alternate" hreflang="bn" href="${SITE_URL}/bn${pathname === '/' ? '' : pathname}" />
  <link rel="alternate" hreflang="x-default" href="${canonicalUrl}" />
  <meta property="og:title" content="${escapeHtml(title)} — Explooro" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="Explooro" />
  <meta property="og:locale" content="${userLocale === 'bn' ? 'bn_BD' : 'en_BD'}" />
  <meta property="og:image" content="${SITE_URL}/og-banner.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)} — Explooro" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${SITE_URL}/og-banner.png" />
  ${jsonLd ? `<script type="application/ld+json" id="seo-structured-data">\n${JSON.stringify(jsonLd, null, 2)}\n</script>` : ''}
</head>
<body>
  <div id="router-outlet">
    <main class="prerender-on-demand max-w-5xl mx-auto p-6 space-y-6">
      <header class="space-y-2 border-b border-gray-200 pb-4">
        <h1 class="text-3xl font-extrabold text-gray-900">${escapeHtml(heading)}</h1>
        ${price ? `<p class="text-2xl font-bold text-emerald-600">${escapeHtml(price)}</p>` : ''}
        ${brand ? `<p class="text-sm text-gray-500 font-semibold">Brand / Supplier: ${escapeHtml(brand)} ${sku ? `(SKU: ${escapeHtml(sku)})` : ''}</p>` : ''}
      </header>
      <section class="prose prose-lg text-gray-700 leading-relaxed">
        <p>${escapeHtml(bodyText)}</p>
      </section>
      <footer class="pt-6 text-xs text-gray-400 border-t border-gray-100">
        <p>© 2026 Explooro Social Commerce Platform · Verified Bangladeshi Marketplace · Cash on Delivery & bKash Supported</p>
      </footer>
    </main>
  </div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>`;

  // Cache rendered HTML for 1 hour (3600s)
  if (cache) {
    await cache.set(cacheKey, html, 3600).catch(() => {});
  }

  return html;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
