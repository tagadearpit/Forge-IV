'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  BookOpen, Link2, ClipboardCheck, Brain, BarChart3, Map, RefreshCw, CalendarDays,
  Languages, Mic, ShieldCheck, ChevronDown, Sparkles, Play, ArrowRight,
  AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { SiteHeader, SiteFooter } from '@/components/site-chrome';
import { ArchitectureDiagram, StepIcon } from '@/components/illustrations';
import { Reveal } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const FEATURES = [
  {
    icon: BookOpen,
    title: 'Multimodal Knowledge Base',
    body: 'Ingest PDFs, slide decks, lecture video, audio and images with no manual preprocessing. Every unit keeps its exact origin.',
  },
  {
    icon: Link2,
    title: 'Source Grounding',
    body: 'Answers grounded in your material cite the page, slide or timestamp. If the material does not cover it, a clearly labelled general-knowledge answer stays separate.',
  },
  {
    icon: ClipboardCheck,
    title: 'Adaptive Assessment',
    body: 'MCQ, short answer and numerical questions on the scope you choose, verified against your material and tagged to a topic.',
  },
  {
    icon: Brain,
    title: 'Learner Model',
    body: 'Bayesian knowledge tracing plus a forgetting curve gives you a mastery estimate per topic that updates after every answer.',
  },
  {
    icon: BarChart3,
    title: 'System Evaluation',
    body: 'Faithfulness, relevancy, context precision and recall measured against a test set with known source locations.',
  },
  {
    icon: Map,
    title: 'Course Map',
    body: 'A visual graph of topics and their prerequisites, colour-coded by your current mastery.',
  },
  {
    icon: RefreshCw,
    title: 'Revision Material',
    body: 'Flashcards and summaries point you back to the topics that could use another look.'
  },
  {
    icon: CalendarDays,
    title: 'Study Schedule',
    body: 'A plan built from weak topics, forgetting-curve decay and how many days are left before your exam.',
  },
  {
    icon: Languages,
    title: 'Hindi / English',
    body: 'Ask in English or Hindi. Hindi explanations keep technical terms in English so nothing gets lost in translation.',
  },
  {
    icon: Mic,
    title: 'Audio Tutoring',
    body: 'Dictate a question with your microphone and have answers read aloud.',
  },
];

const STEPS = [
  {
    title: 'Upload your material',
    body: 'Drop in lecture PDFs, slide decks, recorded lectures or images. StudyMind extracts text, figures and speech with timestamps.',
  },
  {
    title: 'Knowledge base is built',
    body: 'Content is chunked, embedded, and mapped to topics, subtopics and key concepts — each unit tagged back to its origin.',
  },
  {
    title: 'Chat or take a quiz',
    body: 'Ask anything and get a cited answer, or generate an adaptive assessment focused on what you have not mastered yet.',
  },
  {
    title: 'See what changed',
    body: 'Your mastery updates after every answer. The dashboard shows what improved, what is fading, and what to do next.',
  },
];

const TECH = [
  'Next.js 14', 'React 18', 'TypeScript', 'Tailwind CSS', 'Express', 'Node.js',
  'MongoDB', 'Mongoose', 'Google Gemini', 'Vercel', 'Replit', 'RAGAS',
];

