-- 011_demo_live_streams.sql (Prompt 10.1: Live Stream Commerce Engine)
-- Seeds realistic Bangladeshi live streams, featured products, and live messages:
-- 2 LIVE streams, 2 SCHEDULED upcoming streams, and 1 ENDED broadcast replay.

-- 1. Insert Live Streams
INSERT INTO live_streams (
  id, ref, host_id, store_id, title, description, cover_image,
  status, scheduled_for, started_at, ended_at,
  viewer_count, peak_viewer_count, total_likes_count, total_sales_count, total_sales_amount,
  room_id, settings_json
) VALUES
  -- 1. LIVE: Dhakai Jamdani Showcase & Flash Sale
  (1, 'LIV-JAMDANI-01', 6, 1,
   'Dhakai Jamdani Live Weaving & Festive Flash Sale 🔥',
   'Live weaving demo and real-time showcase of pure cotton Dhakai Jamdani Sarees with special instant discounts and seller Q&A.',
   'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&auto=format&fit=crop&q=80',
   'LIVE', NULL, now() - interval '25 minutes', NULL,
   184, 220, 1250, 14, 48500.00,
   'room_jamdani_live_01',
   '{"chat_enabled": true, "audio_only_allowed": true, "category": "traditional_fashion"}'::jsonb
  ),

  -- 2. LIVE: Smart Wearables & TWS Audio Unboxing
  (2, 'LIV-GADGETS-02', 202, 2,
   'Smart Wearables & TWS Wireless Audio Unboxing & Test 🎧',
   'Hands-on sound quality check, bass test, and waterproof demonstration with exclusive 1-click in-stream discounts.',
   'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&auto=format&fit=crop&q=80',
   'LIVE', NULL, now() - interval '12 minutes', NULL,
   96, 110, 640, 8, 11600.00,
   'room_gadgets_live_02',
   '{"chat_enabled": true, "audio_only_allowed": true, "category": "electronics"}'::jsonb
  ),

  -- 3. SCHEDULED: Rajshahi Pure Silk Preview
  (3, 'LIV-SILK-03', 5, 1,
   'Rajshahi Pure Silk & Festive Eid Collection Preview 🌸',
   'Exclusive premiere of 100% pure Mulberry Silk dupattas and sarees directly from Rajshahi master weavers with Q&A.',
   'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=800&auto=format&fit=crop&q=80',
   'SCHEDULED', now() + interval '24 hours', NULL, NULL,
   0, 0, 85, 0, 0.00,
   'room_silk_scheduled_03',
   '{"chat_enabled": true, "audio_only_allowed": true, "category": "traditional_fashion"}'::jsonb
  ),

  -- 4. SCHEDULED: Sylhet Honey & Organic Tea
  (4, 'LIV-HONEY-04', 103, NULL,
   'Sylhet Wildflower Raw Honey Harvest & Tea Tasting 🍯',
   'Live from the tea estates of Sreemangal! Discover organic wildflower honey harvesting with exclusive bundle offers.',
   'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=800&auto=format&fit=crop&q=80',
   'SCHEDULED', now() + interval '48 hours', NULL, NULL,
   0, 0, 42, 0, 0.00,
   'room_honey_scheduled_04',
   '{"chat_enabled": true, "audio_only_allowed": true, "category": "organic_food"}'::jsonb
  ),

  -- 5. ENDED: Handmade Nakshi Kantha
  (5, 'LIV-KANTHA-05', 6, 1,
   'Handmade Nakshi Kantha Masterclass & Showcase (Replay) 🪡',
   'Recorded live broadcast featuring village artisans demonstrating intricate Nakshi embroidery with instant ordering.',
   'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=800&auto=format&fit=crop&q=80',
   'ENDED', NULL, now() - interval '3 days', now() - interval '3 days' + interval '90 minutes',
   320, 450, 2100, 28, 64000.00,
   'room_kantha_ended_05',
   '{"chat_enabled": true, "audio_only_allowed": true, "category": "handicrafts"}'::jsonb
  )
ON CONFLICT (ref) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  viewer_count = EXCLUDED.viewer_count,
  total_likes_count = EXCLUDED.total_likes_count,
  total_sales_count = EXCLUDED.total_sales_count,
  total_sales_amount = EXCLUDED.total_sales_amount;

-- 2. Insert Featured Stream Products
INSERT INTO live_stream_products (
  id, live_stream_id, product_id, is_pinned, pinned_at, pin_order, special_price
) VALUES
  -- Stream 1 Products
  (1, 1, 5, true, now() - interval '20 minutes', 1, 3200.00),
  (2, 1, 6, false, NULL, 2, 1150.00),
  (3, 1, 7, false, NULL, 3, 1600.00),

  -- Stream 2 Products
  (4, 2, 11, true, now() - interval '10 minutes', 1, 2350.00),
  (5, 2, 12, false, NULL, 2, 1250.00),

  -- Stream 3 Products
  (6, 3, 5, false, NULL, 1, 3500.00),
  (7, 3, 7, false, NULL, 2, 1750.00),

  -- Stream 4 Products
  (8, 4, 41, false, NULL, 1, 650.00),

  -- Stream 5 Products
  (9, 5, 7, false, NULL, 1, 1600.00)
ON CONFLICT (live_stream_id, product_id) DO UPDATE SET
  is_pinned = EXCLUDED.is_pinned,
  special_price = EXCLUDED.special_price;

-- 3. Seed Live Chat Messages
INSERT INTO live_stream_messages (
  id, live_stream_id, user_id, message_type, content, metadata_json, created_at
) VALUES
  (1, 1, 5, 'CHAT', 'Welcome everyone to our live Dhakai Jamdani showcase! Feel free to ask about thread counts and motifs.', '{}'::jsonb, now() - interval '24 minutes'),
  (2, 1, 7, 'CHAT', 'Is the red saree ready to ship to Dhanmondi?', '{}'::jsonb, now() - interval '22 minutes'),
  (3, 1, 6, 'CHAT', 'Yes @Karim! We offer next-day delivery in Dhaka with cash on delivery available.', '{}'::jsonb, now() - interval '21 minutes'),
  (4, 1, 7, 'BUY', 'Karim just purchased Authentic Handloom Dhakai Jamdani Saree!', '{"amount": 3200, "product_id": 5}'::jsonb, now() - interval '18 minutes'),
  (5, 1, 6, 'CHAT', 'Thank you Karim! Packing your order with care right now ❤️', '{}'::jsonb, now() - interval '17 minutes'),
  (6, 2, 202, 'CHAT', 'Welcome tech lovers! Testing latency and noise cancellation now 🎧', '{}'::jsonb, now() - interval '11 minutes'),
  (7, 2, 7, 'CHAT', 'What is the battery backup on the TWS earbuds?', '{}'::jsonb, now() - interval '8 minutes'),
  (8, 2, 202, 'CHAT', 'Up to 28 hours with the charging case and fast Type-C charging!', '{}'::jsonb, now() - interval '7 minutes')
ON CONFLICT (id) DO NOTHING;
