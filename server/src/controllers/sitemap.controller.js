/**
 * sitemap.controller.js — Dynamic XML Sitemaps & Search Engine Integration (Prompt 11.5 / Master Spec §K).
 *
 * Implements:
 * 1. Sitemap Index (/sitemap.xml) linking child sitemaps (products, stores, categories, stories, static).
 * 2. Dynamic XML generation with lastmod timestamps, changefreq, priority, and bilingual hreflang alternates.
 * 3. Crawler on-demand prerender interceptor serving complete HTML.
 * 4. Robots.txt dynamic endpoint.
 * 5. Auto-submit ping helper to notify Google and Bing upon new catalog publish.
 */

import { isCrawler, renderOnDemandHtml } from '../services/prerender.service.js';

const SITE_URL = 'https://explooro.com';

function buildUrlEntry({
  loc,
  lastmod = null,
  changefreq = 'weekly',
  priority = '0.7',
  hasBilingual = true,
}) {
  const modTag = lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : `<lastmod>${new Date().toISOString()}</lastmod>`;
  const bnPath = loc.replace(SITE_URL, `${SITE_URL}/bn`);

  return `  <url>
    <loc>${loc}</loc>
    ${modTag}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
    ${hasBilingual ? `
    <xhtml:link rel="alternate" hreflang="en" href="${loc}" />
    <xhtml:link rel="alternate" hreflang="bn" href="${bnPath}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${loc}" />` : ''}
  </url>`;
}

function wrapUrlset(entries = []) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>`;
}

export async function getSitemapIndex(req, reply) {
  const now = new Date().toISOString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${SITE_URL}/sitemaps/products.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE_URL}/sitemaps/stores.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE_URL}/sitemaps/categories.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE_URL}/sitemaps/stories.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE_URL}/sitemaps/static.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
</sitemapindex>`;

  reply.header('Content-Type', 'application/xml; charset=utf-8');
  reply.header('Cache-Control', 'public, max-age=3600');
  return reply.send(xml);
}

export async function getProductsSitemap(req, reply) {
  const { rows } = await req.server.db.query(
    `SELECT id, slug, updated_at, created_at
     FROM products
     WHERE status = 'ACTIVE'
     ORDER BY updated_at DESC
     LIMIT 5000`
  ).catch(() => ({ rows: [] }));

  const entries = rows.map((p) =>
    buildUrlEntry({
      loc: `${SITE_URL}/products/${p.slug || p.id}`,
      lastmod: p.updated_at || p.created_at,
      changefreq: 'daily',
      priority: '0.9',
    })
  );

  const xml = wrapUrlset(entries);
  reply.header('Content-Type', 'application/xml; charset=utf-8');
  reply.header('Cache-Control', 'public, max-age=1800');
  return reply.send(xml);
}

export async function getStoresSitemap(req, reply) {
  const { rows } = await req.server.db.query(
    `SELECT slug, updated_at, created_at
     FROM virtual_stores
     WHERE is_published = true AND deleted_at IS NULL
     ORDER BY updated_at DESC
     LIMIT 5000`
  ).catch(() => ({ rows: [] }));

  const entries = rows.map((s) =>
    buildUrlEntry({
      loc: `${SITE_URL}/store/${s.slug}`,
      lastmod: s.updated_at || s.created_at,
      changefreq: 'weekly',
      priority: '0.8',
    })
  );

  const xml = wrapUrlset(entries);
  reply.header('Content-Type', 'application/xml; charset=utf-8');
  reply.header('Cache-Control', 'public, max-age=3600');
  return reply.send(xml);
}

export async function getCategoriesSitemap(req, reply) {
  const { rows } = await req.server.db.query(
    `SELECT slug, updated_at, created_at
     FROM categories
     WHERE status = 'ACTIVE'
     ORDER BY name_en ASC`
  ).catch(() => ({ rows: [] }));

  const entries = rows.map((c) =>
    buildUrlEntry({
      loc: `${SITE_URL}/categories/${c.slug}`,
      lastmod: c.updated_at || c.created_at,
      changefreq: 'weekly',
      priority: '0.7',
    })
  );

  const xml = wrapUrlset(entries);
  reply.header('Content-Type', 'application/xml; charset=utf-8');
  reply.header('Cache-Control', 'public, max-age=86400');
  return reply.send(xml);
}

