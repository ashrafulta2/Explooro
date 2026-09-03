/**
 * saler.js — Mock handlers for the Saler Dashboard, Analytics, Products, Orders, Store Status, Payouts & Quests.
 */
import { listMockChatThreads, appendMockMessage, SELF } from './chat.js';

const SEEDED_ONBOARDING_STEPS = [
  {
    id: 'source_product',
    title_en: 'Source your first product',
    desc_en: 'Browse the wholesale catalog and add a product to your virtual storefront.',
    completed: true,
    video_duration: '15s',
    video_title_en: 'How to source your first product',
    action_label_en: 'Browse Catalog',
    action_url: '/saler/sourcing',
  },
  {
    id: 'customize_store',
    title_en: 'Customize your storefront',
    desc_en: 'Set your store logo, banner, and vanity slug so customers recognize your brand.',
    completed: true,
    video_duration: '15s',
    video_title_en: 'Customizing your storefront in under a minute',
    action_label_en: 'Open Store Builder',
    action_url: '/saler/store-builder',
  },
  {
    id: 'share_store',
    title_en: 'Share your store link',
    desc_en: 'Download WhatsApp-ready flyers and share your storefront with your network.',
    completed: false,
    video_duration: '15s',
    video_title_en: 'Getting your first customers via WhatsApp',
    action_label_en: 'Get Flyers',
    action_url: '/saler/social-kit',
  },
  {
    id: 'first_sale',
    title_en: 'Make your first sale',
    desc_en: 'Once an order lands, track fulfilment and withdraw your profit from the vault.',
    completed: false,
    video_duration: '15s',
    video_title_en: 'What happens after your first sale',
    action_label_en: 'View Orders',
    action_url: '/saler/orders',
  },
];

function buildTrends(range) {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const points = Math.min(days, 30);
  const step = Math.max(1, Math.round(days / points));
  const trends = [];
  for (let i = points - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * step * 86400000);
    const gross = 3000 + Math.round(Math.random() * 6000);
    const net = Math.round(gross * (0.18 + Math.random() * 0.1));
    trends.push({
      label: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      gross_sales: gross,
      net_profit: net,
    });
  }
  return trends;
}

// ── In-Memory State for Saler Features ──────────────────────────────────────

