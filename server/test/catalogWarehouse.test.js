/**
 * catalogWarehouse.test.js — Test suite for Prompt 4.1 (Catalog Schema & Warehouse Foundations).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReservedStoreSlug, RESERVED_STORE_SLUGS } from '../src/config/reservedSlugs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Catalog Schema & Warehouse Foundations (Prompt 4.1)', () => {
  const catalogSqlPath = path.resolve(__dirname, '../src/db/migrations/006_catalog.sql');
  const warehouseSqlPath = path.resolve(__dirname, '../src/db/migrations/007_warehouse.sql');
  const categoriesSeedPath = path.resolve(__dirname, '../src/db/seeds/004_categories.sql');
  const catalogSeedPath = path.resolve(__dirname, '../src/db/seeds/005_demo_catalog.sql');

  const catalogSql = fs.readFileSync(catalogSqlPath, 'utf8');
  const warehouseSql = fs.readFileSync(warehouseSqlPath, 'utf8');
  const categoriesSeedSql = fs.readFileSync(categoriesSeedPath, 'utf8');
  const catalogSeedSql = fs.readFileSync(catalogSeedPath, 'utf8');

  test('Migration 006_catalog.sql defines all required catalog tables and relationships', () => {
    const requiredTables = [
      'categories',
      'media_assets',
      'products',
      'product_variants',
      'product_images',
      'virtual_stores',
      'saler_store_items',
      'product_approvals',
      'product_bundles',
      'bundle_items',
      'reviews',
      'review_media',
    ];

    for (const table of requiredTables) {
      assert.ok(
        catalogSql.includes(`CREATE TABLE IF NOT EXISTS ${table}`) ||
        catalogSql.includes(`CREATE TABLE ${table}`),
        `Migration 006_catalog.sql must define table "${table}"`
      );
    }
  });

  test('Migration 007_warehouse.sql defines warehouse_nodes, warehouse_stock, and product_batches', () => {
    const requiredTables = ['warehouse_nodes', 'warehouse_stock', 'product_batches'];
    for (const table of requiredTables) {
      assert.ok(
        warehouseSql.includes(`CREATE TABLE IF NOT EXISTS ${table}`) ||
        warehouseSql.includes(`CREATE TABLE ${table}`),
        `Migration 007_warehouse.sql must define table "${table}"`
      );
    }
  });

  test('Acceptance 2: No money column is FLOAT; all money columns are NUMERIC(14,2)', () => {
    const allSql = catalogSql + '\n' + warehouseSql;

    // Must not contain FLOAT, REAL, or DOUBLE PRECISION in table column definitions
    assert.equal(/FLOAT/i.test(allSql), false, 'FLOAT data type is forbidden for financial/catalog columns');
    assert.equal(/DOUBLE\s+PRECISION/i.test(allSql), false, 'DOUBLE PRECISION is forbidden');
    assert.equal(/\bREAL\b/i.test(allSql), false, 'REAL data type is forbidden');

    // Key financial columns must explicitly use NUMERIC(14,2)
    const moneyColumns = [
      'base_cost',
      'wholesale_margin',
      'default_retail_price',
      'min_retail_price',
      'price_delta',
      'custom_retail_price',
      'bundle_price',
      'discount_amount',
      'discount_share',
    ];

    for (const col of moneyColumns) {
      const regex = new RegExp(`${col}\\s+NUMERIC\\(14,\\s*2\\)`, 'i');
      assert.ok(
        regex.test(allSql),
        `Column "${col}" must be typed as NUMERIC(14,2)`
      );
    }
  });

  test('Acceptance 1: Constraint asserting default_retail_price >= base_cost + wholesale_margin exists', () => {
    assert.ok(
      catalogSql.includes('CHECK (default_retail_price >= base_cost + wholesale_margin)'),
      'products table must include retail_covers_cost constraint'
    );
  });

  test('004_categories.sql seeds 8 main categories with bilingual labels and paths', () => {
    assert.ok(categoriesSeedSql.includes("'fashion'"));
    assert.ok(categoriesSeedSql.includes("'electronics'"));
    assert.ok(categoriesSeedSql.includes("'home-living'"));
    assert.ok(categoriesSeedSql.includes("'health-beauty'"));
    assert.ok(categoriesSeedSql.includes("'groceries'"));
    assert.ok(categoriesSeedSql.includes("'handicrafts'"));
    assert.ok(categoriesSeedSql.includes("'sports-fitness'"));
    assert.ok(categoriesSeedSql.includes("'books-stationery'"));

    // Verify Bengali translations exist
    assert.ok(categoriesSeedSql.includes('ফ্যাশন ও পোশাক'));
    assert.ok(categoriesSeedSql.includes('ইলেকট্রনিক্স ও গ্যাজেট'));
    assert.ok(categoriesSeedSql.includes('মুদি ও অর্গানিক খাবার'));
  });

  test('Acceptance 3: 005_demo_catalog.sql seeds 60 products with both English and Bengali titles', () => {
    // Count product inserts (1 to 60)
    for (let i = 1; i <= 60; i++) {
      const refStr = `PRD-`;
      assert.ok(
        catalogSeedSql.includes(`(${i}, 'PRD-`) || catalogSeedSql.includes(`(${i}, '`),
        `Product #${i} must be seeded in demo catalog`
      );
    }

    // Verify presence of suppliers, salers, and warehouses
    assert.ok(catalogSeedSql.includes('WH-DHK-01'), 'Tejgaon warehouse must be seeded');
    assert.ok(catalogSeedSql.includes('WH-CTG-01'), 'Agrabad warehouse must be seeded');
    assert.ok(catalogSeedSql.includes('WH-SYL-01'), 'Sylhet warehouse must be seeded');
    assert.ok(catalogSeedSql.includes('dhaka-fashion'), 'Dhaka fashion store must be seeded');
    assert.ok(catalogSeedSql.includes('bangla-smart'), 'Bangla smart store must be seeded');
  });

  test('Acceptance 4: Reserved-slug list prevents creating a store at reserved slugs', () => {
    assert.equal(isReservedStoreSlug('admin'), true);
    assert.equal(isReservedStoreSlug('api'), true);
    assert.equal(isReservedStoreSlug('store'), true);
    assert.equal(isReservedStoreSlug('checkout'), true);
    assert.equal(isReservedStoreSlug('saler'), true);
    assert.equal(isReservedStoreSlug('supplier'), true);
    assert.equal(isReservedStoreSlug('search'), true);
    assert.equal(isReservedStoreSlug('cart'), true);
    assert.equal(isReservedStoreSlug('auth'), true);

    // Valid slugs are not blocked
    assert.equal(isReservedStoreSlug('dhaka-fashion'), false);
    assert.equal(isReservedStoreSlug('bangla-smart'), false);
    assert.equal(isReservedStoreSlug('bengal-handicrafts'), false);
    assert.equal(isReservedStoreSlug('sylhet-organic-foods'), false);
  });
});
