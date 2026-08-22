/**
 * store.service.js — Business logic for virtual storefronts, physical shop status, and curated shelves (Prompt 4.8).
 */

import * as storeRepo from '../repositories/store.repository.js';
import { isReservedStoreSlug } from '../config/reservedSlugs.js';
import { AppError } from '../plugins/errorHandler.js';

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
export function resolvePhysicalShopStatus(store, currentTime = new Date()) {
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
  const rawItems = await storeRepo.listStoreItems(db, store.id);

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
 * Gets or auto-provisions virtual store for authenticated saler.
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

  const rawItems = await storeRepo.listStoreItems(db, store.id);
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
 * Saves and updates saler virtual store settings.
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

  await storeRepo.batchUpdateStoreItems(db, store.id, items || []);
  return { success: true };
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
