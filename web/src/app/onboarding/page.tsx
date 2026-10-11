'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Rocket, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Logo } from '@/components/site-chrome';
import { Button, Alert, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';

const RATING = [
  { v: 1, label: 'Never seen it' },
  { v: 2, label: 'Barely recall' },
  { v: 3, label: 'Somewhat familiar' },
  { v: 4, label: 'Mostly comfortable' },
  { v: 5, label: 'Know it well' },
];

export default function OnboardingPage() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [topics, setTopics] = useState<any[]>([]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [examDate, setExamDate] = useState('');
  const [targetScore, setTargetScore] = useState('');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  useEffect(() => {
    if (!user) return;
    api.topics().then((r) => setTopics(r.flat)).catch(() => {});
  }, [user]);

  const submit = async () => {
    setSaving(true);
    try {
      await api.intake({
        examDate: examDate || null,
        targetScore: targetScore ? Number(targetScore) : null,
        familiarity: ratings,
      });
      router.push('/dashboard');
    } catch (err: any) {
      toast.push('error', err?.message ?? 'Could not save onboarding.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-[color:rgb(var(--border))]">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Logo />
          <Button variant="ghost" onClick={() => router.push('/dashboard')}>Skip for now</Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-8 flex items-center gap-2">
          {[1, 2].map((s) => (
            <div key={s} className={cn('h-1.5 flex-1 rounded-full transition-colors', step >= s ? 'bg-brand-600' : 'bg-[color:rgb(var(--border))]')} />
          ))}
        </div>

        {step === 1 ? (
          <section>
            <Rocket className="h-9 w-9 text-brand-600" aria-hidden />
            <h1 className="mt-4 text-3xl font-bold tracking-tight">How familiar are these topics?</h1>
            <p className="mt-2 text-muted">
              This sets your starting point. Your mastery estimates stay marked <em>low confidence</em> until
              you have actually answered some questions — this is only a head start.
            </p>

            {topics.length === 0 ? (
              <Alert tone="info" title="No topics detected yet">
                You can continue — or head to the knowledge base and upload some material first, which will
                make onboarding far more useful.
              </Alert>
            ) : (
              <ul className="mt-6 space-y-4">
                {topics.map((t) => (
                  <li key={t.id} className="card p-4">
                    <p className="font-medium">{t.name}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {RATING.map((r) => (
                        <button key={r.v} onClick={() => setRatings((s) => ({ ...s, [t.id]: r.v }))}
                          aria-pressed={ratings[t.id] === r.v} title={r.label}
                          className={cn('chip border text-xs',
                            ratings[t.id] === r.v ? 'border-brand-500 bg-brand-600 text-white' : 'border-[color:rgb(var(--border))] hover:bg-[color:rgb(var(--surface))]')}>
                          {r.v}
                        </button>
                      ))}
                    </div>
                    {ratings[t.id] && <p className="mt-1.5 text-xs text-muted">{RATING.find(r => r.v === ratings[t.id])!.label}</p>}
                  </li>
                ))}
              </ul>
            )}

            <Button className="mt-8" onClick={() => setStep(2)}>
              Continue <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </section>
        ) : (
          <section>
            <h1 className="text-3xl font-bold tracking-tight">When is your exam?</h1>
            <p className="mt-2 text-muted">
              Used to weight your study plan by urgency. You can change this any time in settings.
            </p>

            <div className="card mt-6 space-y-4 p-6">
              <div>
                <label className="label" htmlFor="exam">Exam date</label>
                <input id="exam" type="date" className="input max-w-xs" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="target">Target score (%)</label>
                <input id="target" type="number" min={0} max={100} placeholder="85" className="input max-w-[10rem]" value={targetScore} onChange={(e) => setTargetScore(e.target.value)} />
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={submit} loading={saving}>
                <Check className="h-4 w-4" aria-hidden /> Finish setup
              </Button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
