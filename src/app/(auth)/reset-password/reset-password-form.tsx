'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updatePasswordAction, type ResetPasswordState } from './actions';

export function ResetPasswordForm({
  initialError,
}: {
  initialError: string | null;
}) {
  const [state, formAction, pending] = useActionState<
    ResetPasswordState,
    FormData
  >(updatePasswordAction, {
    error: initialError ?? undefined,
  });

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Set a new password</h1>
        <p className="text-sm text-slate-500 mt-1">
          Pick a password you'll remember. You'll be signed back in with the new
          password.
        </p>
      </div>

      {state.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Updating…' : 'Update password'}
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
