/**
 * Personalization simulation that imports the REAL learner-model code.
 *
 * The Python version of this re-implemented BKT and the topic selector, so it
 * measured a COPY of the system rather than the system. This imports
 * `bktUpdate`, `updateStability`, `retention`, `priorityScore` and `inZPD`
 * straight from src/utils/bkt.ts, and the selection policy from
 * src/services/selection.ts — the same function the assessment generator uses.
 *
 *   npx tsx scripts/simulate_students.ts --sessions 6 --questions 5 --trials 5
 *
 * Outputs evaluation/results/simulation_ts.json and the golden parity file
 * evaluation/golden_bkt.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  bktUpdate,
  updateStability,
  retention,
  priorityScore,
  inZPD,
  masteryBand,
  DEFAULT_BKT,
  DEFAULT_P_LEARNED,
  type BKTParams,
} from '../src/utils/bkt';
import { selectNextTopic, type MasterySnapshot } from '../src/services/selection';
import { mulberry32 } from '../src/utils/rng';

const RESULTS = path.resolve(process.cwd(), '../evaluation/results');

interface Profile {
  name: string;
  ability: number[];
  description: string;
}

const PROFILES: Profile[] = [
  { name: 'strong', ability: [0.90, 0.85, 0.92, 0.88], description: 'already knows most of it' },
  { name: 'weak', ability: [0.30, 0.25, 0.35, 0.28], description: 'struggles across the board' },
  { name: 'mixed', ability: [0.85, 0.80, 0.35, 0.30], description: 'strong early topics, weak later' },
  {
    name: 'beginner_err',
    ability: [0.55, 0.50, 0.20, 0.18],
    description: 'specific errors on later topics',
  },
  { name: 'late_bloomer', ability: [0.35, 0.40, 0.70, 0.75], description: 'slow start, strong finish' },
  { name: 'erratic', ability: [0.75, 0.20, 0.80, 0.25], description: 'high variance across topics' },
];

interface TopicState {
  topicId: string;
  pLearned: number;
  stability: number;
  attempts: number;
  correctCount: number;
  lastSession: number | null;
}

function snapshot(states: TopicState[], session: number, daysToExam: number | null): MasterySnapshot[] {
  return states.map((s) => ({
    topicId: s.topicId,
    pLearned: s.pLearned,
    retention: retention(s.pLearned, s.lastSession === null ? 3 : Math.max(1, session - s.lastSession), s.stability),
    attempts: s.attempts,
    stability: s.stability,
    daysToExam,
  }));
}

function simulate(
  profile: Profile,
  policy: 'adaptive' | 'random',
  sessions: number,
  questionsPerSession: number,
  seed: number
) {
  const rng = mulberry32(seed);
  const params: BKTParams = { ...DEFAULT_BKT };
  const states: TopicState[] = profile.ability.map((_, i) => ({
    topicId: `t${i}`,
    pLearned: DEFAULT_P_LEARNED,
    stability: 1,
    attempts: 0,
    correctCount: 0,
    lastSession: null,
  }));

  const asked: Array<[number, string]> = [];
  const trace: number[] = [];

  for (let session = 0; session < sessions; session++) {
    for (let q = 0; q < questionsPerSession; q++) {
      let idx: number;
      if (policy === 'adaptive') {
        // selectNextTopic returns a topicId (the same function the API uses);
        // map it back to the array index.
        const picked = selectNextTopic(snapshot(states, session, null), asked, session);
        idx = states.findIndex((t) => t.topicId === picked);
        if (idx < 0) idx = 0;
      } else {
        idx = Math.floor(rng() * states.length);
      }

      const s = states[idx];
      asked.push([session, s.topicId]);

      // Difficulty tracks progress so the material keeps challenging the student.
      const difficulty = Math.min(0.9, 0.3 + s.pLearned * 0.5);
      let pCorrect = profile.ability[idx] * (1.15 - 0.5 * difficulty);
      pCorrect = Math.min(0.97, Math.max(0.05, pCorrect));
      const correct = rng() < pCorrect;

      const days = s.lastSession === null ? 1 : Math.max(1, session - s.lastSession);
      const updated = bktUpdate(s.pLearned, correct, params);
      s.pLearned = updated.pLearned;
      s.stability = updateStability(s.stability, correct, days, difficulty).stability;
      s.attempts += 1;
      if (correct) s.correctCount += 1;
      s.lastSession = session;
    }
    trace.push(states.reduce((n, t) => n + t.pLearned, 0) / states.length);
  }

  let repeats = 0;
  for (let i = 1; i < asked.length; i++) {
    if (asked[i][0] === asked[i - 1][0] && asked[i][1] === asked[i - 1][1]) repeats++;
  }

  const toSeventy = trace.findIndex((m) => m >= 0.7);
  return {
    profile: profile.name,
    policy,
    firstSessionMastery: Number(trace[0].toFixed(4)),
    finalMastery: Number(trace[trace.length - 1].toFixed(4)),
    masteryGain: Number((trace[trace.length - 1] - trace[0]).toFixed(4)),
    topicsTouched: new Set(asked.map((a) => a[1])).size,
    questionsAsked: asked.length,
    repetitionRate: Number((repeats / Math.max(1, asked.length - 1)).toFixed(4)),
    sessionsToSeventy: toSeventy >= 0 ? toSeventy + 1 : null,
    bands: states.map((t) => masteryBand(t.pLearned)),
    trace: trace.map((t) => Number(t.toFixed(4))),
  };
}

function stats(xs: number[]) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  // 95% CI half-width using the normal approximation.
  const ci = 1.96 * (sd / Math.sqrt(n));
  return {
    trials: n,
    mean: Number(mean.toFixed(4)),
    stdev: Number(sd.toFixed(4)),
    ci95: [Number((mean - ci).toFixed(4)), Number((mean + ci).toFixed(4))],
  };
}

function argInt(name: string, dflt: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
}

function main() {
  const sessions = argInt('sessions', 6);
  const questions = argInt('questions', 5);
  const trials = argInt('trials', 5);
  const baseSeed = argInt('seed', 7);

  console.log(
    `SIMULATED students — ${PROFILES.length} profiles x ${sessions} sessions x ${questions} questions x ${trials} trials`
  );
  console.log('uses the REAL bktUpdate / updateStability / priorityScore / inZPD / selectNextTopic\n');

  const summary: Record<string, Record<string, unknown>> = {};
  const runs: unknown[] = [];

  for (const policy of ['adaptive', 'random'] as const) {
    summary[policy] = {};
    for (const p of PROFILES) {
      const out: unknown[] = [];
      for (let t = 0; t < trials; t++) {
        out.push(simulate(p, policy, sessions, questions, baseSeed + t * 101));
      }
      runs.push(...out);
      const gains = out.map((r: any) => r.masteryGain);
      const reps = out.map((r: any) => r.repetitionRate);
      const cov = out.map((r: any) => r.topicsTouched);
      const s70 = out.map((r: any) => r.sessionsToSeventy).filter((x: any) => x !== null) as number[];
      summary[policy][p.name] = {
        masteryGain: stats(gains),
        repetitionRate: stats(reps),
        topicsTouched: stats(cov),
        medianSessionsToSeventy: s70.length ? s70.sort((a, b) => a - b)[Math.floor(s70.length / 2)] : null,
      };
    }
  }

  const fmt = (s: any) => `${s.mean.toFixed(3)} [${s.ci95[0].toFixed(3)},${s.ci95[1].toFixed(3)}]`;
  console.log('profile        policy    masteryGain (95% CI)          repetition   coverage');
  console.log('-'.repeat(74));
  for (const p of PROFILES) {
    for (const policy of ['adaptive', 'random'] as const) {
      const s: any = summary[policy][p.name];
      console.log(
        `${p.name.padEnd(14)}${policy.padEnd(10)}${fmt(s.masteryGain).padEnd(26)}${fmt(
          s.repetitionRate
        ).padEnd(15)}${s.topicsTouched.mean.toFixed(1)}`
      );
    }
  }
  console.log('-'.repeat(74));
  console.log('\ngain (adaptive - random):');
  let wins = 0;
  for (const p of PROFILES) {
    const a: any = summary.adaptive[p.name].masteryGain;
    const r: any = summary.random[p.name].masteryGain;
    const d = a.mean - r.mean;
    if (d > 0) wins++;
    console.log(`  ${p.name.padEnd(14)}${d >= 0 ? '+' : ''}${d.toFixed(3)}`);
  }
  console.log(`  adaptive wins ${wins}/${PROFILES.length} profiles`);

  const out = {
    generatedBy: 'server/scripts/simulate_students.ts (imports real learner-model code)',
    config: { sessions, questionsPerSession: questions, trials, baseSeed, bkt: DEFAULT_BKT, profiles: PROFILES.length },
    profiles: Object.fromEntries(PROFILES.map((p) => [p.name, p.description])),
    summary,
    runs,
    caveat:
      'SIMULATED students under a stated response model. These numbers measure the question-selection ' +
      'scheduler, NOT real student outcomes, and must not be presented as evidence of real-world learning gain.',
  };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'simulation_ts.json'), JSON.stringify(out, null, 2));

  // Golden parity file, generated from the TypeScript implementation.
  const golden = [];
  for (let i = 0; i < 40; i++) {
    const r = mulberry32(1000 + i);
    const pLearned = Number(r().toFixed(6));
    const stability = Number((0.2 + r() * 8).toFixed(6));
    const days = Number((r() * 14).toFixed(6));
    const difficulty = Number(r().toFixed(6));
    for (const correct of [true, false]) {
      const u = bktUpdate(pLearned, correct, DEFAULT_BKT);
      const st = updateStability(stability, correct, days, difficulty);
      golden.push({
        pLearned,
        stability,
        days,
        difficulty,
        correct,
        expectedPLearned: u.pLearned,
        expectedPosterior: u.posterior,
        expectedStability: st.stability,
        expectedRetrievability: st.retrievability,
        expectedRetention: Number(retention(u.pLearned, days, st.stability).toFixed(12)),
        expectedPriority: priorityScore(u.pLearned, retention(u.pLearned, days, st.stability), 5, 30),
        expectedInZpd: inZPD(u.pLearned),
      });
    }
  }
  const goldenPath = path.resolve(process.cwd(), '../evaluation/golden_bkt.json');
  fs.writeFileSync(
    goldenPath,
    JSON.stringify(
      {
        generatedBy: 'server/scripts/simulate_students.ts',
        note: 'Parity fixtures generated from the TypeScript implementation. Python must reproduce these to 1e-9.',
        cases: golden,
      },
      null,
      2
    )
  );
  console.log(`\nwritten -> ${path.join(RESULTS, 'simulation_ts.json')}`);
  console.log(`golden  -> ${goldenPath} (${golden.length} cases)`);
}

main();