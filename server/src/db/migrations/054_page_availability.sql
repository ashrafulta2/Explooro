-- 054_page_availability.sql (per-page availability, the layer beside platform_modules)
--
-- WHY a second layer rather than more modules: platform_modules gates CAPABILITIES. Switching
-- `multi_warehouse` off to hide /supplier/warehouses also switches off nearest-depot order
-- routing, and 101 of the client's 224 routes declare `module: 'core'`, which is deliberately not
-- a platform_modules row and therefore cannot be turned off at all. The super admin needs to park
-- a PAGE — "built, not released yet" — without touching the feature underneath it.
--
-- Identity is the route path, not a nav-item key, so a page with no sidebar entry (/product/:id,
-- /checkout) is addressable too. The client's route table is the registry; this table holds only
-- the OVERRIDES, so a route absent here is LIVE and adding a page needs no migration.
--
-- Four states (server/src/services/pageAccess.service.js owns the semantics):
--   LIVE         normal.
--   COMING_SOON  nav item still shown, with a badge; the URL renders a placeholder.
--   HIDDEN       absent from the nav; the URL renders the 404 page.
--   LIMITED      LIVE for allowed_roles / allowed_user_ids, HIDDEN for everyone else.
--
-- WHY allowed_* are JSONB arrays and not join tables: they are read as a unit on every page load
-- and written only by one super admin screen. A two-row rollout list does not earn two tables, and
-- the module system's targeting_rules already demonstrated that the join-table shape goes unused.
--
-- Scope, stated honestly: this is a VISIBILITY layer. A hidden page's API endpoints still answer,
-- so this is not an authorization boundary — requirePermission and requireModule remain the ones
-- that are. Enforcing it server-side needs a route -> API-prefix map and is a separate step.

CREATE TABLE IF NOT EXISTS page_toggles (
  route_path        TEXT PRIMARY KEY,
  state             TEXT NOT NULL DEFAULT 'LIVE'
                    CHECK (state IN ('LIVE','COMING_SOON','HIDDEN','LIMITED')),
  -- Role keys ('supplier', 'saler', …) and users.id values that keep LIVE access while
  -- state = 'LIMITED'. Ignored in every other state.
  allowed_roles     JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_user_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- CLAUDE.md: every state-changing admin action records why. The service enforces a minimum
  -- length; the column is nullable only so a pre-existing row written by hand is not rejected.
  reason            TEXT,
  updated_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The public read is "every row that is not LIVE", on every page load. A LIVE row carries no
-- information (absence means LIVE), so the index only has to cover the parked ones.
CREATE INDEX IF NOT EXISTS idx_page_toggles_not_live
  ON page_toggles (state)
  WHERE state <> 'LIVE';
