/**
 * store.service.ts — Business logic for virtual storefronts, physical shop status, and curated shelves (Prompt 4.8).
 */

import * as storeRepo from '../repositories/store.repository.ts';
import { isReservedStoreSlug } from '../config/reservedSlugs.ts';
import { AppError } from '../plugins/errorHandler.ts';
import { withAvailableStock } from './teamStockReservation.service.ts';
import { assertNoPartnerPrice } from './product.service.ts';
import { getStorageDriver } from '../integrations/storage/index.ts';
import { toPublicImageUrl } from '../lib/productImage.ts';

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validates slug format and availability against the reserved list and DB.
 */
export async function validateSlugAvailability(db, slug, excludeStoreId = null) {
  if (!slug || typeof slug !== 'string') {
    return {
      available: false,
      reason: 'INVALID_FORMAT',
      message_en: 'Store slug is required.',
      message_bn: 'স্টোর স্লাগ আবশ্যক।',
    };
  }

  const clean = slug.trim().toLowerCase();

  if (clean.length < 3 || clean.length > 40) {
    return {
      available: false,
      reason: 'INVALID_LENGTH',
      message_en: 'Slug must be between 3 and 40 characters.',
      message_bn: 'স্লাগ অবশ্যই ৩ থেকে ৪০ অক্ষরের মধ্যে হতে হবে।',
    };
  }

  if (!SLUG_REGEX.test(clean)) {
    return {
      available: false,
      reason: 'INVALID_CHARACTERS',
      message_en: 'Slug can only contain lowercase letters, numbers, and hyphens.',
      message_bn: 'স্লাগে শুধুমাত্র ছোট হাতের অক্ষর, সংখ্যা এবং হাইফেন থাকতে পারে।',
    };
  }

  if (isReservedStoreSlug(clean)) {
    return {
      available: false,
      reason: 'RESERVED_SLUG',
      message_en: `"${clean}" is a reserved platform keyword and cannot be used as a store URL.`,
      message_bn: `"${clean}" একটি সংরক্ষিত প্ল্যাটফর্ম কিওয়ার্ড এবং স্টোরের ইউআরএল হিসেবে ব্যবহার করা যাবে না।`,
    };
  }

  const taken = await storeRepo.isSlugTaken(db, clean, excludeStoreId);
  if (taken) {
    return {
      available: false,
      reason: 'SLUG_COLLISION',
      message_en: `"${clean}" is already taken by another store.`,
      message_bn: `"${clean}" নামটি অন্য একটি দোকান ইতোমধ্যে ব্যবহার করছে।`,
    };
  }

  return {
    available: true,
    slug: clean,
    message_en: 'Slug is available!',
    message_bn: 'স্লাগটি ফাঁকা আছে এবং ব্যবহারযোগ্য!',
  };
}

/**
 * Derives open/closed status for physical shop based on configured hours & current BD time (UTC+6).
 *
 * @param {object} store
 * @param {Date} [currentTime=new Date()]
 * @returns {{ isOpen: boolean, mode: string, message: string }}
 */
export function resolvePhysicalShopStatus(store: any, currentTime: Date = new Date()): { isOpen: boolean; mode: string; message: string; } {
  if (!store || !store.has_physical_shop) {
    return { isOpen: true, mode: 'VIRTUAL_ONLY', message: 'Online Store' };
  }

  const mode = store.physical_open_status || 'CLOSED';

  if (mode === 'OPEN') {
    return { isOpen: true, mode: 'MANUAL_OPEN', message: 'Open Now' };
  }

  if (mode === 'CLOSED') {
    return { isOpen: false, mode: 'MANUAL_CLOSED', message: 'Closed' };
  }

  // AUTO Mode: evaluate business hours against Bangladesh local time (UTC+6)
  const businessHours = typeof store.business_hours_json === 'string'
    ? JSON.parse(store.business_hours_json || '{}')
    : (store.business_hours_json || {});

  // Calculate local Bangladesh time (UTC + 6 hours)
  const utc = currentTime.getTime() + currentTime.getTimezoneOffset() * 60000;
  const bdTime = new Date(utc + 6 * 3600000);

  // Day names: sunday, monday, tuesday, wednesday, thursday, friday, saturday
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentDayName = days[bdTime.getDay()];
  const currentMinutes = bdTime.getHours() * 60 + bdTime.getMinutes();

  const daySchedule = businessHours[currentDayName];
  if (!daySchedule || daySchedule.is_closed) {
    return { isOpen: false, mode: 'AUTO_CLOSED', message: 'Closed today' };
  }

  const openTime = daySchedule.open || '09:00';
  const closeTime = daySchedule.close || '20:00';

  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);

  const openMinutes = (openH || 0) * 60 + (openM || 0);
  const closeMinutes = (closeH || 0) * 60 + (closeM || 0);

  const isOpenNow = currentMinutes >= openMinutes && currentMinutes <= closeMinutes;

  return {
    isOpen: isOpenNow,
    mode: isOpenNow ? 'AUTO_OPEN' : 'AUTO_CLOSED',
    message: isOpenNow ? `Open until ${closeTime}` : `Closed · Opens at ${openTime}`,
  };
}