const FAQ = [
  {
    q: 'What file types can I upload?',
    a: 'PDF, PPTX, PNG and JPG, MP4 video, MP3 and WAV audio, plus plain text. PDFs are read page by page, slide decks keep slide numbers and speaker notes, and video is transcribed into timestamped segments. Every extracted unit remembers where it came from.',
  },
  {
    q: 'How does StudyMind avoid making things up?',
    a: 'The tutor checks your material first. When it supports the answer, citations are checked against the retrieved passages and shown with the response. When it does not, an optional general-knowledge answer appears in its own warning-labelled block, with no citations, so it cannot be confused with your uploads.',
  },
  {
    q: 'Does it support Hindi?',
    a: 'Yes. Switch the tutor to Hindi and explanations come back in Hindi with technical terms kept in English in parentheses, so terminology stays precise. Citations always stay in the original language so they still point at the right place.',
  },
  {
    q: 'Who can see my uploaded material?',
    a: 'Queries are scoped to your account, and passwords are hashed before storage. Check the service privacy policy for current data-handling details.'
  },
  {
    q: 'How is my mastery score calculated?',
    a: 'With Bayesian knowledge tracing. Each topic has a probability of being mastered. After each answer that probability is updated with a standard Bayes step, then projected forward using a transition probability. A forgetting curve decays your retention over time, which is what drives the study plan.',
  },
  {
    q: 'What does it cost to run?',
    a: 'Hosting and AI-provider charges depend on the services and plans used to run the app. AI calls may incur separate usage-based costs; check your provider’s current pricing before scaling up.',
  },
];

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        {/* ------------------------------ HERO ------------------------------ */}
        <section className="relative overflow-hidden pt-28 pb-20 sm:pt-32 sm:pb-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
            <div className="animate-fade-up">
              <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Multimodal AI Hackathon 2026 · Track D
              </span>

              <h1 className="mt-5 max-w-[12ch] text-[2.65rem] leading-[1.04] font-bold tracking-[-0.055em] sm:text-[3.5rem] lg:text-[4.1rem] lg:leading-[1.02]">
                Study smarter with an AI tutor that
                <span className="bg-gradient-to-r from-brand-600 to-brand-400 bg-clip-text text-transparent">
                  {' '}cites its sources
                </span>
              </h1>

              <p className="mt-5 max-w-xl text-lg text-muted">
                Upload your lectures, textbooks and slides. Get cited answers when your material has the answer — or a clearly separate general-knowledge response when it doesn’t. Then practice with quizzes that adapt to what you know.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/login" className="btn-primary px-6 py-3 text-base">
                  Get Started <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a href="#how-it-works" className="btn-secondary px-6 py-3 text-base">
                  <Play className="h-4 w-4" aria-hidden /> See how it works
                </a>
              </div>

              <HeroEvaluationStats />
            </div>

            <div className="animate-fade-up [animation-delay:120ms]">
              {/* Artwork generated for this prototype and bundled locally, so it
                  always renders — no external CDN that could 404 on demo day.
                  See web/public/images/README.md for provenance. */}
              <div className="relative mx-auto w-full max-w-lg">
                <Image
                  src="/images/hero-grounded-ai.webp"
                  alt="Translucent document and slide panels tethered by luminous citation lines to a glowing core, representing material grounded to a single knowledge source"
                  width={1600}
                  height={1195}
                  priority
                  sizes="(max-width: 1024px) 100vw, 560px"
                  className="w-full rounded-3xl shadow-lift ring-1 ring-white/10"
                />
                {/* Floating citation chip echoing the product's real UI. */}
                <div className="absolute -bottom-5 left-4 flex items-center gap-2 rounded-2xl border border-[color:rgb(var(--border))] bg-[color:rgb(var(--card))] px-3.5 py-2.5 shadow-lift sm:left-8">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-white">
                    <BookOpen className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="font-mono text-xs">
                    <span className="block font-sans text-[11px] font-medium text-muted">Cited source</span>
                    Lecture 7 · p.42
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* --------------------------- FEATURES ---------------------------- */}
        <section id="features" className="border-t border-[color:rgb(var(--border))] py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHeading
                eyebrow="Capabilities"
                title="Built around the six track requirements"
                body="Each capability below maps directly to a numbered requirement in the Track D problem statement."
              />
            </Reveal>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <Reveal key={f.title}>
                  <div className="card h-full p-6 transition-shadow hover:shadow-lift">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
                      <f.icon className="h-5 w-5" aria-hidden />
                    </div>
                    <h3 className="mt-4 font-semibold">{f.title}</h3>
                    <p className="mt-2 text-sm text-muted">{f.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------- HOW IT WORKS -------------------------- */}
        <section id="how-it-works" className="border-t border-[color:rgb(var(--border))] py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHeading
                eyebrow="How it works"
                title="Four steps from raw material to mastery"
                body="No manual tagging, no spreadsheet of topics. The pipeline builds the structure as it ingests."
              />
            </Reveal>

            <ol className="mt-14 grid gap-8 md:grid-cols-4">
              {STEPS.map((s, i) => (
                <Reveal key={s.title}>
                  <li className="relative">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-600 text-white">
                        <StepIcon index={i} />
                      </div>
                      <span className="font-mono text-xs text-muted">0{i + 1}</span>
                    </div>
                    <h3 className="mt-4 font-semibold">{s.title}</h3>
                    <p className="mt-2 text-sm text-muted">{s.body}</p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* -------------------------- ARCHITECTURE ------------------------ */}
        <section id="architecture" className="border-t border-[color:rgb(var(--border))] py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHeading
                eyebrow="System architecture"
                title="A retrieval pipeline with a single AI seam"
                body="Every AI call goes through one provider module, so the model can be swapped without touching business logic."
              />
            </Reveal>

            <Reveal>
              <div className="card mt-10 overflow-x-auto p-6">
                <ArchitectureDiagram className="mx-auto min-w-[720px] w-full" />
              </div>
            </Reveal>

            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {[
                ['Browser → API', 'JSON over HTTPS with a bearer JWT on every protected route. CORS is locked to the deployed frontend origin.'],
                ['Ingestion workers', 'Parse, chunk, embed and topic-tag each source. Unit-level failures are recorded without failing the whole source.'],
                ['Provider seam', 'One interface supports Gemini-backed answers and an offline fallback for source-based study.'],
              ].map(([t, b]) => (
                <div key={t} className="card p-5">
                  <h3 className="text-sm font-semibold">{t}</h3>
                  <p className="mt-1.5 text-sm text-muted">{b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------- GROUNDING & TRUST ------------------------ */}
        <section id="grounding" className="border-t border-[color:rgb(var(--border))] py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <Reveal>
                <SectionHeading
                  eyebrow="Grounding & trust"
                  title="Trust is a mechanism, not a promise"
                  body="Cited answers stay grounded, and general answers stay clearly separate."
                  align="left"
                />

                <div className="mt-8 space-y-5">
                  <Guard
                    icon={ShieldCheck}
                    title="Cited answers stay grounded; general answers stay separate"
                    body="The tutor checks your uploads first. When they do not cover a question, any general-knowledge response is shown separately with a clear warning and no citations."
                  />
                  <Guard
                    icon={CheckCircle2}
                    title="Citations are audited after the fact"
                    body="Any citation pointing at a unit that was not actually retrieved is stripped before the answer reaches you, and the count of stripped citations is recorded in the evaluation metrics."
                  />
                </div>
              </Reveal>

              {/* Static example card */}
              <Reveal>
                <div className="card overflow-hidden">
                  <div className="flex items-center justify-between border-b border-[color:rgb(var(--border))] bg-[color:rgb(var(--surface))] px-5 py-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Example cited answer
                    </span>
                    <span className="chip bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
                      Fully grounded
                    </span>
                  </div>

                  <div className="p-5">
                    <p className="text-sm font-medium text-muted">Why does the Clock algorithm exist?</p>
                    <div className="mt-3 rounded-xl border-l-4 border-brand-600 bg-brand-50/50 p-4 dark:bg-brand-950/30">
                      <p className="text-sm leading-relaxed">
                        The Clock or Second Chance algorithm approximates LRU by keeping a reference
                        bit on each frame. On eviction the hand clears the reference bit and moves on;
                        only a frame whose bit was already clear is actually evicted.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="chip bg-brand-600 font-mono text-white">Lecture 7 · p.42</span>
                        <span className="chip bg-[color:rgb(var(--surface))] font-mono text-muted">Slides · 12:44</span>
                      </div>
                    </div>

                    <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                      <p className="text-amber-900 dark:text-amber-100">
                        <strong className="font-semibold">General knowledge — not from your uploaded material:</strong>{' '}
                        Questions your uploads do not cover can still get a separate general answer.
                      </p>
                    </div>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ---------------------- ADAPTIVE LEARNING ----------------------- */}
        <section id="adaptive" className="border-t border-[color:rgb(var(--border))] py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <Reveal>
                <div className="card p-6">
                  <h3 className="font-semibold">Illustrative mastery curve</h3>
                  <p className="mt-1 text-xs text-muted">
                    Illustrative values — your real curve is generated from your own answers.
                  </p>
                  <MasteryChart />
                </div>
              </Reveal>

              <Reveal>
                <SectionHeading
                  eyebrow="Adaptive learning"
                  title="It knows what you know — and what you are forgetting"
                  body="A per-topic mastery probability, updated after every answer, decayed over time by a forgetting curve."
                  align="left"
                />
                <div className="mt-8 space-y-4 text-sm text-muted">
                  <p>
                    <strong className="font-semibold text-[color:rgb(var(--fg))]">Bayesian knowledge tracing.</strong>{' '}
                    Each topic is tracked as a probability of being mastered. A correct answer pushes it
                    up, a wrong one pulls it down — but a wrong answer after long success is treated as a
                    slip, not as forgetting everything.
                  </p>
                  <p>
                    <strong className="font-semibold text-[color:rgb(var(--fg))]">Forgetting curve.</strong>{' '}
                    Retention decays exponentially with time. Topics you have not touched resurface on
                    their own in the study plan.
                  </p>
                  <p>
                    <strong className="font-semibold text-[color:rgb(var(--fg))]">Zone of proximal development.</strong>{' '}
                    Quizzes deliberately target topics sitting between 30% and 70% mastery — where
                    practice buys the most learning.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* -------------------------- EVALUATION --------------------------- */}
        <section id="evaluation" className="border-t border-[color:rgb(var(--border))] py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHeading
                eyebrow="System evaluation"
                title="Measured, not asserted"
                body="Scored against a test set where every question has known source locations, plus deliberately off-material queries."
              />
            </Reveal>
            <Reveal>
              <div className="mt-10">
                <EvalTable />
              </div>
            </Reveal>
          </div>
        </section>

        {/* --------------------------- TECH STACK -------------------------- */}
        <section id="stack" className="border-t border-[color:rgb(var(--border))] py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <h2 className="text-center text-sm font-semibold uppercase tracking-wider text-muted">
                Tech stack
              </h2>
            </Reveal>
            <Reveal>
              <div className="mt-8 flex flex-wrap justify-center gap-2.5">
                {TECH.map((t) => (
                  <span key={t} className="chip border border-[color:rgb(var(--border))] bg-[color:rgb(var(--card))] px-3.5 py-1.5 text-sm">
                    {t}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* ----------------------------- FAQ ------------------------------- */}
        <section id="faq" className="border-t border-[color:rgb(var(--border))] py-20 sm:py-24">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <Reveal>
              <SectionHeading eyebrow="FAQ" title="Questions students actually ask" />
            </Reveal>
            <div className="mt-10 space-y-3">
              {FAQ.map((item, i) => (
                <Reveal key={item.q}>
                  <FaqItem {...item} defaultOpen={i === 0} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------- FINAL CTA --------------------------- */}
        <section className="border-t border-[color:rgb(var(--border))] py-20 sm:py-24">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <Reveal>
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                Start studying smarter
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted">
                Upload your first lecture and see a cited answer in under a minute.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/register" className="btn-primary px-7 py-3.5 text-base">
                  Create free account <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href="/login" className="btn-secondary px-7 py-3.5 text-base">
                  Try the demo account
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

/* ------------------------------ pieces ---------------------------------- */

function SectionHeading({
  eyebrow,
  title,
  body,
  align = 'center',
}: {
  eyebrow: string;
  title: string;
  body?: string;
  align?: 'center' | 'left';
}) {
  return (
    <div className={cn(align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl')}>
      <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</span>
      <h2 className="mt-2.5 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-muted">{body}</p>}
    </div>
  );
}

function Guard({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted">{body}</p>
      </div>
    </div>
  );
}

function FaqItem({ q, a, defaultOpen }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium"
      >
        {q}
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <p className="px-5 pb-4 text-sm text-muted">{a}</p>}
    </div>
  );
}

/** Illustrative mastery chart — hand-rolled SVG so it renders with zero JS deps. */
function MasteryChart() {
  const bars = [
    { label: 'Virtual memory', value: 0.86 },
    { label: 'Cache hierarchy', value: 0.74 },
    { label: 'Page faults', value: 0.52 },
    { label: 'Deadlock', value: 0.41 },
    { label: 'Atomics', value: 0.28 },
  ];
  const color = (v: number) =>
    v < 0.4 ? '#ef4444' : v <= 0.7 ? '#f59e0b' : '#22c55e';

  return (
    <div className="mt-6 space-y-3">
      {bars.map((b) => (
        <div key={b.label}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{b.label}</span>
            <span className="font-mono text-muted">{Math.round(b.value * 100)}%</span>
          </div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[color:rgb(var(--surface))]">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${b.value * 100}%`, backgroundColor: color(b.value) }}
            />
          </div>
        </div>
      ))}
      <div className="flex gap-4 pt-2 text-[11px] text-muted">
        <Legend color="#ef4444" label="weak" />
        <Legend color="#f59e0b" label="developing" />
        <Legend color="#22c55e" label="strong" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Live evaluation summary. Reads the latest stored run; never fabricates placeholder numbers.
 */
function HeroEvaluationStats() {
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.evalResults().then((r) => { if (!cancelled && r?.metrics) setMetrics(r.metrics); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!metrics) return <p className="mt-10 border-t border-[color:rgb(var(--border))] pt-6 text-sm text-muted">Evaluation not run yet.</p>;
  const stats = [
    [String(metrics.evaluated ?? 0), 'in-material questions checked'],
    [typeof metrics.citation_accuracy === 'number' ? `${(metrics.citation_accuracy * 100).toFixed(1)}%` : 'Not measured', 'citation accuracy'],
    [String(metrics.off_material_tested ?? 0), 'outside-material checks'],
  ];
  return <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-[color:rgb(var(--border))] pt-6 sm:gap-6">{stats.map(([v, label]) => <div key={label}><dt className="text-xl font-bold text-brand-600 sm:text-2xl">{v}</dt><dd className="mt-0.5 text-xs text-muted">{label}</dd></div>)}</dl>;
}

function EvalTable() {
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'empty'>('loading');

  useEffect(() => {
    let cancelled = false;
    api
      .evalResults()
      .then((r) => {
        if (cancelled) return;
        if (r?.metrics) {
          setMetrics(r.metrics);
          setState('ready');
        } else setState('empty');
      })
      .catch(() => !cancelled && setState('empty'));
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = [
    ['Faithfulness', 'faithfulness', 'Answer claims supported by cited excerpts'],
    ['Answer relevancy', 'answer_relevancy', 'Does the answer address the question asked'],
    ['Context precision', 'context_precision', 'Retrieved units that are actually relevant'],
    ['Context recall', 'context_recall', 'Ground-truth units that were retrieved'],
    ['Citation accuracy', 'citation_accuracy', 'Citations pointing at the correct unit'],
    ['Outside-material detection', 'refusal_accuracy', 'Questions correctly identified as outside your uploaded sources'],
  ];

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:rgb(var(--border))] px-5 py-4">
        <div>
          <h3 className="font-semibold">RAG pipeline metrics</h3>
          <p className="text-xs text-muted">
            {state === 'ready'
              ? 'Latest run — measured against the project test set'
              : state === 'loading'
                ? 'Loading…'
                : 'Evaluation not run yet'}
          </p>
        </div>
        {state === 'ready' && metrics && (
          <span className="chip bg-[color:rgb(var(--surface))] font-mono text-muted">
            {metrics.evaluated ?? 0} in-material · {metrics.off_material_tested ?? 0} off-material
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-[color:rgb(var(--border))] text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Metric</th>
              <th className="px-5 py-3 font-medium">What it measures</th>
              <th className="px-5 py-3 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, key, desc]) => {
              const value = metrics ? metrics[key] : undefined;
              return (
                <tr key={key} className="border-b border-[color:rgb(var(--border))] last:border-0">
                  <td className="px-5 py-3 font-medium">{label}</td>
                  <td className="px-5 py-3 text-muted">{desc}</td>
                  <td className="px-5 py-3 text-right font-mono">
                    {state === 'loading' ? (
                      <span className="text-muted">…</span>
                    ) : typeof value === 'number' ? (
                      <span
                        className={cn(
                          'font-semibold',
                          value >= 0.8 ? 'text-green-600' : value >= 0.5 ? 'text-amber-600' : 'text-red-500'
                        )}
                      >
                        {(value * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-xs text-muted">Evaluation not run yet</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
