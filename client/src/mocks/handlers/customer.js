/**
 * customer.js — Mock API handlers for Customer Portal, Following Feed & Follow Actions (Prompt 11.3).
 */

import products from '../fixtures/products.json' with { type: 'json' };

// Initial realistic Bangladeshi stores
let mockFollowedStores = [
  {
    id: 101,
    ref: 'VS-PRIYO01',
    slug: 'priyo-collection',
    shop_name: 'Priyo Collection (প্রিয় কালেকশন)',
    bio: 'Authentic Bangladeshi Handloom, Tangail Sarees & Traditional Wear · Direct from artisan weavers.',
    total_products: 42,
    rating: 4.9,
    rating_count: 196,
    followers_count: 1840,
    category: 'fashion',
    category_label: 'Sarees & Fashion',
    category_label_bn: 'শাড়ি ও ফ্যাশন',
    district: 'Tangail / Dhaka',
    is_following: true,
    is_verified: true,
    has_physical_shop: true,
    open_status: 'OPEN',
    avatar_icon: '👗',
    followed_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    preview_products: [
      { id: 1, title: 'Authentic Dhakai Jamdani Saree', price: '3,850', img: '/media/jamdani.webp' },
      { id: 2, title: 'Tangail Handloom Cotton Saree', price: '1,450', img: '/media/tangail.webp' },
    ],
  },
  {
    id: 102,
    ref: 'VS-RAJ02',
    slug: 'rajshahi-silk-emporium',
    shop_name: 'Rajshahi Silk Emporium (রাজশাহী সিল্ক)',
    bio: 'Pure Grade-A mulberry silk sarees, dupattas, and panjabi fabrics certified by Bangladesh Silk Board.',
    total_products: 28,
    rating: 4.8,
    rating_count: 192,
    followers_count: 1290,
    category: 'handloom',
    category_label: 'Pure Silk',
    category_label_bn: 'খাঁটি সিল্ক',
    district: 'Rajshahi',
    is_following: true,
    is_verified: true,
    has_physical_shop: true,
    open_status: 'OPEN',
    avatar_icon: '🧵',
    followed_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    preview_products: [
      { id: 3, title: 'Pure Rajshahi Silk Dupatta', price: '1,200', img: '/media/silk.webp' },
      { id: 4, title: 'Silk Embroidered Panjabi', price: '2,800', img: '/media/panjabi.webp' },
    ],
  },
];

let mockSuggestedStores = [
  {
    id: 103,
    ref: 'VS-GADGET03',
    slug: 'bangla-smart-gadgets',
    shop_name: 'Bangla Smart Tech (স্মার্ট গ্যাজেটস)',
    bio: 'Direct supplier of TWS earbuds, smartwatches, power banks & mobile accessories with 1-year brand warranty.',
    total_products: 65,
    rating: 4.7,
    rating_count: 188,
    followers_count: 3120,
    category: 'electronics',
    category_label: 'Gadgets & Audio',
    category_label_bn: 'গ্যাজেট ও অডিও',
    district: 'Dhaka',
    is_following: false,
    is_verified: true,
    has_physical_shop: false,
    open_status: 'ONLINE',
    avatar_icon: '🎧',
    preview_products: [
      { id: 5, title: 'ANC Wireless Earbuds Pro', price: '1,890', img: '/media/earbuds.webp' },
      { id: 6, title: '10000mAh Magnetic Power Bank', price: '1,450', img: '/media/powerbank.webp' },
    ],
  },
  {
    id: 104,
    ref: 'VS-ORGANIC04',
    slug: 'sundarbans-pure-organics',
    shop_name: 'Sundarbans Natural Foods (সুন্দরবন মধু ও অর্গানিক)',
    bio: '100% pure raw wild honey, cold pressed mustard oil, organic ghee, and natural village spices.',
    total_products: 34,
    rating: 4.95,
    rating_count: 198,
    followers_count: 2450,
    category: 'food',
    category_label: 'Pure Organic Foods',
    category_label_bn: 'খাঁটি অর্গানিক ফুড',
    district: 'Khulna / Satkhira',
    is_following: false,
    is_verified: true,
    has_physical_shop: true,
    open_status: 'OPEN',
    avatar_icon: '🍯',
    preview_products: [
      { id: 7, title: 'Sundarbans Wild Raw Honey (500g)', price: '680', img: '/media/honey.webp' },
      { id: 8, title: 'Cold-Pressed Ghani Mustard Oil', price: '320', img: '/media/oil.webp' },
    ],
  },
  {
    id: 105,
    ref: 'VS-DHAKAFASH05',
    slug: 'dhaka-fashion-house',
    shop_name: 'Dhaka Fashion House (ঢাকা ফ্যাশন)',
    bio: 'Curated trending premium lawn suits, three-piece sets, and festive kurtis for women.',
    total_products: 56,
    rating: 4.6,
    rating_count: 184,
    followers_count: 1780,
    category: 'fashion',
    category_label: 'Women Fashion',
    category_label_bn: 'নারী ফ্যাশন',
    district: 'Dhaka',
    is_following: false,
    is_verified: true,
    has_physical_shop: true,
    open_status: 'OPEN',
    avatar_icon: '✨',
    preview_products: [
      { id: 9, title: 'Designer Embroidered 3-Piece', price: '2,650', img: '/media/threepiece.webp' },
      { id: 10, title: 'Festive Cotton Kurti', price: '950', img: '/media/kurti.webp' },
    ],
  },
];