/**
 * Retrieves public store profile, shelves, items, and derived open status.
 */
export async function getPublicStore(db, slug) {
  const store = await storeRepo.getStoreBySlug(db, slug);
  if (!store) {
    throw new AppError('NOT_FOUND', `Store "${slug}" not found.`, `"${slug}" নামে কোনো দোকান পাওয়া যায়নি।`);
  }

  const status = resolvePhysicalShopStatus(store);
  // WHY reservation-aware: this is what a shopper sees, so units an open team is counting on must not
  // look buyable. The shop partner's own management view below keeps the raw figure.
  const rawItems = await withAvailableStock(db, await storeRepo.listStoreItems(db, store.id), { idKey: 'product_id' });

  // Group items by collection / shelf
  const shelvesMap = new Map();
  const allItems = [];

  for (const item of rawItems) {
    const shelfName = item.collection_name || 'Featured Products';
    if (!shelvesMap.has(shelfName)) {
      shelvesMap.set(shelfName, []);
    }

    const formattedItem = {
      id: item.item_id,
      product_id: item.product_id,
      product_ref: item.product_ref,
      slug: item.product_slug,
      title_en: item.title_en,
      title_bn: item.title_bn,
      brand: item.brand,
      price: Number(item.custom_retail_price || item.default_retail_price),
      default_retail_price: Number(item.default_retail_price),
      custom_retail_price: item.custom_retail_price ? Number(item.custom_retail_price) : null,
      stock_qty: item.stock_qty,
      rating_avg: item.rating_avg,
      rating_count: item.rating_count,
      sold_count: item.sold_count,
      category: {
        id: item.category_id,
        slug: item.category_slug,
        name_en: item.category_name_en,
        name_bn: item.category_name_bn,
      },
      supplier: {
        name_en: item.supplier_name_en,
        name_bn: item.supplier_name_bn,
        tier: item.supplier_tier,
      },
      images: item.images || [],
      collection_name: shelfName,
      display_order: item.display_order,
      store_open: status.isOpen,
    };

    shelvesMap.get(shelfName).push(formattedItem);
    allItems.push(formattedItem);
  }

  const shelves = Array.from(shelvesMap.entries()).map(([name, items]) => ({
    name,
    items,
    count: items.length,
  }));

  return {
    store: {
      id: store.id,
      ref: store.ref,
      slug: store.slug,
      shop_name: store.shop_name,
      bio: store.bio,
      logo_key: store.logo_key,
      banner_key: store.banner_key,
      announcement: store.announcement,
      social_links: typeof store.social_links_json === 'string'
        ? JSON.parse(store.social_links_json || '{}')
        : (store.social_links_json || {}),
      has_physical_shop: store.has_physical_shop,
      physical_open_status: store.physical_open_status,
      business_hours: typeof store.business_hours_json === 'string'
        ? JSON.parse(store.business_hours_json || '{}')
        : (store.business_hours_json || {}),
      saler: {
        name_en: store.saler_name_en,
        name_bn: store.saler_name_bn,
        verification_tier: store.verification_tier,
      },
      status: {
        is_open: status.isOpen,
        mode: status.mode,
        message: status.message,
      },
      products_count: allItems.length,
      created_at: store.created_at,
    },
    shelves,
    products: allItems,
  };
}

