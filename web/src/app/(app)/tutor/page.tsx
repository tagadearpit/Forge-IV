'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send, BookOpen, AlertTriangle, Mic, Volume2, Globe, Sparkles, Loader2, ExternalLink,
} from 'lucide-react';
import { api, type Citation, type TutorAnswer } from '@/lib/api';
import { useToast, Button } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  result?: TutorAnswer;
}

const SUGGESTIONS = [
  'What problem does the Clock replacement algorithm solve?',
  'Why do large cache lines hurt random pointer chasing?',
  'What are the four conditions required for deadlock?',
  'What is the mass of a proton?',
];

export default function TutorPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [scope, setScope] = useState<{ label: string; sourceIds?: string[]; topicIds?: string[] }>({ label: 'All sources' });
  const [sources, setSources] = useState<any[]>([]);
  const [asking, setAsking] = useState(false);
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);
  const toast = useToast();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.sources().then((r) => setSources(r.sources.filter((s) => s.status === 'ready'))).catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, asking]);

  const ask = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || asking) return;
      setQuestion('');
      setAsking(true);

      const userMsg: Message = { id: `u${Date.now()}`, role: 'user', content: q };
      setMessages((m) => [...m, userMsg]);

      try {
        const result = await api.ask({
          question: q,
          language,
          scope: {
            ...(scope.sourceIds ? { sourceIds: scope.sourceIds } : {}),
            ...(scope.topicIds ? { topicIds: scope.topicIds } : {}),
          },
        });
        setMessages((m) => [
          ...m,
          { id: `a${Date.now()}`, role: 'assistant', content: result.answer, result },
        ]);
      } catch (err: any) {
        toast.push('error', err?.message ?? 'Could not reach the tutor.');
        setMessages((m) => [
          ...m,
          {
            id: `e${Date.now()}`,
            role: 'assistant',
            content:
              'Something went wrong reaching the tutor. Your question was not lost — try again in a moment.',
          },
        ]);
      } finally {
        setAsking(false);
      }
    },
    [asking, language, scope, toast]
  );

  const speak = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast.push('info', 'Read-aloud is not supported in this browser.');
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(u);
  };

  const groundBadge = (s: TutorAnswer['groundingStatus']) => {
    if (s === 'full')
      return { cls: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300', label: 'Fully grounded' };
    if (s === 'partial')
      return { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300', label: 'Partially grounded' };
    return { cls: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300', label: 'Outside material' };
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold tracking-tight">Tutor</h1>

        {/* Scope selector */}
        <label className="sr-only" htmlFor="scope">Scope</label>
        <select
          id="scope"
          value={scope.label}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'All sources') setScope({ label: v });
            else if (v.startsWith('source:')) {
              const id = v.slice(7);
              setScope({ label: v, sourceIds: [id] });
            } else {
              const id = v.slice(6);
              setScope({ label: v, topicIds: [id] });
            }
          }}
          className="input w-auto py-1.5 text-sm"
        >
          <option value="All sources">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={`source:${s.id}`}>
              Source: {s.title}
            </option>
          ))}
        </select>

        {/* Language toggle */}
        <div className="flex overflow-hidden rounded-xl border border-[color:rgb(var(--border))]">
          {(['en', 'hi'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLanguage(l)}
              aria-pressed={language === l}
              className={cn(
                'px-3 py-1.5 text-sm font-medium transition-colors',
                language === l ? 'bg-brand-600 text-white' : 'hover:bg-[color:rgb(var(--surface))]'
              )}
            >
              {l === 'en' ? 'English' : 'हिन्दी'}
            </button>
          ))}
        </div>
      </div>

      {/* Transcript */}
      <div className="flex-1 space-y-5 overflow-y-auto rounded-2xl border border-[color:rgb(var(--border))] bg-[color:rgb(var(--card))] p-5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center py-10 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
              <Sparkles className="h-6 w-6" aria-hidden />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Ask anything from your material</h2>
            <p className="mt-1.5 max-w-md text-sm text-muted">
              Answers cite the exact page, slide or timestamp. Questions your sources do not cover
              get declined rather than guessed.
            </p>
            <div className="mt-6 flex max-w-lg flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="chip border border-[color:rgb(var(--border))] hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="max-w-3xl">
              {!m.result ? (
                <p className="text-sm text-muted">{m.content}</p>
              ) : (
                <AnswerBlock result={m.result} onCitation={setOpenCitation} onSpeak={speak} />
              )}
            </div>
          )
        )}

        {asking && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Searching your material…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="mt-3 flex items-end gap-2"
      >
        <label className="sr-only" htmlFor="question">Your question</label>
        <textarea
          id="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
          rows={1}
          placeholder="Ask a question about your material…"
          className="input max-h-32 min-h-[2.75rem] flex-1 resize-y py-3"
        />
        <button
          type="button"
          aria-label="Voice input"
          onClick={() => toast.push('info', 'Voice input uses the browser Web Speech API — use Chrome or Edge for best support.')}
          className="btn-secondary px-3"
        >
          <Mic className="h-4 w-4" aria-hidden />
        </button>
        <Button type="submit" loading={asking} disabled={!question.trim()} aria-label="Send question">
          <Send className="h-4 w-4" aria-hidden />
        </Button>
      </form>

      {/* Citation side panel */}
      {openCitation && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpenCitation(null)} aria-hidden />
          <aside
            role="dialog"
            aria-label="Citation source"
            className="relative h-full w-full max-w-md overflow-y-auto border-l border-[color:rgb(var(--border))] bg-[color:rgb(var(--card))] p-6 shadow-lift"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Cited source</p>
                <h2 className="mt-1 text-lg font-semibold">{openCitation.sourceTitle}</h2>
                <p className="mt-1 font-mono text-xs text-brand-600">{openCitation.label}</p>
              </div>
              <button onClick={() => setOpenCitation(null)} className="btn-ghost px-2" aria-label="Close">
                ×
              </button>
            </div>

            <div className="mt-5 rounded-xl border border-[color:rgb(var(--border))] bg-[color:rgb(var(--surface))] p-4">
              <p className="text-sm leading-relaxed">{openCitation.excerpt}</p>
            </div>

            <dl className="mt-5 space-y-2 text-sm">
              {openCitation.location?.page != null && (
                <Row label="Page" value={String(openCitation.location.page)} />
              )}
              {openCitation.location?.slide != null && (
                <Row label="Slide" value={String(openCitation.location.slide)} />
              )}
              {openCitation.location?.startSec != null && (
                <Row label="Timestamp" value={`${Math.floor(openCitation.location.startSec / 60)}:${String(Math.floor(openCitation.location.startSec % 60)).padStart(2, '0')}`} />
              )}
              <Row label="Unit ID" value={openCitation.unitId} mono />
            </dl>

            <a
              href={`/knowledge-base?source=${openCitation.sourceId}&unit=${openCitation.unitId}`}
              className="btn-secondary mt-6 w-full"
            >
              <ExternalLink className="h-4 w-4" aria-hidden /> Open in knowledge base
            </a>
          </aside>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[color:rgb(var(--border))] pb-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className={cn('text-right font-medium', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  );
}

function AnswerBlock({
  result,
  onCitation,
  onSpeak,
}: {
  result: TutorAnswer;
  onCitation: (c: Citation) => void;
  onSpeak: (text: string) => void;
}) {
  const outside = result.groundingStatus === 'outside_material';

  const badge =
    result.groundingStatus === 'full'
      ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
      : result.groundingStatus === 'partial'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300';

  const label =
    result.groundingStatus === 'full'
      ? 'Fully grounded'
      : result.groundingStatus === 'partial'
        ? 'Partially grounded'
        : 'Outside material';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('chip', badge)}>{label}</span>
        {result.audit.stripped > 0 && (
          <span
            className="chip bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
            title="Citations that referenced a unit not actually retrieved were removed before display."
          >
            {result.audit.stripped} unverified citation{result.audit.stripped > 1 ? 's' : ''} removed
          </span>
        )}
        <button
          onClick={() => onSpeak(result.answer)}
          aria-label="Read answer aloud"
          className="chip border border-[color:rgb(var(--border))] hover:bg-[color:rgb(var(--surface))]"
        >
          <Volume2 className="h-3 w-3" aria-hidden /> Read aloud
        </button>
      </div>

      {/* Grounded / outside split */}
      {outside ? (
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Not covered by your material
          </p>
          <p className="text-sm leading-relaxed">{result.answer}</p>
        </div>
      ) : (
        <div className="rounded-xl border-l-4 border-brand-600 bg-brand-50/50 p-4 dark:bg-brand-950/30">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            From your material
          </p>
          <div className="space-y-3 text-sm leading-relaxed">
            {result.answer.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>

          {result.citations.length > 0 && (
            <div className="mt-3.5 flex flex-wrap gap-2">
              {result.citations.map((c) => (
                <button
                  key={c.unitId}
                  onClick={() => onCitation(c)}
                  className="chip bg-brand-600 font-mono text-white hover:bg-brand-700"
                  title={c.excerpt}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {result.outsideKnowledge && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            General knowledge (not in your sources)
          </p>
          <p className="text-sm text-amber-900 dark:text-amber-100">{result.outsideKnowledge}</p>
        </div>
      )}

      <p className="font-mono text-[11px] text-muted">
        retrieval top-1 {result.topSimilarity?.toFixed?.(3)} · question coverage{' '}
        {result.lexicalOverlap?.toFixed?.(2)} · {result.citations.length} citation
        {result.citations.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}