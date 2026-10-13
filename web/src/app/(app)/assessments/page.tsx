'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Play, CheckCircle2, XCircle, Clock, Target, AlertTriangle, Loader2, Trophy, ArrowRight, Download,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button, EmptyState, Alert, useToast, Skeleton } from '@/components/ui';
import { cn, formatRelative } from '@/lib/utils';
import { Markdown } from '@/components/markdown';

type Phase = 'builder' | 'taking' | 'report';

export default function AssessmentsPage() {
  const [phase, setPhase] = useState<Phase>('builder');
  const [mode, setMode] = useState<'quiz' | 'mock'>('quiz');
  const [count, setCount] = useState(6);
  const [types, setTypes] = useState<Array<'mcq' | 'short' | 'numerical'>>(['mcq', 'short', 'numerical']);
  const [history, setHistory] = useState<any[]>([]);
  const [assessment, setAssessment] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [dedupeRelaxed, setDedupeRelaxed] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.assessments().then((r) => setHistory(r.assessments)).catch(() => {});
  }, []);

  const generate = async () => {
    setGenerating(true);
    setDedupeRelaxed(false);
    try {
      const res = await api.createAssessment({ count, types, mode });
      setDedupeRelaxed(Boolean(res.dedupeRelaxed));
      const detail = await api.assessment(res.assessment.id);
      setAssessment(detail);
      setPhase('taking');
    } catch (err: any) {
      toast.push('error', err?.message ?? 'I couldn’t build that quiz just now. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  if (phase === 'taking' && assessment) {
    return (
      <TakingView
        assessment={assessment}
        onFinish={async () => {
          try {
            await api.submit(assessment.assessment.id);
            setReport(await api.report(assessment.assessment.id));
            setPhase('report');
          } catch (err: any) {
            toast.push('error', err?.message ?? 'I couldn’t submit that answer. Please try again.');
          }
        }}
      />
    );
  }

  if (phase === 'report' && report) {
    return <ReportView report={report} onRestart={() => { setPhase('builder'); setAssessment(null); setReport(null); }} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Assessments</h1>
        <p className="mt-1 text-sm text-muted">
          Questions are generated from your material, verified against their source, and never repeated.
        </p>
      </div>

      {dedupeRelaxed && (
        <Alert tone="warning" title="Novelty guard relaxed">
          Your material is nearly exhausted of unused questions, so borderline paraphrases were
          admitted. Exact repeats are still blocked.
        </Alert>
      )}

      <div className="card p-6">
        <h2 className="font-semibold">Build an assessment</h2>

        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <div>
            <span className="label">Mode</span>
            <div className="grid grid-cols-2 gap-2">
              {(['quiz', 'mock'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={cn(
                    'rounded-xl border p-3 text-left text-sm transition-colors',
                    mode === m
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40'
                      : 'border-[color:rgb(var(--border))] hover:bg-[color:rgb(var(--surface))]'
                  )}
                >
                  <span className="block font-semibold capitalize">{m}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {m === 'quiz' ? 'Short untimed set' : 'Longer, timed (30 min)'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="count">
              Number of questions: <span className="font-mono">{count}</span>
            </label>
            <input
              id="count"
              type="range"
              min={3}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="mt-2 w-full accent-brand-600"
            />
          </div>
        </div>

        <div className="mt-5">
          <span className="label">Question types</span>
          <div className="flex flex-wrap gap-2">
            {(['mcq', 'short', 'numerical'] as const).map((t) => {
              const on = types.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => setTypes((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))}
                  aria-pressed={on}
                  disabled={on && types.length === 1}
                  className={cn(
                    'chip border capitalize transition-colors disabled:opacity-40',
                    on
                      ? 'border-brand-500 bg-brand-600 text-white'
                      : 'border-[color:rgb(var(--border))] hover:bg-[color:rgb(var(--surface))]'
                  )}
                >
                  {t === 'mcq' ? 'MCQ' : t === 'short' ? 'Short answer' : 'Numerical'}
                </button>
              );
            })}
          </div>
        </div>

        <Button onClick={generate} loading={generating} className="mt-6">
          <Play className="h-4 w-4" aria-hidden /> Generate assessment
        </Button>
      </div>

      {history.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-[color:rgb(var(--border))] px-5 py-4 font-semibold">Previous attempts</h2>
          <ul className="divide-y divide-[color:rgb(var(--border))]">
            {history.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="chip bg-[color:rgb(var(--surface))] capitalize">{a.mode}</span>
                <span className="capitalize text-muted">{a.status}</span>
                <span className="ml-auto font-mono text-muted">
                  {a.score != null ? `${Math.round(a.score * 100)}%` : '—'}
                </span>
                <span className="text-xs text-muted">{formatRelative(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ----------------------------- taking ---------------------------------- */

function TakingView({
  assessment,
  onFinish,
}: {
  assessment: any;
  onFinish: () => Promise<void>;
}) {
  const questions = assessment.questions ?? [];
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [startedAt] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const timed = assessment.assessment?.mode === 'mock';
  const [remaining, setRemaining] = useState((assessment.assessment?.durationSec ?? 1800));
  const toast = useToast();

  useEffect(() => {
    if (!timed) return;
    const t = setInterval(() => setRemaining((r: number) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [timed]);

  useEffect(() => {
    if (timed && remaining === 0) void onFinish();
  }, [timed, remaining, onFinish]);

  const q = questions[idx];
  if (!q) {
    return (
      <EmptyState
        title="No questions were generated"
        description="Try widening the scope or adding more material."
        action={<Button onClick={() => window.location.reload()}>Back</Button>}
      />
    );
  }

  const answeredCount = Object.keys(answers).length;

  const submit = async () => {
    setSubmitting(true);
    try {
      for (const [questionId, answer] of Object.entries(answers)) {
        await api.answer(assessment.assessment.id, { questionId, answer });
      }
      await onFinish();
    } catch (err: any) {
      toast.push('error', err?.message ?? 'I couldn’t submit that answer. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">
            Question {idx + 1} of {questions.length}
          </span>
          <div className="flex items-center gap-3 text-sm">
            {timed && (
              <span className="chip bg-[color:rgb(var(--surface))] font-mono">
                <Clock className="h-3 w-3" aria-hidden />
                {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
              </span>
            )}
            <span className="text-muted">{answeredCount} answered</span>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[color:rgb(var(--surface))]">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${((idx + 1) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="chip bg-[color:rgb(var(--surface))] uppercase">{q.type}</span>
          <span className="chip bg-[color:rgb(var(--surface))]">
            difficulty {Math.round((q.difficulty ?? 0.5) * 100)}%
          </span>
        </div>

        <Markdown className="mt-4 text-lg font-medium leading-relaxed">{q.text}</Markdown>

        <div className="mt-5">
          {q.type === 'mcq' && q.options && (
            <div className="space-y-2">
              {q.options.map((o: string) => (
                <label
                  key={o}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-sm transition-colors',
                    answers[q.id] === o
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40'
                      : 'border-[color:rgb(var(--border))] hover:bg-[color:rgb(var(--surface))]'
                  )}
                >
                  <input
                    type="radio"
                    name={q.id}
                    value={o}
                    checked={answers[q.id] === o}
                    onChange={() => setAnswers((a) => ({ ...a, [q.id]: o }))}
                    className="mt-0.5 h-4 w-4 accent-brand-600"
                  />
                  {o}
                </label>
              ))}
            </div>
          )}

          {q.type === 'short' && (
            <textarea
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              rows={4}
              placeholder="Answer in your own words…"
              className="input resize-y"
            />
          )}

          {q.type === 'numerical' && (
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                placeholder="0"
                className="input max-w-[12rem]"
              />
              {q.units && <span className="font-mono text-sm text-muted">{q.units}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="secondary" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}>
          Previous
        </Button>
        {idx < questions.length - 1 ? (
          <Button onClick={() => setIdx((i) => i + 1)}>
            Next <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        ) : (
          <Button onClick={submit} loading={submitting}>
            Finish this quiz
          </Button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- report ---------------------------------- */

function ReportView({ report, onRestart }: { report: any; onRestart: () => void }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      const details = [`Score: ${Math.round((report.score ?? 0) * 100)}%`, `Correct: ${report.correct} of ${report.total}`, `Weak topics: ${(report.weakTopics ?? []).join(', ') || 'None'}`, `Topic breakdown: ${(report.topicBreakdown ?? []).map((t: any) => `${t.topicName}: ${t.correct}/${t.total}`).join('; ') || 'Not available'}`, `Likely misconceptions: ${(report.misconceptions ?? []).map((m: any) => `${m.label} (${m.count})`).join('; ') || 'None'}`].join('\n');
      const blob = await api.generatePdf({ prompt: `STUDYMIND_EXPORT:Quiz report\n${details}` });
      const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = 'studymind-quiz-report.pdf'; a.click(); URL.revokeObjectURL(href);
    } finally { setPdfBusy(false); }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="card p-8 text-center">
        <Trophy className="mx-auto h-10 w-10 text-amber-500" aria-hidden />
        <p className="mt-3 text-4xl font-bold">{Math.round((report.score ?? 0) * 100)}%</p>
        <p className="mt-1 text-muted">
          {report.correct} of {report.total} correct
        </p>
      </div>

      {report.weakTopics?.length > 0 && (
        <Alert tone="warning" title="Topics that need work">
          <div className="mt-1 flex flex-wrap gap-1.5">
            {report.weakTopics.map((t: string) => (
              <span key={t} className="chip bg-white/60 dark:bg-black/20">{t}</span>
            ))}
          </div>
        </Alert>
      )}

      <section className="card p-5">
        <h2 className="font-semibold">Score by topic</h2>
        {report.topicBreakdown?.length ? (
          <ul className="mt-4 space-y-3">
            {report.topicBreakdown.map((t: any) => (
              <li key={t.topicId}>
                <div className="flex justify-between text-sm">
                  <span>{t.topicName}</span>
                  <span className="font-mono text-muted">
                    {t.correct}/{t.total}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[color:rgb(var(--surface))]">
                  <div
                    className={cn('h-full rounded-full', t.score >= 0.7 ? 'bg-green-500' : t.score >= 0.4 ? 'bg-amber-500' : 'bg-red-500')}
                    style={{ width: `${Math.max(2, t.score * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">No topic breakdown available.</p>
        )}
      </section>

      {report.misconceptions?.length > 0 && (
        <section className="card p-5">
          <h2 className="font-semibold">Likely misconceptions</h2>
          <ul className="mt-3 space-y-2">
            {report.misconceptions.map((m: any) => (
              <li key={m.label} className="flex items-center gap-2.5 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                <span>{m.label}</span>
                <span className="ml-auto font-mono text-xs text-muted">×{m.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.timePerQuestion?.length > 0 && (
        <section className="card p-5">
          <h2 className="font-semibold">Time per question</h2>
          <div className="mt-4 flex items-end gap-1.5" style={{ height: 96 }}>
            {report.timePerQuestion.map((t: any, i: number) => {
              const max = Math.max(...report.timePerQuestion.map((x: any) => x.timeSpentSec ?? 0), 1);
              return (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className={cn('w-full rounded-t', t.correct ? 'bg-green-400' : 'bg-red-400')}
                    style={{ height: `${Math.max(4, ((t.timeSpentSec ?? 0) / max) * 70)}px` }}
                    title={`${t.timeSpentSec}s · ${t.correct ? 'correct' : 'incorrect'}`}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => void exportPdf()} loading={pdfBusy}>
          <Download className="h-4 w-4" aria-hidden /> Download as PDF
        </Button>
        <Button onClick={onRestart}>Take another</Button>
        <Button variant="secondary" onClick={() => (window.location.href = '/study-plan')}>
          Schedule revision
        </Button>
      </div>
    </div>
  );
}