'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText, Presentation, Loader2, Play } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui';
import { cn, formatTimestamp } from '@/lib/utils';

/**
 * Original-file viewer.
 *
 * Uses a short-lived file token from POST /sources/:id/file-token. Media tags
 * cannot send an Authorization header, so without this they would 401 — which
 * is exactly what the previous implementation did.
 *
 * The token expires in 5 minutes, so we refresh it before expiry (and on demand
 * via the retry button) rather than letting a long viewing session silently die.
 */

const REFRESH_MARGIN_MS = 30_000; // refresh 30s before expiry

export function SourceViewer({
  source,
  location,
  seekToSec,
  onLoaded,
}: {
  source: { id: string; type: string; title: string };
  /** Location of the cited unit — drives the PDF page and the media seek. */
  location?: { page?: number | null; slide?: number | null; startSec?: number | null } | null;
  /** Explicit seek target in seconds (transcript segment click). */
  seekToSec?: number | null;
  onLoaded?: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const expiryRef = useRef<number | null>(null);

  const mint = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const u = await api.sourceFileUrl(source.id);
      setUrl(u);
      expiryRef.current = Date.now() + 5 * 60_000 - REFRESH_MARGIN_MS;
      onLoaded?.();
    } catch (err: any) {
      setError(err?.message ?? 'Could not load this file.');
      setUrl(null);
    } finally {
      setLoading(false);
    }
  }, [source.id, onLoaded]);

  useEffect(() => {
    void mint();
  }, [mint]);

  // Refresh before the token expires.
  useEffect(() => {
    const id = setInterval(() => {
      if (expiryRef.current && Date.now() >= expiryRef.current) void mint();
    }, 15_000);
    return () => clearInterval(id);
  }, [mint]);

  // Seek media when the cited timestamp changes.
  useEffect(() => {
    const target = seekToSec ?? location?.startSec ?? null;
    if (target == null || !url) return;
    const el = mediaRef.current;
    if (!el) return;
    const apply = () => {
      try {
        el.currentTime = target;
      } catch {
        /* not seekable yet */
      }
    };
    if (el.readyState >= 1) apply();
    else el.addEventListener('loadedmetadata', apply, { once: true });
  }, [url, seekToSec, location?.startSec]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-red-300 bg-red-50 p-8 text-center dark:border-red-900 dark:bg-red-950/40">
        <AlertTriangle className="h-6 w-6 text-red-500" aria-hidden />
        <p className="mt-2 text-sm font-medium text-red-900 dark:text-red-100">{error}</p>
        <Button variant="secondary" className="mt-4" onClick={() => void mint()}>
          Try again
        </Button>
      </div>
    );
  }

  if (loading && !url) {
    return (
      <div className="flex h-56 items-center justify-center rounded-xl border border-[color:rgb(var(--border))] bg-[color:rgb(var(--surface))]">
        <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden />
      </div>
    );
  }
  if (!url) return null;

  // PDF: the browser's native viewer honours the #page fragment.
  if (source.type === 'pdf') {
    const page = location?.page ?? null;
    // Remount on page change so the fragment is re-applied.
    return (
      <iframe
        key={`${url}-${page ?? 'cover'}`}
        ref={iframeRef}
        src={page ? `${url}#page=${page}` : url}
        title={`${source.title}${page ? ` — page ${page}` : ''}`}
        className="h-[32rem] w-full rounded-lg border border-[color:rgb(var(--border))] bg-white"
      />
    );
  }

  if (source.type === 'image') {
    return (
      <img
        src={url}
        alt={source.title}
        className="max-h-[32rem] w-full rounded-lg border border-[color:rgb(var(--border))] bg-white object-contain"
      />
    );
  }

  if (source.type === 'video') {
    return (
      <video
        ref={mediaRef as React.RefObject<HTMLVideoElement>}
        src={url}
        controls
        preload="metadata"
        className="w-full rounded-lg bg-black"
      />
    );
  }

  if (source.type === 'audio') {
    return (
      <audio
        ref={mediaRef as React.RefObject<HTMLAudioElement>}
        src={url}
        controls
        preload="metadata"
        className="w-full"
      />
    );
  }

  // PPTX cannot be rendered by the browser. Show the cited slide with its
  // extracted text and speaker notes rather than a bare paragraph.
  return <SlideFallback source={source} location={location} />;
}

function SlideFallback({
  source,
  location,
}: {
  source: { id: string; title: string };
  location?: { slide?: number | null } | null;
}) {
  const [slide, setSlide] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadSlide = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await api.source(source.id);
      const n = location?.slide ?? null;
      const match = n ? detail.units.find((u: any) => u.location?.slide === n) : null;
      setSlide(match ?? detail.units[0] ?? null);
    } catch {
      setSlide(null);
    } finally {
      setLoading(false);
    }
  }, [source.id, location?.slide]);

  useEffect(() => {
    void loadSlide();
  }, [loadSlide]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl bg-[color:rgb(var(--surface))]">
        <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden />
      </div>
    );
  }
  if (!slide) return null;

  return (
    <div className="rounded-xl border border-[color:rgb(var(--border))] bg-[color:rgb(var(--surface))] p-5">
      <div className="flex items-center gap-2">
        <Presentation className="h-4 w-4 text-brand-600" aria-hidden />
        <h4 className="text-sm font-semibold">
          Slide {slide.location?.slide ?? '?'} — {source.title}
        </h4>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{slide.text}</p>
      {slide.speakerNotes && (
        <p className="mt-3 border-l-2 border-amber-400 pl-3 text-xs text-muted">
          <strong>Speaker notes:</strong> {slide.speakerNotes}
        </p>
      )}
    </div>
  );
}

/** Transcript segment row — clicking seeks the player to that timestamp. */
export function TranscriptSegment({
  startSec,
  active,
  onClick,
  children,
}: {
  startSec: number;
  active?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full gap-3 rounded-lg p-2 text-left text-sm transition-colors',
        active
          ? 'bg-brand-50 dark:bg-brand-950/40'
          : 'hover:bg-[color:rgb(var(--surface))]'
      )}
      aria-label={`Seek to ${formatTimestamp(startSec)}`}
    >
      <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-brand-600">
        <Play className="h-3 w-3" aria-hidden />
        {formatTimestamp(startSec)}
      </span>
      <span className="min-w-0 flex-1 text-muted">{children}</span>
    </button>
  );
}
