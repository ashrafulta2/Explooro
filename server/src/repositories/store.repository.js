/**
 * store.repository.js — Database queries for virtual stores, shelves, and storefront curation (Prompt 4.8).
 *
 * WHY the person-name joins look the way they do: `users` holds only credentials and status. The
 * human name lives on `user_profiles.full_name` (one column, not an en/bn pair) and the trust tier
 * on `trust_scores.tier` — see 001_identity.sql. The `*_name_en` / `*_name_bn` aliases are kept
 * because store.service.js and customerPortal.service.js read them by those names; both resolve to
 * the same profile name until per-language names exist in the schema.
 */

const SALER_NAME_SQL = `COALESCE(up.display_name, up.full_name)`;

export async function getStoreBySlug(db, slug) {
  const { rows } = await db.query(
    `SELECT vs.*,
            u.phone as saler_phone,
            ${SALER_NAME_SQL} as saler_name_en,
            ${SALER_NAME_SQL} as saler_name_bn,
            ts.tier as verification_tier,
            lm.storage_key as logo_key,
            bm.storage_key as banner_key
     FROM virtual_stores vs
     JOIN users u ON u.id = vs.saler_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN trust_scores ts ON ts.user_id = u.id
     LEFT JOIN media_assets lm ON lm.id = vs.logo_media_id
     LEFT JOIN media_assets bm ON bm.id = vs.banner_media_id
     WHERE vs.slug = $1 AND vs.deleted_at IS NULL
     LIMIT 1`,
    [slug.toLowerCase().trim()]
  );
  return rows[0] ?? null;
}

export async function getStoreById(db, id) {
  const { rows } = await db.query(
    `SELECT vs.*,
            u.phone as saler_phone,
            ${SALER_NAME_SQL} as saler_name_en,
            ${SALER_NAME_SQL} as saler_name_bn,
            ts.tier as verification_tier,
            lm.storage_key as logo_key,
            bm.storage_key as banner_key
     FROM virtual_stores vs
     JOIN users u ON u.id = vs.saler_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN trust_scores ts ON ts.user_id = u.id
     LEFT JOIN media_assets lm ON lm.id = vs.logo_media_id
     LEFT JOIN media_assets bm ON bm.id = vs.banner_media_id
     WHERE vs.id = $1 AND vs.deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getStoreBySalerId(db, salerId) {
  const { rows } = await db.query(
    `SELECT vs.*,
            lm.storage_key as logo_key,
            bm.storage_key as banner_key
     FROM virtual_stores vs
     LEFT JOIN media_assets lm ON lm.id = vs.logo_media_id
     LEFT JOIN media_assets bm ON bm.id = vs.banner_media_id
     WHERE vs.saler_id = $1 AND vs.deleted_at IS NULL
     LIMIT 1`,
    [salerId]
  );
  return rows[0] ?? null;
}

export async function isSlugTaken(db, slug, excludeStoreId = null) {
  const cleanSlug = slug.toLowerCase().trim();
  if (excludeStoreId) {
    const { rows } = await db.query(
      `SELECT 1 FROM virtual_stores WHERE slug = $1 AND id != $2 AND deleted_at IS NULL LIMIT 1`,
      [cleanSlug, excludeStoreId]
    );
    return rows.length > 0;
  }
  const { rows } = await db.query(
    `SELECT 1 FROM virtual_stores WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
    [cleanSlug]
  );
  return rows.length > 0;
}

export async function createVirtualStore(db, {
  salerId,
  ref,
  slug,
  shopName,
  bio = null,
  logoMediaId = null,
  bannerMediaId = null,
  announcement = null,
  socialLinks = {},
  hasPhysicalShop = false,
  physicalOpenStatus = 'CLOSED',
  businessHours = null,
}) {
  const { rows } = await db.query(
    `INSERT INTO virtual_stores
       (ref, saler_id, slug, shop_name, bio, logo_media_id, banner_media_id,
        announcement, social_links_json, has_physical_shop, physical_open_status,
        business_hours_json, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, now(), now())
     RETURNING *`,
    [
      ref,
      salerId,
      slug.toLowerCase().trim(),
      shopName,
      bio,
      logoMediaId,
      bannerMediaId,
      announcement,
      JSON.stringify(socialLinks || {}),
      Boolean(hasPhysicalShop),
      physicalOpenStatus || 'CLOSED',
      businessHours ? JSON.stringify(businessHours) : null,
    ]
  );
  return rows[0];
}

