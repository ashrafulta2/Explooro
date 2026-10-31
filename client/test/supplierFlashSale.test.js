// A supplier's own flash sale (migration 096): the client side. The server rules are tested in
// server/test/supplierFlashSale.test.js; this keeps the mock, the nav, the route and both locales
// in step with them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import handlers, { listSupplierFundedMockDeals } from '../src/mocks/handlers/supplierFlashSale.ts';
import { RULE_LIMITS, DEFAULT_RULES } from '../../server/src/services/supplierFlashSale.service.ts';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const route = (method, p) => handlers.find((h) => h.method === method && h.path === p).handler;

test('the mock serves the server\'s limits and defaults', () => {
  const res = route('GET', '/admin/growth/campaigns/flash-sales/supplier-rules')({});
  assert.deepEqual(res.body.limits, { ...RULE_LIMITS });
  const { updated_at, ...rules } = res.body.rules;
  assert.deepEqual(rules, { ...DEFAULT_RULES });
});

test('mock quote: the supplier funds the discount, platform + partner keep their share', () => {
  const overview = route('GET', '/supplier/flash-sales')({ query: {} }).body;
  const product = overview.products.find((p) => p.eligible);
  assert.ok(product, 'the demo supplier has an eligible product');
  const regular = Number(product.default_retail_price);
  const at = (price) => route('GET', '/supplier/flash-sales/quote')({ query: { product_id: product.id, discount_price: price } }).body;
  const full = at(regular - 1);
  const deep = at(Math.round(regular * 0.8));
  assert.equal(full.pricing.partner_share + full.pricing.platform_share, deep.pricing.partner_share + deep.pricing.platform_share);
  assert.ok(Math.abs(deep.pricing.supplier_payout - (deep.pricing.regular_supplier_payout - deep.pricing.supplier_funded)) < 0.011);
  assert.equal(deep.problem, null);
  assert.equal(at(Math.round(regular * 0.3)).problem.details.reason, 'DISCOUNT_TOO_DEEP');
});

test('mock: a product re-priced recently cannot be discounted yet', () => {
  const overview = route('GET', '/supplier/flash-sales')({ query: { limit: 50 } }).body;
  const fresh = overview.products.find((p) => !p.eligible && p.live_flash_sale_id == null);
  assert.ok(fresh, 'the demo has a product inside its listing window');
  const quote = route('GET', '/supplier/flash-sales/quote')({ query: { product_id: fresh.id, discount_price: Number(fresh.default_retail_price) - 10 } }).body;
  assert.equal(quote.problem.details.reason, 'LISTING_TOO_NEW');
});

test('mock: start and stop a deal; the admin list sees it', () => {
  const overview = route('GET', '/supplier/flash-sales')({ query: {} }).body;
  const product = overview.products.find((p) => p.eligible);
  const created = route('POST', '/supplier/flash-sales')({
    body: { product_id: product.id, discount_price: Number(product.default_retail_price) - 10, allocated_qty: 1, per_user_limit: 1, ends_at: new Date(Date.now() + 3600_000).toISOString() },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.flash_sale.funded_by, 'SUPPLIER');
  assert.ok(listSupplierFundedMockDeals().some((d) => d.id === created.body.flash_sale.id));
  const stopped = route('POST', '/supplier/flash-sales/:id/stop')({ params: { id: String(created.body.flash_sale.id) } });
  assert.equal(stopped.body.flash_sale.status, 'CANCELLED');
});

test('nav guard equals route guard (permission AND module)', () => {
  const nav = read('src/config/navigation.ts').split('\n').find((l) => l.includes("key: 'supplier.flash_sales'"));
  assert.match(nav, /permission: 'growth\.flash_sale\.manage_own'/);
  assert.match(nav, /module: 'flash_sale'/);
  const main = read('src/main.ts');
  const at = main.indexOf("path: '/supplier/flash-sales'");
  const block = main.slice(at, main.indexOf('},', at));
  assert.match(block, /permission: 'growth\.flash_sale\.manage_own'/);
  assert.match(block, /module: 'flash_sale'/);
});

test('every supplier_flash / admin_flash_rules key used is in both locales', () => {
  const en = JSON.parse(read('src/locales/en.json'));
  const bn = JSON.parse(read('src/locales/bn.json'));
  const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const src = read('src/pages/supplier/SupplierFlashSalesPage.ts') + read('src/components/admin/SupplierFlashRulesCard.ts') + read('src/pages/admin/CampaignManagerPage.ts');
  const keys = new Set([...src.matchAll(/t\('((?:supplier_flash|admin_flash_rules)\.[a-z_.]+)'/g)].map((m) => m[1]));
  // Built from a variable part: the status, column and field names.
  for (const s of ['ACTIVE', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'PAUSED']) keys.add(`supplier_flash.status.${s}`);
  for (const f of Object.keys(RULE_LIMITS)) keys.add(`admin_flash_rules.field.${f}`);
  keys.add('nav.supplier.flash_sales');
  assert.ok(keys.size > 30);
  for (const key of keys) {
    assert.equal(typeof get(en, key), 'string', `en.json is missing ${key}`);
    assert.equal(typeof get(bn, key), 'string', `bn.json is missing ${key}`);
  }
});
