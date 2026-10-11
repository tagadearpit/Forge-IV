import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string): string {
  return (name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatRelative(input: string | Date | null | undefined): string {
  if (!input) return 'never';
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return 'never';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(input);
}

export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function pct(n: number): string {
  return `${Math.round((n ?? 0) * 100)}%`;
}

/** Stable mastery colour band. Kept in one place so charts and tables agree. */
export function bandColor(band: 'weak' | 'developing' | 'strong'): string {
  return band === 'weak' ? 'var(--color-mastery-weak)' : band === 'developing' ? 'var(--color-mastery-developing)' : 'var(--color-mastery-strong)';
}