let mockSalerProducts = [
  {
    id: 1,
    product_id: 1,
    title_en: 'Authentic Handloom Dhakai Jamdani Saree (84 Count)',
    title_bn: 'ঐতিহ্যবাহী ঢাকাই জামদানি শাড়ি (৮৪ কাউন্ট)',
    category: 'Clothing',
    supplier_id: 1,
    supplier_name: 'Dhakai Heritage Weavers Ltd.',
    base_wholesale_price: 2800.0,
    default_retail_price: 3500.0,
    custom_retail_price: 3650.0,
    stock_qty: 18,
    is_active: true,
    is_featured: true,
    shelf_name: 'Hero Showcase',
    image_url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=60',
    sales_count: 24,
  },
  {
    id: 2,
    product_id: 2,
    title_en: 'Pure Rajshahi Silk Dupatta / Scarf (Zari Border)',
    title_bn: 'খাঁটি রাজশাহী সিল্ক ওড়না / স্কার্ফ (জরি পাড়)',
    category: 'Clothing',
    supplier_id: 2,
    supplier_name: 'Rajshahi Silk Emporium',
    base_wholesale_price: 950.0,
    default_retail_price: 1250.0,
    custom_retail_price: 1350.0,
    stock_qty: 32,
    is_active: true,
    is_featured: true,
    shelf_name: 'Trending Apparel',
    image_url: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=500&auto=format&fit=crop&q=60',
    sales_count: 19,
  },
  {
    id: 3,
    product_id: 3,
    title_en: 'Tangail Soft Cotton Daily Wear Saree',
    title_bn: 'টাঙ্গাইল সফট সুতি শাড়ি',
    category: 'Clothing',
    supplier_id: 1,
    supplier_name: 'Dhakai Heritage Weavers Ltd.',
    base_wholesale_price: 1100.0,
    default_retail_price: 1450.0,
    custom_retail_price: 1450.0,
    stock_qty: 12,
    is_active: true,
    is_featured: false,
    shelf_name: 'Daily Wear',
    image_url: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=500&auto=format&fit=crop&q=60',
    sales_count: 14,
  },
  {
    id: 4,
    product_id: 4,
    title_en: 'Walton 43-inch 4K Frameless Android Smart TV',
    title_bn: 'ওয়ালটন ৪৩-ইঞ্চি ৪কে ফ্রেমলেস অ্যান্ড্রয়েড স্মার্ট টিভি',
    category: 'Electronics',
    supplier_id: 4,
    supplier_name: 'Walton Hi-Tech Industries',
    base_wholesale_price: 31000.0,
    default_retail_price: 36500.0,
    custom_retail_price: 37200.0,
    stock_qty: 5,
    is_active: true,
    is_featured: true,
    shelf_name: 'Home Electronics',
    image_url: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=500&auto=format&fit=crop&q=60',
    sales_count: 8,
  },
  {
    id: 5,
    product_id: 5,
    title_en: 'Handcrafted Brass Tea Kettle & Cup Set (6 pcs)',
    title_bn: 'হস্তশিল্প পিতলের চা কেটলি ও কাপ সেট',
    category: 'Home & Kitchen',
    supplier_id: 5,
    supplier_name: 'Dhamrai Metal Crafts',
    base_wholesale_price: 2400.0,
    default_retail_price: 3200.0,
    custom_retail_price: 3200.0,
    stock_qty: 0,
    is_active: false,
    is_featured: false,
    shelf_name: 'Artisan Decor',
    image_url: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=500&auto=format&fit=crop&q=60',
    sales_count: 6,
  },
];

