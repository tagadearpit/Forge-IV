'use client';

import { AlertTriangle, Check, Info, X, Loader2 } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ------------------------------- Button -------------------------------- */

export function Button({
  variant = 'primary',
  size,
  loading,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  loading?: boolean;
}) {
  const cls = cn(
    variant === 'primary' ? 'btn-primary' : variant === 'secondary' ? 'btn-secondary' : 'btn-ghost',
    size === 'sm' && 'px-3 py-1.5 text-xs'
  );
  return (
    <button className={cn(cls, className)} disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ------------------------------ Callout -------------------------------- */

export function Alert({
  tone = 'info',
  title,
  children,
  onClose,
  action,
}: {
  tone?: 'info' | 'error' | 'success' | 'warning';
  title?: string;
  children?: ReactNode;
  onClose?: () => void;
  action?: ReactNode;
}) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-100',
    error:
      'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
    success:
      'border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100',
    warning:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
  } as const;
  const icons = { info: Info, error: X, success: Check, warning: AlertTriangle } as const;
  const Icon = icons[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-xl border p-3.5 text-sm', tones[tone])}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'break-words')}>{children}</div>}
        {action && <div className="mt-2.5">{action}</div>}
      </div>
      {onClose && (
        <button onClick={onClose} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-black/5">
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/* ------------------------------- Toast --------------------------------- */

interface Toast {
  id: number;
  tone: 'info' | 'error' | 'success' | 'warning';
  message: string;
}

const ToastContext = createContext<{ push: (tone: Toast['tone'], message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <Alert tone={t.tone} onClose={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              {t.message}
            </Alert>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/* ---------------------------- Skeleton --------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden />;
}

/* ---------------------------- Empty state ------------------------------ */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[color:rgb(var(--border))] px-6 py-14 text-center">
      {icon && <div className="mb-3 text-[color:rgb(var(--muted))]">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ---------------------------- Error state ------------------------------ */

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-red-300 bg-red-50/60 px-6 py-12 text-center dark:border-red-900 dark:bg-red-950/40">
      <AlertTriangle className="mb-3 h-7 w-7 text-red-500" aria-hidden />
      <p className="font-semibold text-red-900 dark:text-red-100">
        {message ?? 'Something went wrong.'}
      </p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* -------------------------- Scroll reveal ------------------------------ */

/** Adds `.revealed` when the element scrolls into view, honouring reduced motion. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('revealed');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add('revealed');
            io.unobserve(el);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={cn('reveal', className)}>
      {children}
    </div>
  );
}

/* ------------------------------ Tabs ----------------------------------- */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-[color:rgb(var(--border))]">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
            active === t.id
              ? 'border-brand-600 text-brand-700 dark:text-brand-300'
              : 'border-transparent text-muted hover:text-[color:rgb(var(--fg))]'
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 rounded-full bg-[color:rgb(var(--surface))] px-1.5 py-0.5 text-xs">
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}