/**
 * Gets or auto-provisions virtual store for authenticated shop partner.
 */
export async function getSalerStore(db, salerId) {
  let store = await storeRepo.getStoreBySalerId(db, salerId);
  if (!store) {
    const storeRef = `STR-${Date.now().toString(36).toUpperCase()}`;
    const defaultSlug = `store-${salerId}-${Math.floor(1000 + Math.random() * 9000)}`;
    store = await storeRepo.createVirtualStore(db, {
      salerId,
      ref: storeRef,
      slug: defaultSlug,
      shopName: `My Store`,
      bio: `Welcome to my curated store!`,
      socialLinks: {},
      hasPhysicalShop: false,
      physicalOpenStatus: 'CLOSED',
      businessHours: defaultBusinessHours(),
    });
  }

  const rawItems = await withAvailableStock(db, await storeRepo.listStoreItems(db, store.id), { idKey: 'product_id' });
  const status = resolvePhysicalShopStatus(store);

  // Group items by collection / shelf
  const shelvesMap = new Map();
  for (const item of rawItems) {
    const shelfName = item.collection_name || 'Featured Products';
    if (!shelvesMap.has(shelfName)) {
      shelvesMap.set(shelfName, []);
    }
    shelvesMap.get(shelfName).push({
      id: item.item_id,
      product_id: item.product_id,
      product_ref: item.product_ref,
      slug: item.product_slug,
      title_en: item.title_en,
      title_bn: item.title_bn,
      base_cost: Number(item.base_cost),
      wholesale_margin: Number(item.wholesale_margin),
      default_retail_price: Number(item.default_retail_price),
      custom_retail_price: item.custom_retail_price ? Number(item.custom_retail_price) : null,
      stock_qty: item.stock_qty,
      collection_name: shelfName,
      display_order: item.display_order,
      images: item.images || [],
      // The primary photo as a URL (images[] is ordered primary first and carries only storage keys).
      image_url: toPublicImageUrl(item.images?.[0]?.storage_key),
    });
  }

  const shelves = Array.from(shelvesMap.entries()).map(([name, items]) => ({
    name,
    items,
  }));

  return {
    store: {
      id: store.id,
      ref: store.ref,
      slug: store.slug,
      shop_name: store.shop_name,
      bio: store.bio,
      logo_media_id: store.logo_media_id,
      banner_media_id: store.banner_media_id,
      logo_key: store.logo_key,
      banner_key: store.banner_key,
      announcement: store.announcement,
      social_links: typeof store.social_links_json === 'string'
        ? JSON.parse(store.social_links_json || '{}')
        : (store.social_links_json || {}),
      has_physical_shop: store.has_physical_shop,
      physical_open_status: store.physical_open_status,
      business_hours: typeof store.business_hours_json === 'string'
        ? JSON.parse(store.business_hours_json || '{}')
        : (store.business_hours_json || defaultBusinessHours()),
      status,
    },
    shelves,
    total_items: rawItems.length,
  };
}

/**
 * Saves and updates shop partner virtual store settings.
 */
export async function saveSalerStore(db, salerId, payload) {
  let store = await storeRepo.getStoreBySalerId(db, salerId);
  const storeId = store ? store.id : null;

  // Validate slug availability if slug changed or is provided
  if (payload.slug) {
    const slugCheck = await validateSlugAvailability(db, payload.slug, storeId);
    if (!slugCheck.available) {
      throw new AppError('VALIDATION_FAILED', slugCheck.message_en, slugCheck.message_bn);
    }
  }

  if (!store) {
    const storeRef = `STR-${Date.now().toString(36).toUpperCase()}`;
    store = await storeRepo.createVirtualStore(db, {
      salerId,
      ref: storeRef,
      slug: payload.slug || `store-${salerId}-${Math.floor(1000 + Math.random() * 9000)}`,
      shopName: payload.shop_name || 'My Store',
      bio: payload.bio,
      logoMediaId: payload.logo_media_id,
      bannerMediaId: payload.banner_media_id,
      announcement: payload.announcement,
      socialLinks: payload.social_links,
      hasPhysicalShop: payload.has_physical_shop,
      physicalOpenStatus: payload.physical_open_status,
      businessHours: payload.business_hours,
    });
  } else {
    store = await storeRepo.updateVirtualStore(db, store.id, {
      slug: payload.slug,
      shopName: payload.shop_name,
      bio: payload.bio,
      logoMediaId: payload.logo_media_id,
      bannerMediaId: payload.banner_media_id,
      announcement: payload.announcement,
      socialLinks: payload.social_links,
      hasPhysicalShop: payload.has_physical_shop,
      physicalOpenStatus: payload.physical_open_status,
      businessHours: payload.business_hours,
    });
  }

  return store;
}

