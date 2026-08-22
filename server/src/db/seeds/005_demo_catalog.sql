-- 005_demo_catalog.sql (Prompt 4.1)
-- Seed realistic Bangladeshi demo data:
-- 3 Suppliers, 2 Salers with Virtual Storefronts, 3 Warehouses, and 60 Products with bilingual titles,
-- variants, warehouse stock allocations, and FEFO batches.
--
-- FIX (Prompt 4.6, caught while verifying this file against a real Postgres wire-protocol
-- connection for the first time): the supplier@dev.explooro.local (+8801700000005) and
-- saler@dev.explooro.local (+8801700000006) identities below deliberately reuse 002_dev_users.sql's
-- phone numbers, per README's documented dev login table — but 002_dev_users.sql always runs first
-- and already owns ids 5 and 6 for those phones. `ON CONFLICT (phone) DO UPDATE` enriches THAT row;
-- it can never re-key it to the `id` literal proposed here. The original `101`/`201` placeholders
-- were therefore dead values that silently discarded every downstream supplier_id=101/saler_id=201
-- reference below with a foreign key violation the first time this seed ever actually ran. Every
-- occurrence has been corrected to the real ids (5, 6) that 002_dev_users.sql assigns; 102/103/202
-- were already correct since those phones are genuinely new.

-- 1. Ensure 3 Suppliers and 2 Salers exist with user profiles & roles
INSERT INTO users (id, ref, phone, email, password_hash, is_phone_verified, is_email_verified, status) VALUES
  (5, 'USR-SUPP-DHAKA', '+8801700000005', 'supplier@dev.explooro.local', '$argon2id$v=19$m=65536,p=4,t=3$Chct4gTM5PJHXS/N5rtF7Q$54SeQDMvY8md1PzEN1BX0mWFzsvAlVidfbhFLgPcl4s', true, true, 'ACTIVE'),
  (102, 'USR-SUPP-BENGAL', '+8801700000015', 'bengal.electronics@dev.explooro.local', '$argon2id$v=19$m=65536,p=4,t=3$Chct4gTM5PJHXS/N5rtF7Q$54SeQDMvY8md1PzEN1BX0mWFzsvAlVidfbhFLgPcl4s', true, true, 'ACTIVE'),
  (103, 'USR-SUPP-SYLHET', '+8801700000025', 'sylhet.agro@dev.explooro.local', '$argon2id$v=19$m=65536,p=4,t=3$Chct4gTM5PJHXS/N5rtF7Q$54SeQDMvY8md1PzEN1BX0mWFzsvAlVidfbhFLgPcl4s', true, true, 'ACTIVE'),
  (6, 'USR-SALER-DHAKA', '+8801700000006', 'saler@dev.explooro.local', '$argon2id$v=19$m=65536,p=4,t=3$Chct4gTM5PJHXS/N5rtF7Q$54SeQDMvY8md1PzEN1BX0mWFzsvAlVidfbhFLgPcl4s', true, true, 'ACTIVE'),
  (202, 'USR-SALER-SMART', '+8801700000016', 'smart.saler@dev.explooro.local', '$argon2id$v=19$m=65536,p=4,t=3$Chct4gTM5PJHXS/N5rtF7Q$54SeQDMvY8md1PzEN1BX0mWFzsvAlVidfbhFLgPcl4s', true, true, 'ACTIVE')
ON CONFLICT (phone) DO UPDATE
SET is_phone_verified = true, status = 'ACTIVE';

INSERT INTO user_profiles (user_id, full_name, display_name, district, division) VALUES
  (5, 'Dhaka Artisan Textiles & Mills', 'Dhaka Artisan Mills', 'Dhaka', 'Dhaka'),
  (102, 'Bengal Tech & Electronics Ltd', 'Bengal Electronics', 'Dhaka', 'Dhaka'),
  (103, 'Sylhet Organic Agro Cooperative', 'Sylhet Agro Organics', 'Sylhet', 'Sylhet'),
  (6, 'Rahim Ahmed (Dhaka Trends)', 'Dhaka Fashion House', 'Dhaka', 'Dhaka'),
  (202, 'Tanvir Hasan (Smart Gadgets BD)', 'Bangla Smart Store', 'Chattogram', 'Chattogram')
ON CONFLICT (user_id) DO UPDATE
SET full_name = EXCLUDED.full_name, display_name = EXCLUDED.display_name;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM (VALUES
  ('+8801700000005', 'supplier'),
  ('+8801700000015', 'supplier'),
  ('+8801700000025', 'supplier'),
  ('+8801700000006', 'saler'),
  ('+8801700000016', 'saler')
) AS x(phone, role_key)
JOIN users u ON u.phone = x.phone
JOIN roles r ON r.key = x.role_key
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 2. Seed 3 Warehouses in Bangladesh
INSERT INTO warehouse_nodes (id, ref, supplier_id, name, division, district, upazila, address_line, latitude, longitude, priority, is_active) VALUES
  (1, 'WH-DHK-01', 5, 'Central Dhaka Fulfilment Hub', 'Dhaka', 'Dhaka', 'Tejgaon', 'Plot 42, Tejgaon I/A, Dhaka-1208', 23.759357, 90.390561, 10, true),
  (2, 'WH-CTG-01', 102, 'Chattogram Port Coastal Depot', 'Chattogram', 'Chattogram', 'Agrabad', 'Commercial Area, Agrabad, Chattogram-4100', 22.338400, 91.831680, 8, true),
  (3, 'WH-SYL-01', 103, 'Sylhet Agro Regional Storage', 'Sylhet', 'Sylhet', 'Amberkhana', 'Airport Road, Amberkhana, Sylhet-3100', 24.894930, 91.868706, 6, true)
ON CONFLICT (ref) DO UPDATE
SET name = EXCLUDED.name, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude;

-- 3. Seed 2 Virtual Stores
INSERT INTO virtual_stores (id, ref, saler_id, slug, shop_name, bio, announcement, has_physical_shop, physical_open_status, is_active) VALUES
  (1, 'STR-DHK-FASH', 6, 'dhaka-fashion', 'Dhaka Fashion House', 'Curated authentic Bangladeshi apparel, Panjabi, Jamdani Sarees, and genuine leather goods.', 'Eid Collection is now live with flat 15% discount across all traditional wear!', true, 'OPEN', true),
  (2, 'STR-BNG-SMRT', 202, 'bangla-smart', 'Bangla Smart Store', 'Your trusted hub for verified electronics, genuine smart wearables, audio gear, and home essentials.', 'Free delivery on all audio accessories this week!', false, 'CLOSED', true)
-- virtual_stores.slug is only uniquely indexed WHERE deleted_at IS NULL (006_catalog.sql) — the
-- ON CONFLICT target must repeat that predicate exactly or Postgres can't infer the index.
ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE
SET shop_name = EXCLUDED.shop_name, bio = EXCLUDED.bio, announcement = EXCLUDED.announcement;

