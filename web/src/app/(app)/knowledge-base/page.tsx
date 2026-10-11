'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, FileText, Presentation, Image as ImageIcon, Video, Music, File,
  Trash2, CheckCircle2, XCircle, Loader2, Clock, FolderTree, AlertTriangle,
} from 'lucide-react';
import { api, API_URL, type SourceSummary } from '@/lib/api';
import { Button, EmptyState, ErrorState, Skeleton, useToast, Tabs } from '@/components/ui';
import { cn, formatDate, formatTimestamp } from '@/lib/utils';

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  pptx: Presentation,
  image: ImageIcon,
  video: Video,
  audio: Music,
  text: File,
};

const STATUS_STYLE: Record<string, string> = {
  queued: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  extracting: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  indexing: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  ready: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

export default function KnowledgeBasePage() {
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [tab, setTab] = useState<'units' | 'topics'>('units');
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setState('loading');
    try {
      setSources((await api.sources()).sources);
      setState('ready');
    } catch (err: any) {
      setState('error');
      toast.push('error', err?.message ?? 'Could not load sources.');
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while anything is still processing.
  useEffect(() => {
    const busy = sources.some((s) => ['queued', 'extracting', 'indexing'].includes(s.status));
    if (!busy) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [sources, load]);

  const upload = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    setProgress({ name: file.name, pct: 0 });
    try {
      await api.uploadSource(form, (pct) => setProgress({ name: file.name, pct }));
      toast.push('success', `${file.name} uploaded. Indexing has started.`);
      load();
    } catch (err: any) {
      toast.push('error', err?.message ?? 'Upload failed.');
    } finally {
      setProgress(null);
    }
  };

  const openSource = async (id: string) => {
    try {
      setDetail(await api.source(id));
    } catch (err: any) {
      toast.push('error', err?.message ?? 'Could not open that source.');
    }
  };

  const remove = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"? Its units and topics will be removed too.`)) return;
    try {
      await api.deleteSource(id);
      if (selected === id) {
        setSelected(null);
        setDetail(null);
      }
      toast.push('success', 'Source deleted.');
      load();
    } catch (err: any) {
      toast.push('error', err?.message ?? 'Delete failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Knowledge base</h1>
        <p className="mt-1 text-sm text-muted">
          Upload lectures, textbooks, slides, images and recordings. Every unit keeps its origin.
        </p>
      </div>

      {/* Upload */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
        aria-label="Upload a file"
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
          dragging
            ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40'
            : 'border-[color:rgb(var(--border))] hover:border-brand-400 hover:bg-[color:rgb(var(--surface))]'
        )}
      >
        <Upload className="h-8 w-8 text-brand-600" aria-hidden />
        <p className="mt-3 font-medium">Drop a file here, or click to browse</p>
        <p className="mt-1 text-sm text-muted">PDF · PPTX · PNG/JPG · MP4 · MP3 · TXT (max 100 MB)</p>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept=".pdf,.pptx,.png,.jpg,.jpeg,.mp4,.mp3,.wav,.txt,.md"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = '';
          }}
        />
      </div>

      {progress && (
        <div className="card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="truncate font-medium">{progress.name}</span>
            <span className="font-mono text-xs text-muted">{progress.pct}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[color:rgb(var(--surface))]">
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      )}

      {/* Source list */}
      {state === 'loading' && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {state === 'error' && <ErrorState onRetry={load} />}

      {state === 'ready' && sources.length === 0 && (
        <EmptyState
          icon={<FileText className="h-10 w-10" aria-hidden />}
          title="No sources yet"
          description="Upload your first lecture PDF or slide deck and the topic tree is built automatically."
          action={<Button onClick={() => fileRef.current?.click()}>Upload your first file</Button>}
        />
      )}

      {state === 'ready' && sources.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[color:rgb(var(--border))] text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Source</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Size</th>
                  <th className="px-5 py-3 font-medium">Topics</th>
                  <th className="px-5 py-3 font-medium">Uploaded</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const Icon = ICON[s.type] ?? File;
                  const busy = ['queued', 'extracting', 'indexing'].includes(s.status);
                  return (
                    <tr
                      key={s.id}
                      className={cn(
                        'border-b border-[color:rgb(var(--border))] last:border-0',
                        selected === s.id && 'bg-brand-50/50 dark:bg-brand-950/30',
                        'cursor-pointer hover:bg-[color:rgb(var(--surface))]'
                      )}
                      onClick={() => (s.status === 'ready' ? openSource(s.id) : undefined)}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <Icon className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                          <span className="font-medium">{s.title}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn('chip', STATUS_STYLE[s.status])}>
                          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                          {s.status}
                        </span>
                        {s.status === 'failed' && s.statusReason && (
                          <p className="mt-1 max-w-xs text-xs text-red-600 dark:text-red-400">{s.statusReason}</p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted">
                        {s.pageCount ? `${s.pageCount} pages` : s.durationSec ? `${formatTimestamp(s.durationSec)}` : `${s.unitCount} units`}
                      </td>
                      <td className="px-5 py-3 text-muted">
                        <div className="flex flex-wrap gap-1">
                          {s.topics.slice(0, 2).map((t) => (
                            <span key={t} className="chip bg-[color:rgb(var(--surface))] text-xs">
                              {t}
                            </span>
                          ))}
                          {s.topics.length > 2 && <span className="text-xs text-muted">+{s.topics.length - 2}</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted">{formatDate(s.createdAt)}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(s.id, s.title);
                          }}
                          aria-label={`Delete ${s.title}`}
                          className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Source viewer */}
      {detail && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[color:rgb(var(--border))] px-5 py-4">
            <div>
              <h2 className="font-semibold">{detail.source.title}</h2>
              <p className="text-xs text-muted">
                {detail.source.pageCount ? `${detail.source.pageCount} pages · ` : ''}
                {detail.units.length} units · {detail.topics.length} topics
              </p>
            </div>
            <Button variant="secondary" onClick={() => { setDetail(null); setSelected(null); }}>
              Close
            </Button>
          </div>

          <div className="grid gap-0 lg:grid-cols-2">
            {/* Original content */}
            <div className="border-b border-[color:rgb(var(--border))] lg:border-b-0 lg:border-r">
              <div className="bg-[color:rgb(var(--surface))] p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  Original content
                </p>
                {['pdf', 'image'].includes(detail.source.type) && (
                  <iframe
                    src={api.sourceFileUrl(detail.source.id)}
                    title={detail.source.title}
                    className="h-[28rem] w-full rounded-lg border border-[color:rgb(var(--border))] bg-white"
                  />
                )}
                {detail.source.type === 'video' && (
                  <video
                    controls
                    src={api.sourceFileUrl(detail.source.id)}
                    className="w-full rounded-lg bg-black"
                  />
                )}
                {['audio'].includes(detail.source.type) && (
                  <audio controls src={api.sourceFileUrl(detail.source.id)} className="w-full" />
                )}
                {['pptx', 'text'].includes(detail.source.type) && (
                  <p className="text-sm text-muted">
                    {detail.source.type === 'pptx'
                      ? 'Slide text is shown alongside — open the source to view slides in your slide viewer.'
                      : 'Plain text source — content units are shown alongside.'}
                  </p>
                )}
              </div>
            </div>

            {/* Extracted units */}
            <div className="max-h-[36rem] overflow-y-auto">
              <Tabs
                tabs={[
                  { id: 'units', label: 'Content units', count: detail.units.length },
                  { id: 'topics', label: 'Topics', count: detail.topics.length },
                ]}
                active={tab}
                onChange={(t) => setTab(t as 'units' | 'topics')}
              />

              <div className="p-4">
                {tab === 'units' ? (
                  <ul className="space-y-2.5">
                    {detail.units.map((u: any) => (
                      <li
                        key={u.id}
                        id={`unit-${u.id}`}
                        className="rounded-xl border border-[color:rgb(var(--border))] p-3.5"
                      >
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <LocChip loc={u.location} kind={u.kind} />
                          {u.kind === 'figure' && (
                            <span className="chip bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                              <ImageIcon className="h-3 w-3" aria-hidden /> figure
                            </span>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed">{u.text}</p>
                        {u.speakerNotes && (
                          <p className="mt-2 border-l-2 border-amber-400 pl-2.5 text-xs text-muted">
                            <strong>Speaker notes:</strong> {u.speakerNotes}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <TopicTree topics={detail.topics} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LocChip({ loc, kind }: { loc: any; kind: string }) {
  if (loc?.startSec != null)
    return (
      <span className="chip bg-[color:rgb(var(--surface))] font-mono">
        <Clock className="h-3 w-3" aria-hidden /> {formatTimestamp(loc.startSec)}
      </span>
    );
  if (loc?.slide != null)
    return <span className="chip bg-[color:rgb(var(--surface))] font-mono">Slide {loc.slide}</span>;
  if (loc?.page != null)
    return <span className="chip bg-[color:rgb(var(--surface))] font-mono">p.{loc.page}</span>;
  return <span className="chip bg-[color:rgb(var(--surface))]">{kind}</span>;
}

/** Topics → Subtopics → Key Concepts, rendered as an indented tree. */
function TopicTree({ topics }: { topics: any[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(topics.map((t) => [t.id, true]))
  );

  if (!topics.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <AlertTriangle className="h-4 w-4" aria-hidden /> No topics detected in this source.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {topics.map((t) => (
        <li key={t.id}>
          <button
            onClick={() => setOpen((o) => ({ ...o, [t.id]: !o[t.id] }))}
            className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm font-medium hover:bg-[color:rgb(var(--surface))]"
            aria-expanded={open[t.id]}
          >
            <FolderTree className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            {t.name}
          </button>
          {open[t.id] && (
            <div className="ml-6 mt-1.5 border-l border-[color:rgb(var(--border))] pl-3">
              {t.summary && <p className="mb-2 text-xs text-muted">{t.summary}</p>}
              {t.keyConcepts?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {t.keyConcepts.map((c: string) => (
                    <span key={c} className="chip bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}