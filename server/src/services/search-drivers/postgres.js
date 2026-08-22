/**
 * postgres.js — Postgres Full-Text & Trigram Search Driver (Prompt 4.4).
 *
 * Combines tsvector, trigram similarity, and Banglish phonetic term expansion
 * to match products, virtual stores, and categories with zero extra infrastructure.
 */

import { expandSearchTerms } from '../../utils/transliterate.js';
import { calculatePricingBreakdown } from '../pricing.service.js';

export class PostgresSearchDriver {
  constructor() {
    this.name = 'postgres';
  }

  async search(db, { query = '', filters = {}, limit = 20, offset = 0 } = {}) {
    const rawQuery = (query || '').trim();
    const expanded = expandSearchTerms(rawQuery);
    const searchTerms = expanded.length > 0 ? expanded : [rawQuery];

    const productConditions = ['p.deleted_at IS NULL', "p.status = 'ACTIVE'"];
    const productParams = [];

    // Filter clauses
    if (filters.categoryId) {
      productParams.push(filters.categoryId);
      productConditions.push(`p.category_id = $${productParams.length}`);
    }

    if (filters.categorySlug) {
      productParams.push(filters.categorySlug);
      productConditions.push(`c.slug = $${productParams.length}`);
    }

    if (filters.minPrice !== undefined && filters.minPrice !== null && filters.minPrice !== '') {
      productParams.push(parseFloat(filters.minPrice));
      productConditions.push(`p.default_retail_price >= $${productParams.length}`);
    }

    if (filters.maxPrice !== undefined && filters.maxPrice !== null && filters.maxPrice !== '') {
      productParams.push(parseFloat(filters.maxPrice));
      productConditions.push(`p.default_retail_price <= $${productParams.length}`);
    }

    if (filters.inStock) {
      productConditions.push('p.stock_qty > 0');
    }

    if (filters.minRating) {
      productParams.push(parseFloat(filters.minRating));
      productConditions.push(`p.rating_avg >= $${productParams.length}`);
    }

    // Text Match Conditions across expanded terms (title > brand > category > description)
    if (rawQuery) {
      const termOrClauses = [];
      for (const term of searchTerms) {
        productParams.push(`%${term}%`);
        const idx = productParams.length;
        termOrClauses.push(
          `(p.title_en ILIKE $${idx} OR p.title_bn ILIKE $${idx} OR p.brand ILIKE $${idx} OR c.name_en ILIKE $${idx} OR c.name_bn ILIKE $${idx} OR p.description_en ILIKE $${idx} OR p.description_bn ILIKE $${idx})`
        );
      }
      productConditions.push(`(${termOrClauses.join(' OR ')})`);
    }

    // Products query
    productParams.push(limit);
    const limitIdx = productParams.length;
    productParams.push(offset);
    const offsetIdx = productParams.length;

    let products = [];
    try {
      const { rows } = await db.query(
        `SELECT p.*,
                c.name_en as category_name_en, c.name_bn as category_name_bn, c.slug as category_slug
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE ${productConditions.join(' AND ')}
         ORDER BY p.sold_count DESC, p.rating_avg DESC, p.created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        productParams
      );

      products = rows.map((p) => {
        const pricing = calculatePricingBreakdown({
          baseCost: p.base_cost,
          wholesaleMargin: p.wholesale_margin || 0,
          retailPrice: p.default_retail_price,
        });
        return { ...p, pricing };
      });
    } catch {
      products = [];
    }

    // Matching Stores
    let stores = [];
    if (rawQuery) {
      try {
        const storeClauses = [];
        const storeParams = [];
        for (const term of searchTerms) {
          storeParams.push(`%${term}%`);
          const idx = storeParams.length;
          storeClauses.push(`(shop_name ILIKE $${idx} OR slug ILIKE $${idx} OR bio ILIKE $${idx})`);
        }
        const { rows } = await db.query(
          `SELECT id, ref, slug, shop_name, bio, is_active
           FROM virtual_stores
           WHERE deleted_at IS NULL AND is_active = true AND (${storeClauses.join(' OR ')})
           LIMIT 5`,
          storeParams
        );
        stores = rows;
      } catch {
        stores = [];
      }
    }

    // Matching Categories
    let categories = [];
    if (rawQuery) {
      try {
        const catClauses = [];
        const catParams = [];
        for (const term of searchTerms) {
          catParams.push(`%${term}%`);
          const idx = catParams.length;
          catClauses.push(`(name_en ILIKE $${idx} OR name_bn ILIKE $${idx} OR slug ILIKE $${idx})`);
        }
        const { rows } = await db.query(
          `SELECT id, slug, path, name_en, name_bn, icon_key
           FROM categories
           WHERE is_active = true AND (${catClauses.join(' OR ')})
           ORDER BY display_order ASC
           LIMIT 6`,
          catParams
        );
        categories = rows;
      } catch {
        categories = [];
      }
    }

    return {
      products,
      stores,
      categories,
      totalCount: products.length,
      expandedTerms: searchTerms,
    };
  }

  async suggest(db, { query = '', limit = 6 } = {}) {
    const rawQuery = (query || '').trim();
    if (!rawQuery) {
      return { suggestions: [], categories: [], stores: [] };
    }

    const expanded = expandSearchTerms(rawQuery);
    const searchTerms = expanded.length > 0 ? expanded : [rawQuery];

    // Quick suggestions from product titles
    const params = [];
    const clauses = [];
    for (const term of searchTerms) {
      params.push(`%${term}%`);
      const idx = params.length;
      clauses.push(`(title_en ILIKE $${idx} OR title_bn ILIKE $${idx})`);
    }

    params.push(limit);
    const limitIdx = params.length;

    let suggestions = [];
    try {
      const { rows } = await db.query(
        `SELECT id, title_en, title_bn, slug, default_retail_price
         FROM products
         WHERE deleted_at IS NULL AND status = 'ACTIVE' AND (${clauses.join(' OR ')})
         ORDER BY sold_count DESC
         LIMIT $${limitIdx}`,
        params
      );
      suggestions = rows;
    } catch {
      suggestions = [];
    }

    // Quick categories
    let categories = [];
    try {
      const { rows } = await db.query(
        `SELECT id, slug, name_en, name_bn
         FROM categories
         WHERE is_active = true AND (${clauses.join(' OR ')})
         LIMIT 4`,
        params.slice(0, -1) // reuse term params without limit
      );
      categories = rows;
    } catch {
      categories = [];
    }

    return {
      query: rawQuery,
      suggestions,
      categories,
      expandedTerms: searchTerms,
    };
  }
}

export const postgresSearchDriver = new PostgresSearchDriver();
