/**
 * supplier.js — Mock handlers for the Supplier / Manufacturer Dashboard (Prompt 11.1).
 */

const SEEDED_PRODUCTS = [
  {
    id: 1,
    ref: 'PRD-WALT-01',
    title_en: 'Walton 43-inch Android Smart TV',
    title_bn: 'ওয়ালটন ৪৩-ইঞ্চি অ্যান্ড্রয়েড স্মার্ট টিভি',
    category_name_en: 'Electronics',
    requires_fefo: false,
    stock_qty: 42,
    low_stock_threshold: 15,
    base_cost: 28500.0,
    wholesale_margin: 1500.0,
    default_retail_price: 35750.0,
    batches: [],
  },
  {
    id: 2,
    ref: 'PRD-101',
    title_en: 'Heritage Dhakai Jamdani Saree (84 Count)',
    title_bn: 'ঐতিহ্যবাহী ঢাকাই জামদানি শাড়ি (৮৪ কাউন্ট)',
    category_name_en: 'Fashion',
    requires_fefo: false,
    stock_qty: 8,
    low_stock_threshold: 10,
    base_cost: 3200.0,
    wholesale_margin: 400.0,
    default_retail_price: 4500.0,
    batches: [],
  },
  {
    id: 3,
    ref: 'PRD-SKIN-07',
    title_en: 'Himalaya Herbal Neem Face Wash 150ml',
    title_bn: 'হিমালয়া হারবাল নিম ফেস ওয়াশ ১৫০ মিলি',
    category_name_en: 'Beauty & Personal Care',
    requires_fefo: true,
    stock_qty: 0,
    low_stock_threshold: 20,
    base_cost: 180.0,
    wholesale_margin: 40.0,
    default_retail_price: 285.0,
    batches: [
      { batch_number: 'LOT-2026-JAN-04', qty: 0, exp_date: new Date(Date.now() + 86400000 * 20).toISOString() },
    ],
  },
  {
    id: 4,
    ref: 'PRD-RICE-12',
    title_en: 'Miniket Premium Rice 25kg Bag',
    title_bn: 'মিনিকেট প্রিমিয়াম চাল ২৫ কেজি ব্যাগ',
    category_name_en: 'Grocery',
    requires_fefo: true,
    stock_qty: 260,
    low_stock_threshold: 50,
    base_cost: 1650.0,
    wholesale_margin: 120.0,
    default_retail_price: 1950.0,
    batches: [
      { batch_number: 'LOT-2026-OCT-01', qty: 160, exp_date: new Date(Date.now() + 86400000 * 300).toISOString() },
      { batch_number: 'LOT-2026-DEC-02', qty: 100, exp_date: new Date(Date.now() + 86400000 * 45).toISOString() },
    ],
  },
];

const SEEDED_BATCHES = [
  {
    id: 101,
    batch_number: 'LOT-2026-OCT-01',
    product_id: 4,
    product_title_en: 'Miniket Premium Rice 25kg Bag',
    product_title_bn: 'মিনিকেট প্রিমিয়াম চাল ২৫ কেজি ব্যাগ',
    qty: 160,
    mfg_date: new Date(Date.now() - 86400000 * 40).toISOString(),
    exp_date: new Date(Date.now() + 86400000 * 300).toISOString(),
    days_to_expiry: 300,
    status: 'ACTIVE',
    warehouse_name: 'Tejgaon Central Depot',
  },
  {
    id: 102,
    batch_number: 'LOT-2026-DEC-02',
    product_id: 4,
    product_title_en: 'Miniket Premium Rice 25kg Bag',
    product_title_bn: 'মিনিকেট প্রিমিয়াম চাল ২৫ কেজি ব্যাগ',
    qty: 100,
    mfg_date: new Date(Date.now() - 86400000 * 10).toISOString(),
    exp_date: new Date(Date.now() + 86400000 * 45).toISOString(),
    days_to_expiry: 45,
    status: 'ACTIVE',
    warehouse_name: 'Bogura Regional Depot',
  },
  {
    id: 103,
    batch_number: 'LOT-2026-JAN-04',
    product_id: 3,
    product_title_en: 'Himalaya Herbal Neem Face Wash 150ml',
    product_title_bn: 'হিমালয়া হারবাল নিম ফেস ওয়াশ ১৫০ মিলি',
    qty: 18,
    mfg_date: new Date(Date.now() - 86400000 * 300).toISOString(),
    exp_date: new Date(Date.now() + 86400000 * 20).toISOString(),
    days_to_expiry: 20,
    status: 'ACTIVE',
    warehouse_name: 'Tejgaon Central Depot',
  },
  {
    id: 104,
    batch_number: 'LOT-2025-AUG-11',
    product_id: 3,
    product_title_en: 'Himalaya Herbal Neem Face Wash 150ml',
    product_title_bn: 'হিমালয়া হারবাল নিম ফেস ওয়াশ ১৫০ মিলি',
    qty: 0,
    mfg_date: new Date(Date.now() - 86400000 * 400).toISOString(),
    exp_date: new Date(Date.now() - 86400000 * 5).toISOString(),
    days_to_expiry: -5,
    status: 'EXPIRED',
    warehouse_name: 'Tejgaon Central Depot',
  },
];

