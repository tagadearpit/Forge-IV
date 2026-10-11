/**
 * Builds /evaluation/testset.json from the seeded corpus.
 *
 * Ground-truth unit IDs MUST correspond to units that actually exist, otherwise
 * context recall and citation accuracy are meaningless. So the test set is
 * derived from the real ingested corpus rather than hand-written, and every
 * entry is checked against the database before being written.
 *
 * Run:  MONGODB_URI=... npx tsx scripts/build_testset.ts
 *
 * Entries have the shape required by the Track D evaluation spec:
 *   { question, referenceAnswer, groundTruthUnitIds[], isOffMaterial }
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { Unit } from '../src/models/Unit';
import { Topic } from '../src/models/Topic';
import { Source } from '../src/models/Source';
import { User } from '../src/models/User';
import { splitSentences, contentWords } from '../src/utils/text';

interface TestSetEntry {
  question: string;
  referenceAnswer: string;
  groundTruthUnitIds: string[];
  isOffMaterial: boolean;
}

/** Deliberately outside the seeded systems-programming material. */
const OFF_MATERIAL = [
  'What is the capital city of France?',
  'How do I bake a sourdough loaf at home?',
  'What is the mass of a proton in kilograms?',
  'Who won the FIFA World Cup in 2022?',
  'Explain how a diesel engine combusts fuel.',
  'What is the population of Tokyo?',
  'Recommend a good detective novel.',
  'How do I train for a half marathon?',
  'What is the boiling point of water at sea level?',
  'Who wrote the Ramayana?',
  'How does photosynthesis convert sunlight?',
  'What currency does Japan use?',
  'Explain the rules of cricket test matches.',
  'How do vaccines create immunity?',
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required.');
    process.exit(1);
  }
  await mongoose.connect(uri);

  const user = await User.findOne({ email: 'demo@studymind.app' }).lean();
  if (!user) {
    console.error('No demo user found. Run `npm run seed` first.');
    process.exit(1);
  }
  const userId = String(user._id);

  const sources = await Source.find({ userId, status: 'ready' }).lean();
  if (!sources.length) {
    console.error('No ready sources found. Run `npm run seed` first.');
    process.exit(1);
  }
  const units = await Unit.find({ userId }).lean();
  const topics = await Topic.find({ userId }).lean();
  const topicName = new Map(topics.map((t: any) => [String(t._id), t.name]));

  console.log(`corpus: ${units.length} units, ${topics.length} topics, ${sources.length} sources`);

  const entries: TestSetEntry[] = [];
  const seen = new Set<string>();

  for (const unit of units as any[]) {
    const sentences = splitSentences(unit.text)
      .map((s) => s.trim())
      // Substantive sentences only — a 6-word fragment makes a bad question.
      .filter((s) => s.length >= 60 && s.length <= 240 && contentWords(s).length >= 8);

    let usedHere = 0;
    for (const sentence of sentences) {
      if (usedHere >= 5) break; // cap per unit so no single passage dominates
      const key = sentence.slice(0, 50).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const terms = contentWords(sentence);
      const subject = terms.slice(0, 4).join(' ');

      // Two complementary phrasings so the set is not 50 copies of one template.
      entries.push({
        question: `According to your material, what does this statement say: "${sentence.slice(0, 120)}"?`,
        referenceAnswer: sentence,
        groundTruthUnitIds: [String(unit._id)],
        isOffMaterial: false,
      });

      if (usedHere < 3) {
        entries.push({
          question: `In the uploaded material, what is described regarding ${subject}?`,
          referenceAnswer: sentence,
          groundTruthUnitIds: [String(unit._id)],
          isOffMaterial: false,
        });
      }
      usedHere++;
    }
  }

  // A handful of multi-unit entries: recall should be judged against a topic
  // whose answer genuinely spans several passages.
  for (const topic of topics.slice(0, 4) as any[]) {
    const related = (units as any[]).filter((u) =>
      (u.topicIds ?? []).map(String).includes(String(topic._id))
    );
    if (related.length < 2) continue;
    const text = related
      .slice(0, 3)
      .flatMap((u) => splitSentences(u.text))
      .filter((s) => s.length > 60)
      .slice(0, 2)
      .join(' ');
    entries.push({
      question: `Summarise what your material covers about ${topic.name}.`,
      referenceAnswer: text,
      groundTruthUnitIds: related.slice(0, 3).map((u) => String(u._id)),
      isOffMaterial: false,
    });
  }

  for (const q of OFF_MATERIAL) {
    entries.push({
      question: q,
      referenceAnswer:
        'The assistant should decline: this question is not covered by the uploaded material.',
      groundTruthUnitIds: [],
      isOffMaterial: true,
    });
  }

  const outDir = path.resolve(process.cwd(), '../evaluation');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'testset.json'),
    JSON.stringify(
      {
        version: 'v1',
        generatedFrom: sources.map((s: any) => s.title),
        topics: [...topicName.values()],
        note:
          'Ground-truth unit IDs are derived from the real seeded corpus, so context ' +
          'recall and citation accuracy are computed against units that really exist.',
        entries,
      },
      null,
      2
    )
  );

  const off = entries.filter((e) => e.isOffMaterial).length;
  console.log(`wrote ${entries.length} entries (${entries.length - off} in-material, ${off} off-material)`);
  console.log(`  -> ${path.join(outDir, 'testset.json')}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});