-- 4. Seed 60 Realistic Products (Bilingual, Valid Margins, Stock, Search Vectors)
INSERT INTO products (
  id, ref, supplier_id, category_id, slug,
  title_en, title_bn,
  description_en, description_bn,
  brand, base_cost, wholesale_margin, default_retail_price, min_retail_price,
  stock_qty, low_stock_threshold, weight_grams, has_variants, warranty_months,
  status, rating_avg, rating_count, sold_count
) VALUES
  -- 1-10: Men's & Women's Fashion
  (1, 'PRD-FSH-001', 5, 2, 'mens-cotton-punjabi-maroon',
   'Premium Combed Cotton Semi-Long Panjabi - Maroon', 'প্রিমিয়াম মার্জিত সুতি সেমি-লং পাঞ্জাবি - মেরুন',
   'Crafted from 100% fine combed cotton with intricate mandarin collar embroidery. Perfect for festive and casual occasions.',
   '১০০% খাঁটি সুতি কাপড়ে তৈরি মার্জিত ডিজাইনের সেমি-লং পাঞ্জাবি। উৎসব ও নিয়মিত ব্যবহারের জন্য অত্যন্ত আরামদায়ক।',
   'Artisan Dhaka', 1100.00, 150.00, 1650.00, 1400.00, 120, 10, 350, true, 0, 'ACTIVE', 4.85, 48, 185),

  (2, 'PRD-FSH-002', 5, 2, 'mens-slim-casual-shirt-navy',
   'Men''s Slim Fit Oxford Casual Shirt - Navy Blue', 'পুরুষদের স্লিম ফিট অক্সফোর্ড ক্যাজুয়াল শার্ট - নেভি ব্লু',
   'Breathable Oxford cotton casual shirt with button-down collar and durable double stitching.',
   'আরামদায়ক অক্সফোর্ড কটনের তৈরি স্লিম ফিট ক্যাজুয়াল শার্ট। নিখুঁত সেলাই ও টেকসই ফিনিশিং।',
   'Artisan Dhaka', 850.00, 120.00, 1350.00, 1100.00, 85, 8, 280, true, 0, 'ACTIVE', 4.70, 32, 140),

  (3, 'PRD-FSH-003', 5, 2, 'mens-classic-polo-shirt-black',
   'Classic Pique Cotton Polo Shirt - Jet Black', 'ক্লাসিক পিকে কটন পোলো টি-শার্ট - জেট ব্ল্যাক',
   'Heavyweight 220 GSM pique cotton with ribbed collar and premium mother-of-pearl buttons.',
   '২২০ জিএসএম প্রিমিয়াম পিকে সুতি কাপড়ে তৈরি ক্লাসিক পোলো টি-শার্ট।',
   'Artisan Dhaka', 480.00, 70.00, 780.00, 650.00, 150, 15, 220, true, 0, 'ACTIVE', 4.60, 25, 310),

  (4, 'PRD-FSH-004', 5, 2, 'mens-stretch-chino-pants-khaki',
   'Smart Stretch Chino Pants - Khaki Beige', 'স্মার্ট স্ট্রেচ চিনো প্যান্ট - খাকি বেইজ',
   'Comfortable cotton-spandex twill chinos tailored with modern tapered leg.',
   'কটন-স্প্যানডেক্স কাপড়ে তৈরি নমনীয় ও আরামদায়ক চিনো প্যান্ট।',
   'Bengal Outfitters', 950.00, 130.00, 1490.00, 1250.00, 70, 5, 420, true, 0, 'ACTIVE', 4.75, 19, 95),

  (5, 'PRD-FSH-005', 5, 3, 'traditional-dhakai-jamdani-saree-red',
   'Authentic Handloom Dhakai Jamdani Saree - Crimson Red', 'ঐতিহ্যবাহী তাঁতের খাঁটি ঢাকাই জামদানি শাড়ি - গাঢ় লাল',
   'Hand-woven 84-count pure cotton thread with exquisite traditional floral motifs. Direct from Narayanganj weavers.',
   'নারায়ণগঞ্জের দক্ষ তাঁতিদের হাতে বোনা খাঁটি সুতি সুতোর ঐতিহ্যবাহী ঢাকাই জামদানি শাড়ি।',
   'Dhakai Weaves', 4200.00, 600.00, 6500.00, 5500.00, 30, 3, 550, false, 0, 'ACTIVE', 4.95, 64, 82),

  (6, 'PRD-FSH-006', 5, 3, 'women-embroidered-kurti-pastel-green',
   'Embroidered Viscose-Silk Kurti - Sage Green', 'কারুকাজ খচিত ভিসকস সিল্ক কুর্তি - সেজ গ্রিন',
   'Elegant side-slit kurti with delicate threadwork on neckline and sleeves.',
   'গলা ও হাতায় মনোরম সুতার কাজ করা প্রিমিয়াম ভিসকস সিল্ক কুর্তি।',
   'Dhakai Weaves', 900.00, 140.00, 1450.00, 1200.00, 60, 6, 250, true, 0, 'ACTIVE', 4.65, 28, 115),

  (7, 'PRD-FSH-007', 5, 3, 'block-print-three-piece-cotton',
   'Handcrafted Block Print Cotton Three-Piece Set', 'হস্তনির্মিত ব্লক প্রিন্ট সুতি থ্রি-পিস সেট',
   'Unstitched Voile cotton kameez, salwar and matching dupatta with eco-friendly natural dye prints.',
   'প্রাকৃতিক রঙে ব্লক প্রিন্ট করা আরামদায়ক ভয়েল কটন থ্রি-পিস সেট।',
   'Bengal Crafts', 1250.00, 180.00, 1950.00, 1600.00, 90, 10, 480, false, 0, 'ACTIVE', 4.80, 42, 210),

  (8, 'PRD-FSH-008', 5, 4, 'genuine-leather-bifold-wallet-tan',
   'Full-Grain Genuine Leather Bifold Wallet - Tan Brown', 'খাঁটি লেদার বাইফোল্ড ওয়ালেট - ট্যান ব্রাউন',
   'Hand-stitched vegetable tanned cow leather wallet with 8 card slots and dual currency compartments.',
   'হাতে সেলাই করা টেকসই খাঁটি চামড়ার মানিব্যাগ। ৮টি কার্ড স্লট ও দুটি ক্যাশ কম্পার্টমেন্টযুক্ত।',
   'Hazaribagh Leather Co', 650.00, 100.00, 1150.00, 950.00, 110, 12, 120, false, 6, 'ACTIVE', 4.88, 56, 320),

  (9, 'PRD-FSH-009', 5, 4, 'leather-laptop-messenger-bag',
   'Executive Leather Messenger Bag for 15.6" Laptop', '১৫.৬ ইঞ্চি ল্যাপটপের জন্য এক্সিকিউটিভ লেদার মেসেঞ্জার ব্যাগ',
   'Padded laptop compartment with brass hardware, adjustable shoulder strap, and waterproof inner lining.',
   'প্যাডেড ল্যাপটপ চেম্বার ও খাঁটি চামড়ায় তৈরি পেশাদার মেসেঞ্জার অফিস ব্যাগ।',
   'Hazaribagh Leather Co', 2400.00, 350.00, 3950.00, 3200.00, 40, 5, 950, false, 12, 'ACTIVE', 4.90, 38, 75),

  (10, 'PRD-FSH-010', 5, 4, 'durable-canvas-travel-backpack',
   'Multi-Pocket Water-Resistant Canvas Backpack', 'ওয়াটার-রেজিস্ট্যান্ট মাল্টি-পকেট ক্যানভাস ব্যাকপ্যাক',
   '30L travel and university backpack with anti-theft back pocket and USB charging port.',
   'ভ্রমণ ও দৈনন্দিন ব্যবহারের জন্য ৩০ লিটার ধারণক্ষমতাসম্পন্ন টেকসই ক্যানভাস ব্যাকপ্যাক।',
   'Bengal Outfitters', 1100.00, 150.00, 1750.00, 1450.00, 75, 8, 720, true, 6, 'ACTIVE', 4.72, 22, 130),

  -- 11-20: Electronics & Gadgets
  (11, 'PRD-ELC-011', 102, 6, 'smartwatch-amoled-bluetooth-calling',
   'Ultra 2 Smartwatch with 1.96" AMOLED & BT Calling', '১.৯৬" অ্যামোলেড ডিসপ্লে ও কলিং স্মার্টওয়াচ',
   'Always-on AMOLED display, heart-rate & SpO2 tracking, 7-day battery, IP68 water resistance.',
   '১.৯৬ ইঞ্চি এইচডি অ্যামোলেড ডিসপ্লে, ব্লুটুথ কলিং, স্বাস্থ্য ট্র্যাকিং এবং ৭ দিনের ব্যাটারি ব্যাকআপ।',
   'Apex Gadgets', 2200.00, 300.00, 3250.00, 2800.00, 95, 10, 150, true, 12, 'ACTIVE', 4.78, 62, 240),

  (12, 'PRD-ELC-012', 102, 7, 'wireless-anc-earbuds-tws',
   'Noise-Cancelling TWS Wireless Earbuds with Dual Mic', 'অ্যাক্টিভ নয়েজ ক্যানসেলিং টিডব্লিউএস ইয়ারবাডস',
   '35dB Active Noise Cancellation, Bluetooth 5.3, 30-hour total playback with charging case.',
   '৩৫ ডেসিবেল নয়েজ ক্যানসেলেশন ও স্পষ্ট ভয়েস কল সুবিধাসহ আধুনিক ওয়্যারলেস ইয়ারবাডস।',
   'Apex Gadgets', 1400.00, 200.00, 2150.00, 1850.00, 140, 15, 95, true, 12, 'ACTIVE', 4.82, 74, 410),

  (13, 'PRD-ELC-013', 102, 6, 'fast-charging-power-bank-20000mah',
   '22.5W Fast Charging Power Bank 20000mAh', '২২.৫ ওয়াট ফাস্ট চার্জিং পাওয়ার ব্যাংক ২০০০০ এমএএইচ',
   'Dual USB-A and PD 20W Type-C output. Digital LED battery percentage display.',
   '২২.৫ ওয়াট সুপার ফাস্ট চার্জিং ও ডিজিটাল ব্যাটারি লেভেল ডিসপ্লে সমৃদ্ধ ২০০০০ এমএএইচ পাওয়ার ব্যাংক।',
   'PowerVolt', 1350.00, 180.00, 1950.00, 1700.00, 120, 10, 380, false, 12, 'ACTIVE', 4.88, 91, 520),

  (14, 'PRD-ELC-014', 102, 7, 'portable-bluetooth-speaker-waterproof',
   'IPX7 Waterproof 16W Portable Bluetooth Speaker', 'আইপিএক্স৭ ওয়াটারপ্রুফ ১৬ ওয়াট পোর্টেবল ব্লুটুথ স্পিকার',
   'Deep bass stereo drivers, 12 hours playtime, rugged shockproof rubberized exterior.',
   'শক্তিশালী বেস ও ১২ ঘণ্টার প্লেব্যাক সুবিধাসহ ওয়াটারপ্রুফ পোর্টেবল ব্লুটুথ স্পিকার।',
   'Apex Gadgets', 1600.00, 220.00, 2450.00, 2100.00, 65, 6, 450, true, 12, 'ACTIVE', 4.70, 35, 160),

  (15, 'PRD-ELC-015', 102, 6, 'gan-65w-usb-c-charger-adapter',
   '65W GaN Fast Charger Adapter (2x USB-C + 1x USB-A)', '৬৫ ওয়াট জিএএন ৩-পোর্ট ফাস্ট চার্জার অ্যাডাপ্টার',
   'Compact Gallium Nitride fast charger for laptops, tablets, and phones simultaneously.',
   'ল্যাপটপ ও স্মার্টফোন দ্রুত চার্জ করার জন্য শক্তিশালী ও কম্প্যাক্ট ৬৫ ওয়াট চার্জার।',
   'PowerVolt', 1250.00, 160.00, 1850.00, 1550.00, 80, 8, 140, false, 12, 'ACTIVE', 4.91, 49, 290),

  (16, 'PRD-ELC-016', 102, 6, 'rgb-mechanical-gaming-keyboard',
   'Compact 75% Mechanical Keyboard with Red Switches', '৭৫% আরজিবি মেকানিক্যাল গেমিং কীবোর্ড (রেড সুইচ)',
   'Hot-swappable linear red switches, sound-dampening foam, per-key RGB backlighting.',
   'স্মুথ টাইপিং ও গেমিংয়ের জন্য হট-সোয়াপ্যাবল মেকানিক্যাল রেড সুইচ কীবোর্ড।',
   'Bengal Tech', 2100.00, 280.00, 3100.00, 2700.00, 50, 5, 820, true, 12, 'ACTIVE', 4.85, 33, 110),

  (17, 'PRD-ELC-017', 102, 6, 'wireless-rechargeable-mouse-silent',
   'Dual-Mode Silent Wireless Optical Mouse (BT + 2.4GHz)', 'ডুয়েল-মোড সাইলেন্ট রিচার্জেবল ওয়্যারলেস মাউস',
   'Silent click buttons, 2400 DPI optical sensor, built-in Type-C rechargeable battery.',
   'শব্দহীন ক্লিক ও রিচার্জেবল ব্যাটারিসহ ব্লুটুথ ও ওয়্যারলেস ডুয়েল মোড মাউস।',
   'Bengal Tech', 450.00, 60.00, 750.00, 600.00, 160, 15, 110, true, 6, 'ACTIVE', 4.65, 41, 380),

  (18, 'PRD-ELC-018', 102, 6, 'usb-c-7-in-1-hub-hdmi-4k',
   '7-in-1 USB-C Hub with 4K HDMI, SD Reader & 100W PD', '৭-ইন-১ ইউএসবি-সি হাব (৪কে এইচডিএমআই ও ১০০ ওয়াট পিডি)',
   'Aluminum alloy shell with 4K@60Hz HDMI output, USB 3.0 ports, and SD/TF card slots.',
   'অ্যালুমিনিয়াম বডির হাই-স্পিড ৭-ইন-১ মাল্টিপোর্ট ইউএসবি হাব।',
   'Bengal Tech', 1150.00, 160.00, 1690.00, 1450.00, 70, 7, 90, false, 12, 'ACTIVE', 4.80, 27, 195),

  (19, 'PRD-ELC-019', 102, 6, 'ring-light-tripod-mobile-stand',
   '12" LED Ring Light with 7ft Extendable Tripod Stand', '১২ ইঞ্চি এলইডি রিং লাইট ও ৭ ফুট ট্রাইপড স্ট্যান্ড',
   '3 color lighting modes, 10 brightness levels, 360-degree rotating phone holder with wireless remote.',
   'ভিডিও মেকিং ও লাইভ স্ট্রিমিংয়ের জন্য ৩টি কালার মোডযুক্ত ১২ ইঞ্চি রিং লাইট ও স্ট্যান্ড।',
   'Apex Gadgets', 800.00, 110.00, 1250.00, 1050.00, 90, 10, 1100, false, 6, 'ACTIVE', 4.68, 38, 260),

  (20, 'PRD-ELC-020', 102, 7, 'wireless-lapel-microphone-type-c',
   'Plug & Play Wireless Lavalier Lapel Microphone (Type-C)', 'প্লাগ অ্যান্ড প্লে ওয়্যারলেস ল্যাপেল মাইক্রোফোন',
   '20-meter range, real-time noise reduction, 6-hour continuous battery for vlogging and online classes.',
   'ক্লিয়ার ভয়েস রেকর্ডিং ও ভ্লগিংয়ের জন্য নয়েজ রিডাকশন সমৃদ্ধ ওয়্যারলেস কলার মাইক।',
   'Apex Gadgets', 720.00, 100.00, 1150.00, 950.00, 110, 12, 65, false, 6, 'ACTIVE', 4.74, 52, 330),

  -- 21-30: Home & Kitchen
  (21, 'PRD-HOM-021', 5, 9, 'granite-nonstick-cookware-set-3pc',
   'Forged Granite 3-Piece Non-Stick Cookware Set with Glass Lids', 'গ্রানাইট কোটিং ৩-পিস নন-স্টিক রান্নার হাঁড়ির সেট',
   'Induction and gas compatible, PFOA-free 5-layer granite coating, cool-touch bakelite handles.',
   'গ্যাস ও ইন্ডাকশনে ব্যবহারের উপযোগী পিএফওএ-মুক্ত ৩-পিস নন-স্টিক কুকওয়্যার সেট।',
   'ChefMaster BD', 2100.00, 300.00, 3200.00, 2700.00, 45, 5, 2400, false, 12, 'ACTIVE', 4.88, 43, 110),

  (22, 'PRD-HOM-022', 5, 9, 'stainless-steel-thermal-flask-1000ml',
   'Vacuum Insulated Stainless Steel Thermal Flask 1000ml', 'ভ্যাকুয়াম ইনসুলেটেড স্টেইনলেস স্টিল থার্মাল ফ্লাস্ক ১০০০ মি.লি.',
   'Keeps beverages hot for 18 hours or cold for 24 hours. Double-wall food grade 304 steel.',
   '১৮ ঘণ্টা গরম ও ২৪ ঘণ্টা ঠান্ডা রাখার ক্ষমতাসম্পন্ন খাঁটি ৩০৪ গ্রেড স্টিলের থার্মোফ্লাস্ক।',
   'ChefMaster BD', 650.00, 90.00, 990.00, 850.00, 130, 15, 480, true, 12, 'ACTIVE', 4.79, 58, 420),

  (23, 'PRD-HOM-023', 5, 9, 'ceramic-glazed-coffee-mugs-set-4',
   'Handcrafted Glazed Ceramic Coffee Mugs (Set of 4)', 'হস্তনির্মিত সিরামিক কফি মগ সেট (৪টি)',
   'Microwave & dishwasher safe, lead-free glossy earthy finish with comfortable ergonomic handle.',
   'মাইক্রোওয়েভ নিরাপদ ও সীসামুক্ত মনোরম গ্লেজড সিরামিক কফি মগ সেট।',
   'ClayCraft Studio', 550.00, 80.00, 890.00, 750.00, 80, 8, 1200, false, 0, 'ACTIVE', 4.85, 31, 190),

  (24, 'PRD-HOM-024', 5, 8, 'cotton-king-size-bedsheet-floral',
   'Pure Cotton King Size Bedsheet with 2 Pillow Covers', '১০০% খাঁটি সুতি কিং সাইজ বেডশিট ও ২টি বালিশের কভার',
   '250 thread count breathable cotton bedsheet with color-fast elegant floral prints (90" x 100").',
   'উজ্জ্বল ও টেকসই রঙের ২৫০ থ্রেড কাউন্টের খাঁটি সুতি কিং সাইজ বিছানার চাদর।',
   'HomeComforts BD', 1150.00, 160.00, 1750.00, 1450.00, 90, 10, 850, true, 0, 'ACTIVE', 4.81, 47, 260),

  (25, 'PRD-HOM-025', 5, 8, 'natural-jute-floor-rug-round',
   'Handmade Braided Natural Jute Floor Rug (4 Feet Round)', 'হস্তনির্মিত প্রাকৃতিক পাটের গোলাকার ফ্লোর ম্যাট (৪ ফুট)',
   'Eco-friendly 100% golden jute braided by village artisans for sustainable living spaces.',
   '১০০% খাঁটি সোনালী আঁশ পাটে দক্ষ কারিগরদের হাতে তৈরি নান্দনিক ফ্লোর রাগ।',
   'JuteVillage', 950.00, 140.00, 1550.00, 1300.00, 50, 5, 1800, false, 0, 'ACTIVE', 4.90, 24, 85),

  (26, 'PRD-HOM-026', 5, 9, 'natural-bamboo-cutting-board-large',
   'Heavy-Duty Natural Bamboo Cutting & Chopping Board', 'প্রাকৃতিক বাঁশের তৈরি হেভি-ডিউটি কাটিং বোর্ড',
   'Organic antibacterial bamboo board with deep juice groove and built-in metal hanging handle.',
   'অর্গানিক বাঁশে তৈরি টেকসই, স্বাস্থ্যকর ও দাগ প্রতিরোধী কিচেন কাটিং বোর্ড।',
   'ChefMaster BD', 420.00, 60.00, 690.00, 550.00, 110, 10, 750, false, 0, 'ACTIVE', 4.73, 29, 230),

  (27, 'PRD-HOM-027', 5, 9, 'revolving-spice-rack-16-jars',
   '360° Revolving Countertop Spice Rack with 16 Glass Jars', '৩৬০° ঘূর্ণনশীল কিচেন মশলার তাক (১৬টি গ্লাস জারসহ)',
   'Space-saving stainless steel carousel with airtight spice dispenser jars.',
   'রান্নাঘরের সৌন্দর্য ও সুবিধা বৃদ্ধিতে ১৬টি জারযুক্ত ঘূর্ণনশীল স্টেইনলেস স্টিল মশলার র‍্যাক।',
   'ChefMaster BD', 1100.00, 150.00, 1690.00, 1400.00, 60, 6, 1650, false, 6, 'ACTIVE', 4.77, 36, 175),

  (28, 'PRD-HOM-028', 5, 8, 'rechargeable-led-desk-lamp-touch',
   'Eye-Protection Dimmable Rechargeable LED Desk Lamp', 'আই-প্রোটেকশন ডিম্যাবল রিচার্জেবল এলইডি টেবিল ল্যাম্প',
   'Flicker-free warm/white lighting with flexible 360 gooseneck and 2000mAh backup battery.',
   'চোখের সুরক্ষা ও পড়ার সুবিধার জন্য ৩ কালার মোড সমৃদ্ধ রিচার্জেবল টেবিল ল্যাম্প।',
   'HomeComforts BD', 580.00, 80.00, 920.00, 780.00, 95, 10, 320, true, 6, 'ACTIVE', 4.69, 41, 280),

  (29, 'PRD-HOM-029', 5, 8, 'microfiber-spin-mop-bucket-set',
   '360° Rotating Microfiber Spin Mop with Foot-Pedal Bucket', '৩৬০° রোটেটিং মাইক্রোফাইবার স্পিন মপ ও ওয়াটার বাকেট',
   'Heavy-duty stainless steel wringer basket, extendable handle, and 2 absorbent microfiber heads.',
   'সহজে ঘর পরিষ্কারের জন্য টেকসই স্টিল ড্রায়ারযুক্ত স্পিন মপ ও বাকেট সেট।',
   'HomeComforts BD', 900.00, 130.00, 1450.00, 1200.00, 70, 8, 2200, false, 6, 'ACTIVE', 4.64, 25, 150),

  (30, 'PRD-HOM-030', 5, 8, 'scented-soy-wax-candle-jar',
   'Aromatherapy Natural Scented Soy Candle in Glass Jar', 'অ্যারোমাথেরাপিউটিক প্রাকৃতিক সুগন্ধি সয়া ক্যান্ডেল',
   'Hand-poured 100% soy wax with lavender and vanilla essential oils for 35 hours clean burn.',
   'ল্যাভেন্ডার ও ভ্যানিলার মিষ্টি সুবাসযুক্ত পরিবেশবান্ধব প্রাকৃতিক সয়া ক্যান্ডেল।',
   'ClayCraft Studio', 380.00, 50.00, 620.00, 500.00, 120, 12, 280, true, 0, 'ACTIVE', 4.87, 18, 140),

  -- 31-40: Health & Beauty (FEFO & Expiry Managed)
  (31, 'PRD-BTY-031', 103, 11, 'organic-aloe-vera-gel-250ml',
   '99% Pure Organic Soothing Aloe Vera Gel 250ml', '৯৯% খাঁটি অর্গানিক অ্যালোভেরা জেল ২৫০ মি.লি.',
   'Multi-purpose natural soothing moisturizer for face, skin, and hair. Paraben and alcohol-free.',
   'ত্বক ও চুলের গভীর আর্দ্রতা ও প্রশান্তির জন্য প্যারাবেন-মুক্ত প্রাকৃতিক অ্যালোভেরা জেল।',
   'NatureBio BD', 220.00, 40.00, 390.00, 320.00, 200, 20, 260, false, 0, 'ACTIVE', 4.88, 88, 620),

  (32, 'PRD-BTY-032', 103, 11, 'herbal-neem-tea-tree-face-wash',
   'Purifying Herbal Neem & Tea Tree Oil Face Wash 150ml', 'নিম ও টি ট্রি অয়েল সমৃদ্ধ ভেষজ ফেসওয়াশ ১৫০ মি.লি.',
   'Deep pore cleansing and anti-acne formula suitable for oily and sensitive Bangladeshi skin.',
   'তৈলাক্ত ত্বকের ব্রণ ও ব্ল্যাকহেডস দূর করতে নিম ও টি ট্রি তেলের প্রাকৃতিক ভেষজ ফেসওয়াশ।',
   'NatureBio BD', 180.00, 30.00, 320.00, 260.00, 180, 18, 160, false, 0, 'ACTIVE', 4.75, 73, 540),

  (33, 'PRD-BTY-033', 103, 11, 'kumkumadi-saffron-facial-oil-30ml',
   'Ayurvedic Kumkumadi Saffron Glow Face Serum 30ml', 'আয়ুর্বেদিক কুমকুমাদি জাফরান গ্লো ফেস সিরাম ৩০ মি.লি.',
   'Infused with 24 precious herbs, Kashmiri saffron, and sandalwood oil for skin brightening.',
   'কাশ্মীরি জাফরান ও চন্দন তেলের মিশ্রণে তৈরি উজ্জ্বলতা বৃদ্ধিকারী খাঁটি আয়ুর্বেদিক ফেস সিরাম।',
   'NatureBio BD', 650.00, 100.00, 1150.00, 950.00, 90, 10, 90, false, 0, 'ACTIVE', 4.93, 51, 230),

  (34, 'PRD-BTY-034', 103, 11, 'virgin-cold-pressed-coconut-oil-500ml',
   'Extra Virgin Cold-Pressed Coconut Hair & Skin Oil 500ml', 'এক্সট্রা ভার্জিন কোল্ড-প্রেসড খাঁটি নারিকেল তেল ৫০০ মি.লি.',
   '100% pure edible grade oil extracted from fresh coconut milk without heat or chemicals.',
   'তাজা নারিকেলের দুধ থেকে কোনো তাপ ছাড়া প্রস্তুতকৃত পুষ্টিকর ১০০% খাঁটি তেল।',
   'Sylhet Agro', 350.00, 50.00, 550.00, 480.00, 140, 15, 520, false, 0, 'ACTIVE', 4.90, 66, 410),

  (35, 'PRD-BTY-035', 103, 11, 'spf-50-pa-matte-sunscreen-50ml',
   'Matte Finish Lightweight Sunscreen SPF 50+ PA++++ (50ml)', 'ম্যাট ফিনিশ নন-গ্রিসি সানস্ক্রিন এসপিএফ ৫০+ (৫০ মি.লি.)',
   'Broad spectrum UVA/UVB protection with zero white cast and sweat-resistant formula.',
   'ঘাম প্রতিরোধী, তৈলাক্ততাহীন ও সহজে মিশে যাওয়া উচ্চমানের এসপিএফ ৫০+ সানস্ক্রিন।',
   'NatureBio BD', 380.00, 60.00, 650.00, 520.00, 130, 12, 60, false, 0, 'ACTIVE', 4.82, 44, 310),

  (36, 'PRD-BTY-036', 103, 11, 'hydrating-rose-water-toner-200ml',
   'Steam-Distilled Pure Rose Water Facial Mist 200ml', 'বাষ্প-পাতিত খাঁটি গোলাপ জল ফেসিয়াল মিস্ট ২০০ মি.লি.',
   'Natural skin toner made from fresh Damask rose petals to balance pH and hydrate skin.',
   'তাজা গোলাপের পাপড়ি থেকে তৈরি ত্বক সতেজকারী ও পিএইচ ব্যালান্সিং ফেসিয়াল মিস্ট।',
   'NatureBio BD', 190.00, 30.00, 340.00, 270.00, 160, 15, 210, false, 0, 'ACTIVE', 4.86, 39, 480),

  (37, 'PRD-BTY-037', 103, 11, 'charcoal-clay-face-mask-100g',
   'Activated Charcoal & Bentonite Detox Clay Mask 100g', 'অ্যাক্টিভেটেড চারকোল ও বেন্টোনাইট ক্লে মাস্ক ১০০ গ্রাম',
   'Pore purifying detox mask that removes excess oil and environmental pollutants.',
   'ত্বকের গভীরের ধুলোবালি ও অতিরিক্ত তেল দূর করতে চারকোল ও বেন্টোনাইট ক্লে মাস্ক।',
   'NatureBio BD', 280.00, 40.00, 490.00, 400.00, 85, 8, 110, false, 0, 'ACTIVE', 4.69, 21, 160),

  (38, 'PRD-BTY-038', 103, 11, 'long-lasting-matte-lipstick-crimson',
   'Waterproof Long-Wear Matte Liquid Lipstick - Crimson Velvet', 'ওয়াটারপ্রুফ লং-লাস্টিং ম্যাট লিকুইড লিপস্টিক - ভেলভেট রেড',
   '12-hour transfer-proof formula enriched with Vitamin E and Jojoba oil.',
   'ভিটামিন ই সমৃদ্ধ ১২ ঘণ্টা স্থায়ী ওয়াটারপ্রুফ ম্যাট লিকুইড লিপস্টিক।',
   'GlamourBD', 320.00, 50.00, 550.00, 450.00, 110, 10, 25, true, 0, 'ACTIVE', 4.78, 33, 270),

  (39, 'PRD-BTY-039', 103, 11, 'anti-dandruff-onion-hair-oil-200ml',
   'Ayurvedic Red Onion & Black Seed Hair Growth Oil 200ml', 'লাল পেঁয়াজ ও কালোজিরা ভেষজ চুল বৃদ্ধির তেল ২০০ মি.লি.',
   'Reduces hair fall, nourishes scalp, and eliminates dandruff with 14 cold-pressed oils.',
   'চুল পড়া কমাতে ও খুশকি দূর করতে লাল পেঁয়াজ ও কালোজিরার পুষ্টিকর প্রাকৃতিক তেল।',
   'Sylhet Agro', 260.00, 40.00, 450.00, 380.00, 125, 12, 220, false, 0, 'ACTIVE', 4.84, 52, 380),

  (40, 'PRD-BTY-040', 103, 11, 'handcrafted-goat-milk-soap-bar',
   'Handcrafted Organic Goat Milk & Honey Gentle Soap 100g', 'অর্গানিক ছাগলের দুধ ও মধুর প্রাকৃতিক হ্যান্ডমেড সাবান ১০০ গ্রাম',
   'Ultra-mild handmade cold-process bar rich in lactic acid and natural glycerin.',
   'সংবেদনশীল ত্বকের যত্নে প্রাকৃতিক গ্লিসারিন ও ছাগলের দুধের তৈরি কোমল সাবান।',
   'NatureBio BD', 120.00, 25.00, 220.00, 180.00, 175, 18, 100, true, 0, 'ACTIVE', 4.91, 40, 490),

  -- 41-50: Groceries & Organic Foods (FEFO Managed)
  (41, 'PRD-GRO-041', 103, 13, 'sundarbans-raw-wild-honey-500g',
   '100% Pure Raw Sundarbans Mangrove Forest Honey 500g', '১০০% খাঁটি সুন্দরবনের প্রাকৃতিক খলিশা ফুলের মধু ৫০০ গ্রাম',
   'Unpasteurized raw honey hand-harvested directly by traditional mouwals of Sundarbans.',
   'সুন্দরবনের ঐতিহ্যবাহী মৌয়ালদের মাধ্যমে সংগৃহীত অপরিশোধিত ও খাঁটি প্রাকৃতিক মধু।',
   'Sylhet Agro Organics', 450.00, 70.00, 750.00, 620.00, 160, 15, 520, false, 0, 'ACTIVE', 4.98, 112, 850),

  (42, 'PRD-GRO-042', 103, 13, 'premium-kalijira-aromatic-rice-5kg',
   'Premium Dinajpur Kalijira Aromatic Polao Rice 5kg', 'দিনাজপুরের প্রিমিয়াম খাঁটি সুগন্ধি কালিজিরা পোলাও চাল ৫ কেজি',
   'Aged aromatic short-grain rice with exquisite fragrant aroma for biryani and polao.',
   'পোলাও, বিরিয়ানি ও ক্ষীরের জন্য দিনাজপুরের বিখ্যাত সুবাসিত ও বাছাইকৃত কালিজিরা চাল।',
   'Sylhet Agro Organics', 580.00, 80.00, 850.00, 750.00, 120, 12, 5050, false, 0, 'ACTIVE', 4.92, 85, 620),

  (43, 'PRD-GRO-043', 103, 13, 'cold-pressed-mustard-oil-1000ml',
   'Wood-Pressed Pure Ghani Mustard Oil 1000ml (Kachi Ghani)', 'কাঠের ঘানিতে ভাঙানো খাঁটি সরিষার তেল ১ লিটার',
   'Traditional slow cold-pressed from selected Deshi yellow mustard seeds. Rich pungency.',
   'দেশি হলুদ সরিষা থেকে কাঠের ঘানিতে প্রস্তুতকৃত তীব্র ঝাঁঝ ও অতুলনীয় স্বাদের খাঁটি তেল।',
   'Sylhet Agro Organics', 240.00, 35.00, 360.00, 310.00, 190, 20, 1020, false, 0, 'ACTIVE', 4.95, 94, 910),

  (44, 'PRD-GRO-044', 103, 13, 'organic-turmeric-powder-500g',
   'Hand-Ground Organic Mountain Turmeric Powder 500g', 'পাহাড়ের খাঁটি অর্গানিক হলুদ গুঁড়া ৫০০ গ্রাম',
   'High curcumin natural turmeric sun-dried and ground without artificial coloring or starch.',
   'উচ্চ কারকিউমিন সমৃদ্ধ পাহাড়ের প্রাকৃতিক হলুদ। কোনো কৃত্রিম রঙ বা ভেজালমুক্ত।',
   'Sylhet Agro Organics', 150.00, 25.00, 240.00, 200.00, 140, 15, 510, false, 0, 'ACTIVE', 4.88, 48, 430),

  (45, 'PRD-GRO-045', 103, 13, 'traditional-cow-ghee-400g',
   'Traditional Cultured Cow Ghee (Danadar Ghee) 400g', 'ঘিয়ের ঐতিহ্যবাহী দানাদার খাঁটি গাওয়া ঘি ৪০০ গ্রাম',
   'Aromatic golden granular ghee slowly simmered from cultured village cow butter.',
   'গ্রামের খামারিদের খাঁটি মাখন থেকে সনাতন পদ্ধতিতে জ্বাল দেওয়া সুস্বাদু দানাদার ঘি।',
   'Sylhet Agro Organics', 620.00, 90.00, 950.00, 820.00, 90, 10, 420, false, 0, 'ACTIVE', 4.96, 68, 380),

  (46, 'PRD-GRO-046', 103, 13, 'organic-raw-chia-seeds-500g',
   'Superfood Premium Organic Raw Chia Seeds 500g', 'প্রিমিয়াম অর্গানিক কাঁচা চিয়া সিড ৫০০ গ্রাম',
   'High fiber and Omega-3 rich certified raw seeds for weight management and smoothie bowls.',
   'ওমেগা-৩ ও উচ্চ ফাইবারযুক্ত পুষ্টিকর ও পরিষ্কার সুপারফুড চিয়া সিড।',
   'Sylhet Agro Organics', 280.00, 40.00, 450.00, 380.00, 130, 12, 510, false, 0, 'ACTIVE', 4.86, 42, 340),

  (47, 'PRD-GRO-047', 103, 13, 'premium-green-cardamom-100g',
   'Jumbo Aromatic Green Cardamom (Elachi) 100g', 'বড় দানার সুগন্ধি সবুজ এলাচ ১০০ গ্রাম',
   'Intensely fragrant 8mm green cardamom pods hand-sorted for rich culinary flavour.',
   '৮ মি.মি. বড় দানার সবুজ তাজা ও সুবাসিত প্রিমিয়াম এলাচ।',
   'Sylhet Agro Organics', 340.00, 50.00, 520.00, 440.00, 150, 15, 110, false, 0, 'ACTIVE', 4.89, 37, 260),

  (48, 'PRD-GRO-048', 103, 13, 'premium-california-almonds-500g',
   'Crisp Whole California Raw Almonds (Badam) 500g', 'আমদানিকৃত আস্ত খাঁটি ক্যালিফোর্নিয়া কাঠবাদাম ৫০০ গ্রাম',
   'Freshly packed crunchy non-GMO almonds rich in vitamin E and healthy monounsaturated fats.',
   'তাজা, মচমচে ও ভিটামিন ই সমৃদ্ধ বাছাইকৃত খাঁটি ক্যালিফোর্নিয়া কাঠবাদাম।',
   'Sylhet Agro Organics', 450.00, 65.00, 680.00, 580.00, 110, 10, 510, false, 0, 'ACTIVE', 4.90, 53, 310),

  (49, 'PRD-GRO-049', 103, 13, 'black-seed-kalijira-oil-200ml',
   '100% Pure Extra Virgin Black Seed Oil (Kalonji) 200ml', '১০০% খাঁটি কোল্ড-প্রেসড কালোজিরা তেল ২০০ মি.লি.',
   'First cold-press extraction of prime Nigella Sativa seeds for health and immunity.',
   'রোগ প্রতিরোধ ক্ষমতা বৃদ্ধিতে প্রথম চাপে প্রস্তুতকৃত ১০০% খাঁটি কালোজিরা তেল।',
   'Sylhet Agro Organics', 280.00, 40.00, 440.00, 360.00, 120, 12, 210, false, 0, 'ACTIVE', 4.93, 61, 420),

  (50, 'PRD-GRO-050', 103, 13, 'organic-pink-himalayan-salt-1kg',
   'Natural Mineral-Rich Pink Himalayan Rock Salt 1kg', 'খনিজ সমৃদ্ধ প্রাকৃতিক পিঙ্ক হিমালয়ান রক সল্ট ১ কেজি',
   'Unrefined food-grade pink crystal salt packed with 84 trace minerals.',
   '৮৪টি প্রাকৃতিক খনিজ উপাদান সমৃদ্ধ অপরিশোধিত খাঁটি পিঙ্ক হিমালয়ান সল্ট।',
   'Sylhet Agro Organics', 130.00, 20.00, 220.00, 180.00, 180, 20, 1010, false, 0, 'ACTIVE', 4.84, 35, 390),

  -- 51-60: Traditional Crafts, Sports & Books
  (51, 'PRD-CRF-051', 5, 15, 'handcrafted-nakshi-kantha-quilt',
   'Masterpiece Hand-Embroidered Traditional Nakshi Kantha (King Size)', 'ঐতিহ্যবাহী হাতে সেলাই করা নকশী কাঁথা (কিং সাইজ)',
   'Months of delicate hand embroidery showcasing rural folk motifs by master Jessore artisans.',
   'যশোরের অভিজ্ঞ কারিগরদের মাসব্যাপী পরিশ্রমে হাতে সূক্ষ্ম নকশায় বোনা রাজকীয় নকশী কাঁথা।',
   'Bengal Crafts', 3200.00, 450.00, 4950.00, 4200.00, 25, 2, 1400, false, 0, 'ACTIVE', 4.97, 45, 62),

  (52, 'PRD-CRF-052', 5, 15, 'jute-tote-handbag-leather-strap',
   'Eco-Fashion Jute Tote Bag with Genuine Leather Straps', 'খাঁটি চামড়ার হ্যান্ডেলযুক্ত পরিবেশবান্ধব জুট টোট ব্যাগ',
   'Laminated natural golden jute handbag with magnetic clasp and internal zip compartment.',
   'ফ্যাশনেবল ও টেকসই সোনালী পাটে তৈরি নান্দনিক জুট টোট ব্যাগ।',
   'JuteVillage', 550.00, 80.00, 890.00, 750.00, 95, 10, 320, false, 0, 'ACTIVE', 4.82, 38, 210),

  (53, 'PRD-CRF-053', 5, 15, 'brass-traditional-hanging-lamp',
   'Vintage Handcrafted Brass Hanging Diya / Oil Lamp', 'হস্তনির্মিত ঐতিহ্যবাহী পিতলের ঝুলন্ত প্রদীপ / বাতি',
   'Solid brass metalcraft polished to antique golden lustre with ornamental chain.',
   'খাঁটি পিতলে খোদাই করা কারুকাজখচিত ঐতিহ্যবাহী ঝুলন্ত প্রদীপ।',
   'Dhamrai Brass', 1400.00, 200.00, 2100.00, 1800.00, 35, 4, 850, false, 0, 'ACTIVE', 4.90, 19, 45),

  (54, 'PRD-CRF-054', 5, 15, 'terracotta-clay-planter-pots-set-3',
   'Handmade Terracotta Clay Planter Pots (Set of 3)', 'হাতে গড়া মাটির নান্দনিক টব ও প্ল্যান্টার (৩টি)',
   'Porous natural clay pots with drainage holes for healthy indoor and balcony plants.',
   'বারান্দা ও ঘরের গাছপালার জন্য প্রাকৃতিক পোড়ামাটির তৈরি সুন্দর প্ল্যান্টার সেট।',
   'ClayCraft Studio', 480.00, 70.00, 780.00, 650.00, 60, 6, 2100, false, 0, 'ACTIVE', 4.76, 22, 115),

  (55, 'PRD-SPT-055', 102, 16, 'badminton-racket-pair-carbon-fiber',
   'Carbon Fiber Badminton Racket Pair with Carry Bag & Shuttles', 'কার্বন ফাইবার ব্যাডমিন্টন র‍্যাকেট জোড়া ও শাটলকক সেট',
   'Lightweight 84g offensive carbon rackets pre-strung with high tension 26 lbs durability.',
   'হালকা ওয়ান-পিস কার্বন ফাইবার ব্যাডমিন্টন র‍্যাকেট জোড়া ও ফুল কভার ব্যাগ।',
   'Apex Sports', 1350.00, 180.00, 1950.00, 1650.00, 75, 8, 450, false, 6, 'ACTIVE', 4.81, 39, 180),

  (56, 'PRD-SPT-056', 102, 16, 'anti-slip-yoga-mat-8mm',
   'Eco-Friendly TPE Anti-Slip Yoga & Fitness Mat 8mm', 'নন-স্লিপ টিপিই ৮ মি.মি. প্রিমিয়াম যোগব্যায়াম ও ফিটনেস ম্যাট',
   'Dual-texture non-slip surface with alignment lines and carry strap for home workouts.',
   'বাসায় ব্যায়াম ও ইয়োগার জন্য আরামদায়ক ও পরিবেশবান্ধব ৮ মি.মি. থিকনেস ম্যাট।',
   'Apex Sports', 850.00, 120.00, 1350.00, 1100.00, 80, 8, 920, true, 0, 'ACTIVE', 4.79, 31, 145),

  (57, 'PRD-SPT-057', 102, 16, 'adjustable-dumbbell-set-10kg',
   'Cast Iron 10kg Adjustable Dumbbell Set with Case', 'কাস্ট আয়রন ১০ কেজি অ্যাডজাস্টেবল ডাম্বেল সেট ও বক্স',
   'Electroplated chrome finish weight plates with non-slip spinlock collars.',
   'ফিটনেস ও বডিবিল্ডিংয়ের জন্য প্রিমিয়াম ক্রোম প্লেটেড ১০ কেজি ডাম্বেল সেট।',
   'Apex Sports', 1900.00, 260.00, 2750.00, 2350.00, 40, 5, 10200, false, 12, 'ACTIVE', 4.88, 44, 95),

  (58, 'PRD-BOK-058', 5, 17, 'chander-pahar-hardcover-collector',
   'Chander Pahar (The Mountain of the Moon) - Collector Edition', 'চাঁদের পাহাড় (সংগ্রাহক সংস্করণ) - বিভূতিভূষণ বন্দ্যোপাধ্যায়',
   'Deluxe illustrated hardcover edition of the iconic Bengali adventure masterpiece.',
   'কালজয়ী রোমাঞ্চকর বাংলা উপন্যাস চাঁদের পাহাড়-এর বিশেষ ইলাস্ট্রেটেড হার্ডকভার সংস্করণ।',
   'Bangla Classic Press', 380.00, 50.00, 600.00, 480.00, 150, 15, 450, false, 0, 'ACTIVE', 4.99, 135, 780),

  (59, 'PRD-BOK-059', 5, 17, 'english-bengali-visual-dictionary',
   'Illustrated Comprehensive English-Bengali Visual Dictionary', 'সচিত্র ইংরেজি-বাংলা পূর্ণাঙ্গ ভিজ্যুয়াল অভিধান',
   'Over 5,000 everyday objects and terms clearly illustrated in full color for students and learners.',
   'শিক্ষার্থী ও পাঠকদের জন্য ৫,০০০ এর বেশি শব্দের রঙিন চিত্রসহ সহজ ইংরেজি-বাংলা অভিধান।',
   'Bangla Classic Press', 450.00, 60.00, 720.00, 580.00, 120, 12, 680, false, 0, 'ACTIVE', 4.87, 54, 320),

  (60, 'PRD-BOK-060', 5, 17, 'hardbound-bullet-dot-journal',
   'Premium 160 GSM Bamboo Paper Hardbound Dotted Journal', '১৬০ জিএসএম প্রিমিয়াম ডটেড হার্ডবাউন্ড নোটবুক / জার্নাল',
   'Bleed-proof thick dotted pages with pen loop, dual ribbon markers, and expandable back pocket.',
   'লেখা ও আঁকার জন্য কালি না ছড়ানো ১৬০ জিএসএম কাগজের রুচিশীল হার্ডবাউন্ড ডটেড জার্নাল।',
   'Bengal Crafts', 350.00, 50.00, 580.00, 480.00, 140, 15, 340, true, 0, 'ACTIVE', 4.92, 47, 265)