const SEEDED_WAREHOUSES = [
  {
    id: 1,
    ref: 'WH-DHK-01',
    name: 'Tejgaon Central Depot',
    address_line: 'Plot 14, Block B, Tejgaon I/A',
    upazila: 'Tejgaon',
    district: 'Dhaka',
    division: 'Dhaka',
    priority: 90,
    latitude: 23.7639,
    longitude: 90.3931,
    sku_count: 3,
    total_units_stored: 310,
    is_active: true,
  },
  {
    id: 2,
    ref: 'WH-CTG-01',
    name: 'Agrabad Coastal Fulfilment Hub',
    address_line: 'Warehouse 6, Agrabad C/A',
    upazila: 'Agrabad',
    district: 'Chittagong',
    division: 'Chittagong',
    priority: 60,
    latitude: 22.3308,
    longitude: 91.8135,
    sku_count: 1,
    total_units_stored: 42,
    is_active: true,
  },
  {
    id: 3,
    ref: 'WH-BOG-01',
    name: 'Bogura Regional Depot',
    address_line: 'Sherpur Road Industrial Area',
    upazila: 'Sadar',
    district: 'Bogura',
    division: 'Rajshahi',
    priority: 40,
    latitude: 24.8465,
    longitude: 89.377,
    sku_count: 1,
    total_units_stored: 100,
    is_active: true,
  },
];

const SEEDED_FULFILMENT_QUEUE = [
  {
    id: 501,
    ref: 'ORD-9K2P4L',
    status: 'PROCESSING',
    payment_method: 'COD',
    recipient_name: 'Nusrat Jahan',
    recipient_phone: '+8801711998877',
    address_line: 'House 21, Road 5, Dhanmondi',
    district: 'Dhaka',
    warehouse_name: 'Tejgaon Central Depot',
    total_amount: 1950.0,
    tracking_number: null,
    carrier: null,
    items: [{ title_snapshot: 'Miniket Premium Rice 25kg Bag', batch_number: 'LOT-2026-OCT-01', batch_exp_date: new Date(Date.now() + 86400000 * 300).toISOString(), qty: 1 }],
  },
  {
    id: 502,
    ref: 'ORD-3X7T9Q',
    status: 'PENDING',
    payment_method: 'PREPAID',
    recipient_name: 'Kamal Hossain',
    recipient_phone: '+8801911223344',
    address_line: 'Shop 4, GEC Circle',
    district: 'Chittagong',
    warehouse_name: 'Agrabad Coastal Fulfilment Hub',
    total_amount: 35750.0,
    tracking_number: 'STF-88213092',
    carrier: 'STEADFAST',
    items: [{ title_snapshot: 'Walton 43-inch Android Smart TV', batch_number: null, batch_exp_date: null, qty: 1 }],
  },
];

