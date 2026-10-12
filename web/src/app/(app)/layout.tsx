'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, Library, MessagesSquare, ClipboardList, TrendingUp,
  RefreshCw, CalendarDays, GitBranch, Settings, Menu, X, LogOut, Pencil,
  BookOpen, ChevronLeft,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { initials, cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui';
import { Logo } from '@/components/site-chrome';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/knowledge-base', label: 'Knowledge Base', icon: Library },
  { href: '/tutor', label: 'Tutor Chat', icon: MessagesSquare },
  { href: '/assessments', label: 'Assessments', icon: ClipboardList },
  { href: '/mastery', label: 'Mastery', icon: TrendingUp },
  { href: '/revision', label: 'Revision', icon: RefreshCw },
  { href: '/study-plan', label: 'Study Plan', icon: CalendarDays },
  { href: '/course-map', label: 'Course Map', icon: GitBranch },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function ProfileMenu() {
  const { user, logout, updateProfile } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setName(user?.name ?? '');
    setPhone(user?.phone ?? '');
  }, [user]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({ name: name.trim(), phone: phone.trim() });
      setEditing(false);
    } catch {
      /* toast handled upstream */
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
        className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700"
      >
        {initials(user.name)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-[color:rgb(var(--border))] bg-[color:rgb(var(--card))] shadow-lift"
        >
          <div className="border-b border-[color:rgb(var(--border))] p-4">
            {editing ? (
              <div className="space-y-2.5">
                <label className="block">
                  <span className="label">Name</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="block">
                  <span className="label">Phone</span>
                  <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </label>
                <div className="flex gap-2">
                  <Button size="sm" loading={saving} onClick={save}>
                    Save
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="truncate text-base font-semibold">{user.name}</p>
                <p className="truncate text-sm text-muted">{user.email}</p>
                <p className="mt-1 font-mono text-xs text-muted">{user.phone}</p>
                <p className="mt-1 text-xs text-muted">Member since {formatDate(user.createdAt)}</p>
              </>
            )}
          </div>

          {!editing && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  setEditing(true);
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-[color:rgb(var(--surface))]"
              >
                <Pencil className="h-4 w-4" aria-hidden /> Edit profile
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  logout();
                  router.push('/');
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
              >
                <LogOut className="h-4 w-4" aria-hidden /> Log out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, ready } = useAuth();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Protected-route guard. Redirects only once auth has resolved, so a valid
  // session is never bounced mid-hydration.
  useEffect(() => {
    if (ready && !user) router.replace('/login');
    else if (ready && user && user.prefs?.onboarded === false && pathname !== '/onboarding') router.replace('/onboarding');
  }, [ready, user, router, pathname]);

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      </div>
    );
  }
  if (!user) return null;

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 flex items-center justify-between px-2 pt-1">
        <Link href="/dashboard">
          <Logo />
        </Link>
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden rounded-lg p-1.5 text-muted hover:bg-[color:rgb(var(--surface))] lg:block"
        >
          <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} aria-hidden />
        </button>
      </div>

      {NAV.map((n) => {
        const active = pathname === n.href || pathname?.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={() => setMobileOpen(false)}
            aria-current={active ? 'page' : undefined}
            title={collapsed ? n.label : undefined}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                : 'text-muted hover:bg-[color:rgb(var(--surface))] hover:text-[color:rgb(var(--fg))]',
              collapsed && 'justify-center px-2'
            )}
          >
            <n.icon className="h-5 w-5 shrink-0" aria-hidden />
            {!collapsed && <span className="truncate">{n.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden border-r border-[color:rgb(var(--border))] bg-[color:rgb(var(--card))] transition-[width] duration-200 lg:block',
          collapsed ? 'w-[4.5rem]' : 'w-64'
        )}
      >
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-[color:rgb(var(--border))] bg-[color:rgb(var(--card))]">
            {sidebar}
          </aside>
        </div>
      )}

      <div className={cn('transition-[padding] duration-200', collapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-64')}>
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-[color:rgb(var(--border))] bg-[color:rgb(var(--card))]/85 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
              className="rounded-lg p-2 lg:hidden"
            >
              {mobileOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            </button>

            <Link href="/dashboard" className="lg:hidden">
              <BookOpen className="h-5 w-5 text-brand-600" aria-hidden />
            </Link>

            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-sm text-muted sm:inline">
                {`Hey, ${user.name.split(' ')[0]} — ready to make something click?`}
              </span>
              <ProfileMenu />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}