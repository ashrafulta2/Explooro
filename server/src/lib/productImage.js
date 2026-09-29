/**
 * productImage.js — shared "primary product image" lookup.
 *
 * WHY: `products` has no image column. Images live in `product_images`
 * (ordered by is_primary DESC, display_order ASC) joined to
 * `media_assets.storage_key`. Several services once selected a non-existent
 * `p.primary_image_url`, which errors against real Postgres; this fragment is
 * the one correct way to pick the primary image inside a query.
 */

import { getStorageDriver } from '../integrations/storage/index.js';

/**
 * Correlated subquery returning the primary image's storage key for the
 * product aliased as `productAlias` in the surrounding query.
 */
export function primaryImageKeySql(productAlias = 'p') {
  return `(
    SELECT m.storage_key
    FROM product_images pi_primary
    JOIN media_assets m ON m.id = pi_primary.media_id
    WHERE pi_primary.product_id = ${productAlias}.id
    ORDER BY pi_primary.is_primary DESC, pi_primary.display_order ASC
    LIMIT 1
  )`;
}

/** Maps a storage key to a public URL, or null when the product has no image. */
export function toPublicImageUrl(storageKey) {
  return storageKey ? getStorageDriver().getPublicUrl(storageKey) : null;
}
