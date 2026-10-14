'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Send, BookOpen, AlertTriangle, Mic, Volume2, Globe, Sparkles, Loader2, ExternalLink, Download,
} from 'lucide-react';
import { api, type Citation, type TutorAnswer } from '@/lib/api';
import { useToast, Button } from '@/components/ui';
import { Markdown } from '@/components/markdown';
import { cn } from '@/lib/utils';
import { SourceViewer } from '@/components/source-viewer';
import { useAuth } from '@/lib/auth';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  result?: TutorAnswer;
}

const SOURCE_SUGGESTIONS = [
  'What problem does the Clock replacement algorithm solve?',
  'Why do large cache lines hurt random pointer chasing?',
  'What are the four conditions required for deadlock?',
  'What is the mass of a proton?',
];
const GENERAL_SUGGESTIONS = [
  'Why is the sky blue?',
  'How do I build a study habit that sticks?',
  'Explain photosynthesis in simple terms.',
];

/** Minimal shape of the Web Speech API we use; kept local so TS does not need
 *  DOM lib types that vary between TS versions. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function TutorPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Array<{ id: string; title: string }>>([]);
  const [question, setQuestion] = useState('');
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  useEffect(() => { if (user?.prefs?.language === 'hi') setLanguage('hi'); }, [user]);
  const [scope, setScope] = useState<{ label: string; sourceIds?: string[]; topicIds?: string[]; sectionTitle?: string }>({ label: 'All sources' });
  const [sources, setSources] = useState<any[]>([]);
  const [asking, setAsking] = useState(false);
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);
  const toast = useToast();
  const endRef = useRef<HTMLDivElement>(null);

  // ---- voice input (Web Speech API) ----
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setInterim('');
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      toast.push(
        'info',
        'Voice input is not supported in this browser. Chrome or Edge support SpeechRecognition; Firefox does not.'
      );
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
      rec.interimResults = true;
      rec.continuous = false;

      rec.onresult = (e: any) => {
        let finalText = '';
        let interimText = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const t = r[0]?.transcript ?? '';
          if (r.isFinal) finalText += t;
          else interimText += t;
        }
        setInterim(interimText);
        if (finalText) {
          setQuestion((prev) => (prev ? `${prev} ${finalText}` : finalText).trim());
          setInterim('');
        }
      };
      rec.onerror = (e: any) => {
        setListening(false);
        setInterim('');
        const code = e?.error ?? 'unknown';
        const msg =
          code === 'not-allowed'
            ? 'Microphone permission was denied. Enable it in your browser settings to use voice input.'
            : code === 'no-speech'
              ? 'No speech was detected. Try again.'
              : `Voice input failed (${code}).`;
        toast.push('warning', msg);
      };
      rec.onend = () => {
        setListening(false);
        setInterim('');
        recognitionRef.current = null;
      };

      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch (err: any) {
      setListening(false);
      toast.push('error', `Could not start voice input: ${err?.message ?? 'unknown error'}`);
    }
  }, [language, toast]);

  // Stop recognition if the component unmounts mid-session.
  useEffect(() => () => recognitionRef.current?.abort(), []);

  useEffect(() => {
    api.sources().then((r) => setSources(r.sources)).catch(() => {});
    api.chatHistory().then(async ({ threads: rows }) => {
      setThreads(rows);
      const latest = rows[0];
      if (!latest) return;
      const data = await api.chatThread(latest.id);
      setThreadId(latest.id);
      const sc = data.thread?.scope ?? {};
      const sourceIds = (sc.sourceIds ?? []).map(String);
      const topicIds = (sc.topicIds ?? []).map(String);
      setScope(sourceIds.length ? { label: `source:${sourceIds[0]}`, sourceIds, sectionTitle: sc.sectionTitle ?? undefined } : topicIds.length ? { label: `topic:${topicIds[0]}`, topicIds } : { label: 'All sources' });
      setMessages((data.messages ?? []).map((m: any) => ({
        id: m.id, role: m.role, content: m.content,
        ...(m.role === 'assistant' ? { result: { answer: m.content, citations: m.citations ?? [], groundingStatus: m.groundingStatus ?? 'partial', outsideKnowledge: m.outsideKnowledge ?? null, language: 'en', topSimilarity: 0, lexicalOverlap: 0, audit: { citedRequested: 0, citedVerified: 0, stripped: 0, declined: false }, unsearchableCount: 0, usingSource: null, messageId: m.id } as TutorAnswer } : {}),
      })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, asking]);

  useEffect(() => {
    if (!scope.sectionTitle || !scope.sourceIds?.[0] || !scope.label.startsWith('source:')) return;
    const src = sources.find((s) => s.id === scope.sourceIds![0]);
    const index = src?.outline?.findIndex((e: any) => e.title === scope.sectionTitle) ?? -1;
    if (index >= 0) setScope((current) => ({ ...current, label: `section:${scope.sourceIds![0]}:${index}` }));
  }, [sources, scope.sectionTitle, scope.sourceIds, scope.label]);

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
          ...(threadId ? { threadId } : {}),
          language,
          ...((scope.sourceIds || scope.topicIds || scope.sectionTitle || threadId) ? { scope: {
            ...(scope.sourceIds ? { sourceIds: scope.sourceIds } : {}),
            ...(scope.topicIds ? { topicIds: scope.topicIds } : {}),
            ...(scope.sectionTitle ? { sectionTitle: scope.sectionTitle } : {}),
          } } : {}),
        });
        if (result.threadId) setThreadId(result.threadId);
        if (result.threadId && !threads.some((t) => t.id === result.threadId)) setThreads((t) => [{ id: result.threadId!, title: q.slice(0, 80) }, ...t]);
        setMessages((m) => [
          ...m,
          { id: result.messageId ?? `a${Date.now()}`, role: 'assistant', content: result.answer || result.outsideKnowledge || '', result },
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
    [asking, language, scope, toast, threadId, threads]
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
    <div className="flex h-[calc(100vh-8rem)] gap-3">
      <aside className="hidden w-56 shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-[color:rgb(var(--border))] bg-[color:rgb(var(--card))] p-3 md:flex">
        <button type="button" className="btn-secondary w-full px-3 py-2 text-sm" onClick={() => { setThreadId(null); setMessages([]); setScope({ label: 'All sources' }); }}>New chat</button>
        <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent chats</h2>
        {threads.map((t) => <button key={t.id} type="button" className={cn('w-full truncate rounded-lg px-3 py-2 text-left text-sm', threadId === t.id ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300' : 'hover:bg-[color:rgb(var(--surface))]')} onClick={async () => { try { const data = await api.chatThread(t.id); setThreadId(t.id); const sc = data.thread?.scope ?? {}; const sourceIds = (sc.sourceIds ?? []).map(String); const topicIds = (sc.topicIds ?? []).map(String); setScope(sourceIds.length ? { label: `source:${sourceIds[0]}`, sourceIds, sectionTitle: sc.sectionTitle ?? undefined } : topicIds.length ? { label: `topic:${topicIds[0]}`, topicIds } : { label: 'All sources' }); setMessages((data.messages ?? []).map((m: any) => ({ id: m.id, role: m.role, content: m.content, ...(m.role === 'assistant' ? { result: { answer: m.content, citations: m.citations ?? [], groundingStatus: m.groundingStatus ?? 'partial', outsideKnowledge: m.outsideKnowledge ?? null, language: 'en', topSimilarity: 0, lexicalOverlap: 0, audit: { citedRequested: 0, citedVerified: 0, stripped: 0, declined: false }, unsearchableCount: 0, usingSource: null, messageId: m.id } as TutorAnswer } : {}) }))); } catch {} }}>{t.title}</button>)}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold tracking-tight">Tutor</h1>
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm md:hidden" onClick={() => { setThreadId(null); setMessages([]); setScope({ label: 'All sources' }); }}>New chat</button>
        {/* Scope selector */}
        <label className="sr-only" htmlFor="scope">Scope</label>
        <select
          id="scope"
          value={scope.label}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'All sources') setScope({ label: v });
            else if (v.startsWith('section:')) {
              const [, id, index] = v.split(':');
              const src = sources.find((item) => item.id === id);
              const sectionTitle = src?.outline?.[Number(index)]?.title;
              setScope({ label: v, sourceIds: [id], sectionTitle });
            } else if (v.startsWith('source:')) {
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
            <option key={s.id} value={`source:${s.id}`} disabled={s.status !== 'ready'}>
              {s.title} · {s.status}{s.embeddingStatus === 'pending' ? ' · embeddings pending' : ''}
            </option>
          ))}
          {sources.filter((s) => s.status === 'ready').flatMap((s) => (s.outline ?? []).map((entry: any, i: number) => (
            <option key={`${s.id}-section-${i}`} value={`section:${s.id}:${i}`}>Section: {s.title} · {entry.title}</option>
          )))}
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
      {scope.sourceIds?.length === 1 && (() => { const selected = sources.find((s) => s.id === scope.sourceIds![0]); return selected ? <div className="mb-2 flex flex-wrap gap-2 text-xs"><span className="chip bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">Using: {selected.title}</span>{selected.unitCount === 0 && <span className="chip bg-amber-100 text-amber-800">This selected source has zero indexed units.</span>}{selected.embeddingStatus === 'pending' && <span className="chip bg-amber-100 text-amber-800">Some parts may not be searchable yet.</span>}</div> : null; })()}
      {/* Transcript */}
      <div className="flex-1 space-y-5 overflow-y-auto rounded-2xl border border-[color:rgb(var(--border))] bg-[color:rgb(var(--card))] p-5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center py-10 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
              <Sparkles className="h-6 w-6" aria-hidden />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Your study buddy is ready</h2>
            <p className="mt-1.5 max-w-md text-sm text-muted">
              Ask anything. Answers from your uploads come with citations; general-knowledge answers get their own clearly labelled block. Upload material for more cited answers.
            </p>
            {sources.length === 0 && <p className="mt-2 max-w-md text-xs text-muted">No uploads yet? You can still chat. <Link href="/knowledge-base" className="font-semibold text-brand-700 underline dark:text-brand-300">Upload material to get cited answers.</Link></p>}
            <div className="mt-6 flex max-w-lg flex-wrap justify-center gap-2">
              {(sources.length === 0 ? GENERAL_SUGGESTIONS : SOURCE_SUGGESTIONS).map((s) => (
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
                <AnswerBlock result={m.result} threadId={threadId ?? undefined} onCitation={setOpenCitation} onSpeak={speak} />
              )}
            </div>
          )
        )}

        {asking && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Checking your uploads — then I’ll help from there…
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
          placeholder="Ask about your notes — or anything you’re curious about…"
          className="input max-h-32 min-h-[2.75rem] flex-1 resize-y py-3"
        />
        <button
          type="button"
          aria-label={listening ? 'Stop voice input' : 'Start voice input'}
          aria-pressed={listening}
          onClick={() => (listening ? stopListening() : startListening())}
          className={cn('btn-secondary px-3', listening && 'border-red-400 text-red-600')}
        >
          <Mic className={cn('h-4 w-4', listening && 'animate-pulse')} aria-hidden />
        </button>
        <Button type="submit" loading={asking} disabled={!question.trim()} aria-label="Send question">
          <Send className="h-4 w-4" aria-hidden />
        </Button>
        {interim && (
          <p className="mt-2 text-sm text-muted" aria-live="polite">
            <span className="font-medium">Listening…</span> {interim}
          </p>
        )}
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

            {/* FIX 3: the citation panel now shows the ACTUAL source at the
                cited location, not only a text excerpt. */}
            <div className="mt-5">
              <SourceViewer
                key={`${openCitation.unitId}-${openCitation.location?.page ?? openCitation.location?.slide ?? openCitation.location?.startSec ?? 'x'}`}
                source={{
                  id: openCitation.sourceId,
                  type: openCitation.sourceTitle && /\.(mp4|mp3)/i.test(openCitation.sourceTitle) ? 'video' : 'pdf',
                  title: openCitation.sourceTitle,
                }}
                location={openCitation.location}
              />
            </div>

            <div className="mt-4 rounded-xl border border-[color:rgb(var(--border))] bg-[color:rgb(var(--surface))] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Cited excerpt</p>
              <p className="mt-1.5 text-sm leading-relaxed">{openCitation.excerpt}</p>
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
  threadId,
  onCitation,
  onSpeak,
}: {
  result: TutorAnswer;
  threadId?: string;
  onCitation: (c: Citation) => void;
  onSpeak: (text: string) => void;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const downloadPdf = async () => {
    setPdfBusy(true); setPdfError('');
    try {
      const blob = await api.generatePdf(result.messageId ? { messageId: result.messageId } : threadId ? { threadId } : { prompt: result.answer });
      const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = 'studymind-tutor-report.pdf'; a.click(); URL.revokeObjectURL(href);
    } catch { setPdfError('PDF download failed. Please try again.'); } finally { setPdfBusy(false); }
  };
  const outside = result.groundingStatus === 'outside_material';

  const badge =
    result.groundingStatus === 'full'
      ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
      : result.groundingStatus === 'partial'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';

  const label =
    result.groundingStatus === 'full'
      ? 'Fully grounded'
      : result.groundingStatus === 'partial'
        ? 'Partially grounded'
        : result.outsideKnowledge ? 'General knowledge — not from your uploaded material' : 'Offline source-only mode';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('chip', badge)}>{label}</span>
        {result.usingSource && <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">Using: {result.usingSource.title}</span>}
        {result.unsearchableCount ? <span className="chip bg-amber-100 text-amber-800">{result.unsearchableCount} parts of this document aren’t searchable yet</span> : null}
        {result.audit.stripped > 0 && (
          <span
            className="chip bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
            title="Citations that referenced a unit not actually retrieved were removed before display."
          >
            {result.audit.stripped} unverified citation{result.audit.stripped > 1 ? 's' : ''} removed
          </span>
        )}
        <button
          onClick={() => onSpeak(result.outsideKnowledge || result.answer)}
          aria-label="Read answer aloud"
          className="chip border border-[color:rgb(var(--border))] hover:bg-[color:rgb(var(--surface))]"
        >
          <Volume2 className="h-3 w-3" aria-hidden /> Read aloud
        </button>
        <button type="button" onClick={() => void downloadPdf()} disabled={pdfBusy} className="chip border border-[color:rgb(var(--border))] hover:bg-[color:rgb(var(--surface))]" aria-label="Download answer as PDF">
          <Download className="h-3 w-3" aria-hidden /> {pdfBusy ? 'Preparing PDF…' : 'Download as PDF'}
        </button>
      </div>
      {pdfError && <p role="alert" className="text-xs text-red-600">{pdfError}</p>}

      {/* Grounded / outside split */}
      {outside ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {result.outsideKnowledge ? 'General knowledge — not from your uploaded material' : 'General answers need online mode'}
          </p>
          <Markdown className="text-sm text-amber-950 dark:text-amber-100">{result.outsideKnowledge || result.answer}</Markdown>
        </div>
      ) : (
        <div className="rounded-xl border-l-4 border-brand-600 bg-brand-50/50 p-4 dark:bg-brand-950/30">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            From your material
          </p>
          <Markdown className="text-sm">{result.answer}</Markdown>

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


      <p className="font-mono text-[11px] text-muted">
        retrieval top-1 {result.topSimilarity?.toFixed?.(3)} · question coverage{' '}
        {result.lexicalOverlap?.toFixed?.(2)} · {result.citations.length} citation
        {result.citations.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}