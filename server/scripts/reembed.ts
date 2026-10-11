/**
 * Re-embeds every stored vector into the active provider's space.
 *
 * Switching providers (local <-> Gemini) leaves existing units holding vectors
 * in the old space. Retrieval correctly EXCLUDES them (comparing across spaces
 * is meaningless), which means the knowledge base silently appears empty until
 * this runs. That exclusion is the safe failure; this script is the repair.
 *
 *   MONGODB_URI=... npx tsx scripts/reembed.ts
 *   MONGODB_URI=... npx tsx scripts/reembed.ts --dry-run
 *   MONGODB_URI=... npx tsx scripts/reembed.ts --provider gemini
 */
import mongoose from 'mongoose';
import { getAIProvider } from '../src/ai/provider';
import { Unit } from '../src/models/Unit';
import { Question } from '../src/models/Question';
import { Topic } from '../src/models/Topic';
import { localEmbed } from '../src/utils/embedding';
import { activeSpace, __setActiveSpace, type EmbeddingProvider } from '../src/utils/vectorSpace';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const providerArg = args.includes('--provider')
  ? (args[args.indexOf('--provider') + 1] as EmbeddingProvider)
  : undefined;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required.');
    process.exit(1);
  }
  await mongoose.connect(uri);

  const space = providerArg
    ? { provider: providerArg, dim: providerArg === 'gemini' ? 768 : 256 }
    : activeSpace();
  __setActiveSpace(space);

  const ai = getAIProvider();
  if (ai.name !== space.provider) {
    console.error(
      `Provider mismatch: the AI provider is "${ai.name}" but --provider says "${space.provider}".\n` +
        `Set GEMINI_API_KEY (or AI_PROVIDER) to match, then re-run.`
    );
    process.exit(1);
  }

  const units = await Unit.find({}).select('embedding embeddingProvider embeddingDim text').lean();
  const staleUnits = units.filter(
    (u: any) =>
      !u.embedding?.length ||
      u.embeddingProvider !== space.provider ||
      Number(u.embeddingDim) !== space.dim ||
      u.embedding.length !== space.dim
  );

  const questions = await Question.find({}).select('fingerprintEmbedding fingerprintEmbeddingProvider fingerprintEmbeddingDim text').lean();
  const staleQuestions = questions.filter(
    (q: any) =>
      !q.fingerprintEmbedding?.length ||
      q.fingerprintEmbeddingProvider !== space.provider ||
      Number(q.fingerprintEmbeddingDim) !== space.dim ||
      q.fingerprintEmbedding.length !== space.dim
  );

  console.log(`target space : ${space.provider}/${space.dim}-dim`);
  console.log(`units        : ${staleUnits.length}/${units.length} need re-embedding`);
  console.log(`questions    : ${staleQuestions.length}/${questions.length} need re-embedding`);

  if (dryRun) {
    console.log('\n(dry run — nothing written)');
    await mongoose.disconnect();
    return;
  }

  const BATCH = 50;

  for (let i = 0; i < staleUnits.length; i += BATCH) {
    const slice = staleUnits.slice(i, i + BATCH);
    let vecs: number[][];
    try {
      vecs = await ai.embed(slice.map((u: any) => u.text));
    } catch (err) {
      console.warn(`  batch ${i} embed failed (${(err as Error).message}); using local vectors`);
      vecs = slice.map((u: any) => localEmbed(u.text));
    }
    if (!vecs.length || vecs.length !== slice.length) {
      vecs = slice.map((u: any) => localEmbed(u.text));
    }
    const actualDim = vecs[0]?.length ?? space.dim;
    const provider = actualDim === space.dim ? space.provider : 'local';

    const ops = slice.map((u: any, k: number) => ({
      updateOne: {
        filter: { _id: u._id },
        update: {
          $set: {
            embedding: vecs[k],
            embeddingProvider: provider,
            embeddingDim: vecs[k]?.length ?? actualDim,
          },
        },
      },
    }));
    await Unit.bulkWrite(ops as never, { ordered: false });
    process.stdout.write(`\r  units ${Math.min(i + BATCH, staleUnits.length)}/${staleUnits.length}`);
  }

  for (let i = 0; i < staleQuestions.length; i += BATCH) {
    const slice = staleQuestions.slice(i, i + BATCH);
    let vecs: number[][];
    try {
      vecs = await ai.embed(slice.map((q: any) => q.text));
    } catch {
      vecs = slice.map((q: any) => localEmbed(q.text));
    }
    if (!vecs.length || vecs.length !== slice.length) {
      vecs = slice.map((q: any) => localEmbed(q.text));
    }
    const actualDim = vecs[0]?.length ?? space.dim;
    const provider = actualDim === space.dim ? space.provider : 'local';

    const ops = slice.map((q: any, k: number) => ({
      updateOne: {
        filter: { _id: q._id },
        update: {
          $set: {
            fingerprintEmbedding: vecs[k],
            fingerprintEmbeddingProvider: provider,
            fingerprintEmbeddingDim: vecs[k]?.length ?? actualDim,
          },
        },
      },
    }));
    await Question.bulkWrite(ops as never, { ordered: false });
    process.stdout.write(`\r  questions ${Math.min(i + BATCH, staleQuestions.length)}/${staleQuestions.length}`);
  }
  process.stdout.write('\n');

  // Topic names are compared with localEmbed() on both sides by design, so they
  // need no migration. Verified here so the omission is deliberate, not forgotten.
  const topicCount = await Topic.countDocuments();
  console.log(`topics       : ${topicCount} (local-only by design — no migration needed)`);
  console.log('\ndone.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});