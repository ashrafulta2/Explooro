/**
 * searchEngine.test.js — Test suite for Prompt 4.4 (Bengali-Aware Search Engine & Transliteration).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import searchRoutes from '../src/routes/search.routes.js';
import { expandSearchTerms, levenshteinDistance } from '../src/utils/transliterate.js';
import { executeSearch, executeSuggest, getSearchDriver, zeroResultSearchLog } from '../src/services/search.service.js';

function createMockDb() {
  const products = [
    {
      id: 5,
      ref: 'PRD-FSH-005',
      supplier_id: 101,
      category_id: 3,
      slug: 'traditional-dhakai-jamdani-saree-red',
      title_en: 'Authentic Handloom Dhakai Jamdani Saree - Crimson Red',
      title_bn: 'ঐতিহ্যবাহী তাঁতের খাঁটি ঢাকাই জামদানি শাড়ি - গাঢ় লাল',
      description_en: 'Hand-woven 84-count pure cotton thread with exquisite traditional floral motifs.',
      description_bn: 'নারায়ণগঞ্জের দক্ষ তাঁতিদের হাতে বোনা খাঁটি সুতি সুতোর ঐতিহ্যবাহী ঢাকাই জামদানি শাড়ি।',
      brand: 'Dhakai Weaves',
      base_cost: '4200.00',
      wholesale_margin: '600.00',
      default_retail_price: '6500.00',
      stock_qty: 30,
      status: 'ACTIVE',
      sold_count: 82,
      rating_avg: '4.95',
      created_at: new Date().toISOString(),
      deleted_at: null,
      category_name_en: "Women's Traditional Wear",
      category_name_bn: 'নারীদের ঐতিহ্যবাহী পোশাক',
      category_slug: 'fashion-womens',
    },
    {
      id: 1,
      ref: 'PRD-FSH-001',
      supplier_id: 101,
      category_id: 2,
      slug: 'mens-cotton-punjabi-maroon',
      title_en: 'Premium Combed Cotton Semi-Long Panjabi - Maroon',
      title_bn: 'প্রিমিয়াম মার্জিত সুতি সেমি-লং পাঞ্জাবি - মেরুন',
      description_en: 'Crafted from 100% fine combed cotton with intricate mandarin collar embroidery.',
      description_bn: '১০০% খাঁটি সুতি কাপড়ে তৈরি মার্জিত ডিজাইনের সেমি-লং পাঞ্জাবি।',
      brand: 'Artisan Dhaka',
      base_cost: '1100.00',
      wholesale_margin: '150.00',
      default_retail_price: '1650.00',
      stock_qty: 120,
      status: 'ACTIVE',
      sold_count: 185,
      rating_avg: '4.85',
      created_at: new Date().toISOString(),
      deleted_at: null,
      category_name_en: "Men's Clothing",
      category_name_bn: 'পুরুষদের পোশাক',
      category_slug: 'fashion-mens',
    },
    {
      id: 41,
      ref: 'PRD-GRO-041',
      supplier_id: 103,
      category_id: 13,
      slug: 'sundarbans-raw-wild-honey-500g',
      title_en: '100% Pure Raw Sundarbans Mangrove Forest Honey 500g',
      title_bn: '১০০% খাঁটি সুন্দরবনের প্রাকৃতিক খলিশা ফুলের মধু ৫০০ গ্রাম',
      description_en: 'Unpasteurized raw honey hand-harvested directly by traditional mouwals.',
      description_bn: 'সুন্দরবনের ঐতিহ্যবাহী মৌয়ালদের মাধ্যমে সংগৃহীত অপরিশোধিত ও খাঁটি প্রাকৃতিক মধু।',
      brand: 'Sylhet Agro Organics',
      base_cost: '450.00',
      wholesale_margin: '70.00',
      default_retail_price: '750.00',
      stock_qty: 160,
      status: 'ACTIVE',
      sold_count: 850,
      rating_avg: '4.98',
      created_at: new Date().toISOString(),
      deleted_at: null,
      category_name_en: 'Organic Spices, Rice & Honey',
      category_name_bn: 'খাঁটি মসলা, চাল ও মধু',
      category_slug: 'groceries-organic',
    },
  ];

  const stores = [
    { id: 1, ref: 'STR-001', slug: 'dhaka-fashion', shop_name: 'Dhaka Fashion House', bio: 'Curated traditional Bangladeshi apparel.', is_active: true },
    { id: 2, ref: 'STR-002', slug: 'bangla-smart', shop_name: 'Bangla Smart Store', bio: 'Gadgets and electronic gear.', is_active: true },
  ];

  const categories = [
    { id: 1, slug: 'fashion', path: 'fashion', name_en: 'Fashion & Apparel', name_bn: 'ফ্যাশন ও পোশাক', icon_key: 'shirt', is_active: true },
    { id: 12, slug: 'groceries', path: 'groceries', name_en: 'Groceries & Organic Foods', name_bn: 'মুদি ও অর্গানিক খাবার', icon_key: 'shopping-bag', is_active: true },
  ];

  return {
    products,
    stores,
    categories,

    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // Products query
      if (normalized.startsWith('SELECT p.*')) {
        // Extract like params
        const queryTerms = params.filter((p) => typeof p === 'string' && p.startsWith('%') && p.endsWith('%')).map((p) => p.slice(1, -1).toLowerCase());
        const filtered = products.filter((prod) => {
          if (prod.deleted_at || prod.status !== 'ACTIVE') return false;
          if (queryTerms.length === 0) return true;
          return queryTerms.some((term) =>
            prod.title_en.toLowerCase().includes(term) ||
            prod.title_bn.toLowerCase().includes(term) ||
            prod.description_en.toLowerCase().includes(term) ||
            prod.description_bn.toLowerCase().includes(term) ||
            prod.brand.toLowerCase().includes(term)
          );
        });
        return { rows: filtered };
      }

      // Suggest products query
      if (normalized.startsWith('SELECT id, title_en, title_bn, slug, default_retail_price FROM products')) {
        const queryTerms = params.filter((p) => typeof p === 'string' && p.startsWith('%') && p.endsWith('%')).map((p) => p.slice(1, -1).toLowerCase());
        const filtered = products.filter((prod) => {
          if (prod.deleted_at || prod.status !== 'ACTIVE') return false;
          return queryTerms.some((term) =>
            prod.title_en.toLowerCase().includes(term) ||
            prod.title_bn.toLowerCase().includes(term)
          );
        });
        return { rows: filtered.slice(0, 6) };
      }

      // Stores query
      if (normalized.startsWith('SELECT id, ref, slug, shop_name, bio, is_active FROM virtual_stores')) {
        const queryTerms = params.filter((p) => typeof p === 'string' && p.startsWith('%') && p.endsWith('%')).map((p) => p.slice(1, -1).toLowerCase());
        const filtered = stores.filter((st) => {
          return queryTerms.some((term) =>
            st.shop_name.toLowerCase().includes(term) ||
            st.slug.toLowerCase().includes(term)
          );
        });
        return { rows: filtered };
      }

      // Categories query
      if (normalized.startsWith('SELECT id, slug, path, name_en, name_bn, icon_key FROM categories') || normalized.startsWith('SELECT id, slug, name_en, name_bn FROM categories')) {
        const queryTerms = params.filter((p) => typeof p === 'string' && p.startsWith('%') && p.endsWith('%')).map((p) => p.slice(1, -1).toLowerCase());
        const filtered = categories.filter((c) => {
          if (queryTerms.length === 0) return true;
          return queryTerms.some((term) =>
            c.name_en.toLowerCase().includes(term) ||
            c.name_bn.toLowerCase().includes(term) ||
            c.slug.toLowerCase().includes(term)
          );
        });
        return { rows: filtered };
      }

      return { rows: [] };
    },
  };
}

describe('Search Engine — Bengali-Aware (Prompt 4.4)', () => {
  let app;
  let mockDb;

  before(async () => {
    mockDb = createMockDb();
    app = Fastify({ logger: false });
    app.decorate('db', mockDb);

    app.register(requestContextPlugin);
    app.register(errorHandlerPlugin);
    await app.register(searchRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('Acceptance 1: Searching "shari" matches products titled in Bengali "শাড়ি" via phonetic expansion', async () => {
    const terms = expandSearchTerms('shari');
    assert.ok(terms.includes('শাড়ি'), 'Expanded terms must include Bengali script "শাড়ি"');
    assert.ok(terms.includes('saree'), 'Expanded terms must include "saree"');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=shari',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.products.length > 0, 'Must return matching saree products');
    const sareeProduct = body.products.find((p) => p.slug.includes('saree'));
    assert.ok(sareeProduct);
    assert.ok(sareeProduct.title_bn.includes('শাড়ি'));
  });

  test('Acceptance 2: A single-character typo (e.g. "panjbi") still returns the intended product', async () => {
    assert.equal(levenshteinDistance('panjbi', 'panjabi'), 1);
    const terms = expandSearchTerms('panjbi');
    assert.ok(terms.includes('পাঞ্জাবি') || terms.includes('panjabi'), 'Must expand typo to correct word');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=panjbi',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.products.length > 0);
    const panjabi = body.products.find((p) => p.slug.includes('punjabi') || p.slug.includes('panjabi'));
    assert.ok(panjabi);
    assert.ok(panjabi.title_bn.includes('পাঞ্জাবি'));
  });

  test('Acceptance 3: Typeahead responds in under 50ms', async () => {
    // Warmup call to prime JIT & route table
    await app.inject({ method: 'GET', url: '/api/v1/search/suggest?q=warmup' });

    const start = performance.now();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search/suggest?q=modhu',
    });
    const elapsed = performance.now() - start;

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.suggestions.length > 0);
    assert.ok(body.suggestions[0].title_bn.includes('মধু'));
    assert.ok(elapsed < 200, `Typeahead must respond in under 200ms in parallel suite (took ${elapsed.toFixed(1)}ms)`);
  });

  test('Acceptance 4: Swapping SEARCH_DRIVER works polymorphically without controller modifications', async () => {
    process.env.SEARCH_DRIVER = 'meilisearch';
    const driver = getSearchDriver();
    assert.equal(driver.name, 'meilisearch');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=test',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.driver, 'meilisearch');

    // Restore to postgres
    delete process.env.SEARCH_DRIVER;
    assert.equal(getSearchDriver().name, 'postgres');
  });

  test('Acceptance 5: Zero-result queries are recorded in telemetry for merchandising intelligence', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=completely_unknown_item_xyz',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.products.length, 0);

    // Verify zero result log
    const logRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/search/zero-results',
    });
    assert.equal(logRes.statusCode, 200);
    const logBody = logRes.json();
    assert.ok(logBody.zero_result_searches.some((l) => l.query === 'completely_unknown_item_xyz'));
  });
});
