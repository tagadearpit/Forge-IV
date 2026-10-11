'use client';

import Link from 'next/link';
import { MailQuestion } from 'lucide-react';
import { Logo } from '@/components/site-chrome';
import { Alert } from '@/components/ui';

export default function ForgotPasswordPage() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <div className="card p-8 text-center">
          <MailQuestion className="mx-auto h-10 w-10 text-brand-600" aria-hidden />
          <h1 className="mt-4 text-xl font-bold">Password reset</h1>
          <p className="mt-2 text-sm text-muted">
            Password reset is out of scope for this prototype — there is no email delivery configured.
          </p>
          <Alert tone="info" title="For the demo">
            Just use the seeded account: <span className="font-mono">demo@studymind.app</span> /{' '}
            <span className="font-mono">Demo@1234</span>
          </Alert>
          <Link href="/login" className="btn-primary mt-6 w-full">Back to login</Link>
        </div>
      </div>
    </div>
  );
}
