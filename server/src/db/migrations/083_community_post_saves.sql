-- 083_community_post_saves.sql — a member's private list of saved community posts.
--
-- Private: nobody sees what another member saved, and a save is not a like (it is not counted or shown
-- on the post). It is the "come back to this" list: a review to read before buying, a supplier's
-- price tier to act on, a shop partner's idea to try.
--
-- WHY ON DELETE CASCADE on both sides: a save has no meaning without its post or its member.
-- A post that is later hidden or removed simply stops appearing in the list; the row stays, so the
-- post returns to the list if a moderator restores it.

CREATE TABLE IF NOT EXISTS community_post_saves (
  post_id    BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- The list is read "this member's saves, newest first".
CREATE INDEX IF NOT EXISTS idx_community_post_saves_user ON community_post_saves (user_id, created_at DESC);
