'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  requestPasswordResetAction,
  type ForgotPasswordState,
} from './actions';

export function ForgotPasswordForm({
  initialError,
}: {
  initialError: string | null;
}) {
  const [state, formAction, pending] = useActionState<
    ForgotPasswordState,
    FormData
  >(requestPasswordResetAction, {
    error: initialError ?? undefined,
  });

  if (state.sent) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-3 text-sm text-emerald-800">
          If an account exists for that email, we've sent a password reset
          link. Check your inbox and follow the link to set a new password.
        </div>
        <Link href="/login">
          <Button type="button" variant="outline" className="w-full">
            Back to sign in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Reset password</h1>
        <p className="text-sm text-slate-500 mt-1">
          Enter the email on your account and we'll send a link to reset your
          password.
        </p>
      </div>

      {state.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>

      <Link
        href="/login"
        className="block text-center text-xs text-slate-600 hover:text-slate-900 hover:underline"
      >
        Back to sign in
      </Link>
    </form>
  );
}
