-- Migration 034: Content Commerce, Reels, Seller Academy & Editor Layer (Prompt 10.8)

CREATE TABLE IF NOT EXISTS stories (
  id BIGSERIAL PRIMARY KEY,
  ref VARCHAR(32) UNIQUE NOT NULL,
  author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role VARCHAR(30) NOT NULL,
  title_en VARCHAR(255) NOT NULL,
  title_bn VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  content_en TEXT NOT NULL,
  content_bn TEXT NOT NULL,
  cover_image_url TEXT,
  embedded_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED')),
  view_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stories_slug ON stories(slug);
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
CREATE INDEX IF NOT EXISTS idx_stories_author ON stories(author_id);

CREATE TABLE IF NOT EXISTS reels (
  id BIGSERIAL PRIMARY KEY,
  ref VARCHAR(32) UNIQUE NOT NULL,
  author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 15,
  caption_en TEXT NOT NULL,
  caption_bn TEXT NOT NULL,
  pinned_product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  likes_count INTEGER NOT NULL DEFAULT 0,
  views_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED', 'HIDDEN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_status ON reels(status);
CREATE INDEX IF NOT EXISTS idx_reels_pinned_prod ON reels(pinned_product_id);

CREATE TABLE IF NOT EXISTS academy_courses (
  id BIGSERIAL PRIMARY KEY,
  ref VARCHAR(32) UNIQUE NOT NULL,
  title_en VARCHAR(255) NOT NULL,
  title_bn VARCHAR(255) NOT NULL,
  description_en TEXT NOT NULL,
  description_bn TEXT NOT NULL,
  target_role VARCHAR(30) NOT NULL DEFAULT 'all',
  category VARCHAR(50) NOT NULL DEFAULT 'sourcing',
  cover_image_url TEXT,
  difficulty_level VARCHAR(20) NOT NULL DEFAULT 'BEGINNER' CHECK (difficulty_level IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')),
  estimated_minutes INTEGER NOT NULL DEFAULT 30,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS academy_lessons (
  id BIGSERIAL PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL DEFAULT 1,
  title_en VARCHAR(255) NOT NULL,
  title_bn VARCHAR(255) NOT NULL,
  media_type VARCHAR(20) NOT NULL DEFAULT 'VIDEO' CHECK (media_type IN ('VIDEO', 'AUDIO', 'ARTICLE')),
  media_url TEXT,
  content_en TEXT,
  content_bn TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 180,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academy_lessons_course ON academy_lessons(course_id, sequence_no);

CREATE TABLE IF NOT EXISTS academy_progress (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id BIGINT NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  lesson_id BIGINT NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  is_completed BOOLEAN NOT NULL DEFAULT true,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_academy_progress_user ON academy_progress(user_id, course_id);

CREATE TABLE IF NOT EXISTS banners (
  id BIGSERIAL PRIMARY KEY,
  slot VARCHAR(50) NOT NULL DEFAULT 'HOMEPAGE_HERO',
  title_en VARCHAR(255) NOT NULL,
  title_bn VARCHAR(255) NOT NULL,
  image_url_desktop TEXT NOT NULL,
  image_url_mobile TEXT,
  target_link TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banners_slot_active ON banners(slot, is_active, display_order);

CREATE TABLE IF NOT EXISTS i18n_translations (
  id BIGSERIAL PRIMARY KEY,
  namespace VARCHAR(60) NOT NULL DEFAULT 'common',
  key VARCHAR(120) NOT NULL,
  locale VARCHAR(10) NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(namespace, key, locale)
);

CREATE INDEX IF NOT EXISTS idx_i18n_trans_loc ON i18n_translations(locale, namespace);

-- Platform module registrations
INSERT INTO platform_modules (key, group_key, label_en, label_bn, description_en, description_bn, is_enabled, created_at, updated_at)
VALUES
  ('content_commerce', 'content', 'Content Commerce & Stories', 'কন্টেন্ট কমার্স ও স্টোরি', 'UGC storytelling blog, shoppable reels with pinned buyable products, and editor curation', 'ইউজিসি স্টোরিটেলিং ব্লগ, পিন করা কেনাযোগ্য পণ্যসহ শপেবল রিল এবং এডিটর কিউরেশন', true, now(), now()),
  ('seller_academy', 'content', 'Seller Academy Micro-Learning', 'সেলার অ্যাকাডেমি মাইক্রো-লার্নিং', 'Interactive video and audio business courses, progress tracking, and certificates', 'ইন্টারঅ্যাক্টিভ ভিডিও ও অডিও ব্যবসায়িক কোর্স, অগ্রগতি ট্র্যাকিং এবং সার্টিফিকেট', true, now(), now())
ON CONFLICT (key) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  description_en = EXCLUDED.description_en,
  updated_at = now();
