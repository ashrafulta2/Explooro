/**
 * product.repository.js — Data access for catalog products, variants, images & sourcing (Prompt 4.3).
 */

export async function insertProduct(
  db,
  {
    ref,
    supplierId,
    categoryId,
    slug,
    titleEn,
    titleBn,
    descriptionEn = null,
    descriptionBn = null,
    brand = null,
    baseCost,
    wholesaleMargin = 0,
    defaultRetailPrice,
    minRetailPrice = null,
    stockQty = 0,
    lowStockThreshold = 5,
    weightGrams = null,
    hasVariants = false,
    warrantyMonths = 0,
    status = 'DRAFT',
  }
) {
  const { rows } = await db.query(
    `INSERT INTO products
       (ref, supplier_id, category_id, slug, title_en, title_bn, description_en,
        description_bn, brand, base_cost, wholesale_margin, default_retail_price,
        min_retail_price, stock_qty, low_stock_threshold, weight_grams,
        has_variants, warranty_months, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, now())
     RETURNING *`,
    [
      ref,
      supplierId,
      categoryId,
      slug,
      titleEn,
      titleBn,
      descriptionEn,
      descriptionBn,
      brand,
      baseCost,
      wholesaleMargin,
      defaultRetailPrice,
      minRetailPrice,
      stockQty,
      lowStockThreshold,
      weightGrams,
      hasVariants,
      warrantyMonths,
      status,
    ]
  );
  return rows[0];
}

