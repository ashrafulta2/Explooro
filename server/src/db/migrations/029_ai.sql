-- 029_ai.sql (Prompt 10.2)
-- AI Service Layer: conversations, messages, token/spend accounting, safety incidents.

CREATE TABLE IF NOT EXISTS ai_conversations (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,                  -- CONV-9K2P8L1X
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_type            TEXT NOT NULL
                        CHECK (agent_type IN ('CONCIERGE', 'SOURCING')),
  title                 TEXT,
  status                TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  last_message_at       TIMESTAMPTZ,
  last_message_preview  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations (user_id, agent_type, last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS ai_messages (
  id                    BIGSERIAL PRIMARY KEY,
  conversation_id       BIGINT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role                  TEXT NOT NULL
                        CHECK (role IN ('USER', 'ASSISTANT', 'TOOL')),
  content               TEXT NOT NULL DEFAULT '',
  product_refs_json     JSONB NOT NULL DEFAULT '[]'::jsonb,    -- structured product cards shown alongside this message
  degraded              BOOLEAN NOT NULL DEFAULT false,        -- true when this turn fell back to the non-AI deterministic path
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages (conversation_id, id ASC);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT REFERENCES users(id) ON DELETE SET NULL,
  conversation_id       BIGINT REFERENCES ai_conversations(id) ON DELETE SET NULL,
  feature_key           TEXT NOT NULL,                         -- 'concierge' | 'sourcing' | 'creative' | ...
  model                 TEXT NOT NULL,
  driver                TEXT NOT NULL DEFAULT 'mock',           -- 'mock' | 'anthropic'
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cost_usd              NUMERIC(10,4) NOT NULL DEFAULT 0,
  degraded              BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_month ON ai_usage_events (feature_key, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_safety_incidents (
  id                    BIGSERIAL PRIMARY KEY,
  conversation_id       BIGINT REFERENCES ai_conversations(id) ON DELETE SET NULL,
  message_id            BIGINT REFERENCES ai_messages(id) ON DELETE SET NULL,
  incident_type         TEXT NOT NULL
                        CHECK (incident_type IN ('PROMPT_INJECTION_SUSPECTED', 'PII_REDACTED')),
  source                TEXT NOT NULL
                        CHECK (source IN ('PRODUCT_TEXT', 'USER_MESSAGE', 'REVIEW')),
  detail_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_safety_incidents_conversation ON ai_safety_incidents (conversation_id);
