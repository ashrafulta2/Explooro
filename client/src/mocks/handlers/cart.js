/**
 * mocks/handlers/cart.js — Mock API handlers for Cart & Wishlist (Prompt 5.1).
 *
 * Provides realistic Bangladeshi mock data with multi-supplier parcels,
 * live price change warnings, stock ceilings, and optimistic updates.
 */

export let mockCartItems = [
  {
    id: 101,
    product_id: 1,
    product_ref: 'PRD-JAM-001',
    product_title_en: 'Authentic Handloom Dhakai Jamdani Saree',
    product_title_bn: 'খাঁটি তাঁতের ঢাকাই জামদানি শাড়ি',
    product_slug: 'handloom-dhakai-jamdani-saree',
    variant_id: 1001,
    variant_title: 'Midnight Blue / Silk (মিডনাইট ব্লু / সিল্ক)',
    variant_sku: 'JAM-BLU-SLK',
    saler_id: null,
    bundle_id: null,
    qty: 1,
    stock_ceiling: 5,
    price_at_add: '3200.00', // Was added at 3200, current price is 3500 -> demonstrates PRICE_CHANGED warning!
    unit_price: '3500.00',
    line_total: '3500.00',
    image_url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=60',
    supplier_id: 1,
    supplier_name: 'Dhakai Heritage Weavers Ltd.',
    warnings: [
      {
        code: 'PRICE_CHANGED',
        old_price: '3200.00',
        current_price: '3500.00',
        diff: '300.00',
        message_en: 'Price changed from ৳3,200.00 to ৳3,500.00 since added.',
        message_bn: 'যোগ করার পর থেকে মূল্য ৳৩,২০০.০০ থেকে ৳৩,৫০০.০০ এ পরিবর্তিত হয়েছে।',
      },
    ],
  },
  {
    id: 102,
    product_id: 2,
    product_ref: 'PRD-SLK-002',
    product_title_en: 'Pure Rajshahi Mulberry Silk Dupatta',
    product_title_bn: 'খাঁটি রাজশাহী তসর সিল্ক ওড়না',
    product_slug: 'rajshahi-mulberry-silk-dupatta',
    variant_id: null,
    variant_title: null,
    variant_sku: 'SLK-DUP-01',
    saler_id: null,
    bundle_id: null,
    qty: 2,
    stock_ceiling: 12,
    price_at_add: '850.00',
    unit_price: '850.00',
    line_total: '1700.00',
    image_url: 'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=500&auto=format&fit=crop&q=60',
    supplier_id: 2,
    supplier_name: 'Rajshahi Silk Crafts Co.',
    warnings: [],
  },
];

