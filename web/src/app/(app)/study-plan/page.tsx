'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, RefreshCw, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, EmptyState, ErrorState, Skeleton, useToast } from '@/components/ui';
import { cn, formatDate } from '@/lib/utils';

const KIND_STYLE: Record<string, string> = {
  learn: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  review: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  quiz: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
};

export default function StudyPlanPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [state, setState] = useState<'loading'|'ready'|'error'>('loading');
  const toast = useToast();

  const load = useCallback(async () => {
    setState('loading');
    try { setTasks((await api.studyPlan()).tasks); setState('ready'); }
    catch { setState('error'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (state === 'error') return <ErrorState onRetry={load} />;
  if (state === 'loading') return <div className="space-y-3">{[0,1,2].map(i => <Skeleton key={i} className="h-16" />)}</div>;

  const byDate = tasks.reduce<Record<string, any[]>>((acc, t) => {
    (acc[t.date] ??= []).push(t); return acc;
  }, {});
  const dates = Object.keys(byDate).sort();

  const complete = async (task: any) => {
    try {
      await api.completeTask(task.id);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: true } : t)));
    } catch (err: any) { toast.push('error', err?.message ?? 'Could not update task.'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Study plan</h1>
          <p className="mt-1 text-sm text-muted">Built from weak topics, forgetting-curve decay and time to exam.</p>
        </div>
        <Button variant="secondary" onClick={load}><RefreshCw className="h-4 w-4" aria-hidden /> Regenerate</Button>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-10 w-10" aria-hidden />}
          title="No plan yet"
          description="Upload material and take a diagnostic quiz — then your plan appears here."
          action={<Button onClick={() => (window.location.href='/assessments')}>Take a quiz</Button>}
        />
      ) : (
        <div className="space-y-6">
          {dates.map((d) => (
            <section key={d}>
              <h2 className="mb-2.5 text-sm font-semibold text-muted">{formatDate(d)}</h2>
              <ul className="space-y-2">
                {byDate[d].map((t) => (
                  <li key={t.id} className={cn('card flex items-start gap-3 p-4', t.done && 'opacity-55')}>
                    <button
                      onClick={() => !t.done && complete(t)}
                      disabled={t.done}
                      aria-label={t.done ? 'Completed' : `Mark ${t.title} complete`}
                      className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors',
                        t.done ? 'border-green-500 bg-green-500 text-white' : 'border-[color:rgb(var(--border))] hover:border-brand-500')}
                    >
                      {t.done && <Check className="h-3 w-3" aria-hidden />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('chip capitalize', KIND_STYLE[t.kind])}>{t.kind}</span>
                        <span className="font-medium">{t.title}</span>
                        <span className="ml-auto text-xs text-muted">{t.estimatedMin} min</span>
                      </div>
                      <p className="mt-1 text-sm text-muted">{t.rationale}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
