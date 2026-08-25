/**
 * saler.js — Mock handlers for the Saler Dashboard & Analytics (Prompt 11.2).
 */

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

export default [
  {
    method: 'GET',
    path: '/saler/dashboard',
    handler: () => ({
      status: 200,
      body: {
        data: {
          store: { slug: 'tanvir-trends', curated_products_count: 18, shelves_count: 4 },
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
              { title_en: "Tanvir's Trend Store — Walton 43-inch Smart TV", units_sold: 22, custom_retail_price: 36500.0, total_margin_earned: 33000.0, stock_qty: 12 },
              { title_en: 'Heritage Dhakai Jamdani Saree (84 Count)', units_sold: 15, default_retail_price: 4500.0, total_margin_earned: 6000.0, stock_qty: 8 },
              { title_en: 'Himalaya Herbal Neem Face Wash 150ml', units_sold: 60, default_retail_price: 285.0, total_margin_earned: 2400.0, stock_qty: 0 },
            ],
            district_distribution: [
              { district: 'Dhaka', order_count: 34, gmv: 128500.0 },
              { district: 'Chittagong', order_count: 12, gmv: 46200.0 },
              { district: 'Sylhet', order_count: 6, gmv: 18300.0 },
            ],
          },
        },
      };
    },
  },
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
              recommendation: 'Sales velocity is high — raising your retail price by 5% would not slow conversions but adds ৳1,800 more profit per unit.',
              action: { label_en: 'Adjust Price', url: '/saler/sourcing' },
            },
            {
              type: 'HERO_PRODUCT',
              title: 'Jamdani Saree is your top converter',
              recommendation: 'This product drives 24% of your revenue. Feature it on your store banner to capture more first-time buyers.',
              action: { label_en: 'Edit Store Banner', url: '/saler/store-builder' },
            },
            {
              type: 'SLOW_MOVER',
              title: 'Neem Face Wash is out of stock',
              recommendation: 'This item sold out and customers are still searching for it. Message the supplier for a restock or swap it on your shelf.',
              action: { label_en: 'View Sourcing Catalog', url: '/saler/sourcing' },
            },
          ],
        },
      },
    }),
  },
];
