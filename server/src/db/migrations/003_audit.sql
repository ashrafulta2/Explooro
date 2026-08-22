-- 003_audit.sql (Prompt 2.2)
-- audit_logs exactly as docs/erd.md §2 defines it (the full definition — prompt.md 2.2's own
-- column list is a shorthand of the same table; erd.md is the canonical schema and additionally
-- specifies undo_payload/risk_tier/is_breakglass and RANGE partitioning by created_at, per
-- docs/erd.md §11 "grows without bound, partitioned by month, never dropped").
--
-- Append-only and tamper-evident: a BEFORE INSERT trigger computes row_hash = sha256(prev_hash ||
-- row payload), chaining every row to the one before it, and BEFORE UPDATE/DELETE triggers refuse
-- both operations outright.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE audit_logs (
  id                  BIGSERIAL,
  actor_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_role          TEXT,
  action              TEXT NOT NULL,
  target_type         TEXT,
  target_ref          TEXT,
  before_json         JSONB,                             -- PII redacted before insert
  after_json          JSONB,
  undo_payload        JSONB,                             -- present when reversible
  risk_tier           TEXT,
  is_breakglass       BOOLEAN NOT NULL DEFAULT false,
  ip_address          INET,
  user_agent          TEXT,
  trace_id            TEXT,
  prev_hash           TEXT,
  row_hash            TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX ON audit_logs (actor_id);
CREATE INDEX ON audit_logs (target_type, target_ref);
CREATE INDEX ON audit_logs (trace_id);

-- Current month plus three ahead (docs/erd.md §15 checklist). A monthly job (Prompt 12.x) keeps
-- three months of headroom going forward; computed from now() so this migration is correct
-- whenever it actually runs, not pinned to the date it was written.
DO $$
DECLARE
  month_start DATE := date_trunc('month', now())::date;
  i INT;
  partition_name TEXT;
  range_start DATE;
  range_end DATE;
BEGIN
  FOR i IN 0..3 LOOP
    range_start := month_start + (i || ' months')::interval;
    range_end := month_start + ((i + 1) || ' months')::interval;
    partition_name := 'audit_logs_' || to_char(range_start, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
      partition_name, range_start, range_end
    );
  END LOOP;
END $$;

-- Hash chain: each row's row_hash covers its own payload plus the previous row's row_hash, so
-- editing or deleting any historical row breaks every row_hash after it.
CREATE OR REPLACE FUNCTION audit_logs_set_hash()
RETURNS trigger AS $$
DECLARE
  prev TEXT;
BEGIN
  SELECT row_hash INTO prev FROM audit_logs ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.row_hash := encode(
    digest(coalesce(prev, '') || (to_jsonb(NEW) - 'row_hash' - 'prev_hash')::text, 'sha256'),
    'hex'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_set_hash
  BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_set_hash();

-- Append-only: UPDATE and DELETE are refused outright, not merely restricted.
CREATE OR REPLACE FUNCTION audit_logs_block_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_block_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

CREATE TRIGGER trg_audit_logs_block_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