const SEEDED_RESELLER_INSIGHTS = {
  top_salers: [
    { saler_id: 6, saler_name: 'Tanvir Hasan', store_name: "Tanvir's Trend Store", store_slug: 'tanvir-trends', curated_products_count: 18, total_orders_sold: 64, total_revenue_generated: 218500.0 },
    { saler_id: 7, saler_name: 'Sadia Islam', store_name: 'Sadia Beauty Corner', store_slug: 'sadia-beauty', curated_products_count: 9, total_orders_sold: 41, total_revenue_generated: 96200.0 },
    { saler_id: 8, saler_name: 'Rakib Ahmed', store_name: 'Rakib Electronics Hub', store_slug: 'rakib-electronics', curated_products_count: 5, total_orders_sold: 22, total_revenue_generated: 145300.0 },
  ],
  regional_distribution: [
    { district: 'Dhaka', total_sales: 210500.0, order_count: 88 },
    { district: 'Chittagong', total_sales: 96200.0, order_count: 34 },
    { district: 'Sylhet', total_sales: 45300.0, order_count: 15 },
    { district: 'Bogura', total_sales: 28100.0, order_count: 11 },
  ],
};

let physicalShop = { is_open: true, opening_time: '09:00', closing_time: '20:00' };

function filterInventory({ search, status }) {
  let items = SEEDED_PRODUCTS;
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter((p) => p.title_en.toLowerCase().includes(q) || p.ref.toLowerCase().includes(q));
  }
  if (status === 'low_stock') {
    items = items.filter((p) => p.stock_qty > 0 && p.stock_qty <= p.low_stock_threshold);
  } else if (status === 'out_of_stock') {
    items = items.filter((p) => p.stock_qty === 0);
  }
  return items;
}

function filterBatches(status) {
  if (!status || status === 'all') return SEEDED_BATCHES;
  if (status === 'EXPIRING_SOON') return SEEDED_BATCHES.filter((b) => b.days_to_expiry > 0 && b.days_to_expiry <= 60);
  return SEEDED_BATCHES.filter((b) => b.status === status);
}

