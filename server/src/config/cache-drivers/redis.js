/**
 * redis.js — Real Redis cache driver (Prompt 2.1).
 *
 * Backs `CACHE_DRIVER=redis` against Upstash or a local Redis. Implements the same interface as
 * cache-drivers/memory.js so callers never branch on which driver is active.
 */

import { createClient } from 'redis';

export async function createRedisCache(redisUrl) {
  const client = createClient({ url: redisUrl });
  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[cache:redis] client error', err);
  });
  await client.connect();

  // Pub/sub requires its own connection in node-redis — a subscribed client cannot issue
  // other commands. Created lazily so processes that never subscribe never pay for it.
  let subClient = null;
  async function getSubClient() {
    if (!subClient) {
      subClient = client.duplicate();
      subClient.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('[cache:redis] subscriber error', err);
      });
      await subClient.connect();
    }
    return subClient;
  }

  return {
    driver: 'redis',

    async get(key) {
      return client.get(key);
    },

    async set(key, value, ttlSeconds) {
      const options = ttlSeconds ? { EX: ttlSeconds } : undefined;
      return client.set(key, value, options);
    },

    async del(key) {
      return client.del(key);
    },

    async incr(key) {
      return client.incr(key);
    },

    async expire(key, ttlSeconds) {
      return client.expire(key, ttlSeconds);
    },

    async ttl(key) {
      const ms = await client.pTTL(key);
      return ms;
    },

    async setnx(key, value, ttlSeconds) {
      const options = { NX: true, ...(ttlSeconds ? { EX: ttlSeconds } : {}) };
      const result = await client.set(key, value, options);
      return result === 'OK';
    },

    async publish(channel, message) {
      return client.publish(channel, message);
    },

    async subscribe(channel, handler) {
      const sub = await getSubClient();
      await sub.subscribe(channel, handler);
      return async () => sub.unsubscribe(channel);
    },

    async quit() {
      if (subClient) await subClient.quit();
      await client.quit();
    },
  };
}
