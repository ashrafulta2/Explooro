/**
 * mocks/handlers/modules.js — the PUBLIC feature-flag endpoint.
 *
 * `GET /modules` is what services/featureFlags.js calls on every cold boot (main.js's
 * initFeatureFlags). mocks/index.js had no handler for it for nine phases, so in mock mode the
 * router's module guard and the sidebar's module filter ran off appStore's hardcoded DEMO_MODULES
 * and no super admin toggle ever survived a reload. See mocks/moduleState.js for the full
 * post-mortem.
 *
 * Deliberately separate from handlers/admin.js: this path is not an admin path, and a public
 * endpoint buried in a 185KB admin file is exactly how it went missing the first time.
 */

import { publicModuleMap } from '../moduleState.js';

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
];

export default moduleHandlers;
