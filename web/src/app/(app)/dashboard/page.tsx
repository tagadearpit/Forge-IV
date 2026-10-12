'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  Upload, MessagesSquare, ClipboardList, TrendingUp, Flame, Clock,
  AlertTriangle, CalendarClock, Sparkles,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatRelative } from '@/lib/utils';
import { Button, ErrorState, Skeleton, useToast } from '@/components/ui';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>();
  const toast = useToast();

  const load = useCallback(async () => {
    setState('loading');
    try {
      setData(await api.dashboard());
      setState('ready');
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Could not load your dashboard.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Morning — ready to make something click?' : h < 17 ? 'Afternoon — let’s turn one thing into an aha.' : 'Evening — one small study win?';
  })();

  if (state === 'error') return <ErrorState message={errorMsg} onRetry={load} />;

  if (state === 'loading' || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const k = data.kpis ?? {};
  const mastery: any[] = data.masteryByTopic ?? [];
  const nextUp: any[] = data.nextUp ?? [];
  const activity: any[] = data.recentActivity ?? [];
  const primaryUses: string[] = data.prefs?.primaryUses ?? [];
  const quizAction = primaryUses.includes('exam_prep') ? 'Exam practice' : primaryUses.includes('quick_revision') ? 'Quick revision' : 'Start a quiz';
  const tutorAction = primaryUses.includes('homework_help') ? 'Work through homework' : primaryUses.includes('lectures') ? 'Untangle a lecture' : 'Ask the tutor';
  const dailyStudyMinutes = Number(data.prefs?.dailyStudyMinutes ?? 30);
  const suggestedStep = nextUp[0]?.topicName
    ? `Start with ${nextUp[0].topicName}`
    : primaryUses.includes('exam_prep')
      ? 'Try a short exam-practice set'
      : 'Ask one question to get started';

  const bandColor = (b: string) =>
    b === 'weak' ? 'bg-red-500' : b === 'developing' ? 'bg-amber-500' : 'bg-green-500';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {greeting}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {k.topicsTracked > 0
              ? `Tracking ${k.topicsTracked} topics across ${data.sources?.total ?? 0} sources.`
              : 'Upload your first lecture to get started.'}
          </p>
          <p className="mt-1 text-xs text-muted">Your {dailyStudyMinutes}-minute daily goal · Suggested first step: {suggestedStep}.</p>
        </div>

        {data.daysToExam !== null && data.daysToExam !== undefined && (
          <div className="flex items-center gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 dark:border-brand-800 dark:bg-brand-950/50">
            <CalendarClock className="h-5 w-5 text-brand-600" aria-hidden />
            <div>
              <p className="text-xs text-muted">Exam in</p>
              <p className="text-sm font-bold">
                {data.daysToExam > 0 ? `${data.daysToExam} days` : 'today'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={TrendingUp} label="Overall mastery" value={`${k.overallMastery ?? 0}%`} tone="text-brand-600" />
        <Kpi icon={Sparkles} label="Topics mastered" value={k.topicsMastered ?? 0} suffix={`/ ${k.topicsTracked ?? 0}`} tone="text-green-600" />
        <Kpi icon={ClipboardList} label="Quizzes taken" value={k.quizzesTaken ?? 0} tone="text-purple-600" />
        <Kpi icon={Flame} label="Study streak" value={k.studyStreak ?? 0} suffix=" days" tone="text-orange-600" />
      </div>

      {/* Quick actions */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/knowledge-base" className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-lift">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
            <Upload className="h-5 w-5" aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-semibold">Upload material</span>
            <span className="block text-xs text-muted">PDF, slides, video, audio</span>
          </span>
        </Link>
        <Link href="/tutor" className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-lift">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
            <MessagesSquare className="h-5 w-5" aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-semibold">{tutorAction}</span>
            <span className="block text-xs text-muted">Your style: {data.prefs?.answerStyle === 'deep' ? 'deep dives' : 'quick bites'}</span>
          </span>
        </Link>
        <Link href="/assessments" className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-lift">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
            <ClipboardList className="h-5 w-5" aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-semibold">{quizAction}</span>
            <span className="block text-xs text-muted">A good next step, tuned to you</span>
          </span>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Mastery by topic */}
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Mastery by topic</h2>
            <Link href="/mastery" className="text-sm text-brand-600 hover:underline">
              Details
            </Link>
          </div>

          {mastery.length === 0 ? (
            <p className="mt-6 text-sm text-muted">
              No topics yet — upload material and the topic tree is built automatically.
            </p>
          ) : (
            <div className="mt-5 space-y-3.5">
              {mastery.map((t) => (
                <div key={t.topicId}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{t.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted">
                      {Math.round(t.pLearned * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[color:rgb(var(--surface))]">
                    <div
                      className={cn('h-full rounded-full transition-all', bandColor(t.band))}
                      style={{ width: `${Math.max(2, t.pLearned * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              <div className="flex gap-4 pt-1 text-xs text-muted">
                <Legend color="bg-red-500" label="weak" />
                <Legend color="bg-amber-500" label="developing" />
                <Legend color="bg-green-500" label="strong" />
              </div>
            </div>
          )}
        </section>

        {/* Next best to study */}
        <section className="card p-5">
          <h2 className="font-semibold">Next best to study</h2>
          {nextUp.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              Take a quiz and this will fill with the topics that need attention most.
            </p>
          ) : (
            <ol className="mt-4 space-y-3">
              {nextUp.map((t, i) => (
                <li key={t.topicId} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-red-100 text-xs font-bold text-red-700 dark:bg-red-950 dark:text-red-300">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.topicName}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                      <AlertTriangle className="h-3 w-3 text-amber-500" aria-hidden />
                      {t.reason}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <Link href="/study-plan" className="btn-secondary mt-5 w-full">
            Open study plan
          </Link>
        </section>
      </div>

      {/* Activity */}
      <section className="card p-5">
        <h2 className="font-semibold">Recent activity</h2>
        {activity.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Nothing yet — your activity will show up here.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[color:rgb(var(--border))]">
            {activity.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[color:rgb(var(--surface))] text-muted">
                  <ActivityIcon type={e.type} />
                </span>
                <span className="min-w-0 flex-1 truncate">{describeActivity(e.type)}</span>
                <span className="shrink-0 text-xs text-muted">{formatRelative(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  suffix,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  suffix?: string;
  tone: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
        <Icon className={cn('h-4 w-4', tone)} aria-hidden />
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold">
        {value}
        {suffix && <span className="ml-0.5 text-base font-medium text-muted">{suffix}</span>}
      </p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-2 w-2 rounded-full', color)} aria-hidden />
      {label}
    </span>
  );
}

function ActivityIcon({ type }: { type: string }) {
  if (type === 'quiz_taken') return <ClipboardList className="h-3.5 w-3.5" aria-hidden />;
  if (type === 'question_asked') return <MessagesSquare className="h-3.5 w-3.5" aria-hidden />;
  if (type === 'source_uploaded' || type === 'source_ready') return <Upload className="h-3.5 w-3.5" aria-hidden />;
  return <Clock className="h-3.5 w-3.5" aria-hidden />;
}

function describeActivity(type: string): string {
  switch (type) {
    case 'quiz_taken': return 'Completed an assessment';
    case 'question_asked': return 'Asked the tutor a question';
    case 'source_uploaded': return 'Uploaded a new source';
    case 'source_ready': return 'A source finished indexing';
    case 'revision_reviewed': return 'Reviewed flashcards';
    case 'study_task_done': return 'Completed a study task';
    default: return type.replace(/_/g, ' ');
  }
}