/**
 * Updates physical store status & business hours.
 */
export async function updateStoreStatus(db, salerId, { physicalOpenStatus, businessHours }) {
  const store = await storeRepo.getStoreBySalerId(db, salerId);
  if (!store) {
    throw new AppError('NOT_FOUND', 'Store not found.', 'দোকান পাওয়া যায়নি।');
  }

  const updated = await storeRepo.updateStorePhysicalStatus(db, store.id, {
    physicalOpenStatus,
    businessHours,
  });

  const status = resolvePhysicalShopStatus(updated);
  return { store: updated, status };
}

/**
 * Updates shelves & reorders curated items.
 */
export async function updateShelves(db, salerId, items) {
  const store = await storeRepo.getStoreBySalerId(db, salerId);
  if (!store) {
    throw new AppError('NOT_FOUND', 'Store not found.', 'দোকান পাওয়া যায়নি।');
  }

  for (const item of items || []) assertNoPartnerPrice(item?.custom_retail_price);
  await storeRepo.batchUpdateStoreItems(db, store.id, items || []);
  return { success: true };
}

/**
 * Page bounds for My Products. WHY a large default: the page counts and filters the whole shelf in
 * the browser, so it pages through until it has every item; a bigger page means fewer round trips.
 */
export const MY_PRODUCTS_PAGE = { defaultLimit: 100, maxLimit: 200 };

function pageParam(value, fallback, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

function parseItemId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError('NOT_FOUND', 'Product not found in your store.', 'আপনার স্টোরে প্রোডাক্টটি পাওয়া যায়নি।');
  }
  return n;
}

/**
 * My Products (`GET /saler/products`): one page of the partner's curated items, hidden ones included,
 * plus a summary of the whole shelf.
 *
 * WHY this shape and no more: the partner sees the price the shopper pays and nothing behind it. No
 * supplier cost or margin (45271c6), and no `partner_profit` — since migration 085 that figure is
 * what a sale puts into the reward pool, and a per-product pool amount reads as the partner's own
 * profit, which they never earn (owner, 2026-11-02). `custom_retail_price` is gone too: it is held
 * NULL by a CHECK, so there is nothing to show.
 * WHY no in-stock filter here: available stock is the raw count minus what open teams hold, which
 * is only known after the read, so a SQL filter would page on the wrong number.
 */
