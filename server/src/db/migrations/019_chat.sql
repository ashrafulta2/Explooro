-- 019_chat.sql (Prompt 8.1)
-- Real-time Chat Threads & Messages (DFD Subsystem 7.0).

CREATE TABLE IF NOT EXISTS chat_threads (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,                  -- THR-9K2P8L1X
  thread_type           TEXT NOT NULL
                        CHECK (thread_type IN ('CUSTOMER_SALER', 'SALER_SUPPLIER', 'SUPPORT', 'DISPUTE_ORDER')),
  participant_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [userId1, userId2]
  metadata_json         JSONB DEFAULT '{}'::jsonb,             -- order_id, product_id, shop_slug
  last_message_at       TIMESTAMPTZ,
  last_message_preview  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_type ON chat_threads (thread_type);
CREATE INDEX IF NOT EXISTS idx_chat_threads_last_msg ON chat_threads (last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS chat_messages (
  id                    BIGSERIAL PRIMARY KEY,
  client_msg_id         TEXT UNIQUE,                           -- idempotency & optimistic UI
  thread_id             BIGINT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content               TEXT NOT NULL,
  msg_type              TEXT NOT NULL DEFAULT 'TEXT'
                        CHECK (msg_type IN ('TEXT', 'IMAGE', 'PRODUCT_CARD', 'ORDER_CARD', 'SYSTEM')),
  payload_json          JSONB DEFAULT '{}'::jsonb,
  read_by               JSONB NOT NULL DEFAULT '[]'::jsonb,    -- array of user IDs
  flagged_for_moderation BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id ON chat_messages (thread_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages (sender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_client_id ON chat_messages (client_msg_id) WHERE client_msg_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_thread_participants (
  thread_id             BIGINT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id  BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL,
  unread_count          INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  muted                 BOOLEAN NOT NULL DEFAULT false,
  joined_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_thread_participants (user_id);
