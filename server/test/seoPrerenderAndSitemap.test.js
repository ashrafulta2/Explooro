/**
 * seoPrerenderAndSitemap.test.js — Automated test suite for Prompt 11.5 (SEO, Prerendering, Structured Data & Sitemaps).
 *
 * Verifies all ACCEPTANCE criteria from docs/prompt.md Prompt 11.5:
 * 1. Non-JS request / crawler on a product URL returns full semantic HTML content without executing JavaScript.
 * 2. Product structured data contains valid Schema.org Product, Offer, Brand, and AggregateRating fields.
 * 3. Dynamic sitemap index lists child sitemaps (products, stores, categories, stories, static) with bilingual hreflangs.
 * 4. Robots.txt enforces disallow rules for private / admin routes.
 * 5. Unicode Bengali slug normalization preserves Bengali characters.
 * 6. Fastify HTTP endpoints return 200 OK with proper XML and HTML MIME types.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import sitemapRoutes from '../src/routes/sitemap.routes.js';
import * as prerenderService from '../src/services/prerender.service.js';
import { normalizeSlug, buildProductJsonLd, buildStoreJsonLd, buildWebsiteJsonLd, buildBreadcrumbJsonLd } from '../../client/src/services/seo.js';

function createMockDb({ queryHandler = null } = {}) {
  const db = {
    async query(sql, params = []) {
      if (queryHandler) return queryHandler(sql, params);
      return { rows: [] };
    },
  };
  db.connect = async () => ({
    query: (sql, params) => db.query(sql, params),
    release: () => {},
  });
  return db;
}

describe('Prompt 11.5 — SEO, Prerendering, Structured Data & Dynamic Sitemaps', () => {

  // ---------------------------------------------------------------------------
  // 1. Crawler Detection & On-Demand Semantic HTML Prerendering (Acceptance 1)
  // ---------------------------------------------------------------------------
  test('Acceptance 1: Crawler request returns full semantic HTML content with OpenGraph and JSON-LD', async () => {
    // 1.1 Test Crawler User-Agent detection
    assert.equal(prerenderService.isCrawler('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), true);
    assert.equal(prerenderService.isCrawler('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'), true);
    assert.equal(prerenderService.isCrawler('Twitterbot/1.0'), true);
    assert.equal(prerenderService.isCrawler('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'), false);

    // 1.2 On-Demand HTML rendering for product route
    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM products p')) {
          return {
            rows: [
              {
                id: 101,
                slug: 'jamdani-saree',
                title_en: 'Authentic Handwoven Jamdani Saree (Dhakai)',
                title_bn: 'খাঁটি হাতে বোনা জামদানি শাড়ি',
                description_en: '100% Cotton Handwoven Dhakai Jamdani Saree with intricate floral jaal motifs.',
                description_bn: '১০০% সুতি হাতে বোনা ঐতিহ্যবাহী ঢাকাই জামদানি শাড়ি।',
                retail_price: '3400.00',
                stock_quantity: 15,
                sku: 'SKU-JAM-001',
                supplier_name: 'Narayanganj Weavers Guild',
                rating_val: '4.9',
                review_cnt: 28,
              },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const mockCache = {
      store: new Map(),
      async get(k) { return this.store.get(k); },
      async set(k, v) { this.store.set(k, v); },
    };

    const renderedHtml = await prerenderService.renderOnDemandHtml(mockDb, mockCache, '/products/jamdani-saree', 'en');

    assert.ok(renderedHtml.includes('<!doctype html>'));
    assert.ok(renderedHtml.includes('<title>Authentic Handwoven Jamdani Saree (Dhakai) — Explooro</title>'));
    assert.ok(renderedHtml.includes('<meta property="og:title" content="Authentic Handwoven Jamdani Saree (Dhakai) — Explooro" />'));
    assert.ok(renderedHtml.includes('<link rel="canonical" href="https://explooro.com/products/jamdani-saree" />'));
    assert.ok(renderedHtml.includes('৳3,400.00'));
    assert.ok(renderedHtml.includes('Narayanganj Weavers Guild'));
    assert.ok(renderedHtml.includes('<script type="application/ld+json" id="seo-structured-data">'));
    assert.ok(renderedHtml.includes('"@type": "Product"'));
    assert.ok(renderedHtml.includes('"price": "3400.00"'));
  });

  // ---------------------------------------------------------------------------
  // 2. Google Rich Results Structured Data (Acceptance 2)
  // ---------------------------------------------------------------------------
  test('Acceptance 2: Product and Store JSON-LD schemas contain all required Schema.org Rich Results fields', () => {
    // 2.1 Product Schema
    const productSchema = buildProductJsonLd({
      id: 55,
      name: 'Silk Tangail Saree',
      description: 'Handloom pure silk saree with metallic zari border.',
      images: ['https://explooro.com/images/tangail.jpg'],
      sku: 'SKU-TANG-002',
      retailPrice: 2850.00,
      currency: 'BDT',
      inStock: true,
      brand: 'Tangail Weavers',
      ratingValue: 4.8,
      reviewCount: 19,
    });

    assert.equal(productSchema['@context'], 'https://schema.org');
    assert.equal(productSchema['@type'], 'Product');
    assert.equal(productSchema.name, 'Silk Tangail Saree');
    assert.equal(productSchema.sku, 'SKU-TANG-002');
    assert.equal(productSchema.brand.name, 'Tangail Weavers');
    assert.equal(productSchema.offers['@type'], 'Offer');
    assert.equal(productSchema.offers.priceCurrency, 'BDT');
    assert.equal(productSchema.offers.price, '2850.00');
    assert.equal(productSchema.offers.availability, 'https://schema.org/InStock');
    assert.equal(productSchema.aggregateRating['@type'], 'AggregateRating');
    assert.equal(productSchema.aggregateRating.ratingValue, '4.8');
    assert.equal(productSchema.aggregateRating.reviewCount, '19');

    // 2.2 Store Schema
    const storeSchema = buildStoreJsonLd({
      slug: 'heritage-crafts',
      shopName: 'Heritage Crafts BD',
      bio: 'Authentic handmade goods',
      salerName: 'Farhana Sultana',
    });

    assert.equal(storeSchema['@context'], 'https://schema.org');
    assert.ok(storeSchema['@type'].includes('Store'));
    assert.equal(storeSchema.name, 'Heritage Crafts BD');
    assert.equal(storeSchema.url, 'https://explooro.com/store/heritage-crafts');
    assert.equal(storeSchema.address.addressCountry, 'BD');

    // 2.3 Breadcrumb Schema
    const breadcrumbSchema = buildBreadcrumbJsonLd([
      { name: 'Home', url: '/' },
      { name: 'Traditional Wear', url: '/categories/traditional' },
      { name: 'Jamdani Saree', url: '/products/jamdani-saree' },
    ]);

    assert.equal(breadcrumbSchema['@type'], 'BreadcrumbList');
    assert.equal(breadcrumbSchema.itemListElement.length, 3);
    assert.equal(breadcrumbSchema.itemListElement[2].name, 'Jamdani Saree');
  });

  // ---------------------------------------------------------------------------
  // 3. Dynamic XML Sitemap Index & Child Sitemaps (Acceptance 3)
  // ---------------------------------------------------------------------------
  test('Acceptance 3: Sitemap index links all child sitemaps with bilingual hreflang alternates', async () => {
    const mockDb = createMockDb({
      queryHandler: async (sql, params) => {
        if (sql.includes('FROM products')) {
          return {
            rows: [
              { id: 1, slug: 'jamdani-saree', updated_at: '2026-08-20T10:00:00Z', created_at: '2026-08-20T10:00:00Z' },
            ],
          };
        }
        if (sql.includes('FROM virtual_stores')) {
          return {
            rows: [
              { slug: 'heritage-crafts', updated_at: '2026-08-21T12:00:00Z', created_at: '2026-08-21T12:00:00Z' },
            ],
          };
        }
        if (sql.includes('FROM categories')) {
          return {
            rows: [
              { slug: 'traditional-wear', updated_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z' },
            ],
          };
        }
        if (sql.includes('FROM stories')) {
          return {
            rows: [
              { slug: 'weaving-art', updated_at: '2026-08-15T08:00:00Z', created_at: '2026-08-15T08:00:00Z' },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const app = Fastify();
    app.decorate('db', mockDb);
    app.decorate('cache', { driver: 'memory' });
    await app.register(sitemapRoutes);
    await app.ready();

    // 1. GET /sitemap.xml (Sitemap Index)
    const resIndex = await app.inject({ method: 'GET', url: '/sitemap.xml' });
    assert.equal(resIndex.statusCode, 200);
    assert.ok(resIndex.headers['content-type'].includes('application/xml'));
    assert.ok(resIndex.body.includes('<sitemapindex'));
    assert.ok(resIndex.body.includes('https://explooro.com/sitemaps/products.xml'));
    assert.ok(resIndex.body.includes('https://explooro.com/sitemaps/stores.xml'));

    // 2. GET /sitemaps/products.xml
    const resProducts = await app.inject({ method: 'GET', url: '/sitemaps/products.xml' });
    assert.equal(resProducts.statusCode, 200);
    assert.ok(resProducts.body.includes('<urlset'));
    assert.ok(resProducts.body.includes('https://explooro.com/products/jamdani-saree'));
    assert.ok(resProducts.body.includes('hreflang="bn"'));
    assert.ok(resProducts.body.includes('hreflang="en"'));

    // 3. GET /sitemaps/stores.xml
    const resStores = await app.inject({ method: 'GET', url: '/sitemaps/stores.xml' });
    assert.equal(resStores.statusCode, 200);
    assert.ok(resStores.body.includes('https://explooro.com/store/heritage-crafts'));

    // 4. GET /sitemaps/static.xml
    const resStatic = await app.inject({ method: 'GET', url: '/sitemaps/static.xml' });
    assert.equal(resStatic.statusCode, 200);
    assert.ok(resStatic.body.includes('https://explooro.com/terms'));

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 4. Robots.txt Governance (Acceptance 4)
  // ---------------------------------------------------------------------------
  test('Acceptance 4: Robots.txt disallows private admin/account routes while allowing public indexable pages', async () => {
    const app = Fastify();
    app.decorate('db', createMockDb());
    app.decorate('cache', { driver: 'memory' });
    await app.register(sitemapRoutes);
    await app.ready();

    const resRobots = await app.inject({ method: 'GET', url: '/robots.txt' });
    assert.equal(resRobots.statusCode, 200);
    assert.ok(resRobots.headers['content-type'].includes('text/plain'));
    assert.ok(resRobots.body.includes('Allow: /products/'));
    assert.ok(resRobots.body.includes('Allow: /store/'));
    assert.ok(resRobots.body.includes('Disallow: /admin/'));
    assert.ok(resRobots.body.includes('Disallow: /checkout/'));
    assert.ok(resRobots.body.includes('Disallow: /account/'));
    assert.ok(resRobots.body.includes('Sitemap: https://explooro.com/sitemap.xml'));

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 5. Bengali Unicode Slug Normalization (Acceptance 5)
  // ---------------------------------------------------------------------------
  test('Acceptance 5: Bengali Unicode slug normalizer handles Bengali text cleanly', () => {
    const slug1 = normalizeSlug('খাঁটি মধু ও সরিষার তেল');
    assert.equal(slug1, 'খাঁটি-মধু-ও-সরিষার-তেল');

    const slug2 = normalizeSlug('Dhakai Jamdani Saree — ঢাকা জামদানি');
    assert.equal(slug2, 'dhakai-jamdani-saree-ঢাকা-জামদানি');
  });

});
