import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPreviousAssistant, type PromptMessage } from '../services/chatMemory.js';

test('uses the exact visible assistant reply when one is supplied, otherwise the latest in-thread reply', () => {
  const earlier: PromptMessage = { role: 'assistant', content: 'Earlier tutor answer' };
  const latest: PromptMessage = { role: 'assistant', content: 'Latest tutor answer' };
  const user: PromptMessage = { role: 'user', content: 'Follow-up question' };
  const rows = [earlier, user, latest];

  assert.equal(selectPreviousAssistant(rows, earlier), earlier);
  assert.equal(selectPreviousAssistant(rows), latest);
  assert.equal(selectPreviousAssistant([user]), null);
});