export async function updateVirtualStore(db, storeId, {
  slug,
  shopName,
  bio,
  logoMediaId,
  bannerMediaId,
  announcement,
  socialLinks,
  hasPhysicalShop,
  physicalOpenStatus,
  businessHours,
}) {
  const updates = [];
  const params = [storeId];

  if (slug !== undefined) {
    params.push(slug.toLowerCase().trim());
    updates.push(`slug = $${params.length}`);
  }
  if (shopName !== undefined) {
    params.push(shopName);
    updates.push(`shop_name = $${params.length}`);
  }
  if (bio !== undefined) {
    params.push(bio);
    updates.push(`bio = $${params.length}`);
  }
  if (logoMediaId !== undefined) {
    params.push(logoMediaId);
    updates.push(`logo_media_id = $${params.length}`);
  }
  if (bannerMediaId !== undefined) {
    params.push(bannerMediaId);
    updates.push(`banner_media_id = $${params.length}`);
  }
  if (announcement !== undefined) {
    params.push(announcement);
    updates.push(`announcement = $${params.length}`);
  }
  if (socialLinks !== undefined) {
    params.push(JSON.stringify(socialLinks));
    updates.push(`social_links_json = $${params.length}`);
  }
  if (hasPhysicalShop !== undefined) {
    params.push(Boolean(hasPhysicalShop));
    updates.push(`has_physical_shop = $${params.length}`);
  }
  if (physicalOpenStatus !== undefined) {
    params.push(physicalOpenStatus);
    updates.push(`physical_open_status = $${params.length}`);
  }
  if (businessHours !== undefined) {
    params.push(businessHours ? JSON.stringify(businessHours) : null);
    updates.push(`business_hours_json = $${params.length}`);
  }

  updates.push(`updated_at = now()`);

  const { rows } = await db.query(
    `UPDATE virtual_stores
     SET ${updates.join(', ')}
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

export async function updateStorePhysicalStatus(db, storeId, { physicalOpenStatus, businessHours }) {
  const updates = ['updated_at = now()'];
  const params = [storeId];

  if (physicalOpenStatus !== undefined) {
    params.push(physicalOpenStatus);
    updates.push(`physical_open_status = $${params.length}`);
  }
  if (businessHours !== undefined) {
    params.push(businessHours ? JSON.stringify(businessHours) : null);
    updates.push(`business_hours_json = $${params.length}`);
  }

  const { rows } = await db.query(
    `UPDATE virtual_stores
     SET ${updates.join(', ')}
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

export async function listStoreItems(db, storeId) {
  const { rows } = await db.query(
    `SELECT ssi.id as item_id,
            ssi.store_id,
            ssi.saler_id,
            ssi.product_id,
            ssi.custom_retail_price,
            ssi.collection_name,
            ssi.display_order,
            ssi.is_active,
            ssi.added_at,
            p.ref as product_ref,
            p.slug as product_slug,
            p.title_en,
            p.title_bn,
            p.description_en,
            p.description_bn,
            p.brand,
            p.base_cost,
            p.wholesale_margin,
            p.default_retail_price,
            p.stock_qty,
            p.rating_avg,
            p.rating_count,
            p.sold_count,
            c.id as category_id,
            c.slug as category_slug,
            c.name_en as category_name_en,
            c.name_bn as category_name_bn,
            ${SALER_NAME_SQL} as supplier_name_en,
            ${SALER_NAME_SQL} as supplier_name_bn,
            ts.tier as supplier_tier,
            COALESCE(
              (SELECT json_agg(json_build_object(
                'id', pi.id,
                'media_id', pi.media_id,
                'is_primary', pi.is_primary,
                'display_order', pi.display_order,
                'storage_key', ma.storage_key,
                'mime_type', ma.mime_type
              ) ORDER BY pi.is_primary DESC, pi.display_order ASC)
               FROM product_images pi
               JOIN media_assets ma ON ma.id = pi.media_id
               WHERE pi.product_id = p.id),
              '[]'::json
            ) as images
     FROM saler_store_items ssi
     JOIN products p ON p.id = ssi.product_id
     JOIN categories c ON c.id = p.category_id
     JOIN users u ON u.id = p.supplier_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN trust_scores ts ON ts.user_id = u.id
     WHERE ssi.store_id = $1 AND ssi.is_active = true AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
     ORDER BY ssi.collection_name ASC, ssi.display_order ASC, ssi.added_at DESC`,
    [storeId]
  );
  return rows;
}

export async function batchUpdateStoreItems(db, storeId, items) {
  // Execute updates for display_order and collection_name
  for (const item of items) {
    if (item.product_id) {
      await db.query(
        `UPDATE saler_store_items
         SET display_order = $1,
             collection_name = $2,
             custom_retail_price = COALESCE($3, custom_retail_price),
             is_active = COALESCE($4, is_active)
         WHERE store_id = $5 AND product_id = $6`,
        [
          item.display_order ?? 0,
          item.collection_name || 'General',
          item.custom_retail_price !== undefined ? item.custom_retail_price : null,
          item.is_active !== undefined ? item.is_active : true,
          storeId,
          item.product_id,
        ]
      );
    }
  }
}

export async function removeStoreItem(db, storeId, productId) {
  const { rows } = await db.query(
    `DELETE FROM saler_store_items WHERE store_id = $1 AND product_id = $2 RETURNING *`,
    [storeId, productId]
  );
  return rows[0] ?? null;
}