let mockDrops = [
  {
    item_id: 1,
    store_id: 101,
    store_slug: 'priyo-collection',
    shop_name: 'Priyo Collection',
    product_id: 1011,
    product_ref: 'PRD-JAM-882',
    slug: 'dhakai-jamdani-saree-red-gold',
    title_en: 'Royal Crimson Handloom Dhakai Jamdani Saree (84 Count)',
    title_bn: 'রয়্যাল ক্রিমসন তাঁতের ঢাকাই জামদানি শাড়ি (৮৪ কাউন্ট)',
    retail_price: '4250.00',
    original_price: '4800.00',
    category: 'fashion',
    discount_pct: 12,
    image_url: '/placeholder-product.svg',
    dropped_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    stock_status: 'IN_STOCK',
  },
  {
    item_id: 2,
    store_id: 102,
    store_slug: 'rajshahi-silk-emporium',
    shop_name: 'Rajshahi Silk Emporium',
    product_id: 1012,
    product_ref: 'PRD-SLK-441',
    slug: 'rajshahi-pure-silk-dupatta-emerald',
    title_en: 'Emerald Green Handcrafted Pure Rajshahi Silk Dupatta',
    title_bn: 'পান্না সবুজ খাঁটি রাজশাহী সিল্ক ওড়না / দোপাট্টা',
    retail_price: '1450.00',
    original_price: '1650.00',
    category: 'handloom',
    discount_pct: 15,
    image_url: '/placeholder-product.svg',
    dropped_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    stock_status: 'IN_STOCK',
  },
  {
    item_id: 3,
    store_id: 101,
    store_slug: 'priyo-collection',
    shop_name: 'Priyo Collection',
    product_id: 1013,
    product_ref: 'PRD-TNG-109',
    slug: 'tangail-soft-cotton-saree-pastel',
    title_en: 'Pastel Floral Soft Tangail Cotton Handloom Saree',
    title_bn: 'প্যাস্টেল ফ্লোরাল নরম টাঙ্গাইল তাঁত সুতি শাড়ি',
    retail_price: '1250.00',
    original_price: '1400.00',
    category: 'fashion',
    discount_pct: 10,
    image_url: '/placeholder-product.svg',
    dropped_at: new Date(Date.now() - 3600000 * 18).toISOString(),
    stock_status: 'IN_STOCK',
  },
  {
    item_id: 4,
    store_id: 102,
    store_slug: 'rajshahi-silk-emporium',
    shop_name: 'Rajshahi Silk Emporium',
    product_id: 1014,
    product_ref: 'PRD-PNJ-772',
    slug: 'silk-embroidered-panjabi-navy',
    title_en: 'Navy Blue Festive Embroidered Silk Semi-fitted Panjabi',
    title_bn: 'নেভি ব্লু উৎসবের এমব্রয়ডারি সিল্ক পাঞ্জাবি',
    retail_price: '2850.00',
    original_price: '3200.00',
    category: 'fashion',
    discount_pct: 11,
    image_url: '/placeholder-product.svg',
    dropped_at: new Date(Date.now() - 3600000 * 26).toISOString(),
    stock_status: 'IN_STOCK',
  },
];

