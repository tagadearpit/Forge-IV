'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, X } from 'lucide-react';
import { SplitLayout, PasswordField } from '@/components/auth-layout';
import { Alert, Button, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { ApiRequestError } from '@/lib/api';

const COUNTRIES = [
  { code: '+91', label: 'India', digits: 10 },
  { code: '+1', label: 'USA / Canada', digits: 10 },
  { code: '+44', label: 'UK', digits: 10 },
  { code: '+61', label: 'Australia', digits: 9 },
  { code: '+971', label: 'UAE', digits: 9 },
  { code: '+81', label: 'Japan', digits: 10 },
  { code: '+33', label: 'France', digits: 9 },
  { code: '+49', label: 'Germany', digits: 10 },
  { code: '+55', label: 'Brazil', digits: 11 },
];

type FieldErrors = Partial<Record<'name' | 'email' | 'phone' | 'password' | 'confirm' | 'terms', string>>;

function strengthOf(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Za-z]/.test(pw) && /[0-9]/.test(pw)) score++;
  if (pw.length >= 12 || /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) score = 0;
  return [
    { score: 0, label: 'weak' },
    { score: 1, label: 'weak' },
    { score: 2, label: 'medium' },
    { score: 3, label: 'strong' },
  ][score] as { score: 0 | 1 | 2 | 3; label: string };
}

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [phoneDigits, setPhoneDigits] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const strength = useMemo(() => strengthOf(password), [password]);
  const matches = confirm.length > 0 && confirm === password;

  const validate = (): boolean => {
    const e: FieldErrors = {};
    if (name.trim().length < 2 || name.trim().length > 60) {
      e.name = 'Name must be between 2 and 60 characters.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      e.email = 'Enter a valid email address.';
    }
    if (!/^\d+$/.test(phoneDigits) || phoneDigits.length !== country.digits) {
      e.phone = `Enter ${country.digits} digits for ${country.label}.`;
    }
    if (password.length < 8) e.password = 'Password must be at least 8 characters.';
    else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      e.password = 'Password must contain at least one letter and one number.';
    }
    if (confirm !== password) e.confirm = 'Passwords do not match.';
    if (!terms) e.terms = 'You must accept the terms to create an account.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const formValid =
    name.trim().length >= 2 &&
    name.trim().length <= 60 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    /^\d+$/.test(phoneDigits) &&
    phoneDigits.length === country.digits &&
    password.length >= 8 &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password) &&
    confirm === password &&
    terms;

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setLoading(true);
    try {
      await register({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: `${country.code}${phoneDigits}`,
        password,
      });
      router.push('/onboarding');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'EMAIL_EXISTS') {
          setErrors((f) => ({ ...f, email: err.message }));
          setFormError('An account with this email already exists. Please log in.');
        } else if (err.status === 429) {
          toast.push('warning', err.message);
        } else {
          setFormError(err.message);
          toast.push('error', err.message);
        }
      } else {
        const msg = 'Could not create your account. Please try again.';
        setFormError(msg);
        toast.push('error', msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const onBlur = (field: keyof FieldErrors) => () => {
    const e: FieldErrors = {};
    if (field === 'name' && name.trim() && (name.trim().length < 2 || name.trim().length > 60)) {
      e.name = 'Name must be between 2 and 60 characters.';
    }
    if (field === 'email' && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      e.email = 'Enter a valid email address.';
    }
    if (field === 'phone' && phoneDigits && phoneDigits.length !== country.digits) {
      e.phone = `Enter ${country.digits} digits for ${country.label}.`;
    }
    if (field === 'password' && password) {
      if (password.length < 8) e.password = 'Password must be at least 8 characters.';
      else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        e.password = 'Password must contain at least one letter and one number.';
      }
    }
    setErrors((f) => ({ ...f, ...e }));
  };

  return (
    <SplitLayout
      headline="Create your account. Start studying smarter today."
      sub="Upload a lecture and get a cited answer in under a minute. No credit card, no setup."
      artSrc="/images/register.webp"
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-brand-600 hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <h1 className="text-2xl font-bold tracking-tight">Create account</h1>
      <p className="mt-1.5 text-sm text-muted">Takes less than a minute.</p>

      {formError && (
        <div className="mt-5">
          <Alert tone="error" onClose={() => setFormError(null)}>
            <p className="flex items-start gap-2 font-medium">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {formError}
            </p>
          </Alert>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {/* 1. Full name */}
        <div>
          <label className="label" htmlFor="name">
            Full name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={onBlur('name')}
            placeholder="Ada Lovelace"
            autoComplete="name"
            aria-invalid={Boolean(errors.name)}
            className="input"
          />
          {errors.name && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{errors.name}</p>}
        </div>

        {/* 2. Email */}
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={onBlur('email')}
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            className="input"
          />
          {errors.email && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{errors.email}</p>}
        </div>

        {/* 3. Phone with country selector */}
        <div>
          <label className="label" htmlFor="phone">
            Phone number
          </label>
          <div className="flex gap-2">
            <select
              value={country.code}
              onChange={(e) => {
                const next = COUNTRIES.find((c) => c.code === e.target.value) ?? COUNTRIES[0];
                setCountry(next);
                setPhoneDigits('');
                setErrors((f) => ({ ...f, phone: undefined }));
              }}
              aria-label="Country code"
              className="input w-[9.5rem] shrink-0"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} {c.label}
                </option>
              ))}
            </select>
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              value={phoneDigits}
              onChange={(e) => {
                setPhoneDigits(e.target.value.replace(/\D/g, '').slice(0, country.digits));
                setErrors((f) => ({ ...f, phone: undefined }));
              }}
              onBlur={onBlur('phone')}
              placeholder={country.digits === 10 ? '9876543210' : ''}
              autoComplete="tel-national"
              aria-invalid={Boolean(errors.phone)}
              className="input"
            />
          </div>
          {errors.phone && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{errors.phone}</p>}
        </div>

        {/* 4. Password with strength meter */}
        <div>
          <PasswordField
            id="password"
            label="Password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              setErrors((f) => ({ ...f, password: undefined, confirm: undefined }));
            }}
            onBlur={onBlur('password')}
            placeholder="At least 8 characters, with a letter and a number"
            autoComplete="new-password"
            error={errors.password}
          />
          {password && (
            <div className="mt-2">
              <div className="flex gap-1.5" aria-hidden>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      strength.score >= i
                        ? strength.score === 1
                          ? 'bg-red-500'
                          : strength.score === 2
                            ? 'bg-amber-500'
                            : 'bg-green-500'
                        : 'bg-[color:rgb(var(--border))]'
                    }`}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">
                Strength: <span className="font-medium capitalize">{strength.label}</span>
              </p>
            </div>
          )}
        </div>

        {/* 5. Confirm password with live match indicator */}
        <div>
          <PasswordField
            id="confirm"
            label="Confirm password"
            value={confirm}
            onChange={(v) => {
              setConfirm(v);
              setErrors((f) => ({ ...f, confirm: undefined }));
            }}
            placeholder="Re-enter your password"
            autoComplete="new-password"
            error={errors.confirm}
          />
          {confirm.length > 0 && (
            <p
              className={`mt-1.5 flex items-center gap-1.5 text-xs ${matches ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
              aria-live="polite"
            >
              {matches ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
              {matches ? 'Passwords match' : 'Passwords do not match'}
            </p>
          )}
        </div>

        {/* Terms */}
        <div>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => {
                setTerms(e.target.checked);
                setErrors((f) => ({ ...f, terms: undefined }));
              }}
              className="mt-0.5 h-4 w-4 rounded border-[color:rgb(var(--border))] text-brand-600 focus:ring-brand-500"
            />
            <span className="text-muted">
              I agree to the{' '}
              <span className="font-medium text-brand-600">terms of use</span> and{' '}
              <span className="font-medium text-brand-600">privacy policy</span>.
            </span>
          </label>
          {errors.terms && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{errors.terms}</p>}
        </div>

        <Button type="submit" loading={loading} disabled={!formValid} className="w-full py-2.5">
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </SplitLayout>
  );
}