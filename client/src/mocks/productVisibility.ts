/**
 * productVisibility.ts — the mock driver's copy of server/src/services/productVisibility.service.ts:
 * only the owning supplier and admins read a product's cost and margin fields; shoppers, shop
 * partners and guests get the retail price, deal price, stock, variants, images and supplier info.
 *
 * No imports on purpose: server/test/productVisibility.test.js imports this file and fails if its
 * lists drift from the server's.
 */

export const PRIVATE_PRODUCT_FIELDS = [
  'base_cost',
  'wholesale_margin',
  'wholesale_cost',
  'wholesale_price',
  'partner_profit',
  'supplier_price',
  'min_retail_price',
  'margin_pct',
  'supplier_phone',
  'sourcing_opportunity',
  'search_vector',
];

export const PUBLIC_PRICING_FIELDS = ['retail_price', 'default_retail_price'];

interface Viewer {
  id?: number | string | null;
  roles?: string[];
}

type ProductRow = Record<string, any>;

export function canSeeProductCosts(product: ProductRow, viewer: Viewer | null | undefined): boolean {
  if (!viewer || !product) return false;
  const roles = viewer.roles || [];
  if (roles.includes('admin') || roles.includes('super_admin')) return true;
  if (product.supplier_id != null) return viewer.id != null && Number(product.supplier_id) === Number(viewer.id);
  // WHY: the fixtures carry no supplier_id and the mock has one demo supplier, so a supplier owns
  // every fixture row. Live, the server compares supplier_id.
  return roles.includes('supplier');
}

export function productForViewer<T extends ProductRow>(product: T, viewer: Viewer | null | undefined): T {
  if (!product || typeof product !== 'object' || canSeeProductCosts(product, viewer)) return product;
  const out: ProductRow = { ...product };
  for (const key of PRIVATE_PRODUCT_FIELDS) delete out[key];
  if (product.pricing && typeof product.pricing === 'object') {
    const pricing: ProductRow = {};
    for (const key of PUBLIC_PRICING_FIELDS) {
      if (product.pricing[key] !== undefined) pricing[key] = product.pricing[key];
    }
    out.pricing = pricing;
  }
  return out as T;
}
