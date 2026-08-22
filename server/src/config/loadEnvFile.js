/**
 * loadEnvFile.js — shared .env bootstrap (Prompt 2.1).
 *
 * Native Node 20.6+ .env loader, zero external dependencies. Import this module for its side
 * effect (before importing env.js) from every entrypoint that reads process.env directly —
 * index.js, migrate.js, seed.js — so `npm run migrate`/`npm run seed` see the same environment
 * the running server does instead of failing with "required but was not set".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (typeof process.loadEnvFile === 'function') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rootEnv = path.resolve(__dirname, '../../../.env');
  const candidates = [rootEnv, path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../.env')];
  for (const full of candidates) {
    if (fs.existsSync(full)) {
      try {
        process.loadEnvFile(full);
        break;
      } catch {
        // Continue candidate check
      }
    }
  }
}
