/**
 * mocks/handlers/modules.ts — the PUBLIC feature-flag endpoint.
 *
 * `GET /modules` is what services/featureFlags.ts calls on every cold boot (main.js's
 * initFeatureFlags). mocks/index.ts had no handler for it for nine phases, so in mock mode the
 * router's module guard and the sidebar's module filter ran off appStore's hardcoded DEMO_MODULES
 * and no super admin toggle ever survived a reload. See mocks/moduleState.ts for the full
 * post-mortem.
 *
 * Deliberately separate from handlers/admin.ts: this path is not an admin path, and a public
 * endpoint buried in a 185KB admin file is exactly how it went missing the first time.
 */

import { publicModuleMap } from '../moduleState.ts';
import type { MockRoute } from '../types.ts';

export const moduleHandlers = [
  {
    method: 'GET',
    path: '/modules',
    handler() {
      const modules = publicModuleMap();
      return {
        status: 200,
        body: {
          modules,
          data: modules,
        },
      };
    },
  },
] satisfies MockRoute[];

export default moduleHandlers;
