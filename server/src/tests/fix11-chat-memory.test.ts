import { connectTestDatabase, disconnectTestDatabase } from './testDatabase.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ChatThread } from '../models/ChatThread.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { User } from '../models/User.js';
import { promptHistory } from '../services/chatMemory.js';

test('chat prompt history retains at most eight messages and about 3,000 tokens', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, content: `m${i}:` + 'x'.repeat(2000) }));
  const history = promptHistory(rows);
  assert.ok(history.length <= 8);
  assert.ok(history.reduce((sum, m) => sum + m.content.length, 0) <= 12_000);
  assert.match(history.at(-1)?.content ?? '', /m11/);
  assert.ok(history.some((m) => m.content.includes('[truncated]')));
});

test('chat threads and messages are isolated by user and can be restored with scope', async () => {
  const dbName = `studymind_chat_${Date.now()}`;
  await connectTestDatabase(dbName);
  try {
    const [a, b] = await Promise.all([
      User.create({ name: 'Chat Owner A', email: `${dbName}a@test.local`, phone: '+919000000091', passwordHash: 'x' }),
      User.create({ name: 'Chat Owner B', email: `${dbName}b@test.local`, phone: '+919000000092', passwordHash: 'x' }),
    ]);
    const thread = await ChatThread.create({ userId: a._id, title: 'Section 2', scope: { sourceIds: [new mongoose.Types.ObjectId()], sectionTitle: '2 Introduction' } });
    const message = await ChatMessage.create({ userId: a._id, threadId: thread._id, role: 'assistant', content: 'Page-cited explanation', citations: [{ label: 'Book p.2' }] });
    assert.equal(await ChatThread.findOne({ _id: thread._id, userId: b._id }), null);
    assert.equal(await ChatMessage.findOne({ _id: message._id, userId: b._id }), null);
    const restored = await ChatThread.findOne({ _id: thread._id, userId: a._id }).lean() as any;
    const restoredMessages = await ChatMessage.find({ threadId: thread._id, userId: a._id }).sort({ createdAt: 1 }).lean();
    assert.equal(restored?.title, 'Section 2');
    assert.equal(restored?.scope?.sectionTitle, '2 Introduction');
    assert.equal(restoredMessages[0]?.content, 'Page-cited explanation');
  } finally {
    await mongoose.connection.dropDatabase();
    await disconnectTestDatabase();
  }
});
