import 'dotenv/config';
import { env } from './config/env.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { createApp } from './app.js';
import { activeSpace, groundingThresholds } from './utils/vectorSpace.js';
import { resumeIngestionJobs } from './services/ingestion.js';
import { cleanupExpiredPdfReports } from './services/pdfReport.js';

async function main() {
  // Bind to 0.0.0.0 and process.env.PORT so Replit's Run button works with no
  // manual terminal steps.
  const db = await connectDb();
  console.log(`[db] connected (${db.mode}) ${db.uri}`);
  void resumeIngestionJobs().catch((err) => console.error('[ingest:resume] startup recovery failed', err));
  const cleanupPdfReports = () => void cleanupExpiredPdfReports().catch((err) => {
    console.error('[pdf] scheduled expiry cleanup failed', { name: (err as Error)?.name ?? 'Error' });
  });
  cleanupPdfReports();
  const pdfCleanupTimer = setInterval(cleanupPdfReports, 60 * 60 * 1000);
  pdfCleanupTimer.unref();

  const app = createApp();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`[studymind] listening on http://0.0.0.0:${env.PORT}`);
    console.log(`[studymind] AI provider: ${env.provider}`);
    const grounding = groundingThresholds();
    console.log(`[studymind] grounding mode: ${grounding.calibrated ? 'numeric-gate' : 'model-judged'} (${activeSpace().provider})`);
    console.log(`[studymind] client origin: ${env.CLIENT_ORIGIN}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[studymind] ${signal} received, shutting down`);
    clearInterval(pdfCleanupTimer);
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
