import mongoose from 'mongoose';
import { after } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';

let memory: MongoMemoryServer | null = null;

/** Prefer an explicit CI/local test database; otherwise use an isolated in-memory Mongo. */
export async function connectTestDatabase(dbName: string): Promise<void> {
  const uri = process.env.TEST_MONGODB_URI;
  if (uri) {
    const parsed = new URL(uri);
    parsed.pathname = `/${encodeURIComponent(dbName)}`;
    await mongoose.connect(parsed.toString(), { serverSelectionTimeoutMS: 5_000, connectTimeoutMS: 5_000 });
    return;
  }
  if (!memory) {
    memory = await MongoMemoryServer.create({ instance: { dbName: 'studymind_tests', args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  }
  await mongoose.connect(memory.getUri(dbName), { serverSelectionTimeoutMS: 5_000, connectTimeoutMS: 5_000 });
}

export async function disconnectTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
  if (memory) {
    const instance = memory;
    memory = null;
    await instance.stop().catch(() => undefined);
  }
}

// A failed assertion must never leave an in-memory mongod process behind.
after(async () => { await disconnectTestDatabase(); });
