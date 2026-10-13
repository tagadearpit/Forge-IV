'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, UserPlus } from 'lucide-react';
import { SplitLayout, PasswordField } from '@/components/auth-layout';
import { Alert, Button, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { ApiRequestError } from '@/lib/api';

type FieldErrors = { email?: string; password?: string };

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const validate = (): boolean => {
    const errs: FieldErrors = {};
    if (!email.trim()) errs.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = 'Enter a valid email address.';
    if (!password) errs.password = 'Password is required.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;

    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'USER_NOT_FOUND') {
          setServerError({ code: err.code, message: 'User does not exist. Please register first.' });
        } else if (err.code === 'INVALID_PASSWORD') {
          setServerError({ code: err.code, message: 'Incorrect password. Please try again.' });
        } else if (err.status === 429) {
          toast.push('warning', err.message);
        } else {
          // Unknown server failure: surface it in the alert box AND as a toast so
          // the user is never left staring at a form that did nothing.
          setServerError({ code: err.code, message: err.message });
          toast.push('error', err.message);
        }
      } else {
        const msg = 'Could not sign in. Please try again.';
        setServerError({ code: 'UNKNOWN', message: msg });
        toast.push('error', msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SplitLayout
      headline="Welcome back to your study companion."
      sub="Pick up where you left off. Your topics, mastery and sources are waiting."
      artSrc="/images/login.webp"
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link href="/register" className="font-semibold text-brand-600 hover:underline">
            Register
          </Link>
        </>
      }
    >
      <h1 className="text-2xl font-bold tracking-tight">Log in</h1>
      <p className="mt-1.5 text-sm text-muted">Enter your email and password to continue.</p>

      {serverError && (
        <div className="mt-5">
          <Alert tone="error" onClose={() => setServerError(null)}>
            <p className="flex items-start gap-2 font-medium">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {serverError.message}
            </p>
            {serverError.code === 'USER_NOT_FOUND' && (
              <Link href="/register" className="btn-secondary mt-3 w-full">
                <UserPlus className="h-4 w-4" aria-hidden /> Create an account
              </Link>
            )}
          </Alert>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
            }}
            onBlur={() =>
              setFieldErrors((f) => ({
                ...f,
                email: email.trim()
                  ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
                    ? undefined
                    : 'Enter a valid email address.'
                  : 'Email is required.',
              }))
            }
            placeholder="you@example.com"
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            className="input"
          />
          {fieldErrors.email && (
            <p id="email-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={(v) => {
            setPassword(v);
            if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
          }}
          onBlur={() => setFieldErrors((f) => ({ ...f, password: password ? undefined : 'Password is required.' }))}
          placeholder="••••••••"
          autoComplete="current-password"
          error={fieldErrors.password}
        />

        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm text-brand-600 hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" loading={loading} className="w-full py-2.5">
          {loading ? 'Signing in…' : 'Log in'}
        </Button>
      </form>

      <div className="mt-6 rounded-xl border border-[color:rgb(var(--border))] bg-[color:rgb(var(--surface))] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Try the demo</p>
        <p className="mt-1.5 font-mono text-xs text-muted">
          demo@studymind.app / Demo@1234
        </p>
      </div>
    </SplitLayout>
  );
}