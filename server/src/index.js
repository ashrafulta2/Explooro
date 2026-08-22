import fs from 'node:fs';
import path from 'node:path';

// Native Node 20.6+ .env loader — loads repo-root .env with zero external dependencies
if (typeof process.loadEnvFile === 'function') {
  for (const candidate of ['.env', '../.env', '../../.env']) {
    const full = path.resolve(process.cwd(), candidate);
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

import { buildApp } from './app.js';

async function start() {
  let app;
  try {
    app = await buildApp();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exit(1);
  }

  try {
    await app.listen({ port: app.config.core.port, host: app.config.core.host });
    app.log.info(
      `Explooro API ready on http://${app.config.core.host}:${app.config.core.port}/api/v1/health`
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}

start();