let mockLiveStreams = [
  {
    id: 201,
    title_en: 'Eid Exclusive Jamdani & Weavers Showcase — Live from Demra',
    title_bn: 'ঈদ স্পেশাল জামদানি ও তাঁত কালেকশন লাইভ — সরাসরি ডেমরা থেকে',
    category: 'fashion',
    status: 'LIVE',
    viewer_count: 142,
    store_slug: 'priyo-collection',
    shop_name: 'Priyo Collection',
    special_discount: '25% Flash Off',
    scheduled_at: null,
  },
  {
    id: 202,
    title: '⏰ Pure Rajshahi Silk Quality Inspection & Care Demonstration',
    title_bn: '⏰ খাঁটি সিল্ক চেনার উপায় ও লাইভ ডেমো',
    status: 'SCHEDULED',
    viewer_count: 0,
    store_slug: 'rajshahi-silk-emporium',
    shop_name: 'Rajshahi Silk Emporium',
    special_discount: 'Free Shipping Code',
    scheduled_at: new Date(Date.now() + 3600000 * 3).toISOString(),
  },
];

let mockStories = [
  {
    id: 301,
    slug: 'jamdani-weaving-process',
    title_en: 'How our master weavers weave 84 count Jamdani 🧵',
    title_bn: 'আমাদের কারিগররা যেভাবে ৮৪ কাউন্ট জামদানি বোনেন',
    cover_image_url: '/placeholder-product.svg',
    view_count: 890,
    store_slug: 'priyo-collection',
    shop_name: 'Priyo Collection',
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
  {
    id: 302,
    slug: 'silk-packaging-care',
    title_en: 'Unboxing 100% Pure Mulberry Silk Dupattas ✨',
    title_bn: '১০০% খাঁটি মালবেরি সিল্ক ওড়না আনবক্সিং',
    cover_image_url: '/placeholder-product.svg',
    view_count: 640,
    store_slug: 'rajshahi-silk-emporium',
    shop_name: 'Rajshahi Silk Emporium',
    created_at: new Date(Date.now() - 3600000 * 8).toISOString(),
  },
  {
    id: 303,
    slug: 'sundarbans-honey-harvest',
    title_en: 'Wild Honey Collection from Mangrove Forests 🐝',
    title_bn: 'সুন্দরবনের ম্যানগ্রোভ বন থেকে বন্য মধু সংগ্রহ',
    cover_image_url: '/placeholder-product.svg',
    view_count: 1420,
    store_slug: 'sundarbans-pure-organics',
    shop_name: 'Sundarbans Organics',
    created_at: new Date(Date.now() - 3600000 * 12).toISOString(),
  },
];

export const customerHandlers = [
  // 1. Following Feed
  {
    method: 'GET',
    path: '/customer/following-feed',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            followed_stores: mockFollowedStores,
            suggested_stores: mockSuggestedStores,
            product_drops: mockDrops,
            live_streams: mockLiveStreams,
            stories: mockStories,
          },
        },
      };
    },
  },

  // 2. Toggle Follow Store
  {
    method: 'POST',
    path: '/customer/follow/:storeId',
    handler({ params }) {
      const storeId = Number(params?.storeId);
      const followedIdx = mockFollowedStores.findIndex((s) => s.id === storeId);

      if (followedIdx !== -1) {
        // Unfollow: Move to suggested
        const [removed] = mockFollowedStores.splice(followedIdx, 1);
        removed.is_following = false;
        mockSuggestedStores.unshift(removed);
        return {
          status: 200,
          body: {
            data: {
              is_following: false,
              store_id: storeId,
              shop_name: removed.shop_name,
              message_en: `Unfollowed ${removed.shop_name}`,
              message_bn: `${removed.shop_name} আনফলো করা হয়েছে।`,
            },
          },
        };
      }

      // Follow: Move from suggested or create
      const suggestedIdx = mockSuggestedStores.findIndex((s) => s.id === storeId);
      let storeToFollow = null;

      if (suggestedIdx !== -1) {
        const [moved] = mockSuggestedStores.splice(suggestedIdx, 1);
        storeToFollow = moved;
      } else {
        storeToFollow = {
          id: storeId,
          slug: `store-${storeId}`,
          shop_name: `Verified Merchant ${storeId}`,
          bio: 'Verified local seller on Explooro.',
          total_products: 12,
          rating: 4.8,
          followers_count: 520,
          district: 'Dhaka',
          is_verified: true,
          has_physical_shop: true,
          open_status: 'OPEN',
          avatar_icon: '🏪',
          preview_products: [],
        };
      }

      storeToFollow.is_following = true;
      storeToFollow.followed_at = new Date().toISOString();
      mockFollowedStores.unshift(storeToFollow);

      return {
        status: 200,
        body: {
          data: {
            is_following: true,
            store_id: storeId,
            shop_name: storeToFollow.shop_name,
            message_en: `Now following ${storeToFollow.shop_name}!`,
            message_bn: `${storeToFollow.shop_name} ফলো করা হয়েছে!`,
          },
        },
      };
    },
  },

  // 3. Customer Dashboard Overview
  {
    method: 'GET',
    path: '/customer/dashboard',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            user_id: 1,
            is_saler: false,
            orders: {
              active_count: 1,
              delivered_count: 4,
              total_count: 5,
              latest_order: {
                id: 1,
                ref: 'ORD-DH-90123',
                status: 'SHIPPED',
                total_amount: '4820.00',
                created_at: new Date(Date.now() - 3600000 * 14).toISOString(),
                item_count: 2,
                items: [
                  {
                    product_title_en: 'Authentic Handloom Dhakai Jamdani Saree',
                    product_title_bn: 'খাঁটি তাঁতের ঢাকাই জামদানি শাড়ি',
                    quantity: 1,
                    unit_price: '3500.00',
                  },
                ],
              },
            },
            rewards: {
              coins_balance: 340,
              current_streak_days: 5,
              total_earned: 920,
              referral_code: 'REF882109',
              referral_share_url: 'https://explooro.com/r/REF882109',
            },
            wishlist: {
              total_items: 6,
              price_drops_count: 2,
              items: [],
            },
            protection: {
              active_warranties_count: 2,
              active_returns_count: 0,
            },
            social: {
              active_teams_count: 1,
              followed_stores_count: mockFollowedStores.length,
            },
          },
        },
      };
    },
  },

  // 4. 1-Click Saler Upgrade
  {
    method: 'POST',
    path: '/customer/become-saler',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            success: true,
            already_existed: false,
            store: {
              id: 99,
              slug: 'my-smart-store',
              shop_name: "Customer's Shop",
              is_published: true,
            },
            redirect_url: '/saler/store-builder',
            message_en: 'Congratulations! Your digital store is active.',
            message_bn: 'অভিনন্দন! আপনার ভার্চুয়াল দোকান তৈরি হয়েছে।',
          },
        },
      };
    },
  },

  // 5. Wishlist Price Drop Sweep
  {
    method: 'POST',
    path: '/customer/wishlist/check-price-drops',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            total_evaluated: 6,
            alerts_dispatched: 2,
          },
        },
      };
    },
  },
];
