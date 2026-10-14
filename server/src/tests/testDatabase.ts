import mongoose from 'mongoose';
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
    memory = await MongoMemoryServer.create({ instance: { dbName: 'studymind_tests' } });
  }
  await mongoose.connect(memory.getUri(dbName), { serverSelectionTimeoutMS: 5_000, connectTimeoutMS: 5_000 });
}

export async function disconnectTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
}
