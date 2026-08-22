import './config/loadEnvFile.js';
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
