import { createDb } from '@provisia/db';
import fp from 'fastify-plugin';

export default fp(
  async (app) => {
    const client = createDb(app.config.DATABASE_URL);
    app.decorate('db', client.db);
    app.decorate('dbClient', client);
    app.addHook('onClose', async () => {
      await client.close();
    });
  },
  { name: 'db' },
);
