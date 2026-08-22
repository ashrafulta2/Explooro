/**
 * Mock handlers for Saler storefronts & store builder (Prompt 4.8).
 */
import stores from '../fixtures/stores.json';
import products from '../fixtures/products.json';

function traceId() {
  return `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'store', 'stores', 'checkout', 'account', 'saler', 'supplier',
  'moderator', 'editor', 'dev', 'live', 'help', 'legal', 'search', 'cart', 's',
  'c', 'team', 'auth', 'login', 'register', 'platform', 'system', 'settings',
]);

// Stateful mock store in memory
let currentSalerStore = {
  id: 1,
  ref: 'STR-SALER001',
  slug: 'priyo-collection',
  shop_name: 'Priyo Collection',
  bio: 'Authentic Bangladeshi Handloom, Sarees & Traditional Wear · Direct from weavers.',
  announcement: '🎉 Eid Mega Discount: Get up to 25% OFF on all Jamdani Sarees this week!',
  social_links: {
    whatsapp: '+8801711223344',
    facebook: 'priyocollectionbd',
    instagram: 'priyocollection.official',
    phone: '+8801711223344',
  },
  has_physical_shop: true,
  physical_open_status: 'OPEN',
  business_hours: {
    saturday: { open: '09:00', close: '21:00', is_closed: false },
    sunday: { open: '09:00', close: '21:00', is_closed: false },
    monday: { open: '09:00', close: '21:00', is_closed: false },
    tuesday: { open: '09:00', close: '21:00', is_closed: false },
    wednesday: { open: '09:00', close: '21:00', is_closed: false },
    thursday: { open: '09:00', close: '21:00', is_closed: false },
    friday: { open: '15:00', close: '21:00', is_closed: false },
  },
  status: {
    is_open: true,
    mode: 'MANUAL_OPEN',
    message: 'Open Now 🟢',
  },
  products_count: 8,
};

let currentShelves = [
  {
    name: 'Featured Handloom',
    items: products.slice(0, 4).map((p, idx) => ({
      product_id: p.id,
      product_ref: p.ref,
      title_en: p.title_en,
      title_bn: p.title_bn,
      price: p.default_retail_price || p.price,
      default_retail_price: p.default_retail_price || p.price,
      custom_retail_price: null,
      stock_qty: 15,
      collection_name: 'Featured Handloom',
      display_order: idx,
      store_open: true,
      images: p.images || [],
    })),
  },
  {
    name: 'Trending Collection',
    items: products.slice(4, 8).map((p, idx) => ({
      product_id: p.id,
      product_ref: p.ref,
      title_en: p.title_en,
      title_bn: p.title_bn,
      price: p.default_retail_price || p.price,
      default_retail_price: p.default_retail_price || p.price,
      custom_retail_price: null,
      stock_qty: 20,
      collection_name: 'Trending Collection',
      display_order: idx,
      store_open: true,
      images: p.images || [],
    })),
  },
];

export default [
  // 1. Slug availability check
  {
    method: 'GET',
    path: '/stores/check-slug',
    handler({ query }) {
      const slug = (query?.slug || '').trim().toLowerCase();
      if (!slug || slug.length < 3) {
        return {
          status: 200,
          body: {
            data: {
              available: false,
              message_en: 'Slug must be at least 3 characters.',
              message_bn: 'স্লাগ অবশ্যই কমপক্ষে ৩ অক্ষরের হতে হবে।',
            },
          },
        };
      }
      if (RESERVED_SLUGS.has(slug)) {
        return {
          status: 200,
          body: {
            data: {
              available: false,
              message_en: `"${slug}" is a reserved system keyword.`,
              message_bn: `"${slug}" একটি সংরক্ষিত সিস্টেম কিওয়ার্ড।`,
            },
          },
        };
      }
      // Check collision with existing stores (excluding own)
      const existing = stores.find((s) => s.slug === slug && s.ref !== currentSalerStore.ref);
      if (existing) {
        return {
          status: 200,
          body: {
            data: {
              available: false,
              message_en: `"${slug}" is already taken.`,
              message_bn: `"${slug}" নামটি ইতোমধ্যে ব্যবহৃত।`,
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          data: {
            available: true,
            slug,
            message_en: 'Slug is available!',
            message_bn: 'স্লাগটি ফাঁকা আছে!',
          },
        },
      };
    },
  },

  // 2. Public Store Details
  {
    method: 'GET',
    path: '/stores/:slug',
    handler({ params }) {
      let store = stores.find((s) => s.slug === params.slug);
      let shelves = [];
      let storeProducts = [];

      if (params.slug === currentSalerStore.slug || (!store && params.slug === 'priyo-collection')) {
        store = currentSalerStore;
        shelves = currentShelves;
        storeProducts = currentShelves.flatMap((s) => s.items);
      } else if (store) {
        storeProducts = products.filter((p) => p.store_ref === store.ref);
        if (storeProducts.length === 0) {
          storeProducts = products.slice(0, 6);
        }
        shelves = [
          {
            name: 'All Products',
            items: storeProducts,
          },
        ];
      }

      if (!store) {
        return {
          status: 404,
          body: {
            error: {
              code: 'NOT_FOUND',
              message_en: `No store at "/store/${params.slug}".`,
              message_bn: `"/store/${params.slug}" নামে কোনো দোকান নেই।`,
              trace_id: traceId(),
            },
          },
        };
      }

      const storeData = {
        id: store.id || 1,
        ref: store.ref,
        slug: store.slug,
        shop_name: store.shop_name || store.name_en || 'Store',
        bio: store.bio || 'Verified Bangladeshi Social Seller · Powered by Explooro',
        announcement: store.announcement || currentSalerStore.announcement,
        social_links: store.social_links || currentSalerStore.social_links,
        has_physical_shop: store.has_physical_shop ?? true,
        physical_open_status: store.physical_open_status || 'OPEN',
        status: {
          is_open: store.physical_open_status !== 'CLOSED',
          message: store.physical_open_status === 'OPEN' ? 'Open Now 🟢' : 'Closed 🔴',
        },
        products_count: storeProducts.length,
      };

      return {
        status: 200,
        body: {
          data: {
            store: storeData,
            shelves,
            products: storeProducts,
          },
        },
      };
    },
  },

  // 3. Saler Store Profile
  {
    method: 'GET',
    path: '/saler/store',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            store: currentSalerStore,
            shelves: currentShelves,
            total_items: currentShelves.reduce((acc, s) => acc + s.items.length, 0),
          },
        },
      };
    },
  },

  // 4. Update Saler Store Profile
  {
    method: 'PUT',
    path: '/saler/store',
    handler({ body }) {
      currentSalerStore = {
        ...currentSalerStore,
        ...body,
        status: {
          is_open: body?.physical_open_status !== 'CLOSED',
          message: body?.physical_open_status === 'OPEN' ? 'Open Now 🟢' : 'Closed 🔴',
        },
      };
      return {
        status: 200,
        body: {
          data: {
            store: currentSalerStore,
            shelves: currentShelves,
          },
        },
      };
    },
  },

  // 5. Update Physical Shop Status
  {
    method: 'PATCH',
    path: '/saler/store/status',
    handler({ body }) {
      if (body?.physical_open_status) {
        currentSalerStore.physical_open_status = body.physical_open_status;
      }
      if (body?.business_hours) {
        currentSalerStore.business_hours = body.business_hours;
      }
      currentSalerStore.status = {
        is_open: currentSalerStore.physical_open_status !== 'CLOSED',
        message: currentSalerStore.physical_open_status === 'OPEN' ? 'Open Now 🟢' : 'Closed 🔴',
      };
      return {
        status: 200,
        body: {
          data: {
            store: currentSalerStore,
            status: currentSalerStore.status,
          },
        },
      };
    },
  },

  // 6. Update Shelves
  {
    method: 'PUT',
    path: '/saler/store/shelves',
    handler({ body }) {
      return {
        status: 200,
        body: {
          data: {
            success: true,
          },
        },
      };
    },
  },
];
