'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brain, Info, TrendingUp } from 'lucide-react';
import { api, type MasteryRow } from '@/lib/api';
import { ErrorState, Skeleton, Tabs } from '@/components/ui';
import { cn, formatDate } from '@/lib/utils';

export default function MasteryPage() {
  const [rows, setRows] = useState<MasteryRow[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.mastery();
      setRows(r.topics);
      setSummary(r.summary);
      setSelected((cur) => cur ?? r.topics[0]?.topicId ?? null);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (state === 'error') return <ErrorState onRetry={load} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mastery</h1>
        <p className="mt-1 text-sm text-muted">
          Per-topic mastery probability, confidence, and how it moves over time.
        </p>
      </div>

      {state === 'loading' ? (
        <div className="space-y-3">{[0,1,2,3].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : rows.length === 0 ? (
        <p className="card p-8 text-center text-muted">
          No topics to measure yet. Add a source and we’ll start tracking what sticks.
        </p>
      ) : (
        <>
          {summary && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Overall mastery" value={`${summary.overall}%`} />
              <Stat label="Topics tracked" value={summary.total} />
              <Stat label="Topics mastered" value={summary.mastered} tone="text-green-600" />
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-[color:rgb(var(--border))] text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-medium">Topic</th>
                    <th className="px-5 py-3 font-medium">Mastery</th>
                    <th className="px-5 py-3 font-medium">Confidence</th>
                    <th className="px-5 py-3 font-medium">Last reviewed</th>
                    <th className="px-5 py-3 font-medium">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const h = r.history ?? [];
                    return (
                      <tr
                        key={r.topicId}
                        onClick={() => setSelected(r.topicId)}
                        className={cn(
                          'cursor-pointer border-b border-[color:rgb(var(--border))] last:border-0 hover:bg-[color:rgb(var(--surface))]',
                          selected === r.topicId && 'bg-brand-50/50 dark:bg-brand-950/30'
                        )}
                      >
                        <td className="px-5 py-3 font-medium">{r.name}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-28 overflow-hidden rounded-full bg-[color:rgb(var(--surface))]">
                              <div
                                className={cn('h-full rounded-full',
                                  r.band === 'weak' ? 'bg-red-500' : r.band === 'developing' ? 'bg-amber-500' : 'bg-green-500')}
                                style={{ width: `${Math.max(2, r.pLearned * 100)}%` }}
                              />
                            </div>
                            <span className="font-mono text-xs">{Math.round(r.pLearned * 100)}%</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className={cn('chip',
                            r.confidenceLabel === 'high' ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                              : r.confidenceLabel === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>
                            {r.confidenceLabel}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-muted">
                          {r.lastReviewedAt ? `${formatDate(r.lastReviewedAt)} · ${Math.round(r.lastReviewedDaysAgo)}d ago` : 'never'}
                        </td>
                        <td className="px-5 py-3">{h.length > 1 ? <Sparkline values={h.map(x => x.pLearned)} /> : <span className="text-muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selected && <HistoryPanel row={rows.find(r => r.topicId === selected)!} />}
        </>
      )}

      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Brain className="h-4 w-4 text-brand-600" aria-hidden /> How mastery is computed</h2>
        <div className="mt-3 space-y-2.5 text-sm text-muted">
          <p>
            Each topic carries a probability of being mastered. After every answer that probability is
            updated with a standard <strong className="text-[color:rgb(var(--fg))]">Bayesian knowledge tracing</strong> step:
            a correct answer raises it, a wrong one lowers it, and a wrong answer on a topic you usually
            score well on is treated as a <em>slip</em> rather than as forgetting everything.
          </p>
          <p>
            The updated probability is then projected forward with a <strong className="text-[color:rgb(var(--fg))]">transition probability</strong> —
            the chance that practice moves you to the next level of understanding.
          </p>
          <p>
            Separately, a <strong className="text-[color:rgb(var(--fg))]">forgetting curve</strong> decays your retention over
            time as <span className="font-mono text-xs">exp(−days / stability)</span>. That decay is what drives
            your study plan. Confidence stays <em>low</em> until enough attempts accumulate, so the number never
            implies precision we do not have.
          </p>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold', tone)}>{value}</p>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / Math.max(1, values.length - 1)) * 60},${18 - ((v - min) / range) * 16}`)
    .join(' ');
  return (
    <svg viewBox="0 0 60 20" className="h-5 w-16" role="img" aria-label="Mastery trend">
      <polyline points={pts} fill="none" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function HistoryPanel({ row }: { row: MasteryRow }) {
  const h = row.history ?? [];
  if (!h.length) return null;
  const W = 600, H = 160, PAD = 28;
  const path = h
    .map((p, i) => {
      const x = PAD + (i / Math.max(1, h.length - 1)) * (W - PAD * 2);
      const y = H - PAD - p.pLearned * (H - PAD * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <section className="card p-5">
      <h2 className="font-semibold">{row.name} — mastery over time</h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img" aria-label={`${row.name} mastery history`}>
        {[0, 0.5, 1].map(g => (
          <g key={g}>
            <line x1={PAD} x2={W - PAD} y1={H - PAD - g * (H - PAD * 2)} y2={H - PAD - g * (H - PAD * 2)}
                  stroke="rgb(var(--border))" strokeWidth="1" strokeDasharray="4 4" />
            <text x={4} y={H - PAD - g * (H - PAD * 2) + 4} fontSize="9" fill="rgb(var(--muted))">{Math.round(g*100)}%</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {h.map((p, i) => {
          const x = PAD + (i / Math.max(1, h.length - 1)) * (W - PAD * 2);
          const y = H - PAD - p.pLearned * (H - PAD * 2);
          return <circle key={i} cx={x} cy={y} r="2.5" fill="#059669" />;
        })}
      </svg>
      <p className="mt-2 text-xs text-muted">
        {h.length} recorded attempts · retention now {Math.round(row.retention * 100)}% · stability {row.stability.toFixed(2)} days
      </p>
    </section>
  );
}
