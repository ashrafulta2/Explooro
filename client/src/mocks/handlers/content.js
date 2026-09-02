/**
 * content.js — Mock Handlers for Editor Portal: Banners, Stories, Reels, Academy, What's New, Help Center, Translations.
 */

let mockStories = [
  {
    id: 1,
    ref: 'STR-101-JAMDANI',
    author_id: 2,
    author_name: 'Habib Traders (Dhaka)',
    author_user_role: 'saler',
    title_en: 'How I Scaled My Jamdani Saree Store to Tk 5 Lakh / Month on Explooro',
    title_bn: 'কীভাবে আমি এক্সপ্লোরোতে জামদানি শাড়ির দোকান প্রতি মাসে ৫ লাখ টাকায় উন্নীত করেছি',
    slug: 'scaling-jamdani-store-explooro',
    content_en: 'When I started digital reselling, finding verified weavers in Narayanganj was difficult. Explooro direct factory escrow guaranteed quality and zero risk of counterfeit fabrics. Here is the step-by-step framework I used...',
    content_bn: 'যখন আমি ডিজিটাল রিসেলিং শুরু করি, তখন নারায়ণগঞ্জে যাচাইকৃত তাঁতি খুঁজে পাওয়া কঠিন ছিল। এক্সপ্লোরোর ডিরেক্ট ফ্যাক্টরি এসক্রো গুণমান এবং নকল কাপড়ের শূন্য ঝুঁকি নিশ্চিত করেছে। এখানে আমি যে কাঠামোটি ব্যবহার করেছি...',
    cover_image_url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80',
    embedded_product_ids: [1, 2],
    embedded_products: [
      {
        id: 1,
        ref: 'PRD-101',
        slug: 'heritage-dhakai-jamdani',
        title_en: 'Heritage Dhakai Jamdani Saree (84 Count)',
        title_bn: 'ঐতিহ্যবাহী ঢাকাই জামদানি শাড়ি (৮৪ কাউন্ট)',
        retail_price: 4500.00,
        media: [{ url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=400&q=80' }],
      },
    ],
    status: 'PUBLISHED',
    view_count: 1420,
    published_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 2,
    ref: 'STR-102-SOURCING',
    author_id: 3,
    author_name: 'Bengal Weaves & Crafts',
    author_user_role: 'supplier',
    title_en: 'Tangail Handloom Cotton: The Artisan Story Behind Every Thread',
    title_bn: 'টাঙ্গাইল হ্যান্ডলুম কটন: প্রতিটি সুতার পেছনের কারিগর গল্প',
    slug: 'tangail-handloom-artisan-story',
    content_en: 'Our cooperative supports over 40 family looms in Pathrail, Tangail. Every piece is hand-spun with natural dyed cotton...',
    content_bn: 'আমাদের সমবায় টাঙ্গাইলের পাথরাইলে ৪০ টিরও বেশি পারিবারিক তাঁতকে সমর্থন করে। প্রতিটি পিস প্রাকৃতিক রঙের সুতা দিয়ে হাতে কাটা...',
    cover_image_url: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=800&q=80',
    embedded_product_ids: [2],
    embedded_products: [],
    status: 'PUBLISHED',
    view_count: 890,
    published_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
];

let mockReels = [
  {
    id: 1,
    ref: 'REL-201',
    author_id: 2,
    author_name: 'Habib Traders',
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    thumbnail_url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=400&q=80',
    duration_seconds: 15,
    caption_en: 'Live look at the 84-count pure cotton Jamdani weave 🌸 Tap below to buy instantly!',
    caption_bn: '৮৪-কাউন্ট খাঁটি সুতির জামদানি বয়ন সরাসরি দেখুন 🌸 সরাসরি কিনতে নিচে ট্যাপ করুন!',
    pinned_product_id: 1,
    product: {
      id: 1,
      title_en: 'Heritage Dhakai Jamdani Saree (84 Count)',
      title_bn: 'ঐতিহ্যবাহী ঢাকাই জামদানি শাড়ি',
      retail_price: 4500.00,
      media: [{ url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=400&q=80' }],
      is_in_stock: true,
    },
    likes_count: 184,
    views_count: 1420,
    status: 'PUBLISHED',
    created_at: new Date().toISOString(),
  },
  {
    id: 2,
    ref: 'REL-202',
    author_id: 3,
    author_name: 'Bengal Weaves',
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4',
    thumbnail_url: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=400&q=80',
    duration_seconds: 18,
    caption_en: 'Artisan weaving in action at Pathrail Tangail 🌿 100% natural dyes.',
    caption_bn: 'টাঙ্গাইলের পাথরাইলে তাঁতিদের জীবন্ত বয়ন 🌿 ১০০% প্রাকৃতিক রং।',
    pinned_product_id: 2,
    product: {
      id: 2,
      title_en: 'Tangail Handloom Premium Cotton Saree',
      title_bn: 'টাঙ্গাইল হ্যান্ডলুম প্রিমিয়াম সুতি শাড়ি',
      retail_price: 2200.00,
      media: [{ url: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=400&q=80' }],
      is_in_stock: true,
    },
    likes_count: 96,
    views_count: 810,
    status: 'PUBLISHED',
    created_at: new Date().toISOString(),
  },
];

let mockCourses = [
  {
    id: 1,
    ref: 'CRS-301',
    title_en: 'Sourcing Mastery: Direct Factory Negotiations & Quality Control',
    title_bn: 'সোর্সিং মাস্টারক্লাস: ডিরেক্ট ফ্যাক্টরি নেগোসিয়েশন ও কোয়ালিটি কন্ট্রোল',
    description_en: 'Learn how to discover verified manufacturers, negotiate bulk wholesale tiers, and use B2B milestone escrow safely.',
    description_bn: 'যাচাইকৃত সরবরাহকারী খুঁজে বের করা, বাল্ক পাইকারি মূল্য নির্ধারণ এবং বিটুবি এসক্রো নিরাপদে ব্যবহার করার নিয়মাবলি শিখুন।',
    target_role: 'saler',
    category: 'sourcing',
    cover_image_url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=600&q=80',
    difficulty_level: 'BEGINNER',
    estimated_minutes: 25,
    lessons_count: 3,
    completed_lessons: 2,
    progress_pct: 66,
    is_completed: false,
    lessons: [
      {
        id: 101,
        course_id: 1,
        sequence_no: 1,
        title_en: 'Introduction to Factory Sourcing in Bangladesh',
        title_bn: 'বাংলাদেশে ফ্যাক্টরি সোর্সিংয়ের পরিচিতি',
        media_type: 'VIDEO',
        media_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        duration_seconds: 300,
        is_completed: true,
      },
      {
        id: 102,
        course_id: 1,
        sequence_no: 2,
        title_en: 'Protecting Wholesale Deals with B2B Escrow Milestones',
        title_bn: 'বিটুবি এসক্রো মাইলস্টোনের মাধ্যমে পাইকারি চুক্তি সুরক্ষিত করা',
        media_type: 'VIDEO',
        media_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4',
        duration_seconds: 420,
        is_completed: true,
      },
      {
        id: 103,
        course_id: 1,
        sequence_no: 3,
        title_en: 'Quality Inspection & Dispatch Challan Verification',
        title_bn: 'কোয়ালিটি ইন্সপেকশন ও চালান ভেরিফিকেশন',
        media_type: 'ARTICLE',
        content_en: 'Always verify courier dispatch slips and warehouse batch stickers before approving milestone disbursement...',
        content_bn: 'মাইলস্টোন অর্থ ছাড়ের পূর্বে কুরিয়ার চালান এবং ব্যাচ স্টিকার যাচাই করুন...',
        duration_seconds: 180,
        is_completed: false,
      },
    ],
  },
  {
    id: 2,
    ref: 'CRS-302',
    title_en: 'Social Commerce & WhatsApp 1-Tap Conversions',
    title_bn: 'সোশ্যাল কমার্স ও হোয়াটসঅ্যাপ ১-ট্যাপ বিক্রয় কৌশল',
    description_en: 'Set up WhatsApp product catalogs, automated abandoned cart recovery, and social seller kits.',
    description_bn: 'হোয়াটসঅ্যাপ প্রোডাক্ট ক্যাটালগ, কার্ট রিকভারি এবং সোশ্যাল সেলার কিট সেটআপ করার পূর্ণাঙ্গ গাইড।',
    target_role: 'saler',
    category: 'marketing',
    cover_image_url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=600&q=80',
    difficulty_level: 'INTERMEDIATE',
    estimated_minutes: 20,
    lessons_count: 2,
    completed_lessons: 2,
    progress_pct: 100,
    is_completed: true,
    lessons: [
      {
        id: 201,
        course_id: 2,
        sequence_no: 1,
        title_en: 'Configuring Meta WhatsApp Webhook & Direct Product Drops',
        title_bn: 'মেটা হোয়াটসঅ্যাপ ওয়েবহুক ও সরাসরি পণ্য ড্রপ কনফিগারেশন',
        media_type: 'VIDEO',
        media_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        duration_seconds: 360,
        is_completed: true,
      },
      {
        id: 202,
        course_id: 2,
        sequence_no: 2,
        title_en: 'Generating Custom Vector Flyers with Bengali Typography',
        title_bn: 'বাংলা ফন্ট সহ ভেক্টর ফ্লায়ার তৈরি ও শেয়ারিং',
        media_type: 'VIDEO',
        media_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4',
        duration_seconds: 240,
        is_completed: true,
      },
    ],
  },
];

let mockBanners = [
  {
    id: 1,
    slot: 'HOMEPAGE_HERO',
    title_en: 'Grand Artisan Festival: 100% Authentic Handloom',
    title_bn: 'ঐতিহ্যবাহী তাঁত উৎসব: ১০০% খাঁটি দেশীয় পণ্য',
    image_url_desktop: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1200&q=80',
    image_url_mobile: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=600&q=80',
    target_link: '/stories',
    display_order: 1,
    is_active: true,
  },
  {
    id: 2,
    slot: 'HOMEPAGE_SECONDARY',
    title_en: 'Verified B2B Wholesale Deals with Escrow Protection',
    title_bn: 'এসক্রো সুরক্ষায় সরাসরি ফ্যাক্টরি পাইকারি কেনাকাটা',
    image_url_desktop: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1200&q=80',
    target_link: '/saler/b2b-escrow',
    display_order: 2,
    is_active: true,
  },
  {
    id: 3,
    slot: 'FLASH_SALE_STRIP',
    title_en: 'Eid-Ul-Fitr Festive Mega Sale: Up to 40% Off Wholesale',
    title_bn: 'ঈদ-উল-ফিতর মেগা সেল: পাইকারিতে ৪০% পর্যন্ত ছাড়',
    image_url_desktop: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1200&q=80',
    target_link: '/search?discount=flash',
    display_order: 3,
    is_active: true,
  },
];

let mockWhatsNew = [
  {
    id: 1,
    version: 'v2.4.0',
    title_en: '1-Click Physical Factory Showroom Status & Weekly Schedule',
    title_bn: '১-ক্লিক ফিজিক্যাল ফ্যাক্টরি শোরুম স্ট্যাটাস ও সাপ্তাহিক সময়সূচি',
    category: 'FEATURE',
    target_audience: 'ALL',
    summary_en: 'Suppliers can now manage real-time walk-in availability, customized 7-day operating hours, and warehouse pickup desks.',
    summary_bn: 'সরবরাহকারীরা এখন রিয়েল-টাইম শোরুম ভিজিট, ৭ দিনের সাপ্তাহিক সময়সূচি এবং কাস্টমার সেলফ-পিকআপ ডেস্ক সেটআপ করতে পারেন।',
    published_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    is_published: true,
  },
  {
    id: 2,
    version: 'v2.3.5',
    title_en: 'Steadfast & Pathao Courier Consignment 1-Click Handover',
    title_bn: 'স্টেডফাস্ট ও পাঠাও কুরিয়ার পার্সেল ১-ক্লিক হ্যান্ডওভার',
    category: 'IMPROVEMENT',
    target_audience: 'SUPPLIERS',
    summary_en: 'Instant airway bill barcode printing, thermal shipping labels, and real-time live tracking webhooks.',
    summary_bn: 'তাৎক্ষণিক এয়ারওয়ে বিল বারকোড ও থার্মাল লেবেল প্রিন্ট এবং সরাসরি লাইভ ট্র্যাকিং সমন্বয়।',
    published_at: new Date(Date.now() - 86400000 * 6).toISOString(),
    is_published: true,
  },
  {
    id: 3,
    version: 'v2.3.0',
    title_en: 'B2B Milestone Escrow Contracts & Immutable Hash Verification',
    title_bn: 'বিটুবি মাইলস্টোন এসক্রো চুক্তি ও হ্যাশ ভেরিফিকেশন',
    category: 'SECURITY',
    target_audience: 'SALERS',
    summary_en: 'Deterministic SHA-256 digital signature hashes for bulk garment and textile manufacturing agreements.',
    summary_bn: 'পোশাক ও টেক্সটাইল বাল্ক চুক্তির জন্য ক্রিপ্টোগ্রাফিক ডিজিটাল সাইন ও নিরাপদ পেমেন্ট এসক্রো।',
    published_at: new Date(Date.now() - 86400000 * 12).toISOString(),
    is_published: true,
  },
];

let mockHelpArticles = [
  {
    id: 1,
    category: 'orders',
    title_en: 'How do I track and fulfill customer orders using 3PL couriers?',
    title_bn: 'কীভাবে ৩পিএল কুরিয়ার দিয়ে কাস্টমার অর্ডার প্যাক ও ট্র্যাক করবেন?',
    content_en: 'Navigate to Orders to Pack in your portal. Click 1-Click Pack & Consign to generate Steadfast / Pathao tracking codes and print thermal shipping labels immediately.',
    content_bn: 'অর্ডার প্যাক সেকশনে যান। ১-ক্লিক প্যাক ও কনসাইনে ক্লিক করে স্টেডফাস্ট/পাঠাও ট্র্যাকিং কোড তৈরি করুন এবং থার্মাল লেবেল প্রিন্ট করুন।',
    helpful_count: 142,
    views_count: 890,
    is_published: true,
  },
  {
    id: 2,
    category: 'finance',
    title_en: 'When are reseller commissions disbursed to my bKash / Nagad wallet?',
    title_bn: 'রিসেলার কমিশন কখন বিকাশ বা নগদ ওয়ালেটে জমা হয়?',
    content_en: 'Commissions are unlocked immediately once the courier confirms customer delivery and the 3-day warranty period clears without claims.',
    content_bn: 'কুরিয়ার ডেলিভারি সম্পন্ন হওয়ার সাথে সাথে এবং ৩ দিনের মধ্যে কোনো রিটার্ন না থাকলে কমিশন সাথে সাথে আনলক হয়।',
    helpful_count: 285,
    views_count: 1450,
    is_published: true,
  },
  {
    id: 3,
    category: 'sourcing',
    title_en: 'How does B2B Escrow milestone protection safeguard bulk orders?',
    title_bn: 'বিটুবি এসক্রো মাইলস্টোন কীভাবে বাল্ক অর্ডারের টাকা সুরক্ষিত রাখে?',
    content_en: 'Your advance payment stays safely locked in Explooro vault until the factory dispatches items and verified QC inspection challan is uploaded.',
    content_bn: 'ফ্যাক্টরি থেকে পণ্য পাঠানো এবং কিউসি পরিদর্শন রিপোর্ট আপলোড না করা পর্যন্ত অগ্রিম টাকা এক্সপ্লোরো ভল্টে সম্পূর্ণ নিরাপদ থাকে।',
    helpful_count: 98,
    views_count: 620,
    is_published: true,
  },
  {
    id: 4,
    category: 'warranties',
    title_en: 'How do I submit or resolve a digital warranty claim?',
    title_bn: 'ডিজিটাল ওয়ারেন্টি ক্লেইম কীভাবে সাবমিট বা সমাধান করবেন?',
    content_en: 'Buyers submit claims with serial photos. Suppliers review in Aftercare > Warranty Claims and approve replacement dispatch in 1 click.',
    content_bn: 'ক্রেতারা ছবির মাধ্যমে আবেদন করেন। সরবরাহকারীরা আফটারকেয়ার মেনু থেকে ১-ক্লিকে প্রতিস্থাপন অনুমোদন করেন।',
    helpful_count: 73,
    views_count: 410,
    is_published: true,
  },
];

/**
 * Dynamic (DB-backed) i18n strings, keyed `locale -> namespace -> key -> value`.
 *
 * WHY the nesting: content.service.js's getTranslationsForLocale() folds its
 * `SELECT namespace, key, value` rows into `result[namespace][key] = value`, and
 * pages/editor/TranslationManagerPage.js's renderTable() walks exactly that two-level shape —
 * it skips any entry whose value is not an object. This fixture used to be a flat
 * `locale -> key -> value` map, so every value was a string, every row was skipped, and the
 * Translation Manager showed "No translation keys found" while its own completeness header
 * reported 242 translated keys.
 *
 * These are dynamic overrides only — the static dictionaries live in src/locales/*.json.
 */
let mockDynamicTranslations = {
  en: {
    marketing: {
      welcome_banner: 'Welcome to Explooro Multi-Tier Commerce',
      slogan: 'Empowering local weavers, direct manufacturers & reseller entrepreneurs',
      tagline: 'Bangladesh’s Premier Factory-Direct & Social Commerce Platform',
    },
    common: {
      buy_now: 'Buy Now',
      add_to_cart: 'Add to Cart',
      checkout: 'Checkout',
    },
  },
  bn: {
    marketing: {
      welcome_banner: 'এক্সপ্লোরো মাল্টি-টিয়ার কমার্সে স্বাগতম',
      slogan: 'স্থানীয় তাঁতি, কারখানা ও রিসেলার উদ্যোক্তাদের ক্ষমতায়ন',
      tagline: 'বাংলাদেশের শীর্ষস্থানীয় ফ্যাক্টরি-ডিরেক্ট ও সোশ্যাল কমার্স প্ল্যাটফর্ম',
    },
    common: {
      buy_now: 'এখনই কিনুন',
      add_to_cart: 'কার্টে যোগ করুন',
      checkout: 'চেকআউট',
    },
  },
  // Listed at 44% by the completeness endpoint below — deliberately missing values so the
  // "Show Missing Only" filter has something to find.
  ar: {
    marketing: {
      welcome_banner: 'مرحبًا بكم في إكسبلورو',
      slogan: '',
      tagline: '',
    },
    common: {
      buy_now: 'اشتر الآن',
      add_to_cart: '',
      checkout: '',
    },
  },
};

export const contentHandlers = [
  // ── Stories & Editorial ──
  {
    method: 'GET',
    path: '/content/stories',
    handler: () => ({ status: 200, body: { data: mockStories, meta: { total: mockStories.length } } }),
  },
  {
    method: 'GET',
    path: '/content/stories/:idOrSlug',
    handler: (req) => {
      const story = mockStories.find((s) => s.slug === req.params.idOrSlug || String(s.id) === req.params.idOrSlug) || mockStories[0];
      return { status: 200, body: { data: story } };
    },
  },
  {
    method: 'POST',
    path: '/content/stories',
    handler: (req) => {
      const body = req.body || {};
      const newStory = {
        id: mockStories.length + 1,
        ref: `STR-${Date.now().toString().slice(-4)}`,
        author_id: 1,
        author_name: body.author_name || 'Explooro Editorial',
        author_user_role: 'editor',
        title_en: body.title_en || 'New Curated Story',
        title_bn: body.title_bn || 'নতুন কিউরেটেড গল্প',
        slug: (body.title_en || 'new-story').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        content_en: body.content_en || '',
        content_bn: body.content_bn || '',
        cover_image_url: body.cover_image_url || 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80',
        embedded_product_ids: body.embedded_product_ids || [],
        embedded_products: body.embedded_products || [],
        status: body.status || 'PUBLISHED',
        view_count: 0,
        published_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      mockStories.unshift(newStory);
      return { status: 200, body: { data: newStory } };
    },
  },
  {
    method: 'POST',
    path: '/editor/stories',
    handler: (req) => {
      const body = req.body || {};
      let s;
      if (body.id) {
        s = mockStories.find((x) => x.id === body.id);
        if (s) Object.assign(s, body);
      } else {
        s = {
          id: mockStories.length + 1,
          ref: `STR-${Date.now().toString().slice(-4)}`,
          author_id: 1,
          author_name: body.author_name || 'Explooro Editorial',
          author_user_role: 'editor',
          title_en: body.title_en || 'New Curated Story',
          title_bn: body.title_bn || 'নতুন কিউরেটেড গল্প',
          slug: (body.title_en || 'new-story').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          content_en: body.content_en || '',
          content_bn: body.content_bn || '',
          cover_image_url: body.cover_image_url || 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80',
          embedded_product_ids: body.embedded_product_ids || [],
          embedded_products: body.embedded_products || [],
          status: body.status || 'PUBLISHED',
          view_count: body.view_count || 0,
          published_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        mockStories.unshift(s);
      }
      return { status: 200, body: { data: s } };
    },
  },
  {
    method: 'DELETE',
    path: '/editor/stories/:id',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      mockStories = mockStories.filter((s) => s.id !== id);
      return { status: 200, body: { data: { id, deleted: true } } };
    },
  },

  // ── Shoppable Reels ──
  {
    method: 'GET',
    path: '/content/reels',
    handler: () => ({ status: 200, body: { data: mockReels, meta: { total: mockReels.length } } }),
  },
  {
    method: 'POST',
    path: '/content/reels',
    handler: (req) => {
      const body = req.body || {};
      const newReel = {
        id: mockReels.length + 1,
        ref: `REL-${Date.now().toString().slice(-4)}`,
        author_id: 1,
        author_name: body.author_name || 'Explooro Studio',
        video_url: body.video_url || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        thumbnail_url: body.thumbnail_url || 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=400&q=80',
        duration_seconds: body.duration_seconds || 15,
        caption_en: body.caption_en || '',
        caption_bn: body.caption_bn || '',
        pinned_product_id: body.pinned_product_id || 1,
        product: body.product || mockReels[0]?.product,
        likes_count: 0,
        views_count: 0,
        status: 'PUBLISHED',
        created_at: new Date().toISOString(),
      };
      mockReels.unshift(newReel);
      return { status: 200, body: { data: newReel } };
    },
  },
  {
    method: 'DELETE',
    path: '/editor/reels/:id',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      mockReels = mockReels.filter((r) => r.id !== id);
      return { status: 200, body: { data: { id, deleted: true } } };
    },
  },

  // ── Academy Courses ──
  {
    method: 'GET',
    path: '/academy/courses',
    handler: () => ({ status: 200, body: { data: mockCourses, meta: { total: mockCourses.length } } }),
  },
  {
    method: 'GET',
    path: '/academy/courses/:idOrRef',
    handler: (req) => {
      const course = mockCourses.find((c) => c.ref === req.params.idOrRef || String(c.id) === req.params.idOrRef) || mockCourses[0];
      return { status: 200, body: { data: course } };
    },
  },
  {
    method: 'POST',
    path: '/editor/courses',
    handler: (req) => {
      const body = req.body || {};
      let c;
      if (body.id) {
        c = mockCourses.find((x) => x.id === body.id);
        if (c) Object.assign(c, body);
      } else {
        c = {
          id: mockCourses.length + 1,
          ref: `CRS-${Date.now().toString().slice(-4)}`,
          title_en: body.title_en || 'New Academy Course',
          title_bn: body.title_bn || 'নতুন একাডেমি কোর্স',
          description_en: body.description_en || '',
          description_bn: body.description_bn || '',
          target_role: body.target_role || 'saler',
          category: body.category || 'general',
          cover_image_url: body.cover_image_url || 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=600&q=80',
          difficulty_level: body.difficulty_level || 'BEGINNER',
          estimated_minutes: body.estimated_minutes || 15,
          lessons_count: body.lessons?.length || 1,
          completed_lessons: 0,
          progress_pct: 0,
          is_completed: false,
          lessons: body.lessons || [
            {
              id: Date.now(),
              sequence_no: 1,
              title_en: 'Lesson 1: Overview',
              title_bn: 'পাঠ ১: পরিচিতি',
              media_type: 'VIDEO',
              media_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
              duration_seconds: 180,
              is_completed: false,
            },
          ],
        };
        mockCourses.unshift(c);
      }
      return { status: 200, body: { data: c } };
    },
  },
  {
    method: 'DELETE',
    path: '/editor/courses/:id',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      mockCourses = mockCourses.filter((c) => c.id !== id);
      return { status: 200, body: { data: { id, deleted: true } } };
    },
  },

  // ── Banners ──
  {
    method: 'GET',
    path: '/content/banners',
    handler: () => ({ status: 200, body: { data: mockBanners, meta: { total: mockBanners.length } } }),
  },
  {
    method: 'POST',
    path: '/editor/banners',
    handler: (req) => {
      const body = req.body || {};
      let b;
      if (body.id) {
        b = mockBanners.find((x) => x.id === body.id);
        if (b) Object.assign(b, body);
      } else {
        b = {
          id: mockBanners.length + 1,
          slot: body.slot || 'HOMEPAGE_HERO',
          title_en: body.title_en || 'New Banner',
          title_bn: body.title_bn || 'নতুন ব্যানার',
          image_url_desktop: body.image_url_desktop || 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1200&q=80',
          image_url_mobile: body.image_url_mobile || null,
          target_link: body.target_link || '/stories',
          display_order: body.display_order || mockBanners.length + 1,
          is_active: body.is_active !== undefined ? body.is_active : true,
        };
        mockBanners.push(b);
      }
      return { status: 200, body: { data: b } };
    },
  },
  {
    method: 'DELETE',
    path: '/editor/banners/:id',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      mockBanners = mockBanners.filter((b) => b.id !== id);
      return { status: 200, body: { data: { id, deleted: true } } };
    },
  },

  // ── What's New / Release Notes ──
  {
    method: 'GET',
    path: '/content/whats-new',
    handler: () => ({ status: 200, body: { data: mockWhatsNew, meta: { total: mockWhatsNew.length } } }),
  },
  {
    method: 'POST',
    path: '/editor/whats-new',
    handler: (req) => {
      const body = req.body || {};
      let item;
      if (body.id) {
        item = mockWhatsNew.find((x) => x.id === body.id);
        if (item) Object.assign(item, body);
      } else {
        item = {
          id: mockWhatsNew.length + 1,
          version: body.version || `v2.${mockWhatsNew.length + 4}.0`,
          title_en: body.title_en || 'New Platform Update',
          title_bn: body.title_bn || 'নতুন প্ল্যাটফর্ম আপডেট',
          category: body.category || 'FEATURE',
          target_audience: body.target_audience || 'ALL',
          summary_en: body.summary_en || '',
          summary_bn: body.summary_bn || '',
          published_at: new Date().toISOString(),
          is_published: body.is_published !== undefined ? body.is_published : true,
        };
        mockWhatsNew.unshift(item);
      }
      return { status: 200, body: { data: item } };
    },
  },
  {
    method: 'DELETE',
    path: '/editor/whats-new/:id',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      mockWhatsNew = mockWhatsNew.filter((w) => w.id !== id);
      return { status: 200, body: { data: { id, deleted: true } } };
    },
  },

  // ── Help Centre / FAQs ──
  {
    method: 'GET',
    path: '/content/help-center',
    handler: () => ({ status: 200, body: { data: mockHelpArticles, meta: { total: mockHelpArticles.length } } }),
  },
  {
    method: 'POST',
    path: '/editor/help-center',
    handler: (req) => {
      const body = req.body || {};
      let article;
      if (body.id) {
        article = mockHelpArticles.find((x) => x.id === body.id);
        if (article) Object.assign(article, body);
      } else {
        article = {
          id: mockHelpArticles.length + 1,
          category: body.category || 'orders',
          title_en: body.title_en || 'New Help Article',
          title_bn: body.title_bn || 'নতুন সহায়তা প্রবন্ধ',
          content_en: body.content_en || '',
          content_bn: body.content_bn || '',
          helpful_count: 0,
          views_count: 0,
          is_published: body.is_published !== undefined ? body.is_published : true,
        };
        mockHelpArticles.unshift(article);
      }
      return { status: 200, body: { data: article } };
    },
  },
  {
    method: 'DELETE',
    path: '/editor/help-center/:id',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      mockHelpArticles = mockHelpArticles.filter((h) => h.id !== id);
      return { status: 200, body: { data: { id, deleted: true } } };
    },
  },

  // ── Translations ──
  {
    method: 'GET',
    path: '/editor/translations/completeness',
    handler: () => ({
      status: 200,
      body: {
        data: {
          base_locale: 'en',
          base_total_keys: 250,
          locales: [
            { locale: 'en', total_keys: 250, completeness_pct: 100 },
            { locale: 'bn', total_keys: 242, completeness_pct: 97 },
            { locale: 'ar', total_keys: 110, completeness_pct: 44 },
          ],
        },
      },
    }),
  },
  {
    method: 'GET',
    path: '/editor/translations/:locale',
    handler: (req) => ({
      status: 200,
      body: {
        data: mockDynamicTranslations[req.params.locale] || {},
      },
    }),
  },
  {
    method: 'POST',
    path: '/editor/translations',
    handler: (req) => {
      const { locale, namespace = 'common', key, value } = req.body || {};
      // Mirrors the service's ON CONFLICT (namespace, key, locale) upsert — the namespace is part
      // of a translation's identity, not decoration.
      if (!mockDynamicTranslations[locale]) mockDynamicTranslations[locale] = {};
      if (!mockDynamicTranslations[locale][namespace]) mockDynamicTranslations[locale][namespace] = {};
      mockDynamicTranslations[locale][namespace][key] = value;
      return { status: 200, body: { data: { locale, namespace, key, value } } };
    },
  },
  {
    method: 'GET',
    path: '/editor/translations/:locale/export',
    handler: (req) => ({
      status: 200,
      body: {
        data: mockDynamicTranslations[req.params.locale] || {},
      },
    }),
  },
  {
    method: 'POST',
    path: '/editor/translations/:locale/import',
    handler: (req) => {
      const { locale } = req.params;
      const { translations } = req.body || {};
      const existing = mockDynamicTranslations[locale] || {};
      const merged = { ...existing };
      let importedKeys = 0;

      // A shallow spread would replace whole namespaces rather than merging into them, and would
      // count namespaces instead of keys.
      for (const [namespace, keys] of Object.entries(translations || {})) {
        if (!keys || typeof keys !== 'object') continue;
        merged[namespace] = { ...(existing[namespace] || {}), ...keys };
        importedKeys += Object.keys(keys).length;
      }

      mockDynamicTranslations[locale] = merged;
      return { status: 200, body: { data: { locale, imported_keys: importedKeys } } };
    },
  },
];
