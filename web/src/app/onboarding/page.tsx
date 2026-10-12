'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Rocket, Check, BookOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Logo } from '@/components/site-chrome';
import { Button, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';

const USES = [
  { id: 'exam_prep', label: 'Exam prep' },
  { id: 'lectures', label: 'Understanding lectures' },
  { id: 'quick_revision', label: 'Quick revision' },
  { id: 'homework_help', label: 'Homework help' },
  { id: 'curious', label: 'Just curious' },
] as const;
const LEVELS = [
  { id: 'school', label: 'School' },
  { id: 'undergrad', label: 'Undergrad' },
  { id: 'postgrad', label: 'Postgrad' },
  { id: 'self-learner', label: 'Self-learner' },
] as const;
const RATINGS = [
  { value: 1, label: 'New to me' },
  { value: 2, label: 'A little familiar' },
  { value: 3, label: 'Getting there' },
  { value: 4, label: 'Pretty comfortable' },
  { value: 5, label: 'I’ve got this' },
];

export default function OnboardingPage() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [topics, setTopics] = useState<any[]>([]);
  const [topicsLoaded, setTopicsLoaded] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [primaryUses, setPrimaryUses] = useState<string[]>([]);
  const [studyLevel, setStudyLevel] = useState('self-learner');
  const [answerStyle, setAnswerStyle] = useState<'quick' | 'deep'>('quick');
  const [dailyStudyMinutes, setDailyStudyMinutes] = useState(30);
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [examDate, setExamDate] = useState('');
  const [targetScore, setTargetScore] = useState('');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0); // 0 profile, 1 optional familiarity, 2 optional plan

  useEffect(() => {
    if (ready && !user) router.replace('/login');
    if (ready && user?.prefs?.onboarded === true) router.replace('/dashboard');
  }, [ready, user, router]);

  useEffect(() => {
    if (!user) return;
    const prefs = user.prefs ?? {};
    if (Array.isArray(prefs.primaryUses)) setPrimaryUses(prefs.primaryUses as string[]);
    if (typeof prefs.studyLevel === 'string') setStudyLevel(prefs.studyLevel);
    if (prefs.answerStyle === 'deep') setAnswerStyle('deep');
    if (typeof prefs.dailyStudyMinutes === 'number') setDailyStudyMinutes(prefs.dailyStudyMinutes);
    if (prefs.language === 'hi') setLanguage('hi');
    api.topics().then((r) => setTopics(r.flat)).catch(() => setTopics([])).finally(() => setTopicsLoaded(true));
  }, [user]);

  const saveAndGo = async () => {
    setSaving(true);
    try {
      await api.intake({
        examDate: examDate || null,
        targetScore: targetScore ? Number(targetScore) : null,
        familiarity: ratings,
        primaryUses,
        studyLevel,
        answerStyle,
        dailyStudyMinutes,
        language,
      });
      router.push('/dashboard');
    } catch (err: any) {
      toast.push('error', err?.message ?? 'Could not save your study preferences. Try once more.');
    } finally {
      setSaving(false);
    }
  };

  const nextFromProfile = () => setStep(topics.length > 0 ? 1 : 2);

  return (
    <div className="min-h-screen">
      <header className="border-b border-[color:rgb(var(--border))]">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Logo />
          <Button variant="ghost" onClick={saveAndGo} loading={saving}>Skip for now</Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-12">
        <div className="mb-8 flex items-center gap-2" aria-label={`Step ${step + 1}`}>
          {[0, 1, 2].map((s) => (
            <div key={s} className={cn('h-1.5 flex-1 rounded-full transition-colors', step >= s ? 'bg-brand-600' : 'bg-[color:rgb(var(--border))]')} />
          ))}
        </div>

        {step === 0 ? (
          <section>
            <Rocket className="h-9 w-9 text-brand-600" aria-hidden />
            <h1 className="mt-4 text-3xl font-bold tracking-tight">Let’s make StudyMind yours</h1>
            <p className="mt-2 text-muted">A few quick picks help your study buddy meet you where you are. Skip anything you like.</p>

            <fieldset className="mt-6">
              <legend className="label text-base">What will you mainly use StudyMind for?</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {USES.map((item) => {
                  const selected = primaryUses.includes(item.id);
                  return <button key={item.id} type="button" aria-pressed={selected} onClick={() => setPrimaryUses((prev) => selected ? prev.filter((x) => x !== item.id) : [...prev, item.id])} className={cn('chip border px-3 py-2', selected ? 'border-brand-500 bg-brand-600 text-white' : 'border-[color:rgb(var(--border))] hover:bg-[color:rgb(var(--surface))]')}>{item.label}</button>;
                })}
              </div>
            </fieldset>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="label">Study level</span>
                <select className="input mt-2" value={studyLevel} onChange={(e) => setStudyLevel(e.target.value)}>
                  {LEVELS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Daily study time</span>
                <select className="input mt-2" value={dailyStudyMinutes} onChange={(e) => setDailyStudyMinutes(Number(e.target.value))}>
                  {[15, 30, 45, 60, 90, 120].map((n) => <option key={n} value={n}>{n < 60 ? `${n} minutes` : `${n / 60} hour${n > 60 ? 's' : ''}`}</option>)}
                </select>
              </label>
            </div>

            <fieldset className="mt-6">
              <legend className="label text-base">What feels right?</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {([{ id: 'quick', label: 'Quick bites' }, { id: 'deep', label: 'Deep dives' }] as const).map((x) => (
                  <button key={x.id} type="button" aria-pressed={answerStyle === x.id} onClick={() => setAnswerStyle(x.id)} className={cn('chip border px-4 py-2', answerStyle === x.id ? 'border-brand-500 bg-brand-600 text-white' : 'border-[color:rgb(var(--border))] hover:bg-[color:rgb(var(--surface))]')}>{x.label}</button>
                ))}
              </div>
            </fieldset>

            <label className="mt-6 block max-w-xs">
              <span className="label">Language</span>
              <select className="input mt-2" value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'hi')}>
                <option value="en">English</option><option value="hi">हिन्दी</option>
              </select>
            </label>

            {!topicsLoaded && <p className="mt-4 text-xs text-muted">Checking whether there’s any material to tailor this to…</p>}
            {topicsLoaded && topics.length === 0 && <p className="mt-4 flex items-center gap-1.5 text-xs text-muted"><BookOpen className="h-3.5 w-3.5" aria-hidden />No uploads yet? That’s fine — start chatting, and add material whenever you want cited answers.</p>}
            <Button className="mt-8" onClick={nextFromProfile} disabled={!topicsLoaded}>Continue <ArrowRight className="h-4 w-4" aria-hidden /></Button>
          </section>
        ) : step === 1 && topics.length > 0 ? (
          <section>
            <h1 className="text-3xl font-bold tracking-tight">Any topics you already know?</h1>
            <p className="mt-2 text-muted">This is just a starting guess; practice will make your mastery picture more accurate.</p>
            <ul className="mt-6 space-y-4">
              {topics.map((topic) => (
                <li key={topic.id} className="card p-4">
                  <p className="font-medium">{topic.name}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {RATINGS.map((rating) => <button key={rating.value} type="button" onClick={() => setRatings((prev) => ({ ...prev, [topic.id]: rating.value }))} aria-pressed={ratings[topic.id] === rating.value} title={rating.label} className={cn('chip border text-xs', ratings[topic.id] === rating.value ? 'border-brand-500 bg-brand-600 text-white' : 'border-[color:rgb(var(--border))] hover:bg-[color:rgb(var(--surface))]')}>{rating.value}</button>)}
                  </div>
                  {ratings[topic.id] && <p className="mt-1.5 text-xs text-muted">{RATINGS.find((r) => r.value === ratings[topic.id])?.label}</p>}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setStep(0)}>Back</Button>
              <Button onClick={() => setStep(2)}>Continue <ArrowRight className="h-4 w-4" aria-hidden /></Button>
            </div>
          </section>
        ) : (
          <section>
            <h1 className="text-3xl font-bold tracking-tight">Want to set a target?</h1>
            <p className="mt-2 text-muted">Optional — an exam date and goal can help shape your study plan. You can change them later.</p>
            <div className="card mt-6 space-y-4 p-6">
              <div><label className="label" htmlFor="exam">Exam date</label><input id="exam" type="date" className="input mt-2 max-w-xs" value={examDate} onChange={(e) => setExamDate(e.target.value)} /></div>
              <div><label className="label" htmlFor="target">Target score (%)</label><input id="target" type="number" min={0} max={100} placeholder="85" className="input mt-2 max-w-[10rem]" value={targetScore} onChange={(e) => setTargetScore(e.target.value)} /></div>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              {topics.length > 0 && <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>}
              <Button onClick={saveAndGo} loading={saving}><Check className="h-4 w-4" aria-hidden /> Let’s go</Button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