let mockWishlist = [
  {
    id: 501,
    product_id: 3,
    product_ref: 'PRD-JUT-003',
    title_en: 'Handcrafted Jute Tote Bag with Leather Handle',
    title_bn: 'হস্তশিল্প পাটের টোট ব্যাগ (চামড়ার হাতল)',
    slug: 'handcrafted-jute-tote-bag',
    saved_price: '650.00',
    current_price: '580.00',
    price_dropped: true,
    drop_amount: '70.00',
    stock_qty: 20,
    is_in_stock: true,
    image_url: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=500&auto=format&fit=crop&q=60',
    notify_on_drop: true,
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
];

function calculateCart() {
  const suppliersMap = new Map();
  let subtotal = 0;
  let itemsCount = 0;
  let hasWarnings = false;

  mockCartItems.forEach((item) => {
    const qty = Number(item.qty);
    itemsCount += qty;
    const unitPrice = Number(item.unit_price);
    const lineTotal = unitPrice * qty;
    item.line_total = lineTotal.toFixed(2);
    subtotal += lineTotal;
    if (item.warnings && item.warnings.length > 0) hasWarnings = true;

    const suppId = item.supplier_id || 1;
    if (!suppliersMap.has(suppId)) {
      suppliersMap.set(suppId, {
        supplier_id: suppId,
        supplier_name: item.supplier_name || 'Standard Supplier',
        parcel_ref: `PARCEL-${suppId}`,
        items: [],
        subtotal: 0,
        items_count: 0,
      });
    }

    const parcel = suppliersMap.get(suppId);
    parcel.items.push(item);
    parcel.subtotal += lineTotal;
    parcel.items_count += qty;
  });

  const parcels = Array.from(suppliersMap.values()).map((p) => ({
    ...p,
    subtotal: p.subtotal.toFixed(2),
  }));

  const estimatedShippingPerParcel = 60.0;
  const estimatedShipping = parcels.length * estimatedShippingPerParcel;
  const grandTotal = subtotal + estimatedShipping;

  return {
    cart_id: 1,
    guest_token: 'gst_mock_token_123',
    user_id: null,
    status: 'ACTIVE',
    items: mockCartItems,
    parcels,
    parcel_count: parcels.length,
    items_count: itemsCount,
    subtotal: subtotal.toFixed(2),
    estimated_shipping: estimatedShipping.toFixed(2),
    grand_total: grandTotal.toFixed(2),
    has_warnings: hasWarnings,
    last_activity_at: new Date().toISOString(),
  };
}

const handlers = [
  {
    method: 'GET',
    path: '/cart',
    handler: () => ({
      status: 200,
      body: { data: { cart: calculateCart() } },
    }),
  },
  {
    method: 'POST',
    path: '/cart/items',
    handler: ({ body }) => {
      const productId = Number(body?.product_id);
      const variantId = body?.variant_id ? Number(body.variant_id) : null;
      const qty = Number(body?.qty || 1);

      const existingIndex = mockCartItems.findIndex(
        (i) => i.product_id === productId && (i.variant_id || null) === (variantId || null)
      );

      if (existingIndex >= 0) {
        mockCartItems[existingIndex].qty += qty;
      } else {
        const newItem = {
          id: Date.now(),
          product_id: productId,
          product_ref: `PRD-${productId}`,
          product_title_en: body?.title_en || 'Product Item',
          product_title_bn: body?.title_bn || 'পণ্য আইটেম',
          product_slug: body?.slug || `product-${productId}`,
          variant_id: variantId,
          variant_title: body?.variant_title || null,
          variant_sku: body?.variant_sku || `SKU-${productId}`,
          saler_id: body?.saler_id ? Number(body.saler_id) : null,
          bundle_id: null,
          qty,
          stock_ceiling: body?.stock_qty || 10,
          price_at_add: Number(body?.price || 500).toFixed(2),
          unit_price: Number(body?.price || 500).toFixed(2),
          line_total: (Number(body?.price || 500) * qty).toFixed(2),
          image_url: body?.image_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=60',
          supplier_id: body?.supplier_id || 3,
          supplier_name: body?.supplier_name || 'Dhaka Central Hub',
          warnings: [],
        };
        mockCartItems.push(newItem);
      }

      return {
        status: 200,
        body: { data: { cart: calculateCart() } },
      };
    },
  },
  {
    method: 'PATCH',
    path: '/cart/items/:id',
    handler: ({ params, body }) => {
      const itemId = Number(params.id);
      const qty = Number(body?.qty);

      if (qty <= 0) {
        mockCartItems = mockCartItems.filter((i) => i.id !== itemId);
      } else {
        const item = mockCartItems.find((i) => i.id === itemId);
        if (item) item.qty = qty;
      }

      return {
        status: 200,
        body: { data: { cart: calculateCart() } },
      };
    },
  },
  {
    method: 'DELETE',
    path: '/cart/items/:id',
    handler: ({ params }) => {
      const itemId = Number(params.id);
      mockCartItems = mockCartItems.filter((i) => i.id !== itemId);
      return {
        status: 200,
        body: { data: { cart: calculateCart() } },
      };
    },
  },
  {
    method: 'POST',
    path: '/cart/merge',
    handler: () => ({
      status: 200,
      body: { data: { cart: calculateCart() } },
    }),
  },
  {
    method: 'GET',
    path: '/wishlist',
    handler: () => ({
      status: 200,
      body: { data: { wishlist: { items: mockWishlist, count: mockWishlist.length } } },
    }),
  },
  {
    method: 'POST',
    path: '/wishlist/:productId',
    handler: ({ params }) => {
      const productId = Number(params.productId);
      const existingIdx = mockWishlist.findIndex((w) => w.product_id === productId);
      if (existingIdx >= 0) {
        mockWishlist.splice(existingIdx, 1);
        return {
          status: 200,
          body: { data: { in_wishlist: false, product_id: productId } },
        };
      }

      mockWishlist.push({
        id: Date.now(),
        product_id: productId,
        product_ref: `PRD-${productId}`,
        title_en: 'Wishlisted Product',
        title_bn: 'উইশলিস্টে যুক্ত পণ্য',
        slug: `product-${productId}`,
        saved_price: '500.00',
        current_price: '500.00',
        price_dropped: false,
        drop_amount: '0.00',
        stock_qty: 15,
        is_in_stock: true,
        image_url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=60',
        notify_on_drop: true,
        created_at: new Date().toISOString(),
      });

      return {
        status: 200,
        body: { data: { in_wishlist: true, product_id: productId } },
      };
    },
  },
  {
    method: 'DELETE',
    path: '/wishlist/:productId',
    handler: ({ params }) => {
      const productId = Number(params.productId);
      mockWishlist = mockWishlist.filter((w) => w.product_id !== productId);
      return {
        status: 200,
        body: { data: { removed: true, product_id: productId } },
      };
    },
  },
];

export function clearMockCart() {
  mockCartItems.length = 0;
}

export default handlers;
