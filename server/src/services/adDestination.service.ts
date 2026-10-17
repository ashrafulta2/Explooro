/**
 * adDestination.service.ts — which catalog product an ad may promote, and where its click lands.
 *
 * Two kinds of advertiser buy the same formats, and they own products differently:
 *   - a shop partner sells a product through their storefront (an active `saler_store_items` row);
 *   - a supplier owns the product itself (`products.supplier_id`).
 *
 * The click destination follows from that, and the server alone decides it:
 *   - shop partner → `/product/:id?store=<slug>`. The client records `store` as a STORE touch, so the
 *     sale credits the partner who paid for the ad (attribution.service.ts still checks they sell it).
 *   - supplier     → `/product/:id`, the plain product page. A supplier has no storefront; the partner
 *     share goes to whoever the shopper's last touch names, or stays with the platform.
 * A format without a product sends a shop partner's ad to `/store/<slug>`, and anyone else's to the
 * internal path they named, or the home page.
 *
 * WHY the server builds the URL instead of accepting the client's: a client-chosen destination would
 * let a partner pay for an ad that sends shoppers to someone else's store, or off the platform.
 */

import { AppError } from '../plugins/errorHandler.ts';

// The picker is a plain list; a page past this is reached with `offset`.
export const LIST_LIMITS = Object.freeze({ defaultLimit: 100, maxLimit: 200 });

export const SOURCE = Object.freeze({ STORE: 'STORE', OWN: 'OWN' });

/** The landing path for a promoted product. `storeSlug` is set only for a shop partner's ad. */
export function productDestination(productId: number, storeSlug: string | null = null): string {
  const base = `/product/${Number(productId)}`;
  return storeSlug ? `${base}?store=${encodeURIComponent(storeSlug)}` : base;
}

/** A shop partner's storefront page. */
export function storeDestination(storeSlug: string): string {
  return `/store/${encodeURIComponent(storeSlug)}`;
}

/**
 * The given destination when it is a path on this site, else null. WHY: an advertiser without a store
 * (a supplier) may still name a landing page, but never another origin — `//host` and `/\host` are
 * protocol-relative in browsers, so both are refused along with any scheme.
 */
export function safeInternalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;
  if (path.length > 300 || /[\s<>"]/.test(path)) return null;
  return path;
}

/**
 * Resolves the product and click destination of a new ad's creative. Throws when the format needs a
 * product and none was picked, or when the advertiser neither sells nor owns the one they picked.
 * Staff buying on someone's behalf (`isPrivileged`) skip the ownership check only.
 */
export async function resolveCreativeTarget(
  db: any,
  { userId, adProduct, productId = null, destinationUrl = null, isPrivileged = false }:
    { userId: number; adProduct: any; productId?: any; destinationUrl?: string | null; isPrivileged?: boolean }
): Promise<{ productId: number | null; destinationUrl: string }> {
  const id = productId ? Number(productId) : null;

  if (!id) {
    if (adProduct.requires_product) {
      throw new AppError(
        'PRODUCT_REQUIRED',
        'Pick the product this ad should promote.',
        'এই বিজ্ঞাপনে কোন পণ্য প্রচার করবেন তা বেছে নিন।'
      );
    }
    // A format without a product (spotlight, banner, storefront boost, live, push) promotes the
    // advertiser, so a shop partner's lands on their storefront, which also records the STORE touch.
    const { rows: ownStore } = await db.query(
      `SELECT slug FROM virtual_stores
       WHERE saler_id = $1 AND is_active AND deleted_at IS NULL
       ORDER BY id LIMIT 1`,
      [userId]
    );
    if (ownStore[0]) {
      return { productId: null, destinationUrl: storeDestination(ownStore[0].slug) };
    }
    return { productId: null, destinationUrl: safeInternalPath(destinationUrl) || '/' };
  }

  const { rows } = await db.query(
    `SELECT id, supplier_id, status FROM products WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const product = rows[0];
  if (!product) {
    throw new AppError('NOT_FOUND', 'Product not found.', 'পণ্যটি পাওয়া যায়নি।');
  }
  if (product.status !== 'ACTIVE') {
    throw new AppError(
      'AD_PRODUCT_NOT_SELLABLE',
      'This product is not on sale, so it cannot be advertised.',
      'পণ্যটি এখন বিক্রিতে নেই, তাই এর বিজ্ঞাপন দেওয়া যাবে না।'
    );
  }

  // WHY the storefront first: an account that both supplies and resells a product earns the partner
  // share only if the click carries its store, so the store link is the one that pays it in full.
  const { rows: storeRows } = await db.query(
    `SELECT vs.slug
     FROM saler_store_items si
     JOIN virtual_stores vs ON vs.id = si.store_id
     WHERE si.saler_id = $1 AND si.product_id = $2 AND si.is_active
       AND vs.is_active AND vs.deleted_at IS NULL
     LIMIT 1`,
    [userId, id]
  );
  if (storeRows[0]) {
    return { productId: id, destinationUrl: productDestination(id, storeRows[0].slug) };
  }

  if (String(product.supplier_id) === String(userId) || isPrivileged) {
    return { productId: id, destinationUrl: productDestination(id) };
  }

  throw new AppError(
    'AD_PRODUCT_NOT_OWNED',
    'You can only advertise products in your store, or products you supply.',
    'আপনি শুধু নিজের স্টোরের পণ্য বা নিজের সাপ্লাই করা পণ্যের বিজ্ঞাপন দিতে পারবেন।'
  );
}

/**
 * The products a user may pick in the ad wizard: the active items in their storefront, then the
 * products they supply. A product in both appears once, as STORE (see resolveCreativeTarget).
 */
export async function listPromotableProducts(
  db: any,
  userId: number,
  { limit = LIST_LIMITS.defaultLimit, offset = 0 }: { limit?: any; offset?: any } = {}
) {
  const size = Math.min(LIST_LIMITS.maxLimit, Math.max(1, Number(limit) || LIST_LIMITS.defaultLimit));
  const skip = Math.max(0, Number(offset) || 0);

  const { rows } = await db.query(
    `WITH promotable AS (
       SELECT DISTINCT ON (p.id)
              p.id, p.ref, p.title_en, p.title_bn, p.stock_qty,
              CASE WHEN vs.id IS NOT NULL THEN 'STORE' ELSE 'OWN' END AS source
       FROM products p
       LEFT JOIN saler_store_items si
              ON si.product_id = p.id AND si.saler_id = $1 AND si.is_active
       LEFT JOIN virtual_stores vs
              ON vs.id = si.store_id AND vs.is_active AND vs.deleted_at IS NULL
       WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE'
         AND (vs.id IS NOT NULL OR p.supplier_id = $1)
       ORDER BY p.id, (vs.id IS NOT NULL) DESC
     )
     SELECT *, COUNT(*) OVER () AS total_count
     FROM promotable
     ORDER BY (source = 'STORE') DESC, title_en, id
     LIMIT $2 OFFSET $3`,
    [userId, size, skip]
  );

  const total = rows[0] ? Number(rows[0].total_count) : 0;
  return {
    items: rows.map((r) => ({
      id: Number(r.id),
      ref: r.ref,
      title_en: r.title_en,
      title_bn: r.title_bn,
      stock_qty: Number(r.stock_qty) || 0,
      source: r.source,
    })),
    total,
    limit: size,
    offset: skip,
  };
}
