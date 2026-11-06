-- 080_community_posts.sql — the community timeline: role-specific posts, likes, reports.
--
-- One table holds every post and one shape, because the timeline is a single mixed feed that is
-- filtered by type. What differs per role is the `details` JSONB and the validation in
-- services/communityPost.service.ts:
--   REVIEW        customer  — a verified-purchase review with a rating and a usability tip
--   UPDATE        supplier  — a new arrival / restock / bulk offer with stock and price tiers
--   IDEA          shop partner — a usability tip, creative idea or product story with steps
--   ANNOUNCEMENT  admin     — a pinned notice to a chosen audience
--
-- WHY posts go live at once (status PUBLISHED, not PENDING): the product decision is publish first,
-- review after a report. A post that collects `community.auto_hide_report_threshold` reports is
-- hidden automatically until a moderator decides, so a pile-on cannot leave abuse up for hours.
--
-- WHY order_item_id on a review: it is the proof of purchase. The partial unique index below lets
-- one delivered order line carry at most one review post, so "verified" cannot be farmed.

CREATE TABLE IF NOT EXISTS community_posts (
  id            BIGSERIAL PRIMARY KEY,
  ref           TEXT UNIQUE NOT NULL,
  author_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role   TEXT NOT NULL CHECK (author_role IN ('customer', 'supplier', 'saler', 'admin')),
  post_type     TEXT NOT NULL CHECK (post_type IN ('REVIEW', 'UPDATE', 'IDEA', 'ANNOUNCEMENT')),
  kind          TEXT NOT NULL,
  product_id    BIGINT REFERENCES products(id) ON DELETE SET NULL,
  order_item_id BIGINT REFERENCES order_items(id) ON DELETE SET NULL,
  title         TEXT,
  body          TEXT,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience      TEXT NOT NULL DEFAULT 'EVERYONE'
                CHECK (audience IN ('EVERYONE', 'CUSTOMERS', 'SUPPLIERS', 'SHOP_PARTNERS')),
  is_pinned     BOOLEAN NOT NULL DEFAULT false,
  status        TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED', 'HIDDEN', 'REMOVED')),
  hidden_reason TEXT CHECK (hidden_reason IN ('REPORTS', 'MODERATOR')),
  like_count    INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_posts_feed
  ON community_posts (created_at DESC) WHERE status = 'PUBLISHED';
CREATE INDEX IF NOT EXISTS idx_community_posts_type ON community_posts (post_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_author ON community_posts (author_id);
CREATE INDEX IF NOT EXISTS idx_community_posts_product ON community_posts (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_community_review_per_order_item
  ON community_posts (order_item_id) WHERE post_type = 'REVIEW' AND order_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS community_post_likes (
  post_id    BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_post_likes_user ON community_post_likes (user_id);

CREATE TABLE IF NOT EXISTS community_post_reports (
  id          BIGSERIAL PRIMARY KEY,
  post_id     BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  reporter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('SPAM', 'FAKE_REVIEW', 'MISLEADING', 'OFFENSIVE', 'OTHER')),
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DISMISSED', 'ACTIONED')),
  resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One report per person per post: repeating it must not push a post toward the auto-hide
  -- threshold, or one angry user could hide anything.
  UNIQUE (post_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_community_reports_open
  ON community_post_reports (post_id) WHERE status = 'OPEN';

-- The auto-hide threshold is a business number, so it is configuration, not code. The range
-- (2-50) is enforced where it is read, services/communityPost.service.ts; ON CONFLICT DO NOTHING
-- keeps a re-run from resetting a value an admin already chose.
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES (
  'community.auto_hide_report_threshold',
  '5'::jsonb,
  'NUMBER',
  'Reports that auto-hide a community post',
  'যতগুলো রিপোর্টে কমিউনিটি পোস্ট নিজে থেকে লুকানো হয়',
  'community',
  false
)
ON CONFLICT (key) DO NOTHING;
