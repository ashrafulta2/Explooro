import './config/loadEnvFile.ts';
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

  // WHY: Fastify's error handler only covers request handlers. A rejected promise in a job, socket or
  // notification path would otherwise vanish or kill the process with no log line.
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'uncaughtException');
    process.exit(1);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      // WHY: a hung app.close() (open socket, stuck job) must not leave the process alive forever.
      const force = setTimeout(() => process.exit(1), 10_000);
      force.unref();
      try {
        await app.close();
        process.exit(0);
      } catch (err) {
        app.log.error({ err }, 'shutdown failed');
        process.exit(1);
      }
    });
  }
}

start();
