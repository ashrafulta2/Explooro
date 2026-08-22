-- 004_categories.sql (Prompt 4.1)
-- Seed 8 main categories + subcategories with bilingual metadata & materialized paths for Bangladeshi commerce.

INSERT INTO categories (id, parent_id, slug, path, name_en, name_bn, icon_key, display_order, is_active, requires_fefo, requires_age_check, auto_approve) VALUES
  -- 1. Fashion & Apparel
  (1, NULL, 'fashion', 'fashion', 'Fashion & Apparel', 'ফ্যাশন ও পোশাক', 'shirt', 1, true, false, false, true),
  (2, 1, 'fashion-mens', 'fashion.mens', 'Men''s Clothing', 'পুরুষদের পোশাক', 'user', 1, true, false, false, true),
  (3, 1, 'fashion-womens', 'fashion.womens', 'Women''s Traditional Wear', 'নারীদের ঐতিহ্যবাহী পোশাক', 'user-check', 2, true, false, false, true),
  (4, 1, 'fashion-accessories', 'fashion.accessories', 'Bags & Accessories', 'ব্যাগ ও আনুষঙ্গিক', 'briefcase', 3, true, false, false, true),

  -- 2. Electronics & Gadgets
  (5, NULL, 'electronics', 'electronics', 'Electronics & Gadgets', 'ইলেকট্রনিক্স ও গ্যাজেট', 'cpu', 2, true, false, false, false),
  (6, 5, 'electronics-smart', 'electronics.smart', 'Smart Devices & Wearables', 'স্মার্ট ডিভাইস ও পরিধেয়', 'watch', 1, true, false, false, false),
  (7, 5, 'electronics-audio', 'electronics.audio', 'Audio & Headphones', 'অডিও ও হেডফোন', 'headphones', 2, true, false, false, false),

  -- 3. Home & Living
  (8, NULL, 'home-living', 'home', 'Home & Living', 'ঘরবাড়ি ও জীবনযাত্রা', 'home', 3, true, false, false, true),
  (9, 8, 'home-kitchen', 'home.kitchen', 'Kitchen & Dining', 'রান্নাঘর ও ডাইনিং', 'coffee', 1, true, false, false, true),

  -- 4. Health & Beauty
  (10, NULL, 'health-beauty', 'beauty', 'Health & Beauty', 'স্বাস্থ্য ও রূপচর্চা', 'heart', 4, true, true, false, false),
  (11, 10, 'beauty-skincare', 'beauty.skincare', 'Skincare & Cosmetics', 'ত্বকের যত্ন ও প্রসাধন', 'sparkles', 1, true, true, false, false),

  -- 5. Groceries & Organic Foods (Requires FEFO)
  (12, NULL, 'groceries', 'groceries', 'Groceries & Organic Foods', 'মুদি ও অর্গানিক খাবার', 'shopping-bag', 5, true, true, false, true),
  (13, 12, 'groceries-organic', 'groceries.organic', 'Organic Spices, Rice & Honey', 'খাঁটি মসলা, চাল ও মধু', 'feather', 1, true, true, false, true),

  -- 6. Traditional Crafts & Jute Goods
  (14, NULL, 'handicrafts', 'handicrafts', 'Traditional Crafts & Jute', 'ঐতিহ্যবাহী কুটিরশিল্প ও পাটপণ্য', 'gift', 6, true, false, false, true),
  (15, 14, 'handicrafts-jute', 'handicrafts.jute', 'Jute Craft & Nakshi Kantha', 'পাটজাত হস্তশিল্প ও নকশী কাঁথা', 'award', 1, true, false, false, true),

  -- 7. Sports & Fitness
  (16, NULL, 'sports-fitness', 'sports', 'Sports & Fitness', 'খেলাধুলা ও ফিটনেস', 'activity', 7, true, false, false, true),

  -- 8. Books & Stationery
  (17, NULL, 'books-stationery', 'books', 'Books & Stationery', 'বই ও স্টেশনারি', 'book-open', 8, true, false, false, true)
ON CONFLICT (slug) DO UPDATE
SET
  name_en = EXCLUDED.name_en,
  name_bn = EXCLUDED.name_bn,
  path = EXCLUDED.path,
  icon_key = EXCLUDED.icon_key,
  requires_fefo = EXCLUDED.requires_fefo,
  auto_approve = EXCLUDED.auto_approve,
  updated_at = now();