ON CONFLICT (slug) DO UPDATE
SET
  title_en = EXCLUDED.title_en,
  title_bn = EXCLUDED.title_bn,
  base_cost = EXCLUDED.base_cost,
  wholesale_margin = EXCLUDED.wholesale_margin,
  default_retail_price = EXCLUDED.default_retail_price,
  stock_qty = EXCLUDED.stock_qty,
  rating_avg = EXCLUDED.rating_avg,
  rating_count = EXCLUDED.rating_count,
  sold_count = EXCLUDED.sold_count;

-- 5. Seed Product Variants for items with has_variants = true
INSERT INTO product_variants (product_id, sku, attributes_json, price_delta, stock_qty, is_active) VALUES
  -- Panjabi (Product 1)
  (1, 'PANJ-MRN-M', '{"size":"M","color":"Maroon"}'::jsonb, 0.00, 40, true),
  (1, 'PANJ-MRN-L', '{"size":"L","color":"Maroon"}'::jsonb, 0.00, 50, true),
  (1, 'PANJ-MRN-XL', '{"size":"XL","color":"Maroon"}'::jsonb, 50.00, 30, true),

  -- Slim Casual Shirt (Product 2)
  (2, 'SHT-NVY-M', '{"size":"M","color":"Navy Blue"}'::jsonb, 0.00, 30, true),
  (2, 'SHT-NVY-L', '{"size":"L","color":"Navy Blue"}'::jsonb, 0.00, 35, true),
  (2, 'SHT-NVY-XL', '{"size":"XL","color":"Navy Blue"}'::jsonb, 50.00, 20, true),

  -- Polo Shirt (Product 3)
  (3, 'POLO-BLK-M', '{"size":"M","color":"Black"}'::jsonb, 0.00, 60, true),
  (3, 'POLO-BLK-L', '{"size":"L","color":"Black"}'::jsonb, 0.00, 55, true),
  (3, 'POLO-BLK-XL', '{"size":"XL","color":"Black"}'::jsonb, 0.00, 35, true),

  -- Smartwatch (Product 11)
  (11, 'WATCH-BLK', '{"strap":"Black Silicone"}'::jsonb, 0.00, 55, true),
  (11, 'WATCH-SLV', '{"strap":"Silver Mesh Metal"}'::jsonb, 150.00, 40, true),

  -- TWS Earbuds (Product 12)
  (12, 'TWS-WHT', '{"color":"Ceramic White"}'::jsonb, 0.00, 80, true),
  (12, 'TWS-BLK', '{"color":"Matte Black"}'::jsonb, 0.00, 60, true),

  -- Mechanical Keyboard (Product 16)
  (16, 'KB-RED-SW', '{"switch":"Linear Red"}'::jsonb, 0.00, 30, true),
  (16, 'KB-BRN-SW', '{"switch":"Tactile Brown"}'::jsonb, 0.00, 20, true)
