-- 061_signal_retention_indexes.sql — lets the retention job find old behavioural events cheaply.
--
-- services/signalRetention.service.js deletes rows older than the personalization_signals module's
-- retention_days from product_interaction_events and search_events, a few thousand at a time. Every
-- existing index on those tables leads with an actor, category, type or query column, so the
-- predicate the job needs - `created_at < cutoff` on its own - had no index and each batch would
-- scan the table.
--
-- WHY BRIN rather than a b-tree: both tables are append-only, so created_at follows physical row
-- order and a BRIN index (a min/max summary per block range) answers "everything older than X" almost
-- perfectly. It is a few kilobytes however large the table grows, and it adds next to nothing to the
-- INSERT path that capture hits on every product view - a b-tree on a hot, ever-growing log would.

CREATE INDEX IF NOT EXISTS idx_pie_created_brin ON product_interaction_events USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_se_created_brin ON search_events USING BRIN (created_at);