export async function updateProduct(db, id, fields = {}) {
  const setClauses = [];
  const params = [id];

  const allowed = {
    title_en: 'title_en',
    title_bn: 'title_bn',
    description_en: 'description_en',
    description_bn: 'description_bn',
    brand: 'brand',
    category_id: 'category_id',
    base_cost: 'base_cost',
    wholesale_margin: 'wholesale_margin',
    default_retail_price: 'default_retail_price',
    min_retail_price: 'min_retail_price',
    stock_qty: 'stock_qty',
    low_stock_threshold: 'low_stock_threshold',
    weight_grams: 'weight_grams',
    warranty_months: 'warranty_months',
    status: 'status',
  };

  for (const [key, col] of Object.entries(allowed)) {
    if (fields[key] !== undefined) {
      params.push(fields[key]);
      setClauses.push(`${col} = $${params.length}`);
    }
  }

  if (setClauses.length === 0) return getProductById(db, id);

  params.push(new Date());
  setClauses.push(`updated_at = $${params.length}`);

  const { rows } = await db.query(
    `UPDATE products
     SET ${setClauses.join(', ')}
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

export async function softDeleteProduct(db, id) {
  const { rows } = await db.query(
    `UPDATE products
     SET deleted_at = now(), status = 'ARCHIVED'
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, ref, deleted_at`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getProductById(db, id) {
  const { rows } = await db.query(
    `SELECT p.*,
            c.name_en as category_name_en, c.name_bn as category_name_bn, c.slug as category_slug,
            u.phone as supplier_phone
     FROM products p
     JOIN categories c ON c.id = p.category_id
     JOIN users u ON u.id = p.supplier_id
     WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getProductBySlug(db, slug) {
  const { rows } = await db.query(
    `SELECT p.*,
            c.name_en as category_name_en, c.name_bn as category_name_bn, c.slug as category_slug
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.slug = $1 AND p.deleted_at IS NULL`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function getProductByRef(db, ref) {
  const { rows } = await db.query(
    `SELECT p.*,
            c.name_en as category_name_en, c.name_bn as category_name_bn, c.slug as category_slug
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.ref = $1 AND p.deleted_at IS NULL`,
    [ref]
  );
  return rows[0] ?? null;
}

export async function getVariantsByProductId(db, productId) {
  const { rows } = await db.query(
    `SELECT v.*, m.storage_key AS image_storage_key
     FROM product_variants v
     LEFT JOIN media_assets m ON m.id = v.image_id
     WHERE v.product_id = $1 AND v.is_active = true
     ORDER BY v.id ASC`,
    [productId]
  );
  return rows;
}

export async function getImagesByProductId(db, productId) {
  const { rows } = await db.query(
    `SELECT pi.id, pi.display_order, pi.is_primary, pi.quality_score,
            m.id AS media_id, m.storage_key, m.mime_type, m.width, m.height
     FROM product_images pi
     JOIN media_assets m ON m.id = pi.media_id
     WHERE pi.product_id = $1
     ORDER BY pi.is_primary DESC, pi.display_order ASC`,
    [productId]
  );
  return rows;
}

/** Supplier trust tier + a handful of profile fields for the product detail page's supplier card. */
export async function getSupplierInfo(db, supplierId) {
  const { rows } = await db.query(
    `SELECT u.id, u.ref, up.display_name, up.full_name, up.district,
            ts.tier, ts.score, ts.completed_orders
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN trust_scores ts ON ts.user_id = u.id
     WHERE u.id = $1`,
    [supplierId]
  );
  return rows[0] ?? null;
}

export async function listProducts(
  db,
  {
    categoryId,
    categorySlug,
    brand,
    status = 'ACTIVE',
    minPrice,
    maxPrice,
    sortBy = 'newest',
    limit = 20,
    offset = 0,
    supplierId,
    flashSale,
    supplierTier,
    district,
    q,
  } = {}
) {
  const conditions = ['p.deleted_at IS NULL'];
  const params = [];

  if (status && status !== 'ALL') {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }

  if (supplierId) {
    params.push(supplierId);
    conditions.push(`p.supplier_id = $${params.length}`);
  }

  if (categoryId) {
    params.push(categoryId);
    conditions.push(`p.category_id = $${params.length}`);
  }

  if (categorySlug) {
    params.push(categorySlug);
    conditions.push(`c.slug = $${params.length}`);
  }

  if (brand) {
    params.push(brand);
    conditions.push(`p.brand ILIKE $${params.length}`);
  }

  if (minPrice !== undefined && minPrice !== null) {
    params.push(minPrice);
    conditions.push(`p.default_retail_price >= $${params.length}`);
  }

  if (maxPrice !== undefined && maxPrice !== null) {
    params.push(maxPrice);
    conditions.push(`p.default_retail_price <= $${params.length}`);
  }

  if (district) {
    params.push(district);
    conditions.push(`up.district ILIKE $${params.length}`);
  }

  if (supplierTier) {
    const tiers = supplierTier.split(',').map((t) => t.trim().toUpperCase());
    const tierMap = {
      STANDARD: 'STARTER',
      VERIFIED: 'VERIFIED_TRADER',
      ELITE: 'ELITE_PARTNER',
      STARTER: 'STARTER',
      VERIFIED_TRADER: 'VERIFIED_TRADER',
      ELITE_PARTNER: 'ELITE_PARTNER',
    };
    const dbTiers = tiers.map((t) => tierMap[t] || t);
    params.push(dbTiers);
    conditions.push(`COALESCE(ts.tier, 'STARTER') = ANY($${params.length})`);
  }

  if (flashSale) {
    conditions.push(`fs.id IS NOT NULL`);
  }

  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(p.title_en ILIKE $${params.length} OR p.title_bn ILIKE $${params.length})`);
  }

  let orderClause = 'p.created_at DESC';
  if (sortBy === 'price_asc') orderClause = 'p.default_retail_price ASC';
  else if (sortBy === 'price_desc') orderClause = 'p.default_retail_price DESC';
  else if (sortBy === 'popular') orderClause = 'p.sold_count DESC, p.rating_avg DESC';
  else if (sortBy === 'rating') orderClause = 'p.rating_avg DESC';

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await db.query(
    `SELECT p.*,
            p.default_retail_price as price,
            c.name_en as category_name_en, c.name_bn as category_name_bn, c.slug as category_slug,
            COALESCE(
              CASE ts.tier
                WHEN 'ELITE_PARTNER' THEN 'elite'
                WHEN 'VERIFIED_TRADER' THEN 'verified'
                ELSE 'standard'
              END,
              'standard'
            ) as supplier_tier,
            CASE WHEN ts.tier IN ('VERIFIED_TRADER', 'ELITE_PARTNER') THEN true ELSE false END as is_verified_supplier,
            COALESCE(up.district, 'Dhaka') as district,
            COALESCE(vs.physical_open_status = 'OPEN', true) as store_open,
            CASE WHEN fs.id IS NOT NULL THEN true ELSE false END as is_flash_sale,
            fs.discount_price as flash_discount_price,
            fs.ends_at as flash_ends_at
     FROM products p
     JOIN categories c ON c.id = p.category_id
     LEFT JOIN trust_scores ts ON ts.user_id = p.supplier_id
     LEFT JOIN user_profiles up ON up.user_id = p.supplier_id
     LEFT JOIN virtual_stores vs ON vs.saler_id = p.supplier_id
     LEFT JOIN flash_sales fs ON fs.product_id = p.id AND fs.status = 'ACTIVE' AND now() BETWEEN fs.starts_at AND fs.ends_at
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${orderClause}
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );
  return rows;
}

export async function insertProductApproval(db, { productId, submittedBy, status = 'PENDING', autoFlags = [] }) {
  const { rows } = await db.query(
    `INSERT INTO product_approvals
       (product_id, submitted_by, status, auto_flags_json, created_at)
     VALUES ($1, $2, $3, $4, now())
     RETURNING *`,
    [productId, submittedBy, status, JSON.stringify(autoFlags)]
  );
  return rows[0];
}

export async function getVirtualStoreBySalerId(db, salerId) {
  const { rows } = await db.query(
    `SELECT * FROM virtual_stores WHERE saler_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [salerId]
  );
  return rows[0] ?? null;
}

export async function createVirtualStore(db, { salerId, ref, slug, shopName, bio = null }) {
  const { rows } = await db.query(
    `INSERT INTO virtual_stores (ref, saler_id, slug, shop_name, bio, created_at)
     VALUES ($1, $2, $3, $4, $5, now())
     RETURNING *`,
    [ref, salerId, slug, shopName, bio]
  );
  return rows[0];
}

export async function upsertSalerStoreItem(db, { storeId, salerId, productId, customRetailPrice, collectionName }) {
  const { rows } = await db.query(
    `INSERT INTO saler_store_items (store_id, saler_id, product_id, custom_retail_price, collection_name, added_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (store_id, product_id) DO UPDATE
     SET custom_retail_price = EXCLUDED.custom_retail_price,
         collection_name = EXCLUDED.collection_name,
         is_active = true
     RETURNING *`,
    [storeId, salerId, productId, customRetailPrice, collectionName]
  );
  return rows[0];
}

export async function listSalerStoreItems(db, storeId) {
  const { rows } = await db.query(
    `SELECT ssi.*,
            p.ref as product_ref, p.slug as product_slug, p.title_en, p.title_bn,
            p.base_cost, p.wholesale_margin, p.default_retail_price, p.stock_qty,
            c.name_en as category_name_en, c.name_bn as category_name_bn
     FROM saler_store_items ssi
     JOIN products p ON p.id = ssi.product_id
     JOIN categories c ON c.id = p.category_id
     WHERE ssi.store_id = $1 AND ssi.is_active = true AND p.deleted_at IS NULL
     ORDER BY ssi.display_order ASC, ssi.added_at DESC`,
    [storeId]
  );
  return rows;
}

export async function getCategoryById(db, categoryId) {
  const { rows } = await db.query(
    `SELECT * FROM categories WHERE id = $1 AND is_active = true`,
    [categoryId]
  );
  return rows[0] ?? null;
}
