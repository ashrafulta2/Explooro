-- 040_live_moderation.sql (Live Moderation Console for /moderator/live)
--
-- Prompt 10.1 REQUIREMENT 6 gave moderators two live controls — mute a participant and terminate
-- a stream — but no way to act on a single abusive chat message, and no record of a mute once the
-- socket layer's in-memory timer expired or the node restarted. This migration adds the storage
-- the moderation console needs:
--
--   1. Soft deletion on live_stream_messages, so a removed message stays auditable (who removed
--      it, when, and why) instead of vanishing. Hard DELETE would destroy the evidence a dispute
--      or a user report is later argued from.
--   2. An index for the console's "flagged messages first" ordering.
--
-- Mutes deliberately do NOT get their own table: they are recorded as MODERATION rows in
-- live_stream_messages (the same channel terminate already writes to), and enforcement stays in
-- sockets/presence.js where the socket that must be silenced actually lives.

-- 1. Soft deletion + moderation provenance on live stream chat messages
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'live_stream_messages' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE live_stream_messages ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'live_stream_messages' AND column_name = 'deleted_by'
  ) THEN
    ALTER TABLE live_stream_messages
      ADD COLUMN deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'live_stream_messages' AND column_name = 'deletion_reason'
  ) THEN
    ALTER TABLE live_stream_messages ADD COLUMN deletion_reason TEXT;
  END IF;
END $$;

-- 2. The console lists a stream's surviving chat newest-last and needs the removed ones excluded
--    cheaply; a partial index keeps that scan off the tombstones.
CREATE INDEX IF NOT EXISTS idx_live_stream_messages_active
  ON live_stream_messages (live_stream_id, id)
  WHERE deleted_at IS NULL;