ON CONFLICT (sku) DO NOTHING;

-- 6. Allocate Warehouse Stock
INSERT INTO warehouse_stock (warehouse_node_id, product_id, variant_id, stock_qty, reserved_qty)
SELECT 1, id, NULL, stock_qty, 0
FROM products
WHERE has_variants = false
ON CONFLICT (warehouse_node_id, product_id, COALESCE(variant_id, 0)) DO UPDATE
SET stock_qty = EXCLUDED.stock_qty;

INSERT INTO warehouse_stock (warehouse_node_id, product_id, variant_id, stock_qty, reserved_qty)
SELECT 1, product_id, id, stock_qty, 0
FROM product_variants
ON CONFLICT (warehouse_node_id, product_id, COALESCE(variant_id, 0)) DO UPDATE
SET stock_qty = EXCLUDED.stock_qty;

-- 7. Seed FEFO Product Batches for Groceries & Health/Beauty items
INSERT INTO product_batches (product_id, variant_id, warehouse_node_id, batch_number, mfg_date, exp_date, qty, status) VALUES
  (41, NULL, 3, 'BATCH-HNY-2026A', '2026-01-15', '2028-01-15', 100, 'ACTIVE'),
  (41, NULL, 3, 'BATCH-HNY-2026B', '2026-03-10', '2028-03-10', 60, 'ACTIVE'),
  (43, NULL, 3, 'BATCH-MST-2026A', '2026-02-01', '2027-02-01', 120, 'ACTIVE'),
  (45, NULL, 3, 'BATCH-GHE-2026A', '2026-02-15', '2026-11-15', 90, 'ACTIVE'),
  (31, NULL, 3, 'BATCH-ALV-2026A', '2026-01-20', '2027-07-20', 200, 'ACTIVE')
