'use client';

import { useEffect, useState } from 'react';
import { Save, Globe, Target, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, useToast } from '@/components/ui';

export default function SettingsPage() {
  const { user, updateProfile, logout } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [examDate, setExamDate] = useState('');
  const [targetScore, setTargetScore] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  useEffect(() => {
    if (!user) return;
    setName(user.name ?? '');
    setPhone(user.phone ?? '');
    setLanguage((user.prefs?.language as 'en' | 'hi') ?? 'en');
    const d = user.prefs?.examDate as string | undefined;
    setExamDate(d ? new Date(d).toISOString().slice(0, 10) : '');
    setTargetScore(user.prefs?.targetScore != null ? String(user.prefs.targetScore) : '');
  }, [user]);

  const deleteData = async () => {
    if (deleteConfirm !== 'DELETE') return;
    setDeleting(true); setDeleteError('');
    try {
      await api.deleteMyData();
      setDeleteSuccess(true); setDeleteOpen(false);
      toast.push('success', 'Your account and data were deleted.');
      window.setTimeout(() => logout(), 1500);
    }
    catch (err: any) { setDeleteError(err?.message ?? 'Could not delete your data. Please try again.'); }
    finally { setDeleting(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({
        name: name.trim(),
        phone: phone.trim(),
        prefs: {
          language,
          examDate: examDate || null,
          targetScore: targetScore ? Number(targetScore) : null,
        },
      });
      toast.push('success', 'All set — your profile is updated.');
    } catch (err: any) {
      toast.push('error', err?.message ?? 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">Your profile and study preferences.</p>
      </div>

      <section className="card p-6">
        <h2 className="font-semibold">Profile</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="label" htmlFor="s-name">Full name</label>
            <input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="s-email">Email</label>
            <input id="s-email" className="input opacity-60" value={user?.email ?? ''} disabled />
            <p className="mt-1 text-xs text-muted">Email cannot be changed in this prototype.</p>
          </div>
          <div>
            <label className="label" htmlFor="s-phone">Phone</label>
            <input id="s-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold">Study preferences</h2>
        <div className="mt-4 space-y-4">
          <div>
            <span className="label"><Globe className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />Tutor language</span>
            <div className="flex gap-2">
              {(['en','hi'] as const).map(l => (
                <button key={l} onClick={() => setLanguage(l)} aria-pressed={language === l}
                  className={`chip border ${language === l ? 'border-brand-500 bg-brand-600 text-white' : 'border-[color:rgb(var(--border))]'}`}>
                  {l === 'en' ? 'English' : 'हिन्दी'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="s-exam"><Target className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />Exam date</label>
            <input id="s-exam" type="date" className="input" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
            <p className="mt-1 text-xs text-muted">Used to weight your study plan by urgency.</p>
          </div>
          <div>
            <label className="label" htmlFor="s-target">Target score (%)</label>
            <input id="s-target" type="number" min={0} max={100} className="input max-w-[10rem]" value={targetScore} onChange={(e) => setTargetScore(e.target.value)} />
          </div>
        </div>
      </section>

      <Button onClick={save} loading={saving}><Save className="h-4 w-4" aria-hidden /> Save my changes</Button>

      <section className="card border-red-200 p-6 dark:border-red-900">
        <h2 className="font-semibold text-red-700 dark:text-red-300">Delete my data</h2>
        <p className="mt-2 text-sm text-muted">Permanently delete your account and its StudyMind data. This cannot be undone.</p>
        {deleteSuccess && <p role="status" className="mt-3 text-sm text-green-700">Your data was deleted successfully.</p>}
        <button type="button" className="btn-secondary mt-4 border-red-300 text-red-700" onClick={() => { setDeleteOpen(true); setDeleteConfirm(''); setDeleteError(''); }}>
          <Trash2 className="mr-2 inline h-4 w-4" aria-hidden /> Delete my data
        </button>
      </section>
      {deleteOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
        <section role="dialog" aria-modal="true" aria-labelledby="delete-title" className="card w-full max-w-md p-6">
          <h2 id="delete-title" className="text-lg font-semibold">Confirm permanent deletion</h2>
          <p className="mt-2 text-sm text-muted">Type <strong>DELETE</strong> to permanently delete your account and data.</p>
          <label htmlFor="delete-confirm" className="label mt-4">Type DELETE</label>
          <input id="delete-confirm" className="input" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} autoFocus />
          {deleteError && <p role="alert" className="mt-3 text-sm text-red-600">{deleteError}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-secondary px-4 py-2" disabled={deleting} onClick={() => setDeleteOpen(false)}>Cancel</button>
            <button type="button" className="rounded-lg bg-red-600 px-4 py-2 text-white disabled:opacity-50" disabled={deleteConfirm !== 'DELETE' || deleting} onClick={() => void deleteData()}>{deleting ? 'Deleting…' : 'Delete permanently'}</button>
          </div>
        </section>
      </div>}
    </div>
  );
}
