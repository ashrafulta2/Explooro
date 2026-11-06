/**
 * productVisibility.service.ts — what of a product row a given viewer may read.
 *
 * Catalog queries select `p.*` and every catalog response used to send it whole, so a logged-out
 * shopper could read the supplier's cost (`base_cost`), the platform's margin on top of it, the
 * per-unit partner pool share and the full pricing breakdown. Those belong to the supplier who owns
 * the product and to admins; everyone else (shoppers, Explooro partners, guests) gets the retail price,
 * any deal price, stock, variants, images and supplier info.
 *
 * WHY a deny list for the row and an allow list for `pricing`: catalog rows carry 30-odd joined
 * display columns (supplier name, flash-sale fields, ranking scores) that differ by endpoint, so
 * listing what to keep there would silently drop a field some card reads. The pricing breakdown is
 * one fixed object whose only public figure is the retail price, so it is cut down to that.
 * `server/test/productVisibility.test.js` fails if a new cost field reaches a public response.
 */

/** Cost and margin fields only the owning supplier and admins may read. */
export const PRIVATE_PRODUCT_FIELDS = [
  'base_cost',
  'wholesale_margin',
  'wholesale_cost',
  // The mock sourcing card's name for the supplier's cost; listed so the two lists stay equal.
  'wholesale_price',
  'partner_profit',
  'supplier_price',
  // Derived from cost (cost + the platform's minimum profit), so it reveals the cost.
  'min_retail_price',
  'margin_pct',
  // getProductById joins the supplier's login phone; the public supplier card has its own fields.
  'supplier_phone',
  // The sourcing card's per-product pool figures (pool_contribution, margin_pct, ...).
  'sourcing_opportunity',
  'search_vector',
];

/** The part of calculatePricingBreakdown's result a shopper may read. */
export const PUBLIC_PRICING_FIELDS = ['retail_price', 'default_retail_price'];

function rolesOf(viewer) {
  if (!viewer) return [];
  return viewer.roles || (viewer.role ? [viewer.role] : []);
}

/** True for admins and for the supplier who owns this product. */
export function canSeeProductCosts(product, viewer) {
  if (!viewer || !product) return false;
  const roles = rolesOf(viewer);
  if (roles.includes('admin') || roles.includes('super_admin')) return true;
  // supplier_id is a BIGINT, which node-postgres returns as a string.
  return viewer.id != null && product.supplier_id != null && Number(product.supplier_id) === Number(viewer.id);
}

/** The product as `viewer` may see it; `viewer` is req.user, or null for a guest. */
export function productForViewer(product, viewer = null) {
  if (!product || typeof product !== 'object' || canSeeProductCosts(product, viewer)) return product;
  const out = { ...product };
  for (const key of PRIVATE_PRODUCT_FIELDS) delete out[key];
  if (product.pricing && typeof product.pricing === 'object') {
    const pricing = {};
    for (const key of PUBLIC_PRICING_FIELDS) {
      if (product.pricing[key] !== undefined) pricing[key] = product.pricing[key];
    }
    out.pricing = pricing;
  }
  return out;
}

export function productsForViewer(products, viewer = null) {
  return Array.isArray(products) ? products.map((p) => productForViewer(p, viewer)) : products;
}
