-- 081_community_post_media.sql — photos and a video on community posts.
--
-- 1. A new media purpose, COMMUNITY. The media pipeline (services/media.service.ts) already checks a
--    file's real type from its bytes and stores it; a post only has to say which uploaded files it
--    shows. media_assets.purpose is a CHECK list, so it gains the new value. The constraint was
--    created inline in 006 with a generated name, so it is found by what it checks rather than by
--    a name that could differ between databases.
--
-- 2. community_post_media joins a post to its files, in display order.
--    WHY UNIQUE (media_id): a file belongs to at most one post. Without it, one member could attach
--    another member's upload (the ownership check is in the service, this is the backstop) or one
--    upload could be reused across posts so that removing one post changed another.
--    WHY ON DELETE RESTRICT on media_id: a file that a post shows must not vanish from under it.
--    WHY ON DELETE CASCADE on post_id: deleting a post releases its files from the join only; the
--    media_assets row stays, as it does for every other purpose.

DO $$
DECLARE
  existing TEXT;
BEGIN
  SELECT conname INTO existing
    FROM pg_constraint
   WHERE conrelid = 'media_assets'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%purpose%';
  IF existing IS NOT NULL THEN
    EXECUTE format('ALTER TABLE media_assets DROP CONSTRAINT %I', existing);
  END IF;
END
$$;

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_purpose_check
  CHECK (purpose IN ('PRODUCT','AVATAR','BANNER','STORE_LOGO','REVIEW','UGC_VIDEO',
                     'KYC','FLYER','STORY','ACADEMY','STREAM_RECORDING','OG_IMAGE','COMMUNITY'));

CREATE TABLE IF NOT EXISTS community_post_media (
  post_id   BIGINT   NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  media_id  BIGINT   NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  position  SMALLINT NOT NULL CHECK (position >= 0),
  PRIMARY KEY (post_id, media_id),
  UNIQUE (media_id)
);

CREATE INDEX IF NOT EXISTS idx_community_post_media_order ON community_post_media (post_id, position);
