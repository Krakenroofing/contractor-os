'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-browser';
import {
  acceptInviteAction,
  type AcceptInviteState,
} from './actions';

const initial: AcceptInviteState = {};

export function AcceptInviteForm({
  token,
  email,
  companyName,
}: {
  token: string;
  email: string;
  companyName: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    acceptInviteAction,
    initial,
  );
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);
  const [signingIn, startSignIn] = useTransition();

  // Once the server action returns ok=true, sign the user in with the same
  // credentials and bounce to the dashboard. We use the browser client (not
  // the admin client) so the session lands in the user's cookie store.
  useEffect(() => {
    if (!state.ok || !state.email) return;
    startSignIn(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setClientError('Auth is not configured client-side.');
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: state.email!,
        password,
      });
      if (error) {
        setClientError(
          `Account created — please sign in manually: ${error.message}`,
        );
        return;
      }
      router.replace(
        '/dashboard' as unknown as Parameters<typeof router.replace>[0],
      );
      router.refresh();
    });
  }, [state.ok, state.email, password, router]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);
    if (password !== confirm) {
      setClientError('Passwords do not match.');
      return;
    }
    const fd = new FormData();
    fd.set('token', token);
    fd.set('password', password);
    if (name.trim() !== '') fd.set('name', name.trim());
    formAction(fd);
  }

  const err = (k: string) => state.errors?.[k]?.[0];
  const busy = pending || signingIn;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {(state.formError || clientError) && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.formError || clientError}
        </div>
      )}

      <p className="text-xs text-slate-600">
        You&apos;re joining <span className="font-medium">{companyName}</span> as{' '}
        <span className="font-mono">{email}</span>. Set a password below to
        finish creating your account.
      </p>

      <div className="space-y-1">
        <Label htmlFor="name">Display name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Alex Roberts"
          maxLength={200}
          autoComplete="name"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          required
          minLength={8}
          maxLength={200}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err('password') && (
          <p className="text-xs text-red-600">{err('password')}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          type="password"
          required
          minLength={8}
          maxLength={200}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy
          ? state.ok
            ? 'Signing you in…'
            : 'Creating your account…'
          : 'Accept invitation'}
      </Button>
    </form>
  );
}