export async function listMyProducts(db, salerId, { limit, offset }: { limit?: any; offset?: any } = {}) {
  const pageLimit = pageParam(limit, MY_PRODUCTS_PAGE.defaultLimit, MY_PRODUCTS_PAGE.maxLimit) || MY_PRODUCTS_PAGE.defaultLimit;
  const pageOffset = pageParam(offset, 0, Number.MAX_SAFE_INTEGER);
  const emptySummary = { total_curated: 0, in_stock_count: 0, out_of_stock_count: 0 };

  const store = await storeRepo.getStoreBySalerId(db, salerId);
  if (!store) {
    return { products: [], total_count: 0, limit: pageLimit, offset: pageOffset, summary: emptySummary };
  }

  // WHY net of team reservations, for the list and the summary alike: units an open team holds
  // cannot be sold, and the partner decides what to promote from this count.
  const [rawItems, shelfStock] = await Promise.all([
    storeRepo.listStoreItems(db, store.id, { includeHidden: true, limit: pageLimit, offset: pageOffset }),
    storeRepo.listStoreItemStock(db, store.id),
  ]);
  const [items, shelf] = await Promise.all([
    withAvailableStock(db, rawItems, { idKey: 'product_id' }),
    withAvailableStock(db, shelfStock, { idKey: 'product_id' }),
  ]);
  const unitsSold = await storeRepo.getPartnerUnitsSold(db, salerId, items.map((i) => i.product_id));
  const storage = getStorageDriver();

  const inStock = shelf.filter((s) => Number(s.stock_qty) > 0).length;
  return {
    products: items.map((item) => {
      const image = (item.images || [])[0];
      return {
        id: Number(item.item_id),
        product_id: Number(item.product_id),
        product_ref: item.product_ref,
        slug: item.product_slug,
        title_en: item.title_en,
        title_bn: item.title_bn,
        category: item.category_name_en,
        category_bn: item.category_name_bn,
        supplier_name: item.supplier_name_en || '',
        default_retail_price: Number(item.default_retail_price),
        stock_qty: Number(item.stock_qty) || 0,
        is_active: Boolean(item.is_active),
        shelf_name: item.collection_name || null,
        image_url: image?.storage_key ? storage.getPublicUrl(image.storage_key) : null,
        sales_count: unitsSold.get(Number(item.product_id)) || 0,
      };
    }),
    total_count: shelf.length,
    limit: pageLimit,
    offset: pageOffset,
    summary: {
      total_curated: shelf.length,
      in_stock_count: inStock,
      out_of_stock_count: shelf.length - inStock,
    },
  };
}

/**
 * Shows or hides one curated item on the partner's storefront (`PATCH /saler/products/:id`, where
 * `:id` is the item's own id from listMyProducts, not the product id). A price in the body is refused
 * with PRICE_LOCKED rather than dropped, so an old client cannot believe it took.
 */
export async function updateMyProduct(db, salerId, id, body) {
  const payload = body || {};
  assertNoPartnerPrice(payload.custom_retail_price);
  const itemId = parseItemId(id);
  if (typeof payload.is_active !== 'boolean') {
    throw new AppError(
      'VALIDATION_FAILED',
      'is_active (true or false) is the only field a shop partner can change on a store item.',
      'স্টোর আইটেমে shop partner শুধু is_active (true বা false) পরিবর্তন করতে পারবেন।'
    );
  }

  const store = await storeRepo.getStoreBySalerId(db, salerId);
  const updated = store ? await storeRepo.setStoreItemActive(db, store.id, itemId, payload.is_active) : null;
  if (!updated) {
    throw new AppError('NOT_FOUND', 'Product not found in your store.', 'আপনার স্টোরে প্রোডাক্টটি পাওয়া যায়নি।');
  }
  return {
    product: { id: Number(updated.id), product_id: Number(updated.product_id), is_active: Boolean(updated.is_active) },
  };
}

/** Takes one curated item off the partner's store (`DELETE /saler/products/:id`, the item's own id). */
export async function removeMyProduct(db, salerId, id) {
  const itemId = parseItemId(id);
  const store = await storeRepo.getStoreBySalerId(db, salerId);
  const removed = store ? await storeRepo.removeStoreItemById(db, store.id, itemId) : null;
  if (!removed) {
    throw new AppError('NOT_FOUND', 'Product not found in your store.', 'আপনার স্টোরে প্রোডাক্টটি পাওয়া যায়নি।');
  }
  return { success: true, id: Number(removed.id), product_id: Number(removed.product_id) };
}

/**
 * Default standard business hours template for Bangladesh retail.
 */
function defaultBusinessHours() {
  return {
    saturday: { open: '09:00', close: '21:00', is_closed: false },
    sunday: { open: '09:00', close: '21:00', is_closed: false },
    monday: { open: '09:00', close: '21:00', is_closed: false },
    tuesday: { open: '09:00', close: '21:00', is_closed: false },
    wednesday: { open: '09:00', close: '21:00', is_closed: false },
    thursday: { open: '09:00', close: '21:00', is_closed: false },
    friday: { open: '15:00', close: '21:00', is_closed: false },
  };
}
