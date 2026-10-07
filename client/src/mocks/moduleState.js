/**
 * mocks/moduleState.js — the one mutable module-flag store the mock API serves from.
 *
 * WHY this file exists at all: the flag state used to be a `const moduleState = new Map(...)`
 * private to handlers/admin.js, and mocks/index.js had NO handler for the public `GET /modules`
 * endpoint. So in mock mode — the development default (.env.example VITE_API_MODE=mock) —
 * initFeatureFlags() 404'd, fell into its catch, and seeded the flag map from appStore's
 * DEMO_MODULES instead. Two consequences the super admin experienced as "there is no way to turn
 * a page off":
 *
 *   1. A toggle on /admin/platform/modules took effect in the session (ModuleControlPage calls
 *      setFlags) and was then thrown away on the next reload, because nothing read it back.
 *   2. isFeatureEnabled() defaults an unknown key to `true`, so anything DEMO_MODULES did not
 *      list looked permanently enabled no matter what the switchboard said.
 *
 * Owning the state here lets the admin handlers and the public handler answer from the same map,
 * and lets it survive a reload through localStorage. Mock-only: nothing in `src/` outside
 * `src/mocks/` imports this, so the client's zero-runtime-dependency rule is untouched and the
 * live API remains the single source of truth when VITE_API_MODE=live.
 */

import moduleRegistry from '../../../server/src/config/modules.seed.json' with { type: 'json' };

export { moduleRegistry };

const STORAGE_KEY = 'explooro:mock:modules';

/** `{ [moduleKey]: { is_enabled, last_reason, updated_at } }` read back from a previous session. */
function readPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Private browsing, cleared storage, or corrupt JSON — fall back to the seed defaults.
    return {};
  }
}

const persisted = readPersisted();

export const moduleState = new Map(
  moduleRegistry.modules.map((m) => {
    const saved = persisted[m.key];
    return [
      m.key,
      {
        is_enabled: typeof saved?.is_enabled === 'boolean' ? saved.is_enabled : m.default_enabled !== false,
        last_reason: saved?.last_reason ?? null,
        updated_at: saved?.updated_at ?? new Date(Date.now() - 3600000 * 72).toISOString(),
      },
    ];
  })
);

/** Writes the whole map back. Called after every toggle; failure is silent by design. */
export function persistModuleState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(moduleState)));
  } catch {
    // Storage unavailable or full — persistence is a convenience, not a guarantee.
  }
}

/** The admin switchboard's shape: registry metadata joined to live state. */
export function buildAdminModules() {
  return moduleRegistry.modules.map((m) => {
    const state = moduleState.get(m.key);
    return {
      key: m.key,
      group_key: m.group,
      label_en: m.label_en,
      label_bn: m.label_bn,
      description_en: m.description_en,
      description_bn: m.description_bn,
      is_enabled: state.is_enabled,
      risk_of_disabling: m.risk_of_disabling,
      depends_on: m.depends_on || [],
      affected_routes: m.affected_routes || [],
      affected_permissions: m.affected_permissions || [],
      sub_settings_schema: m.sub_settings_schema || null,
      last_reason: state.last_reason,
      updated_at: state.updated_at,
      targeting_rules: [],
    };
  });
}

/**
 * The public endpoint's shape: a flat `{ key: boolean }` map, matching what
 * moduleService.getPublicModulesMap() returns on the server.
 *
 * `core` is included even though it is not a registry row: core/router.js's hasModule() short-
 * circuits on it, but featureFlags.js and any `[data-module="core"]` gate read the map directly.
 */
export function publicModuleMap() {
  const map = { core: true };
  for (const [key, state] of moduleState) map[key] = state.is_enabled;
  return map;
}
