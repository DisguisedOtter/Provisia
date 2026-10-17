import { loadEnv } from '@provisia/shared/env';
import { closeQueues } from '@provisia/worker/queues';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

loadEnv();
const config = loadConfig();
const app = await buildApp({ config });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await Promise.allSettled([app.close(), closeQueues()]);
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
