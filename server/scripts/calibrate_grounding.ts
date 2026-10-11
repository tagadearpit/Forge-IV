/**
 * Reproducible calibration of the grounding gate.
 *
 * Run:  MONGODB_URI=... npx tsx scripts/calibrate_grounding.ts
 *
 * Purpose: the tutor must refuse questions the material does not cover
 * (PDF Requirement 2b) WITHOUT over-refusing questions it does cover. Those two
 * goals pull in opposite directions, so the threshold is measured rather than
 * guessed.
 *
 * Method: a labelled probe set of in-material and off-material questions is run
 * through the real retrieval path. For each probe we record top-1 cosine
 * similarity and lexical coverage of the question by the retrieved excerpts.
 * We then sweep the composite rule `grounded = (sim >= S) OR (lex >= L)` and
 * report the operating point that maximises (true accepts - false accepts).
 *
 * The numbers printed here are what the defaults in .env.example were set from.
 */
import mongoose from 'mongoose';
import { retrieveUnits, lexicalOverlap } from '../src/services/rag';

const IN_MATERIAL = [
  'What problem does the Clock replacement algorithm solve?',
  'What does the virtual memory subsystem provide?',
  'How does a multi-level page table reduce translation cost?',
  'Why do large cache lines hurt random pointer chasing?',
  'What are the four conditions required for deadlock?',
  'What is the TLB and why does it matter?',
  'Explain set-associative caching.',
  'What is a reader-writer lock?',
  'What causes a data race?',
  'What is mutual exclusion used for?',
];

const OFF_MATERIAL = [
  'What is the capital of France?',
  'How do I bake sourdough bread?',
  'What is the mass of a proton?',
  'Who won the 2019 Cricket World Cup?',
  'Explain quantum chromodynamics.',
  'How does a diesel engine work?',
  'What is the population of Tokyo?',
  'Recommend a good mystery novel.',
  'How do I train for a marathon?',
  'What is the boiling point of water?',
  'Who wrote the Ramayana?',
  'How does photosynthesis work?',
];

interface Probe {
  q: string;
  sim: number;
  lex: number;
  grp: 'IN' | 'OUT';
}

const stat = (a: number[]) => ({
  min: +Math.min(...a).toFixed(3),
  max: +Math.max(...a).toFixed(3),
  mean: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(3),
});

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required (the probe needs the seeded corpus).');
    process.exit(1);
  }
  await mongoose.connect(uri);

  const { User } = await import('../src/models/User');
  const user = await User.findOne({ email: 'demo@studymind.app' }).lean();
  if (!user) {
    console.error('No demo user found. Run `npm run seed` first.');
    process.exit(1);
  }
  const uid = String(user._id);

  const rows: Probe[] = [];
  for (const [grp, qs] of [['IN', IN_MATERIAL], ['OUT', OFF_MATERIAL]] as const) {
    for (const q of qs) {
      const hits = await retrieveUnits(uid, { question: q, topK: 8 });
      rows.push({ q, sim: hits[0]?.similarity ?? 0, lex: lexicalOverlap(q, hits), grp });
    }
  }

  const ins = rows.filter((r) => r.grp === 'IN');
  const outs = rows.filter((r) => r.grp === 'OUT');
  console.log('semantic (top-1 cosine) IN :', JSON.stringify(stat(ins.map((r) => r.sim))));
  console.log('semantic (top-1 cosine) OUT:', JSON.stringify(stat(outs.map((r) => r.sim))));
  console.log('lexical  (coverage)     IN :', JSON.stringify(stat(ins.map((r) => r.lex))));
  console.log('lexical  (coverage)     OUT:', JSON.stringify(stat(outs.map((r) => r.lex))));

  let best = { score: -Infinity, S: 0, L: 0, tp: 0, fp: 0, fn: 0, tn: 0 };
  for (let S = 0.05; S <= 0.5; S += 0.01) {
    for (let L = 0.1; L <= 0.7; L += 0.05) {
      const decide = (r: Probe) => r.sim >= S || r.lex >= L;
      const tp = ins.filter(decide).length;
      const fn = ins.length - tp;
      const fp = outs.filter(decide).length;
      const tn = outs.length - fp;
      // False accepts are far more damaging than false declines here: an
      // ungrounded answer is the failure the whole design exists to prevent.
      const score = tp - 3 * fp;
      if (score > best.score) best = { score, S, L, tp, fp, fn, tn };
    }
  }

  console.log('\nbest operating point:', JSON.stringify(best));
  console.log(`\nat sim>=${best.S.toFixed(2)} OR lex>=${best.L.toFixed(2)}:`);
  for (const r of rows) {
    const g = r.sim >= best.S || r.lex >= best.L;
    const correct = (r.grp === 'IN') === g;
    console.log(
      `  ${correct ? 'ok  ' : 'MISS'} ${r.grp}  sim=${r.sim.toFixed(3)} lex=${r.lex.toFixed(3)}  ${r.q}`
    );
  }
  console.log(
    `\ntrue accepts ${best.tp}/${ins.length}, false accepts ${best.fp}/${outs.length}, ` +
      `false declines ${best.fn}/${ins.length}`
  );
  console.log(`\nSet in .env:\n  GROUNDING_SIMILARITY_THRESHOLD=${best.S.toFixed(2)}\n  GROUNDING_LEXICAL_THRESHOLD=${best.L.toFixed(2)}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});