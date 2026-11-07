-- 110_flyer_saved_designs.sql
--
-- The Flyer Studio designs a person starred (/saler/social-kit, /supplier/social-kit), so the same
-- list follows them from phone to laptop. Before this they lived only in one browser's storage.
--
-- A design is not stored as a picture: `design_key` names one combination of the studio's design
-- library (occasion.layout.palette.pattern.headline, client/src/config/flyerTemplates.ts), and the
-- client redraws it with the person's current product, price and link.
--
-- WHY only the shape is checked here and not the ids: the library lives in the client and grows
-- there (a new palette or occasion is one entry). A key whose palette was later removed is simply
-- skipped by the client when it reads the list, instead of the database refusing a release.
CREATE TABLE IF NOT EXISTS flyer_saved_designs (
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  design_key   TEXT NOT NULL
               CHECK (design_key ~ '^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}\.[0-9]{1,2}$'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, design_key)
);

-- The list is always read newest first, one user at a time.
CREATE INDEX IF NOT EXISTS idx_flyer_saved_designs_user_created ON flyer_saved_designs (user_id, created_at DESC);
