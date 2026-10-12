'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Volume2, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { EmptyState, ErrorState, Skeleton, Button } from '@/components/ui';
import { cn } from '@/lib/utils';

export default function RevisionPage() {
  const [topics, setTopics] = useState<any[]>([]);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [rev, setRev] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    api.topics()
      .then((r) => { setTopics(r.flat); if (r.flat[0]) setTopicId(r.flat[0].id); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!topicId) return;
    setLoading(true); setIdx(0); setFlipped(false);
    api.revision(topicId).then(setRev).catch(() => setRev(null)).finally(() => setLoading(false));
  }, [topicId]);

  if (loading && !rev) return <div className="space-y-3">{[0,1,2].map(i => <Skeleton key={i} className="h-20" />)}</div>;
  if (!rev) return <EmptyState icon={<BookOpen className="h-10 w-10" aria-hidden />} title="No revision material yet" description="Upload material first." />;

  const card = rev.flashcards?.[idx];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Revision</h1>
        <p className="mt-1 text-sm text-muted">Flashcards and summaries built from your own material.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {topics.map((t) => (
          <button key={t.id} onClick={() => setTopicId(t.id)}
            className={cn('chip border', topicId === t.id ? 'border-brand-500 bg-brand-600 text-white' : 'border-[color:rgb(var(--border))] hover:bg-[color:rgb(var(--surface))]')}>
            {t.name}
          </button>
        ))}
      </div>

      <section className="card p-6">
        <h2 className="font-semibold">{rev.topic?.name}</h2>

        {card ? (
          <>
            <button
              onClick={() => setFlipped((f) => !f)}
              className="mt-4 flex min-h-[11rem] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[color:rgb(var(--border))] bg-[color:rgb(var(--surface))] p-6 text-center transition-colors hover:border-brand-400"
            >
              {flipped ? (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Answer</p>
                  <p className="mt-2 max-w-lg text-base">{card.back}</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Question</p>
                  <p className="mt-2 max-w-lg text-lg font-semibold">{card.front}</p>
                </>
              )}
            </button>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={idx === 0} onClick={() => { setIdx(i => i-1); setFlipped(false); }}>
                <ChevronLeft className="h-4 w-4" aria-hidden /> Prev
              </Button>
              <Button variant="secondary" disabled={idx >= rev.flashcards.length - 1} onClick={() => { setIdx(i => i+1); setFlipped(false); }}>
                Next <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
              <span className="ml-auto font-mono text-xs text-muted">{idx + 1} / {rev.flashcards.length}</span>
              {card.citation && <span className="chip bg-[color:rgb(var(--surface))] font-mono">{card.citation}</span>}
              <button onClick={() => { const u = new SpeechSynthesisUtterance(card.back); speechSynthesis.speak(u); }}
                      aria-label="Read aloud" className="chip border border-[color:rgb(var(--border))]">
                <Volume2 className="h-3 w-3" aria-hidden />
              </button>
            </div>

            <p className="mt-3 text-xs text-muted">Flip through these source-based prompts at your own pace.</p>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted">No flashcards could be built for this topic.</p>
        )}
      </section>

      {rev.summarySlides?.length > 0 && (
        <section className="card p-5">
          <h2 className="font-semibold">Summary</h2>
          <ul className="mt-3 space-y-2.5">
            {rev.summarySlides.map((s: any) => (
              <li key={s.index} className="flex gap-3 text-sm">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-300">{s.index}</span>
                <span>{s.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