export default [
  {
    method: 'GET',
    path: '/supplier/dashboard',
    handler: () => ({
      status: 200,
      body: {
        data: {
          metrics: {
            total_products: SEEDED_PRODUCTS.length,
            total_units: SEEDED_PRODUCTS.reduce((acc, p) => acc + p.stock_qty, 0),
            low_stock_count: SEEDED_PRODUCTS.filter((p) => p.stock_qty > 0 && p.stock_qty <= p.low_stock_threshold).length,
            out_of_stock_count: SEEDED_PRODUCTS.filter((p) => p.stock_qty === 0).length,
            pending_orders_count: SEEDED_FULFILMENT_QUEUE.filter((o) => o.status !== 'DELIVERED').length,
            today_earnings: 14500.0,
            total_settled_earnings: 284000.0,
            total_active_batches: SEEDED_BATCHES.filter((b) => b.status === 'ACTIVE').length,
            expiring_soon_count: SEEDED_BATCHES.filter((b) => b.days_to_expiry > 0 && b.days_to_expiry <= 60).length,
            expired_count: SEEDED_BATCHES.filter((b) => b.status === 'EXPIRED').length,
            total_warehouses: SEEDED_WAREHOUSES.length,
            active_curators_count: SEEDED_RESELLER_INSIGHTS.top_salers.length,
          },
          physical_shop: physicalShop,
        },
      },
    }),
  },
  {
    method: 'GET',
    path: '/supplier/inventory',
    handler: ({ query }) => ({ status: 200, body: { data: filterInventory(query || {}), meta: { total: SEEDED_PRODUCTS.length } } }),
  },
  {
    method: 'POST',
    path: '/supplier/inventory/stock',
    handler: ({ body }) => {
      const product = SEEDED_PRODUCTS.find((p) => String(p.id) === String(body?.productId));
      if (product) product.stock_qty = Number(body.stockQty);
      return { status: 200, body: { data: product } };
    },
  },
  {
    method: 'GET',
    path: '/supplier/batches',
    handler: ({ query }) => ({ status: 200, body: { data: filterBatches(query?.status), meta: { total: SEEDED_BATCHES.length } } }),
  },
  {
    method: 'POST',
    path: '/supplier/batches',
    handler: ({ body }) => {
      const product = SEEDED_PRODUCTS.find((p) => String(p.id) === String(body?.productId));
      const expDate = body?.expDate ? new Date(body.expDate) : new Date(Date.now() + 86400000 * 90);
      const daysToExpiry = Math.round((expDate.getTime() - Date.now()) / 86400000);
      const newBatch = {
        id: SEEDED_BATCHES.length ? Math.max(...SEEDED_BATCHES.map((b) => b.id)) + 1 : 1,
        batch_number: body?.batchNumber,
        product_id: body?.productId,
        product_title_en: product?.title_en || 'New Product',
        product_title_bn: product?.title_bn || '',
        qty: Number(body?.qty) || 0,
        mfg_date: body?.mfgDate || null,
        exp_date: expDate.toISOString(),
        days_to_expiry: daysToExpiry,
        status: 'ACTIVE',
        warehouse_name: SEEDED_WAREHOUSES.find((w) => String(w.id) === String(body?.warehouseNodeId))?.name || 'Central Depot',
      };
      SEEDED_BATCHES.unshift(newBatch);
      return { status: 201, body: { data: newBatch } };
    },
  },
  {
    method: 'POST',
    path: '/supplier/batches/:id/clearance',
    handler: ({ params, body }) => {
      const batch = SEEDED_BATCHES.find((b) => String(b.id) === params.id);
      return {
        status: 200,
        body: { data: { message: `Clearance sale activated at ${body?.discountPct ?? 20}% off.`, batch } },
      };
    },
  },
  {
    method: 'POST',
    path: '/supplier/batches/:id/recall',
    handler: ({ params, body }) => {
      const batch = SEEDED_BATCHES.find((b) => String(b.id) === params.id);
      if (batch) {
        batch.status = 'RECALLED';
        batch.recall_reason = body?.reason || '';
      }
      return { status: 200, body: { data: batch } };
    },
  },
  {
    method: 'GET',
    path: '/supplier/warehouses',
    handler: () => ({ status: 200, body: { data: SEEDED_WAREHOUSES, meta: { total: SEEDED_WAREHOUSES.length } } }),
  },
  {
    method: 'POST',
    path: '/supplier/warehouses',
    handler: ({ body }) => {
      const newWarehouse = {
        id: SEEDED_WAREHOUSES.length ? Math.max(...SEEDED_WAREHOUSES.map((w) => w.id)) + 1 : 1,
        ref: `WH-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
        name: body?.name,
        address_line: body?.addressLine,
        upazila: body?.upazila,
        district: body?.district,
        division: body?.division,
        priority: Number(body?.priority) || 0,
        latitude: null,
        longitude: null,
        sku_count: 0,
        total_units_stored: 0,
        is_active: true,
      };
      SEEDED_WAREHOUSES.push(newWarehouse);
      return { status: 201, body: { data: newWarehouse } };
    },
  },
  {
    method: 'GET',
    path: '/supplier/fulfilment',
    handler: () => ({ status: 200, body: { data: SEEDED_FULFILMENT_QUEUE, meta: { total: SEEDED_FULFILMENT_QUEUE.length } } }),
  },
  {
    method: 'POST',
    path: '/supplier/fulfilment/consign',
    handler: ({ body }) => {
      const order = SEEDED_FULFILMENT_QUEUE.find((o) => String(o.id) === String(body?.subOrderId));
      if (order) {
        order.tracking_number = `${(body?.carrier || 'STEADFAST').slice(0, 3)}-${Math.floor(10000000 + Math.random() * 89999999)}`;
        order.carrier = body?.carrier || 'STEADFAST';
      }
      return { status: 200, body: { data: { message: 'Consignment booked successfully.', order } } };
    },
  },
  {
    method: 'GET',
    path: '/supplier/resellers',
    handler: () => ({ status: 200, body: { data: SEEDED_RESELLER_INSIGHTS } }),
  },
  {
    method: 'GET',
    path: '/supplier/store-status',
    handler: () => ({ status: 200, body: { data: physicalShop } }),
  },
  {
    method: 'PATCH',
    path: '/supplier/store-status',
    handler: ({ body }) => {
      physicalShop = { ...physicalShop, is_open: Boolean(body?.isOpen) };
      return { status: 200, body: { data: physicalShop } };
    },
  },
];
