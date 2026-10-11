'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Quote, ShieldCheck, ListChecks, BarChart3 } from 'lucide-react';
import { Logo } from './site-chrome';

const BENEFITS = [
  { icon: Quote, text: 'Source-cited answers that open the exact page' },
  { icon: ListChecks, text: 'Adaptive quizzes targeted at what you have not mastered' },
  { icon: BarChart3, text: 'Mastery tracking that updates after every answer' },
];

/**
 * Split-screen auth layout. Left panel is a gradient + inline SVG illustration
 * rather than a remote image, so it can never render as a broken link.
 */
export function SplitLayout({
  headline,
  sub,
  children,
  footer,
}: {
  headline: string;
  sub: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const [showArt, setShowArt] = useState(true);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left panel */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 opacity-20" aria-hidden>
          <svg className="h-full w-full" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice">
            <defs>
              <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
                <path d="M28 0 L0 0 0 28" fill="none" stroke="white" strokeWidth="0.6" />
              </pattern>
            </defs>
            <rect width="400" height="600" fill="url(#grid)" />
            <circle cx="320" cy="120" r="90" fill="white" opacity="0.08" />
            <circle cx="80" cy="470" r="130" fill="white" opacity="0.06" />
          </svg>
        </div>

        <Link href="/" className="relative text-lg text-white">
          <Logo />
        </Link>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight text-white">{headline}</h2>
          <p className="mt-3 text-brand-100">{sub}</p>

          <ul className="mt-8 space-y-3">
            {BENEFITS.map((b) => (
              <li key={b.text} className="flex items-start gap-3 text-sm text-brand-50">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/15">
                  <b.icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                {b.text}
              </li>
            ))}
          </ul>

          {showArt && (
            <svg viewBox="0 0 360 130" className="mt-10 w-full" role="img" aria-label="Stacked source cards with citations">
              {[
                { y: 10, w: 250, label: 'Lecture 7 · p.42' },
                { y: 45, w: 300, label: 'Slides · 12:44' },
                { y: 80, w: 220, label: 'Textbook · p.87' },
              ].map((c, i) => (
                <g key={c.label} opacity={1 - i * 0.18}>
                  <rect x={10 + i * 8} y={c.y} width={c.w} height="30" rx="8" fill="white" opacity={0.14} />
                  <text x={22 + i * 8} y={c.y + 19} fontSize="11" fill="white" fontFamily="ui-monospace, monospace">
                    {c.label}
                  </text>
                </g>
              ))}
            </svg>
          )}
        </div>

        <p className="relative flex items-center gap-2 text-xs text-brand-200">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Passwords hashed with bcrypt · 7-day JWT sessions · your uploads stay yours
        </p>
      </div>

      {/* Right panel */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-5 lg:justify-end">
          <Link href="/" className="lg:hidden">
            <Logo />
          </Link>
          <Link href="/" className="btn-ghost">
            Back to home
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center px-4 pb-16">
          <div className="w-full max-w-[420px]">{children}</div>
        </div>

        <div className="border-t border-[color:rgb(var(--border))] px-6 py-5 text-center text-sm text-muted">
          {footer}
        </div>
      </div>
    </div>
  );
}

/** Password input with an independent show/hide toggle. */
export function PasswordField({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  label,
  error,
  onBlur,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  label: string;
  error?: string | null;
  onBlur?: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className="input pr-11"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted hover:bg-[color:rgb(var(--surface))]"
        >
          {show ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M3 3l18 18M10.6 10.6A2 2 0 0 0 13.4 13.4M9.4 5.2A9.9 9.9 0 0 1 12 5c5 0 9 4.5 9 7a11 11 0 0 1-2.3 3.3M6.2 6.6C4 8.2 3 10.4 3 12c0 2.5 4 7 9 7 1.4 0 2.7-.35 3.8-.95" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}