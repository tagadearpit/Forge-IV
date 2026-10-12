'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Menu, X, Moon, Sun, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#architecture', label: 'Architecture' },
  { href: '#evaluation', label: 'Evaluation' },
  { href: '#faq', label: 'FAQ' },
];

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('studymind.theme', next ? 'dark' : 'light');
    } catch {
      /* private mode — theme just won't persist */
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="rounded-lg p-2 text-muted hover:bg-[color:rgb(var(--surface))]"
    >
      {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </button>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-bold tracking-tight', className)}>
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-600 text-white">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" width="18" height="18" aria-hidden>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5Z" fill="currentColor" opacity=".45" />
        </svg>
      </span>
      StudyMind
    </span>
  );
}

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all',
        scrolled || open
          ? 'border-b border-[color:rgb(var(--border))] bg-[color:rgb(var(--card))]/85 backdrop-blur-lg'
          : 'bg-transparent'
      )}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="text-lg" aria-label="StudyMind home">
          <Logo />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-[color:rgb(var(--surface))] hover:text-[color:rgb(var(--fg))]"
            >
              {n.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login" className="btn-primary hidden sm:inline-flex">
            Get Started <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="rounded-lg p-2 md:hidden"
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-[color:rgb(var(--border))] bg-[color:rgb(var(--card))] md:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3 sm:px-6">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-[color:rgb(var(--surface))]"
              >
                {n.label}
              </a>
            ))}
            <Link href="/login" onClick={() => setOpen(false)} className="btn-primary mt-2">
              Get Started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[color:rgb(var(--border))] bg-[color:rgb(var(--surface))]">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-muted">
              A study buddy for your own materials: cited answers when your sources know it, clearly separated general knowledge when they do not.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Product</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {NAV.map((n) => (
                <li key={n.href}>
                  <a href={n.href} className="hover:text-brand-600">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Get started</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li><Link href="/login" className="hover:text-brand-600">Log in</Link></li>
              <li><Link href="/register" className="hover:text-brand-600">Create account</Link></li>
              <li><Link href="/dashboard" className="hover:text-brand-600">Dashboard</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-[color:rgb(var(--border))] pt-6 text-xs text-muted">
          <p>
            Built for the <strong className="font-semibold">Multimodal AI Hackathon 2026 — Track D</strong>{' '}
            (Personalized Tutoring &amp; Adaptive Learning).
          </p>
          <p className="mt-2">
            Demo course material was authored for this prototype and is offered under CC BY 4.0.
            No third-party imagery is bundled; all diagrams are original SVG.
          </p>
          <p className="mt-2">© {new Date().getFullYear()} StudyMind. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}