import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

export default fp(
  async (app) => {
    // lazyConnect: the API boots without Redis; the first command connects.
    const redis = new Redis(app.config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    redis.on('error', (err) => app.log.warn({ err }, 'redis error'));
    app.decorate('redis', redis);
    app.addHook('onClose', async () => {
      redis.disconnect();
    });
  },
  { name: 'redis' },
);