let mockSalerStoreStatus = {
  has_physical_shop: true,
  is_open: true,
  show_public_status: true,
  shop_name: 'Tanvir Trends Flagship Hub & Pickup Counter',
  address: 'Shop 42, Level 3, Eastern Plaza, Hatirpool',
  district: 'Dhaka',
  phone: '+8801711223344',
  open_time: '10:00 AM',
  close_time: '08:30 PM',
  pickup_enabled: true,
  pickup_notes: 'Customers can inspect products and pick up orders directly at our counter with their Order ID.',
  closed_days: ['Friday'],
  weekly_schedule: {
    Saturday: { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' },
    Sunday: { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' },
    Monday: { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' },
    Tuesday: { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' },
    Wednesday: { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' },
    Thursday: { is_open: true, open_time: '10:00 AM', close_time: '08:30 PM' },
    Friday: { is_open: false, open_time: '10:00 AM', close_time: '08:30 PM' },
  },
};

let mockSalerOrders = [
  {
    id: 1,
    order_ref: 'ORD-DH-90123',
    placed_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    customer_name: 'Sadia Rahman',
    customer_phone: '+8801812345678',
    shipping_address: 'House 14, Road 7, Dhanmondi R/A, Dhaka',
    district: 'Dhaka',
    payment_method: 'COD',
    payment_status: 'PENDING',
    fulfillment_status: 'SHIPPED',
    courier_name: 'Pathao Logistics',
    tracking_number: 'PTH-DH-882194',
    escrow_status: 'LOCKED',
    total_retail_amount: 3650.0,
    total_wholesale_cost: 2800.0,
    saler_commission_earned: 850.0,
    items: [
      {
        product_id: 1,
        title_en: 'Authentic Handloom Dhakai Jamdani Saree (84 Count)',
        title_bn: 'ঐতিহ্যবাহী ঢাকাই জামদানি শাড়ি',
        qty: 1,
        wholesale_price: 2800.0,
        retail_price: 3650.0,
        saler_profit: 850.0,
        image_url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=200&auto=format&fit=crop&q=60',
      },
    ],
  },
  {
    id: 2,
    order_ref: 'ORD-CTG-88412',
    placed_at: new Date(Date.now() - 3600000 * 8).toISOString(),
    customer_name: 'Farhan Kabir',
    customer_phone: '+8801719876543',
    shipping_address: 'Plot 4, Road 12, GEC Circle, Nasirabad, Chattogram',
    district: 'Chattogram',
    payment_method: 'BKASH',
    payment_status: 'PAID',
    fulfillment_status: 'DELIVERED',
    courier_name: 'Steadfast Courier',
    tracking_number: 'STF-CTG-992100',
    escrow_status: 'RELEASED',
    total_retail_amount: 4050.0,
    total_wholesale_cost: 2850.0,
    saler_commission_earned: 1200.0,
    items: [
      {
        product_id: 2,
        title_en: 'Pure Rajshahi Silk Dupatta (Zari Border)',
        title_bn: 'খাঁটি রাজশাহী সিল্ক ওড়না',
        qty: 3,
        wholesale_price: 950.0,
        retail_price: 1350.0,
        saler_profit: 1200.0,
        image_url: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=200&auto=format&fit=crop&q=60',
      },
    ],
  },
  {
    id: 3,
    order_ref: 'ORD-SYL-77190',
    placed_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    customer_name: 'Tahmina Akter',
    customer_phone: '+8801911445566',
    shipping_address: 'Flat B3, Green Villa, Zindabazar, Sylhet',
    district: 'Sylhet',
    payment_method: 'COD',
    payment_status: 'PENDING',
    fulfillment_status: 'PROCESSING',
    courier_name: 'RedX Delivery',
    tracking_number: 'RDX-SYL-551239',
    escrow_status: 'LOCKED',
    total_retail_amount: 1450.0,
    total_wholesale_cost: 1100.0,
    saler_commission_earned: 350.0,
    items: [
      {
        product_id: 3,
        title_en: 'Tangail Soft Cotton Daily Wear Saree',
        title_bn: 'টাঙ্গাইল সফট সুতি শাড়ি',
        qty: 1,
        wholesale_price: 1100.0,
        retail_price: 1450.0,
        saler_profit: 350.0,
        image_url: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=200&auto=format&fit=crop&q=60',
      },
    ],
  },
  {
    id: 4,
    order_ref: 'ORD-DHK-66521',
    placed_at: new Date(Date.now() - 3600000 * 48).toISOString(),
    customer_name: 'Mehedi Hasan',
    customer_phone: '+8801511223344',
    shipping_address: 'House 8, Sector 4, Uttara, Dhaka',
    district: 'Dhaka',
    payment_method: 'NAGAD',
    payment_status: 'PAID',
    fulfillment_status: 'DELIVERED',
    courier_name: 'Pathao Logistics',
    tracking_number: 'PTH-DH-771920',
    escrow_status: 'RELEASED',
    total_retail_amount: 37200.0,
    total_wholesale_cost: 31000.0,
    saler_commission_earned: 6200.0,
    items: [
      {
        product_id: 4,
        title_en: 'Walton 43-inch 4K Frameless Android Smart TV',
        title_bn: 'ওয়ালটন ৪৩-ইঞ্চি ৪কে স্মার্ট টিভি',
        qty: 1,
        wholesale_price: 31000.0,
        retail_price: 37200.0,
        saler_profit: 6200.0,
        image_url: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=200&auto=format&fit=crop&q=60',
      },
    ],
  },
];

let mockSalerPayouts = [
  {
    id: 1,
    ref: 'PAY-BK-88210',
    amount: 5000.0,
    method: 'BKASH',
    account_number: '01711223344',
    account_name: 'Tanvir Ahmed',
    status: 'COMPLETED',
    requested_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    completed_at: new Date(Date.now() - 86400000 * 4).toISOString(),
    rejection_reason: null,
  },
  {
    id: 2,
    ref: 'PAY-NG-77341',
    amount: 12000.0,
    method: 'NAGAD',
    account_number: '01811998877',
    account_name: 'Tanvir Ahmed',
    status: 'COMPLETED',
    requested_at: new Date(Date.now() - 86400000 * 12).toISOString(),
    completed_at: new Date(Date.now() - 86400000 * 11).toISOString(),
    rejection_reason: null,
  },
  {
    id: 3,
    ref: 'PAY-BNK-66120',
    amount: 25000.0,
    method: 'BANK',
    account_number: '102-151-0028911',
    account_name: 'Tanvir Ahmed',
    bank_name: 'Dutch-Bangla Bank PLC',
    status: 'PROCESSING',
    requested_at: new Date(Date.now() - 3600000 * 6).toISOString(),
    completed_at: null,
    rejection_reason: null,
  },
];

let mockSalerQuests = [
  {
    id: 'quest_1',
    title_en: 'Daily Store Check & Live Open',
    title_bn: 'দৈনিক দোকান চেক ও ওপেন স্ট্যাটাস নিশ্চিতকরণ',
    desc_en: 'Check your store shelves and ensure showroom hours are updated today.',
    category: 'daily',
    reward_coins: 10,
    target_count: 1,
    current_count: 1,
    is_completed: true,
    is_claimed: false,
    icon: '🏪',
  },
  {
    id: 'quest_2',
    title_en: 'Source 3 Wholesale Products',
    title_bn: 'হোলসেল ক্যাটালগ থেকে ৩টি পণ্য যুক্ত করুন',
    desc_en: 'Explore the sourcing catalog and add at least 3 high-margin products to your shelves.',
    category: 'daily',
    reward_coins: 30,
    target_count: 3,
    current_count: 3,
    is_completed: true,
    is_claimed: true,
    icon: '🔍',
  },
  {
    id: 'quest_3',
    title_en: 'Share Social Kit Flyer on WhatsApp',
    title_bn: 'হোয়াটসঅ্যাপ স্টোরিতে সোশ্যাল ফ্লায়ার শেয়ার করুন',
    desc_en: 'Generate a tracked vector flyer with QR code and share to WhatsApp status or Facebook.',
    category: 'daily',
    reward_coins: 25,
    target_count: 1,
    current_count: 0,
    is_completed: false,
    is_claimed: false,
    icon: '📣',
  },
  {
    id: 'quest_4',
    title_en: 'Complete 2 Delivered Orders this Week',
    title_bn: 'এই সপ্তাহে ২টি সফল ডেলিভারি সম্পন্ন করুন',
    desc_en: 'Earn seller commission on 2 confirmed and delivered customer orders.',
    category: 'weekly',
    reward_coins: 75,
    target_count: 2,
    current_count: 2,
    is_completed: true,
    is_claimed: false,
    icon: '📦',
  },
  {
    id: 'quest_5',
    title_en: 'Reach ৳25,000 Monthly Sales Volume',
    title_bn: 'মাসিক ২৫,০০০ টাকার মোট বিক্রি স্পর্শ করুন',
    desc_en: 'Unlock Gold VIP tier status and a 2.5% additional sponsor commission booster.',
    category: 'milestone',
    reward_coins: 200,
    target_count: 25000,
    current_count: 18500,
    is_completed: false,
    is_claimed: false,
    icon: '🏆',
  },
];

let mockSalerLeaderboard = [
  { rank: 1, saler_name: 'Nusrat Jahan', store_slug: 'nusrat-luxe', sales_count: 142, gmv: 348500.0, net_profit: 68200.0, tier_badge: 'PLATINUM_DIRECTOR', avatar: '👑', is_current_user: false },
  { rank: 2, saler_name: 'Rafiqul Islam', store_slug: 'dhaka-bazaar', sales_count: 118, gmv: 289000.0, net_profit: 54100.0, tier_badge: 'GOLD_VIP', avatar: '🥈', is_current_user: false },
  { rank: 3, saler_name: 'Sabrina Mostafa', store_slug: 'craft-heritage', sales_count: 96, gmv: 215400.0, net_profit: 42300.0, tier_badge: 'GOLD_VIP', avatar: '🥉', is_current_user: false },
  { rank: 4, saler_name: 'Tanvir Ahmed', store_slug: 'tanvir-trends', sales_count: 64, gmv: 148500.0, net_profit: 24500.0, tier_badge: 'SILVER_PRO', avatar: '⚡', is_current_user: true },
  { rank: 5, saler_name: 'Kamrul Hasan', store_slug: 'bengal-loom', sales_count: 58, gmv: 132000.0, net_profit: 21400.0, tier_badge: 'SILVER_PRO', avatar: '⭐', is_current_user: false },
  { rank: 6, saler_name: 'Farzana Chowdhury', store_slug: 'elegance-bd', sales_count: 45, gmv: 98000.0, net_profit: 17200.0, tier_badge: 'BRONZE_SELLER', avatar: '✨', is_current_user: false },
  { rank: 7, saler_name: 'Ashraf Ali', store_slug: 'gadget-galaxy', sales_count: 38, gmv: 84500.0, net_profit: 14800.0, tier_badge: 'BRONZE_SELLER', avatar: '📱', is_current_user: false },
];

export default [
  // 1. Unified Dashboard
  {
    method: 'GET',
    path: '/saler/dashboard',
    handler: () => ({
      status: 200,
      body: {
        data: {
          store: { slug: 'tanvir-trends', curated_products_count: mockSalerProducts.length, shelves_count: 4 },
          metrics: {
            today_net_profit: 2450.0,
            today_gross_sales: 12800.0,
            today_orders_count: 4,
            profit_30d: 68500.0,
            total_orders: 64,
            available_balance: 24500.0,
            escrow_balance: 8200.0,
            total_link_clicks: 1320,
            pending_fulfillment_count: 3,
            unread_messages_count: 2,
            referral_count: 5,
            active_ads_count: 1,
          },
          onboarding: {
            completed_steps_count: SEEDED_ONBOARDING_STEPS.filter((s) => s.completed).length,
            total_steps: SEEDED_ONBOARDING_STEPS.length,
            steps: SEEDED_ONBOARDING_STEPS,
          },
        },
      },
    }),
  },

  // 2. Analytics
  {
    method: 'GET',
    path: '/saler/analytics',
    handler: ({ query }) => {
      const range = query?.range || '30d';
      const trends = buildTrends(range);
      const totalGross = trends.reduce((acc, t) => acc + t.gross_sales, 0);
      const totalNet = trends.reduce((acc, t) => acc + t.net_profit, 0);
      return {
        status: 200,
        body: {
          data: {
            summary: {
              total_gross_sales: totalGross,
              total_net_profit: totalNet,
              total_orders: 64,
              conversion_rate_pct: 3.8,
              total_visitors: 1320,
            },
            trends,
            traffic_sources: [
              { source: 'WhatsApp', percentage: 45, color: '#22C55E' },
              { source: 'Facebook', percentage: 30, color: '#2563EB' },
              { source: 'Direct Link', percentage: 15, color: '#F59E0B' },
              { source: 'Search', percentage: 10, color: '#A855F7' },
            ],
            top_products: [
              { title_en: "Walton 43-inch 4K Frameless Android Smart TV", units_sold: 22, custom_retail_price: 37200.0, total_margin_earned: 33000.0, stock_qty: 5 },
              { title_en: 'Authentic Handloom Dhakai Jamdani Saree', units_sold: 15, default_retail_price: 3650.0, total_margin_earned: 12750.0, stock_qty: 18 },
              { title_en: 'Pure Rajshahi Silk Dupatta / Scarf', units_sold: 60, default_retail_price: 1350.0, total_margin_earned: 24000.0, stock_qty: 32 },
            ],
            district_distribution: [
              { district: 'Dhaka', order_count: 34, gmv: 128500.0 },
              { district: 'Chattogram', order_count: 12, gmv: 46200.0 },
              { district: 'Sylhet', order_count: 6, gmv: 18300.0 },
            ],
          },
        },
      };
    },
  },

  // 3. Onboarding & Growth Assistant
  {
    method: 'GET',
    path: '/saler/onboarding',
    handler: () => ({
      status: 200,
      body: {
        data: {
          completed_steps_count: SEEDED_ONBOARDING_STEPS.filter((s) => s.completed).length,
          total_steps: SEEDED_ONBOARDING_STEPS.length,
          steps: SEEDED_ONBOARDING_STEPS,
        },
      },
    }),
  },
  {
    method: 'GET',
    path: '/saler/growth-assistant',
    handler: () => ({
      status: 200,
      body: {
        data: {
          recommendations: [
            {
              type: 'PRICE_OPPORTUNITY',
              title: 'Walton Smart TV is under-priced vs. demand',
              recommendation: 'Sales velocity is high — raising your retail price by ৳500 adds more profit with zero conversion drop.',
              action: { label_en: 'Adjust Price', url: '/saler/products' },
            },
            {
              type: 'HERO_PRODUCT',
              title: 'Jamdani Saree is your top converter',
              recommendation: 'This product drives 28% of your margin. Generate a flyer to broadcast to your WhatsApp VIP list.',
              action: { label_en: 'Create Flyer', url: '/saler/social-kit' },
            },
            {
              type: 'SLOW_MOVER',
              title: 'Brass Tea Kettle is out of stock',
              recommendation: 'This item is out of stock. Swap it for another trending kitchen item from the wholesale catalog.',
              action: { label_en: 'Browse Catalog', url: '/saler/sourcing' },
            },
          ],
        },
      },
    }),
  },

  // 4. Saler Curated Products (My Products)
  {
    method: 'GET',
    path: '/saler/products',
    handler: ({ query }) => {
      let filtered = [...mockSalerProducts];
      if (query?.category && query.category !== 'all') {
        filtered = filtered.filter((p) => p.category.toLowerCase() === query.category.toLowerCase());
      }
      if (query?.search) {
        const q = query.search.toLowerCase();
        filtered = filtered.filter(
          (p) => p.title_en.toLowerCase().includes(q) || (p.title_bn && p.title_bn.includes(q))
        );
      }
      if (query?.in_stock === 'true' || query?.in_stock === true) {
        filtered = filtered.filter((p) => p.stock_qty > 0);
      }
      return {
        status: 200,
        body: {
          data: {
            products: filtered,
            total_count: filtered.length,
            summary: {
              total_curated: mockSalerProducts.length,
              in_stock_count: mockSalerProducts.filter((p) => p.stock_qty > 0).length,
              out_of_stock_count: mockSalerProducts.filter((p) => p.stock_qty === 0).length,
              avg_margin_pct: '24.8',
            },
          },
        },
      };
    },
  },
  {
    method: 'PATCH',
    path: '/saler/products/:id',
    handler: ({ params, body }) => {
      const id = Number(params.id);
      const idx = mockSalerProducts.findIndex((p) => p.id === id || p.product_id === id);
      if (idx === -1) {
        return { status: 404, body: { error: 'Product not found in curated store' } };
      }
      mockSalerProducts[idx] = {
        ...mockSalerProducts[idx],
        ...body,
      };
      return {
        status: 200,
        body: {
          data: {
            product: mockSalerProducts[idx],
            message: 'Product updated successfully',
          },
        },
      };
    },
  },
  {
    method: 'DELETE',
    path: '/saler/products/:id',
    handler: ({ params }) => {
      const id = Number(params.id);
      mockSalerProducts = mockSalerProducts.filter((p) => p.id !== id && p.product_id !== id);
      return {
        status: 200,
        body: { data: { success: true, message: 'Product removed from store' } },
      };
    },
  },

  // 5. Saler Physical Store Status
  {
    method: 'GET',
    path: '/saler/store-status',
    handler: () => ({
      status: 200,
      body: { data: mockSalerStoreStatus },
    }),
  },
  {
    method: 'PATCH',
    path: '/saler/store-status',
    handler: ({ body }) => {
      mockSalerStoreStatus = {
        ...mockSalerStoreStatus,
        ...body,
      };
      return {
        status: 200,
        body: { data: mockSalerStoreStatus, message: 'Physical shop settings updated' },
      };
    },
  },

  // 6. Saler Orders
  {
    method: 'GET',
    path: '/saler/orders',
    handler: ({ query }) => {
      let filtered = [...mockSalerOrders];
      if (query?.status && query.status !== 'ALL') {
        filtered = filtered.filter((o) => o.fulfillment_status === query.status);
      }
      if (query?.search) {
        const q = query.search.toLowerCase();
        filtered = filtered.filter(
          (o) =>
            o.order_ref.toLowerCase().includes(q) ||
            o.customer_name.toLowerCase().includes(q) ||
            o.customer_phone.includes(q)
        );
      }
      const totalCommission = mockSalerOrders.reduce((sum, o) => sum + o.saler_commission_earned, 0);
      return {
        status: 200,
        body: {
          data: {
            orders: filtered,
            total_orders: mockSalerOrders.length,
            summary: {
              total_orders: mockSalerOrders.length,
              pending_fulfillment: mockSalerOrders.filter((o) => o.fulfillment_status === 'PROCESSING').length,
              in_transit_count: mockSalerOrders.filter((o) => o.fulfillment_status === 'SHIPPED').length,
              delivered_count: mockSalerOrders.filter((o) => o.fulfillment_status === 'DELIVERED').length,
              total_commission_earned: totalCommission,
            },
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/saler/orders/:id',
    handler: ({ params }) => {
      const order = mockSalerOrders.find((o) => String(o.id) === String(params.id) || o.order_ref === params.id);
      if (!order) return { status: 404, body: { error: 'Order not found' } };
      return {
        status: 200,
        body: { data: { order } },
      };
    },
  },

  // 7. Saler Vault Withdrawals & Payouts
  {
    method: 'GET',
    path: '/saler/vault/payouts',
    handler: () => ({
      status: 200,
      body: {
        data: {
          payouts: mockSalerPayouts,
          summary: {
            available_balance: 24500.0,
            pending_payout_amount: mockSalerPayouts
              .filter((p) => p.status === 'PROCESSING' || p.status === 'PENDING')
              .reduce((sum, p) => sum + p.amount, 0),
            lifetime_withdrawn_amount: mockSalerPayouts
              .filter((p) => p.status === 'COMPLETED')
              .reduce((sum, p) => sum + p.amount, 0),
          },
        },
      },
    }),
  },
  {
    method: 'POST',
    path: '/saler/vault/payouts',
    handler: ({ body }) => {
      const amount = Number(body?.amount || 0);
      if (amount < 100) {
        return { status: 400, body: { error: 'Minimum payout withdrawal is ৳100' } };
      }
      if (amount > 24500) {
        return { status: 400, body: { error: 'Withdrawal amount exceeds available balance' } };
      }
      const newPayout = {
        id: mockSalerPayouts.length + 1,
        ref: `PAY-${(body?.method || 'BKASH').slice(0, 2)}-${Date.now().toString().slice(-5)}`,
        amount,
        method: body?.method || 'BKASH',
        account_number: body?.account_number || '01700000000',
        account_name: body?.account_name || 'Saler Account',
        bank_name: body?.bank_name || null,
        status: 'PROCESSING',
        requested_at: new Date().toISOString(),
        completed_at: null,
        rejection_reason: null,
      };
      mockSalerPayouts.unshift(newPayout);
      return {
        status: 201,
        body: { data: { payout: newPayout, message: 'Withdrawal request submitted successfully' } },
      };
    },
  },
  {
    method: 'POST',
    path: '/saler/vault/payouts/:id/cancel',
    handler: ({ params }) => {
      const id = Number(params.id);
      const payout = mockSalerPayouts.find((p) => p.id === id);
      if (!payout) return { status: 404, body: { error: 'Payout request not found' } };
      if (payout.status !== 'PROCESSING' && payout.status !== 'PENDING') {
        return { status: 400, body: { error: 'Only pending or processing payouts can be cancelled' } };
      }
      payout.status = 'CANCELLED';
      return {
        status: 200,
        body: { data: { success: true, message: 'Payout request cancelled' } },
      };
    },
  },

  // 8. Saler Quests & Leaderboard
  {
    method: 'GET',
    path: '/saler/quests',
    handler: () => ({
      status: 200,
      body: {
        data: {
          quests: mockSalerQuests,
          coin_balance: 1450,
          daily_streak_days: 4,
          completed_today_count: mockSalerQuests.filter((q) => q.is_completed).length,
        },
      },
    }),
  },
  {
    method: 'POST',
    path: '/saler/quests/:id/claim',
    handler: ({ params }) => {
      const quest = mockSalerQuests.find((q) => q.id === params.id);
      if (!quest) return { status: 404, body: { error: 'Quest not found' } };
      if (!quest.is_completed) return { status: 400, body: { error: 'Quest is not yet completed' } };
      if (quest.is_claimed) return { status: 400, body: { error: 'Reward already claimed' } };
      quest.is_claimed = true;
      return {
        status: 200,
        body: {
          data: {
            quest,
            reward_coins: quest.reward_coins,
            message: `Claimed +${quest.reward_coins} Loyalty Coins!`,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/saler/leaderboard',
    handler: () => ({
      status: 200,
      body: {
        data: {
          leaderboard: mockSalerLeaderboard,
          current_user_rank: 4,
          current_user_sales: 64,
          current_user_gmv: 148500.0,
          podium_rewards: {
            gold: '৳5,000 Cash Bonus + Verified Gold Crown',
            silver: '৳3,000 Cash Bonus + Silver Shield',
            bronze: '৳1,500 Cash Bonus + Bronze Star',
          },
        },
      },
    }),
  },

  // 9. Social Kit Templates & Links
  {
    method: 'GET',
    path: '/saler/social-kit/templates',
    handler: () => ({
      status: 200,
      body: {
        data: {
          templates: [
            { id: 't_square', name: 'Social Post 1:1', width: 1080, height: 1080 },
            { id: 't_story', name: 'WhatsApp Story 9:16', width: 1080, height: 1920 },
            { id: 't_print', name: 'A4 Print Flyer', width: 1240, height: 1754 },
            { id: 't_banner', name: 'WhatsApp Header', width: 1200, height: 630 },
          ],
        },
      },
    }),
  },
  {
    method: 'POST',
    path: '/saler/social-kit/links',
    handler: ({ body }) => {
      const code = `exp-${Math.random().toString(36).slice(2, 7)}`;
      return {
        status: 201,
        body: {
          code,
          short_url: `/s/${code}`,
          full_url: `https://explooro.com/s/${code}`,
          product_id: body?.product_id || 1,
        },
      };
    },
  },

  // 10. Unified Inbox Threads & Messages
  {
    method: 'GET',
    path: '/saler/inbox/threads',
    handler: () => ({
      status: 200,
      body: { data: { items: listMockChatThreads() } },
    }),
  },
  {
    method: 'POST',
    path: '/saler/inbox/threads/:id/send',
    handler: ({ params, body }) => ({
      status: 201,
      body: {
        data: {
          message: appendMockMessage({
            threadId: Number(params.id),
            senderId: SELF,
            content: body?.content || '',
          }),
        },
      },
    }),
  },
  {
    method: 'POST',
    path: '/saler/inbox/threads/:id/send-product',
    handler: ({ params, body }) => ({
      status: 201,
      body: {
        data: {
          message: appendMockMessage({
            threadId: Number(params.id),
            senderId: SELF,
            content: 'Authentic Handloom Dhakai Jamdani Saree',
            msgType: 'PRODUCT_CARD',
            payloadJson: {
              productId: body?.product_id || 1,
              productTitle: 'Authentic Handloom Dhakai Jamdani Saree',
              price: '3650.00',
              checkoutUrl: '/checkout/wa/mock-wa-token-123',
            },
          }),
        },
      },
    }),
  },
];
