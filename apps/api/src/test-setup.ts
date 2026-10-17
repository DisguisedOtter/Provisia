import { loadEnv } from '@provisia/shared/env';

loadEnv();

// Integration tests flush Redis and enqueue jobs. Keep them away from the dev worker's queues by using a
// dedicated Redis database: REDIS_URL_TEST when set, otherwise database 15 of REDIS_URL.
if (!process.env.REDIS_URL_TEST) {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  url.pathname = '/15';
  process.env.REDIS_URL_TEST = url.toString();
}
process.env.REDIS_URL = process.env.REDIS_URL_TEST;
