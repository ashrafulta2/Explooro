/**
 * app.js — Fastify application factory (Prompt 2.1).
 *
 * Builds (but does not start listening) a fully wired Fastify instance: validated env, the pg
 * pool, the cache driver (redis | memory), the error handler, request context, and the security /
 * rate-limit plugins. `src/index.js` is the thin entrypoint that calls this and starts the server
 * — kept separate so the app can be built and exercised without binding a port.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';

import { loadEnv } from './config/env.js';
import { createDbPool } from './config/db.js';
import { createCache } from './config/cache.js';
import requestContextPlugin from './plugins/requestContext.js';
import errorHandlerPlugin from './plugins/errorHandler.js';
import authenticatePlugin from './middlewares/authenticate.js';
import requirePermissionPlugin from './middlewares/requirePermission.js';
import requireRestrictionPlugin from './middlewares/requireRestriction.js';
import requireModulePlugin from './middlewares/requireModule.js';
import authRoutes from './routes/auth.routes.js';
import meRoutes from './routes/me.routes.js';
import delegationRoutes from './routes/delegation.routes.js';
import restrictionRoutes from './routes/restriction.routes.js';
import auditRoutes from './routes/audit.routes.js';
import moduleRoutes from './routes/module.routes.js';
import userRoutes from './routes/user.routes.js';
import themeRoutes from './routes/theme.routes.js';
import mediaRoutes from './routes/media.routes.js';
import productRoutes from './routes/product.routes.js';
import searchRoutes from './routes/search.routes.js';
import reviewRoutes from './routes/review.routes.js';
import qnaRoutes from './routes/qna.routes.js';
import storeRoutes from './routes/store.routes.js';
import cartRoutes from './routes/cart.routes.js';
import wishlistRoutes from './routes/wishlist.routes.js';
import orderRoutes from './routes/order.routes.js';
import { startGrantExpiryScheduler } from './jobs/grantExpiryCron.js';
import { createSmsSender } from './integrations/sms/index.js';

/**
 * A @fastify/rate-limit custom Store, backed by our cache adapter instead of the plugin's
 * built-in LocalStore/RedisStore, so CACHE_DRIVER=memory keeps rate limiting working with no
 * Redis installed (docs/api-contract.md §6). The plugin instantiates stores itself and does not
 * forward extra registration options into the constructor, so the cache instance is captured via
 * closure instead of passed through fastify.
 */
function createRateLimitStoreClass(cache) {
  return class CacheRateLimitStore {
    constructor(params) {
      this.timeWindow = params.timeWindow;
    }

    incr(key, cb, timeWindow) {
      const windowMs = timeWindow ?? this.timeWindow;
      cache
        .incr(`ratelimit:${key}`)
        .then(async (current) => {
          if (current === 1) {
            await cache.expire(`ratelimit:${key}`, Math.ceil(windowMs / 1000));
          }
          const ttl = await cache.ttl(`ratelimit:${key}`);
          cb(null, { current, ttl: ttl >= 0 ? ttl : windowMs });
        })
        .catch((err) => cb(err));
    }

    child(routeParams) {
      return new this.constructor(routeParams);
    }
  };
}

export async function buildApp(overrides = {}) {
  const config = overrides.config ?? loadEnv();

  const app = Fastify({
    logger: { level: config.core.logLevel },
    routerOptions: { ignoreTrailingSlash: true },
  });

  const pool = overrides.pool ?? createDbPool(config);
  const cache = overrides.cache ?? (await createCache(config, app.log));

  app.decorate('config', config);
  app.decorate('db', pool);
  app.decorate('cache', cache);
  app.decorate('smsSender', createSmsSender(config));

  app.register(requestContextPlugin);
  app.register(errorHandlerPlugin);
  app.register(authenticatePlugin);
  app.register(requirePermissionPlugin);
  app.register(requireRestrictionPlugin);
  app.register(requireModulePlugin);

  await app.register(helmet, { global: true });

  await app.register(cors, {
    origin: config.core.publicWebUrl,
    credentials: true,
  });

  await app.register(cookie, { secret: config.auth.cookieSecret || undefined });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    store: createRateLimitStoreClass(cache),
    // Match docs/api-contract.md §2.3's error envelope instead of the plugin's own shape — the
    // X-RateLimit-*/Retry-After headers are still set by the plugin regardless of this builder.
    errorResponseBuilder: (req, context) => ({
      error: {
        code: 'RATE_LIMITED',
        message_en: `Too many requests. Please try again in ${Math.ceil(context.ttl / 1000)}s.`,
        message_bn: `অনেক বেশি অনুরোধ করা হয়েছে। প্রায় ${Math.ceil(context.ttl / 1000)} সেকেন্ড পরে আবার চেষ্টা করুন।`,
        trace_id: req.traceId ?? 'unknown',
      },
    }),
  });

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(meRoutes, { prefix: '/api/v1/me' });
  await app.register(delegationRoutes, { prefix: '/api/v1' });
  await app.register(restrictionRoutes, { prefix: '/api/v1' });
  await app.register(auditRoutes, { prefix: '/api/v1' });
  await app.register(moduleRoutes, { prefix: '/api/v1' });
  await app.register(userRoutes, { prefix: '/api/v1' });
  await app.register(themeRoutes, { prefix: '/api/v1' });
  await app.register(mediaRoutes, { prefix: '/api/v1' });
  await app.register(productRoutes, { prefix: '/api/v1' });
  await app.register(searchRoutes, { prefix: '/api/v1' });
  await app.register(reviewRoutes, { prefix: '/api/v1' });
  await app.register(qnaRoutes, { prefix: '/api/v1' });
  await app.register(storeRoutes, { prefix: '/api/v1' });
  await app.register(cartRoutes, { prefix: '/api/v1' });
  await app.register(wishlistRoutes, { prefix: '/api/v1' });
  await app.register(orderRoutes, { prefix: '/api/v1' });

  // Start periodic 5-minute grant/JIT/action expiry sweep (Prompt 2.5)
  const stopGrantExpiry = startGrantExpiryScheduler(pool, cache, app.log, 300000);

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    service: 'explooro-api',
    version: '0.1.0',
    cache_driver: cache.driver,
    ts: new Date().toISOString(),
    uptime_s: Math.round(process.uptime()),
  }));

  app.addHook('onClose', async () => {
    stopGrantExpiry();
    await cache.quit?.();
    await pool.end();
  });

  return app;
}
