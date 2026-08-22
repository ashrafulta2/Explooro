-- 009_qna.sql (Prompt 4.6)
-- Product Q&A — not modelled anywhere in docs/erd.md's 95/96-table schema (checked: zero hits for
-- question/answer/qna across the whole erd.md). Added here to unblock QnASection; docs/erd.md §7
-- (Engagement) has been updated with these two tables so the ERD stays the source of truth.

CREATE TABLE IF NOT EXISTS product_questions (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body                TEXT NOT NULL,
  upvote_count        INTEGER NOT NULL DEFAULT 0 CHECK (upvote_count >= 0),
  status              TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','FLAGGED','REMOVED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_questions_product ON product_questions (product_id, status, created_at);

CREATE TABLE IF NOT EXISTS product_question_upvotes (
  question_id         BIGINT NOT NULL REFERENCES product_questions(id) ON DELETE CASCADE,
  user_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, user_id)
);

CREATE TABLE IF NOT EXISTS product_answers (
  id                  BIGSERIAL PRIMARY KEY,
  question_id         BIGINT NOT NULL REFERENCES product_questions(id) ON DELETE CASCADE,
  responder_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','FLAGGED','REMOVED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_answers_question ON product_answers (question_id, created_at);
