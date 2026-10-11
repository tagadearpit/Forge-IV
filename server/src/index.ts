import 'dotenv/config';
import { env } from './config/env';
import { connectDb, disconnectDb } from './db/connect';
import { createApp } from './app';

async function main() {
  // Bind to 0.0.0.0 and process.env.PORT so Replit's Run button works with no
  // manual terminal steps.
  const db = await connectDb();
  console.log(`[db] connected (${db.mode}) ${db.uri}`);

  const app = createApp();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`[studymind] listening on http://0.0.0.0:${env.PORT}`);
    console.log(`[studymind] AI provider: ${env.provider}`);
    console.log(`[studymind] client origin: ${env.CLIENT_ORIGIN}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[studymind] ${signal} received, shutting down`);
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[fatal] failed to start:', err);
  process.exit(1);
});
