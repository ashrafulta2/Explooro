/**
 * build-client.mjs — production client build wrapper.
 *
 * WHY this exists: Vite decides whether a build is a *production* build from `NODE_ENV`, not from
 * the `build` verb itself. The monorepo keeps a single root `.env` shared by client and server,
 * and it pins `NODE_ENV=development` because the Fastify dev server requires that value
 * (`server/src/config/env.js` marks `NODE_ENV` required). Vite reads that same file, so a plain
 * `vite build` emits a *development* client bundle — it ships dev-only code (the API status bar's
 * unconditional `/api/v1/health` probe, un-eliminated `import.meta.env.DEV` branches) and skips
 * production-grade minification.
 *
 * Setting a real `process.env.NODE_ENV` here overrides the `.env` value for the build process
 * only. `npm run dev` and `npm run preview` never run through this script, so dev mode is
 * untouched.
 */
import { spawnSync } from 'node:child_process';

process.env.NODE_ENV = 'production';

const result = spawnSync('npm', ['run', 'build', '--workspace', 'client'], {
  stdio: 'inherit',
  shell: true, // WHY: lets the OS resolve `npm` -> `npm.cmd` on Windows
  env: process.env,
});

process.exit(result.status ?? 1);
