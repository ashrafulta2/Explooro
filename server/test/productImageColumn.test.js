/**
 * productImageColumn.test.js — `products` has no `primary_image_url` column.
 *
 * WHY: flash sales, return details and short-link analytics all selected
 * `p.primary_image_url`, which errors against real Postgres (the mocked db in
 * other tests never noticed). Product images live in product_images joined to
 * media_assets.storage_key; the service maps that key to a public URL.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import * as flashSaleService from '../src/services/flashSale.service.js';
import * as returnService from '../src/services/return.service.js';
import * as shortlinkService from '../src/services/shortlink.service.js';
import { getStorageDriver } from '../src/integrations/storage/index.js';

const KEY = 'products/42/primary.webp';

// Columns that do not exist on `products` (see migrations/006_catalog.sql).
const BAD_COLUMNS = /p\.primary_image_url|p\.title\b(?!_)|p\.name_(en|bn)/;

function assertPrimaryImageSubquery(sql) {
  assert.doesNotMatch(sql, BAD_COLUMNS);
  assert.match(sql, /FROM product_images/);
  assert.match(sql, /JOIN media_assets m ON m\.id = \w+\.media_id/);
  assert.match(sql, /ORDER BY \w+\.is_primary DESC, \w+\.display_order ASC/);
  assert.match(sql, /m\.storage_key/);
}

describe('primary product image lookup', () => {
  test('flash sales select the image via product_images and return a public URL', async () => {
    const seen = [];
    const db = {
      query: async (sql) => {
        seen.push(sql);
        if (!sql.includes('FROM flash_sales')) return { rows: [] };
        return {
          rows: [
            {
              id: 1,
              product_id: 42,
              product_title_en: 'Saree',
              product_image_key: KEY,
              allocated_qty: 10,
              sold_qty: 4,
              starts_at: new Date(Date.now() - 60_000),
              ends_at: new Date(Date.now() + 60_000),
            },
            {
              id: 2,
              product_id: 43,
              product_image_key: null,
              allocated_qty: 10,
              sold_qty: 0,
              starts_at: new Date(Date.now() + 60_000),
              ends_at: new Date(Date.now() + 120_000),
            },
          ],
        };
      },
    };
    const cache = { get: async () => 'true', set: async () => {} };

    const deals = await flashSaleService.getActiveAndUpcomingFlashSales(db, cache);

    assertPrimaryImageSubquery(seen.find((s) => s.includes('FROM flash_sales')));
    assert.equal(deals[0].product_image_url, getStorageDriver().getPublicUrl(KEY));
    assert.equal(deals[1].product_image_url, null);
    assert.ok(!('product_image_key' in deals[0]), 'internal storage key must not leak');
  });

  test('return details map each item image to a public URL', async () => {
    let itemSql = '';
    const db = {
      query: async (sql) => {
        if (sql.includes('FROM return_items')) {
          itemSql = sql;
          return { rows: [{ id: 5, product_id: 42, product_title: 'Saree', primary_image_key: KEY }] };
        }
        return { rows: [{ id: 9, ref: 'RET-1', evidence_urls_json: [] }] };
      },
    };

    const details = await returnService.getReturnDetails(db, 9);

    assertPrimaryImageSubquery(itemSql);
    assert.equal(details.items[0].primary_image_url, getStorageDriver().getPublicUrl(KEY));
    assert.ok(!('primary_image_key' in details.items[0]));
  });

  test('saler short links map the product image to a public URL', async () => {
    let linkSql = '';
    const db = {
      query: async (sql) => {
        linkSql = sql;
        return { rows: [{ id: 1, code: 'abc', product_id: 42, clicks_count: 0, conversions_count: 0, primary_image_key: KEY }] };
      },
    };

    const links = await shortlinkService.getSalerShortLinks(db, 7);

    assertPrimaryImageSubquery(linkSql);
    assert.equal(links[0].primary_image_url, getStorageDriver().getPublicUrl(KEY));
    assert.ok(!('primary_image_key' in links[0]));
  });
});
