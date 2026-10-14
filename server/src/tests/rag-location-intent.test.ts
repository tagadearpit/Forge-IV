import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Unit } from '../models/Unit.js';
import { Source } from '../models/Source.js';
import { getAIProvider } from '../ai/provider.js';
import { localEmbed } from '../utils/embedding.js';
import { answerQuestion, parseLocationIntent, retrieveUnits } from '../services/rag.js';

test('ordinary phrases that mention page, slide, or document remain relevance queries', () => {
  for (const question of ['What is page replacement?', 'how a slide rule works', 'document root in Apache']) {
    const intent = parseLocationIntent(question);
    assert.equal(intent.explicit, false, question);
    assert.equal(intent.wholeDocumentSummary, false, question);
  }
});

test('explicit numeric and referential document locations are recognized', () => {
  assert.deepEqual(
    ['explain section 2', 'summarize page 5', 'explain that section from my upload'].map((question) => parseLocationIntent(question).explicit),
    [true, true, true]
  );
  assert.equal(parseLocationIntent('explain that section from my upload').refersToSection, true);
  assert.equal(parseLocationIntent('explain section 2', '2.1 Page Replacement').explicit, true);
});

test('only whole-document summary requests use whole-source ordering and map-reduce', () => {
  assert.equal(parseLocationIntent('summarize this document').wholeDocumentSummary, true);
  assert.equal(parseLocationIntent('summarize the whole document').wholeDocumentSummary, true);
  assert.equal(parseLocationIntent('explain the whole document').wholeDocumentSummary, false);
});

test('ordinary false-positive questions are not scoped to the latest upload', async () => {
  const ai = getAIProvider();
  const originalFind = Unit.find;
  const originalFindOne = Source.findOne;
  const originalEmbed = ai.embed.bind(ai);
  const originalGeneralAnswer = ai.generalAnswer.bind(ai);
  const filters: any[] = [];
  let sourceLookups = 0;
  (Unit as any).find = (filter: any) => {
    filters.push(filter);
    return { select() { return this; }, lean: async () => [] };
  };
  (Source as any).findOne = () => { sourceLookups++; throw new Error('unexpected latest-source lookup'); };
  (ai as any).embed = async (texts: string[]) => texts.map(localEmbed);
  (ai as any).generalAnswer = async () => null;
  try {
    for (const question of ['What is page replacement?', 'how a slide rule works', 'document root in Apache']) {
      await answerQuestion(new mongoose.Types.ObjectId().toString(), question);
    }
    assert.equal(sourceLookups, 0, 'an ordinary concept question must not auto-select a source');
    assert.equal(filters.length, 3);
    assert.ok(filters.every((filter) => !filter.sourceId), 'normal RAG should search across the user’s sources');
  } finally {
    (Unit as any).find = originalFind;
    (Source as any).findOne = originalFindOne;
    (ai as any).embed = originalEmbed;
    (ai as any).generalAnswer = originalGeneralAnswer;
  }
});

test('an unnumbered follow-up section uses the previous answer’s cited pages', async () => {
  const ai = getAIProvider();
  const sourceId = new mongoose.Types.ObjectId().toString();
  const userId = new mongoose.Types.ObjectId().toString();
  const originalFind = Unit.find;
  const originalFindOne = Source.findOne;
  const originalEmbed = ai.embed.bind(ai);
  let unitFilter: any;
  (Source as any).findOne = () => ({ select() { return this; }, lean: async () => ({ _id: sourceId, title: 'Notes', type: 'pdf', outline: [] }) });
  (Unit as any).find = (filter: any) => {
    unitFilter = filter;
    return { select() { return this; }, lean: async () => [] };
  };
  (ai as any).embed = async (texts: string[]) => texts.map(localEmbed);
  try {
    await answerQuestion(userId, 'explain that section from my upload', {
      previousAssistantCitations: [
        { sourceId, location: { page: 2 } },
        { sourceId, location: { page: 3 } },
      ],
    });
    assert.equal(String(unitFilter.sourceId.$in[0]), sourceId);
    assert.equal(unitFilter['location.page'].$gte, 2);
    assert.equal(unitFilter['location.page'].$lt, 4);
  } finally {
    (Unit as any).find = originalFind;
    (Source as any).findOne = originalFindOne;
    (ai as any).embed = originalEmbed;
  }
});

test('whole-document mode returns every ordered unit, not only top-k', async () => {
  const ai = getAIProvider();
  const sourceId = new mongoose.Types.ObjectId().toString();
  const userId = new mongoose.Types.ObjectId().toString();
  const originalFind = Unit.find;
  const originalSourceFind = Source.find;
  const originalEmbed = ai.embed.bind(ai);
  const fakeEmbed = (text: string) => Array.from({ length: 8 }, (_, index) => ((text.charCodeAt(index % text.length) ?? 0) + index) / 100);
  const rows = Array.from({ length: 12 }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(), sourceId, userId, kind: 'text', text: `Paging section ${index + 1} explains virtual memory and page replacement.`,
    location: { page: index + 1 }, embedding: fakeEmbed(`Paging section ${index + 1}`), embeddingProvider: ai.name,
    embeddingModel: ai.embeddingModel, embeddingDim: 8,
  }));
  (Unit as any).find = () => ({ select() { return this; }, lean: async () => rows });
  (Source as any).find = () => ({ select() { return this; }, lean: async () => [{ _id: sourceId, title: 'Paging notes', type: 'pdf' }] });
  (ai as any).embed = async (texts: string[]) => texts.map((text) => fakeEmbed(text));
  try {
    const hits = await retrieveUnits(userId, { question: 'summarize this document', sourceIds: [sourceId], topK: 3, pageOrder: true, all: true });
    assert.equal(hits.length, 12);
    assert.equal(hits[0].location.page, 1);
    assert.equal(hits.at(-1)?.location.page, 12);
  } finally {
    (Unit as any).find = originalFind;
    (Source as any).find = originalSourceFind;
    (ai as any).embed = originalEmbed;
  }
});