ON CONFLICT (product_id, batch_number, warehouse_node_id) DO NOTHING;

-- 8. Curate Items into Salers' Virtual Stores
INSERT INTO saler_store_items (store_id, saler_id, product_id, custom_retail_price, collection_name, display_order, is_active) VALUES
  -- Store 1: Dhaka Fashion House (Apparel, Leather, Crafts)
  (1, 6, 1, 1650.00, 'Eid Panjabi Collection', 1, true),
  (1, 6, 2, 1350.00, 'Casual Formals', 2, true),
  (1, 6, 5, 6500.00, 'Heritage Jamdani', 3, true),
  (1, 6, 8, 1150.00, 'Pure Leather Accessories', 4, true),
  (1, 6, 9, 3950.00, 'Pure Leather Accessories', 5, true),
  (1, 6, 51, 4950.00, 'Handcrafted Heritage', 6, true),

  -- Store 2: Bangla Smart Store (Electronics, Gadgets, Lifestyle)
  (2, 202, 11, 3250.00, 'Smart Wearables', 1, true),
  (2, 202, 12, 2150.00, 'Audio & Sound', 2, true),
  (2, 202, 13, 1950.00, 'Charging & Power', 3, true),
  (2, 202, 14, 2450.00, 'Audio & Sound', 4, true),
  (2, 202, 15, 1850.00, 'Charging & Power', 5, true),
  (2, 202, 16, 3100.00, 'PC & Gaming Gear', 6, true)
ON CONFLICT (store_id, product_id) DO UPDATE
SET custom_retail_price = EXCLUDED.custom_retail_price, collection_name = EXCLUDED.collection_name;
