import mongoose from 'mongoose';
import { env } from '../config/env.js';

/**
 * Connects to MongoDB Atlas when MONGODB_URI is provided.
 * When it is not, we spin up an ephemeral in-process MongoDB so the full
 * pipeline (aggregation pipelines, indexes, vector queries) is exercised
 * identically in local development and CI. Data is non-persistent in that mode,
 * which is surfaced in /api/health and in the README.
 */
let memoryServer: { stop: () => Promise<boolean> } | null = null;

export async function connectDb(): Promise<{
  mode: 'atlas' | 'memory';
  uri: string;
}> {
  mongoose.set('strictQuery', true);

  if (env.MONGODB_URI) {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB,
      serverSelectionTimeoutMS: 10000,
    });
    return { mode: 'atlas', uri: redact(env.MONGODB_URI) };
  }

  // Lazily required so production installs that always set MONGODB_URI do not
  // need the dev dependency loaded.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mem = await MongoMemoryServer.create({
    instance: { dbName: env.MONGODB_DB },
  });
  memoryServer = mem as unknown as { stop: () => Promise<boolean> };
  await mongoose.connect(mem.getUri(), { dbName: env.MONGODB_DB });
  return { mode: 'memory', uri: 'mongodb://127.0.0.1:<ephemeral>/' + env.MONGODB_DB };
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}

export function dbIsHealthy(): boolean {
  // 1 === connected
  return mongoose.connection.readyState === 1;
}

function redact(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}