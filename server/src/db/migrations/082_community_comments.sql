-- 082_community_comments.sql — comments on community posts.
--
-- One level only: a comment answers a post, not another comment. A thread of replies needs its own
-- notion of depth, ordering and collapsing; a flat list is what a product review or a shop partner's
-- tip needs ("does it shrink?" "which size?").
--
-- WHY status and no DELETE: the same publish-first rule as posts. A comment is live at once; its
-- author can take it down, and staff can remove it. The row stays, so an audit entry that names
-- a removed comment still points at something.
--
-- WHY ON DELETE CASCADE on post_id: comments belong to the post. Posts are never hard-deleted by the
-- application (status REMOVED), so this only matters for a manual clean-up.

CREATE TABLE IF NOT EXISTS community_post_comments (
  id          BIGSERIAL PRIMARY KEY,
  post_id     BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  author_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (length(btrim(body)) > 0),
  status      TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED', 'REMOVED')),
  removed_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  removed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The thread is read "this post's live comments, oldest first".
CREATE INDEX IF NOT EXISTS idx_community_comments_post
  ON community_post_comments (post_id, created_at, id) WHERE status = 'PUBLISHED';
CREATE INDEX IF NOT EXISTS idx_community_comments_author ON community_post_comments (author_id);