export async function getStoriesSitemap(req, reply) {
  const { rows } = await req.server.db.query(
    `SELECT slug, updated_at, created_at
     FROM stories
     WHERE status = 'PUBLISHED'
     ORDER BY created_at DESC
     LIMIT 1000`
  ).catch(() => ({ rows: [] }));

  const entries = rows.map((st) =>
    buildUrlEntry({
      loc: `${SITE_URL}/stories/${st.slug}`,
      lastmod: st.updated_at || st.created_at,
      changefreq: 'monthly',
      priority: '0.6',
    })
  );

  const xml = wrapUrlset(entries);
  reply.header('Content-Type', 'application/xml; charset=utf-8');
  reply.header('Cache-Control', 'public, max-age=3600');
  return reply.send(xml);
}

export async function getStaticSitemap(req, reply) {
  const staticRoutes = [
    { path: '/', changefreq: 'daily', priority: '1.0' },
    { path: '/categories', changefreq: 'weekly', priority: '0.8' },
    { path: '/stories', changefreq: 'daily', priority: '0.7' },
    { path: '/reels', changefreq: 'daily', priority: '0.7' },
    { path: '/about', changefreq: 'monthly', priority: '0.5' },
    { path: '/terms', changefreq: 'yearly', priority: '0.3' },
    { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
  ];

  const entries = staticRoutes.map((r) =>
    buildUrlEntry({
      loc: `${SITE_URL}${r.path === '/' ? '' : r.path}`,
      changefreq: r.changefreq,
      priority: r.priority,
    })
  );

  const xml = wrapUrlset(entries);
  reply.header('Content-Type', 'application/xml; charset=utf-8');
  reply.header('Cache-Control', 'public, max-age=86400');
  return reply.send(xml);
}

export async function getRobotsTxt(req, reply) {
  const robots = `# robots.txt — Search Engine Crawler Governance (Prompt 11.5)
User-agent: *
Allow: /
Allow: /products/
Allow: /store/
Allow: /categories
Allow: /categories/
Allow: /stories
Allow: /stories/
Allow: /reels
Allow: /about
Allow: /terms
Allow: /privacy
Allow: /s/
Allow: /widget.js

Disallow: /admin/
Disallow: /moderator/
Disallow: /editor/
Disallow: /saler/
Disallow: /supplier/
Disallow: /account/
Disallow: /customer/
Disallow: /cart/
Disallow: /checkout/
Disallow: /auth/
Disallow: /api/
Disallow: /dev/

Sitemap: ${SITE_URL}/sitemap.xml
`;

  reply.header('Content-Type', 'text/plain; charset=utf-8');
  reply.header('Cache-Control', 'public, max-age=86400');
  return reply.send(robots);
}

/**
 * On-demand prerender interceptor: returns full semantic HTML if crawler user-agent detected.
 */
export async function crawlerPrerenderHandler(req, reply) {
  const userAgent = req.headers['user-agent'] || '';

  if (isCrawler(userAgent)) {
    const locale = req.headers['accept-language']?.includes('bn') ? 'bn' : 'en';
    const html = await renderOnDemandHtml(req.server.db, req.server.cache, req.url, locale);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('X-Prerendered', 'true');
    return reply.send(html);
  }

  // Not a crawler — proceed normally
  return;
}

/**
 * Pings Google and Bing with updated sitemap location upon new catalog item publish.
 */
export async function pingSearchEngines(sitemapUrl = `${SITE_URL}/sitemap.xml`) {
  const encodedUrl = encodeURIComponent(sitemapUrl);
  const endpoints = [
    `https://www.google.com/ping?sitemap=${encodedUrl}`,
    `https://www.bing.com/ping?sitemap=${encodedUrl}`,
  ];

  for (const ep of endpoints) {
    try {
      if (typeof fetch === 'function') {
        fetch(ep, { method: 'GET', signal: AbortSignal.timeout(3000) }).catch(() => {});
      }
    } catch {}
  }
}
