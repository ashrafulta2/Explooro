/**
 * content.js — Mock Handlers for Stories, Shoppable Reels, Academy, Banners & Translations (Prompt 10.8).
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
];

let mockDynamicTranslations = {
  en: {
    welcome_banner: 'Welcome to Explooro Multi-Tier Commerce',
    slogan: 'Empowering local weavers, direct manufacturers & reseller entrepreneurs',
  },
  bn: {
    welcome_banner: 'এক্সপ্লোরো মাল্টি-টিয়ার কমার্সে স্বাগতম',
    slogan: 'স্থানীয় তাঁতি, কারখানা ও রিসেলার উদ্যোক্তাদের ক্ষমতায়ন',
  },
};

export const contentHandlers = [
  // Stories
  {
    method: 'GET',
    path: '/content/stories',
    handler: () => ({ success: true, data: mockStories }),
  },
  {
    method: 'GET',
    path: '/content/stories/:idOrSlug',
    handler: (req) => {
      const story = mockStories.find((s) => s.slug === req.params.idOrSlug || String(s.id) === req.params.idOrSlug) || mockStories[0];
      return { success: true, data: story };
    },
  },
  {
    method: 'POST',
    path: '/content/stories',
    handler: (req) => {
      const body = req.body || {};
      const newStory = {
        id: mockStories.length + 1,
        ref: `STR-${Math.floor(100 + Math.random() * 900)}`,
        author_id: 1,
        author_name: 'Current User',
        author_user_role: 'saler',
        title_en: body.title_en || 'New Story',
        title_bn: body.title_bn || 'নতুন গল্প',
        slug: (body.title_en || 'story').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        content_en: body.content_en || '',
        content_bn: body.content_bn || '',
        cover_image_url: body.cover_image_url || 'https://placehold.co/600x400',
        embedded_product_ids: body.embedded_product_ids || [],
        embedded_products: [],
        status: 'PUBLISHED',
        view_count: 0,
        published_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      mockStories.unshift(newStory);
      return { success: true, data: newStory };
    },
  },
  {
    method: 'POST',
    path: '/content/stories/:id/review',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      const story = mockStories.find((s) => s.id === id);
      if (story) {
        story.status = req.body?.action === 'PUBLISH' ? 'PUBLISHED' : 'REJECTED';
      }
      return { success: true, data: story };
    },
  },

  // Reels
  {
    method: 'GET',
    path: '/content/reels',
    handler: () => ({ success: true, data: mockReels }),
  },
  {
    method: 'POST',
    path: '/content/reels',
    handler: (req) => {
      const body = req.body || {};
      const newReel = {
        id: mockReels.length + 1,
        ref: `REL-${Math.floor(100 + Math.random() * 900)}`,
        author_id: 1,
        author_name: 'Current User',
        video_url: body.video_url || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        thumbnail_url: body.thumbnail_url || 'https://placehold.co/400x600',
        duration_seconds: body.duration_seconds || 15,
        caption_en: body.caption_en || '',
        caption_bn: body.caption_bn || '',
        pinned_product_id: body.pinned_product_id || 1,
        product: mockReels[0]?.product,
        likes_count: 0,
        views_count: 0,
        status: 'PUBLISHED',
        created_at: new Date().toISOString(),
      };
      mockReels.unshift(newReel);
      return { success: true, data: newReel };
    },
  },
  {
    method: 'POST',
    path: '/content/reels/:id/like',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      const reel = mockReels.find((r) => r.id === id);
      if (reel) reel.likes_count += 1;
      return { success: true, data: { id, likes_count: reel?.likes_count || 1 } };
    },
  },

  // Academy
  {
    method: 'GET',
    path: '/academy/courses',
    handler: () => ({ success: true, data: mockCourses }),
  },
  {
    method: 'GET',
    path: '/academy/courses/:idOrRef',
    handler: (req) => {
      const course = mockCourses.find((c) => c.ref === req.params.idOrRef || String(c.id) === req.params.idOrRef) || mockCourses[0];
      return { success: true, data: course };
    },
  },
  {
    method: 'POST',
    path: '/academy/courses/:id/lessons/:lessonId/complete',
    handler: (req) => {
      const courseId = parseInt(req.params.id, 10);
      const lessonId = parseInt(req.params.lessonId, 10);
      const course = mockCourses.find((c) => c.id === courseId);
      if (course) {
        const lesson = (course.lessons || []).find((l) => l.id === lessonId);
        if (lesson) lesson.is_completed = true;
        course.completed_lessons = (course.lessons || []).filter((l) => l.is_completed).length;
        course.progress_pct = Math.round((course.completed_lessons / course.lessons.length) * 100);
        course.is_completed = course.progress_pct >= 100;
      }
      return { success: true, data: { courseId, lessonId, is_completed: true } };
    },
  },

  // Banners
  {
    method: 'GET',
    path: '/content/banners',
    handler: () => ({ success: true, data: mockBanners }),
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
          image_url_desktop: body.image_url_desktop || 'https://placehold.co/1200x400',
          image_url_mobile: body.image_url_mobile || null,
          target_link: body.target_link || '/stories',
          display_order: body.display_order || 1,
          is_active: body.is_active !== undefined ? body.is_active : true,
        };
        mockBanners.push(b);
      }
      return { success: true, data: b };
    },
  },
  {
    method: 'DELETE',
    path: '/editor/banners/:id',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      mockBanners = mockBanners.filter((b) => b.id !== id);
      return { success: true, data: { id, deleted: true } };
    },
  },

  // Translations
  {
    method: 'GET',
    path: '/editor/translations/completeness',
    handler: () => ({
      success: true,
      data: {
        base_locale: 'en',
        base_total_keys: 250,
        locales: [
          { locale: 'en', total_keys: 250, completeness_pct: 100 },
          { locale: 'bn', total_keys: 242, completeness_pct: 97 },
          { locale: 'ar', total_keys: 110, completeness_pct: 44 },
        ],
      },
    }),
  },
  {
    method: 'GET',
    path: '/editor/translations/:locale',
    handler: (req) => ({
      success: true,
      data: mockDynamicTranslations[req.params.locale] || {},
    }),
  },
  {
    method: 'POST',
    path: '/editor/translations',
    handler: (req) => {
      const { locale, namespace, key, value } = req.body || {};
      if (!mockDynamicTranslations[locale]) mockDynamicTranslations[locale] = {};
      mockDynamicTranslations[locale][key] = value;
      return { success: true, data: { locale, namespace, key, value } };
    },
  },
  {
    method: 'GET',
    path: '/editor/translations/:locale/export',
    handler: (req) => ({
      success: true,
      data: mockDynamicTranslations[req.params.locale] || {},
    }),
  },
  {
    method: 'POST',
    path: '/editor/translations/:locale/import',
    handler: (req) => {
      const { locale } = req.params;
      const { translations } = req.body || {};
      mockDynamicTranslations[locale] = { ...mockDynamicTranslations[locale], ...translations };
      return { success: true, data: { locale, imported_keys: Object.keys(translations || {}).length } };
    },
  },
];
